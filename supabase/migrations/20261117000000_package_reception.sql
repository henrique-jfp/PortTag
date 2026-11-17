insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'package-receipts',
  'package-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null
    references public.condominiums (id) on delete restrict,
  unit_id uuid references public.units (id) on delete set null,
  unit_number text not null,
  block_name text,
  description text,
  sender text,
  receipt_path text,
  received_by uuid not null references auth.users (id) on delete restrict,
  received_at timestamptz not null default now(),
  photo_expires_at timestamptz not null,
  photo_deleted_at timestamptz,
  status text not null default 'received'
    check (status in ('received', 'collected'))
);

create index if not exists packages_condominium_received_idx
  on public.packages (condominium_id, received_at desc);

create index if not exists packages_photo_expiry_idx
  on public.packages (photo_expires_at)
  where receipt_path is not null;

alter table public.packages enable row level security;

drop policy if exists "Staff can read package records"
  on public.packages;
create policy "Staff can read package records"
  on public.packages
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.condominium_users cu
      where cu.condominium_id = packages.condominium_id
        and cu.user_id = (select auth.uid())
        and cu.status = 'active'
        and cu.role in ('admin', 'operator')
    )
  );

revoke insert, update, delete on public.packages from anon, authenticated;
grant select on public.packages to authenticated;

create or replace function public.assign_condominium_operator(
  p_condominium_id uuid,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_membership_id uuid;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode vincular porteiros.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null
    or nullif(btrim(coalesce(p_email, '')), '') is null
  then
    raise exception 'Informe o condomínio e o e-mail da conta.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.condominiums
    where id = p_condominium_id
      and status = 'active'
  ) then
    raise exception 'Condomínio ativo não encontrado.'
      using errcode = 'P0002';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(btrim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'Não existe uma conta com esse e-mail. Crie ou convide a conta em Supabase Authentication primeiro.'
      using errcode = 'P0002';
  end if;

  insert into public.condominium_users as existing_membership (
    condominium_id,
    user_id,
    role,
    status,
    created_by
  )
  values (
    p_condominium_id,
    v_user_id,
    'operator',
    'active',
    auth.uid()
  )
  on conflict (condominium_id, user_id) do update
  set status = 'active',
      created_by = auth.uid()
  where existing_membership.role = 'operator'
  returning id into v_membership_id;

  if v_membership_id is null then
    raise exception 'Esta conta já está vinculada ao condomínio com outro perfil.'
      using errcode = '23505';
  end if;

  return v_membership_id;
end;
$$;

revoke all on function public.assign_condominium_operator(uuid, text) from public;
grant execute on function public.assign_condominium_operator(uuid, text) to authenticated;

create or replace function public.deactivate_condominium_operator(
  p_membership_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode remover o acesso de porteiros.'
      using errcode = '42501';
  end if;

  update public.condominium_users
  set status = 'inactive'
  where id = p_membership_id
    and role = 'operator';

  if not found then
    raise exception 'Vínculo de porteiro não encontrado.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.deactivate_condominium_operator(uuid) from public;
grant execute on function public.deactivate_condominium_operator(uuid) to authenticated;

create or replace function public.create_package(
  p_condominium_id uuid,
  p_unit_id uuid,
  p_receipt_path text,
  p_description text default null,
  p_sender text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_unit_number text;
  v_block_name text;
  v_received_at timestamptz := now();
  v_package_id uuid;
begin
  if v_user_id is null then
    raise exception 'Faça login para registrar uma encomenda.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null
    or p_unit_id is null
    or nullif(btrim(coalesce(p_receipt_path, '')), '') is null
  then
    raise exception 'Selecione uma unidade e anexe a foto do recebimento.'
      using errcode = '22023';
  end if;

  if not public.is_super_admin() and not exists (
    select 1
    from public.condominium_users cu
    where cu.condominium_id = p_condominium_id
      and cu.user_id = v_user_id
      and cu.status = 'active'
      and cu.role in ('admin', 'operator')
  ) then
    raise exception 'Sua conta não tem acesso a este condomínio.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.condominiums
    where id = p_condominium_id
      and status = 'active'
  ) then
    raise exception 'Condomínio ativo não encontrado.'
      using errcode = 'P0002';
  end if;

  select u.unit_number, b.name
  into v_unit_number, v_block_name
  from public.units u
  left join public.blocks b on b.id = u.block_id
  where u.id = p_unit_id
    and u.condominium_id = p_condominium_id
    and u.status = 'active';

  if not found then
    raise exception 'A unidade não pertence ao condomínio ou está inativa.'
      using errcode = '22023';
  end if;

  if position(
    p_condominium_id::text || '/' || v_user_id::text || '/'
    in p_receipt_path
  ) <> 1 then
    raise exception 'O caminho da foto não pertence a esta conta e condomínio.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'package-receipts'
      and o.name = p_receipt_path
      and o.owner_id = v_user_id::text
  ) then
    raise exception 'A foto não foi enviada para o armazenamento privado.'
      using errcode = '22023';
  end if;

  insert into public.packages (
    condominium_id,
    unit_id,
    unit_number,
    block_name,
    description,
    sender,
    receipt_path,
    received_by,
    received_at,
    photo_expires_at
  )
  values (
    p_condominium_id,
    p_unit_id,
    v_unit_number,
    v_block_name,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_sender, '')), ''),
    p_receipt_path,
    v_user_id,
    v_received_at,
    v_received_at + interval '20 days'
  )
  returning id into v_package_id;

  return v_package_id;
