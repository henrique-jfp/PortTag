import { useEffect, useState, type FormEvent } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileSpreadsheet,
  Filter,
  Home,
  Hourglass,
  Package,
  PackageCheck,
  Printer,
  Timer,
  TrendingUp,
  Truck,
  UserCheck,
} from "lucide-react";
import {
  localDayAfter,
  localDayStart,
} from "../../lib/packageQueries";
import {
  allTimeRange,
  currentMonthRange,
  periodLabel,
  previousMonthRange,
  type ReportRange,
} from "../../lib/reportPeriod";
import { buildReportCsv, type Report, type ReportRow } from "../../lib/reportCsv";
import { supabase } from "../../lib/supabase";

function number(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR");
}

const TOP_LIMIT = 15;

function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function ReportTable({
  title,
  icon: Icon,
  rows,
  showStatus = false,
}: {
  title: string;
  icon: typeof Building2;
  rows: ReportRow[];
  showStatus?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const maxTotal = rows.reduce((max, row) => Math.max(max, row.total), 0) || 1;
  const hasMore = rows.length > TOP_LIMIT;
  const visibleRows = expanded ? rows : rows.slice(0, TOP_LIMIT);

  return (
    <div className="manager-card manager-report-card">
      <div className="manager-report-card-head">
        <span className="manager-report-card-icon" aria-hidden="true">
          <Icon size={17} />
        </span>
        <h3>{title}</h3>
        <span className="manager-report-card-count">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="manager-empty">Sem dados no período.</p>
      ) : (
        <>
        <div
          className={`manager-table-wrap${expanded && hasMore ? " is-expanded" : ""}`}
        >
          <table className="manager-table manager-ranking-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Total</th>
                {showStatus && <th>Na portaria</th>}
                {showStatus && <th>Retiradas</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => {
                const widthPct = Math.max(6, Math.round((row.total / maxTotal) * 100));
                const deliveredPct =
                  showStatus && row.total > 0
                    ? Math.round(((row.delivered ?? 0) / row.total) * 100)
                    : 100;
                const rankClass =
                  index === 0
                    ? "is-gold"
                    : index === 1
                      ? "is-silver"
                      : index === 2
                        ? "is-bronze"
                        : "";

                return (
                  <tr key={row.label} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
                    <td>
                      <div className="manager-rank-row">
                        <span className={`manager-rank-badge ${rankClass}`}>
                          {index + 1}º
                        </span>
                        <div className="manager-rank-main">
                          <span className="manager-rank-label">{row.label}</span>
                          <div className="manager-rank-track" aria-hidden="true">
                            <div
                              className="manager-rank-fill"
                              style={{ width: `${widthPct}%` }}
                            >
                              {showStatus ? (
                                <>
                                  <span
                                    className="manager-rank-delivered"
                                    style={{ width: `${deliveredPct}%` }}
                                  />
                                  <span
                                    className="manager-rank-pending"
                                    style={{ width: `${100 - deliveredPct}%` }}
                                  />
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{number(row.total)}</strong>
                    </td>
                    {showStatus && <td>{number(row.pending)}</td>}
                    {showStatus && <td>{number(row.delivered)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <button
            type="button"
            className="manager-report-more"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <>
                <ChevronUp size={15} aria-hidden="true" /> Mostrar só o TOP{" "}
                {TOP_LIMIT}
              </>
            ) : (
              <>
                <ChevronDown size={15} aria-hidden="true" /> Ver todos (
                {rows.length - TOP_LIMIT} restantes)
              </>
            )}
          </button>
        )}
        </>
      )}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="manager-report-skeleton" aria-busy="true" aria-label="Gerando relatório">
      <div className="manager-report-kpi-grid">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="manager-skeleton-card" />
        ))}
      </div>
      <div className="manager-skeleton-panel" />
      <div className="manager-report-grid">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="manager-skeleton-table" />
        ))}
      </div>
    </div>
  );
}

