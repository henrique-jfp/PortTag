import { useEffect, useState, type FormEvent } from "react";
import { localDayAfter, localDayStart } from "../../lib/packageQueries";
import { supabase } from "../../lib/supabase";

type HistoryEvent = {
  id: string;
  package_id: string;
  event_type: string;
  description: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
};

const eventLabels: Record<string, string> = {
  received: "Recebimento",
  collected: "Retirada",
  notification: "Aviso ao morador",
  damage_reported: "Avaria",
};

export function ManagerHistoryPanel({
  condominiumId,
}: {
  condominiumId: string;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [eventType, setEventType] = useState("");
  const [applied, setApplied] = useState({
    dateFrom: "",
    dateTo: "",
    eventType: "",
  });
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      let query = supabase
        .from("package_events")
        .select(
          "id, package_id, event_type, description, occurred_at, metadata",
        )
        .eq("condominium_id", condominiumId)
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (applied.dateFrom) {
        query = query.gte("occurred_at", localDayStart(applied.dateFrom));
      }
      if (applied.dateTo) {
        query = query.lt("occurred_at", localDayAfter(applied.dateTo));
      }
      if (applied.eventType) {
        query = query.eq("event_type", applied.eventType);
      }

      const { data, error: queryError } = await query;
      if (!active) return;
      if (queryError) {
        setError(`Não foi possível carregar o histórico. ${queryError.message}`);
      } else {
        setEvents((data ?? []) as HistoryEvent[]);
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
  }, [condominiumId, applied]);

  function handleApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setApplied({ dateFrom, dateTo, eventType });
  }

  return (
    <section className="manager-panel">
      <div className="manager-panel-heading">
        <div>
          <p className="eyebrow">Auditoria</p>
          <h2>Histórico do caderno</h2>
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
        <button type="submit">Filtrar</button>
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
            return (
              <li key={event.id} className={`manager-event-${event.event_type}`}>
                <span className="manager-event-type">
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
      <p className="field-hint">
        Exibindo até 200 eventos mais recentes do recorte.
      </p>
    </section>
  );
}
