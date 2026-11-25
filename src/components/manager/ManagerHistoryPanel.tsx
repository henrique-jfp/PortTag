import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Filter,
  MessageCircle,
  PackageCheck,
  PackagePlus,
} from "lucide-react";
import { Pagination } from "../Pagination";
import { localDayAfter, localDayStart } from "../../lib/packageQueries";
import { supabase } from "../../lib/supabase";

const PAGE_SIZE = 50;

type HistoryEvent = {
  id: string;
  package_id: string;
  event_type: string;
  description: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
};

type AppliedFilters = {
  dateFrom: string;
  dateTo: string;
  eventType: string;
  blockId: string;
};

const eventLabels: Record<string, string> = {
  received: "Recebimento",
  collected: "Retirada",
  notification: "Aviso ao morador",
  damage_reported: "Avaria",
};

const eventIcons: Record<string, typeof PackagePlus> = {
  received: PackagePlus,
  collected: PackageCheck,
  notification: MessageCircle,
  damage_reported: AlertTriangle,
};

const emptyFilters: AppliedFilters = {
  dateFrom: "",
  dateTo: "",
  eventType: "",
  blockId: "",
};

export function ManagerHistoryPanel({
  condominiumId,
}: {
  condominiumId: string;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [eventType, setEventType] = useState("");
  const [blockId, setBlockId] = useState("");
  const [blocks, setBlocks] = useState<Array<{ id: string; name: string }>>([]);
  const [applied, setApplied] = useState<AppliedFilters>(emptyFilters);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error: blocksError } = await supabase
        .from("blocks")
        .select("id, name")
        .eq("condominium_id", condominiumId)
        .order("name");
      if (!active || blocksError) return;
      setBlocks((data ?? []) as Array<{ id: string; name: string }>);
    })();
    return () => {
      active = false;
    };
  }, [condominiumId]);

  useEffect(() => {
    let active = true;

    void (async () => {
      let query = supabase
        .from("package_events")
        .select(
          "id, package_id, event_type, description, occurred_at, metadata",
          { count: "exact" },
        )
        .eq("condominium_id", condominiumId);
      if (applied.dateFrom) {
        query = query.gte("occurred_at", localDayStart(applied.dateFrom));
      }
      if (applied.dateTo) {
        query = query.lt("occurred_at", localDayAfter(applied.dateTo));
      }
      if (applied.eventType) {
        query = query.eq("event_type", applied.eventType);
      }
      if (applied.blockId) {
        query = query.eq("block_id", applied.blockId);
      }

      const { data, error: queryError, count } = await query
        .order("occurred_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (!active) return;
      if (queryError) {
        setError(`Não foi possível carregar o histórico. ${queryError.message}`);
      } else {
        setEvents((data ?? []) as HistoryEvent[]);
        setTotal(count ?? 0);
      }
      setLoading(false);
    })().catch((cause: unknown) => {
      if (!active) return;
      setError(
        cause instanceof Error
          ? `Não foi possível carregar o histórico. ${cause.message}`
          : "Não foi possível carregar o histórico.",
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId, applied, page]);

  function handleApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setPage(1);
    setApplied({ dateFrom, dateTo, eventType, blockId });
  }

  return (
    <section className="manager-panel">
      <div className="manager-panel-heading">
        <div>
          <p className="eyebrow">Auditoria</p>
          <h2>Linha do tempo do caderno</h2>
          <p>
            Registro somente leitura dos eventos de cada encomenda, gerado
            automaticamente pelas operações da portaria.
          </p>
        </div>
      </div>

      <form className="manager-filter-form" onSubmit={handleApply}>
        <label>
          De
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
        <label>
          Evento
          <select
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
          >
            <option value="">Todos</option>
            <option value="received">Recebimento</option>
            <option value="collected">Retirada</option>
            <option value="notification">Aviso ao morador</option>
            <option value="damage_reported">Avaria</option>
          </select>
        </label>
        <label>
          Bloco
          <select
            value={blockId}
            onChange={(event) => setBlockId(event.target.value)}
          >
            <option value="">Todos os blocos</option>
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>
                {block.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">
          <Filter size={15} aria-hidden="true" />
          Filtrar
        </button>
      </form>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="manager-empty">Carregando histórico...</p>
      ) : events.length === 0 ? (
        <p className="manager-empty">Nenhum evento no recorte selecionado.</p>
      ) : (
        <ul className="manager-timeline">
          {events.map((event) => {
            const tracking = event.metadata?.tracking_code;
            const EventIcon = eventIcons[event.event_type] ?? PackagePlus;
            return (
              <li key={event.id} className={`manager-event-${event.event_type}`}>
                <span className="manager-event-type">
                  <EventIcon size={13} aria-hidden="true" />
                  {eventLabels[event.event_type] ?? event.event_type}
                </span>
                <div>
                  <strong>{event.description}</strong>
                  <small>
                    {new Date(event.occurred_at).toLocaleString("pt-BR")}
                    {typeof tracking === "string" && tracking
                      ? ` · ${tracking}`
                      : ""}
                  </small>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        onChange={setPage}
        disabled={loading}
        label="Páginas da auditoria"
      />
    </section>
  );
}
