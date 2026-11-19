/** Linha normalizada de uma planilha de moradores. */
export type ResidentImportRow = {
  unit_number: string;
  /** `null` significa que o arquivo não tem coluna de bloco; `''` é uma célula vazia. */
  block_name: string | null;
  name: string | null;
  whatsapp: string | null;
};

export type ResidentImportStatus =
  | "ready"
  | "unit-only"
  | "duplicate"
  | "error";

export type AnalyzedResidentImportRow = ResidentImportRow & {
  /** Linha do arquivo, começando em 1 (cabeçalho não contado). */
  line: number;
  status: ResidentImportStatus;
  message: string;
};

export type ResidentImportAnalysis = {
  rows: AnalyzedResidentImportRow[];
  /** Linhas que podem ser enviadas à RPC (prontas + apenas unidade). */
  importableRows: ResidentImportRow[];
  counts: {
    total: number;
    ready: number;
    unitOnly: number;
    duplicates: number;
    errors: number;
  };
};

export type ImportResidentRpcRow = {
  unit_number: string;
  block_name: string | null;
  name: string | null;
  whatsapp: string | null;
};

const UNIT_HEADERS = [
  "apartamento",
  "ap",
  "apto",
  "unit",
  "unidade",
  "numero",
  "nro",
];
const BLOCK_HEADERS = ["bloco", "torre"];
const NAME_HEADERS = ["nome", "morador", "responsavel"];
const PHONE_HEADERS = [
  "telefone",
  "celular",
  "whatsapp",
  "fone",
  "telefone whatsapp",
];

const MISSING_UNIT_MESSAGE =
  "Não encontramos a coluna de apartamento/unidade no arquivo. Use um cabeçalho como Apartamento, Apto, Unidade ou Número.";

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_\-./:]+/g, " ")
    .trim();
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function findColumn(
  headers: string[],
  aliases: string[],
  used: Set<number>,
): number {
  const exact = headers.findIndex(
    (header, index) => !used.has(index) && aliases.includes(header),
  );
  if (exact >= 0) return exact;

  return headers.findIndex(
    (header, index) =>
      !used.has(index) &&
      aliases.some(
        (alias) => alias.length > 2 && header.includes(alias),
      ),
  );
}

function rowsFromMatrix(matrix: readonly (readonly unknown[])[]): ResidentImportRow[] {
  const headerIndex = matrix.findIndex((row) =>
    row.some((cell) => cellToString(cell) !== ""),
  );
  if (headerIndex < 0) {
    throw new Error("A planilha está vazia. Envie um arquivo com cabeçalhos.");
  }

  const headers = matrix[headerIndex].map(normalizeHeader);
  const used = new Set<number>();
  const unitIndex = findColumn(headers, UNIT_HEADERS, used);
  if (unitIndex < 0) {
    throw new Error(MISSING_UNIT_MESSAGE);
  }
  used.add(unitIndex);

  const blockIndex = findColumn(headers, BLOCK_HEADERS, used);
  if (blockIndex >= 0) used.add(blockIndex);
  const nameIndex = findColumn(headers, NAME_HEADERS, used);
  if (nameIndex >= 0) used.add(nameIndex);
  const phoneIndex = findColumn(headers, PHONE_HEADERS, used);

  const rows: ResidentImportRow[] = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const cells = matrix[index];
    if (!cells || cells.every((cell) => cellToString(cell) === "")) continue;

    rows.push({
      unit_number: cellToString(cells[unitIndex]),
      block_name: blockIndex >= 0 ? cellToString(cells[blockIndex]) : null,
      name: nameIndex >= 0 ? cellToString(cells[nameIndex]) : null,
      whatsapp: phoneIndex >= 0 ? normalizePhone(cellToString(cells[phoneIndex])) : null,
    });
  }

  if (rows.length === 0) {
    throw new Error(
      "A planilha não tem linhas de moradores abaixo do cabeçalho.",
    );
  }

  return rows;
}

