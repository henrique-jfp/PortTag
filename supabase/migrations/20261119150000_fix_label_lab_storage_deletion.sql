-- As RPCs do Label Lab excluíam fotos com DELETE direto em storage.objects.
-- O trigger storage.protect_delete() bloqueia isso até a sessão habilitar
-- explicitamente storage.allow_delete_query. Habilitamos apenas no escopo da
-- transação (terceiro argumento true), sem afetar outras operações.

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

  perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);

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

-- Mesma correção para a purga disparada na publicação de um ruleset.
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
    perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);

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

revoke all on function public.purge_label_lab_samples_for_ruleset(uuid, text) from public;
