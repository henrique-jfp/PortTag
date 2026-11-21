import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Clock3,
  Package,
  PackageCheck,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  dateKey,
  localDayAfter,
  localDayStart,
  type PackageFilters,
} from "../lib/packageQueries";
import type { NotebookBuilding } from "./PackageNotebook";

type StatKey = "received" | "collected" | "today" | "older3" | "older7";
type DashboardStats = Record<StatKey | "total", number>;

type Boundaries = {
  now: number;
  todayKey: string;
  todayStart: string;
  todayAfter: string;
  older3: string;
  older7: string;
};

type PackageRow = {
  id: string;
  condominium_id: string;
  unit_number: string;
  block_name: string | null;
  tracking_code: string | null;
  received_at: string;
  is_damaged: boolean;
  receipt_path: string | null;
  photo_expires_at: string;
  photo_deleted_at: string | null;
};

type EventRow = {
  id: string;
  condominium_id: string;
  event_type: string;
  description: string;
  occurred_at: string;
};

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  context: string;
  priority: number;
  filters: PackageFilters;
};

type LatestMovement = {
  id: string;
  title: string;
  occurredAt: string;
  context: string;
};

type AttentionData = {
  damagedCount: number;
  expiringCount: number;
  withoutNoticeCount: number;
  items: AttentionItem[];
  latest: LatestMovement[];
};

export type PackageFilterPreset = {
  filters: PackageFilters;
  label: string;
};

