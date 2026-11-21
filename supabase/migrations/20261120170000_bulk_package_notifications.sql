-- Um único aviso por apartamento para os pacotes registrados no mesmo lote.
-- O vínculo preserva quais volumes foram incluídos para atualizar o caderno
-- inteiro após o envio automático e manter o histórico de cada pacote.

create table if not exists public.package_notification_packages (
  notification_id uuid not null
    references public.package_notifications (id) on delete cascade,
  package_id uuid not null
    references public.packages (id) on delete cascade,
  primary key (notification_id, package_id)
);

create index if not exists package_notification_packages_package_idx
  on public.package_notification_packages (package_id, notification_id);

alter table public.package_notification_packages enable row level security;

drop policy if exists "Staff can read notification package links"
  on public.package_notification_packages;
create policy "Staff can read notification package links"
  on public.package_notification_packages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.packages p
      where p.id = package_notification_packages.package_id
        and public.can_access_condominium_block(p.condominium_id, p.block_id)
    )
  );

revoke insert, update, delete on public.package_notification_packages
  from anon, authenticated;
grant select on public.package_notification_packages to authenticated;

create or replace function public.register_bulk_package_notifications(
  p_package_ids uuid[],
  p_force_manual boolean default false
)
returns table (
  id uuid,
  unit_id uuid,
  unit_label text,
  package_ids uuid[],
  channel text,
  recipient text,
  message text,
  status text,
  skipped_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_condominium_id uuid;
  v_condominium_name text;
  v_porter_name text;
  v_group record;
  v_whatsapp text;
  v_recipient_name text;
  v_tracking_lines text;
  v_message text;
  v_notification_id uuid;
  v_has_auto_whatsapp boolean := false;
  v_target_channel text;
  v_target_status text;
begin
  if v_user_id is null then
    raise exception 'Faça login para avisar os moradores.' using errcode = '42501';
  end if;

  if coalesce(array_length(p_package_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos uma encomenda para avisar.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_package_ids) as requested(package_id)
    left join public.packages p on p.id = requested.package_id
    where p.id is null
  ) then
    raise exception 'Uma das encomendas selecionadas não foi encontrada.' using errcode = 'P0002';
  end if;

  select p.condominium_id into v_condominium_id
  from public.packages p
  where p.id = p_package_ids[1];

  if exists (
    select 1
    from public.packages p
    where p.id = any(p_package_ids)
      and p.condominium_id is distinct from v_condominium_id
  ) then
    raise exception 'As encomendas precisam pertencer ao mesmo condomínio.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.packages p
    where p.id = any(p_package_ids)
      and (
        p.status <> 'received'
        or not public.can_access_condominium_block(p.condominium_id, p.block_id)
      )
  ) then
    raise exception 'Sua conta não pode avisar uma das encomendas selecionadas.' using errcode = '42501';
  end if;

  select c.name into v_condominium_name
  from public.condominiums c
  where c.id = v_condominium_id;

  select nullif(btrim(pa.name), '') into v_porter_name
  from public.porter_accounts pa
  where pa.auth_user_id = v_user_id
    and pa.condominium_id = v_condominium_id
    and pa.active = true;

  if not coalesce(p_force_manual, false) then
    select exists (
      select 1
      from public.condominium_whatsapp_instances cwi
      where cwi.condominium_id = v_condominium_id
        and cwi.status = 'connected'
    ) into v_has_auto_whatsapp;
  end if;

  v_target_channel := case when v_has_auto_whatsapp then 'whatsapp' else 'whatsapp_link' end;
  v_target_status := case when v_has_auto_whatsapp then 'pending' else 'manual' end;

  for v_group in
    select
      p.unit_id,
      p.unit_number,
      p.block_name,
      array_agg(p.id order by p.received_at, p.id) as package_ids,
      count(*)::integer as package_count,
      bool_or(p.last_notified_at is not null) as has_previous_notification
    from public.packages p
    where p.id = any(p_package_ids)
    group by p.unit_id, p.unit_number, p.block_name
  loop
    unit_id := v_group.unit_id;
    unit_label := v_group.unit_number || case
      when nullif(btrim(coalesce(v_group.block_name, '')), '') is not null
        then ' (bloco ' || v_group.block_name || ')'
      else ''
    end;
    package_ids := v_group.package_ids;

    if v_group.has_previous_notification then
      id := null;
      channel := null;
      recipient := null;
      message := null;
      status := 'skipped';
      skipped_reason := 'Este apartamento já foi avisado para um dos pacotes deste lote.';
      return next;
      continue;
    end if;

    select public.normalize_whatsapp(ur.whatsapp), nullif(btrim(ur.name), '')
    into v_whatsapp, v_recipient_name
    from public.unit_residents ur
    where ur.unit_id = v_group.unit_id
      and public.normalize_whatsapp(ur.whatsapp) is not null
    order by ur.created_at
    limit 1;

    if v_whatsapp is null then
      id := null;
      channel := null;
      recipient := null;
      message := null;
      status := 'skipped';
      skipped_reason := 'Nenhum WhatsApp cadastrado para este apartamento.';
      return next;
      continue;
    end if;

    select string_agg(
      '- ' || coalesce(nullif(btrim(coalesce(p.tracking_code, '')), ''), 'Sem código de rastreio informado'),
      E'\n' order by p.received_at, p.id
    ) into v_tracking_lines
    from public.packages p
    where p.id = any(v_group.package_ids);

    v_message := '📦 Aviso de recebimento de encomendas' || E'\n\n' ||
      case when v_recipient_name is not null then 'Olá, ' || v_recipient_name || '!' else 'Olá!' end || E'\n\n' ||
      'Recebemos ' || v_group.package_count || ' encomenda' ||
      case when v_group.package_count = 1 then '' else 's' end ||
      ' destinada' || case when v_group.package_count = 1 then '' else 's' end ||
      ' ao apartamento ' || unit_label ||
      case
        when v_porter_name is not null then ' pelo porteiro ' || v_porter_name || '.'
        else ' pela portaria.'
      end || E'\n\n' ||
      '📋 Códigos de rastreio:' || E'\n' || v_tracking_lines || E'\n\n' ||
      'As encomendas estão disponíveis para retirada na portaria.' || E'\n\n' ||
      'Atenciosamente,' || E'\nPortaria do ' || coalesce(v_condominium_name, 'Condomínio') || ' 🏢';

    insert into public.package_notifications as new_notification (
      package_id, condominium_id, channel, recipient, recipient_name, message,
      status, created_by, sent_at
    ) values (
      v_group.package_ids[1], v_condominium_id, v_target_channel, v_whatsapp,
      v_recipient_name, v_message, v_target_status, v_user_id,
      case when v_target_status = 'manual' then now() else null end
    ) returning new_notification.id into v_notification_id;

    insert into public.package_notification_packages (notification_id, package_id)
    select v_notification_id, grouped_package_id
    from unnest(v_group.package_ids) as grouped(grouped_package_id);

    insert into public.package_events (
      package_id, condominium_id, event_type, description, actor_id, occurred_at, metadata
    )
    select
      grouped_package_id, v_condominium_id, 'notification',
      'Aviso em lote preparado para ' || coalesce(v_recipient_name, v_whatsapp),
      v_user_id, now(), jsonb_build_object('notification_id', v_notification_id, 'package_count', v_group.package_count)
    from unnest(v_group.package_ids[2:]) as grouped(grouped_package_id);

    if v_target_status = 'manual' then
      update public.packages p
      set last_notified_at = now()
      where p.id = any(v_group.package_ids);
    end if;

    id := v_notification_id;
    channel := v_target_channel;
    recipient := v_whatsapp;
    message := v_message;
    status := v_target_status;
    skipped_reason := null;
    return next;
  end loop;
end;
$$;

revoke all on function public.register_bulk_package_notifications(uuid[], boolean) from public;
grant execute on function public.register_bulk_package_notifications(uuid[], boolean)
  to authenticated;

notify pgrst, 'reload schema';
