-- Prazo de acesso por condomínio.
--
-- O prazo é calculado no servidor a partir de agora(); o cliente só escolhe a
-- opção. `access_expires_at` nulo significa sem expiração, o que preserva o
-- comportamento dos condomínios já cadastrados. O Super Admin ignora o prazo.

alter table public.condominiums
  add column if not exists access_expires_at timestamptz,
  add column if not exists access_duration text;

alter table public.condominiums
  drop constraint if exists condominiums_access_duration_check;
alter table public.condominiums
  add constraint condominiums_access_duration_check
  check (
    access_duration is null
    or access_duration in ('7d', '14d', '1m', '3m', '6m', '1y', 'none')
  );

-- Usada por RLS, pelas RPCs e pelas Edge Functions. Não exige auth.uid()
-- porque as Edge Functions chamam esta RPC com service_role (sem `sub`).
create or replace function public.condominium_access_is_active(p_condominium_id uuid)
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
      from public.condominiums c
      where c.id = p_condominium_id
        and c.status = 'active'
        and (c.access_expires_at is null or c.access_expires_at > now())
    );
$$;

revoke all on function public.condominium_access_is_active(uuid) from public;
revoke execute on function public.condominium_access_is_active(uuid) from anon;
grant execute on function public.condominium_access_is_active(uuid)
  to authenticated, service_role;

-- Síndico: vínculo ativo e condomínio dentro do prazo. Como toda RPC de
-- cadastro do síndico chama esta função, um único ponto bloqueia o acesso.
create or replace function public.is_condominium_admin(target_condominium uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin()
    or (
      target_condominium is not null
      and public.condominium_access_is_active(target_condominium)
      and exists (
        select 1
        from public.condominium_users cu
        where cu.condominium_id = target_condominium
          and cu.user_id = (select auth.uid())
          and cu.status = 'active'
          and cu.role = 'admin'
      )
    );
$$;

revoke all on function public.is_condominium_admin(uuid) from public;
revoke execute on function public.is_condominium_admin(uuid) from anon;
grant execute on function public.is_condominium_admin(uuid)
  to authenticated, service_role;

-- Cópia da versão de 20261117030000 com a checagem do prazo do condomínio.
-- Esta função decide RLS de blocos, unidades, moradores, encomendas e fotos.
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
                where pa.auth_user_id = cu.user_id
                  and pa.condominium_id = cu.condominium_id
                  and pa.active
                  and (
                    pa.access_expires_at is null
                    or pa.access_expires_at > now()
                  )
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
    );
$$;

revoke all on function public.can_access_condominium_block(uuid, uuid) from public;
revoke execute on function public.can_access_condominium_block(uuid, uuid) from anon;
grant execute on function public.can_access_condominium_block(uuid, uuid)
  to authenticated, service_role;

-- A assinatura antiga é removida: o cliente passa a enviar a opção de prazo.
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
  p_initial_block_name text,
  p_access_duration text
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
    name,
    cep,
    street,
    number,
    complement,
    neighborhood,
    city,
    state,
    block_count,
    access_duration,
    access_expires_at,
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

revoke all on function public.create_condominium(text, text, text, text, text, text, text, text, boolean, integer, text, text) from public;
revoke execute on function public.create_condominium(text, text, text, text, text, text, text, text, boolean, integer, text, text) from anon;
grant execute on function public.create_condominium(text, text, text, text, text, text, text, text, boolean, integer, text, text)
  to authenticated, service_role;

-- Renovação: apenas Super Admin, sempre a partir de now(). Síndico não pode
-- renovar o próprio prazo; para isso deve contatar o suporte técnico.
create or replace function public.update_condominium_access(
  p_condominium_id uuid,
  p_access_duration text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access_expires_at timestamptz;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode renovar o prazo de acesso.'
      using errcode = '42501';
  end if;

  if p_access_duration is null
    or p_access_duration not in ('7d', '14d', '1m', '3m', '6m', '1y', 'none') then
    raise exception 'Escolha um prazo de acesso válido: 7 dias, 14 dias, 1 mês, 3 meses, 6 meses, 1 ano ou sem expiração.'
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

  update public.condominiums
  set access_duration = p_access_duration,
      access_expires_at = v_access_expires_at
  where id = p_condominium_id;

  if not found then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.update_condominium_access(uuid, text) from public;
revoke execute on function public.update_condominium_access(uuid, text) from anon;
grant execute on function public.update_condominium_access(uuid, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
