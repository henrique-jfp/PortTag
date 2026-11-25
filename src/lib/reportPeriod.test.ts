import { describe, expect, it } from "vitest";
import {
  allTimeRange,
  currentMonthRange,
  dateKey,
  periodLabel,
  previousMonthRange,
} from "./reportPeriod";

describe("recortes de período dos relatórios", () => {
  it("usa o mês vigente por padrão", () => {
    expect(currentMonthRange(new Date(2026, 10, 24, 18, 30))).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });

  it("respeita ano bissexto e virada de ano", () => {
    expect(currentMonthRange(new Date(2024, 1, 14))).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(previousMonthRange(new Date(2026, 0, 15))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("monta a chave da data no fuso local", () => {
    expect(dateKey(new Date(2026, 10, 1))).toBe("2026-11-01");
  });

  it("descreve o período escolhido", () => {
    expect(periodLabel(currentMonthRange(new Date(2026, 10, 24)))).toBe(
      "2026-11-01 a 2026-11-30",
    );
    expect(periodLabel({ from: "2026-11-01", to: "" })).toBe(
      "A partir de 2026-11-01",
    );
    expect(periodLabel({ from: "", to: "2026-11-30" })).toBe(
      "Até 2026-11-30",
    );
    expect(periodLabel(allTimeRange)).toBe("Todo o período");
  });
});
