create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums (id) on delete cascade,
  block_id uuid references public.blocks (id) on delete restrict,
  unit_number text not null check (length(btrim(unit_number)) > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.blocks
  add column if not exists created_by uuid references auth.users (id) on delete restrict,
  add column if not exists created_at timestamptz not null default now();

alter table public.units
  add column if not exists condominium_id uuid references public.condominiums (id) on delete cascade,
  add column if not exists block_id uuid references public.blocks (id) on delete restrict,
  add column if not exists unit_number text,
  add column if not exists status text not null default 'active',
  add column if not exists created_by uuid references auth.users (id) on delete restrict,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists units_without_block_number_idx
  on public.units (condominium_id, lower(unit_number))
  where block_id is null;

create unique index if not exists units_with_block_number_idx
  on public.units (condominium_id, block_id, lower(unit_number))
  where block_id is not null;

create unique index if not exists blocks_case_insensitive_name_idx
  on public.blocks (condominium_id, lower(name));

alter table public.units enable row level security;

drop policy if exists "Users can read units in permitted condominiums" on public.units;
create policy "Users can read units in permitted condominiums"
  on public.units
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.condominium_users
      where condominium_id = units.condominium_id
        and user_id = (select auth.uid())
        and status = 'active'
    )
  );

revoke insert, update, delete on public.units from anon, authenticated;
grant select on public.units to authenticated;

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
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode editar condomínios.'
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

revoke all on function public.update_condominium(uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.update_condominium(uuid, text, text, text, text, text, text, text) to authenticated;

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
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode cadastrar blocos.'
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

revoke all on function public.add_condominium_block(uuid, text) from public;
grant execute on function public.add_condominium_block(uuid, text) to authenticated;

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
  if v_user_id is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode cadastrar unidades.'
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

revoke all on function public.create_unit(uuid, uuid, text) from public;
grant execute on function public.create_unit(uuid, uuid, text) to authenticated;

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
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode editar unidades.'
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

  select u.condominium_id, c.block_count
  into v_condominium_id, v_block_count
  from public.units u
  join public.condominiums c on c.id = u.condominium_id
  where u.id = p_unit_id;

  if not found then
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

revoke all on function public.update_unit(uuid, uuid, text, text) from public;
grant execute on function public.update_unit(uuid, uuid, text, text) to authenticated;

create or replace function public.delete_condominium(p_condominium_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode excluir condomínios.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null or not exists (
    select 1
    from public.condominiums
    where id = p_condominium_id
  ) then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  delete from public.units
  where condominium_id = p_condominium_id;

  delete from public.blocks
  where condominium_id = p_condominium_id;

  delete from public.condominium_users
  where condominium_id = p_condominium_id;

  delete from public.condominiums
  where id = p_condominium_id;
end;
$$;

revoke all on function public.delete_condominium(uuid) from public;
grant execute on function public.delete_condominium(uuid) to authenticated;
