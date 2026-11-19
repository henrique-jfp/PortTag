-- Central de Inteligência de Etiquetas: editor, regressão e publicação.
--
-- Esta migration complementa a coleta invisível sem alterar as decisões do
-- recebimento. Nenhuma regra publicada aqui mexe em CEP, logradouro ou número:
-- o editor só aceita carrier, tracking_code, unit_number e recipient_name.
-- A publicação exige confirmação explícita, regressão verde e exclusão das
-- fotos/OCR identificável usados como origem.

alter table public.label_lab_audit
  drop constraint if exists label_lab_audit_action_check;
alter table public.label_lab_audit
  add constraint label_lab_audit_action_check
  check (action in (
    'collected', 'manual_collected', 'analysis_started', 'analyzed',
    'analysis_failed', 'settings_updated', 'deleted', 'sample_discarded',
    'ruleset_saved', 'regression_tested', 'ruleset_approved',
    'ruleset_published'
  ));

create table if not exists public.label_lab_rulesets (
  id uuid primary key default gen_random_uuid(),
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'published', 'superseded')),
  name text not null check (length(btrim(name)) between 3 and 120),
  description text not null default '',
  rules jsonb not null default '{}'::jsonb,
  regression jsonb not null default '{}'::jsonb,
  artifact jsonb,
  checksum text,
  source_sample_ids uuid[] not null default '{}'::uuid[],
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  published_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint label_lab_rulesets_version_key unique (version)
);

create index if not exists label_lab_rulesets_status_idx
  on public.label_lab_rulesets (status, version desc);

drop trigger if exists label_lab_rulesets_set_updated_at
  on public.label_lab_rulesets;
create trigger label_lab_rulesets_set_updated_at
  before update on public.label_lab_rulesets
  for each row execute function public.set_label_lab_updated_at();

alter table public.label_lab_rulesets enable row level security;

drop policy if exists "Super Admin can read Label Lab rulesets"
  on public.label_lab_rulesets;
create policy "Super Admin can read Label Lab rulesets"
  on public.label_lab_rulesets
  for select
  to authenticated
  using ((select public.is_super_admin()));

revoke all on public.label_lab_rulesets from anon, authenticated;
grant select on public.label_lab_rulesets to authenticated;

