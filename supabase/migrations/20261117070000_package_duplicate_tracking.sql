-- Duplicidade de rastreio: o mesmo código pode chegar em vários volumes, então
-- o registro não é bloqueado. O app consulta antes de salvar e pede
-- confirmação ao porteiro quando o código já existe no condomínio.

create index if not exists packages_tracking_code_lookup_idx
  on public.packages (condominium_id, lower(tracking_code))
  where tracking_code is not null;

create or replace function public.find_duplicate_package(
  p_condominium_id uuid,
  p_tracking_code text
)
returns table (
  id uuid,
  unit_number text,
  block_name text,
  received_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.unit_number,
    p.block_name,
    p.received_at,
    p.status
  from public.packages p
  where p.condominium_id = p_condominium_id
    and p.tracking_code is not null
    and nullif(btrim(coalesce(p_tracking_code, '')), '') is not null
    and lower(p.tracking_code) = lower(btrim(p_tracking_code))
    and (select public.can_access_condominium_block(
      p.condominium_id,
      p.block_id
    ))
  order by p.received_at desc
  limit 1;
$$;

revoke all on function public.find_duplicate_package(uuid, text) from public;
grant execute on function public.find_duplicate_package(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
