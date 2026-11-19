-- Instâncias de WhatsApp da Evolution API e Notificações Automáticas com Fallback Manual.
--
-- Cada condomínio pode ter sua própria instância na Evolution API (1 número por condomínio).
-- Quando o condomínio tiver uma instância conectada, as notificações são criadas
-- com canal 'whatsapp' e status 'pending', sendo disparadas via Edge Function.
-- Se o condomínio não tiver WhatsApp conectado ou se for solicitado envio manual,
-- o sistema faz o fallback automático para o canal 'whatsapp_link' (wa.me manual).

create table if not exists public.condominium_whatsapp_instances (
  condominium_id uuid primary key
    references public.condominiums (id) on delete cascade,
  instance_name text not null unique,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connecting', 'connected')),
  phone_number text,
  qr_code text,
  updated_at timestamptz not null default now()
);

alter table public.condominium_whatsapp_instances enable row level security;

drop policy if exists "Staff can read condominium whatsapp instances"
  on public.condominium_whatsapp_instances;
create policy "Staff can read condominium whatsapp instances"
  on public.condominium_whatsapp_instances
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(condominium_id))
    or exists (
      select 1
      from public.porter_accounts pa
      where pa.auth_user_id = (select auth.uid())
        and pa.condominium_id = condominium_whatsapp_instances.condominium_id
        and pa.active = true
    )
  );

revoke insert, update, delete on public.condominium_whatsapp_instances
  from anon, authenticated;
grant select on public.condominium_whatsapp_instances to authenticated;

-- Registra o aviso com roteamento inteligente: se a portaria possui WhatsApp automático
-- conectado e não foi forçado envio manual, agenda como 'whatsapp' ('pending').
-- Caso contrário, devolve 'whatsapp_link' ('manual') pronto para o wa.me.
create or replace function public.register_package_notification(
  p_package_id uuid,
  p_force_manual boolean default false
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
  v_has_auto_whatsapp boolean := false;
  v_target_channel text := 'whatsapp_link';
  v_target_status text := 'manual';
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

  -- Nome de quem recebeu do entregador
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

  -- Checa se o condomínio tem WhatsApp conectado na Evolution API
  if not coalesce(p_force_manual, false) then
    select exists (
      select 1
      from public.condominium_whatsapp_instances cwi
      where cwi.condominium_id = v_package.condominium_id
        and cwi.status = 'connected'
    ) into v_has_auto_whatsapp;
  end if;

  if v_has_auto_whatsapp then
    v_target_channel := 'whatsapp';
    v_target_status := 'pending';
  else
    v_target_channel := 'whatsapp_link';
    v_target_status := 'manual';
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
    v_target_channel,
    v_whatsapp,
    v_recipient_name,
    v_message,
    v_target_status,
    v_user_id,
    case when v_target_status = 'manual' then now() else null end
  )
  returning new_notification.id into v_notification_id;

  update public.packages as p
  set last_notified_at = now()
  where p.id = v_package.id;

  return query
    select
      v_notification_id,
      v_target_channel,
      v_whatsapp,
      v_message,
      v_target_status;
end;
$$;

revoke all on function public.register_package_notification(uuid, boolean) from public;
grant execute on function public.register_package_notification(uuid, boolean)
  to authenticated;

-- Função auxiliar para o backend atualizar o status do envio automático
create or replace function public.update_package_notification_status(
  p_notification_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.package_notifications
  set
    status = p_status,
    provider_message_id = coalesce(p_provider_message_id, provider_message_id),
    error = p_error,
    sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_notification_id;
end;
$$;

revoke all on function public.update_package_notification_status(uuid, text, text, text) from public;
grant execute on function public.update_package_notification_status(uuid, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
