create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists is_super_admin boolean not null default false;

create table if not exists public.condominiums (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  cep text not null check (length(btrim(cep)) > 0),
  street text not null check (length(btrim(street)) > 0),
  address_number text not null check (length(btrim(address_number)) > 0),
  complement text,
  neighborhood text not null check (length(btrim(neighborhood)) > 0),
  city text not null check (length(btrim(city)) > 0),
  state text not null check (length(btrim(state)) = 2),
  block_count integer not null default 0 check (block_count >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.condominium_users (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'operator')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (condominium_id, user_id)
);

create index if not exists condominium_users_user_status_idx
  on public.condominium_users (user_id, status);

alter table public.profiles enable row level security;
alter table public.condominiums enable row level security;
alter table public.condominium_users enable row level security;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_super_admin
  );
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

create or replace function public.create_condominium(
  p_name text,
  p_cep text,
  p_street text,
  p_address_number text,
  p_complement text,
  p_neighborhood text,
  p_city text,
  p_state text,
  p_block_count integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_condominium_id uuid;
begin
  if v_user_id is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode cadastrar condomínios.'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_name), '') is null
    or nullif(btrim(p_cep), '') is null
    or nullif(btrim(p_street), '') is null
    or nullif(btrim(p_address_number), '') is null
    or nullif(btrim(p_neighborhood), '') is null
    or nullif(btrim(p_city), '') is null
    or coalesce(length(btrim(p_state)), 0) <> 2
    or p_block_count is null
    or p_block_count < 0
  then
    raise exception 'Informe os dados obrigatórios do condomínio.'
      using errcode = '22023';
  end if;

  insert into public.condominiums (
    name,
    cep,
    street,
    address_number,
    complement,
    neighborhood,
    city,
    state,
    block_count,
    created_by
  )
  values (
    btrim(p_name),
    btrim(p_cep),
    btrim(p_street),
    btrim(p_address_number),
    nullif(btrim(p_complement), ''),
    btrim(p_neighborhood),
    btrim(p_city),
    upper(btrim(p_state)),
    p_block_count,
    v_user_id
  )
  returning id into v_condominium_id;

  return v_condominium_id;
end;
$$;

revoke all on function public.create_condominium(text, text, text, text, text, text, text, text, integer) from public;
grant execute on function public.create_condominium(text, text, text, text, text, text, text, text, integer) to authenticated;

drop policy if exists "Users can read permitted profiles" on public.profiles;
create policy "Users can read permitted profiles"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_super_admin()));

drop policy if exists "Users can read their memberships or super admin can read all" on public.condominium_users;
create policy "Users can read their memberships or super admin can read all"
  on public.condominium_users
  for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_super_admin()));

drop policy if exists "Users can read their condominiums or super admin can read all" on public.condominiums;
create policy "Users can read their condominiums or super admin can read all"
  on public.condominiums
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.condominium_users
      where condominium_id = condominiums.id
        and user_id = (select auth.uid())
        and status = 'active'
    )
  );

grant select on public.profiles, public.condominiums, public.condominium_users to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

insert into public.profiles (id, email)
select id, email
from auth.users
on conflict (id) do nothing;
