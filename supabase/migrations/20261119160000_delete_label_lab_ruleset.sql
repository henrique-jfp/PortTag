-- Exclusão controlada de rascunhos do Label Lab.
--
-- Somente versões em draft podem ser excluídas. Versões aprovadas, publicadas
-- ou superseded permanecem intactas para preservar o artefato versionado e a
-- auditoria. As fotos/OCR de origem NÃO são apagados: eles continuam
-- disponíveis para as outras versões e para a regressão.

alter table public.label_lab_audit
  drop constraint if exists label_lab_audit_action_check;
alter table public.label_lab_audit
  add constraint label_lab_audit_action_check
  check (action in (
    'collected', 'manual_collected', 'analysis_started', 'analyzed',
    'analysis_failed', 'settings_updated', 'deleted', 'sample_discarded',
    'ruleset_saved', 'regression_tested', 'ruleset_approved',
    'ruleset_published', 'ruleset_deleted'
  ));

create or replace function public.delete_label_lab_ruleset(
  p_ruleset_id uuid,
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
  v_ruleset public.label_lab_rulesets%rowtype;
begin
  if v_actor is null
    or not exists (
      select 1 from public.profiles pr
      where pr.id = v_actor and pr.is_super_admin
    )
  then
    raise exception 'Somente o Super Admin pode excluir regras.'
      using errcode = '42501';
  end if;

  select * into v_ruleset
  from public.label_lab_rulesets r
  where r.id = p_ruleset_id
  for update;

  if not found then
    return false;
  end if;
  if v_ruleset.status <> 'draft' then
    raise exception 'Somente rascunhos podem ser excluídos.'
      using errcode = '22023';
  end if;

  delete from public.label_lab_rulesets r where r.id = p_ruleset_id;

  insert into public.label_lab_audit (action, actor, details)
  values (
    'ruleset_deleted',
    v_actor,
    jsonb_build_object(
      'ruleset_id', v_ruleset.id,
      'version', v_ruleset.version,
      'name', v_ruleset.name
    )
  );

  return true;
end;
$$;

revoke all on function public.delete_label_lab_ruleset(uuid, uuid) from public;
grant execute on function public.delete_label_lab_ruleset(uuid, uuid)
  to authenticated, service_role;
