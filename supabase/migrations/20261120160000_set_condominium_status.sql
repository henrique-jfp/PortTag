-- Suspensão ou reativação de condomínio (por exemplo, inadimplência) sem
-- excluir blocos, unidades, moradores, encomendas nem vínculos.
-- Apenas o Super Admin pode alterar o status: a RPC update_condominium continua
-- aberta ao síndico para os dados cadastrais e não deve receber p_status.
-- O bloqueio de síndico e porteiro já é aplicado por
-- condominium_access_is_active, is_condominium_admin e
-- can_access_condominium_block; esta RPC apenas escreve o status.
create or replace function public.set_condominium_status(
  p_condominium_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Apenas o Super Admin pode alterar o status do condomínio.'
      using errcode = '42501';
  end if;

  if p_status not in ('active', 'inactive') then
    raise exception 'Informe um status válido: active ou inactive.'
      using errcode = '22023';
  end if;

  update public.condominiums
  set status = p_status
  where id = p_condominium_id;

  if not found then
    raise exception 'Condomínio não encontrado.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_condominium_status(uuid, text) from public;
revoke execute on function public.set_condominium_status(uuid, text) from anon;
grant execute on function public.set_condominium_status(uuid, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
