import { describe, expect, it, vi } from "vitest";
import {
  analyzeResidentImport,
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
    expect(mapping).toEqual({ unit: 0, block: 1, name: 2, phone: 3 });
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
      name: 3,
      phone: 4,
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

  it("sugere Unid e deixa nome/telefone fora quando não há sugestão", async () => {
    const source = await readResidentFile(
      csvFile("Unid;Bloco\n302;C\n"),
    );

    const mapping = guessResidentColumnMapping(source.headers);

    expect(mapping.unit).toBe(0);
    expect(mapping.block).toBe(1);
    expect(mapping.name).toBe(-1);
    expect(mapping.phone).toBe(-1);
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