export function ManagerReportsPanel({
  condominiumId,
  buildingName = "",
}: {
  condominiumId: string;
  buildingName?: string;
}) {
  const [initialRange] = useState(currentMonthRange);
  const [previousMonth] = useState(previousMonthRange);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [blockId, setBlockId] = useState("");
  const [blocks, setBlocks] = useState<Array<{ id: string; name: string }>>([]);
  const [applied, setApplied] = useState<ReportRange & { blockId: string }>({
    ...initialRange,
    blockId: "",
  });
  const [report, setReport] = useState<Report | null>(null);
  const [generatedAt, setGeneratedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const currentMonth = initialRange;
  const blockName = blocks.find((block) => block.id === applied.blockId)?.name;
  const periodText = periodLabel(applied);

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
      const args = {
        p_condominium_id: condominiumId,
        p_date_from: applied.from ? localDayStart(applied.from) : null,
        p_date_to: applied.to ? localDayAfter(applied.to) : null,
        arg_block_id: applied.blockId || null,
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
        setGeneratedAt(new Date().toLocaleString("pt-BR"));
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

  function selectPeriod(range: ReportRange) {
    setDateFrom(range.from);
    setDateTo(range.to);
    setLoading(true);
    // O bloco escolhido continua valendo: o botão troca só o período.
    setApplied((current) => ({ ...current, ...range }));
  }

  function handleApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setApplied({ from: dateFrom, to: dateTo, blockId });
  }

  function handleExport() {
    if (!report) return;
    const csv = buildReportCsv(report, { ...applied, blockName });
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `relatorio-encomendas-${applied.from || "Completo"}${applied.to ? `-${applied.to}` : ""}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    if (!report || loading) return;
    const previousTitle = document.title;
    let restored = false;
    const restoreTitle = () => {
      if (restored) return;
      restored = true;
      document.title = previousTitle;
    };
    // O título vira o nome sugerido pelo navegador ao salvar como PDF.
    document.title = `TOP de encomendas - ${periodText}`;
    window.addEventListener("afterprint", restoreTitle, { once: true });
    window.setTimeout(restoreTitle, 2000);
    // O CSS de impressão mostra só o relatório; o navegador oferece
    // "Salvar como PDF", sem depender de biblioteca de PDF no bundle.
    window.print();
  }

  const summary = report?.summary;
  const totalCount = Number(summary?.total ?? 0);
  const deliveredCount = Number(summary?.delivered ?? 0);
  const pendingCount = Number(summary?.pending ?? 0);
  const deliveryRate = percent(deliveredCount, totalCount);
  const pendingRate = totalCount > 0 ? 100 - deliveryRate : 0;
  const donutRadius = 42;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const deliveredStroke = (deliveryRate / 100) * donutCircumference;

  return (
    <section className="manager-panel">
      <div className="manager-panel-heading manager-report-heading">
        <div>
          <p className="eyebrow">Indicadores</p>
          <h2>TOP de encomendas</h2>
          <p>
            Desempenho de recebimento e retirada por período. Por padrão, o mês
            vigente; escolha qualquer mês ou intervalo livre abaixo.
          </p>
        </div>
        <div className="manager-report-actions">
          <button
            className="secondary-button manager-icon-button"
            type="button"
            onClick={handleExport}
            disabled={!report || loading}
          >
            <FileSpreadsheet size={16} aria-hidden="true" />
            Exportar CSV
          </button>
          <button
            className="primary-button manager-icon-button"
            type="button"
            onClick={handlePrint}
            disabled={!report || loading}
          >
            <Printer size={16} aria-hidden="true" />
            Exportar PDF
          </button>
        </div>
      </div>

      <div
        className="manager-report-periods"
        role="group"
        aria-label="Período do relatório"
      >
        <button
          type="button"
          className={
            applied.from === currentMonth.from && applied.to === currentMonth.to
              ? "is-active"
              : ""
          }
          onClick={() => selectPeriod(currentMonth)}
        >
          <Calendar size={14} aria-hidden="true" />
          Mês atual
        </button>
        <button
          type="button"
          className={
            applied.from === previousMonth.from &&
            applied.to === previousMonth.to
              ? "is-active"
              : ""
          }
          onClick={() => selectPeriod(previousMonth)}
        >
          <Calendar size={14} aria-hidden="true" />
          Mês anterior
        </button>
        <button
          type="button"
          className={!applied.from && !applied.to ? "is-active" : ""}
          onClick={() => selectPeriod(allTimeRange)}
        >
          <TrendingUp size={14} aria-hidden="true" />
          Todo o período
        </button>
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
        <button type="submit" className="manager-icon-button">
          <Filter size={15} aria-hidden="true" />
          Aplicar recorte
        </button>
      </form>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <ReportSkeleton />
      ) : summary ? (
        <div className="manager-report-print">
          <header className="manager-report-print-header">
            <div>
              <p>PORTTAG · SÍNDICO · {buildingName || "Condomínio"}</p>
              <h2>TOP de encomendas</h2>
              <span>
                {periodText}
                {blockName ? ` · Bloco ${blockName}` : ""}
              </span>
            </div>
            <span>{generatedAt}</span>
          </header>

          <div className="manager-report-kpi-grid">
            <article className="manager-kpi-card is-primary">
              <div className="manager-kpi-top">
                <span className="manager-kpi-icon" aria-hidden="true">
                  <Package size={19} />
                </span>
                <span className="manager-kpi-badge">{periodText}</span>
              </div>
              <strong>{number(summary.total)}</strong>
              <span>Recebidas no período</span>
            </article>

            <article className="manager-kpi-card is-success">
              <div className="manager-kpi-top">
                <span className="manager-kpi-icon" aria-hidden="true">
                  <PackageCheck size={19} />
                </span>
                <span className="manager-kpi-badge">{deliveryRate}% entregues</span>
              </div>
              <strong>{number(summary.delivered)}</strong>
              <span>Retiradas pelos moradores</span>
            </article>

            <article className="manager-kpi-card is-info">
              <div className="manager-kpi-top">
                <span className="manager-kpi-icon" aria-hidden="true">
                  <Clock3 size={19} />
                </span>
                <span className="manager-kpi-badge">{pendingRate}% em aberto</span>
              </div>
              <strong>{number(summary.pending)}</strong>
              <span>Aguardando retirada</span>
            </article>

            <article className="manager-kpi-card is-neutral">
              <div className="manager-kpi-top">
                <span className="manager-kpi-icon" aria-hidden="true">
                  <Timer size={19} />
                </span>
                <span className="manager-kpi-badge">Média</span>
              </div>
              <strong>{number(summary.avg_hours)} h</strong>
              <span>Tempo até a retirada</span>
            </article>
          </div>

          <div className="manager-report-visual-row">
            <article className="manager-card manager-donut-card">
              <div className="manager-donut-wrap">
                <svg
                  className="manager-donut-svg"
                  viewBox="0 0 110 110"
                  role="img"
                  aria-label={`Taxa de retirada: ${deliveryRate}%`}
                >
                  <circle
                    className="manager-donut-track"
                    cx="55"
                    cy="55"
                    r={donutRadius}
                  />
                  <circle
                    className="manager-donut-progress"
                    cx="55"
                    cy="55"
                    r={donutRadius}
                    strokeDasharray={`${deliveredStroke} ${donutCircumference}`}
                  />
                </svg>
                <div className="manager-donut-center">
                  <strong>{deliveryRate}%</strong>
                  <span>retiradas</span>
                </div>
              </div>
              <div className="manager-donut-legend">
                <h3>Eficiência de entrega</h3>
                <p>
                  Proporção de encomendas já retiradas em relação ao total
                  recebido no recorte.
                </p>
                <ul>
                  <li>
                    <span className="dot is-delivered" />
                    Retiradas: <strong>{number(deliveredCount)}</strong>
                  </li>
                  <li>
                    <span className="dot is-pending" />
                    Na portaria: <strong>{number(pendingCount)}</strong>
                  </li>
                </ul>
              </div>
            </article>

            <article className="manager-card manager-aging-card">
              <div className="manager-aging-head">
                <div>
                  <h3>Encomendas paradas na portaria</h3>
                  <p>Distribuição por tempo de espera em relação a hoje.</p>
                </div>
              </div>
              <div className="manager-aging-grid">
                <div className="manager-aging-item is-amber">
                  <span className="manager-aging-icon" aria-hidden="true">
                    <Hourglass size={16} />
                  </span>
                  <strong>{number(summary.older3)}</strong>
                  <span>Há mais de 3 dias</span>
                </div>
                <div className="manager-aging-item is-orange">
                  <span className="manager-aging-icon" aria-hidden="true">
                    <AlertTriangle size={16} />
                  </span>
                  <strong>{number(summary.older7)}</strong>
                  <span>Há mais de 7 dias</span>
                </div>
                <div className="manager-aging-item is-red">
                  <span className="manager-aging-icon" aria-hidden="true">
                    <AlertOctagon size={16} />
                  </span>
                  <strong>{number(summary.older15)}</strong>
                  <span>Há mais de 15 dias</span>
                </div>
              </div>
            </article>
          </div>

          <div className="manager-report-grid manager-report-split">
            <div className="manager-report-column">
              <ReportTable
                title="Por bloco"
                icon={Building2}
                rows={report?.byBlock ?? []}
                showStatus
              />
              <ReportTable
                title="Por porteiro"
                icon={UserCheck}
                rows={report?.byPorter ?? []}
              />
              <ReportTable
                title="Por empresa / entregador"
                icon={Truck}
                rows={report?.bySender ?? []}
              />
            </div>
            <div className="manager-report-column">
              <ReportTable
                title="Por unidade"
                icon={Home}
                rows={report?.byUnit ?? []}
                showStatus
              />
            </div>
          </div>

          <footer className="manager-report-print-footer">
            PortTag · Relatório gerado no painel do síndico. Os contadores "há
            mais de X dias" são calculados em relação à data de geração.
          </footer>
        </div>
      ) : (
        <p className="manager-empty">Nenhum dado disponível.</p>
      )}
    </section>
  );
}