-- Todas as RPCs aceitam p_actor para o worker administrativo (service_role)
-- auditar o usuário real. Quando chamadas diretas pelo frontend, o ator é
-- sempre substituído por auth.uid(), impedindo personificação.
create or replace function public.enqueue_label_lab_manual_sample(
  p_id uuid,
  p_actor uuid,
  p_condominium_id uuid,
  p_storage_path text,
  p_image_sha256 text,
  p_mime_type text,
  p_image_bytes integer,
  p_analysis jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := case when (select auth.role()) = 'service_role'
    then p_actor else (select auth.uid()) end;
  v_settings public.label_lab_settings%rowtype;
  v_fields jsonb := coalesce(p_analysis -> 'fields', '{}'::jsonb);
  v_diagnostics jsonb := coalesce(p_analysis -> 'diagnostics', '{}'::jsonb);
  v_result_id uuid;
begin
  if v_actor is null
    or not exists (
      select 1 from public.profiles pr
      where pr.id = v_actor and pr.is_super_admin
    )
  then
    raise exception 'Somente o Super Admin pode importar amostras.'
      using errcode = '42501';
  end if;

  select * into v_settings from public.label_lab_settings where id = true;

  if p_id is null
    or p_condominium_id is null
    or not exists (
      select 1 from public.condominiums c where c.id = p_condominium_id
    )
    or p_storage_path is null or length(btrim(p_storage_path)) = 0
    or p_image_sha256 is null
    or not (p_image_sha256 ~ '^[0-9a-f]{64}$')
    or p_mime_type is null
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_image_bytes is null
    or p_image_bytes <= 0
    or p_image_bytes > 2800000
    or coalesce(jsonb_typeof(p_analysis), '') <> 'object'
    or coalesce(p_analysis ->> 'ok', '') <> 'true'
  then
    raise exception 'Amostra manual inválida.'
      using errcode = '22023';
  end if;

  insert into public.label_lab_queue (
    id, condominium_id, storage_path, image_sha256, mime_type, image_bytes,
    reasons, carrier_detected, tracking_code, ocr_text, parsed_result,
    confidence_status, analysis, status, expires_at, created_by
  )
  values (
    p_id, p_condominium_id, left(btrim(p_storage_path), 300), p_image_sha256,
    p_mime_type, p_image_bytes, array['manual-import'],
    nullif(left(btrim(coalesce(v_fields ->> 'carrier', '')), 80), ''),
    nullif(regexp_replace(left(btrim(coalesce(v_fields ->> 'tracking_code', '')), 80), '\s', '', 'g'), ''),
    nullif(left(btrim(coalesce(p_analysis ->> 'ocrText', '')), 3000), ''),
    jsonb_build_object(
      'recipient_name', nullif(left(btrim(coalesce(v_fields ->> 'recipient_name', '')), 120), ''),
      'unit_number', nullif(left(btrim(coalesce(v_fields ->> 'unit_number', '')), 30), ''),
      'block_name', nullif(left(btrim(coalesce(v_fields ->> 'block_name', '')), 40), ''),
      'carrier', nullif(left(btrim(coalesce(v_fields ->> 'carrier', '')), 60), ''),
      'tracking_code', nullif(regexp_replace(left(btrim(coalesce(v_fields ->> 'tracking_code', '')), 80), '\s', '', 'g'), ''),
      'address_status', case
        when coalesce(v_fields ->> 'address_status', '') in ('verified', 'mismatch', 'unknown')
        then v_fields ->> 'address_status' else 'unknown' end
    ),
    jsonb_build_object(
      'engine', nullif(left(btrim(coalesce(v_diagnostics ->> 'engine', '')), 60), ''),
      'ocr_chars', coalesce((v_diagnostics ->> 'ocrChars')::integer, 0),
      'ai_error', nullif(left(btrim(coalesce(v_diagnostics ->> 'aiError', '')), 240), '')
    ),
    p_analysis,
    'analyzed',
    now() + make_interval(days => v_settings.processing_retention_days),
    v_actor
  )
  on conflict (condominium_id, image_sha256) where deleted_at is null
  do nothing
  returning id into v_result_id;

  if v_result_id is not null then
    insert into public.label_lab_audit (sample_id, condominium_id, action, actor, details)
    values (
      v_result_id, p_condominium_id, 'manual_collected', v_actor,
      jsonb_build_object(
        'mime_type', p_mime_type,
        'image_bytes', p_image_bytes,
        'source', 'super_admin_import'
      )
    );
    return v_result_id;
  end if;

  select q.id into v_result_id
  from public.label_lab_queue q
  where q.condominium_id = p_condominium_id
    and q.image_sha256 = p_image_sha256
    and q.deleted_at is null;

  return v_result_id;
end;
$$;

revoke all on function public.enqueue_label_lab_manual_sample(
  uuid, uuid, uuid, text, text, text, integer, jsonb
) from public;
grant execute on function public.enqueue_label_lab_manual_sample(
  uuid, uuid, uuid, text, text, text, integer, jsonb
) to authenticated, service_role;

create or replace function public.discard_label_lab_sample(
  p_sample_id uuid,
  p_actor uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := case when (select auth.role()) = 'service_role'
    then p_actor else (select auth.uid()) end;
  v_path text;
  v_condominium_id uuid;
begin
  if v_actor is null
    or not exists (
      select 1 from public.profiles pr
      where pr.id = v_actor and pr.is_super_admin
    )
  then
    raise exception 'Somente o Super Admin pode descartar amostras.'
      using errcode = '42501';
  end if;

  select q.storage_path, q.condominium_id
  into v_path, v_condominium_id
  from public.label_lab_queue q
  where q.id = p_sample_id and q.deleted_at is null
  for update;

  if v_path is null then
    return false;
  end if;

  delete from storage.objects
  where bucket_id = 'label-lab-private' and name = v_path;

  update public.label_lab_queue q
  set status = 'deleted',
      ocr_text = null,
      analysis = null,
      parsed_result = '{}'::jsonb,
      confidence_status = '{}'::jsonb,
      deleted_at = now()
  where q.id = p_sample_id;

  insert into public.label_lab_audit (sample_id, condominium_id, action, actor, details)
  values (p_sample_id, v_condominium_id, 'sample_discarded', v_actor, '{}'::jsonb);

  return true;
end;
$$;

revoke all on function public.discard_label_lab_sample(uuid, uuid) from public;
grant execute on function public.discard_label_lab_sample(uuid, uuid)
  to authenticated, service_role;

-- Consome as amostras usadas por um rascunho. Chamado sempre por funções que
-- já validaram o Super Admin e a confirmação explícita.
create or replace function public.purge_label_lab_samples_for_ruleset(
  p_ruleset_id uuid,
  p_status text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruleset public.label_lab_rulesets%rowtype;
  v_sample_ids uuid[];
  v_paths text[];
begin
  if p_status <> 'published' then
    raise exception 'Status de consumo inválido.' using errcode = '22023';
  end if;

  select * into v_ruleset
  from public.label_lab_rulesets r
  where r.id = p_ruleset_id;

  if not found then
    return 0;
  end if;

  select array_agg(distinct ref.sample_id) into v_sample_ids
  from (
    select unnest(v_ruleset.source_sample_ids) as sample_id
    union
    select nullif(item ->> 'sampleId', '')::uuid
    from jsonb_array_elements(
      case when jsonb_typeof(v_ruleset.regression -> 'cases') = 'array'
        then v_ruleset.regression -> 'cases' else '[]'::jsonb end
    ) as regression_cases(item)
    where jsonb_typeof(item -> 'sampleId') = 'string'
  ) as ref
  where ref.sample_id is not null;

  v_sample_ids := coalesce(v_sample_ids, '{}'::uuid[]);
  if coalesce(array_length(v_sample_ids, 1), 0) = 0 then
    return 0;
  end if;

  select array_agg(q.storage_path) into v_paths
  from public.label_lab_queue q
  where q.id = any(v_sample_ids) and q.deleted_at is null;

  if coalesce(array_length(v_paths, 1), 0) > 0 then
    delete from storage.objects
    where bucket_id = 'label-lab-private' and name = any(v_paths);
  end if;

  update public.label_lab_queue q
  set status = p_status,
      ocr_text = null,
      analysis = null,
      parsed_result = '{}'::jsonb,
      confidence_status = '{}'::jsonb,
      deleted_at = now()
  where q.id = any(v_sample_ids) and q.deleted_at is null;

  return coalesce(array_length(v_paths, 1), 0);
end;
$$;

-- Uso exclusivo interno: as RPCs guardiãs chamam esta função já como definer.
revoke all on function public.purge_label_lab_samples_for_ruleset(uuid, text) from public;

create or replace function public.save_label_lab_ruleset(
  p_ruleset_id uuid,
  p_actor uuid,
  p_name text,
  p_description text,
  p_rules jsonb,
  p_regression jsonb,
  p_source_sample_ids uuid[]
)
returns public.label_lab_rulesets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := case when (select auth.role()) = 'service_role'
    then p_actor else (select auth.uid()) end;
  v_allowed_fields text[] := array[
    'carrier', 'tracking_code', 'unit_number', 'recipient_name'
  ];
  v_current public.label_lab_rulesets%rowtype;
  v_result public.label_lab_rulesets%rowtype;
  v_version integer;
  v_new_id uuid;
  v_total integer;
  v_passed integer;
  v_failed integer;
begin
  if v_actor is null
    or not exists (
      select 1 from public.profiles pr
      where pr.id = v_actor and pr.is_super_admin
    )
  then
    raise exception 'Somente o Super Admin pode editar regras.'
      using errcode = '42501';
  end if;

  if p_name is null or length(btrim(p_name)) < 3 or length(p_name) > 120
    or coalesce(jsonb_typeof(p_rules), '') <> 'object'
    or coalesce(jsonb_typeof(p_regression), '') <> 'object'
    or exists (
      select 1 from jsonb_object_keys(p_rules) as field(key)
      where field.key <> all(v_allowed_fields)
    )
  then
    raise exception 'Rascunho de regras inválido.'
      using errcode = '22023';
  end if;

  v_total := nullif(p_regression ->> 'total', '')::integer;
  v_passed := nullif(p_regression ->> 'passed', '')::integer;
  v_failed := nullif(p_regression ->> 'failed', '')::integer;
  if v_total is null or v_passed is null or v_failed is null
    or v_total < 0 or v_passed < 0 or v_failed < 0
    or v_passed + v_failed <> v_total
  then
    raise exception 'Resumo de regressão inválido.'
      using errcode = '22023';
  end if;

  if coalesce(array_length(p_source_sample_ids, 1), 0) > 50 then
    raise exception 'Muitas amostras de origem.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('label_lab_rulesets'));

  if p_ruleset_id is not null then
    select * into v_current
    from public.label_lab_rulesets r
    where r.id = p_ruleset_id;

    if not found then
      raise exception 'Rascunho não encontrado.' using errcode = '22023';
    end if;
    if v_current.status in ('published', 'superseded') then
      raise exception 'Versão publicada não pode ser editada. Crie uma nova versão.'
        using errcode = '22023';
    end if;
  end if;

  update public.label_lab_rulesets r
  set status = 'draft',
      name = btrim(p_name),
      description = left(coalesce(p_description, ''), 1000),
      rules = p_rules,
      regression = p_regression,
      source_sample_ids = coalesce(p_source_sample_ids, '{}'::uuid[]),
      approved_by = null,
      approved_at = null,
      artifact = null,
      checksum = null,
      created_by = coalesce(r.created_by, v_actor)
  where r.id = p_ruleset_id
  returning * into v_result;

  if found then
    insert into public.label_lab_audit (action, actor, details)
    values (
      case when v_total = 0 then 'ruleset_saved' else 'regression_tested' end,
      v_actor,
      jsonb_build_object(
        'ruleset_id', v_result.id,
        'version', v_result.version,
        'passed', v_passed,
        'failed', v_failed
      )
    );
    return v_result;
  end if;

  select coalesce(max(r.version), 0) + 1 into v_version
  from public.label_lab_rulesets r;

  insert into public.label_lab_rulesets (
    version, status, name, description, rules, regression,
    source_sample_ids, created_by
  )
  values (
    v_version, 'draft', btrim(p_name), left(coalesce(p_description, ''), 1000),
    p_rules, p_regression, coalesce(p_source_sample_ids, '{}'::uuid[]), v_actor
  )
  returning * into v_result;

  insert into public.label_lab_audit (action, actor, details)
  values (
    case when v_total = 0 then 'ruleset_saved' else 'regression_tested' end,
    v_actor,
    jsonb_build_object(
      'ruleset_id', v_result.id,
      'version', v_result.version,
      'passed', v_passed,
      'failed', v_failed
    )
  );

  return v_result;
end;
$$;

revoke all on function public.save_label_lab_ruleset(
  uuid, uuid, text, text, jsonb, jsonb, uuid[]
) from public;
grant execute on function public.save_label_lab_ruleset(
  uuid, uuid, text, text, jsonb, jsonb, uuid[]
) to authenticated, service_role;

create or replace function public.approve_label_lab_ruleset(
  p_ruleset_id uuid,
  p_actor uuid,
  p_confirmation_text text
)
returns public.label_lab_rulesets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := case when (select auth.role()) = 'service_role'
    then p_actor else (select auth.uid()) end;
  v_result public.label_lab_rulesets%rowtype;
begin
  if v_actor is null
    or not exists (
      select 1 from public.profiles pr
      where pr.id = v_actor and pr.is_super_admin
    )
  then
    raise exception 'Somente o Super Admin pode aprovar regras.'
      using errcode = '42501';
  end if;
  if upper(btrim(coalesce(p_confirmation_text, ''))) <> 'APROVAR' then
    raise exception 'Confirme a aprovação digitando APROVAR.'
      using errcode = '22023';
  end if;

  select * into v_result
  from public.label_lab_rulesets r
  where r.id = p_ruleset_id
  for update;

  if not found or v_result.status not in ('draft', 'approved') then
    raise exception 'Rascunho aprovável não encontrado.' using errcode = '22023';
  end if;
  if coalesce((v_result.regression ->> 'total')::integer, 0) < 1
    or coalesce((v_result.regression ->> 'failed')::integer, 1) <> 0
  then
    raise exception 'A regressão precisa estar verde antes da aprovação.'
      using errcode = '22023';
  end if;

  update public.label_lab_rulesets r
  set status = 'approved',
      approved_by = v_actor,
      approved_at = now(),
      artifact = null,
      checksum = null
  where r.id = p_ruleset_id
  returning * into v_result;

  insert into public.label_lab_audit (action, actor, details)
  values (
    'ruleset_approved', v_actor,
    jsonb_build_object(
      'ruleset_id', v_result.id,
      'version', v_result.version,
      'passed', v_result.regression -> 'passed'
    )
  );

  return v_result;
end;
$$;

revoke all on function public.approve_label_lab_ruleset(uuid, uuid, text) from public;
grant execute on function public.approve_label_lab_ruleset(uuid, uuid, text)
  to authenticated, service_role;

create or replace function public.publish_label_lab_ruleset(
  p_ruleset_id uuid,
  p_actor uuid,
  p_confirmation_text text,
  p_expected_version integer
)
returns public.label_lab_rulesets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := case when (select auth.role()) = 'service_role'
    then p_actor else (select auth.uid()) end;
  v_result public.label_lab_rulesets%rowtype;
  v_artifact jsonb;
  v_removed integer;
begin
  if v_actor is null
    or not exists (
      select 1 from public.profiles pr
      where pr.id = v_actor and pr.is_super_admin
    )
  then
    raise exception 'Somente o Super Admin pode publicar regras.'
      using errcode = '42501';
  end if;
  if upper(btrim(coalesce(p_confirmation_text, ''))) <> 'PUBLICAR' then
    raise exception 'Confirme a publicação digitando PUBLICAR.'
      using errcode = '22023';
  end if;

  select * into v_result
  from public.label_lab_rulesets r
  where r.id = p_ruleset_id
  for update;

  if not found or v_result.status <> 'approved' then
    raise exception 'Somente um rascunho aprovado pode ser publicado.'
      using errcode = '22023';
  end if;
  if p_expected_version is distinct from v_result.version then
    raise exception 'A versão conferida mudou. Recarregue a Central.'
      using errcode = '40001';
  end if;
  if coalesce((v_result.regression ->> 'total')::integer, 0) < 1
    or coalesce((v_result.regression ->> 'failed')::integer, 1) <> 0
  then
    raise exception 'A regressão precisa estar verde antes da publicação.'
      using errcode = '22023';
  end if;

  v_artifact := jsonb_build_object(
    'schema', 'label-lab-rules/v1',
    'version', v_result.version,
    'name', v_result.name,
    'description', v_result.description,
    'published_at', now(),
    'rules', v_result.rules,
    'regression', v_result.regression
  );

  update public.label_lab_rulesets r
  set status = 'superseded'
  where r.status = 'published' and r.id <> p_ruleset_id;

  update public.label_lab_rulesets r
  set status = 'published',
      artifact = v_artifact,
      checksum = md5(v_artifact::text),
      published_by = v_actor,
      published_at = now()
  where r.id = p_ruleset_id
  returning * into v_result;

  v_removed := public.purge_label_lab_samples_for_ruleset(p_ruleset_id, 'published');

  insert into public.label_lab_audit (action, actor, details)
  values (
    'ruleset_published', v_actor,
    jsonb_build_object(
      'ruleset_id', v_result.id,
      'version', v_result.version,
      'checksum', v_result.checksum,
      'samples_removed', v_removed
    )
  );

  return v_result;
end;
$$;

revoke all on function public.publish_label_lab_ruleset(uuid, uuid, text, integer) from public;
grant execute on function public.publish_label_lab_ruleset(uuid, uuid, text, integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';
