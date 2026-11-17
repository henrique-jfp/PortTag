-- Aviso ao morador: fila de notificações com canal plugável.
--
-- O canal inicial (`whatsapp_link`) não usa API nem custo por mensagem: o
-- servidor registra o aviso no caderno e devolve o texto pronto, que o
-- porteiro envia pelo WhatsApp da portaria por um link wa.me. Canais
-- automáticos (Cloud API, SMS, e-mail, push) entram depois na mesma fila
-- sem alterar o restante do produto.

alter table public.packages
  add column if not exists last_notified_at timestamptz;

create table if not exists public.package_notifications (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null
    references public.packages (id) on delete cascade,
  condominium_id uuid not null
    references public.condominiums (id) on delete cascade,
  channel text not null default 'whatsapp_link'
    check (channel in ('whatsapp_link', 'whatsapp', 'sms', 'email', 'push')),
  recipient text not null,
  recipient_name text,
  message text not null,
  status text not null default 'manual'
    check (status in ('pending', 'manual', 'sent', 'failed')),
  provider_message_id text,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists package_notifications_package_idx
  on public.package_notifications (package_id, created_at desc);

create index if not exists package_notifications_condominium_idx
  on public.package_notifications (condominium_id, created_at desc);

alter table public.package_notifications enable row level security;

drop policy if exists "Staff can read package notifications"
  on public.package_notifications;
create policy "Staff can read package notifications"
  on public.package_notifications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.packages p
      where p.id = package_notifications.package_id
        and (select public.can_access_condominium_block(
          p.condominium_id,
          p.block_id
        ))
    )
  );

revoke insert, update, delete on public.package_notifications
  from anon, authenticated;
grant select on public.package_notifications to authenticated;

-- Normaliza o WhatsApp cadastrado para o formato aceito pelo wa.me:
-- somente dígitos, com o código do país (55) na frente.
create or replace function public.normalize_whatsapp(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(digits) < 10 or length(digits) > 13 then null
    when length(digits) in (10, 11) then '55' || digits
    when left(digits, 2) = '55' then digits
    else null
  end
  from (
    select regexp_replace(
      regexp_replace(coalesce(p_value, ''), '\D', '', 'g'),
      '^0',
      ''
    ) as digits
  ) as normalized;
$$;

revoke all on function public.normalize_whatsapp(text) from public;
grant execute on function public.normalize_whatsapp(text) to authenticated;

-- Registra o aviso e devolve o destinatário e o texto. O texto é montado no
-- servidor para não depender da versão do app aberta no aparelho.
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
    '! Chegou uma encomenda para o apartamento ' || v_package.unit_number ||
    case
      when v_package.block_name is not null
        then ' (bloco ' || v_package.block_name || ')'
      else ''
    end ||
    ' na portaria do ' || coalesce(v_condominium_name, 'condomínio') || '.' ||
    case
      when v_package.sender is not null
        then E'\nEmpresa: ' || v_package.sender || '.'
      else ''
    end ||
    case
      when v_package.tracking_code is not null
        then E'\nRastreio: ' || v_package.tracking_code || '.'
      else ''
    end ||
    E'\nRetire na portaria quando puder.';

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
