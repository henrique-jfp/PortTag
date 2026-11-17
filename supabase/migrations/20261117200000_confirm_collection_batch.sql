-- Retirada em lote: uma única assinatura copiada em todas as encomendas do
-- mesmo apartamento. A validação toda acontece no banco, antes de qualquer
-- UPDATE, para que um pacote já retirado (ou trocado entre apartamentos) não
-- deixe o lote pela metade.

create or replace function public.confirm_package_collection_batch(
  p_package_ids uuid[],
  p_collected_by_name text,
  p_resident_signature text,
  p_porter_confirmed boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condominium_id uuid;
  v_block_id uuid;
  v_unit_number text;
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'Faça login para registrar a retirada.'
      using errcode = '42501';
  end if;

  if p_porter_confirmed is not true then
    raise exception 'Confirme que você presenciou a retirada e a assinatura.'
      using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_collected_by_name, '')), '') is null
    or length(btrim(p_collected_by_name)) > 120
  then
    raise exception 'Informe o nome de quem confirmou a retirada.'
      using errcode = '22023';
  end if;

  if p_resident_signature is null
    or length(p_resident_signature) > 600000
    or p_resident_signature !~ '^data:image/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
  then
    raise exception 'A assinatura está ausente ou em formato inválido.'
      using errcode = '22023';
  end if;

  if p_package_ids is null
    or cardinality(p_package_ids) = 0
    or cardinality(p_package_ids) > 50
  then
    raise exception 'Selecione entre 1 e 50 encomendas.'
      using errcode = '22023';
  end if;

  if (select count(distinct item) from unnest(p_package_ids) as item)
      <> cardinality(p_package_ids)
  then
    raise exception 'A mesma encomenda foi selecionada mais de uma vez.'
      using errcode = '22023';
  end if;

  select p.condominium_id, p.block_id, p.unit_number
  into v_condominium_id, v_block_id, v_unit_number
  from public.packages p
  where p.id = p_package_ids[1]
    and p.status = 'received';

  if not found then
    raise exception 'Encomenda não encontrada ou já retirada.'
      using errcode = 'P0002';
  end if;

  if (select count(*) from public.packages p where p.id = any(p_package_ids))
      <> cardinality(p_package_ids)
  then
    raise exception 'Uma ou mais encomendas não foram encontradas.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.packages p
    where p.id = any(p_package_ids)
      and (
        p.status <> 'received'
        or p.condominium_id <> v_condominium_id
        or p.block_id is distinct from v_block_id
        or p.unit_number is distinct from v_unit_number
      )
  ) then
    raise exception
      'Todas as encomendas precisam estar na portaria e pertencer ao mesmo apartamento.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.porter_accounts pa
    where pa.auth_user_id = (select auth.uid())
      and pa.condominium_id = v_condominium_id
      and pa.active
  ) or not public.can_access_condominium_block(
    v_condominium_id,
    v_block_id
  ) then
    raise exception 'Somente o porteiro autorizado pode confirmar esta retirada.'
      using errcode = '42501';
  end if;

  update public.packages
  set status = 'collected',
      collected_at = now(),
      collected_by_name = btrim(p_collected_by_name),
      collected_signature = p_resident_signature,
      collected_confirmed_by = (select auth.uid())
  where id = any(p_package_ids)
    and status = 'received';

  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(p_package_ids) then
    raise exception 'A encomenda já foi atualizada.'
      using errcode = '40001';
  end if;

  return v_updated;
end;
$$;

revoke all on function public.confirm_package_collection_batch(
  uuid[], text, text, boolean
) from public;
grant execute on function public.confirm_package_collection_batch(
  uuid[], text, text, boolean
) to authenticated;

notify pgrst, 'reload schema';
