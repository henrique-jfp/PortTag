-- Regras publicadas passam a valer em runtime, sem baixar artefato nem editar
-- código. A publicação continua exigindo Super Admin, aceite `PUBLICAR`,
-- versão conferida e regressão verde; este arquivo só dá destino ao artefato.
--
-- CEP, logradouro e número continuam determinísticos no código: o editor e a
-- tabela de regras ativas cobrem apenas carrier, tracking_code, unit_number e
-- recipient_name. Nenhum segredo é exposto: a leitura é feita por RPC.

alter table public.label_lab_audit
  drop constraint if exists label_lab_audit_action_check;
alter table public.label_lab_audit
  add constraint label_lab_audit_action_check
  check (action in (
    'collected', 'manual_collected', 'analysis_started', 'analyzed',
    'analysis_failed', 'settings_updated', 'deleted', 'sample_discarded',
    'ruleset_saved', 'regression_tested', 'ruleset_approved',
    'ruleset_published', 'ruleset_deleted', 'ruleset_reverted'
  ));

create table if not exists public.label_lab_active_rules (
  id boolean primary key default true check (id),
  ruleset_id uuid references public.label_lab_rulesets (id) on delete set null,
  version integer not null check (version > 0),
  artifact jsonb not null check (jsonb_typeof(artifact) = 'object'),
  checksum text not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.label_lab_active_rules enable row level security;

-- Sem policy de leitura: o cliente comum só acessa via RPC abaixo, que devolve
-- exclusivamente as regex publicadas (version, checksum e rules).
revoke all on public.label_lab_active_rules from anon, authenticated;

create or replace function public.get_active_label_lab_rules()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.label_lab_active_rules%rowtype;
begin
  select * into v_rule
  from public.label_lab_active_rules a
  where a.id = true;

  if not found then
    return jsonb_build_object(
      'version', 0, 'checksum', '', 'rules', '{}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'version', v_rule.version,
    'checksum', v_rule.checksum,
    'rules', coalesce(v_rule.artifact -> 'rules', '{}'::jsonb)
  );
end;
$$;

revoke all on function public.get_active_label_lab_rules() from public;
grant execute on function public.get_active_label_lab_rules()
  to anon, authenticated, service_role;

-- Publicar agora também troca a linha ativa no mesmo commit. Se a transação
-- falhar (por exemplo, na purga das amostras), nada muda no recebimento.
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

  insert into public.label_lab_active_rules (
    id, ruleset_id, version, artifact, checksum, updated_by, updated_at
  )
  values (
    true, v_result.id, v_result.version, v_artifact, v_result.checksum,
    v_actor, now()
  )
  on conflict (id) do update set
    ruleset_id = excluded.ruleset_id,
    version = excluded.version,
    artifact = excluded.artifact,
    checksum = excluded.checksum,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

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

-- Rollback: reativa um artefato já publicado. Não apaga nem reprocessa fotos —
-- as amostras daquela versão já foram purgadas na publicação original.
create or replace function public.activate_label_lab_ruleset(
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
    raise exception 'Somente o Super Admin pode ativar regras.'
      using errcode = '42501';
  end if;
  if upper(btrim(coalesce(p_confirmation_text, ''))) <> 'ATIVAR' then
    raise exception 'Confirme a ativação digitando ATIVAR.'
      using errcode = '22023';
  end if;

  select * into v_result
  from public.label_lab_rulesets r
  where r.id = p_ruleset_id
  for update;

  if not found
    or v_result.status not in ('published', 'superseded')
    or v_result.artifact is null
    or v_result.checksum is null
  then
    raise exception 'Somente uma versão publicada pode ser ativada.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('label_lab_active_rules'));

  update public.label_lab_rulesets r
  set status = 'superseded'
  where r.status = 'published' and r.id <> p_ruleset_id;

  update public.label_lab_rulesets r
  set status = 'published'
  where r.id = p_ruleset_id
  returning * into v_result;

  insert into public.label_lab_active_rules (
    id, ruleset_id, version, artifact, checksum, updated_by, updated_at
  )
  values (
    true, v_result.id, v_result.version, v_result.artifact, v_result.checksum,
    v_actor, now()
  )
  on conflict (id) do update set
    ruleset_id = excluded.ruleset_id,
    version = excluded.version,
    artifact = excluded.artifact,
    checksum = excluded.checksum,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.label_lab_audit (action, actor, details)
  values (
    'ruleset_reverted', v_actor,
    jsonb_build_object(
      'ruleset_id', v_result.id,
      'version', v_result.version,
      'checksum', v_result.checksum
    )
  );

  return v_result;
end;
$$;

revoke all on function public.activate_label_lab_ruleset(uuid, uuid, text) from public;
grant execute on function public.activate_label_lab_ruleset(uuid, uuid, text)
  to authenticated, service_role;

-- Backfill da versão já publicada em produção (v1) para não perder Shippify.
insert into public.label_lab_active_rules (
  id, ruleset_id, version, artifact, checksum, updated_by, updated_at
)
select
  true, r.id, r.version, r.artifact, r.checksum, r.published_by, now()
from public.label_lab_rulesets r
where r.status = 'published'
  and r.artifact is not null
  and r.checksum is not null
order by r.version desc
limit 1
on conflict (id) do nothing;

notify pgrst, 'reload schema';
