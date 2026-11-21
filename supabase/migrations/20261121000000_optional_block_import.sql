-- Unidades importadas podem ficar sem bloco mesmo em condomínios que usam
-- blocos. O bloco continua opcional na planilha e a RPC não exige mais um
-- bloco padrão para as linhas sem ele. Porteiros com acesso a qualquer bloco
-- também passam a ver as unidades sem bloco, para continuar recebendo
-- encomendas nessas unidades.

create or replace function public.can_access_condominium_block(
  p_condominium_id uuid,
  p_block_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.is_super_admin())
    or (
      public.condominium_access_is_active(p_condominium_id)
      and exists (
        select 1
        from public.condominium_users cu
        join public.condominiums c on c.id = cu.condominium_id
        where cu.condominium_id = p_condominium_id
          and cu.user_id = (select auth.uid())
          and cu.status = 'active'
          and (
            cu.role = 'admin'
            or (
              cu.role = 'operator'
              and exists (
                select 1
                from public.porter_accounts pa
                where pa.auth_user_id = cu.user_id
                  and pa.condominium_id = cu.condominium_id
                  and pa.active
                  and (
                    pa.access_expires_at is null
                    or pa.access_expires_at > now()
                  )
                  and (
                    (c.block_count = 0 and p_block_id is null)
                    or (
                      p_block_id is null
                      and exists (
                        select 1
                        from public.porter_blocks pb
                        where pb.porter_account_id = pa.id
                      )
                    )
                    or exists (
                      select 1
                      from public.porter_blocks pb
                      where pb.porter_account_id = pa.id
                        and pb.block_id = p_block_id
                    )
                  )
              )
            )
          )
      )
    );
$$;

create or replace function public.import_condominium_residents(
  p_condominium_id uuid,
  p_block_id uuid,
  p_create_missing_units boolean,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row jsonb;
  v_unit_number text;
  v_block_name text;
  v_name text;
  v_whatsapp text;
  v_digits text;
  v_row_block_id uuid;
  v_unit_id uuid;
  v_units_created integer := 0;
  v_residents_created integer := 0;
  v_duplicates_skipped integer := 0;
begin
  if v_user_id is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(p_condominium_id))
  ) then
    raise exception 'Sem permissão para importar moradores neste condomínio.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.condominiums c
    where c.id = p_condominium_id
  ) then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  if p_block_id is not null then
    if not exists (
      select 1
      from public.blocks b
      where b.id = p_block_id
        and b.condominium_id = p_condominium_id
    ) then
      raise exception 'Selecione um bloco pertencente ao condomínio.'
        using errcode = '22023';
    end if;
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Informe a lista de moradores para importar.'
      using errcode = '22023';
  end if;

  for v_row in
    select item.value from jsonb_array_elements(p_rows) as item(value)
  loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Cada linha da planilha deve ser um objeto.'
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_row -> 'unit_number') <> 'string' then
      raise exception 'Informe o número da unidade em todas as linhas.'
        using errcode = '22023';
    end if;
    v_unit_number := nullif(btrim(v_row ->> 'unit_number'), '');
    if v_unit_number is null then
      raise exception 'Informe o número da unidade em todas as linhas.'
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_row -> 'block_name') not in ('string', 'null') then
      raise exception 'O bloco de cada linha deve ser um texto.'
        using errcode = '22023';
    end if;
    v_block_name := nullif(btrim(coalesce(v_row ->> 'block_name', '')), '');

    if jsonb_typeof(v_row -> 'name') not in ('string', 'null') then
      raise exception 'O nome de cada linha deve ser um texto.'
        using errcode = '22023';
    end if;
    v_name := nullif(btrim(coalesce(v_row ->> 'name', '')), '');

    if jsonb_typeof(v_row -> 'whatsapp') not in ('string', 'null') then
      raise exception 'O WhatsApp de cada linha deve ser um texto.'
        using errcode = '22023';
    end if;
    v_whatsapp := nullif(btrim(coalesce(v_row ->> 'whatsapp', '')), '');

    v_row_block_id := null;
    if v_block_name is not null then
      select b.id into v_row_block_id
      from public.blocks b
      where b.condominium_id = p_condominium_id
        and lower(b.name) = lower(v_block_name);
      if v_row_block_id is null then
        raise exception 'Bloco "%" não encontrado neste condomínio.', v_block_name
          using errcode = '22023';
      end if;
    else
      v_row_block_id := p_block_id;
    end if;

    select u.id into v_unit_id
    from public.units u
    where u.condominium_id = p_condominium_id
      and u.block_id is not distinct from v_row_block_id
      and lower(u.unit_number) = lower(v_unit_number)
    limit 1;

    if v_unit_id is null then
      if not coalesce(p_create_missing_units, false) then
        raise exception 'A unidade % não está cadastrada. Marque a opção para criar unidades ausentes.', v_unit_number
          using errcode = '22023';
      end if;

      insert into public.units (condominium_id, block_id, unit_number, created_by)
      values (p_condominium_id, v_row_block_id, v_unit_number, v_user_id)
      returning id into v_unit_id;
      v_units_created := v_units_created + 1;
    end if;

    if v_name is not null or v_whatsapp is not null then
      v_digits := regexp_replace(coalesce(v_whatsapp, ''), '[^0-9]', '', 'g');
      if exists (
        select 1
        from public.unit_residents ur
        where ur.unit_id = v_unit_id
          and lower(btrim(coalesce(ur.name, ''))) = lower(coalesce(v_name, ''))
          and regexp_replace(coalesce(ur.whatsapp, ''), '[^0-9]', '', 'g') = v_digits
      ) then
        v_duplicates_skipped := v_duplicates_skipped + 1;
      else
        insert into public.unit_residents (unit_id, name, whatsapp, created_by)
        values (v_unit_id, v_name, v_whatsapp, v_user_id);
        v_residents_created := v_residents_created + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'units_created', v_units_created,
    'residents_created', v_residents_created,
    'duplicates_skipped', v_duplicates_skipped
  );
end;
$$;

revoke all on function public.import_condominium_residents(uuid, uuid, boolean, jsonb) from public;
revoke execute on function public.import_condominium_residents(uuid, uuid, boolean, jsonb) from anon;
grant execute on function public.import_condominium_residents(uuid, uuid, boolean, jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';
