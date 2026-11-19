import { describe, expect, it } from "vitest";
import {
  destinationText,
  parseLabel,
} from "../../supabase/functions/extract-package-label/parser";
import {
  amazonLabel,
  correiosLabel,
  mercadoLivreLabel,
  shopeeLabel,
} from "./__fixtures__/labels";

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

  it("não confunde código de galpão da Amazon com o destinatário", () => {
    const semNove = parseLabel(
      [
        "XCV - NTS AFT - X FC",
        "Via de Acesso Norte , Km 38 , Galpao 7",
        "Cajamar SP 07789-100",
        "GUILHERME NOGUEIRA COSTA E VALLE",
        "Praca Edmundo Bittencourt 15",
      ].join("\n"),
    );
    const comoOcr = parseLabel(
      ["NTS AFT - XFC", "GUILHERME NOGUEIRA COSTA E VALLE"].join("\n"),
    );

    expect(semNove.recipient_name).toBe("GUILHERME NOGUEIRA COSTA E VALLE");
    expect(comoOcr.recipient_name).toBe("GUILHERME NOGUEIRA COSTA E VALLE");
  });

  it("escolhe o CEP de entrega quando a Amazon imprime o CEP do remetente antes", () => {
    const label = [
      "XCV9 - NTS AFT - X FC",
      "Via de Acesso Norte , Km 38 , Galpao 7",
      "Cajamar SP 07700-100",
      "JOAQUIM BATISTA DOS SANTOS",
      "AP 102",
      "Praca Edmundo Bittencourt 15",
      "202 Copacabana",
      "Rio de Janeiro RJ 22041012 Brazil",
      "R 22041012",
      "TBR447963439",
    ].join("\n");

    const parsed = parseLabel(label);

    expect(parsed.recipient_name).toBe("JOAQUIM BATISTA DOS SANTOS");
    expect(parsed.unit_number).toBe("102");
    expect(parsed.destination_cep).toBe("22041-012");
  });

  it("não troca o CEP de destino pelo CEP do remetente nas etiquetas conhecidas", () => {
    expect(parseLabel(amazonLabel("22031040")).destination_cep).toBe(
      "22031-040",
    );
    expect(parseLabel(shopeeLabel).destination_cep).toBe("22421-022");
    expect(parseLabel(correiosLabel).destination_cep).toBe("22210-040");
    expect(parseLabel(mercadoLivreLabel).destination_cep).toBe("22260-040");
  });

  it("lê transportadora e código de entrega de etiqueta Shippify", () => {
    const parsed = parseLabel(
      [
        "TRANSP: SHIPPIFY TECNOLOGIA LTDA",
        "REMETENTE",
        "R GENERAL POLIDORO, 113",
        "CODIGO DE ENTREGA",
        "048888",
      ].join("\n"),
    );

    expect(parsed.carrier).toBe("Shippify");
    expect(parsed.tracking_code).toBe("048888");
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

describe("regras publicadas no Label Lab", () => {
  const text = [
    "DESTINATARIO",
    "Nome Antigo",
    "APTO 99",
    "TRANSP: OUTRA EMPRESA",
    "ETIQUETA 123456",
    "RUA TESTE, 100",
    "CEP 12345-678",
  ].join("\n");

  it("aplica as regex publicadas somente nos campos não determinísticos", () => {
    const parsed = parseLabel(text, {
      carrier: [{ pattern: "TRANSP:\\s*([A-Z ]+)" }],
      tracking_code: [{ pattern: "ETIQUETA\\s*(\\d{6})" }],
      unit_number: [{ pattern: "APTO\\s*(\\d+)" }],
      recipient_name: [{ pattern: "Nome\\s+(\\w+)" }],
    });

    expect(parsed.carrier).toBe("OUTRA EMPRESA");
    expect(parsed.tracking_code).toBe("123456");
    expect(parsed.unit_number).toBe("99");
    expect(parsed.recipient_name).toBe("Antigo");
    expect(parsed.destination_cep).toBe("12345-678");
    expect(parsed.destination_street).toBe("RUA TESTE");
    expect(parsed.destination_number).toBe("100");
  });

  it("canoniza transportadora conhecida e ignora campo de endereço", () => {
    const shippifyText = [
      "TRANSP: SHIPPIFY TECNOLOGIA LTDA",
      "DESTINATARIO",
      "Nome Antigo",
      "APTO 99",
      "CODIGO DE ENTREGA 048888",
      "CEP 12345-678",
    ].join("\n");
    const parsed = parseLabel(shippifyText, {
      carrier: [{ pattern: "TRANSP:\\s*(SHIPPIFY)" }],
      destination_cep: [{ pattern: "(\\d{5}-\\d{3})" }],
    } as Parameters<typeof parseLabel>[1]);

    expect(parsed.carrier).toBe("Shippify");
    expect(parsed.destination_cep).toBe("12345-678");
  });

  it("mantém o parser embutido se a regex publicada falhar", () => {
    const builtIn = parseLabel(text);
    const parsed = parseLabel(text, {
      tracking_code: [{ pattern: "(" }],
    });

    expect(parsed).toEqual(builtIn);
  });
});
