import { useEffect, useState, type FormEvent } from "react";
import {
  localDayAfter,
  localDayStart,
} from "../../lib/packageQueries";
import { supabase } from "../../lib/supabase";

type ReportRow = { label: string; total: number; pending?: number; delivered?: number };
type Report = {
  summary: {
    total: number;
    pending: number;
    delivered: number;
    older3: number;
    older7: number;
    older15: number;
    avg_hours: number;
  };
  byBlock: ReportRow[];
  byUnit: ReportRow[];
  bySender: ReportRow[];
  byPorter: ReportRow[];
};

function number(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR");
}

function ReportTable({
  title,
  rows,
  showStatus = false,
}: {
  title: string;
  rows: ReportRow[];
  showStatus?: boolean;
}) {
  return (
    <div className="manager-card">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="manager-empty">Sem dados no período.</p>
      ) : (
        <div className="manager-table-wrap">
          <table className="manager-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Total</th>
                {showStatus && <th>Na portaria</th>}
                {showStatus && <th>Entregues</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{number(row.total)}</td>
                  {showStatus && <td>{number(row.pending)}</td>}
                  {showStatus && <td>{number(row.delivered)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ManagerReportsPanel({
  condominiumId,
}: {
  condominiumId: string;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" });
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      const args = {
        p_condominium_id: condominiumId,
        p_date_from: applied.from ? localDayStart(applied.from) : null,
        p_date_to: applied.to ? localDayAfter(applied.to) : null,
      };
      const { data, error: rpcError } = await supabase.rpc(
        "manager_package_report",
        args,
      );
      if (!active) return;
      if (rpcError) {
        setError(`Não foi possível gerar o relatório. ${rpcError.message}`);
      } else {
        setReport(data as Report);
      }
      setLoading(false);
    })().catch((cause: unknown) => {
      if (!active) return;
      setError(
        cause instanceof Error
          ? `Não foi possível gerar o relatório. ${cause.message}`
          : "Não foi possível gerar o relatório.",
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
    setApplied({ from: dateFrom, to: dateTo });
  }

  const summary = report?.summary;

  return (
    <section className="manager-panel">
      <div className="manager-panel-heading">
        <div>
          <p className="eyebrow">Indicadores</p>
          <h2>Relatórios</h2>
          <p>
            Recorte por data de recebimento. Sem datas, o relatório considera
            todo o histórico do condomínio.
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
        <button type="submit">Aplicar recorte</button>
      </form>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="manager-empty">Gerando relatório...</p>
      ) : summary ? (
        <>
          <div className="manager-summary-grid">
            <div>
              <strong>{number(summary.total)}</strong>
              <span>Recebidas</span>
            </div>
            <div>
              <strong>{number(summary.delivered)}</strong>
              <span>Entregues</span>
            </div>
            <div>
              <strong>{number(summary.pending)}</strong>
              <span>Aguardando retirada</span>
            </div>
            <div>
              <strong>{number(summary.avg_hours)} h</strong>
              <span>Tempo médio até a retirada</span>
            </div>
            <div>
              <strong>{number(summary.older3)}</strong>
              <span>Há mais de 3 dias</span>
            </div>
            <div>
              <strong>{number(summary.older7)}</strong>
              <span>Há mais de 7 dias</span>
            </div>
            <div>
              <strong>{number(summary.older15)}</strong>
              <span>Há mais de 15 dias</span>
            </div>
          </div>

          <div className="manager-report-grid">
            <ReportTable title="Por bloco" rows={report?.byBlock ?? []} showStatus />
            <ReportTable title="Por unidade" rows={report?.byUnit ?? []} showStatus />
            <ReportTable title="Por empresa / entregador" rows={report?.bySender ?? []} />
            <ReportTable title="Por porteiro" rows={report?.byPorter ?? []} />
          </div>
        </>
      ) : (
        <p className="manager-empty">Nenhum dado disponível.</p>
      )}
    </section>
  );
}
