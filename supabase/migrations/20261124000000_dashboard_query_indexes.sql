-- Índices para as consultas agregadas do painel do síndico e da tela inicial
-- do porteiro. Com histórico longo, contagens e amostras passam a tocar só as
-- linhas do recorte, em vez de varrer o caderno inteiro. As policies RLS continuam
-- sendo aplicadas da mesma forma.

create index if not exists packages_condominium_status_received_idx
  on public.packages (condominium_id, status, received_at desc);

create index if not exists packages_pending_without_notice_idx
  on public.packages (condominium_id, received_at desc)
  where status = 'received' and last_notified_at is null;

create index if not exists packages_active_damage_expiry_idx
  on public.packages (condominium_id, photo_expires_at)
  where is_damaged
    and receipt_path is not null
    and photo_deleted_at is null;

create index if not exists package_events_condominium_actor_occurred_idx
  on public.package_events (condominium_id, actor_id, occurred_at desc);
