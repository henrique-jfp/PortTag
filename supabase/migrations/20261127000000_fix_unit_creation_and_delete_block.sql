-- Unidades sem bloco são permitidas mesmo em condomínios que usam blocos:
-- a tela já oferece "Sem bloco" e a importação segue a mesma regra. As RPCs
-- de cadastro deixam de exigir bloco quando block_count > 0; apenas validam
-- o bloco informado, quando ele existe.
--
-- Também adiciona uma RPC para excluir um bloco criado por engano. A exclusão
-- é bloqueada enquanto houver unidades ou encomendas vinculadas, para não
-- apagar histórico de cadastro nem deixar referências órfãs.

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

  if not exists (
    select 1
    from public.condominiums c
    where c.id = p_condominium_id
  ) then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  if p_block_id is not null
    and not exists (
      select 1
      from public.blocks b
      where b.id = p_block_id
        and b.condominium_id = p_condominium_id
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
begin
  select u.condominium_id
  into v_condominium_id
  from public.units u
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

  if p_block_id is not null
    and not exists (
      select 1
      from public.blocks b
      where b.id = p_block_id
        and b.condominium_id = v_condominium_id
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

  if not exists (
    select 1
    from public.condominiums c
    where c.id = p_condominium_id
  ) then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  if p_block_id is not null
    and not exists (
      select 1
      from public.blocks b
      where b.id = p_block_id
        and b.condominium_id = p_condominium_id
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

create or replace function public.delete_condominium_block(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_condominium_id uuid;
  v_units integer;
  v_packages integer;
begin
  select b.condominium_id
  into v_condominium_id
  from public.blocks b
  where b.id = p_block_id;

  if not found then
    raise exception 'Bloco não encontrado.'
      using errcode = 'P0002';
  end if;

  if v_user_id is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(v_condominium_id))
  ) then
    raise exception 'Sem permissão para excluir blocos neste condomínio.'
      using errcode = '42501';
  end if;

  select count(*)::integer
  into v_units
  from public.units u
  where u.block_id = p_block_id;

  if v_units > 0 then
    raise exception 'Não foi possível excluir o bloco: ele ainda tem % unidade(s). Exclua ou mova as unidades antes.', v_units
      using errcode = '23000';
  end if;

  select count(*)::integer
  into v_packages
  from public.packages p
  where p.block_id = p_block_id;

  if v_packages > 0 then
    raise exception 'Não foi possível excluir o bloco: ele ainda tem % encomenda(s) vinculada(s).', v_packages
      using errcode = '23000';
  end if;

  delete from public.blocks b
  where b.id = p_block_id;
end;
$$;

revoke all on function public.create_unit(uuid, uuid, text) from public;
revoke all on function public.update_unit(uuid, uuid, text, text) from public;
revoke all on function public.create_units_batch(uuid, uuid, text[]) from public;
revoke all on function public.delete_condominium_block(uuid) from public;
revoke execute on function public.delete_condominium_block(uuid) from anon;

grant execute on function public.create_unit(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.update_unit(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.create_units_batch(uuid, uuid, text[]) to authenticated, service_role;
grant execute on function public.delete_condominium_block(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
