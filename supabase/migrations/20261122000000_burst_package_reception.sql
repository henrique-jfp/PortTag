-- Recebimento em rajada: cada volume é gravado na hora com um batch_id, fica
-- com aviso pendente na fila e só é agrupado em uma mensagem por apartamento
-- quando o porteiro finaliza o lote.
--
-- Nada aqui substitui a decisão determinística de endereço do app: o SQL apenas
-- registra o status lido e o aceite explícito do porteiro.

alter table public.packages
  add column if not exists batch_id uuid;

create index if not exists packages_batch_received_idx
  on public.packages (batch_id, received_at desc);

alter table public.package_notifications
  add column if not exists batch_id uuid,
  add column if not exists burst_group boolean not null default false;

create index if not exists package_notifications_batch_idx
  on public.package_notifications (batch_id, created_at desc);

-- "grouped" = aviso individual reservado no recebimento e substituído pela
-- mensagem consolidada do apartamento no fechamento do lote.
alter table public.package_notifications
  drop constraint if exists package_notifications_status_check;
alter table public.package_notifications
  add constraint package_notifications_status_check
  check (status in ('pending', 'manual', 'sent', 'failed', 'grouped'));

-- Grava um volume da rajada. Reaproveita create_package (validations, datas do
-- servidor e criação de morador) e só acrescenta o lote e a auditoria.
create or replace function public.create_burst_package(
  p_condominium_id uuid,
  p_unit_id uuid,
  p_receipt_path text,
  p_sender text,
  p_delivery_person text,
  p_batch_id uuid,
  p_tracking_code text default null,
  p_resident_name text default null,
  p_recipient_is_resident boolean default false,
  p_is_damaged boolean default false,
  p_address_status text default 'verified',
  p_duplicate_tracking boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_package_id uuid;
  v_condominium_id uuid;
  v_block_id uuid;
  v_address_status text := coalesce(p_address_status, 'verified');
begin
  if v_user_id is null then
    raise exception 'Faça login para registrar uma encomenda.'
      using errcode = '42501';
  end if;

  if p_batch_id is null then
    raise exception 'Identificador do lote não informado.'
      using errcode = '22023';
  end if;

  if v_address_status not in ('verified', 'mismatch', 'unknown') then
    raise exception 'Status de endereço inválido.'
      using errcode = '22023';
  end if;

  v_package_id := public.create_package(
    p_condominium_id,
    p_unit_id,
    p_receipt_path,
    p_sender,
    p_delivery_person,
    p_tracking_code,
    p_resident_name,
    p_recipient_is_resident,
    p_is_damaged
  );

  update public.packages
  set batch_id = p_batch_id
  where id = v_package_id;

  select p.condominium_id, p.block_id
  into v_condominium_id, v_block_id
  from public.packages p
  where p.id = v_package_id;

  if not public.can_access_condominium_block(v_condominium_id, v_block_id) then
    raise exception 'Sua conta não tem acesso a esta encomenda.'
      using errcode = '42501';
  end if;

  insert into public.package_reception_acknowledgements (
    package_id, condominium_id, acknowledged_by, address_status, duplicate_tracking
  ) values (
    v_package_id, v_condominium_id, v_user_id, v_address_status,
    coalesce(p_duplicate_tracking, false)
  );

  return v_package_id;
end;
$$;

revoke all on function public.create_burst_package(uuid, uuid, text, text, text, uuid, text, text, boolean, boolean, text, boolean) from public;
grant execute on function public.create_burst_package(uuid, uuid, text, text, text, uuid, text, text, boolean, boolean, text, boolean) to authenticated;

-- Reserva o aviso no ato do recebimento. Se o aparelho travar antes do
-- "Finalizar", o pacote e a pendência já estão no banco.
create or replace function public.register_burst_package_notification(
  p_package_id uuid,
  p_batch_id uuid
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
  v_has_auto_whatsapp boolean := false;
  v_channel text;
  v_status text;
  v_notification_id uuid;
  v_message text;
  v_existing_id uuid;
begin
  if v_user_id is null then
    raise exception 'Faça login para avisar o morador.' using errcode = '42501';
  end if;

  select p.* into v_package
  from public.packages p
  where p.id = p_package_id and p.batch_id = p_batch_id;

  if not found then
    raise exception 'Encomenda do lote não encontrada.' using errcode = 'P0002';
  end if;

  if v_package.status <> 'received'
    or not public.can_access_condominium_block(
      v_package.condominium_id, v_package.block_id
    ) then
    raise exception 'Sua conta não pode avisar esta encomenda.'
      using errcode = '42501';
  end if;

  select existing.id into v_existing_id
  from public.package_notifications existing
  where existing.package_id = p_package_id
    and existing.batch_id = p_batch_id
    and existing.status = 'pending'
    and existing.burst_group = false
  order by existing.created_at desc
  limit 1;

  if v_existing_id is not null then
    id := v_existing_id;
    channel := 'whatsapp_link';
    recipient := '';
    message := '';
    status := 'pending';
    return query select id, channel, recipient, message, status;
    return;
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

  select exists (
    select 1
    from public.condominium_whatsapp_instances cwi
    where cwi.condominium_id = v_package.condominium_id
      and cwi.status = 'connected'
  ) into v_has_auto_whatsapp;

  v_channel := case
    when v_has_auto_whatsapp and v_whatsapp is not null then 'whatsapp'
    else 'whatsapp_link'
  end;
  v_status := 'pending';

  v_message := 'Encomenda registrada na portaria do '
    || coalesce(v_condominium_name, 'condomínio')
    || '. O aviso completo será enviado ao finalizar o lote.';

  insert into public.package_notifications as new_notification (
    package_id, condominium_id, batch_id, channel, recipient, recipient_name,
    message, status, created_by
  ) values (
    v_package.id, v_package.condominium_id, p_batch_id, v_channel,
    coalesce(v_whatsapp, ''), v_recipient_name, v_message, v_status, v_user_id
  ) returning new_notification.id into v_notification_id;

  return query
  select v_notification_id, v_channel, coalesce(v_whatsapp, ''), v_message, v_status;
end;
$$;

revoke all on function public.register_burst_package_notification(uuid, uuid) from public;
grant execute on function public.register_burst_package_notification(uuid, uuid) to authenticated;

-- Corrige um volume já gravado (botão "Corrigir" da confirmação rápida).
-- Não mexe em received_at, retirada, foto ou condomínio.
create or replace function public.update_burst_package(
  p_package_id uuid,
  p_unit_id uuid,
  p_sender text,
  p_delivery_person text,
  p_tracking_code text,
  p_resident_name text,
  p_recipient_is_resident boolean,
  p_address_status text default 'mismatch'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_package public.packages%rowtype;
  v_unit_number text;
  v_block_id uuid;
  v_block_name text;
  v_address_status text := coalesce(p_address_status, 'mismatch');
  v_duplicate boolean := false;
begin
  if v_user_id is null then
    raise exception 'Faça login para corrigir a encomenda.'
      using errcode = '42501';
  end if;

  select p.* into v_package
  from public.packages p
  where p.id = p_package_id and p.batch_id is not null;

  if not found then
    raise exception 'Encomenda do lote não encontrada.' using errcode = 'P0002';
  end if;

  if v_package.status <> 'received'
    or not public.can_access_condominium_block(
      v_package.condominium_id, v_package.block_id
    ) then
    raise exception 'Sua conta não pode corrigir esta encomenda.'
      using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_delivery_person, '')), '') is null then
    raise exception 'Informe o entregador desta encomenda.'
      using errcode = '22023';
  end if;

  if v_address_status not in ('verified', 'mismatch', 'unknown') then
    raise exception 'Status de endereço inválido.'
      using errcode = '22023';
  end if;

  select u.unit_number, u.block_id, b.name
  into v_unit_number, v_block_id, v_block_name
  from public.units u
  left join public.blocks b on b.id = u.block_id
  where u.id = p_unit_id
    and u.condominium_id = v_package.condominium_id
    and u.status = 'active';

  if not found then
    raise exception 'Apartamento não encontrado neste condomínio.'
      using errcode = 'P0002';
  end if;

  if not public.can_access_condominium_block(
    v_package.condominium_id, v_block_id
  ) then
    raise exception 'Sua conta não pode usar este apartamento.'
      using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_tracking_code, '')), '') is not null then
    select exists (
      select 1
      from public.packages p
      where p.condominium_id = v_package.condominium_id
        and p.id <> p_package_id
        and lower(btrim(p.tracking_code)) = lower(btrim(p_tracking_code))
    ) into v_duplicate;
  end if;

  update public.packages p
  set
    unit_id = p_unit_id,
    unit_number = v_unit_number,
    block_id = v_block_id,
    block_name = v_block_name,
    sender = nullif(btrim(coalesce(p_sender, '')), ''),
    delivery_person = btrim(p_delivery_person),
    tracking_code = nullif(btrim(coalesce(p_tracking_code, '')), ''),
    resident_name = nullif(btrim(coalesce(p_resident_name, '')), ''),
    recipient_is_resident = coalesce(p_recipient_is_resident, false)
  where p.id = p_package_id;

  insert into public.package_reception_acknowledgements (
    package_id, condominium_id, acknowledged_by, address_status, duplicate_tracking
  ) values (
    p_package_id, v_package.condominium_id, v_user_id, v_address_status, v_duplicate
  );
