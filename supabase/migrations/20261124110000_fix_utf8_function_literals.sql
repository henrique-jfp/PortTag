-- Corrige literais que chegaram ao banco com U+FFFD quando algumas migrations
-- antigas foram aplicadas com codificação incorreta. O separador do relatório
-- "Por unidade" voltou a ser "·" (meio-ponto), e mensagens como "Não informado"
-- e "Sem permissão" voltam ao acento correto. Nenhuma regra ou assinatura muda:
-- apenas a redefinição fiel das últimas versões já versionadas.

create or replace function public.ensure_condominium_portarias(
  p_condominium_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_has_any boolean;
begin
  select operation_mode into v_mode
  from public.condominiums
  where id = p_condominium_id;

  if not found then
    return;
  end if;

  select exists (
    select 1 from public.portarias where condominium_id = p_condominium_id
  ) into v_has_any;

  if v_mode = 'per_block' then
    insert into public.portarias (condominium_id, block_id, name)
    select p_condominium_id, b.id, 'Portaria ' || b.name
    from public.blocks b
    where b.condominium_id = p_condominium_id
      and not exists (
        select 1 from public.portarias g
        where g.condominium_id = p_condominium_id
          and g.block_id = b.id
      )
    on conflict (condominium_id, name) do nothing;

    -- Enquanto o condomínio não tem blocos, mantemos uma portaria provisória
    -- para que o cadastro de porteiros continue funcionando.
    if not v_has_any then
      insert into public.portarias (condominium_id, block_id, name)
      select p_condominium_id, null, 'Portaria Central'
      where not exists (
        select 1 from public.portarias where condominium_id = p_condominium_id
      );
    else
      -- Se as portarias por bloco já existem, a provisória sai de cena,
      -- desde que nenhum porteiro esteja vinculado a ela.
      delete from public.portarias g
      where g.condominium_id = p_condominium_id
        and g.block_id is null
        and exists (
          select 1 from public.portarias gb
          where gb.condominium_id = p_condominium_id
            and gb.block_id is not null
        )
        and not exists (
          select 1 from public.porter_accounts pa
          where pa.home_portaria_id = g.id
             or pa.current_portaria_id = g.id
        );
    end if;
  else
    -- single e central: um único caderno, com gavetas por bloco no central.
    insert into public.portarias (condominium_id, block_id, name)
    select p_condominium_id, null, 'Portaria Central'
    where not exists (
      select 1 from public.portarias g
      where g.condominium_id = p_condominium_id
        and g.block_id is null
    )
    on conflict (condominium_id, name) do nothing;

    -- Portarias de bloco que sobraram de um modelo anterior não aparecem mais,
    -- desde que nenhum porteiro ainda esteja vinculado a elas.
    update public.portarias g
    set active = false
    where g.condominium_id = p_condominium_id
      and g.block_id is not null
      and not exists (
        select 1 from public.porter_accounts pa
        where pa.home_portaria_id = g.id
           or pa.current_portaria_id = g.id
      );
  end if;
end;
$$;

create or replace function public.create_condominium(
  p_name text,
  p_cep text,
  p_street text,
  p_address_number text,
  p_complement text,
  p_neighborhood text,
  p_city text,
  p_state text,
  p_has_blocks boolean,
  p_block_count integer,
  p_initial_block_name text,
  p_access_duration text,
  p_operation_mode text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_condominium_id uuid;
  v_access_expires_at timestamptz;
  v_mode text;
begin
  if v_user_id is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode cadastrar condomínios.'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_name), '') is null
    or nullif(btrim(p_cep), '') is null
    or nullif(btrim(p_street), '') is null
    or nullif(btrim(p_address_number), '') is null
    or nullif(btrim(p_neighborhood), '') is null
    or nullif(btrim(p_city), '') is null
    or coalesce(length(btrim(p_state)), 0) <> 2
    or p_has_blocks is null
    or (
      p_has_blocks
      and (
        coalesce(p_block_count, 0) < 1
        or nullif(btrim(p_initial_block_name), '') is null
      )
    )
  then
    raise exception 'Informe os dados obrigatórios do condomínio.'
      using errcode = '22023';
  end if;

  if p_access_duration is null
    or p_access_duration not in ('7d', '14d', '1m', '3m', '6m', '1y', 'none') then
    raise exception 'Escolha um prazo de acesso válido: 7 dias, 14 dias, 1 mês, 3 meses, 6 meses, 1 ano ou sem expiração.'
      using errcode = '22023';
  end if;

  v_mode := coalesce(
    nullif(btrim(coalesce(p_operation_mode, '')), ''),
    case when p_has_blocks then 'per_block' else 'single' end
  );
  if v_mode not in ('single', 'central', 'per_block') then
    raise exception 'Modelo de operação inválido.'
      using errcode = '22023';
  end if;
  v_access_expires_at := case p_access_duration
    when '7d' then now() + make_interval(days => 7)
    when '14d' then now() + make_interval(days => 14)
    when '1m' then now() + make_interval(months => 1)
    when '3m' then now() + make_interval(months => 3)
    when '6m' then now() + make_interval(months => 6)
    when '1y' then now() + make_interval(months => 12)
    else null
  end;

  insert into public.condominiums (
    name, cep, street, number, complement, neighborhood, city, state,
    block_count, operation_mode, access_duration, access_expires_at, created_by
  )
  values (
    btrim(p_name), btrim(p_cep), btrim(p_street), btrim(p_address_number),
    nullif(btrim(p_complement), ''), btrim(p_neighborhood), btrim(p_city),
    upper(btrim(p_state)),
    case when p_has_blocks then p_block_count else 0 end,
    v_mode,
    p_access_duration,
    v_access_expires_at,
    v_user_id
  )
  returning id into v_condominium_id;

  if p_has_blocks then
    insert into public.blocks (condominium_id, name, created_by)
    values (v_condominium_id, btrim(p_initial_block_name), v_user_id);
  end if;

  return v_condominium_id;
end;
$$;

create or replace function public.update_condominium_operation(
  p_condominium_id uuid,
  p_operation_mode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_central_id uuid;
begin
  if auth.uid() is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(p_condominium_id))
  ) then
    raise exception 'Sem permissão para alterar este condomínio.'
      using errcode = '42501';
  end if;

  v_mode := nullif(btrim(coalesce(p_operation_mode, '')), '');
  if v_mode is null or v_mode not in ('single', 'central', 'per_block') then
    raise exception 'Modelo de operação inválido.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.condominiums where id = p_condominium_id
  ) then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  update public.condominiums
  set operation_mode = v_mode
  where id = p_condominium_id;

  -- O trigger de condomínios cria/ajusta as portarias automaticamente.
  if v_mode in ('single', 'central') then
    select g.id into v_central_id
    from public.portarias g
    where g.condominium_id = p_condominium_id
      and g.block_id is null
    order by g.active desc, g.created_at
    limit 1;

    if v_central_id is not null then
      update public.porter_accounts pa
      set home_portaria_id = v_central_id,
          current_portaria_id = v_central_id
      where pa.condominium_id = p_condominium_id;
    end if;
  else
    -- Voltando a portaria por bloco, cada porteiro volta para a portaria do
    -- primeiro bloco em que trabalhava. Sem bloco vinculado, mantém a origem.
    update public.porter_accounts pa
    set home_portaria_id = coalesce((
          select g.id
          from public.porter_blocks pb
          join public.portarias g
            on g.condominium_id = pa.condominium_id
           and g.block_id = pb.block_id
          where pb.porter_account_id = pa.id
          order by g.id
          limit 1
        ), pa.home_portaria_id),
        current_portaria_id = coalesce((
          select g.id
          from public.porter_blocks pb
          join public.portarias g
            on g.condominium_id = pa.condominium_id
           and g.block_id = pb.block_id
          where pb.porter_account_id = pa.id
          order by g.id
          limit 1
        ), pa.current_portaria_id)
    where pa.condominium_id = p_condominium_id;
  end if;
