alter table public.porter_accounts
  add column if not exists access_expires_at timestamptz;

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
    );
$$;
