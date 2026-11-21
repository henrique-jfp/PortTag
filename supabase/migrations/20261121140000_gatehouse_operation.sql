-- Portarias como entidade operacional.
--
-- A permissão deixa de ser "do porteiro" e passa a ser "da portaria onde ele
-- está trabalhando". Cada porteiro tem uma portaria de origem
-- (home_portaria_id) e uma portaria atual (current_portaria_id). O síndico
-- troca a atual quando quiser, sem prazo; "voltar à origem" copia a origem
-- para a atual.
--
-- Três modelos de condomínio:
--   single    -> um bloco (ou nenhum), uma portaria;
--   central   -> vários blocos, uma portaria, um caderno com gavetas por bloco;
--   per_block -> cada bloco com sua portaria e seu caderno.

alter table public.condominiums
  add column if not exists operation_mode text not null default 'per_block'
    check (operation_mode in ('single', 'central', 'per_block')),
  add column if not exists notebook_retention_months integer
    check (notebook_retention_months is null or notebook_retention_months > 0);

create table if not exists public.portarias (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null
    references public.condominiums (id) on delete cascade,
  block_id uuid references public.blocks (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (condominium_id, name)
);

create unique index if not exists portarias_condominium_block_key
  on public.portarias (condominium_id, block_id)
  where block_id is not null;

create index if not exists portarias_condominium_idx
  on public.portarias (condominium_id, active);

alter table public.portarias enable row level security;

drop policy if exists "Condominium staff can read gatehouses"
  on public.portarias;
create policy "Condominium staff can read gatehouses"
  on public.portarias
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or exists (
      select 1
      from public.condominium_users cu
      where cu.condominium_id = portarias.condominium_id
        and cu.user_id = (select auth.uid())
        and cu.status = 'active'
        and cu.role in ('admin', 'operator')
    )
  );

revoke insert, update, delete on public.portarias from anon, authenticated;
grant select on public.portarias to authenticated;

alter table public.porter_accounts
  add column if not exists home_portaria_id uuid references public.portarias (id) on delete restrict,
  add column if not exists current_portaria_id uuid references public.portarias (id) on delete restrict,
  add column if not exists access_revoked_at timestamptz;

create index if not exists porter_accounts_current_portaria_idx
  on public.porter_accounts (current_portaria_id)
  where active and access_revoked_at is null;

