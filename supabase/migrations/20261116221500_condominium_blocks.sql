create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references public.condominiums (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (condominium_id, name)
);

alter table public.condominiums
  add column if not exists cep text,
  add column if not exists street text,
  add column if not exists address_number text,
  add column if not exists number text,
  add column if not exists complement text,
  add column if not exists neighborhood text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists block_count integer not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists created_by uuid references auth.users (id) on delete restrict,
  add column if not exists created_at timestamptz not null default now();

alter table public.condominiums
  alter column address_number drop not null;

alter table public.blocks enable row level security;

drop policy if exists "Users can read blocks in permitted condominiums" on public.blocks;
create policy "Users can read blocks in permitted condominiums"
  on public.blocks
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.condominium_users
      where condominium_id = blocks.condominium_id
        and user_id = (select auth.uid())
        and status = 'active'
    )
  );

revoke insert, update, delete on public.blocks from anon, authenticated;
grant select on public.blocks to authenticated;

drop function if exists public.create_condominium(text, text, text, text, text, text, text, text, integer);
drop function if exists public.create_condominium(text, text, text, text, text, text, text, text, boolean, integer, text);

create function public.create_condominium(
  p_name text,
  p_cep text,
  p_street text,
  p_address_number text,
  p_complement text,
  p_neighborhood text,
  p_city text,
  p_state text,
  p_has_blocks boolean,
  p_block_count integer,
  p_initial_block_name text
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
    or p_has_blocks is null
    or (
      p_has_blocks
      and (
        coalesce(p_block_count, 0) < 1
        or nullif(btrim(p_initial_block_name), '') is null
      )
    )
  then
    raise exception 'Informe os dados obrigatórios do condomínio.'
      using errcode = '22023';
  end if;

  insert into public.condominiums (
    name,
    cep,
    street,
    number,
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
    case when p_has_blocks then p_block_count else 0 end,
    v_user_id
  )
  returning id into v_condominium_id;

  if p_has_blocks then
    insert into public.blocks (condominium_id, name, created_by)
    values (v_condominium_id, btrim(p_initial_block_name), v_user_id);
  end if;

  return v_condominium_id;
end;
$$;

revoke all on function public.create_condominium(text, text, text, text, text, text, text, text, boolean, integer, text) from public;
grant execute on function public.create_condominium(text, text, text, text, text, text, text, text, boolean, integer, text) to authenticated;
