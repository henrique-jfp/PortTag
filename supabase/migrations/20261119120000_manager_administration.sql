-- Administração delegada ao síndico e auditoria do caderno.
--
-- As funções de cadastro continuam `security definer` (as tabelas não permitem
-- escrita direta), mas passam a aceitar o vínculo `admin` ativo do próprio
-- condomínio. O Super Admin mantém o acesso a todos. Nenhuma policy RLS de
-- leitura é afrouxada: um síndico continua vendo somente o seu condomínio.

create or replace function public.is_condominium_admin(target_condominium uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin()
    or (
      target_condominium is not null
      and exists (
        select 1
        from public.condominium_users cu
        where cu.condominium_id = target_condominium
          and cu.user_id = (select auth.uid())
          and cu.status = 'active'
          and cu.role = 'admin'
      )
    );
$$;

revoke all on function public.is_condominium_admin(uuid) from public;
grant execute on function public.is_condominium_admin(uuid) to authenticated;


-- Dados do condomínio -------------------------------------------------------

create or replace function public.update_condominium(
  p_condominium_id uuid,
  p_name text,
  p_cep text,
  p_street text,
  p_address_number text,
  p_neighborhood text,
  p_city text,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(p_condominium_id))
  ) then
    raise exception 'Sem permissão para editar este condomínio.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null
    or nullif(btrim(p_name), '') is null
    or nullif(btrim(p_cep), '') is null
    or nullif(btrim(p_street), '') is null
    or nullif(btrim(p_address_number), '') is null
    or nullif(btrim(p_neighborhood), '') is null
    or nullif(btrim(p_city), '') is null
    or coalesce(length(btrim(p_state)), 0) <> 2
  then
    raise exception 'Informe os dados obrigatórios do condomínio.'
      using errcode = '22023';
  end if;

  update public.condominiums
  set name = btrim(p_name),
      cep = btrim(p_cep),
      street = btrim(p_street),
      number = btrim(p_address_number),
      address_number = btrim(p_address_number),
      neighborhood = btrim(p_neighborhood),
      city = btrim(p_city),
      state = upper(btrim(p_state))
  where id = p_condominium_id;

  if not found then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;
end;
$$;


-- Blocos --------------------------------------------------------------------

create or replace function public.add_condominium_block(
  p_condominium_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block_id uuid;
  v_block_count integer;
begin
  if auth.uid() is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(p_condominium_id))
  ) then
    raise exception 'Sem permissão para cadastrar blocos neste condomínio.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null or nullif(btrim(p_name), '') is null then
    raise exception 'Informe o condomínio e o nome do bloco.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.condominiums where id = p_condominium_id
  ) then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.blocks
    where condominium_id = p_condominium_id
      and lower(name) = lower(btrim(p_name))
  ) then
    raise exception 'Já existe um bloco com esse nome neste condomínio.'
      using errcode = '23505';
  end if;

  insert into public.blocks (condominium_id, name, created_by)
  values (p_condominium_id, btrim(p_name), auth.uid())
  returning id into v_block_id;

  select count(*)::integer
  into v_block_count
  from public.blocks
  where condominium_id = p_condominium_id;

  update public.condominiums
  set block_count = greatest(block_count, v_block_count)
  where id = p_condominium_id;

  return v_block_id;
end;
$$;


-- Unidades ------------------------------------------------------------------

create or replace function public.create_unit(
  p_condominium_id uuid,
  p_block_id uuid,
  p_unit_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_block_count integer;
  v_unit_id uuid;
begin
  if v_user_id is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(p_condominium_id))
  ) then
    raise exception 'Sem permissão para cadastrar unidades neste condomínio.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null or nullif(btrim(p_unit_number), '') is null then
    raise exception 'Informe o condomínio e o número da unidade.'
      using errcode = '22023';
  end if;

  select block_count into v_block_count
  from public.condominiums
  where id = p_condominium_id;

  if not found then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  if (v_block_count > 0 and p_block_id is null)
    or (v_block_count = 0 and p_block_id is not null)
    or (
      p_block_id is not null
      and not exists (
        select 1
        from public.blocks
        where id = p_block_id
          and condominium_id = p_condominium_id
      )
    )
  then
    raise exception 'Selecione um bloco pertencente ao condomínio.'
      using errcode = '22023';
  end if;

  insert into public.units (
    condominium_id,
    block_id,
    unit_number,
    created_by
  )
  values (
    p_condominium_id,
    p_block_id,
    btrim(p_unit_number),
    v_user_id
  )
  returning id into v_unit_id;

  return v_unit_id;
