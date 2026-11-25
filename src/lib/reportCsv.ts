export type ReportRow = {
  label: string;
  total: number;
  pending?: number;
  delivered?: number;
};

export type Report = {
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

type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell) {
  const text = value == null ? "" : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function line(cells: CsvCell[]) {
  return cells.map(escapeCell).join(";");
}

/** CSV com BOM para abrir corretamente no Excel em Portuguese (Brasil). */
export function buildReportCsv(
  report: Report,
  range: { from: string; to: string; blockName?: string },
) {
  const rows: CsvCell[][] = [
    ["Relatório TOP de encomendas"],
    ["De", range.from || "Todo o período", "Até", range.to || "Todo o período"],
  ];
  if (range.blockName) rows.push(["Bloco", range.blockName]);
  rows.push(
    [],
    ["Resumo", "Valor"],
    ["Recebidas", report.summary.total],
    ["Retiradas", report.summary.delivered],
    ["Aguardando retirada", report.summary.pending],
    ["Tempo médio até a retirada (h)", report.summary.avg_hours],
    ["Há mais de 3 dias", report.summary.older3],
    ["Há mais de 7 dias", report.summary.older7],
    ["Há mais de 15 dias", report.summary.older15],
    [],
  );

  const tables: Array<[string, ReportRow[], boolean]> = [
    ["Por bloco", report.byBlock, true],
    ["Por unidade", report.byUnit, true],
    ["Por empresa / entregador", report.bySender, false],
    ["Por porteiro", report.byPorter, false],
  ];

  tables.forEach(([title, tableRows, showStatus]) => {
    rows.push([title]);
    rows.push(
      showStatus
        ? ["Item", "Total", "Na portaria", "Retiradas"]
        : ["Item", "Total"],
    );
    tableRows.forEach((row) => {
      rows.push(
        showStatus
          ? [row.label, row.total, row.pending ?? 0, row.delivered ?? 0]
          : [row.label, row.total],
      );
    });
    rows.push([]);
  });

  return `\uFEFF${rows.map(line).join("\r\n")}`;
}
