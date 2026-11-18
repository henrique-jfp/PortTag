-- O aviso ao morador passa a dizer quem recebeu a encomenda na portaria, o
-- código de rastreio e que o volume já está disponível para retirada. O texto
-- continua sendo montado no servidor; o cliente apenas abre o link wa.me.
create or replace function public.register_package_notification(
  p_package_id uuid
)
returns table (
  id uuid,
  channel text,
  recipient text,
  message text,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_package public.packages%rowtype;
  v_condominium_name text;
  v_porter_name text;
  v_whatsapp text;
  v_recipient_name text;
  v_message text;
  v_notification_id uuid;
begin
  if v_user_id is null then
    raise exception 'Faça login para avisar o morador.'
      using errcode = '42501';
  end if;

  select p.* into v_package
  from public.packages p
  where p.id = p_package_id;

  if not found then
    raise exception 'Encomenda não encontrada.'
      using errcode = 'P0002';
  end if;

  if v_package.status <> 'received' then
    raise exception 'Esta encomenda já foi retirada.'
      using errcode = '22023';
  end if;

  if not public.can_access_condominium_block(
    v_package.condominium_id,
    v_package.block_id
  ) then
    raise exception 'Sua conta não tem acesso a esta encomenda.'
      using errcode = '42501';
  end if;

  select c.name into v_condominium_name
  from public.condominiums c
  where c.id = v_package.condominium_id;

  -- Nome de quem recebeu do entregador, gravado em packages.received_by.
  select nullif(btrim(pa.name), '') into v_porter_name
  from public.porter_accounts pa
  where pa.auth_user_id = v_package.received_by
    and pa.condominium_id = v_package.condominium_id;

  select
    public.normalize_whatsapp(ur.whatsapp),
    nullif(btrim(ur.name), '')
  into v_whatsapp, v_recipient_name
  from public.unit_residents ur
  where ur.unit_id = v_package.unit_id
    and public.normalize_whatsapp(ur.whatsapp) is not null
  order by ur.created_at
  limit 1;

  if v_whatsapp is null then
    raise exception 'Nenhum WhatsApp cadastrado para este apartamento. Cadastre o contato do morador para enviar o aviso.'
      using errcode = 'P0002';
  end if;

  v_message := 'Olá' ||
    case
      when v_recipient_name is not null then ', ' || v_recipient_name
      else ''
    end ||
    '! Sua encomenda para o apartamento ' || v_package.unit_number ||
    case
      when v_package.block_name is not null
        then ' (bloco ' || v_package.block_name || ')'
      else ''
    end ||
    ' chegou na portaria do ' || coalesce(v_condominium_name, 'condomínio') ||
    ' e já pode ser retirada.' ||
    case
      when v_package.tracking_code is not null
        then E'\nRastreio: ' || v_package.tracking_code || '.'
      else ''
    end ||
    case
      when v_porter_name is not null
        then E'\nRecebido por ' || v_porter_name || '.'
      else ''
    end;

  insert into public.package_notifications as new_notification (
    package_id,
    condominium_id,
    channel,
    recipient,
    recipient_name,
    message,
    status,
    created_by,
    sent_at
  )
  values (
    v_package.id,
    v_package.condominium_id,
    'whatsapp_link',
    v_whatsapp,
    v_recipient_name,
    v_message,
    'manual',
    v_user_id,
    now()
  )
  returning new_notification.id into v_notification_id;

  update public.packages as p
  set last_notified_at = now()
  where p.id = v_package.id;

  return query
    select
      v_notification_id,
      'whatsapp_link'::text,
      v_whatsapp,
      v_message,
      'manual'::text;
end;
$$;

revoke all on function public.register_package_notification(uuid) from public;
grant execute on function public.register_package_notification(uuid)
  to authenticated;

notify pgrst, 'reload schema';