end;
$$;

create or replace function public.update_unit(
  p_unit_id uuid,
  p_block_id uuid,
  p_unit_number text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condominium_id uuid;
  v_block_count integer;
begin
  select u.condominium_id, c.block_count
  into v_condominium_id, v_block_count
  from public.units u
  join public.condominiums c on c.id = u.condominium_id
  where u.id = p_unit_id;

  if auth.uid() is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(v_condominium_id))
  ) then
    raise exception 'Sem permissão para editar unidades neste condomínio.'
      using errcode = '42501';
  end if;

  if p_unit_id is null
    or nullif(btrim(p_unit_number), '') is null
    or p_status is null
    or p_status not in ('active', 'inactive')
  then
    raise exception 'Informe os dados obrigatórios da unidade.'
      using errcode = '22023';
  end if;

  if v_condominium_id is null then
    raise exception 'Unidade não encontrada.'
      using errcode = 'P0002';
  end if;

  if (v_block_count > 0 and p_block_id is null)
    or (v_block_count = 0 and p_block_id is not null)
    or (
      p_block_id is not null
      and not exists (
        select 1
        from public.blocks
        where id = p_block_id
          and condominium_id = v_condominium_id
      )
    )
  then
    raise exception 'Selecione um bloco pertencente ao condomínio.'
      using errcode = '22023';
  end if;

  update public.units
  set block_id = p_block_id,
      unit_number = btrim(p_unit_number),
      status = p_status
  where id = p_unit_id;
end;
$$;

create or replace function public.delete_unit(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condominium_id uuid;
begin
  select condominium_id into v_condominium_id
  from public.units
  where id = p_unit_id;

  if auth.uid() is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(v_condominium_id))
  ) then
    raise exception 'Sem permissão para excluir unidades neste condomínio.'
      using errcode = '42501';
  end if;

  if p_unit_id is null then
    raise exception 'Informe o apartamento que deseja excluir.'
      using errcode = '22023';
  end if;

  delete from public.units
  where id = p_unit_id;

  if not found then
    raise exception 'Apartamento não encontrado.'
      using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.create_units_batch(
  p_condominium_id uuid,
  p_block_id uuid,
  p_unit_numbers text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_block_count integer;
  v_created integer;
begin
  if v_user_id is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(p_condominium_id))
  ) then
    raise exception 'Sem permissão para cadastrar unidades neste condomínio.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null
    or coalesce(cardinality(p_unit_numbers), 0) < 1
    or cardinality(p_unit_numbers) > 500
  then
    raise exception 'Informe de 1 a 500 números de unidades.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_unit_numbers) as input(unit_number)
    where nullif(btrim(input.unit_number), '') is null
  ) or exists (
    select 1
    from unnest(p_unit_numbers) as input(unit_number)
    group by lower(btrim(input.unit_number))
    having count(*) > 1
  ) then
    raise exception 'A lista contém números vazios ou repetidos.'
      using errcode = '22023';
  end if;

  select block_count into v_block_count
  from public.condominiums
  where id = p_condominium_id;

  if not found then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  if (v_block_count > 0 and p_block_id is null)
    or (v_block_count = 0 and p_block_id is not null)
    or (
      p_block_id is not null
      and not exists (
        select 1
        from public.blocks
        where id = p_block_id
          and condominium_id = p_condominium_id
      )
    )
  then
    raise exception 'Selecione um bloco pertencente ao condomínio.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.units u
    join (
      select distinct lower(btrim(input.unit_number)) as unit_number
      from unnest(p_unit_numbers) as input(unit_number)
    ) requested on requested.unit_number = lower(u.unit_number)
    where u.condominium_id = p_condominium_id
      and u.block_id is not distinct from p_block_id
  ) then
    raise exception 'Uma ou mais unidades já estão cadastradas neste bloco.'
      using errcode = '23505';
  end if;

  insert into public.units (
    condominium_id,
    block_id,
    unit_number,
    created_by
  )
  select
    p_condominium_id,
    p_block_id,
    btrim(input.unit_number),
    v_user_id
  from unnest(p_unit_numbers) as input(unit_number);

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;


-- Moradores -----------------------------------------------------------------

