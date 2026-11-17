-- A assinatura é exportada em WebP quando o navegador suporta e em PNG como
-- fallback. A validação do banco precisa aceitar os dois formatos, senão a
-- retirada falha em celulares modernos.

create or replace function public.confirm_package_collection(
  p_package_id uuid,
  p_collected_by_name text,
  p_resident_signature text,
  p_porter_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condominium_id uuid;
  v_block_id uuid;
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

  select condominium_id, block_id
  into v_condominium_id, v_block_id
  from public.packages
  where id = p_package_id
    and status = 'received';

  if not found then
    raise exception 'Encomenda não encontrada ou já retirada.'
      using errcode = 'P0002';
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
  where id = p_package_id
    and status = 'received';

  if not found then
    raise exception 'A encomenda já foi atualizada.'
      using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.confirm_package_collection(
  uuid, text, text, boolean
) from public;
grant execute on function public.confirm_package_collection(
  uuid, text, text, boolean
) to authenticated;

notify pgrst, 'reload schema';
