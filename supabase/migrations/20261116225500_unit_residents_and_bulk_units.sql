create table if not exists public.unit_residents (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete cascade,
  name text,
  whatsapp text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_residents_name_or_whatsapp_check
    check (
      nullif(btrim(coalesce(name, '')), '') is not null
      or nullif(btrim(coalesce(whatsapp, '')), '') is not null
    )
);

alter table public.unit_residents enable row level security;

drop policy if exists "Users can read residents in permitted condominiums"
  on public.unit_residents;
create policy "Users can read residents in permitted condominiums"
  on public.unit_residents
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.units u
      join public.condominium_users cu
        on cu.condominium_id = u.condominium_id
      where u.id = unit_residents.unit_id
        and cu.user_id = (select auth.uid())
        and cu.status = 'active'
    )
  );

revoke insert, update, delete on public.unit_residents from anon, authenticated;
grant select on public.unit_residents to authenticated;

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
  if v_user_id is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode cadastrar unidades.'
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

revoke all on function public.create_units_batch(uuid, uuid, text[]) from public;
grant execute on function public.create_units_batch(uuid, uuid, text[]) to authenticated;

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
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode cadastrar moradores.'
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

  if not exists (select 1 from public.units where id = p_unit_id) then
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

revoke all on function public.create_unit_resident(uuid, text, text) from public;
grant execute on function public.create_unit_resident(uuid, text, text) to authenticated;

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
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode editar moradores.'
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

revoke all on function public.update_unit_resident(uuid, text, text) from public;
grant execute on function public.update_unit_resident(uuid, text, text) to authenticated;

create or replace function public.delete_unit_resident(p_resident_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode excluir moradores.'
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

revoke all on function public.delete_unit_resident(uuid) from public;
grant execute on function public.delete_unit_resident(uuid) to authenticated;

drop function if exists public.create_unit_residents_batch(uuid[], text[], text[]);

create or replace function public.delete_unit(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode excluir apartamentos.'
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

revoke all on function public.delete_unit(uuid) from public;
grant execute on function public.delete_unit(uuid) to authenticated;