create or replace function public.create_unit_resident(
  p_unit_id uuid,
  p_name text,
  p_whatsapp text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resident_id uuid;
  v_condominium_id uuid;
begin
  select condominium_id into v_condominium_id
  from public.units
  where id = p_unit_id;

  if auth.uid() is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(v_condominium_id))
  ) then
    raise exception 'Sem permissão para cadastrar moradores neste condomínio.'
      using errcode = '42501';
  end if;

  if p_unit_id is null
    or (
      nullif(btrim(coalesce(p_name, '')), '') is null
      and nullif(btrim(coalesce(p_whatsapp, '')), '') is null
    )
  then
    raise exception 'Informe um nome ou WhatsApp para o contato.'
      using errcode = '22023';
  end if;

  if v_condominium_id is null then
    raise exception 'Unidade não encontrada.'
      using errcode = 'P0002';
  end if;

  insert into public.unit_residents (unit_id, name, whatsapp, created_by)
  values (
    p_unit_id,
    nullif(btrim(coalesce(p_name, '')), ''),
    nullif(btrim(coalesce(p_whatsapp, '')), ''),
    auth.uid()
  )
  returning id into v_resident_id;

  return v_resident_id;
end;
$$;

create or replace function public.update_unit_resident(
  p_resident_id uuid,
  p_name text,
  p_whatsapp text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condominium_id uuid;
begin
  select u.condominium_id into v_condominium_id
  from public.unit_residents r
  join public.units u on u.id = r.unit_id
  where r.id = p_resident_id;

  if auth.uid() is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(v_condominium_id))
  ) then
    raise exception 'Sem permissão para editar moradores neste condomínio.'
      using errcode = '42501';
  end if;

  if p_resident_id is null
    or (
      nullif(btrim(coalesce(p_name, '')), '') is null
      and nullif(btrim(coalesce(p_whatsapp, '')), '') is null
    )
  then
    raise exception 'Informe um nome ou WhatsApp para o contato.'
      using errcode = '22023';
  end if;

  update public.unit_residents
  set name = nullif(btrim(coalesce(p_name, '')), ''),
      whatsapp = nullif(btrim(coalesce(p_whatsapp, '')), ''),
      updated_at = now()
  where id = p_resident_id;

  if not found then
    raise exception 'Morador não encontrado.'
      using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.delete_unit_resident(p_resident_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condominium_id uuid;
begin
  select u.condominium_id into v_condominium_id
  from public.unit_residents r
  join public.units u on u.id = r.unit_id
  where r.id = p_resident_id;

  if auth.uid() is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(v_condominium_id))
  ) then
    raise exception 'Sem permissão para excluir moradores neste condomínio.'
      using errcode = '42501';
  end if;

  delete from public.unit_residents
  where id = p_resident_id;

  if not found then
    raise exception 'Morador não encontrado.'
      using errcode = 'P0002';
  end if;
end;
$$;


-- Histórico imutável do caderno ---------------------------------------------

create table if not exists public.package_events (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null
    references public.packages (id) on delete cascade,
  condominium_id uuid not null
    references public.condominiums (id) on delete cascade,
  event_type text not null check (
    event_type in ('received', 'collected', 'notification', 'damage_reported')
  ),
  description text not null,
  actor_id uuid references auth.users (id) on delete set null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists package_events_condominium_occurred_idx
  on public.package_events (condominium_id, occurred_at desc);
create index if not exists package_events_package_occurred_idx
  on public.package_events (package_id, occurred_at desc);

alter table public.package_events enable row level security;

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
        and cu.role in ('admin', 'operator')
    )
  );

revoke insert, update, delete on public.package_events from anon, authenticated;
grant select on public.package_events to authenticated;

-- Carga inicial: o histórico passa a existir para as encomendas já gravadas.
insert into public.package_events (
  package_id, condominium_id, event_type, description, actor_id, occurred_at, metadata
)
select p.id, p.condominium_id, 'received',
       'Encomenda recebida na portaria' || coalesce(' — ' || p.unit_number, ''),
       p.received_by, coalesce(p.received_at, now()),
       jsonb_build_object(
         'tracking_code', p.tracking_code,
         'sender', p.sender,
         'delivery_person', p.delivery_person
       )
from public.packages p
where not exists (
  select 1 from public.package_events e
  where e.package_id = p.id and e.event_type = 'received'
);

insert into public.package_events (
  package_id, condominium_id, event_type, description, actor_id, occurred_at, metadata
)
select p.id, p.condominium_id, 'collected',
       'Encomenda entregue' || coalesce(' a ' || p.collected_by_name, ''),
       p.collected_confirmed_by, coalesce(p.collected_at, now()), '{}'::jsonb
