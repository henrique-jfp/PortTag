-- Paginação no servidor para o caderno de gavetas e para as consultas do
-- porteiro. Todas as funções são security invoker: as policies RLS de
-- public.packages continuam decidindo o que cada perfil pode ver.

create index if not exists packages_condominium_unit_received_idx
  on public.packages (condominium_id, unit_id, received_at desc);

-- Contagens por dia para o calendário do caderno, sem baixar os registros.
drop function if exists public.package_daily_counts(uuid, timestamptz, timestamptz, text);
create or replace function public.package_daily_counts(
  arg_condominium_id uuid,
  arg_date_from timestamptz,
  arg_date_to timestamptz,
  arg_timezone text
)
returns table (day date, total bigint, pending bigint, collected bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select (p.received_at at time zone arg_timezone)::date as day,
         count(*) as total,
         count(*) filter (where p.status = 'received') as pending,
         count(*) filter (where p.status = 'collected') as collected
  from public.packages p
  where p.condominium_id = arg_condominium_id
    and p.received_at >= arg_date_from
    and p.received_at < arg_date_to
  group by 1
  order by 1
$$;

-- Uma linha por apartamento ("gaveta"), já filtrada e paginada no banco.
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
  arg_offset integer default 0
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

-- Registros de uma gaveta (ou de todo o condomínio), paginados no banco.
-- arg_sort: 'recent' (padrão), 'tracking' ou 'sender'.
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
  arg_offset integer default 0
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

revoke all on function public.package_daily_counts(uuid, timestamptz, timestamptz, text) from public;
revoke all on function public.search_package_drawers(uuid, timestamptz, timestamptz, text, text, text, text, text, integer, integer) from public;
revoke all on function public.search_package_records(uuid, uuid, text, timestamptz, timestamptz, text, text, text, text, text, integer, integer) from public;

grant execute on function public.package_daily_counts(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.search_package_drawers(uuid, timestamptz, timestamptz, text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.search_package_records(uuid, uuid, text, timestamptz, timestamptz, text, text, text, text, text, integer, integer) to authenticated;
