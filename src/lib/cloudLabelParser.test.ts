import { describe, expect, it } from "vitest";
import {
  destinationText,
  parseLabel,
} from "../../supabase/functions/extract-package-label/parser";
import { amazonLabel, mercadoLivreLabel } from "./__fixtures__/labels";

describe("parser da extração na nuvem", () => {
  it("lê a unidade de 'Complemento: 307' em etiqueta do Mercado Livre", () => {
    const parsed = parseLabel(mercadoLivreLabel);

    expect(destinationText(mercadoLivreLabel)).toContain("Complemento: 307");
    expect(parsed.unit_number).toBe("307");
    expect(parsed.recipient_name).toBe("Karolina Costa");
    expect(parsed.destination_street).toBe("Praia Botafogo");
    expect(parsed.destination_number).toBe("428");
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
    expect(
      parseLabel("DESTINATARIO\nNome Sobrenome\nComlemento: 307").unit_number,
    ).toBe("307");
    expect(
      parseLabel("DESTINATARIO\nNome Sobrenome\nCOMPLEMTO307").unit_number,
    ).toBe("307");
  });

  it("não pega o complemento do remetente", () => {
    const parsed = parseLabel(
      "DESTINATARIO\nNome Sobrenome\nAP 102\nREMETENTE\nLoja Teste\nComplemento: 307",
    );

    expect(parsed.unit_number).toBe("102");
  });

  it("não confunde BLOCH com bloco", () => {
    const parsed = parseLabel(
      "DESTINATARIO\nNome Sobrenome\nRUA EXEMPLO, 49-- BLOCO 1 APT 603",
    );

    expect(parsed.block_name).toBe("1");
    expect(parsed.unit_number).toBe("603");
  });

  it("não aceita via/acesso/km como nome do destinatário", () => {
    const amazon = parseLabel(
      [
        "DESTINATARIO",
        "VIA DE ACESSO NORTE KM 0,5",
        "Nome Sobrenome",
        "Complemento: 307",
        "ENDERECO: VIA DE ACESSO NORTE KM 0,5",
      ].join("\n"),
    );
    const semAncora = parseLabel(
      [
        "RODOVIA BR 101, KM 12",
        "VIA DE ACESSO NORTE KM 0,5",
        "Nome Sobrenome",
        "Complemento: 307",
      ].join("\n"),
    );

    expect(amazon.recipient_name).toBe("Nome Sobrenome");
    expect(amazon.destination_street).toBe("VIA DE ACESSO NORTE KM");
    expect(amazon.destination_number).toBe("0");
    expect(semAncora.recipient_name).toBe("Nome Sobrenome");
    expect(parseLabel(amazonLabel("22031040")).recipient_name).toBe(
      "GUILHERME NOGUEIRA COSTA E VALLE",
    );
  });

  it("usa o nome impresso para corrigir a transportadora deduzida do código", () => {
    const jadlog = parseLabel(
      "jadlog\nDESTINATARIO\nNome Sobrenome\n18250937612",
    );
    const mercadoLivre = parseLabel(
      "ML\nD-8748020049204\nNome Sobrenome\nComplemento: 307",
    );
    const totalExpress = parseLabel(
      "DESTINATARIO\nNome Sobrenome\nAP 1005\nTOTAL EXPRESS",
    );

    expect(jadlog.carrier).toBe("Jadlog");
    expect(mercadoLivre.carrier).toBe("Mercado Livre");
    expect(totalExpress.carrier).toBe("Total Express");
  });
});
