/** Recortes de período usados pelos relatórios do síndico. */
export type ReportRange = {
  from: string;
  to: string;
};

/** Chave de data local (`YYYY-MM-DD`), sem deslocar o dia por UTC. */
export function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function currentMonthRange(now = new Date()): ReportRange {
  return {
    from: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

export function previousMonthRange(now = new Date()): ReportRange {
  return {
    from: dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    to: dateKey(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
}

export const allTimeRange: ReportRange = { from: "", to: "" };

export function periodLabel(range: ReportRange) {
  if (!range.from && !range.to) return "Todo o período";
  if (range.from && range.to) return `${range.from} a ${range.to}`;
  return range.from ? `A partir de ${range.from}` : `Até ${range.to}`;
}
