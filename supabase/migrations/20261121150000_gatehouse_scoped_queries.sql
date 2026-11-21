-- Consultas no escopo da portaria.
--
-- 1) package_events passa a guardar o bloco, para que a auditoria respeite a
--    mesma separação entre portarias que packages já respeita.
-- 2) Caderno e relatório aceitam arg_block_id, usado pelas abas de caderno.

alter table public.package_events
  add column if not exists block_id uuid references public.blocks (id) on delete set null;

create index if not exists package_events_condominium_block_idx
  on public.package_events (condominium_id, block_id, occurred_at desc);

update public.package_events e
set block_id = p.block_id
from public.packages p
where e.package_id = p.id
  and e.block_id is null;

create or replace function public.set_package_event_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.block_id is null and new.package_id is not null then
    select p.block_id into new.block_id
    from public.packages p
    where p.id = new.package_id;
  end if;
  return new;
end;
$$;

drop trigger if exists package_events_set_block on public.package_events;
create trigger package_events_set_block
  before insert on public.package_events
  for each row execute function public.set_package_event_block();

drop policy if exists "Condominium staff can read package events"
  on public.package_events;
create policy "Condominium staff can read package events"
  on public.package_events
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.condominium_users cu
      where cu.condominium_id = package_events.condominium_id
        and cu.user_id = (select auth.uid())
        and cu.status = 'active'
        and cu.role = 'admin'
    )
    or (
      exists (
        select 1
        from public.condominium_users cu
        where cu.condominium_id = package_events.condominium_id
          and cu.user_id = (select auth.uid())
          and cu.status = 'active'
          and cu.role = 'operator'
      )
      and public.can_access_condominium_block(
        package_events.condominium_id,
        package_events.block_id
      )
    )
  );

