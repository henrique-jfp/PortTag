-- As funções criadas no schema public nascem com EXECUTE para `public` e para
-- `anon` (default privileges do Supabase). As migrations anteriores revogam de
-- `public` caso a caso; a que faltou (handle_new_auth_user) continuava
-- alcançável por anon. Na prática anon podia chamar qualquer RPC do schema:
-- create_package, create_condominium, register_package_notification...
-- Todas barram por auth.uid(), mas não deveriam nem ser alcançáveis.
--
-- Nenhuma tela do produto chama RPC antes do login, então anon não precisa de
-- nenhuma função deste schema. `authenticated` e `service_role` mantêm acesso.

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

-- Reforça o que é explícito: o app usa authenticated e as Edge Functions usam
-- service_role. Nenhum dos dois deve depender da herança de PUBLIC.
grant execute on all functions in schema public to authenticated, service_role;

-- Impede que a próxima migration volte a abrir a mesma porta. São duas
-- instruções porque ALTER DEFAULT PRIVILEGES aceita uma ação por vez.
alter default privileges in schema public
  revoke execute on functions from public;

alter default privileges in schema public
  revoke execute on functions from anon;

notify pgrst, 'reload schema';
