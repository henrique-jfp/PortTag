-- "Zerar condomínio": apaga todo o movimento de um condomínio específico e
-- mantém o cadastro (nome, endereço, status e prazo de acesso).
--
-- Ao contrário de delete_condominium, esta RPC funciona mesmo com histórico de
-- encomendas: packages.condominium_id é ON DELETE RESTRICT, então as encomendas
-- são excluídas antes de qualquer outra coisa. As regras publicadas do Label
-- Lab (settings/rulesets/active_rules) são globais e não são tocadas.
--
-- Limitações explicitadas na interface: contas de login (auth.users/profiles)
-- e a instância externa da Evolution não são removidas; apenas os vínculos e a
-- linha local da instância. Registros anteriores da operação ficam em
-- condominium_reset_audit, inclusive quando o condomínio for excluído depois.

create table if not exists public.condominium_reset_audit (
  id bigint generated always as identity primary key,
  condominium_id uuid not null,
  condominium_name text not null,
  actor_id uuid,
  before_summary jsonb not null default '{}'::jsonb,
  after_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.condominium_reset_audit enable row level security;

drop policy if exists "Super admins can read condominium reset audit"
  on public.condominium_reset_audit;
create policy "Super admins can read condominium reset audit"
  on public.condominium_reset_audit
  for select
  to authenticated
  using ((select public.is_super_admin()));

revoke all on public.condominium_reset_audit from anon, authenticated;
grant select on public.condominium_reset_audit to authenticated;

-- Contadores usados pelo diálogo de confirmação do Super Admin.
create or replace function public.get_condominium_reset_preview(
  p_condominium_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode zerar condomínios.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null or not exists (
    select 1 from public.condominiums where id = p_condominium_id
  ) then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'packages', (
      select count(*) from public.packages
      where condominium_id = p_condominium_id
    ),
    'package_events', (
      select count(*) from public.package_events
      where condominium_id = p_condominium_id
    ),
    'package_notifications', (
      select count(*) from public.package_notifications
      where condominium_id = p_condominium_id
    ),
    'residents', (
      select count(*) from public.residents
      where condominium_id = p_condominium_id
    ),
    'unit_residents', (
      select count(*) from public.unit_residents ur
      join public.units u on u.id = ur.unit_id
      where u.condominium_id = p_condominium_id
    ),
    'units', (
      select count(*) from public.units
      where condominium_id = p_condominium_id
    ),
    'blocks', (
      select count(*) from public.blocks
      where condominium_id = p_condominium_id
    ),
    'porter_accounts', (
      select count(*) from public.porter_accounts
      where condominium_id = p_condominium_id
    ),
    'condominium_users', (
      select count(*) from public.condominium_users
      where condominium_id = p_condominium_id
    ),
    'whatsapp_instances', (
      select count(*) from public.condominium_whatsapp_instances
      where condominium_id = p_condominium_id
    ),
    'label_lab_samples', (
      select count(*) from public.label_lab_queue
      where condominium_id = p_condominium_id
    ),
    'storage_objects', (
      select count(*) from storage.objects
      where bucket_id in ('package-receipts', 'label-lab-private')
        and (storage.foldername(name))[1] = p_condominium_id::text
    )
  )
  into v_summary;

  return v_summary;
end;
$$;

revoke all on function public.get_condominium_reset_preview(uuid) from public;
revoke execute on function public.get_condominium_reset_preview(uuid) from anon;
grant execute on function public.get_condominium_reset_preview(uuid)
  to authenticated;

-- Execução: exige o nome exato do condomínio e o aceite explícito do aviso.
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

  -- Fotos primeiro: depois de apagadas as linhas, os caminhos não estão mais
  -- disponíveis para localizar os objetos nos buckets privados. O trigger
  -- storage.protect_delete() exige habilitar a exclusão no escopo da transação.
  perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects
  where bucket_id in ('package-receipts', 'label-lab-private')
    and (storage.foldername(name))[1] = p_condominium_id::text;

  perform pg_catalog.set_config('storage.allow_delete_query', 'false', true);

  -- Vínculo de avisos em lote (não tem condominium_id; as FKs também cascam).
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

  delete from public.package_events
  where condominium_id = p_condominium_id;

  -- Deve vir antes de unidades/blocos: packages.condominium_id é RESTRICT.
  delete from public.packages
  where condominium_id = p_condominium_id;

  delete from public.resident_units
  where condominium_id = p_condominium_id;

  delete from public.residents
  where condominium_id = p_condominium_id;

  -- unit_residents não tem condominium_id: o escopo vem da unidade.
  delete from public.unit_residents ur
  using public.units u
  where ur.unit_id = u.id
    and u.condominium_id = p_condominium_id;

  delete from public.operator_block_scopes
  where condominium_id = p_condominium_id;

  delete from public.porter_blocks pb
  using public.porter_accounts pa
  where pb.porter_account_id = pa.id
    and pa.condominium_id = p_condominium_id;

  delete from public.porter_accounts
  where condominium_id = p_condominium_id;

  -- units.block_id é RESTRICT, então unidades antes de blocos.
  delete from public.units
  where condominium_id = p_condominium_id;

  delete from public.blocks
  where condominium_id = p_condominium_id;

  delete from public.condominium_users
  where condominium_id = p_condominium_id;

  delete from public.condominium_whatsapp_instances
  where condominium_id = p_condominium_id;

  -- Auditoria de coleta das amostras; as regras publicadas ficam intactas.
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

revoke all on function public.reset_condominium_data(uuid, text, boolean)
  from public;
revoke execute on function public.reset_condominium_data(uuid, text, boolean)
  from anon;
grant execute on function public.reset_condominium_data(uuid, text, boolean)
  to authenticated;

notify pgrst, 'reload schema';
