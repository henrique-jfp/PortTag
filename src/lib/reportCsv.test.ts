import { describe, expect, it } from "vitest";
import { buildReportCsv, type Report } from "./reportCsv";

const report: Report = {
  summary: {
    total: 10,
    pending: 4,
    delivered: 6,
    older3: 2,
    older7: 1,
    older15: 0,
    avg_hours: 4.5,
  },
  byBlock: [{ label: "1", total: 10, pending: 4, delivered: 6 }],
  byUnit: [{ label: "1 · 1006", total: 10, pending: 4, delivered: 6 }],
  bySender: [{ label: "Não informado", total: 10 }],
  byPorter: [{ label: "Não identificado", total: 10 }],
};

describe("exportação do relatório em CSV", () => {
  it("abre com BOM, usa ; e escreve o título TOP", () => {
    const csv = buildReportCsv(report, { from: "2026-11-01", to: "2026-11-30" });
    const lines = csv.split("\r\n");

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(lines[0]).toBe("\uFEFFRelatório TOP de encomendas");
    expect(lines[1]).toBe("De;2026-11-01;Até;2026-11-30");
    expect(lines).toContain("Recebidas;10");
    expect(lines).toContain("1 · 1006;10;4;6");
    expect(lines).toContain("Não informado;10");
  });

  it("mostra o bloco no cabeçalho quando o recorte é por bloco", () => {
    const csv = buildReportCsv(report, {
      from: "2026-11-01",
      to: "2026-11-30",
      blockName: "Bloco 1",
    });

    expect(csv.split("\r\n")[2]).toBe("Bloco;Bloco 1");
  });

  it("sem datas escreve Todo o período", () => {
    const csv = buildReportCsv(report, { from: "", to: "" });

    expect(csv.split("\r\n")[1]).toBe("De;Todo o período;Até;Todo o período");
  });
});