/** Conta os separadores candidatos fora de campos entre aspas. */
function detectDelimiter(text: string): ";" | "," {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let semicolons = 0;
  let commas = 0;
  let insideQuotes = false;

  for (let index = 0; index < firstLine.length; index += 1) {
    const char = firstLine[index];
    if (char === '"') {
      if (insideQuotes && firstLine[index + 1] === '"') {
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (!insideQuotes) {
      if (char === ";") semicolons += 1;
      if (char === ",") commas += 1;
    }
  }

  return commas > semicolons ? "," : ";";
}

async function parseCsv(file: File): Promise<ResidentImportRow[]> {
  const text = (await file.text()).replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);
  const papa = await import("papaparse");
  const result = papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: "greedy",
  });

  if (result.errors.length > 0) {
    throw new Error(
      `Não foi possível ler o CSV. ${result.errors[0].message}`,
    );
  }

  return rowsFromMatrix(result.data);
}

async function parseExcel(file: File): Promise<ResidentImportRow[]> {
  let data: readonly (readonly unknown[])[];
  try {
    const { readSheet } = await import("read-excel-file/browser");
    data = await readSheet(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    const hint =
      file.name.toLowerCase().endsWith(".xls")
        ? "O formato .xls antigo não é suportado. Salve a planilha como .xlsx e tente novamente."
        : "Confira se o arquivo é uma planilha .xlsx válida.";
    throw new Error(`Não foi possível ler a planilha. ${hint} (${message})`);
  }

  return rowsFromMatrix(data);
}

/** Lê um CSV ou XLSX e devolve linhas normalizadas para a importação. */
export async function parseResidentFile(
  file: File,
): Promise<ResidentImportRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") return parseCsv(file);
  if (extension === "xlsx" || extension === "xlsm" || extension === "xls") {
    return parseExcel(file);
  }

  throw new Error(
    "Formato de arquivo não suportado. Envie um arquivo .csv, .xlsx ou .xls.",
  );
}

/** Mantém apenas dígitos e remove o código do país 55 em números de 12 a 13 dígitos. */
export function normalizePhone(value: string): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith("55")
  ) {
    return digits.slice(2);
  }
  return digits;
}

function duplicateKey(row: ResidentImportRow): string {
  return [
    row.unit_number.trim().toLocaleLowerCase("pt-BR"),
    (row.block_name ?? "").trim().toLocaleLowerCase("pt-BR"),
    (row.name ?? "").trim().toLocaleLowerCase("pt-BR"),
    (row.whatsapp ?? "").trim(),
  ].join("|");
}

/** Classifica cada linha e devolve contadores para a prévia da importação. */
export function analyzeResidentImport(
  rows: ResidentImportRow[],
): ResidentImportAnalysis {
  const seen = new Set<string>();
  const analyzed: AnalyzedResidentImportRow[] = rows.map((row, index) => {
    const analyzedRow: AnalyzedResidentImportRow = {
      ...row,
      line: index + 1,
      status: "ready",
      message: "Pronto para importar.",
    };

    if (!row.unit_number.trim()) {
      analyzedRow.status = "error";
      analyzedRow.message = "Sem apartamento: informe a unidade desta linha.";
      return analyzedRow;
    }

    const key = duplicateKey(row);
    if (seen.has(key)) {
      analyzedRow.status = "duplicate";
      analyzedRow.message = "Duplicata: já existe uma linha igual nesta planilha.";
      return analyzedRow;
    }
    seen.add(key);

    if (!row.name?.trim() && !row.whatsapp?.trim()) {
      analyzedRow.status = "unit-only";
      analyzedRow.message = "Sem nome e WhatsApp: cria apenas a unidade.";
    }

    return analyzedRow;
  });

  const count = (status: ResidentImportStatus) =>
    analyzed.filter((row) => row.status === status).length;

  return {
    rows: analyzed,
    importableRows: analyzed
      .filter(
        (row) => row.status === "ready" || row.status === "unit-only",
      )
      .map(({ unit_number, block_name, name, whatsapp }) => ({
        unit_number,
        block_name,
        name,
        whatsapp,
      })),
    counts: {
      total: analyzed.length,
      ready: count("ready"),
      unitOnly: count("unit-only"),
      duplicates: count("duplicate"),
      errors: count("error"),
    },
  };
}

/** Prepara as linhas para a RPC, transformando campos opcionais vazios em `null`. */
export function toRpcResidentRows(
  rows: readonly ResidentImportRow[],
): ImportResidentRpcRow[] {
  return rows.map((row) => ({
    unit_number: row.unit_number.trim(),
    block_name: row.block_name?.trim() || null,
    name: row.name?.trim() || null,
    whatsapp: row.whatsapp?.trim() || null,
  }));
}
