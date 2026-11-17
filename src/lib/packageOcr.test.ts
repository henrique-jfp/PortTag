import { describe, expect, it } from "vitest";
import {
  extractRecipientName,
  findDestinationSection,
  findUnitCandidates,
  verifyPackageDestinationAddress,
  type PackageDestinationAddress,
} from "./packageOcr";
import {
  amazonLabel,
  correiosLabel,
  mercadoLivreLabel,
  shopeeLabel,
} from "./__fixtures__/labels";

/** Condomínio de teste: o CEP chega do cadastro com hífen, a etiqueta só com dígitos. */
const casteloBranco: PackageDestinationAddress = {
  cep: "22031-040",
  street: "Rua Presidente Castelo Branco",
  address_number: "100",
};

const shopeeAddress: PackageDestinationAddress = {
  cep: "22421-022",
  street: "Rua Nascimento Silva",
  address_number: "110",
};

const correiosAddress: PackageDestinationAddress = {
  cep: "22210-040",
  street: "Rua Ferreira Viana",
  address_number: "45",
};

const mercadoLivreAddress: PackageDestinationAddress = {
  cep: "22260-040",
  street: "Praia Botafogo",
  address_number: "428",
};

function verify(
  recognizedText: string,
  address: PackageDestinationAddress = casteloBranco,
) {
  return verifyPackageDestinationAddress({ recognizedText, address });
}

describe("etiqueta da Amazon", () => {
  it("confirma pelo CEP mesmo sem o cabeçalho DESTINATÁRIO", () => {
    const result = verify(amazonLabel("22031040"));

    expect(result.status).toBe("verified");
  });

  it("lê o destinatário sem cabeçalho", () => {
    const name = extractRecipientName(amazonLabel("22031040"), [], "22031040");

    expect(name).toBe("GUILHERME NOGUEIRA COSTA E VALLE");
  });

  it("não inventa bloco de destino quando o CEP é de outro endereço", () => {
    const label = amazonLabel("22041050");

    expect(verify(label).status).toBe("unknown");
    expect(findDestinationSection(label, [], "22031040")).toBe("");
  });
});

describe("etiqueta da Shopee", () => {
  it("bloqueia quando o CEP de destino é de outro endereço", () => {
    const result = verify(shopeeLabel);

    expect(result.status).toBe("mismatch");
    expect(extractRecipientName(shopeeLabel, [], "22031040")).toBe(
      "Gabriella Bomtempo Freire",
    );
  });

  it("confirma quando o condomínio é o do destino", () => {
    const result = verify(shopeeLabel, shopeeAddress);

    expect(result.status).toBe("verified");
    expect(extractRecipientName(shopeeLabel, [], shopeeAddress.cep)).toBe(
      "Gabriella Bomtempo Freire",
    );
  });
});

describe("etiqueta dos Correios", () => {
  it("ignora o bloco Recebedor e compara o destino", () => {
    const result = verify(correiosLabel);

    expect(result.status).toBe("mismatch");
    expect(extractRecipientName(correiosLabel, [], "22031040")).toBe(
      "KATIA ARGOLLO",
    );
  });

  it("confirma quando o condomínio é o do destino", () => {
    expect(verify(correiosLabel, correiosAddress).status).toBe("verified");
  });
});

describe("etiqueta do Mercado Livre", () => {
  it("não confunde o bloco do vendedor com o do destinatário", () => {
    const result = verify(mercadoLivreLabel);

    expect(result.status).toBe("mismatch");
    expect(extractRecipientName(mercadoLivreLabel, [], "22031040")).toBe(
      "Karolina Costa",
    );
  });

  it("confirma quando o condomínio é o do destino", () => {
    expect(verify(mercadoLivreLabel, mercadoLivreAddress).status).toBe(
      "verified",
    );
  });
});

describe("sem CEP legível", () => {
  it("confirma por logradouro e número", () => {
    const label = `DESTINATARIO
MARIA SOUZA
RUA PRESIDENTE CASTELO BRANCO 100, COPACABANA
RIO DE JANEIRO RJ`;

    const result = verify(label);

    expect(result.status).toBe("verified");
    expect(result.message).toContain("Logradouro e número");
  });

  it("bloqueia rua diferente com número presente", () => {
    const label = `DESTINATARIO
JOAO DA SILVA
RUA DAS ACACIAS 100, CENTRO
RIO DE JANEIRO RJ`;

    expect(verify(label).status).toBe("mismatch");
  });

  it("não bloqueia por CEP do remetente", () => {
    const label = `DESTINATARIO
ANA LIMA
RUA PRESIDENTE CASTELO BRANCO 100, COPACABANA
RIO DE JANEIRO RJ
CEP: 99999-999
REMETENTE
EMPRESA X
AV PAULISTA 1000 SAO PAULO SP 01310-100`;

    expect(verify(label).status).toBe("verified");
  });
});

describe("CEP fora do texto reconhecido", () => {
  it("confirma pelo CEP lido no código de barras", () => {
    const result = verifyPackageDestinationAddress({
      recognizedText: "texto ilegivel pela metade",
      barcodeText: "https://rastreio.exemplo/22031040",
      address: casteloBranco,
    });

    expect(result.status).toBe("verified");
  });

  it("confirma pelo CEP da passada numérica", () => {
    const result = verifyPackageDestinationAddress({
      recognizedText: "etiqueta borrada",
      numericText: "22031 040",
      address: casteloBranco,
    });

    expect(result.status).toBe("verified");
  });
});

describe("unidade do apartamento", () => {
  it("sai do bloco do destinatário, não do bloco do vendedor", () => {
    const section = findDestinationSection(mercadoLivreLabel, [], "22260040");
    const units = findUnitCandidates(
      `${mercadoLivreLabel}\n${section}`,
      [
        { id: "u110", unit_number: "110" },
        { id: "u305", unit_number: "305" },
        { id: "u307", unit_number: "307" },
      ],
    );

    expect(units.map((unit) => unit.unit_number)).toEqual(["307"]);
  });
});
