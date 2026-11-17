create table if not exists public.porter_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  condominium_id uuid not null references public.condominiums (id) on delete cascade,
  username text not null,
  name text not null check (length(btrim(name)) > 0),
  active boolean not null default true,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (condominium_id, username)
);

create unique index if not exists porter_accounts_username_lower_idx
  on public.porter_accounts (lower(username));

create table if not exists public.porter_blocks (
  porter_account_id uuid not null
    references public.porter_accounts (id) on delete cascade,
  block_id uuid not null references public.blocks (id) on delete cascade,
  primary key (porter_account_id, block_id)
);

alter table public.packages
  add column if not exists block_id uuid
    references public.blocks (id) on delete set null,
  add column if not exists resident_name text,
  add column if not exists delivery_person text,
  add column if not exists tracking_code text,
  add column if not exists collected_at timestamptz,
  add column if not exists collected_by_name text;

alter table public.porter_accounts enable row level security;
alter table public.porter_blocks enable row level security;

drop policy if exists "Super admins and condo staff can read porter accounts"
  on public.porter_accounts;
create policy "Super admins and condo staff can read porter accounts"
  on public.porter_accounts
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or auth_user_id = (select auth.uid())
    or exists (
      select 1
      from public.condominium_users cu
      where cu.condominium_id = porter_accounts.condominium_id
        and cu.user_id = (select auth.uid())
        and cu.status = 'active'
        and cu.role = 'admin'
    )
  );

drop policy if exists "Users can read permitted porter block assignments"
  on public.porter_blocks;
create policy "Users can read permitted porter block assignments"
  on public.porter_blocks
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.porter_accounts pa
      where pa.id = porter_blocks.porter_account_id
        and (
          pa.auth_user_id = (select auth.uid())
          or exists (
            select 1
            from public.condominium_users cu
            where cu.condominium_id = pa.condominium_id
              and cu.user_id = (select auth.uid())
              and cu.status = 'active'
              and cu.role = 'admin'
          )
        )
    )
  );

revoke insert, update, delete on public.porter_accounts, public.porter_blocks
  from anon, authenticated;
grant select on public.porter_accounts, public.porter_blocks to authenticated;

create or replace function public.can_access_condominium_block(
  p_condominium_id uuid,
  p_block_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.is_super_admin())
    or exists (
      select 1
      from public.condominium_users cu
      join public.condominiums c on c.id = cu.condominium_id
      where cu.condominium_id = p_condominium_id
        and cu.user_id = (select auth.uid())
        and cu.status = 'active'
        and (
          cu.role = 'admin'
          or (
            cu.role = 'operator'
            and exists (
              select 1
              from public.porter_accounts pa
              where pa.auth_user_id = cu.user_id
                and pa.condominium_id = cu.condominium_id
                and pa.active
                and (
                  (c.block_count = 0 and p_block_id is null)
                  or exists (
                    select 1
                    from public.porter_blocks pb
                    where pb.porter_account_id = pa.id
                      and pb.block_id = p_block_id
                  )
                )
              )
            )
          )
        )
  ;
$$;

revoke all on function public.can_access_condominium_block(uuid, uuid)
  from public;
grant execute on function public.can_access_condominium_block(uuid, uuid)
  to authenticated;

drop policy if exists "Users can read blocks in permitted condominiums"
  on public.blocks;
create policy "Users can read assigned condominium blocks"
  on public.blocks
  for select
  to authenticated
  using (
    (select public.can_access_condominium_block(condominium_id, id))
  );

drop policy if exists "Users can read units in permitted condominiums"
  on public.units;
create policy "Users can read assigned condominium units"
  on public.units
  for select
  to authenticated
  using (
    (select public.can_access_condominium_block(condominium_id, block_id))
  );

drop policy if exists "Users can read residents in permitted condominiums"
  on public.unit_residents;
create policy "Users can read residents in assigned condominium units"
  on public.unit_residents
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.units u
      where u.id = unit_residents.unit_id
        and (select public.can_access_condominium_block(
          u.condominium_id,
          u.block_id
        ))
    )
  );