end;
$$;

revoke all on function public.update_burst_package(uuid, uuid, text, text, text, text, boolean, text) from public;
grant execute on function public.update_burst_package(uuid, uuid, text, text, text, text, boolean, text) to authenticated;

-- Fechamento do lote: uma mensagem consolidada por apartamento, com o mesmo
-- critério de canal already usado no aviso em lote (Evolution conectada =
-- envio automático; senão link wa.me sem custo por mensagem).
create or replace function public.close_burst_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_condominium_id uuid;
  v_condominium_name text;
  v_porter_name text;
  v_auto_whatsapp boolean := false;
  v_channel text;
  v_status text;
  v_group record;
  v_whatsapp text;
  v_recipient_name text;
  v_carriers text;
  v_tracking_lines text;
  v_message text;
  v_notification_id uuid;
  v_total integer := 0;
  v_notified integer := 0;
  v_groups jsonb := '[]'::jsonb;
  v_without jsonb := '[]'::jsonb;
  v_existing jsonb;
begin
  if v_user_id is null then
    raise exception 'Faça login para finalizar o lote.'
      using errcode = '42501';
  end if;

  select p.condominium_id into v_condominium_id
  from public.packages p
  where p.batch_id = p_batch_id
  order by p.received_at
  limit 1;

  if v_condominium_id is null then
    raise exception 'Nenhuma encomenda foi registrada neste lote.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.packages p
    where p.batch_id = p_batch_id
      and (
        p.condominium_id <> v_condominium_id
        or p.status <> 'received'
        or not public.can_access_condominium_block(p.condominium_id, p.block_id)
      )
  ) then
    raise exception 'Sua conta não pode finalizar todas as encomendas deste lote.'
      using errcode = '42501';
  end if;

  -- Rechamada (por exemplo, depois de uma queda de rede) não duplica avisos.
  select jsonb_build_object(
    'totalPackages', (select count(*) from public.packages p where p.batch_id = p_batch_id),
    'unitsNotified', count(*),
    'unitsWithoutWhatsapp', '[]'::jsonb,
    'groups', coalesce(jsonb_agg(jsonb_build_object(
      'unitId', linked.unit_id,
      'unitLabel', linked.unit_label,
      'notificationId', linked.notification_id,
      'channel', linked.channel,
      'recipient', linked.recipient,
      'message', linked.message,
      'packageCount', linked.package_count,
      'status', linked.status
    )), '[]'::jsonb)
  ) into v_existing
  from (
    select
      n.id as notification_id,
      n.channel,
      n.recipient,
      n.message,
      n.status,
      p.unit_id,
      p.unit_number || case
        when nullif(btrim(coalesce(p.block_name, '')), '') is not null
          then ' (bloco ' || p.block_name || ')'
        else ''
      end as unit_label,
      count(distinct link.package_id)::integer as package_count
    from public.package_notifications n
    join public.package_notification_packages link on link.notification_id = n.id
    join public.packages p on p.id = link.package_id
    where n.batch_id = p_batch_id and n.burst_group
    group by n.id, n.channel, n.recipient, n.message, n.status,
      p.unit_id, p.unit_number, p.block_name
  ) as linked;

  if coalesce(v_existing -> 'unitsNotified', '0'::jsonb) <> '0'::jsonb then
    return v_existing;
  end if;

  select c.name into v_condominium_name
  from public.condominiums c
  where c.id = v_condominium_id;

  select nullif(btrim(pa.name), '') into v_porter_name
  from public.porter_accounts pa
  where pa.auth_user_id = v_user_id
    and pa.condominium_id = v_condominium_id
    and pa.active = true;

  select exists (
    select 1
    from public.condominium_whatsapp_instances cwi
    where cwi.condominium_id = v_condominium_id
      and cwi.status = 'connected'
  ) into v_auto_whatsapp;

  v_channel := case when v_auto_whatsapp then 'whatsapp' else 'whatsapp_link' end;
  v_status := case when v_auto_whatsapp then 'pending' else 'manual' end;

  select count(*) into v_total
  from public.packages p
  where p.batch_id = p_batch_id and p.status = 'received';

  for v_group in
    select
      p.unit_id,
      p.unit_number,
      p.block_name,
      array_agg(p.id order by p.received_at, p.id) as package_ids,
      count(*)::integer as package_count
    from public.packages p
    where p.batch_id = p_batch_id and p.status = 'received'
    group by p.unit_id, p.unit_number, p.block_name
    order by p.unit_number
  loop
    select
      public.normalize_whatsapp(ur.whatsapp),
      nullif(btrim(ur.name), '')
    into v_whatsapp, v_recipient_name
    from public.unit_residents ur
    where ur.unit_id = v_group.unit_id
      and public.normalize_whatsapp(ur.whatsapp) is not null
    order by ur.created_at
    limit 1;

    if v_whatsapp is null then
      v_without := v_without || jsonb_build_object(
        'unitId', v_group.unit_id,
        'unitLabel', v_group.unit_number || case
          when nullif(btrim(coalesce(v_group.block_name, '')), '') is not null
            then ' (bloco ' || v_group.block_name || ')'
          else ''
        end,
        'packageCount', v_group.package_count
      );
      continue;
    end if;

    select string_agg(carrier, ', ' order by carrier)
    into v_carriers
    from (
      select distinct coalesce(
        nullif(btrim(coalesce(p.sender, '')), ''), 'Não informada'
      ) as carrier
      from public.packages p
      where p.id = any(v_group.package_ids)
    ) as carriers;

    select string_agg(
      '- ' || coalesce(
        nullif(btrim(coalesce(p.tracking_code, '')), ''),
        'Sem código de rastreio'
      ), E'\n' order by p.received_at, p.id
    )
    into v_tracking_lines
    from public.packages p
    where p.id = any(v_group.package_ids);

    v_message := '📦 Chegaram ' || v_group.package_count || ' encomenda'
      || case when v_group.package_count = 1 then '' else 's' end
      || ' para o apartamento ' || v_group.unit_number
      || case
        when nullif(btrim(coalesce(v_group.block_name, '')), '') is not null
          then ' (bloco ' || v_group.block_name || ')'
        else ''
      end || E'\n\n'
      || case
        when v_recipient_name is not null then 'Olá, ' || v_recipient_name || '!'
        else 'Olá!'
      end || E'\n'
      || 'Empresas: ' || coalesce(v_carriers, 'Não informada') || E'\n\n'
      || '📋 Rastreios:' || E'\n' || v_tracking_lines || E'\n\n'
      || case
        when v_porter_name is not null
          then 'Recebidas na portaria pelo porteiro ' || v_porter_name || '.'
        else 'Recebidas na portaria.'
      end
      || E'\nRetire quando puder.\n\nAtenciosamente,\nPortaria do '
      || coalesce(v_condominium_name, 'Condomínio') || ' 🏢';

    insert into public.package_notifications as new_notification (
      package_id, condominium_id, batch_id, burst_group, channel, recipient,
      recipient_name, message, status, created_by, sent_at
    ) values (
      v_group.package_ids[1], v_condominium_id, p_batch_id, true, v_channel,
      v_whatsapp, v_recipient_name, v_message, v_status, v_user_id,
      case when v_status = 'manual' then now() else null end
    ) returning new_notification.id into v_notification_id;

    insert into public.package_notification_packages (notification_id, package_id)
    select v_notification_id, grouped_package_id
    from unnest(v_group.package_ids) as grouped(grouped_package_id);

    update public.package_notifications pending
    set status = 'grouped'
    where pending.batch_id = p_batch_id
      and pending.burst_group = false
      and pending.package_id = any(v_group.package_ids)
      and pending.status = 'pending';

    if v_status = 'manual' then
      update public.packages p
      set last_notified_at = now()
      where p.id = any(v_group.package_ids);
    end if;

    v_notified := v_notified + 1;
    v_groups := v_groups || jsonb_build_object(
      'unitId', v_group.unit_id,
      'unitLabel', v_group.unit_number || case
        when nullif(btrim(coalesce(v_group.block_name, '')), '') is not null
          then ' (bloco ' || v_group.block_name || ')'
        else ''
      end,
      'notificationId', v_notification_id,
      'channel', v_channel,
      'recipient', v_whatsapp,
      'message', v_message,
      'packageCount', v_group.package_count,
      'status', v_status
    );
  end loop;

  return jsonb_build_object(
    'totalPackages', v_total,
    'unitsNotified', v_notified,
    'unitsWithoutWhatsapp', v_without,
    'groups', v_groups
  );
end;
$$;

revoke all on function public.close_burst_batch(uuid) from public;
grant execute on function public.close_burst_batch(uuid) to authenticated;

notify pgrst, 'reload schema';
