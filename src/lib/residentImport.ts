/** Linha normalizada de uma planilha de moradores. */
export type ResidentImportRow = {
  unit_number: string;
  /** `null` significa que o arquivo não tem coluna de bloco; `''` é uma célula vazia. */
  block_name: string | null;
  /** Andar informado na planilha, quando houver coluna mapeada. */
  floor_label: string | null;
  name: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
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
  floor_label: string | null;
  name: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
};

/** Arquivo já lido, com os cabeçalhos e as linhas abaixo deles. */
export type ResidentImportSource = {
  headers: string[];
  rows: readonly (readonly unknown[])[];
};

/** O que cada coluna da planilha representa. */
export type ResidentColumnKind =
  | "none"
  | "unit"
  | "block"
  | "floor"
  | "name"
  | "phone"
  | "email"
  | "notes";

/**
 * Um item por coluna do arquivo, na mesma ordem dos cabeçalhos.
 * `unit`, `block` e `floor` usam a primeira coluna marcada. `name`, `phone`,
 * `email` e `notes` podem se repetir: a coluna 1 de cada tipo forma o primeiro
 * morador, a coluna 2 forma o segundo, e assim por diante.
 */
export type ResidentColumnMapping = ResidentColumnKind[];

export const FIRST_BLOCK_NAME = "Bloco 1";

export const RESIDENT_COLUMN_KINDS: {
  value: ResidentColumnKind;
  label: string;
}[] = [
  { value: "none", label: "Não usar" },
  { value: "unit", label: "Apartamento / unidade" },
  { value: "block", label: "Bloco / torre" },
  { value: "floor", label: "Andar" },
  { value: "name", label: "Morador" },
  { value: "phone", label: "Telefone / WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "notes", label: "Observações" },
];

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

const COLUMN_ALIASES: { kind: ResidentColumnKind; aliases: string[] }[] = [
  {
    kind: "unit",
    aliases: [
      "apartamento",
      "ap",
      "apt",
      "apto",
      "unidade",
      "unid",
      "numero",
      "nro",
      "n do imovel",
      "imovel",
    ],
  },
  { kind: "block", aliases: ["bloco", "torre"] },
  { kind: "floor", aliases: ["andar", "piso"] },
  { kind: "email", aliases: ["email", "e mail", "correio"] },
  { kind: "notes", aliases: ["observacao", "observacoes", "obs", "detalhes"] },
  {
    kind: "phone",
    aliases: [
      "telefone",
      "telefone whatsapp",
      "whatsapp",
      "celular",
      "fone",
      "contato",
    ],
  },
  {
    kind: "name",
    aliases: ["nome", "morador", "responsavel", "destinatario", "destinataria"],
  },
];

const MISSING_UNIT_MESSAGE =
  "Marque pelo menos uma coluna como Apartamento / unidade antes de continuar.";

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/º/g, "o")
    .replace(/ª/g, "a")
    .replace(/[\s_\-./:]+/g, " ")
    .trim();
}

function cellToString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function guessKind(header: string): ResidentColumnKind {
  for (const { kind, aliases } of COLUMN_ALIASES) {
    if (
      aliases.some(
        (alias) =>
          header === alias ||
          (alias.length > 2 && header.includes(alias)),
      )
    ) {
      return kind;
    }
  }
  return "none";
}

/**
 * Sugestão inicial para cada coluna. O usuário pode — e deve, quando a
 * sugestão estiver errada — trocar qualquer uma delas na tela antes de
 * importar. Colunas sem sugestão ficam como "Não usar".
 */
export function guessResidentColumnMapping(
  headers: readonly string[],
): ResidentColumnMapping {
  return headers.map((header) => guessKind(normalizeHeader(header)));
}

function firstColumnOf(
  mapping: ResidentColumnMapping,
  kind: ResidentColumnKind,
): number {
  return mapping.findIndex((value) => value === kind);
}

function columnsOf(
  mapping: ResidentColumnMapping,
  kind: ResidentColumnKind,
): number[] {
  return mapping.flatMap((value, index) => (value === kind ? [index] : []));
}

/** Converte as colunas escolhidas nas linhas enviadas para a RPC. */
export function mapResidentRows(
  source: ResidentImportSource,
  mapping: ResidentColumnMapping,
): ResidentImportRow[] {
  const valueAt = (row: readonly unknown[], index: number) =>
    index >= 0 && index < row.length ? cellToString(row[index]) : "";

  const unitIndex = firstColumnOf(mapping, "unit");
  const blockIndex = firstColumnOf(mapping, "block");
  const floorIndex = firstColumnOf(mapping, "floor");
  const nameIndexes = columnsOf(mapping, "name");
  const phoneIndexes = columnsOf(mapping, "phone");
  const emailIndexes = columnsOf(mapping, "email");
  const notesIndexes = columnsOf(mapping, "notes");
  const residentCount = Math.max(
    nameIndexes.length,
    phoneIndexes.length,
    emailIndexes.length,
    notesIndexes.length,
    1,
  );

  return source.rows.flatMap((row) =>
    Array.from({ length: residentCount }, (_, index) => {
      const nameIndex = nameIndexes[index];
      const phoneIndex = phoneIndexes[index];
      const emailIndex = emailIndexes[index];
      const notesIndex = notesIndexes[index];

      return {
        unit_number: valueAt(row, unitIndex),
        block_name: blockIndex >= 0 ? valueAt(row, blockIndex) : null,
        floor_label: floorIndex >= 0 ? valueAt(row, floorIndex) || null : null,
        name: nameIndex !== undefined ? valueAt(row, nameIndex) || null : null,
        whatsapp:
          phoneIndex !== undefined
            ? normalizePhone(valueAt(row, phoneIndex)) || null
            : null,
        email: emailIndex !== undefined ? valueAt(row, emailIndex) || null : null,
        notes: notesIndex !== undefined ? valueAt(row, notesIndex) || null : null,
      };
    }),
  );
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

/** Caminho rápido: lê o arquivo e usa apenas as sugestões de cabeçalho. */
export async function parseResidentFile(
  file: File,
): Promise<ResidentImportRow[]> {
  const source = await readResidentFile(file);
  const mapping = guessResidentColumnMapping(source.headers);
  if (!mapping.includes("unit")) throw new Error(MISSING_UNIT_MESSAGE);
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
    (row.email ?? "").trim().toLocaleLowerCase("pt-BR"),
    (row.notes ?? "").trim().toLocaleLowerCase("pt-BR"),
  ].join("|");
}

function hasResidentData(row: ResidentImportRow): boolean {
  return Boolean(
    row.name?.trim() ||
      row.whatsapp?.trim() ||
      row.email?.trim() ||
      row.notes?.trim(),
  );
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

    if (!hasResidentData(row)) {
      analyzedRow.status = "unit-only";
      analyzedRow.message = "Sem dados de morador: cria apenas a unidade.";
    }

    return analyzedRow;
  });

  const count = (status: ResidentImportStatus) =>
    analyzed.filter((row) => row.status === status).length;

  return {
    rows: analyzed,
    importableRows: analyzed
      .filter((row) => row.status === "ready" || row.status === "unit-only")
      .map(
        ({
          unit_number,
          block_name,
          floor_label,
          name,
          whatsapp,
          email,
          notes,
        }) => ({
          unit_number,
          block_name,
          floor_label,
          name,
          whatsapp,
          email,
          notes,
        }),
      ),
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
    floor_label: row.floor_label?.trim() || null,
    name: row.name?.trim() || null,
    whatsapp: row.whatsapp?.trim() || null,
    email: row.email?.trim() || null,
    notes: row.notes?.trim() || null,
  }));
}
