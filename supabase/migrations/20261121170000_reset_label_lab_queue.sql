-- "Zerar fila" do Label Lab: descarta em massa todas as amostras ainda ativas
-- (deleted_at nulo), com o mesmo efeito do descarte individual: foto, OCR e
-- análise saem do cofre e a linha fica marcada como deleted.
--
-- Amostras já consumidas (publicadas ou descartadas) não são tocadas: o OCR
-- delas é a base dos casos de regressão das versões anteriores. Regras ativas,
-- artefatos e checksum também permanecem intactos — as regex já valem em
-- runtime via get_active_label_lab_rules, sem depender da fila.

alter table public.label_lab_audit
  drop constraint if exists label_lab_audit_action_check;
alter table public.label_lab_audit
  add constraint label_lab_audit_action_check
  check (action in (
    'collected', 'manual_collected', 'analysis_started', 'analyzed',
    'analysis_failed', 'settings_updated', 'deleted', 'sample_discarded',
    'ruleset_saved', 'regression_tested', 'ruleset_approved',
    'ruleset_published', 'ruleset_deleted', 'ruleset_reverted', 'queue_reset'
  ));

-- Contadores exatos para o diálogo de confirmação (a tela limita a lista a 60
-- amostras, então activeSamples.length não serve de contador).
create or replace function public.get_label_lab_queue_preview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode zerar a fila do Label Lab.'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where status = 'pending'),
    'processing', count(*) filter (where status = 'processing'),
    'analyzed', count(*) filter (where status = 'analyzed'),
    'failed', count(*) filter (where status = 'failed'),
    'with_ocr', count(*) filter (where ocr_text is not null),
    'photos', (
      select count(*)
      from storage.objects s
      join public.label_lab_queue q on q.storage_path = s.name
      where s.bucket_id = 'label-lab-private'
        and q.deleted_at is null
    ),
    'preserved', (
      select count(*) from public.label_lab_queue where deleted_at is not null
    )
  )
  into v_summary
  from public.label_lab_queue
  where deleted_at is null;

  return v_summary;
end;
$$;

revoke all on function public.get_label_lab_queue_preview() from public;
revoke execute on function public.get_label_lab_queue_preview() from anon;
grant execute on function public.get_label_lab_queue_preview() to authenticated;

create or replace function public.discard_all_label_lab_samples(p_ack boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
  v_ids uuid[];
  v_paths text[];
  v_photos integer;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode zerar a fila do Label Lab.'
      using errcode = '42501';
  end if;

  if p_ack is distinct from true then
    raise exception 'Confirme que entende que a operação é irreversível.'
      using errcode = '22023';
  end if;

  v_summary := public.get_label_lab_queue_preview();

  -- FOR UPDATE SKIP LOCKED evita disputa com claim_label_lab_samples, que roda
  -- no cron a cada 10 minutos usando o mesmo mecanismo.
  with locked as (
    select q.id, q.storage_path
    from public.label_lab_queue q
    where q.deleted_at is null
    for update skip locked
  )
  select
    coalesce(array_agg(locked.id), '{}'::uuid[]),
    coalesce(array_agg(locked.storage_path), '{}'::text[])
  into v_ids, v_paths
  from locked;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return v_summary;
  end if;

  -- storage.protect_delete() exige habilitar a exclusão no escopo da transação.
  perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
  where bucket_id = 'label-lab-private'
    and name = any(v_paths);
  get diagnostics v_photos = row_count;
  perform pg_catalog.set_config('storage.allow_delete_query', 'false', true);

  -- Mesmo efeito de discard_label_lab_sample: tracking_code e carrier_detected
  -- permanecem como metadados, mas OCR, análise e confiança são removidos.
  update public.label_lab_queue
  set status = 'deleted',
      ocr_text = null,
      analysis = null,
      parsed_result = '{}'::jsonb,
      confidence_status = '{}'::jsonb,
      error = null,
      deleted_at = now()
  where id = any(v_ids);

  -- Auditoria só com metadados: nunca copiar OCR, nome ou rastreio para details.
  insert into public.label_lab_audit (action, actor, details)
  values (
    'queue_reset',
    auth.uid(),
    jsonb_build_object(
      'discarded', array_length(v_ids, 1),
      'photos_removed', v_photos,
      'preserved', v_summary ->> 'preserved'
    )
  );

  return v_summary;
end;
$$;

revoke all on function public.discard_all_label_lab_samples(boolean) from public;
revoke execute on function public.discard_all_label_lab_samples(boolean) from anon;
grant execute on function public.discard_all_label_lab_samples(boolean)
  to authenticated;

-- A versão atual de purge_label_lab_samples_for_ruleset perdeu o set_config
-- quando passou a preservar o OCR. Com a trigger storage.protect_delete()
-- ativa, a publicação falhava ao tentar apagar a foto. Restaura a permissão
-- apenas no escopo da transação, sem alterar o comportamento do OCR.
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
    perform pg_catalog.set_config('storage.allow_delete_query', 'false', true);
  end if;

  -- Mantém o OCR: ele é a base dos casos de regressão das próximas versões.
  update public.label_lab_queue q
  set status = p_status,
      parsed_result = '{}'::jsonb,
      confidence_status = '{}'::jsonb,
      deleted_at = now()
  where q.id = any(v_sample_ids) and q.deleted_at is null;

  return coalesce(array_length(v_paths, 1), 0);
end;
$$;

notify pgrst, 'reload schema';