from public.packages p
where p.status = 'collected'
  and not exists (
    select 1 from public.package_events e
    where e.package_id = p.id and e.event_type = 'collected'
  );

insert into public.package_events (
  package_id, condominium_id, event_type, description, actor_id, occurred_at, metadata
)
select n.package_id, n.condominium_id, 'notification',
       'Aviso preparado para ' || coalesce(n.recipient_name, n.recipient),
       n.created_by, n.created_at,
       jsonb_build_object('channel', n.channel, 'status', n.status)
from public.package_notifications n
where not exists (
  select 1 from public.package_events e
  where e.package_id = n.package_id
    and e.event_type = 'notification'
    and e.occurred_at = n.created_at
);

create or replace function public.log_package_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.package_events (
      package_id, condominium_id, event_type, description, actor_id, occurred_at, metadata
    )
    values (
      new.id, new.condominium_id, 'received',
      'Encomenda recebida na portaria' || coalesce(' — ' || new.unit_number, ''),
      new.received_by, coalesce(new.received_at, now()),
      jsonb_build_object(
        'tracking_code', new.tracking_code,
        'sender', new.sender,
        'delivery_person', new.delivery_person
      )
    );
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status and new.status = 'collected' then
      insert into public.package_events (
        package_id, condominium_id, event_type, description, actor_id, occurred_at, metadata
      )
      values (
        new.id, new.condominium_id, 'collected',
        'Encomenda entregue' || coalesce(' a ' || new.collected_by_name, ''),
        new.collected_confirmed_by, coalesce(new.collected_at, now()), '{}'::jsonb
      );
    end if;

    if new.is_damaged and old.is_damaged is distinct from new.is_damaged then
      insert into public.package_events (
        package_id, condominium_id, event_type, description, actor_id, occurred_at, metadata
      )
      values (
        new.id, new.condominium_id, 'damage_reported',
        'Avaria registrada na chegada', new.received_by, now(), '{}'::jsonb
      );
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists packages_event_log on public.packages;
create trigger packages_event_log
  after insert or update on public.packages
  for each row execute function public.log_package_event();

create or replace function public.log_package_notification_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.package_events (
    package_id, condominium_id, event_type, description, actor_id, occurred_at, metadata
  )
  values (
    new.package_id, new.condominium_id, 'notification',
    'Aviso preparado para ' || coalesce(new.recipient_name, new.recipient),
    new.created_by, new.created_at,
    jsonb_build_object('channel', new.channel, 'status', new.status)
  );
  return null;
end;
$$;

drop trigger if exists package_notifications_event_log on public.package_notifications;
create trigger package_notifications_event_log
  after insert on public.package_notifications
  for each row execute function public.log_package_notification_event();


-- Relatórios ----------------------------------------------------------------

create or replace function public.manager_package_report(
  p_condominium_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select p.*
    from public.packages p
    where p.condominium_id = p_condominium_id
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
  ),
  grouped as (select * from filtered)
  select jsonb_build_object(
    'summary', (select to_jsonb(s) from summary s),
    'byBlock', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.total desc, item.label)
      from (
        select coalesce(block_name, 'Sem bloco') as label,
               count(*) as total,
               count(*) filter (where status = 'received') as pending,
               count(*) filter (where status = 'collected') as delivered
        from grouped group by 1
      ) item
    ), '[]'::jsonb),
    'byUnit', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.total desc, item.label)
      from (
        select coalesce(block_name || ' · ', '') || unit_number as label,
               count(*) as total,
               count(*) filter (where status = 'received') as pending,
               count(*) filter (where status = 'collected') as delivered
        from grouped group by 1
      ) item
    ), '[]'::jsonb),
    'bySender', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.total desc, item.label)
      from (
        select coalesce(sender, 'Não informado') as label,
               count(*) as total
        from grouped group by 1
      ) item
    ), '[]'::jsonb),
    'byPorter', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.total desc, item.label)
      from (
        select coalesce(pa.name, 'Não identificado') as label,
               count(*) as total
        from grouped g
        left join public.porter_accounts pa
          on pa.auth_user_id = g.received_by
         and pa.condominium_id = g.condominium_id
        group by 1
      ) item
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.manager_package_report(uuid, timestamptz, timestamptz) from public;
grant execute on function public.manager_package_report(uuid, timestamptz, timestamptz) to authenticated;