drop policy if exists "Staff can read package records"
  on public.packages;
create policy "Staff can read assigned package records"
  on public.packages
  for select
  to authenticated
  using (
    (select public.can_access_condominium_block(
      condominium_id,
      block_id
    ))
  );

drop policy if exists "Staff can read assigned package receipts"
  on storage.objects;
drop policy if exists "Condominium staff can read package receipts"
  on storage.objects;
create policy "Staff can read assigned package receipts"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'package-receipts'
    and (
      (select public.is_super_admin())
      or exists (
        select 1
        from public.packages p
        where p.receipt_path = storage.objects.name
          and (select public.can_access_condominium_block(
            p.condominium_id,
            p.block_id
          ))
      )
    )
  );

drop policy if exists "Assigned staff can upload package receipts"
  on storage.objects;
drop policy if exists "Condominium staff can upload package receipts"
  on storage.objects;
create policy "Assigned staff can upload package receipts"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'package-receipts'
    and (storage.foldername(name))[3] = (select auth.uid())::text
    and exists (
      select 1
      from public.units u
      where u.condominium_id::text = (storage.foldername(name))[1]
        and coalesce(u.block_id::text, 'no-block') = (storage.foldername(name))[2]
        and u.status = 'active'
        and (select public.can_access_condominium_block(
          u.condominium_id,
          u.block_id
        ))
    )
  );

drop policy if exists "Assigned staff can delete own unlinked package receipts"
  on storage.objects;
drop policy if exists "Condominium staff can delete own package receipts"
  on storage.objects;
create policy "Assigned staff can delete own unlinked package receipts"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'package-receipts'
    and (
      (select public.is_super_admin())
      or (
        (storage.foldername(name))[3] = (select auth.uid())::text
        and not exists (
          select 1
          from public.packages p
          where p.receipt_path = name
        )
        and exists (
          select 1
          from public.units u
          where u.condominium_id::text = (storage.foldername(name))[1]
            and coalesce(u.block_id::text, 'no-block') = (storage.foldername(name))[2]
            and u.status = 'active'
            and (select public.can_access_condominium_block(
              u.condominium_id,
              u.block_id
            ))
        )
      )
    )
  );

