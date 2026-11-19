-- Central de Inteligência de Etiquetas: coleta invisível e temporária.
--
-- A foto da etiqueta continua descartada no recebimento normal. Esta migration
-- cria a ÚNICA exceção: uma amostra.jpg enviada depois do OCR para um bucket
-- privado, sem qualquer tela, botão ou mensagem no app do porteiro. Nada aqui
-- altera regras de CEP/logradouro/número nem decide transportadora ou rastreio.
-- A Central de edição/publicação de regex virá depois, a partir desta fila.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'label-lab-private',
  'label-lab-private',
  false,
  2800000,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Label Lab: Super Admin can read private samples"
  on storage.objects;
create policy "Label Lab: Super Admin can read private samples"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'label-lab-private'
    and (select public.is_super_admin())
  );

create table if not exists public.label_lab_settings (
  id boolean primary key default true check (id),
  collection_enabled boolean not null default true,
  pending_retention_days integer not null default 7
    check (pending_retention_days between 1 and 90),
  processing_retention_days integer not null default 15
    check (processing_retention_days between 1 and 90),
  max_attempts integer not null default 3
    check (max_attempts between 1 and 10),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.label_lab_settings (id) values (true)
on conflict (id) do nothing;

create table if not exists public.label_lab_queue (
  id uuid primary key,
  condominium_id uuid not null
    references public.condominiums (id) on delete cascade,
  storage_path text not null,
  image_sha256 text not null
    check (image_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  image_bytes integer not null
    check (image_bytes > 0 and image_bytes <= 2800000),
  reasons text[] not null check (cardinality(reasons) > 0),
  carrier_detected text,
  tracking_code text,
  ocr_text text,
  parsed_result jsonb not null default '{}'::jsonb,
  confidence_status jsonb not null default '{}'::jsonb,
  analysis jsonb,
  status text not null default 'pending'
    check (status in (
      'pending', 'processing', 'analyzed', 'failed',
      'discarded', 'published', 'deleted'
    )),
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  expires_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists label_lab_queue_active_hash_idx
  on public.label_lab_queue (condominium_id, image_sha256)
  where deleted_at is null;

create unique index if not exists label_lab_queue_active_path_idx
  on public.label_lab_queue (storage_path)
  where deleted_at is null;

create index if not exists label_lab_queue_pending_idx
  on public.label_lab_queue (status, created_at)
  where deleted_at is null;

create index if not exists label_lab_queue_expiration_idx
  on public.label_lab_queue (expires_at)
  where deleted_at is null;

create table if not exists public.label_lab_audit (
  id uuid primary key default gen_random_uuid(),
  sample_id uuid references public.label_lab_queue (id) on delete set null,
  condominium_id uuid references public.condominiums (id) on delete set null,
  action text not null
    check (action in (
      'collected', 'analysis_started', 'analyzed', 'analysis_failed',
      'settings_updated', 'deleted'
    )),
  actor uuid references auth.users (id) on delete set null,
  -- Auditoria só com metadados: nunca copiar OCR, nome ou rastreio para cá.
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists label_lab_audit_sample_idx
  on public.label_lab_audit (sample_id, created_at desc);

create or replace function public.set_label_lab_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists label_lab_queue_set_updated_at
  on public.label_lab_queue;
create trigger label_lab_queue_set_updated_at
  before update on public.label_lab_queue
  for each row execute function public.set_label_lab_updated_at();

drop trigger if exists label_lab_settings_set_updated_at
  on public.label_lab_settings;
create trigger label_lab_settings_set_updated_at
  before update on public.label_lab_settings
  for each row execute function public.set_label_lab_updated_at();

alter table public.label_lab_settings enable row level security;
alter table public.label_lab_queue enable row level security;
alter table public.label_lab_audit enable row level security;

drop policy if exists "Super Admin can read Label Lab settings"
  on public.label_lab_settings;
create policy "Super Admin can read Label Lab settings"
  on public.label_lab_settings
  for select
  to authenticated
  using ((select public.is_super_admin()));

drop policy if exists "Super Admin can read Label Lab queue"
  on public.label_lab_queue;
create policy "Super Admin can read Label Lab queue"
  on public.label_lab_queue
  for select
  to authenticated
  using ((select public.is_super_admin()));

drop policy if exists "Super Admin can read Label Lab audit"
  on public.label_lab_audit;
create policy "Super Admin can read Label Lab audit"
  on public.label_lab_audit
  for select
  to authenticated
  using ((select public.is_super_admin()));

revoke all on public.label_lab_settings from anon, authenticated;
grant select on public.label_lab_settings to authenticated;
revoke all on public.label_lab_queue from anon, authenticated;
grant select on public.label_lab_queue to authenticated;
revoke all on public.label_lab_audit from anon, authenticated;
grant select on public.label_lab_audit to authenticated;

-- Porteiro ativo (respeitando prazo de acesso), síndico ativo ou Super Admin.
-- Diferente de can_access_condominium_block, não exige bloco: a amostra é do
-- condomínio, não de uma gaveta específica.
-- p_user_id é opcional porque esta função é chamada tanto pelo cliente do
-- porteiro (auth.uid()) quanto pela RPC de enfileiramento, que roda com
-- service_role e precisa informar explicitamente quem fez o upload.
drop function if exists public.can_collect_label_sample(uuid);
create or replace function public.can_collect_label_sample(
  p_condominium_id uuid,
  p_user_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select coalesce(p_user_id, (select auth.uid())) as user_id
  )
  select
    exists (
      select 1
      from public.profiles pr
      join target t on t.user_id = pr.id
      where pr.is_super_admin
    )
    or exists (
      select 1
      from target t
      join public.condominiums c on c.id = p_condominium_id and c.status = 'active'
      join public.condominium_users cu on cu.condominium_id = c.id
      left join public.porter_accounts pa
        on pa.auth_user_id = cu.user_id
       and pa.condominium_id = cu.condominium_id
      where cu.user_id = t.user_id
        and cu.status = 'active'
        and (
          cu.role = 'admin'
          or (
            cu.role = 'operator'
            and pa.active
            and (pa.access_expires_at is null or pa.access_expires_at > now())
          )
        )
    );
$$;

revoke all on function public.can_collect_label_sample(uuid, uuid) from public;
grant execute on function public.can_collect_label_sample(uuid, uuid) to authenticated;

-- Persiste a tarefa depois que a Edge Function já fez o upload. Em caso de
-- foto repetida no mesmo condomínio, devolve o id existente e não duplica a
-- amostra; a função remove o arquivo recém-enviado.
drop function if exists public.enqueue_label_lab_sample(
  uuid, uuid, text, text, text, integer, text[], text, text, text, jsonb, jsonb
);
create or replace function public.enqueue_label_lab_sample(
  p_id uuid,
  p_created_by uuid,
  p_condominium_id uuid,
  p_storage_path text,
  p_image_sha256 text,
  p_mime_type text,
  p_image_bytes integer,
  p_reasons text[],
  p_carrier_detected text default null,
  p_tracking_code text default null,
  p_ocr_text text default null,
  p_parsed_result jsonb default '{}'::jsonb,
  p_confidence_status jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_created_by;
  v_settings public.label_lab_settings%rowtype;
  v_id uuid;
  v_allowed_reasons text[] := array[
    'recipient-missing', 'unit-missing', 'unit-conflict',
    'address-unknown', 'address-mismatch', 'short-ocr',
    'ai-error', 'ai-skipped', 'carrier-missing', 'tracking-missing'
  ];
begin
  if v_user_id is null then
    raise exception 'Faça login para enviar a amostra.'
      using errcode = '42501';
  end if;

  select * into v_settings
  from public.label_lab_settings
  where id = true;

  if not v_settings.collection_enabled then
    raise exception 'Coleta de etiquetas desativada.'
      using errcode = '42501';
  end if;

  if not public.can_collect_label_sample(p_condominium_id, v_user_id) then
    raise exception 'Sua conta não tem acesso a este condomínio.'
      using errcode = '42501';
  end if;

  if p_id is null
    or v_user_id is null
    or p_storage_path is null or length(btrim(p_storage_path)) = 0
    or p_image_sha256 is null
    or not (p_image_sha256 ~ '^[0-9a-f]{64}$')
    or p_mime_type is null
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_image_bytes is null
    or p_image_bytes <= 0
    or p_image_bytes > 2800000
    or coalesce(array_length(p_reasons, 1), 0) = 0
    or array_position(p_reasons, null::text) is not null
    or not (p_reasons <@ v_allowed_reasons)
  then
    raise exception 'Amostra de etiqueta inválida.'
      using errcode = '22023';
  end if;

  insert into public.label_lab_queue (
    id,
    condominium_id,
    storage_path,
    image_sha256,
    mime_type,
    image_bytes,
    reasons,
    carrier_detected,
    tracking_code,
    ocr_text,
    parsed_result,
    confidence_status,
    expires_at,
    created_by
  )
  values (
    p_id,
    p_condominium_id,
    left(btrim(p_storage_path), 300),
    p_image_sha256,
    p_mime_type,
    p_image_bytes,
    p_reasons,
    nullif(left(btrim(coalesce(p_carrier_detected, '')), 80), ''),
    nullif(regexp_replace(left(btrim(coalesce(p_tracking_code, '')), 80), '\s', '', 'g'), ''),
    nullif(left(btrim(coalesce(p_ocr_text, '')), 3000), ''),
    coalesce(p_parsed_result, '{}'::jsonb),
    coalesce(p_confidence_status, '{}'::jsonb),
    now() + make_interval(days => v_settings.pending_retention_days),
    v_user_id
  )
  on conflict (condominium_id, image_sha256) where deleted_at is null
  do nothing
  returning id into v_id;

  if v_id is not null then
    insert into public.label_lab_audit (
      sample_id, condominium_id, action, actor, details
    )
    values (
      v_id, p_condominium_id, 'collected', v_user_id,
      jsonb_build_object(
        'mime_type', p_mime_type,
        'image_bytes', p_image_bytes,
        'reasons', to_jsonb(p_reasons)
      )
    );
    return v_id;
  end if;

  select q.id into v_id
  from public.label_lab_queue q
  where q.condominium_id = p_condominium_id
    and q.image_sha256 = p_image_sha256
    and q.deleted_at is null;

  return v_id;
end;
$$;

revoke all on function public.enqueue_label_lab_sample(
  uuid, uuid, uuid, text, text, text, integer, text[], text, text, text, jsonb, jsonb
) from public;
grant execute on function public.enqueue_label_lab_sample(
  uuid, uuid, uuid, text, text, text, integer, text[], text, text, text, jsonb, jsonb
) to authenticated, service_role;

create or replace function public.update_label_lab_settings(
  p_collection_enabled boolean default null,
  p_pending_retention_days integer default null,
  p_processing_retention_days integer default null,
  p_max_attempts integer default null
)
returns public.label_lab_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.label_lab_settings%rowtype;
begin
  if not (select public.is_super_admin()) then
    raise exception 'Somente o Super Admin pode configurar o laboratório.'
      using errcode = '42501';
  end if;

  update public.label_lab_settings s
  set collection_enabled = coalesce(p_collection_enabled, s.collection_enabled),
      pending_retention_days = coalesce(p_pending_retention_days, s.pending_retention_days),
      processing_retention_days = coalesce(p_processing_retention_days, s.processing_retention_days),
      max_attempts = coalesce(p_max_attempts, s.max_attempts),
      updated_by = (select auth.uid())
  where s.id = true;

  insert into public.label_lab_audit (action, actor, details)
  values (
    'settings_updated',
    (select auth.uid()),
    jsonb_strip_nulls(jsonb_build_object(
      'collection_enabled', p_collection_enabled,
      'pending_retention_days', p_pending_retention_days,
      'processing_retention_days', p_processing_retention_days,
      'max_attempts', p_max_attempts
    ))
  );

  select * into v_result
  from public.label_lab_settings
  where id = true;
  return v_result;
end;
$$;

revoke all on function public.update_label_lab_settings(boolean, integer, integer, integer) from public;
grant execute on function public.update_label_lab_settings(boolean, integer, integer, integer)
  to authenticated;

-- Worker de análise: reclama pendentes com FOR UPDATE SKIP LOCKED para duas
-- execuções do cron não analisarem a mesma etiqueta.
create or replace function public.claim_label_lab_samples(p_limit integer default 4)
returns setof public.label_lab_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.label_lab_settings%rowtype;
  v_ids uuid[];
  v_safe_limit integer;
begin
  if p_limit is null then
    raise exception 'Limite inválido.'
      using errcode = '22023';
  end if;
  v_safe_limit := least(greatest(p_limit, 1), 20);

  select * into v_settings
  from public.label_lab_settings
  where id = true;
  if not v_settings.collection_enabled then
    return;
  end if;

  select array_agg(picked.id) into v_ids
  from (
    select q.id
    from public.label_lab_queue q
    where q.status = 'pending'
      and q.deleted_at is null
      and q.attempts < v_settings.max_attempts
    order by q.created_at
    for update skip locked
    limit v_safe_limit
  ) as picked;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return;
  end if;

  update public.label_lab_queue q
  set status = 'processing',
      attempts = q.attempts + 1,
      expires_at = now() + make_interval(days => v_settings.processing_retention_days)
  where q.id = any(v_ids)
    and q.deleted_at is null
    and q.status = 'pending';

  insert into public.label_lab_audit (sample_id, condominium_id, action, details)
  select q.id, q.condominium_id, 'analysis_started',
         jsonb_build_object('attempts', q.attempts + 1)
  from public.label_lab_queue q
  where q.id = any(v_ids)
    and q.status = 'processing';

  return query
    select q.*
    from public.label_lab_queue q
    where q.id = any(v_ids)
      and q.status = 'processing'
    order by q.created_at;
end;
$$;

revoke all on function public.claim_label_lab_samples(integer) from public;
grant execute on function public.claim_label_lab_samples(integer) to service_role;

-- Reconciliação: arquivos órfãos do bucket são apagados mesmo se a linha da
-- fila nunca tiver sido criada (upload concluído e chamada seguinte falhou).
create or replace function public.label_lab_orphan_paths()
returns table (path text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'label-lab-private'
    and o.created_at < now() - interval '10 minutes'
    and not exists (
      select 1
      from public.label_lab_queue q
      where q.deleted_at is null
        and q.storage_path = o.name
    );
$$;

revoke all on function public.label_lab_orphan_paths() from public;
grant execute on function public.label_lab_orphan_paths() to service_role;

notify pgrst, 'reload schema';