-- Cria (ou completa) as portarias de um condomínio conforme o modelo escolhido.
create or replace function public.ensure_condominium_portarias(
  p_condominium_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_has_any boolean;
begin
  select operation_mode into v_mode
  from public.condominiums
  where id = p_condominium_id;

  if not found then
    return;
  end if;

  select exists (
    select 1 from public.portarias where condominium_id = p_condominium_id
  ) into v_has_any;

  if v_mode = 'per_block' then
    insert into public.portarias (condominium_id, block_id, name)
    select p_condominium_id, b.id, 'Portaria ' || b.name
    from public.blocks b
    where b.condominium_id = p_condominium_id
      and not exists (
        select 1 from public.portarias g
        where g.condominium_id = p_condominium_id
          and g.block_id = b.id
      )
    on conflict (condominium_id, name) do nothing;

    -- Enquanto o condomínio não tem blocos, mantemos uma portaria provisória
    -- para que o cadastro de porteiros continue funcionando.
    if not v_has_any then
      insert into public.portarias (condominium_id, block_id, name)
      select p_condominium_id, null, 'Portaria Central'
      where not exists (
        select 1 from public.portarias where condominium_id = p_condominium_id
      );
    else
      -- Se as portarias por bloco já existem, a provisória sai de cena,
      -- desde que nenhum porteiro esteja vinculado a ela.
      delete from public.portarias g
      where g.condominium_id = p_condominium_id
        and g.block_id is null
        and exists (
          select 1 from public.portarias gb
          where gb.condominium_id = p_condominium_id
            and gb.block_id is not null
        )
        and not exists (
          select 1 from public.porter_accounts pa
          where pa.home_portaria_id = g.id
             or pa.current_portaria_id = g.id
        );
    end if;
  else
    -- single e central: um único caderno, com gavetas por bloco no central.
    insert into public.portarias (condominium_id, block_id, name)
    select p_condominium_id, null, 'Portaria Central'
    where not exists (
      select 1 from public.portarias g
      where g.condominium_id = p_condominium_id
        and g.block_id is null
    )
    on conflict (condominium_id, name) do nothing;

    -- Portarias de bloco que sobraram de um modelo anterior não aparecem mais,
    -- desde que nenhum porteiro ainda esteja vinculado a elas.
    update public.portarias g
    set active = false
    where g.condominium_id = p_condominium_id
      and g.block_id is not null
      and not exists (
        select 1 from public.porter_accounts pa
        where pa.home_portaria_id = g.id
           or pa.current_portaria_id = g.id
      );
  end if;
end;
$$;

grant execute on function public.ensure_condominium_portarias(uuid) to service_role;

create or replace function public.on_gatehouse_block_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_condominium_portarias(new.condominium_id);
  return new;
end;
$$;

drop trigger if exists blocks_ensure_portaria on public.blocks;
create trigger blocks_ensure_portaria
  after insert on public.blocks
  for each row execute function public.on_gatehouse_block_change();

create or replace function public.on_gatehouse_condominium_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_condominium_portarias(new.id);
  return new;
end;
$$;

drop trigger if exists condominiums_ensure_portaria on public.condominiums;
create trigger condominiums_ensure_portaria
  after insert or update of operation_mode on public.condominiums
  for each row execute function public.on_gatehouse_condominium_change();

-- Backfill: uma portaria por condomínio e vínculo dos porteiros já existentes.
do $$
declare
  v_condominium record;
begin
  for v_condominium in select id from public.condominiums loop
    perform public.ensure_condominium_portarias(v_condominium.id);
  end loop;
end;
$$;

update public.porter_accounts pa
set home_portaria_id = coalesce(
      (
        select g.id
        from public.portarias g
        join public.porter_blocks pb on pb.block_id = g.block_id
        where pb.porter_account_id = pa.id
          and g.condominium_id = pa.condominium_id
        order by g.id
        limit 1
      ),
      (
        select g.id
        from public.portarias g
        where g.condominium_id = pa.condominium_id
        order by (g.block_id is null) desc, g.name
        limit 1
      )
    ),
    current_portaria_id = coalesce(
      (
        select g.id
        from public.portarias g
        join public.porter_blocks pb on pb.block_id = g.block_id
        where pb.porter_account_id = pa.id
          and g.condominium_id = pa.condominium_id
        order by g.id
        limit 1
      ),
      (
        select g.id
        from public.portarias g
        where g.condominium_id = pa.condominium_id
        order by (g.block_id is null) desc, g.name
        limit 1
      )
    )
where pa.home_portaria_id is null or pa.current_portaria_id is null;

alter table public.porter_accounts
  alter column home_portaria_id set not null,
  alter column current_portaria_id set not null;

-- Autorização central: bloco permitido é o da portaria ATUAL do porteiro.
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
    or (
      public.condominium_access_is_active(p_condominium_id)
      and exists (
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
                join public.portarias gate on gate.id = pa.current_portaria_id
                where pa.auth_user_id = cu.user_id
                  and pa.condominium_id = cu.condominium_id
                  and pa.active = true
                  and pa.access_revoked_at is null
                  and (pa.access_expires_at is null or pa.access_expires_at > now())
                  and gate.condominium_id = p_condominium_id
                  and gate.active = true
                  and (
                    (c.block_count = 0 and p_block_id is null)
                    or gate.block_id is null
                    or gate.block_id = p_block_id
                  )
              )
            )
          )
      )
    );
$$;

-- Cadastro de condomínio passa a receber o modelo de operação. A assinatura
-- antiga é removida para evitar sobrecarga ambígua no PostgREST.
drop function if exists public.create_condominium(text, text, text, text, text, text, text, text, boolean, integer, text, text);