end;
$$;

revoke all on function public.create_package(uuid, uuid, text, text, text) from public;
grant execute on function public.create_package(uuid, uuid, text, text, text) to authenticated;

drop policy if exists "Condominium staff can upload package receipts"
  on storage.objects;
create policy "Condominium staff can upload package receipts"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'package-receipts'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (
      (select public.is_super_admin())
      or exists (
        select 1
        from public.condominium_users cu
        where cu.condominium_id::text = (storage.foldername(name))[1]
          and cu.user_id = (select auth.uid())
          and cu.status = 'active'
          and cu.role in ('admin', 'operator')
      )
    )
  );

drop policy if exists "Condominium staff can read package receipts"
  on storage.objects;
create policy "Condominium staff can read package receipts"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'package-receipts'
    and (
      (select public.is_super_admin())
      or exists (
        select 1
        from public.condominium_users cu
        where cu.condominium_id::text = (storage.foldername(name))[1]
          and cu.user_id = (select auth.uid())
          and cu.status = 'active'
          and cu.role in ('admin', 'operator')
      )
    )
  );

drop policy if exists "Condominium staff can delete own package receipts"
  on storage.objects;
create policy "Condominium staff can delete own package receipts"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'package-receipts'
    and (
      (select public.is_super_admin())
      or (
        (storage.foldername(name))[2] = (select auth.uid())::text
        and not exists (
          select 1
          from public.packages p
          where p.receipt_path = name
        )
        and exists (
          select 1
          from public.condominium_users cu
          where cu.condominium_id::text = (storage.foldername(name))[1]
            and cu.user_id = (select auth.uid())
            and cu.status = 'active'
            and cu.role in ('admin', 'operator')
        )
      )
    )
  );

create or replace function public.delete_condominium(p_condominium_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode excluir condomínios.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null or not exists (
    select 1
    from public.condominiums
    where id = p_condominium_id
  ) then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.packages
    where condominium_id = p_condominium_id
  ) then
    raise exception 'Este condomínio tem histórico de encomendas e não pode ser excluído.'
      using errcode = '23503';
  end if;

  delete from public.units
  where condominium_id = p_condominium_id;

  delete from public.blocks
  where condominium_id = p_condominium_id;

  delete from public.condominium_users
  where condominium_id = p_condominium_id;

  delete from public.condominiums
  where id = p_condominium_id;
end;
$$;

revoke all on function public.delete_condominium(uuid) from public;
grant execute on function public.delete_condominium(uuid) to authenticated;