create or replace function public.assign_condominium_admin(
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
    raise exception 'Apenas o Super Admin pode vincular síndicos.'
      using errcode = '42501';
  end if;

  if p_condominium_id is null
    or nullif(btrim(coalesce(p_email, '')), '') is null
    or not exists (
      select 1
      from public.condominiums
      where id = p_condominium_id
        and status = 'active'
    )
  then
    raise exception 'Informe um condomínio ativo e o e-mail da conta.'
      using errcode = '22023';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(btrim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'Crie ou convide primeiro a conta em Supabase Authentication.'
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
    'admin',
    'active',
    auth.uid()
  )
  on conflict (condominium_id, user_id) do update
  set status = 'active',
      created_by = auth.uid()
  where existing_membership.role = 'admin'
  returning id into v_membership_id;

  if v_membership_id is null then
    raise exception 'Esta conta já está vinculada ao condomínio com outro perfil.'
      using errcode = '23505';
  end if;

  return v_membership_id;
end;
$$;

revoke all on function public.assign_condominium_admin(uuid, text) from public;
grant execute on function public.assign_condominium_admin(uuid, text)
  to authenticated;

create or replace function public.deactivate_condominium_admin(
  p_membership_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode remover o acesso de síndicos.'
      using errcode = '42501';
  end if;

  update public.condominium_users
  set status = 'inactive'
  where id = p_membership_id
    and role = 'admin';

  if not found then
    raise exception 'Vínculo de síndico não encontrado.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.deactivate_condominium_admin(uuid) from public;
grant execute on function public.deactivate_condominium_admin(uuid)
  to authenticated;

drop function if exists public.assign_condominium_operator(uuid, text);
drop function if exists public.deactivate_condominium_operator(uuid);
drop function if exists public.create_package(uuid, uuid, text, text, text);

create or replace function public.create_package(
  p_condominium_id uuid,
  p_unit_id uuid,
  p_receipt_path text,
  p_sender text,
  p_delivery_person text,
  p_tracking_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_unit_number text;
  v_block_id uuid;
  v_block_name text;
  v_resident_name text;
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
    or nullif(btrim(coalesce(p_sender, '')), '') is null
    or nullif(btrim(coalesce(p_delivery_person, '')), '') is null
  then
    raise exception 'Informe a unidade, a empresa e o nome do entregador.'
      using errcode = '22023';
  end if;

  select u.unit_number, u.block_id, b.name
  into v_unit_number, v_block_id, v_block_name
  from public.units u
  left join public.blocks b on b.id = u.block_id
  where u.id = p_unit_id
    and u.condominium_id = p_condominium_id
    and u.status = 'active';

  if not found then
    raise exception 'A unidade não pertence ao condomínio ou está inativa.'
      using errcode = '22023';
  end if;

  if not public.can_access_condominium_block(
    p_condominium_id,
    v_block_id
  ) then
    raise exception 'Sua conta não tem acesso ao bloco desta unidade.'
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

  if position(
    p_condominium_id::text || '/'
      || coalesce(v_block_id::text, 'no-block') || '/'
      || v_user_id::text || '/'
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

  select string_agg(nullif(btrim(ur.name), ''), ', ' order by ur.created_at)
  into v_resident_name
  from public.unit_residents ur
  where ur.unit_id = p_unit_id
    and nullif(btrim(coalesce(ur.name, '')), '') is not null;

  insert into public.packages (
    condominium_id,
    unit_id,
    unit_number,
    block_id,
    block_name,
    resident_name,
    sender,
    delivery_person,
    tracking_code,
    receipt_path,
    received_by,
    received_at,
    photo_expires_at
  )
  values (
    p_condominium_id,
    p_unit_id,
    v_unit_number,
    v_block_id,
    v_block_name,
    v_resident_name,
    nullif(btrim(p_sender), ''),
    nullif(btrim(p_delivery_person), ''),
    nullif(btrim(coalesce(p_tracking_code, '')), ''),
    p_receipt_path,
    v_user_id,
    v_received_at,
    v_received_at + interval '20 days'
  )
  returning id into v_package_id;

  return v_package_id;
end;
$$;

revoke all on function public.create_package(
  uuid, uuid, text, text, text, text
) from public;
grant execute on function public.create_package(
  uuid, uuid, text, text, text, text
) to authenticated;

create or replace function public.confirm_package_collection(
  p_package_id uuid,
  p_collected_by_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condominium_id uuid;
  v_block_id uuid;
  v_resident_name text;
  v_collected_by_name text;
begin
  if auth.uid() is null then
    raise exception 'Faça login para registrar a retirada.'
      using errcode = '42501';
  end if;

  select condominium_id, block_id, resident_name
  into v_condominium_id, v_block_id, v_resident_name
  from public.packages
  where id = p_package_id
    and status = 'received';

  if not found then
    raise exception 'Encomenda não encontrada ou já retirada.'
      using errcode = 'P0002';
  end if;

  if not public.can_access_condominium_block(
    v_condominium_id,
    v_block_id
  ) then
    raise exception 'Sua conta não tem acesso a esta encomenda.'
      using errcode = '42501';
  end if;

  v_collected_by_name := coalesce(
    nullif(btrim(coalesce(p_collected_by_name, '')), ''),
    nullif(btrim(coalesce(v_resident_name, '')), '')
  );

  if v_collected_by_name is null then
    raise exception 'Informe o nome de quem confirmou a retirada.'
      using errcode = '22023';
  end if;

  update public.packages
  set status = 'collected',
      collected_at = now(),
      collected_by_name = v_collected_by_name
  where id = p_package_id
    and status = 'received';

  if not found then
    raise exception 'A encomenda já foi atualizada.'
      using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.confirm_package_collection(uuid, text)
  from public;
grant execute on function public.confirm_package_collection(uuid, text)
  to authenticated;