create or replace function public.create_condominium(
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
  p_initial_block_name text,
  p_access_duration text,
  p_operation_mode text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_condominium_id uuid;
  v_access_expires_at timestamptz;
  v_mode text;
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

  if p_access_duration is null
    or p_access_duration not in ('7d', '14d', '1m', '3m', '6m', '1y', 'none') then
    raise exception 'Escolha um prazo de acesso válido: 7 dias, 14 dias, 1 mês, 3 meses, 6 meses, 1 ano ou sem expiração.'
      using errcode = '22023';
  end if;

  v_mode := coalesce(
    nullif(btrim(coalesce(p_operation_mode, '')), ''),
    case when p_has_blocks then 'per_block' else 'single' end
  );
  if v_mode not in ('single', 'central', 'per_block') then
    raise exception 'Modelo de operação inválido.'
      using errcode = '22023';
  end if;
  v_access_expires_at := case p_access_duration
    when '7d' then now() + make_interval(days => 7)
    when '14d' then now() + make_interval(days => 14)
    when '1m' then now() + make_interval(months => 1)
    when '3m' then now() + make_interval(months => 3)
    when '6m' then now() + make_interval(months => 6)
    when '1y' then now() + make_interval(months => 12)
    else null
  end;

  insert into public.condominiums (
    name, cep, street, number, complement, neighborhood, city, state,
    block_count, operation_mode, access_duration, access_expires_at, created_by
  )
  values (
    btrim(p_name), btrim(p_cep), btrim(p_street), btrim(p_address_number),
    nullif(btrim(p_complement), ''), btrim(p_neighborhood), btrim(p_city),
    upper(btrim(p_state)),
    case when p_has_blocks then p_block_count else 0 end,
    v_mode,
    p_access_duration,
    v_access_expires_at,
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

revoke all on function public.create_condominium(text, text, text, text, text, text, text, text, boolean, integer, text, text, text) from public;
revoke execute on function public.create_condominium(text, text, text, text, text, text, text, text, boolean, integer, text, text, text) from anon;
grant execute on function public.create_condominium(text, text, text, text, text, text, text, text, boolean, integer, text, text, text)
  to authenticated, service_role;

-- Troca do modelo de operação pelo Super Admin ou pelo síndico do condomínio.
create or replace function public.update_condominium_operation(
  p_condominium_id uuid,
  p_operation_mode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_central_id uuid;
begin
  if auth.uid() is null or not (
    (select public.is_super_admin())
    or (select public.is_condominium_admin(p_condominium_id))
  ) then
    raise exception 'Sem permissão para alterar este condomínio.'
      using errcode = '42501';
  end if;

  v_mode := nullif(btrim(coalesce(p_operation_mode, '')), '');
  if v_mode is null or v_mode not in ('single', 'central', 'per_block') then
    raise exception 'Modelo de operação inválido.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.condominiums where id = p_condominium_id
  ) then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;

  update public.condominiums
  set operation_mode = v_mode
  where id = p_condominium_id;

  -- O trigger de condomínios cria/ajusta as portarias automaticamente.
  if v_mode in ('single', 'central') then
    select g.id into v_central_id
    from public.portarias g
    where g.condominium_id = p_condominium_id
      and g.block_id is null
    order by g.active desc, g.created_at
    limit 1;

    if v_central_id is not null then
      update public.porter_accounts pa
      set home_portaria_id = v_central_id,
          current_portaria_id = v_central_id
      where pa.condominium_id = p_condominium_id;
    end if;
  else
    -- Voltando a portaria por bloco, cada porteiro volta para a portaria do
    -- primeiro bloco em que trabalhava. Sem bloco vinculado, mantém a origem.
    update public.porter_accounts pa
    set home_portaria_id = coalesce((
          select g.id
          from public.porter_blocks pb
          join public.portarias g
            on g.condominium_id = pa.condominium_id
           and g.block_id = pb.block_id
          where pb.porter_account_id = pa.id
          order by g.id
          limit 1
        ), pa.home_portaria_id),
        current_portaria_id = coalesce((
          select g.id
          from public.porter_blocks pb
          join public.portarias g
            on g.condominium_id = pa.condominium_id
           and g.block_id = pb.block_id
          where pb.porter_account_id = pa.id
          order by g.id
          limit 1
        ), pa.current_portaria_id)
    where pa.condominium_id = p_condominium_id;
  end if;
end;
$$;

revoke all on function public.update_condominium_operation(uuid, text) from public;
revoke execute on function public.update_condominium_operation(uuid, text) from anon;
grant execute on function public.update_condominium_operation(uuid, text) to authenticated;

notify pgrst, 'reload schema';