-- Gavetas do caderno, com filtro opcional de bloco.
drop function if exists public.search_package_drawers(uuid, timestamptz, timestamptz, text, text, text, text, text, integer, integer);
create or replace function public.search_package_drawers(
  arg_condominium_id uuid,
  arg_date_from timestamptz default null,
  arg_date_to timestamptz default null,
  arg_unit_query text default null,
  arg_tracking_query text default null,
  arg_company_query text default null,
  arg_porter_query text default null,
  arg_status text default null,
  arg_limit integer default 20,
  arg_offset integer default 0,
  arg_block_id uuid default null
)
returns table (
  unit_id uuid,
  unit_number text,
  block_name text,
  package_count bigint,
  pending_count bigint,
  last_received_at timestamptz,
  total_drawers bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with unit_filter as (
    select nullif(btrim(arg_unit_query), '') as value
  ),
  tracking_filter as (
    select nullif(btrim(arg_tracking_query), '') as value
  ),
  company_filter as (
    select nullif(btrim(arg_company_query), '') as value
  ),
  porter_filter as (
    select nullif(btrim(arg_porter_query), '') as value
  ),
  filtered as (
    select p.unit_id, p.unit_number, p.block_name, p.received_at, p.status
    from public.packages p
    where p.condominium_id = arg_condominium_id
      and (arg_block_id is null or p.block_id = arg_block_id)
      and (arg_status is null or p.status = arg_status)
      and (arg_date_from is null or p.received_at >= arg_date_from)
      and (arg_date_to is null or p.received_at < arg_date_to)
      and (
        (select value from unit_filter) is null
        or p.unit_number ilike '%' || (select value from unit_filter) || '%'
        or p.block_name ilike '%' || (select value from unit_filter) || '%'
      )
      and (
        (select value from tracking_filter) is null
        or p.tracking_code ilike '%' || (select value from tracking_filter) || '%'
      )
      and (
        (select value from company_filter) is null
        or p.sender ilike '%' || (select value from company_filter) || '%'
        or p.delivery_person ilike '%' || (select value from company_filter) || '%'
      )
      and (
        (select value from porter_filter) is null
        or exists (
          select 1
          from public.porter_accounts pa
          where pa.auth_user_id = p.received_by
            and pa.condominium_id = p.condominium_id
            and pa.name ilike '%' || (select value from porter_filter) || '%'
        )
      )
  ),
  grouped as (
    select f.unit_id,
           f.unit_number,
           f.block_name,
           count(*) as package_count,
           count(*) filter (where f.status = 'received') as pending_count,
           max(f.received_at) as last_received_at
    from filtered f
    group by f.unit_id, f.unit_number, f.block_name
  )
  select g.unit_id,
         g.unit_number,
         g.block_name,
         g.package_count,
         g.pending_count,
         g.last_received_at,
         count(*) over () as total_drawers
  from grouped g
  order by g.last_received_at desc, g.unit_number asc
  limit least(greatest(arg_limit, 1), 100)
  offset greatest(arg_offset, 0)
$$;

-- Registros de uma gaveta, do mais novo para o mais antigo.
drop function if exists public.search_package_records(uuid, uuid, text, timestamptz, timestamptz, text, text, text, text, text, integer, integer);
create or replace function public.search_package_records(
  arg_condominium_id uuid,
  arg_unit_id uuid default null,
  arg_status text default null,
  arg_date_from timestamptz default null,
  arg_date_to timestamptz default null,
  arg_unit_query text default null,
  arg_tracking_query text default null,
  arg_company_query text default null,
  arg_porter_query text default null,
  arg_sort text default 'recent',
  arg_limit integer default 20,
  arg_offset integer default 0,
  arg_block_id uuid default null
)
returns table (
  id uuid,
  condominium_id uuid,
  unit_id uuid,
  unit_number text,
  block_name text,
  resident_name text,
  recipient_is_resident boolean,
  sender text,
  delivery_person text,
  tracking_code text,
  received_by uuid,
  received_at timestamptz,
  status text,
  collected_at timestamptz,
  collected_by_name text,
  collected_confirmed_by uuid,
  is_damaged boolean,
  receipt_path text,
  photo_expires_at timestamptz,
  photo_deleted_at timestamptz,
  last_notified_at timestamptz,
  total_records bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with unit_filter as (
    select nullif(btrim(arg_unit_query), '') as value
  ),
  tracking_filter as (
    select nullif(btrim(arg_tracking_query), '') as value
  ),
  company_filter as (
    select nullif(btrim(arg_company_query), '') as value
  ),
  porter_filter as (
    select nullif(btrim(arg_porter_query), '') as value
  ),
  filtered as (
    select p.*
    from public.packages p
    where p.condominium_id = arg_condominium_id
      and (arg_block_id is null or p.block_id = arg_block_id)
      and (arg_unit_id is null or p.unit_id = arg_unit_id)
      and (arg_status is null or p.status = arg_status)
      and (arg_date_from is null or p.received_at >= arg_date_from)
      and (arg_date_to is null or p.received_at < arg_date_to)
      and (
        (select value from unit_filter) is null
        or p.unit_number ilike '%' || (select value from unit_filter) || '%'
        or p.block_name ilike '%' || (select value from unit_filter) || '%'
      )
      and (
        (select value from tracking_filter) is null
        or p.tracking_code ilike '%' || (select value from tracking_filter) || '%'
      )
      and (
        (select value from company_filter) is null
        or p.sender ilike '%' || (select value from company_filter) || '%'
        or p.delivery_person ilike '%' || (select value from company_filter) || '%'
      )
      and (
        (select value from porter_filter) is null
        or exists (
          select 1
          from public.porter_accounts pa
          where pa.auth_user_id = p.received_by
            and pa.condominium_id = p.condominium_id
            and pa.name ilike '%' || (select value from porter_filter) || '%'
        )
      )
  )
  select f.id,
         f.condominium_id,
         f.unit_id,
         f.unit_number,
         f.block_name,
         f.resident_name,
         f.recipient_is_resident,
         f.sender,
         f.delivery_person,
         f.tracking_code,
         f.received_by,
         f.received_at,
         f.status,
         f.collected_at,
         f.collected_by_name,
         f.collected_confirmed_by,
         f.is_damaged,
         f.receipt_path,
         f.photo_expires_at,
         f.photo_deleted_at,
         f.last_notified_at,
         count(*) over () as total_records
  from filtered f
  order by
    case when arg_sort = 'tracking'
      then lower(coalesce(nullif(btrim(f.tracking_code), ''),
                          nullif(btrim(f.delivery_person), ''),
                          nullif(btrim(f.sender), ''))) end asc nulls last,
    case when arg_sort = 'sender'
      then lower(coalesce(nullif(btrim(f.sender), ''),
                          nullif(btrim(f.delivery_person), ''))) end asc nulls last,
    f.received_at desc,
    f.id desc
  limit least(greatest(arg_limit, 1), 100)
  offset greatest(arg_offset, 0)
$$;

grant execute on function public.search_package_drawers(uuid, timestamptz, timestamptz, text, text, text, text, text, integer, integer, uuid) to authenticated;
grant execute on function public.search_package_records(uuid, uuid, text, timestamptz, timestamptz, text, text, text, text, text, integer, integer, uuid) to authenticated;

-- Relatório: apenas síndico ativo do condomínio (ou Super Admin), com filtro
-- opcional de bloco. Antes a RPC confiava apenas na RLS e aceitava qualquer
-- usuário autenticado.
drop function if exists public.manager_package_report(uuid, timestamptz, timestamptz);
create or replace function public.manager_package_report(
  p_condominium_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  arg_block_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.condominium_users cu
      where cu.condominium_id = p_condominium_id
        and cu.user_id = (select auth.uid())
        and cu.status = 'active'
        and cu.role = 'admin'
    )
  ) then
    raise exception 'Sem permissão para consultar este relatório.'
      using errcode = '42501';
  end if;

  with filtered as (
    select p.*
    from public.packages p
    where p.condominium_id = p_condominium_id
      and (arg_block_id is null or p.block_id = arg_block_id)
      and (p_date_from is null or p.received_at >= p_date_from)
      and (p_date_to is null or p.received_at < p_date_to)
  ),
  summary as (
    select
      count(*) as total,
      count(*) filter (where status = 'received') as pending,
      count(*) filter (where status = 'collected') as delivered,
      count(*) filter (
        where status = 'received' and received_at < now() - interval '3 days'
      ) as older3,
      count(*) filter (
        where status = 'received' and received_at < now() - interval '7 days'
      ) as older7,
      count(*) filter (
        where status = 'received' and received_at < now() - interval '15 days'
      ) as older15,
      coalesce(
        round(
          avg(extract(epoch from (collected_at - received_at)) / 3600)::numeric,
          1
        ),
        0
      ) as avg_hours
    from filtered
  )
  select jsonb_build_object(
    'summary', (select to_jsonb(s) from summary s),
    'byBlock', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.total desc, item.label)
      from (
        select coalesce(block_name, 'Sem bloco') as label,
               count(*) as total,
               count(*) filter (where status = 'received') as pending,
               count(*) filter (where status = 'collected') as delivered
        from filtered group by 1
      ) item
    ), '[]'::jsonb),
    'byUnit', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.total desc, item.label)
      from (
        select coalesce(block_name || ' · ', '') || unit_number as label,
               count(*) as total,
               count(*) filter (where status = 'received') as pending,
               count(*) filter (where status = 'collected') as delivered
        from filtered group by 1
      ) item
    ), '[]'::jsonb),
    'bySender', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.total desc, item.label)
      from (
        select coalesce(sender, 'Não informado') as label,
               count(*) as total
        from filtered group by 1
      ) item
    ), '[]'::jsonb),
    'byPorter', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.total desc, item.label)
      from (
        select coalesce(pa.name, 'Não identificado') as label,
               count(*) as total
        from filtered g
        left join public.porter_accounts pa
          on pa.auth_user_id = g.received_by
         and pa.condominium_id = g.condominium_id
        group by 1
      ) item
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function public.manager_package_report(uuid, timestamptz, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';
