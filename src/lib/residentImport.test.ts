import { describe, expect, it, vi } from "vitest";
import {
  analyzeResidentImport,
  normalizePhone,
  parseResidentFile,
  toRpcResidentRows,
  type ResidentImportRow,
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

describe("parseResidentFile — CSV", () => {
  it("lê CSV pt-BR com BOM, ponto e vírgula e aspas do Excel", async () => {
    const file = csvFile(
      '\uFEFFApartamento;Bloco;Nome;Telefone\r\n101;A;"Silva, Ana";(21) 99999-8888\r\n',
    );

    const rows = await parseResidentFile(file);

    expect(rows).toEqual([
      {
        unit_number: "101",
        block_name: "A",
        name: "Silva, Ana",
        whatsapp: "21999998888",
      },
    ]);
  });

  it("lê CSV com vírgula e aceita cabeçalhos alternativos", async () => {
    const file = csvFile(
      "Apto,Morador,Whatsapp\n102,João,21988887777\n",
      "moradores-virgula.csv",
    );

    const rows = await parseResidentFile(file);

    expect(rows).toEqual([
      {
        unit_number: "102",
        block_name: null,
        name: "João",
        whatsapp: "21988887777",
      },
    ]);
  });

  it("avisa quando não há coluna de apartamento", async () => {
    const file = csvFile("Bloco,Nome,Telefone\nA,João,21988887777\n");

    await expect(parseResidentFile(file)).rejects.toThrow(/apartamento/i);
  });

  it("rejeita extensões desconhecidas", async () => {
    const file = new File(["101,A,Maria"], "moradores.txt");

    await expect(parseResidentFile(file)).rejects.toThrow(/não suportado/i);
  });
});

describe("parseResidentFile — planilha", () => {
  it("despacha .xlsx para o parser de planilha e normaliza a primeira linha", async () => {
    const file = new File(["conteúdo"], "moradores.xlsx");

    const rows = await parseResidentFile(file);

    expect(rows).toEqual([
      {
        unit_number: "201",
        block_name: "B",
        name: "Carla",
        whatsapp: "21988887777",
      },
    ]);
  });
});

describe("normalizePhone", () => {
  it("remove formatação e o código do país quando presente", () => {
    expect(normalizePhone("(21) 99999-8888")).toBe("21999998888");
    expect(normalizePhone("+55 21 99999-8888")).toBe("21999998888");
    expect(normalizePhone("55 21 9999-8888")).toBe("2199998888");
    expect(normalizePhone("021 99999-8888")).toBe("021999998888");
  });

  it("devolve texto vazio para valores vazios", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("  -  ")).toBe("");
  });
});

describe("analyzeResidentImport", () => {
  const rows: ResidentImportRow[] = [
    {
      unit_number: "101",
      block_name: "A",
      name: "Maria",
      whatsapp: "21999998888",
    },
    {
      unit_number: "101",
      block_name: "A",
      name: "Maria",
      whatsapp: "21999998888",
    },
    {
      unit_number: "102",
      block_name: "A",
      name: null,
      whatsapp: null,
    },
    {
      unit_number: "",
      block_name: null,
      name: "João",
      whatsapp: null,
    },
  ];

  it("separa prontos, apenas unidade, duplicatas e erros", () => {
    const analysis = analyzeResidentImport(rows);

    expect(analysis.counts).toEqual({
      total: 4,
      ready: 1,
      unitOnly: 1,
      duplicates: 1,
      errors: 1,
    });
    expect(analysis.rows.map((row) => row.status)).toEqual([
      "ready",
      "duplicate",
      "unit-only",
      "error",
    ]);
    expect(analysis.rows[3].message).toMatch(/apartamento/i);
    expect(analysis.importableRows).toEqual([rows[0], rows[2]]);
  });

  it("considera duplicatas com nomes em caixas diferentes", () => {
    const analysis = analyzeResidentImport([
      rows[0],
      { ...rows[0], name: "maria", block_name: "a" },
    ]);

    expect(analysis.counts.duplicates).toBe(1);
  });
});

describe("toRpcResidentRows", () => {
  it("transforma campos opcionais vazios em null", () => {
    const rows = toRpcResidentRows([
      {
        unit_number: " 103 ",
        block_name: "",
        name: "",
        whatsapp: "  ",
      },
    ]);

    expect(rows).toEqual([
      {
        unit_number: "103",
        block_name: null,
        name: null,
        whatsapp: null,
      },
    ]);
  });
});
