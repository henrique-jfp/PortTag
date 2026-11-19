import { useEffect, useState } from "react";
import {
  AlertTriangle,
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
} from "../lib/packageQueries";
import type { NotebookBuilding } from "./PackageNotebook";

type StatKey = "received" | "collected" | "today" | "older3" | "older7";

type DashboardStats = Record<StatKey | "total", number>;

type Boundaries = {
  todayStart: string;
  todayAfter: string;
  older3: string;
  older7: string;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function currentBoundaries(): Boundaries {
  const today = dateKey(new Date().toISOString());
  const now = Date.now();
  return {
    todayStart: localDayStart(today),
    todayAfter: localDayAfter(today),
    older3: new Date(now - 3 * DAY_IN_MS).toISOString(),
    older7: new Date(now - 7 * DAY_IN_MS).toISOString(),
  };
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

const emptyStats: DashboardStats = {
  total: 0,
  received: 0,
  collected: 0,
  today: 0,
  older3: 0,
  older7: 0,
};

type Snapshot = {
  key: string;
  stats: DashboardStats;
  updatedAt: Date;
  error: string;
};

const statKeys: StatKey[] = [
  "received",
  "collected",
  "today",
  "older3",
  "older7",
];

/**
 * Visão geral do síndico. Com mais de um condomínio vinculado, os números são
 * a soma de todos os cadernos aos quais a conta tem acesso.
 */
export function ManagerDashboard({ buildings }: { buildings: NotebookBuilding[] }) {
  const buildingKey = buildings.map((building) => building.id).join("|");
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  // O carregamento é derivado da chave da consulta: não é preciso sincronizar
  // flags de loading/erro dentro do effect.
  const requestKey = `${buildingKey}#${refresh}`;
  const isCurrent = snapshot?.key === requestKey;
  const loading = !isCurrent;
  const stats = isCurrent ? snapshot.stats : null;
  const error = isCurrent ? snapshot.error : "";
  const updatedAt = isCurrent ? snapshot.updatedAt : null;

  useEffect(() => {
    let active = true;

    const buildingIds = buildingKey.split("|");
    const boundaries = currentBoundaries();

    void Promise.all(
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
    )
      .then((results) => {
        if (!active) return;
        const summary = results.reduce(
          (total, result) => {
            statKeys.forEach((key) => {
              total[key] += result[key];
            });
            return total;
          },
          { ...emptyStats },
        );
        setSnapshot({
          key: requestKey,
          stats: {
            ...summary,
            total: summary.received + summary.collected,
          },
          updatedAt: new Date(),
          error: "",
        });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setSnapshot({
          key: requestKey,
          stats: emptyStats,
          updatedAt: new Date(),
          error:
            cause instanceof Error
              ? cause.message
              : "Não foi possível carregar os indicadores.",
        });
      });

    return () => {
      active = false;
    };
  }, [buildingKey, refresh, requestKey]);

  const cards = [
    {
      key: "total" as const,
      label: "Total de encomendas",
      hint: "Recebidas no condomínio",
      icon: Package,
      tone: "neutral",
    },
    {
      key: "received" as const,
      label: "Aguardando retirada",
      hint: "Na portaria agora",
      icon: ClipboardList,
      tone: "info",
    },
    {
      key: "collected" as const,
      label: "Entregues",
      hint: "Retiradas registradas",
      icon: PackageCheck,
      tone: "success",
    },
    {
      key: "today" as const,
      label: "Recebidas hoje",
      hint: "Desde a meia-noite local",
      icon: TrendingUp,
      tone: "info",
    },
    {
      key: "older3" as const,
      label: "Há mais de 3 dias",
      hint: "Aguardando retirada",
      icon: Clock3,
      tone: "warning",
    },
    {
      key: "older7" as const,
      label: "Há mais de 7 dias",
      hint: "Aguardando retirada",
      icon: AlertTriangle,
      tone: "danger",
    },
  ];

  const subtitle =
    buildings.length === 1
      ? `Indicadores de ${buildings[0].name}`
      : `Somatório de ${buildings.length} condomínios`;

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

      <div className="overview-grid" aria-busy={loading}>
        {cards.map(({ key, label, hint, icon: Icon, tone }) => (
          <article
            className={`overview-stat overview-stat-${tone}`}
            key={key}
            aria-label={`${label}: ${loading ? "carregando" : (stats?.[key] ?? 0)}`}
          >
            <span className="overview-stat-icon" aria-hidden="true">
              <Icon size={19} />
            </span>
            <strong className="overview-stat-value">
              {loading
                ? "—"
                : (stats?.[key] ?? 0).toLocaleString("pt-BR")}
            </strong>
            <span className="overview-stat-label">{label}</span>
            <small>{hint}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
