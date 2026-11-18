import { describe, expect, it } from "vitest";
import {
  detectDeliveryCompany,
  extractTrackingCode,
  matchKnownBarcode,
} from "./packageLabelOcr";

/**
 * Códigos tirados das etiquetas reais e do diagnóstico do aparelho. O risco
 * aqui é achar rastreio onde não existe: chave de acesso da NF-e, payload do QR
 * do Mercado Livre e Order ID da Amazon não são rastreio.
 */
describe("código de rastreio", () => {
  it("reconhece o TBR da Amazon", () => {
    expect(extractTrackingCode("TBR466671737")).toBe("TBR466671737");
  });

  it("reconhece o BR da Shopee", () => {
    expect(extractTrackingCode("BR2683799363326")).toBe("BR2683799363326");
  });

  it("reconhece o código dos Correios impresso com espaços", () => {
    expect(extractTrackingCode("AD 758 301 405 BR")).toBe("AD758301405BR");
  });

  it("não confunde a chave de acesso da NF-e com rastreio", () => {
    const chave = "352609331160930001735500200000094741847931271";

    expect(extractTrackingCode(chave)).toBe("");
  });

  it("não confunde o payload do QR do Mercado Livre com rastreio", () => {
    expect(extractTrackingCode('{"id":"48020049204","t":"lm"}')).toBe("");
  });

  it("não confunde o Order ID da Amazon com rastreio", () => {
    expect(extractTrackingCode("Order ID: 702-5292765-3347456")).toBe("");
  });
});

describe("código de barras", () => {
  it("reconhece os formatos fortes e devolve a transportadora", () => {
    expect(matchKnownBarcode(["AD758301405BR"])).toEqual({
      code: "AD758301405BR",
      carrier: "Correios",
    });
    expect(matchKnownBarcode(["TBR469201312"])).toEqual({
      code: "TBR469201312",
      carrier: "Amazon",
    });
    expect(matchKnownBarcode(["AMZC177804265tx"])).toEqual({
      code: "AMZC177804265TX",
      carrier: "Amazon",
    });
    expect(matchKnownBarcode(["BR2614136204776"])).toEqual({
      code: "BR2614136204776",
      carrier: "Shopee",
    });
    expect(matchKnownBarcode(["AJ261003140887301"])).toEqual({
      code: "AJ261003140887301",
      carrier: "Anjun",
    });
  });

  it("reconhece os formatos fracos apenas quando o valor é exatamente o código", () => {
    expect(matchKnownBarcode(["999881844285138"])?.carrier).toBe(
      "J&T Express",
    );
    expect(matchKnownBarcode(["49754569205683"])?.carrier).toBe("iMile");
    expect(matchKnownBarcode(["48020049204"])?.carrier).toBe(
      "Mercado Livre",
    );
    expect(matchKnownBarcode(['{"id":"48020049204","t":"lm"}'])).toBeNull();
  });

  it("não inventa formato conhecido para leitura inconclusiva", () => {
    expect(matchKnownBarcode([])).toBeNull();
    expect(matchKnownBarcode(["12345"])).toBeNull();
    expect(matchKnownBarcode(["702-5292765-3347456"])).toBeNull();
  });
});

describe("transportadora", () => {
  it("identifica a Amazon pelo código TBR", () => {
    expect(detectDeliveryCompany("TBR466671737")).toBe("Amazon");
  });

  it("identifica a Shopee pelo código BR", () => {
    expect(detectDeliveryCompany("BR2683799363326")).toBe("Shopee");
  });

  it("identifica os Correios pela marca SEDEX", () => {
    expect(detectDeliveryCompany("SEDEX")).toBe("Correios");
  });

  it("identifica o Mercado Livre pelo texto da etiqueta", () => {
    expect(detectDeliveryCompany("Mercado Livre Envios")).toBe("Mercado Livre");
  });
});
