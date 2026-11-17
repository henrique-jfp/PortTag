-- Existing memberships may predate creator tracking, so preserve them without
-- inventing an audit value.
alter table public.condominium_users
  add column if not exists created_by uuid
  references auth.users (id) on delete restrict;

notify pgrst, 'reload schema';
