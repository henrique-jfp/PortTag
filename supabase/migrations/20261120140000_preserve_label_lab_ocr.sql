-- Publicação: apaga a foto privada, mas preserva o OCR da amostra.
--
-- Antes, a publicação anulava o texto OCR junto com a foto, o que impedia
-- re-testar os casos de regressão das versões já publicadas ao calibrar uma
-- etiqueta nova. Agora a foto sai do bucket e a linha é marcada como consumida,
-- mas o texto lido permanece disponível somente para a Central do Label Lab.
-- O descarte explícito continua apagando OCR e analyze por completo.

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

revoke all on function public.purge_label_lab_samples_for_ruleset(uuid, text) from public;
