import { describe, expect, it } from "vitest";
import {
  carrierForLabel,
  carrierValues,
  normalizeCarrier,
} from "../../supabase/functions/extract-package-label/carrier";

describe("enum de transportadora (Gemini)", () => {
  it("aceita somente os valores da lista fechada", () => {
    expect(carrierValues).toEqual([
      "Correios",
      "Amazon",
      "Shopee",
      "Anjun",
      "J&T Express",
      "iMile",
      "Mercado Livre",
      "Jadlog",
      "Total Express",
      "Shippify",
      "unknown",
    ]);
    for (const carrier of carrierValues) {
      expect(normalizeCarrier(carrier)).toBe(carrier);
    }
  });

  it("não inventa transportadora a partir de valores fora do enum", () => {
    expect(normalizeCarrier("Shein")).toBe("unknown");
    expect(normalizeCarrier("J&T")).toBe("unknown");
    expect(normalizeCarrier("")).toBe("unknown");
    expect(normalizeCarrier(null)).toBe("unknown");
  });

  it("deixa empresa vazia quando a transportadora é desconhecida", () => {
    expect(carrierForLabel("unknown")).toBe("");
    expect(carrierForLabel("Shein")).toBe("");
    expect(carrierForLabel(" Amazon ")).toBe("Amazon");
  });
});