type Snapshot = {
  key: string;
  stats: DashboardStats;
  attention: AttentionData;
  boundaries: Boundaries;
  updatedAt: Date;
  error: string;
  attentionError: string;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const PHOTO_WARNING_DAYS = 5;

const emptyStats: DashboardStats = {
  total: 0,
  received: 0,
  collected: 0,
  today: 0,
  older3: 0,
  older7: 0,
};

const emptyAttention: AttentionData = {
  damagedCount: 0,
  expiringCount: 0,
  withoutNoticeCount: 0,
  items: [],
  latest: [],
};

const eventLabels: Record<string, string> = {
  received: "Recebimento",
  collected: "Retirada",
  notification: "Aviso ao morador",
  damage_reported: "Avaria",
};

const statKeys: StatKey[] = [
  "received",
  "collected",
  "today",
  "older3",
  "older7",
];

function currentBoundaries(): Boundaries {
  const now = Date.now();
  const today = dateKey(new Date(now).toISOString());
  return {
    now,
    todayKey: today,
    todayStart: localDayStart(today),
    todayAfter: localDayAfter(today),
    older3: new Date(now - 3 * DAY_IN_MS).toISOString(),
    older7: new Date(now - 7 * DAY_IN_MS).toISOString(),
  };
}

function messageFrom(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function unitLabel(packageRow: PackageRow) {
  return packageRow.block_name
    ? `${packageRow.block_name} · ${packageRow.unit_number}`
    : packageRow.unit_number;
}

function packageFilters(packageRow: PackageRow): PackageFilters {
  return packageRow.tracking_code
    ? { tracking: packageRow.tracking_code }
    : { unit: packageRow.unit_number };
}

function daysUntil(value: string, now: number) {
  return Math.ceil((new Date(value).getTime() - now) / DAY_IN_MS);
}

/** Contagens no banco: nenhum registro é baixado e as RLS continuam valendo. */
async function countPackages(
  condominiumId: string,
  key: StatKey,
  boundaries: Boundaries,
) {
  let query = supabase
    .from("packages")
    .select("id", { count: "exact", head: true })
    .eq("condominium_id", condominiumId);

  switch (key) {
    case "received":
      query = query.eq("status", "received");
      break;
    case "collected":
      query = query.eq("status", "collected");
      break;
    case "today":
      query = query
        .gte("received_at", boundaries.todayStart)
        .lt("received_at", boundaries.todayAfter);
      break;
    case "older3":
      query = query
        .eq("status", "received")
        .lt("received_at", boundaries.older3);
      break;
    case "older7":
      query = query
        .eq("status", "received")
        .lt("received_at", boundaries.older7);
      break;
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function loadStats(
  buildingIds: string[],
  boundaries: Boundaries,
): Promise<DashboardStats> {
  const results = await Promise.all(
    buildingIds.map(async (condominiumId) => {
      const counts = await Promise.all(
        statKeys.map((key) => countPackages(condominiumId, key, boundaries)),
      );
      return statKeys.reduce(
        (result, key, index) => {
          result[key] += counts[index];
          return result;
        },
        { ...emptyStats },
      );
    }),
  );

  const summary = results.reduce(
    (total, result) => {
      statKeys.forEach((key) => {
        total[key] += result[key];
      });
      return total;
    },
    { ...emptyStats },
  );

  return { ...summary, total: summary.received + summary.collected };
}

const PAGE_SIZE = 500;
const PACKAGE_COLUMNS =
  "id, condominium_id, unit_number, block_name, tracking_code, received_at, is_damaged, receipt_path, photo_expires_at, photo_deleted_at";

async function fetchAllReceived(buildingIds: string[]): Promise<PackageRow[]> {
  const rows: PackageRow[] = [];
  let from = 0;

  while (true) {
    const { data, error, count } = await supabase
      .from("packages")
      .select(PACKAGE_COLUMNS, { count: "exact" })
      .eq("status", "received")
      .in("condominium_id", buildingIds)
      .order("received_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as PackageRow[];
    rows.push(...page);
    const total = count ?? 0;
    from += PAGE_SIZE;
    if (!page.length || from >= total) break;
  }

  return rows;
}

async function fetchAllDamaged(buildingIds: string[]): Promise<PackageRow[]> {
  const rows: PackageRow[] = [];
  let from = 0;

  while (true) {
    const { data, error, count } = await supabase
      .from("packages")
      .select(PACKAGE_COLUMNS, { count: "exact" })
      .eq("is_damaged", true)
      .in("condominium_id", buildingIds)
      .order("received_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as PackageRow[];
    rows.push(...page);
    const total = count ?? 0;
    from += PAGE_SIZE;
    if (!page.length || from >= total) break;
  }

  return rows;
}

async function fetchAllEvents(buildingIds: string[]): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let from = 0;

  while (true) {
    const { data, error, count } = await supabase
      .from("package_events")
      .select("id, condominium_id, event_type, description, occurred_at", {
        count: "exact",
      })
      .in("condominium_id", buildingIds)
      .order("occurred_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as EventRow[];
    rows.push(...page);
    const total = count ?? 0;
    from += PAGE_SIZE;
    if (!page.length || from >= total) break;
  }

  return rows;
}

async function fetchNotifiedIds(packageIds: string[]): Promise<Set<string>> {
  const notified = new Set<string>();
  const chunkSize = 200;

  for (let start = 0; start < packageIds.length; start += chunkSize) {
    const chunk = packageIds.slice(start, start + chunkSize);
    let from = 0;

    while (true) {
      const { data, error, count } = await supabase
        .from("package_notifications")
        .select("package_id", { count: "exact" })
        .in("package_id", chunk)
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(error.message);
      const page = data ?? [];
      page.forEach((row) => notified.add(row.package_id));
      const total = count ?? 0;
      from += PAGE_SIZE;
      if (!page.length || from >= total) break;
    }
  }

  return notified;
}

async function loadAttention(
  buildingIds: string[],
  buildingNames: Map<string, string>,
  boundaries: Boundaries,
): Promise<AttentionData> {
  const [received, damaged, events] = await Promise.all([
    fetchAllReceived(buildingIds),
    fetchAllDamaged(buildingIds),
    fetchAllEvents(buildingIds),
  ]);

  const notifiedIds = await fetchNotifiedIds(received.map((item) => item.id));

  const items = new Map<string, AttentionItem>();
  function add(item: AttentionItem) {
    const current = items.get(item.id);
    if (!current || item.priority > current.priority) {
      items.set(item.id, item);
    }
  }

  received.forEach((item) => {
    const context = buildingNames.get(item.condominium_id) ?? "Condomínio";
    const filters = packageFilters(item);
    const receivedAt = new Date(item.received_at).getTime();

    if (receivedAt < new Date(boundaries.older7).getTime()) {
      add({
        id: item.id,
        title: "Há mais de 7 dias na portaria",
        detail: `${unitLabel(item)} · recebida em ${new Date(item.received_at).toLocaleString("pt-BR")}`,
        context,
        priority: 4,
        filters: { ...filters, status: "received" },
      });
    } else if (receivedAt < new Date(boundaries.older3).getTime()) {
      add({
        id: item.id,
        title: "Há mais de 3 dias na portaria",
        detail: `${unitLabel(item)} · recebida em ${new Date(item.received_at).toLocaleString("pt-BR")}`,
        context,
        priority: 3,
        filters: { ...filters, status: "received" },
      });
    }

    if (!notifiedIds.has(item.id)) {
      add({
        id: item.id,
        title: "Aguardando retirada sem aviso",
        detail: `${unitLabel(item)} · nenhum aviso registrado na fila`,
        context,
        priority: 2,
        filters: { ...filters, status: "received" },
      });
    }
  });

  const activeDamaged = damaged.filter(
    (item) => item.receipt_path && !item.photo_deleted_at,
  );
  activeDamaged.forEach((item) => {
    const days = daysUntil(item.photo_expires_at, boundaries.now);
    const expiring = days <= PHOTO_WARNING_DAYS;
    add({
      id: item.id,
      title: expiring ? "Foto da avaria expirando" : "Encomenda avariada",
      detail: expiring
        ? `${unitLabel(item)} · foto expira em ${Math.max(0, days)} dia(s)`
        : `${unitLabel(item)} · foto disponível por mais ${days} dia(s)`,
      context: buildingNames.get(item.condominium_id) ?? "Condomínio",
      priority: expiring ? 5 : 2,
      filters: packageFilters(item),
    });
  });

  const latest = events.slice(0, 5).map((event) => ({
    id: event.id,
    title: `${eventLabels[event.event_type] ?? "Evento"}: ${event.description}`,
    occurredAt: event.occurred_at,
    context: buildingNames.get(event.condominium_id) ?? "Condomínio",
  }));

  return {
    damagedCount: activeDamaged.length,
    expiringCount: activeDamaged.filter(
      (item) => daysUntil(item.photo_expires_at, boundaries.now) <= PHOTO_WARNING_DAYS,
    ).length,
    withoutNoticeCount: received.filter((item) => !notifiedIds.has(item.id))
      .length,
    items: [...items.values()].sort(
      (a, b) => b.priority - a.priority || a.title.localeCompare(b.title, "pt-BR"),
    ),
    latest,
  };
}

/**
 * Visão geral do síndico. Com mais de um condomínio vinculado, os números são
 * a soma de todos os cadernos aos quais a conta tem acesso.
 */
export function ManagerDashboard({
  buildings,
  onOpenPackages,
}: {
  buildings: NotebookBuilding[];
  onOpenPackages: (preset: PackageFilterPreset) => void;
}) {
  const buildingKey = buildings.map((building) => building.id).join("|");
  const buildingNames = new Map(
    buildings.map((building) => [building.id, building.name]),
  );
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const requestKey = `${buildingKey}#${refresh}`;
  const isCurrent = snapshot?.key === requestKey;
  const loading = !isCurrent;
  const stats = isCurrent ? snapshot.stats : null;
  const attention = isCurrent ? snapshot.attention : null;
  const boundaries = isCurrent
    ? snapshot.boundaries
    : currentBoundaries();
  const error = isCurrent ? snapshot.error : "";
  const attentionError = isCurrent ? snapshot.attentionError : "";
  const updatedAt = isCurrent ? snapshot.updatedAt : null;

  useEffect(() => {
    let active = true;
    const buildingIds = buildingKey.split("|");
    const nextBoundaries = currentBoundaries();

    void Promise.allSettled([
      loadStats(buildingIds, nextBoundaries),
      loadAttention(buildingIds, buildingNames, nextBoundaries),
    ]).then(([statsResult, attentionResult]) => {
      if (!active) return;
      setSnapshot({
        key: requestKey,
        stats:
          statsResult.status === "fulfilled" ? statsResult.value : emptyStats,
        attention:
          attentionResult.status === "fulfilled"
            ? attentionResult.value
            : emptyAttention,
        boundaries: nextBoundaries,
        updatedAt: new Date(),
        error:
          statsResult.status === "rejected"
            ? messageFrom(statsResult.reason, "Não foi possível carregar os indicadores.")
            : "",
        attentionError:
          attentionResult.status === "rejected"
            ? messageFrom(attentionResult.reason, "Não foi possível carregar os alertas.")
            : "",
      });
    });

    return () => {
      active = false;
    };
    // buildingNames é derivado de buildingKey; incluí-la aqui reiniciaria o loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingKey, refresh, requestKey]);

  function openPreset(label: string, filters: PackageFilters) {
    onOpenPackages({ label, filters });
  }

  const cards: Array<{
    key: keyof DashboardStats;
    label: string;
    hint: string;
    icon: typeof Package;
    tone: string;
    filters: PackageFilters;
  }> = [
    {
      key: "total",
      label: "Total de encomendas",
      hint: "Recebidas no condomínio",
      icon: Package,
      tone: "neutral",
      filters: {},
    },
    {
      key: "received",
      label: "Aguardando retirada",
      hint: "Na portaria agora",
      icon: ClipboardList,
      tone: "info",
      filters: { status: "received" },
    },
    {
      key: "collected",
      label: "Retiradas",
      hint: "Retiradas registradas",
      icon: PackageCheck,
      tone: "success",
      filters: { status: "collected" },
    },
    {
      key: "today",
      label: "Recebidas hoje",
      hint: "Desde a meia-noite local",
      icon: TrendingUp,
      tone: "info",
      filters: { dateFrom: boundaries.todayKey, dateTo: boundaries.todayKey },
    },
    {
      key: "older3",
      label: "Há mais de 3 dias",
      hint: "Aguardando retirada",
      icon: Clock3,
      tone: "warning",
      filters: { status: "received", receivedBefore: boundaries.older3 },
    },
    {
      key: "older7",
      label: "Há mais de 7 dias",
      hint: "Aguardando retirada",
      icon: AlertTriangle,
      tone: "danger",
      filters: { status: "received", receivedBefore: boundaries.older7 },
    },
  ];

  const subtitle =
    buildings.length === 1
      ? `Indicadores de ${buildings[0].name}`
      : `Somatório de ${buildings.length} condomínios`;
  const firstDamageItem = attention?.items.find(
    (item) =>
      item.title === "Foto da avaria expirando" ||
      item.title === "Encomenda avariada",
  );

  return (
    <section className="overview-card" aria-labelledby="overview-title">
      <div className="overview-heading">
        <div>
          <p className="eyebrow">Visão geral</p>
          <h2 id="overview-title">Indicadores do caderno</h2>
          <p>
            {subtitle}
            {updatedAt &&
              ` · atualizado às ${updatedAt.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}`}
          </p>
        </div>
        <button
          className="secondary-button overview-refresh"
          type="button"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Atualizar
        </button>
      </div>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          Não foi possível carregar os indicadores. {error}
        </p>
      )}
      {attentionError && (
        <p className="feedback-message feedback-error" role="alert">
          Não foi possível carregar os alertas. {attentionError}
        </p>
      )}

      <div className="overview-grid" aria-busy={loading}>
        {cards.map(({ key, label, hint, icon: Icon, tone, filters }) => (
          <button
            className={`overview-stat overview-stat-${tone}`}
            key={key}
            type="button"
            disabled={loading}
            aria-label={`${label}: ${loading ? "carregando" : (stats?.[key] ?? 0)}. Abrir em Encomendas`}
            onClick={() => openPreset(label, filters)}
          >
            <span className="overview-stat-icon" aria-hidden="true">
              <Icon size={19} />
            </span>
            <strong className="overview-stat-value">
              {loading ? "—" : (stats?.[key] ?? 0).toLocaleString("pt-BR")}
            </strong>
            <span className="overview-stat-label">{label}</span>
            <small>{hint}</small>
            <span className="overview-stat-action" aria-hidden="true">
              <ArrowRight size={15} />
            </span>
          </button>
        ))}
      </div>

      <div className="overview-alerts" aria-label="Atenção imediata">
        <article className="overview-alert">
          <div>
            <p className="eyebrow">Atenção imediata</p>
            <h3>Avarias e fotos</h3>
          </div>
          <strong>{loading ? "—" : (attention?.damagedCount ?? 0)}</strong>
          <p>
            {loading
              ? "Carregando..."
              : `${attention?.expiringCount ?? 0} com foto expirando nos próximos ${PHOTO_WARNING_DAYS} dias.`}
          </p>
          <button
            className="text-button"
            type="button"
            disabled={!firstDamageItem}
            onClick={() => {
              if (firstDamageItem) {
                openPreset(firstDamageItem.title, firstDamageItem.filters);
              }
            }}
          >
            Ver registro
          </button>
        </article>
        <article className="overview-alert">
          <div>
            <p className="eyebrow">Atenção imediata</p>
            <h3>Sem aviso ao morador</h3>
          </div>
          <strong>{loading ? "—" : (attention?.withoutNoticeCount ?? 0)}</strong>
          <p>Pacotes na portaria sem aviso registrado na fila.</p>
          <button
            className="text-button"
            type="button"
            onClick={() =>
              openPreset("Aguardando retirada", { status: "received" })
            }
          >
            Ver aguardando retirada
          </button>
        </article>
      </div>

      <div className="overview-bottom">
        <section className="overview-attention" aria-labelledby="attention-title">
          <div className="overview-section-heading">
            <h3 id="attention-title">Requer atenção agora</h3>
            <span>
              {loading ? "..." : `${attention?.items.length ?? 0} item(ns)`}
            </span>
          </div>
          {loading ? (
            <p className="manager-empty">Carregando alertas...</p>
          ) : attention?.items.length ? (
            <ul className="overview-attention-list">
              {attention.items.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openPreset(item.title, item.filters)}
                  >
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.context} · {item.detail}
                      </small>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="overview-all-clear">
              <strong>Tudo em dia na portaria</strong>
              <span>
                Sem atrasos, avarias pendentes ou pacotes sem aviso no recorte
                acompanhado.
              </span>
            </div>
          )}
        </section>

        <section className="overview-latest" aria-labelledby="latest-title">
          <div className="overview-section-heading">
            <h3 id="latest-title">Últimas 5 movimentações</h3>
          </div>
          {loading ? (
            <p className="manager-empty">Carregando...</p>
          ) : attention?.latest.length ? (
            <ul className="overview-latest-list">
              {attention.latest.map((movement) => (
                <li key={movement.id}>
                  <strong>{movement.title}</strong>
                  <small>
                    {new Date(movement.occurredAt).toLocaleString("pt-BR")} ·{" "}
                    {movement.context}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="manager-empty">Nenhuma movimentação registrada.</p>
          )}
        </section>
      </div>
    </section>
  );
}
