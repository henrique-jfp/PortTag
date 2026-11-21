import { describe, expect, it, vi } from "vitest";
import {
  analyzeResidentImport,
  applyImportBlockChoice,
  guessResidentColumnMapping,
  mapResidentRows,
  normalizePhone,
  parseResidentFile,
  readResidentFile,
  toRpcResidentRows,
} from "./residentImport";

vi.mock("read-excel-file/browser", () => ({
  readSheet: vi.fn(async () => [
    ["Apartamento", "Bloco", "Nome", "Telefone"],
    ["201", "B", "Carla", "+55 21 98888-7777"],
  ]),
}));

function csvFile(content: string, name = "moradores.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

function xlsxFile(name = "moradores.xlsx"): File {
  return new File(["planilha"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("readResidentFile + mapeamento explícito", () => {
  it("lê CSV pt-BR com BOM, ponto e vírgula e aspas do Excel", async () => {
    const source = await readResidentFile(
      csvFile(
        '\uFEFFApartamento;Bloco;Nome;Telefone\r\n101;A;"Silva, Ana";(21) 99999-8888\r\n',
      ),
    );

    expect(source.headers).toEqual([
      "Apartamento",
      "Bloco",
      "Nome",
      "Telefone",
    ]);
    expect(source.rows).toEqual([
      ["101", "A", "Silva, Ana", "(21) 99999-8888"],
    ]);

    const mapping = guessResidentColumnMapping(source.headers);
    expect(mapping).toEqual({ unit: 0, block: 1, names: [2], phones: [3] });
    expect(mapResidentRows(source, mapping)).toEqual([
      {
        unit_number: "101",
        block_name: "A",
        name: "Silva, Ana",
        whatsapp: "21999998888",
      },
    ]);
  });

  it("aceita cabeçalhos fora do dicionário quando o usuário mapeia a coluna", async () => {
    const source = await readResidentFile(
      csvFile(
        "Título do relatório\nNº do imóvel;Apt;Complemento;Pessoa destinatária;Contato\n101;201;A;Marina;21988887777\n",
      ),
    );

    expect(source.headers).toEqual([
      "Nº do imóvel",
      "Apt",
      "Complemento",
      "Pessoa destinatária",
      "Contato",
    ]);

    const mapping = {
      unit: 1,
      block: 2,
      names: [3],
      phones: [4],
    };

    expect(mapResidentRows(source, mapping)).toEqual([
      {
        unit_number: "201",
        block_name: "A",
        name: "Marina",
        whatsapp: "21988887777",
      },
    ]);
  });

  it("gera um morador por coluna quando a planilha usa Morador 1, 2 e 3", async () => {
    const source = await readResidentFile(
      csvFile(
        "Apto;Morador 1;Morador 2;Morador 3;WhatsApp 1;WhatsApp 2;WhatsApp 3\n101;Ana;Bruno;Carla;21911112222;21933334444;21955556666\n",
      ),
    );

    const mapping = guessResidentColumnMapping(source.headers);
    expect(mapping.names).toEqual([1, 2, 3]);
    expect(mapping.phones).toEqual([4, 5, 6]);

    expect(mapResidentRows(source, mapping)).toEqual([
      {
        unit_number: "101",
        block_name: null,
        name: "Ana",
        whatsapp: "21911112222",
      },
      {
        unit_number: "101",
        block_name: null,
        name: "Bruno",
        whatsapp: "21933334444",
      },
      {
        unit_number: "101",
        block_name: null,
        name: "Carla",
        whatsapp: "21955556666",
      },
    ]);
  });

  it("sugere Unid e deixa nome/telefone fora quando não há sugestão", async () => {
    const source = await readResidentFile(
      csvFile("Unid;Bloco\n302;C\n"),
    );

    const mapping = guessResidentColumnMapping(source.headers);

    expect(mapping.unit).toBe(0);
    expect(mapping.block).toBe(1);
    expect(mapping.names).toEqual([]);
    expect(mapping.phones).toEqual([]);
    expect(mapResidentRows(source, mapping)).toEqual([
      {
        unit_number: "302",
        block_name: "C",
        name: null,
        whatsapp: null,
      },
    ]);
  });

  it("lê XLSX e mantém a compatibilidade de parseResidentFile", async () => {
    const rows = await parseResidentFile(xlsxFile());

    expect(rows).toEqual([
      {
        unit_number: "201",
        block_name: "B",
        name: "Carla",
        whatsapp: "21988887777",
      },
    ]);
  });

  it("falha com arquivo vazio ou sem linhas de dados", async () => {
    await expect(readResidentFile(csvFile(""))).rejects.toThrow(
      /planilha está vazia/i,
    );
    await expect(
      readResidentFile(csvFile("Apartamento;Nome\n")),
    ).rejects.toThrow(/não tem linhas de moradores/i);
  });
});

describe("applyImportBlockChoice", () => {
  const rows = [
    {
      unit_number: "101",
      block_name: "A",
      name: "Ana",
      whatsapp: null,
    },
  ];

  it("mantém os blocos da planilha quando não há escolha", () => {
    expect(applyImportBlockChoice(rows, null)).toEqual(rows);
  });

  it("remove o bloco quando o condomínio é de bloco único", () => {
    expect(applyImportBlockChoice(rows, "none")[0].block_name).toBeNull();
  });

  it("usa Bloco 1 quando é o primeiro bloco", () => {
    expect(applyImportBlockChoice(rows, "first")[0].block_name).toBe("Bloco 1");
  });
});

describe("normalizePhone", () => {
  it("aceita telefones com máscara e remove código do país", () => {
    expect(normalizePhone("(21) 98888-7777")).toBe("21988887777");
    expect(normalizePhone("+55 21 98888 7777")).toBe("21988887777");
  });
});

describe("analyzeResidentImport", () => {
  it("classifica linhas prontas, apenas unidade, duplicatas e erros", () => {
    const analysis = analyzeResidentImport([
      {
        unit_number: "101",
        block_name: "A",
        name: "Ana",
        whatsapp: "21999998888",
      },
      {
        unit_number: "102",
        block_name: "A",
        name: null,
        whatsapp: null,
      },
      {
        unit_number: "101",
        block_name: "A",
        name: "Ana",
        whatsapp: "21999998888",
      },
      {
        unit_number: "",
        block_name: "A",
        name: "Sem unidade",
        whatsapp: null,
      },
    ]);

    expect(analysis.counts).toEqual({
      total: 4,
      ready: 1,
      unitOnly: 1,
      duplicates: 1,
      errors: 1,
    });
    expect(analysis.importableRows).toHaveLength(2);
  });
});

describe("toRpcResidentRows", () => {
  it("converte campos vazios em null", () => {
    expect(
      toRpcResidentRows([
        {
          unit_number: " 101 ",
          block_name: " A ",
          name: " ",
          whatsapp: "",
        },
      ]),
    ).toEqual([
      {
        unit_number: "101",
        block_name: "A",
        name: null,
        whatsapp: null,
      },
    ]);
  });
});