end;
$$;

create or replace function public.update_notebook_retention(
  p_condominium_id uuid,
  p_retention_months integer
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
    raise exception 'Sem permissão para alterar este condomínio.'
      using errcode = '42501';
  end if;

  if p_retention_months is not null and p_retention_months <= 0 then
    raise exception 'O prazo deve ser um número de meses maior que zero.'
      using errcode = '22023';
  end if;

  update public.condominiums
  set notebook_retention_months = p_retention_months
  where id = p_condominium_id;

  if not found then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.reset_condominium_data(
  p_condominium_id uuid,
  p_confirmation_name text,
  p_ack boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode zerar condomínios.'
      using errcode = '42501';
  end if;

  select c.name into v_name
  from public.condominiums c
  where c.id = p_condominium_id;

  if not found then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  if btrim(v_name) is distinct from btrim(coalesce(p_confirmation_name, '')) then
    raise exception 'O nome digitado não confere com o nome do condomínio.'
      using errcode = '22023';
  end if;

  if p_ack is distinct from true then
    raise exception 'Confirme que entende que a operação é irreversível.'
      using errcode = '22023';
  end if;

  v_before := public.get_condominium_reset_preview(p_condominium_id);

  perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
  where bucket_id in ('package-receipts', 'label-lab-private')
    and (storage.foldername(name))[1] = p_condominium_id::text;
  perform pg_catalog.set_config('storage.allow_delete_query', 'false', true);

  delete from public.package_notification_packages pnp
  where pnp.notification_id in (
    select n.id from public.package_notifications n
    where n.condominium_id = p_condominium_id
  )
  or pnp.package_id in (
    select p.id from public.packages p
    where p.condominium_id = p_condominium_id
  );

  delete from public.package_notifications
  where condominium_id = p_condominium_id;

  if to_regclass('public.package_reception_acknowledgements') is not null then
    delete from public.package_reception_acknowledgements
    where condominium_id = p_condominium_id;
  end if;

  delete from public.package_events
  where condominium_id = p_condominium_id;

  delete from public.packages
  where condominium_id = p_condominium_id;

  delete from public.resident_units
  where condominium_id = p_condominium_id;

  delete from public.residents
  where condominium_id = p_condominium_id;

  delete from public.unit_residents ur
  using public.units u
  where ur.unit_id = u.id
    and u.condominium_id = p_condominium_id;

  if to_regclass('public.operator_block_scopes') is not null then
    delete from public.operator_block_scopes
    where condominium_id = p_condominium_id;
  end if;

  delete from public.porter_blocks pb
  using public.porter_accounts pa
  where pb.porter_account_id = pa.id
    and pa.condominium_id = p_condominium_id;

  delete from public.porter_accounts
  where condominium_id = p_condominium_id;

  delete from public.units
  where condominium_id = p_condominium_id;

  delete from public.blocks
  where condominium_id = p_condominium_id;

  -- Portarias referenciam blocos (CASCADE) e porteiros (RESTRICT); neste ponto
  -- os porteiros já foram removidos, então a exclusão é segura.
  delete from public.portarias
  where condominium_id = p_condominium_id;

  delete from public.condominium_users
  where condominium_id = p_condominium_id;

  delete from public.condominium_whatsapp_instances
  where condominium_id = p_condominium_id;

  delete from public.label_lab_audit
  where condominium_id = p_condominium_id;

  delete from public.label_lab_queue
  where condominium_id = p_condominium_id;

  v_after := public.get_condominium_reset_preview(p_condominium_id);

  insert into public.condominium_reset_audit (
    condominium_id,
    condominium_name,
    actor_id,
    before_summary,
    after_summary
  )
  values (
    p_condominium_id,
    v_name,
    auth.uid(),
    v_before,
    v_after
  );

  return v_before;
end;
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
  v_floor_label text;
  v_name text;
  v_whatsapp text;
  v_email text;
  v_notes text;
  v_digits text;
  v_row_block_id uuid;
  v_unit_id uuid;
  v_created_block_id uuid;
  v_created_block_ids uuid[] := '{}';
  v_blocks_created integer := 0;
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

    if jsonb_typeof(v_row -> 'floor_label') not in ('string', 'null') then
      raise exception 'O andar de cada linha deve ser um texto.'
        using errcode = '22023';
    end if;
    v_floor_label := nullif(btrim(coalesce(v_row ->> 'floor_label', '')), '');

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

    if jsonb_typeof(v_row -> 'email') not in ('string', 'null') then
      raise exception 'O e-mail de cada linha deve ser um texto.'
        using errcode = '22023';
    end if;
    v_email := nullif(btrim(coalesce(v_row ->> 'email', '')), '');

    if jsonb_typeof(v_row -> 'notes') not in ('string', 'null') then
      raise exception 'As observações de cada linha devem ser um texto.'
        using errcode = '22023';
    end if;
    v_notes := nullif(btrim(coalesce(v_row ->> 'notes', '')), '');

    v_row_block_id := null;
    if v_block_name is not null then
      select b.id into v_row_block_id
      from public.blocks b
      where b.condominium_id = p_condominium_id
        and lower(b.name) = lower(v_block_name);

      if v_row_block_id is null then
        insert into public.blocks (condominium_id, name, created_by)
        values (p_condominium_id, v_block_name, v_user_id)
        returning id into v_created_block_id;

        v_row_block_id := v_created_block_id;
        v_created_block_ids := array_append(v_created_block_ids, v_created_block_id);
        v_blocks_created := v_blocks_created + 1;
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

      insert into public.units (condominium_id, block_id, unit_number, floor_label, created_by)
      values (p_condominium_id, v_row_block_id, v_unit_number, v_floor_label, v_user_id)
      returning id into v_unit_id;
      v_units_created := v_units_created + 1;
    elsif v_floor_label is not null then
      update public.units u
      set floor_label = v_floor_label
      where u.id = v_unit_id
        and u.floor_label is null;
    end if;

    if v_name is not null
      or v_whatsapp is not null
      or v_email is not null
      or v_notes is not null
    then
      v_digits := regexp_replace(coalesce(v_whatsapp, ''), '[^0-9]', '', 'g');
      if exists (
        select 1
        from public.unit_residents ur
        where ur.unit_id = v_unit_id
          and lower(btrim(coalesce(ur.name, ''))) = lower(coalesce(v_name, ''))
          and regexp_replace(coalesce(ur.whatsapp, ''), '[^0-9]', '', 'g') = v_digits
          and lower(btrim(coalesce(ur.email, ''))) = lower(coalesce(v_email, ''))
          and lower(btrim(coalesce(ur.notes, ''))) = lower(coalesce(v_notes, ''))
      ) then
        v_duplicates_skipped := v_duplicates_skipped + 1;
      else
        insert into public.unit_residents (unit_id, name, whatsapp, email, notes, created_by)
        values (v_unit_id, v_name, v_whatsapp, v_email, v_notes, v_user_id);
        v_residents_created := v_residents_created + 1;
      end if;
    end if;
  end loop;

  if v_blocks_created > 0 then
    update public.condominiums c
    set block_count = greatest(
      c.block_count,
      (select count(*) from public.blocks b where b.condominium_id = c.id)
    )
    where c.id = p_condominium_id;

    insert into public.porter_blocks (porter_account_id, block_id)
    select pa.id, created_block.id
    from public.porter_accounts pa
    cross join unnest(v_created_block_ids) as created_block(id)
    where pa.condominium_id = p_condominium_id
      and pa.active
      and not exists (
        select 1
        from public.porter_blocks pb
        where pb.porter_account_id = pa.id
      )
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'blocks_created', v_blocks_created,
    'units_created', v_units_created,
    'residents_created', v_residents_created,
    'duplicates_skipped', v_duplicates_skipped
  );
end;
$$;

create or replace function public.create_packages_batch(
  p_condominium_id uuid,
  p_items jsonb
)
returns table (
  item_index integer,
  package_id uuid,
  error_message text,
  duplicate_unit_number text,
  duplicate_block_name text,
  duplicate_received_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_index integer;
  v_item jsonb;
  v_unit_id uuid;
  v_tracking text;
  v_allow_duplicate boolean;
  v_address_acknowledged boolean;
  v_address_status text;
  v_package_id uuid;
  v_duplicate_found boolean;
  v_duplicate_unit text;
  v_duplicate_block text;
  v_duplicate_received timestamptz;
begin
  if v_user_id is null then
    raise exception 'Faça login para registrar encomendas.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null then
    raise exception 'Informe o condomínio.'
      using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Lote de encomendas inválido.'
      using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count = 0 then
    return;
  end if;

  if v_count > 50 then
    raise exception 'Envie no máximo 50 encomendas por lote.'
      using errcode = '22023';
  end if;

  for v_index in 0 .. v_count - 1 loop
    v_item := p_items -> v_index;

    item_index := v_index;
    package_id := null;
    error_message := null;
    duplicate_unit_number := null;
    duplicate_block_name := null;
    duplicate_received_at := null;

    v_unit_id := null;
    begin
      v_unit_id := nullif(btrim(coalesce(v_item ->> 'unit_id', '')), '')::uuid;
    exception when others then
      v_unit_id := null;
    end;

    v_tracking := nullif(btrim(coalesce(v_item ->> 'tracking_code', '')), '');
    v_allow_duplicate := coalesce(
      (v_item ->> 'allow_duplicate')::boolean,
      false
    );
    v_address_acknowledged := coalesce(
      (v_item ->> 'address_acknowledged')::boolean,
      false
    );
    v_address_status := coalesce(
      nullif(btrim(coalesce(v_item ->> 'address_status', '')), ''),
      'unknown'
    );

    if v_address_status not in ('verified', 'mismatch', 'unknown') then
      v_address_status := 'unknown';
    end if;

    if v_unit_id is null then
      error_message := 'Selecione o apartamento desta encomenda.';
      return next;
      continue;
    end if;

    v_duplicate_found := false;
    if v_tracking is not null then
      select p.unit_number, p.block_name, p.received_at
      into v_duplicate_unit, v_duplicate_block, v_duplicate_received
      from public.packages p
      where p.condominium_id = p_condominium_id
        and p.tracking_code is not null
        and lower(p.tracking_code) = lower(v_tracking)
        and (select public.can_access_condominium_block(
          p.condominium_id,
          p.block_id
        ))
      order by p.received_at desc
      limit 1;

      v_duplicate_found := found;
    end if;

    if v_duplicate_found and not v_allow_duplicate then
      duplicate_unit_number := v_duplicate_unit;
      duplicate_block_name := v_duplicate_block;
      duplicate_received_at := v_duplicate_received;
      return next;
      continue;
    end if;

    begin
      v_package_id := public.create_package(
        p_condominium_id,
        v_unit_id,
        null,
        coalesce(v_item ->> 'sender', ''),
        coalesce(v_item ->> 'delivery_person', ''),
        v_tracking,
        nullif(btrim(coalesce(v_item ->> 'resident_name', '')), ''),
        coalesce((v_item ->> 'recipient_is_resident')::boolean, false),
        false
      );
      package_id := v_package_id;
    exception when others then
      package_id := null;
      error_message := sqlerrm;
    end;

    if package_id is not null
      and (v_address_acknowledged or v_duplicate_found)
    then
      begin
        insert into public.package_reception_acknowledgements (
          package_id,
          condominium_id,
          acknowledged_by,
          address_status,
          duplicate_tracking
        ) values (
          package_id,
          p_condominium_id,
          v_user_id,
          v_address_status,
          v_duplicate_found
        );
      exception when others then
        -- A auditoria do aceite não pode derrubar o recebimento já gravado.
        null;
      end;
    end if;

    return next;
  end loop;
end;
$$;

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

notify pgrst, 'reload schema';
