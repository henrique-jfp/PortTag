-- Quando o porteiro confirma que o destinatário é morador do apartamento,
-- cadastra o morador na unidade (public.unit_residents) se ele ainda não constar.
create or replace function public.create_package(
  p_condominium_id uuid,
  p_unit_id uuid,
  p_receipt_path text,
  p_sender text,
  p_delivery_person text,
  p_tracking_code text default null,
  p_resident_name text default null,
  p_recipient_is_resident boolean default false,
  p_is_damaged boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_damaged boolean := coalesce(p_is_damaged, false);
  v_unit_number text;
  v_block_id uuid;
  v_block_name text;
  v_resident_name text;
  v_received_at timestamptz := now();
  v_package_id uuid;
begin
  if v_user_id is null then
    raise exception 'Faça login para registrar uma encomenda.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null
    or p_unit_id is null
    or nullif(btrim(coalesce(p_delivery_person, '')), '') is null
  then
    raise exception 'Informe a unidade e o nome do entregador.'
      using errcode = '22023';
  end if;

  if v_is_damaged
    and nullif(btrim(coalesce(p_receipt_path, '')), '') is null
  then
    raise exception 'Tire a foto do volume avariado antes de confirmar.'
      using errcode = '22023';
  end if;

  if not v_is_damaged
    and nullif(btrim(coalesce(p_receipt_path, '')), '') is not null
  then
    raise exception 'A foto da etiqueta não é armazenada; marque a avaria para anexar uma foto do volume.'
      using errcode = '22023';
  end if;

  if p_recipient_is_resident
    and nullif(btrim(coalesce(p_resident_name, '')), '') is null
  then
    raise exception 'Informe o nome antes de confirmar que é morador.'
      using errcode = '22023';
  end if;

  if length(coalesce(p_resident_name, '')) > 120 then
    raise exception 'O nome do destinatário excede o limite permitido.'
      using errcode = '22023';
  end if;

  select u.unit_number, u.block_id, b.name
  into v_unit_number, v_block_id, v_block_name
  from public.units u
  left join public.blocks b on b.id = u.block_id
  where u.id = p_unit_id
    and u.condominium_id = p_condominium_id
    and u.status = 'active';

  if not found then
    raise exception 'A unidade não pertence ao condomínio ou está inativa.'
      using errcode = '22023';
  end if;

  if not public.can_access_condominium_block(
    p_condominium_id,
    v_block_id
  ) then
    raise exception 'Sua conta não tem acesso ao bloco desta unidade.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.condominiums
    where id = p_condominium_id
      and status = 'active'
  ) then
    raise exception 'Condomínio ativo não encontrado.'
      using errcode = 'P0002';
  end if;

  if v_is_damaged then
    if position(
      p_condominium_id::text || '/'
        || coalesce(v_block_id::text, 'no-block') || '/'
        || v_user_id::text
      in p_receipt_path
    ) <> 1 then
      raise exception 'O caminho da foto não pertence a esta conta e condomínio.'
        using errcode = '42501';
    end if;

    if not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'package-receipts'
        and o.name = p_receipt_path
        and o.owner_id = v_user_id::text
    ) then
      raise exception 'A foto da avaria não foi enviada para o armazenamento privado.'
        using errcode = '22023';
    end if;
  end if;

  v_resident_name := nullif(btrim(coalesce(p_resident_name, '')), '');
  if v_resident_name is null then
    select string_agg(nullif(btrim(ur.name), ''), ', ' order by ur.created_at)
    into v_resident_name
    from public.unit_residents ur
    where ur.unit_id = p_unit_id
      and nullif(btrim(ur.name), '') is not null;
  end if;

  -- Se confirmado que o destinatário é morador e ele ainda não consta na unidade,
  -- cadastra-o automaticamente no condomínio.
  if coalesce(p_recipient_is_resident, false) and v_resident_name is not null then
    if not exists (
      select 1
      from public.unit_residents ur
      where ur.unit_id = p_unit_id
        and lower(btrim(coalesce(ur.name, ''))) = lower(btrim(v_resident_name))
    ) then
      insert into public.unit_residents (
        unit_id,
        name,
        whatsapp,
        created_by
      ) values (
        p_unit_id,
        v_resident_name,
        null,
        v_user_id
      );
    end if;
  end if;

  insert into public.packages (
    condominium_id,
    unit_id,
    unit_number,
    block_id,
    block_name,
    resident_name,
    recipient_is_resident,
    sender,
    delivery_person,
    tracking_code,
    receipt_path,
    is_damaged,
    received_by,
    received_at,
    photo_expires_at
  )
  values (
    p_condominium_id,
    p_unit_id,
    v_unit_number,
    v_block_id,
    v_block_name,
    v_resident_name,
    coalesce(p_recipient_is_resident, false),
    nullif(btrim(p_sender), ''),
    nullif(btrim(p_delivery_person), ''),
    nullif(btrim(coalesce(p_tracking_code, '')), ''),
    p_receipt_path,
    v_is_damaged,
    v_user_id,
    v_received_at,
    v_received_at + interval '20 days'
  )
  returning id into v_package_id;

  return v_package_id;
end;
$$;

revoke all on function public.create_package(
  uuid, uuid, text, text, text, text, text, boolean, boolean
) from public;
grant execute on function public.create_package(
  uuid, uuid, text, text, text, text, text, boolean, boolean
) to authenticated;

notify pgrst, 'reload schema';
