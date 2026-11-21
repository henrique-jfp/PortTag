-- Retenção configurável do caderno e ajuste do "zerar condomínio".
--
-- O síndico define, por condomínio, quantos meses os registros do caderno
-- ficam disponíveis. A limpeza é definitiva e apaga pacote, eventos, avisos,
-- comprovantes e a foto da etiqueta. Estrutura (blocos, unidades, moradores,
-- portarias e porteiros) nunca é removida por esta rotina.

create or replace function public.cleanup_expired_notebook_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condominium record;
  v_cutoff timestamptz;
  v_paths text[];
  v_count integer;
  v_deleted integer := 0;
begin
  for v_condominium in
    select id, notebook_retention_months
    from public.condominiums
    where notebook_retention_months is not null
  loop
    v_cutoff := now() - make_interval(months => v_condominium.notebook_retention_months);

    select array_agg(p.receipt_path)
    into v_paths
    from public.packages p
    where p.condominium_id = v_condominium.id
      and p.received_at < v_cutoff
      and p.receipt_path is not null;

    if coalesce(array_length(v_paths, 1), 0) > 0 then
      perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
      delete from storage.objects
      where bucket_id = 'package-receipts'
        and name = any(v_paths);
      perform pg_catalog.set_config('storage.allow_delete_query', 'false', true);
    end if;

    delete from public.package_notification_packages pnp
    where pnp.notification_id in (
      select n.id from public.package_notifications n
      where n.condominium_id = v_condominium.id
        and n.created_at < v_cutoff
    )
    or pnp.package_id in (
      select p.id from public.packages p
      where p.condominium_id = v_condominium.id
        and p.received_at < v_cutoff
    );

    delete from public.package_notifications
    where condominium_id = v_condominium.id
      and created_at < v_cutoff;

    if to_regclass('public.package_reception_acknowledgements') is not null then
      delete from public.package_reception_acknowledgements
      where condominium_id = v_condominium.id
        and acknowledged_at < v_cutoff;
    end if;

    delete from public.package_events
    where condominium_id = v_condominium.id
      and occurred_at < v_cutoff;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted + v_count;

    delete from public.packages
    where condominium_id = v_condominium.id
      and received_at < v_cutoff;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted + v_count;
  end loop;

  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.cleanup_expired_notebook_records() from public;
-- Somente a Edge Function agendada (service_role) chama esta RPC.
grant execute on function public.cleanup_expired_notebook_records() to service_role;

-- Configuração feita pelo síndico (ou Super Admin). null = manter para sempre.
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

revoke all on function public.update_notebook_retention(uuid, integer) from public;
revoke execute on function public.update_notebook_retention(uuid, integer) from anon;
grant execute on function public.update_notebook_retention(uuid, integer) to authenticated;

-- "Zerar condomínio" continua apagando todo o movimento, mas agora também
-- remove as portarias e não tropeça em tabelas opcionais ausentes.
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

revoke all on function public.reset_condominium_data(uuid, text, boolean) from public;
revoke execute on function public.reset_condominium_data(uuid, text, boolean) from anon;
grant execute on function public.reset_condominium_data(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
