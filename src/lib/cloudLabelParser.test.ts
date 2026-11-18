import { describe, expect, it } from "vitest";
import {
  destinationText,
  parseLabel,
} from "../../supabase/functions/extract-package-label/parser";
import { mercadoLivreLabel } from "./__fixtures__/labels";

describe("parser da extração na nuvem", () => {
  it("lê a unidade de 'Complemento: 307' em etiqueta do Mercado Livre", () => {
    const parsed = parseLabel(mercadoLivreLabel);

    expect(destinationText(mercadoLivreLabel)).toContain("Complemento: 307");
    expect(parsed.unit_number).toBe("307");
  });

  it("aceita complemento colado e com outros separadores", () => {
    expect(
      parseLabel("DESTINATARIO\nNome Sobrenome\nComplemento:307").unit_number,
    ).toBe("307");
    expect(
      parseLabel("DESTINATARIO\nNome Sobrenome\nCOMPLEMENTO-307").unit_number,
    ).toBe("307");
    expect(
      parseLabel("DESTINATARIO\nNome Sobrenome\nComplemento #307").unit_number,
    ).toBe("307");
  });

  it("não pega o complemento do remetente", () => {
    const parsed = parseLabel(
      "DESTINATARIO\nNome Sobrenome\nAP 102\nREMETENTE\nLoja Teste\nComplemento: 307",
    );

    expect(parsed.unit_number).toBe("102");
  });
});
