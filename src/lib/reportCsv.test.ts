import { describe, expect, it } from "vitest";
import { buildReportCsv, type Report } from "./reportCsv";

const report: Report = {
  summary: {
    total: 12,
    pending: 5,
    delivered: 7,
    older3: 2,
    older7: 1,
    older15: 0,
    avg_hours: 18.5,
  },
  byBlock: [
    { label: 'Torre "A"; Bloco 1', total: 12, pending: 5, delivered: 7 },
  ],
  byUnit: [{ label: "302", total: 3, pending: 1, delivered: 2 }],
  bySender: [{ label: "Shopee", total: 4 }],
  byPorter: [{ label: "João", total: 6 }],
};

describe("buildReportCsv", () => {
  it("includes the applied range, summary and every report table", () => {
    const csv = buildReportCsv(report, { from: "2026-11-01", to: "2026-11-19" });

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("De;2026-11-01;Até;2026-11-19");
    expect(csv).toContain("Recebidas;12");
    expect(csv).toContain("Retiradas;7");
    expect(csv).toContain("Por bloco");
    expect(csv).toContain('"Torre ""A""; Bloco 1";12;5;7');
    expect(csv).toContain("Por empresa / entregador");
    expect(csv).toContain("Shopee;4");
  });

  it("labels an empty range as the full history", () => {
    const csv = buildReportCsv(report, { from: "", to: "" });
    expect(csv).toContain("De;Todo o período;Até;Todo o período");
  });
});
