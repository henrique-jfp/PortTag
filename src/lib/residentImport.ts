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

/** Arquivo já lido, com os cabeçalhos e as linhas abaixo deles. */
export type ResidentImportSource = {
  headers: string[];
  rows: readonly (readonly unknown[])[];
};

/**
 * Índices das colunas escolhidas; `-1` significa "não usar".
 * `names` e `phones` são listas porque uma mesma linha pode conter Morador 1,
 * Morador 2, Morador 3 etc. e seus respectivos telefones.
 */
export type ResidentColumnMapping = {
  unit: number;
  block: number;
  names: number[];
  phones: number[];
};

export const NO_COLUMN = -1;
export const FIRST_BLOCK_NAME = "Bloco 1";

/** Resposta da pergunta mostrada quando a planilha não informa bloco. */
export type ResidentImportBlockChoice = "none" | "first" | null;

/**
 * Aplica a escolha de bloco às linhas mapeadas. `none` cria apartamentos sem
 * bloco; `first` vincula tudo ao Bloco 1; `null` mantém o que veio da planilha.
 */
export function applyImportBlockChoice(
  rows: readonly ResidentImportRow[],
  choice: ResidentImportBlockChoice,
): ResidentImportRow[] {
  if (choice === "none") {
    return rows.map((row) => ({ ...row, block_name: null }));
  }
  if (choice === "first") {
    return rows.map((row) => ({ ...row, block_name: FIRST_BLOCK_NAME }));
  }
  return rows.map((row) => ({ ...row }));
}

const UNIT_HEADERS = [
  "apartamento",
  "ap",
  "apt",
  "apto",
  "unit",
  "unidade",
  "unid",
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
  return value === null || value === undefined ? "" : String(value).trim();
}

function columnMatches(header: string, aliases: string[]): boolean {
  return (
    aliases.includes(header) ||
    aliases.some((alias) => alias.length > 2 && header.includes(alias))
  );
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
    (header, index) => !used.has(index) && columnMatches(header, aliases),
  );
}

function findColumns(
  headers: string[],
  aliases: string[],
  used: Set<number>,
): number[] {
  return headers.flatMap((header, index) =>
    !used.has(index) && columnMatches(header, aliases) ? [index] : [],
  );
}

/**
 * Sugestão inicial de colunas. O usuário pode — e deve, quando a sugestão
 * estiver errada — trocar qualquer uma delas na tela antes de importar.
 */
export function guessResidentColumnMapping(
  headers: readonly string[],
): ResidentColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();

  const unit = findColumn(normalized, UNIT_HEADERS, used);
  if (unit >= 0) used.add(unit);
  const block = findColumn(normalized, BLOCK_HEADERS, used);
  if (block >= 0) used.add(block);

  const names = findColumns(normalized, NAME_HEADERS, used);
  names.forEach((index) => used.add(index));
  const phones = findColumns(normalized, PHONE_HEADERS, used);

  return { unit, block, names, phones };
}

/** Converte as colunas escolhidas nas linhas enviadas para a RPC. */
export function mapResidentRows(
  source: ResidentImportSource,
  mapping: ResidentColumnMapping,
): ResidentImportRow[] {
  const valueAt = (row: readonly unknown[], index: number) =>
    index >= 0 && index < row.length ? cellToString(row[index]) : "";

  return source.rows.flatMap((row) => {
    const unit_number = valueAt(row, mapping.unit);
    const block_name = mapping.block >= 0 ? valueAt(row, mapping.block) : null;
    const residentCount = Math.max(mapping.names.length, mapping.phones.length, 1);

    return Array.from({ length: residentCount }, (_, index) => {
      const nameIndex = mapping.names[index] ?? NO_COLUMN;
      const phoneIndex = mapping.phones[index] ?? NO_COLUMN;
      return {
        unit_number,
        block_name,
        name: nameIndex >= 0 ? valueAt(row, nameIndex) || null : null,
        whatsapp:
          phoneIndex >= 0
            ? normalizePhone(valueAt(row, phoneIndex)) || null
            : null,
      };
    });
  });
}

function sourceFromMatrix(
  matrix: readonly (readonly unknown[])[],
): ResidentImportSource {
  const nonEmpty = matrix
    .map((row, index) => ({
      index,
      cells: row.filter((cell) => cellToString(cell) !== "").length,
    }))
    .filter((row) => row.cells > 0)
    .slice(0, 10);
  if (nonEmpty.length === 0) {
    throw new Error("A planilha está vazia. Envie um arquivo com cabeçalhos.");
  }

  // Planilhas exportadas costumam ter um título de uma célula acima do
  // cabeçalho. Escolher a linha com mais células preenchidas evita confundir
  // esse título com os nomes das colunas — sem precisar advinhar o significado.
  const headerRow = nonEmpty.reduce((best, row) =>
    row.cells > best.cells ? row : best,
  );
  const headerIndex = headerRow.index;

  const headers = matrix[headerIndex].map((cell) =>
    cellToString(cell).replace(/^\uFEFF/, ""),
  );
  const rows = matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cellToString(cell) !== ""));

  if (rows.length === 0) {
    throw new Error(
      "A planilha não tem linhas de moradores abaixo do cabeçalho.",
    );
  }

  return { headers, rows };
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

async function matrixFromCsv(
  file: File,
): Promise<readonly (readonly unknown[])[]> {
  const text = (await file.text()).replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);
  const papa = await import("papaparse");
  const result = papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: "greedy",
  });

  if (result.errors.length > 0) {
    throw new Error(`Não foi possível ler o CSV. ${result.errors[0].message}`);
  }

  return result.data;
}

async function matrixFromExcel(
  file: File,
): Promise<readonly (readonly unknown[])[]> {
  try {
    const { readSheet } = await import("read-excel-file/browser");
    return await readSheet(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    const hint = file.name.toLowerCase().endsWith(".xls")
      ? "O formato .xls antigo não é suportado. Salve a planilha como .xlsx e tente novamente."
      : "Confira se o arquivo é uma planilha .xlsx válida.";
    throw new Error(`Não foi possível ler a planilha. ${hint} (${message})`);
  }
}

/** Lê um CSV ou XLSX sem tentar advinhar o significado das colunas. */
export async function readResidentFile(file: File): Promise<ResidentImportSource> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") return sourceFromMatrix(await matrixFromCsv(file));
  if (extension === "xlsx" || extension === "xlsm" || extension === "xls") {
    return sourceFromMatrix(await matrixFromExcel(file));
  }

  throw new Error(
    "Formato de arquivo não suportado. Envie um arquivo .csv, .xlsx ou .xls.",
  );
}

/** Caminho rápido: lê o arquivo e usa apenas os cabeçalhos reconhecidos. */
export async function parseResidentFile(
  file: File,
): Promise<ResidentImportRow[]> {
  const source = await readResidentFile(file);
  const mapping = guessResidentColumnMapping(source.headers);
  if (mapping.unit < 0) throw new Error(MISSING_UNIT_MESSAGE);
  return mapResidentRows(source, mapping);
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
      .filter((row) => row.status === "ready" || row.status === "unit-only")
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
