/**
 * Mede acerto por campo da leitura de etiquetas, sem alterar o app.
 *
 * Uso:
 *   node scripts/measure-label-accuracy.mjs --dry-run
 *   node scripts/measure-label-accuracy.mjs --mode local --all
 *   GEMINI_API_KEY=... node scripts/measure-label-accuracy.mjs --mode gemini
 *   MEASURE_ACCESS_TOKEN=... MEASURE_CONDOMINIUM_ID=... \
 *     node scripts/measure-label-accuracy.mjs --mode edge
 *
 * O modo `gemini` chama o Vision diretamente, repetindo o prompt e o schema da
 * Edge Function (supabase/functions/extract-package-label/index.ts). O modo
 * `edge` mede exatamente o que o porteiro recebe, mas exige um JWT de usuário
 * vinculado ao condomínio informado em MEASURE_CONDOMINIUM_ID. O modo `local`
 * mede o OCR do Tesseract já capturado em label-reports/ocr-drafts.json, sem
 * rede e sem cota: é a linha de base do fallback.
 *
 * Nenhuma chave é lida do dataset: segredos vêm só de variáveis de ambiente.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const datasetPath = resolve(root, "scripts/label-dataset.json");
const envPath = resolve(root, ".env.local");

const fields = [
  "recipient_name",
  "unit_number",
  "block_name",
  "carrier",
  "tracking_code",
  "destination_cep",
  "destination_street",
  "destination_number",
  "address_status",
];

function parseArgs(argv) {
  const options = {
    mode: "gemini",
    limit: 0,
    delayMs: 500,
    retries: 2,
    out: "",
    only: [],
    all: false,
    dryRun: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log(
        "Uso: node scripts/measure-label-accuracy.mjs [--dry-run] [--mode local|gemini|edge] [--limit N] [--only id1,id2] [--all] [--delay-ms N] [--retries N] [--out arquivo.json]",
      );
      process.exit(0);
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--all") {
      options.all = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (!name.startsWith("--")) continue;
    const value = inlineValue ?? argv[++index];
    if (name === "--mode") options.mode = value;
    if (name === "--limit") options.limit = Number(value) || 0;
    if (name === "--delay-ms") options.delayMs = Number(value) || 0;
    if (name === "--retries") options.retries = Number(value) || 0;
    if (name === "--out") options.out = value;
    if (name === "--only") options.only = String(value).split(",").filter(Boolean);
  }
  if (!["local", "gemini", "edge"].includes(options.mode)) {
    throw new Error("--mode precisa ser local, gemini ou edge.");
  }
  return options;
}

function readEnvFile(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function cleanText(value, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function digitsOnly(value, maxLength = 8) {
  return typeof value === "string"
    ? value.replace(/\D/g, "").slice(0, maxLength)
    : "";
}

const responseSchema = {
  type: "OBJECT",
  properties: {
    recipient_name: { type: "STRING" },
    unit_number: { type: "STRING" },
    block_name: { type: "STRING" },
    carrier: {
      type: "STRING",
      enum: [
        "Correios",
        "Amazon",
        "Shopee",
        "Anjun",
        "J&T Express",
        "iMile",
        "Mercado Livre",
        "unknown",
      ],
      description:
        "Use unknown quando a transportadora ou o código não permitirem identificação segura.",
    },
    tracking_code: { type: "STRING" },
    destination_cep: { type: "STRING" },
    destination_street: { type: "STRING" },
    destination_number: { type: "STRING" },
  },
  required: [
    "recipient_name",
    "unit_number",
    "block_name",
    "carrier",
    "tracking_code",
    "destination_cep",
    "destination_street",
    "destination_number",
  ],
};

function buildPrompt(expectedAddress) {
  return [
    "Leia esta foto de etiqueta de encomenda brasileira.",
    "Extraia SOMENTE os dados do DESTINATÁRIO. Ignore remetente, vendedor, transportadora emitente, código de acesso da NF-e, pedido e dados fiscais.",
    'unit_number é só o número da unidade (ex.: "901", "102B", "Cobertura 1"). block_name é o bloco/torre (ex.: "A", "Bloco 2").',
    "destination_cep deve conter somente dígitos. Se a etiqueta mostrar o endereço em duas linhas, junte rua e número.",
    `Endereço do condomínio que está recebendo (referência para a leitura): CEP ${expectedAddress.cep || "não informado"}, logradouro ${expectedAddress.street || "não informado"}, número ${expectedAddress.address_number || "não informado"}.`,
    "Para carrier, escolha somente uma das opções do schema. Use unknown se a transportadora estiver ilegível, ausente ou se o código não permitir identificação segura.",
    "Padrões de código de rastreio:",
    "- Correios: 2 letras + 9 dígitos + BR;",
    "- Amazon: TBR + 9 dígitos, ou AMZC + 9 dígitos + 2 letras;",
    "- Shopee: BR + 12 dígitos + 1 letra ou dígito, totalizando 15 caracteres;",
    "- Anjun: AJ + 15 dígitos;",
    "- J&T Express: 15 dígitos, na prática começando com 999 ou 888;",
    "- iMile: 13 ou 14 dígitos;",
    "- Mercado Livre: 11 dígitos.",
    "Os padrões de J&T Express, iMile e Mercado Livre são fracos: na dúvida, prefira unknown a inventar a empresa.",
    "Não invente dados. Campo ilegível fica string vazia; carrier usa unknown.",
  ].join("\n");
}

function normalizeCarrier(value) {
  if (typeof value !== "string") return "";
  const candidate = value.replace(/\s+/g, " ").trim();
  return candidate === "unknown" ? "" : candidate;
}

function normalizeLabel(raw) {
  return {
    recipient_name: cleanText(raw?.recipient_name, 120),
    unit_number: cleanText(raw?.unit_number, 30),
    block_name: cleanText(raw?.block_name, 40),
    carrier: normalizeCarrier(raw?.carrier),
    tracking_code: cleanText(raw?.tracking_code, 80).replace(/\s+/g, ""),
    destination_cep: digitsOnly(raw?.destination_cep),
    destination_street: cleanText(raw?.destination_street, 160),
    destination_number: cleanText(raw?.destination_number, 20),
  };
}

// Cópia deliberada de address.ts: a decisão de endereço continua determinística.
function decideAddressStatus(destination, expected) {
  const digits = (value) =>
    typeof value === "string" ? value.replace(/\D/g, "") : "";
  const normalizeCep = (value) => {
    const valueDigits = digits(value);
    return valueDigits.length === 8 ? valueDigits : "";
  };
  const normalizeText = (value) => {
    if (typeof value !== "string") return "";
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(
        /\b(av|avenida|rua|praça|praca|pca|logradouro)\b/g,
        (token) =>
          token === "av" || token === "avenida"
            ? "avenida"
            : token === "rua"
              ? "rua"
              : "praca",
      )
      .replace(/\s+/g, " ")
      .trim();
  };
  const normalizeNumber = (value) => {
    if (typeof value === "number") return String(value);
    if (typeof value !== "string") return "";
    return value.replace(/[^0-9a-z]/gi, "").toLocaleLowerCase("pt-BR");
  };

  const expectedCep = normalizeCep(expected?.cep);
  const labelCep = normalizeCep(destination.cep);
  if (expectedCep && labelCep) {
    return expectedCep === labelCep ? "verified" : "mismatch";
  }

  const expectedStreet = normalizeText(expected?.street);
  const labelStreet = normalizeText(destination.street);
  const expectedNumber = normalizeNumber(expected?.address_number);
  const labelNumber = normalizeNumber(destination.number);
  if (expectedStreet && labelStreet && expectedNumber && labelNumber) {
    return expectedStreet === labelStreet && expectedNumber === labelNumber
      ? "verified"
      : "mismatch";
  }
  return "unknown";
}

function comparable(field, value) {
  if (value === null || value === undefined) return "";
  if (field === "destination_cep") {
    return String(value).replace(/\D/g, "");
  }
  if (field === "tracking_code") {
    return String(value)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }
  if (field === "carrier" || field === "address_status") {
    return String(value).trim();
  }
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

async function readLabelFromGemini(imageBase64, mimeType, expectedAddress, apiKey) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: buildPrompt(expectedAddress) },
              { inlineData: { mimeType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini respondeu ${response.status}`);
  }
  const payload = await response.json();
  const raw = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!raw) throw new Error("Gemini não devolveu conteúdo");
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const parsed = JSON.parse(fenced ? fenced[1] : raw);
  const label = normalizeLabel(parsed);
  label.address_status = decideAddressStatus(label, expectedAddress);
  return label;
}

async function readLabelFromEdge(sample, imageBase64, mimeType, settings, env) {
  const response = await fetch(
    `${env.VITE_SUPABASE_URL}/functions/v1/extract-package-label`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.accessToken}`,
        apikey: env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        condominiumId: settings.condominiumId,
        imageBase64,
        mimeType,
        expectedAddress: sample.datasetExpectedAddress,
      }),
      signal: AbortSignal.timeout(25_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Edge respondeu ${response.status}: ${payload.error ?? "sem detalhe"}`,
    );
  }
  return normalizeLabel(payload.label);
}

function readLabelFromDrafts(draft) {
  if (!draft) throw new Error("rascunho de OCR local ausente");
  return normalizeLabel({
    recipient_name: draft.ocrRecipientName,
    unit_number: draft.ocrUnitNumber,
    block_name: draft.ocrBlockName,
    carrier: draft.ocrCarrier,
    tracking_code: draft.ocrTrackingCode,
    destination_cep: draft.ocrCep,
    destination_street: draft.ocrDestinationStreet,
    destination_number: draft.ocrDestinationNumber,
  });
}

function scoreSample(expected, actual, { skipAddressStatus = false } = {}) {
  const matches = {};
  for (const field of fields) {
    // null no gabarito = campo não conferido pelo humano, não conta como erro.
    if (!(field in expected) || expected[field] === null) continue;
    // O OCR local não devolve address_status: a checagem de endereço do app é
    // determinística e é medida nos modos que passam pela Edge Function.
    if (skipAddressStatus && field === "address_status") continue;
    matches[field] =
      comparable(field, expected[field]) === comparable(field, actual[field]);
  }
  return matches;
}

function renderSummary(report) {
  const totals = {};
  for (const field of fields) totals[field] = { correct: 0, total: 0 };
  for (const sample of report.samples) {
    if (!sample.matches) continue;
    for (const [field, match] of Object.entries(sample.matches)) {
      totals[field].total += 1;
      if (match) totals[field].correct += 1;
    }
  }

  console.log("\nAcerto por campo:");
  console.log("campo".padEnd(24), "corretos/total", "  taxa");
  for (const field of fields) {
    const { correct, total } = totals[field];
    const rate = total ? `${((correct / total) * 100).toFixed(1)}%` : "-";
    console.log(
      field.padEnd(24),
      `${correct}/${total}`.padEnd(15),
      rate.padStart(6),
    );
  }
  console.log(
    `\nAmostras: ${report.samples.length} · pendentes de gabarito: ${report.pending} · falhas: ${report.failures}`,
  );
  for (const sample of report.samples) {
    const wrong = Object.entries(sample.matches ?? {})
      .filter(([, match]) => !match)
      .map(([field]) => field);
    if (sample.error) console.log(`  ${sample.id}: ERRO ${sample.error}`);
    else if (wrong.length) console.log(`  ${sample.id}: errou ${wrong.join(", ")}`);
  }
  return totals;
}

const options = parseArgs(process.argv);
const dataset = JSON.parse(readFileSync(datasetPath, "utf8"));
const samples = dataset.samples
  .filter((sample) => !options.only.length || options.only.includes(sample.id))
  .slice(0, options.limit || undefined);
const localDrafts =
  options.mode === "local"
    ? new Map(
        JSON.parse(
          readFileSync(
            resolve(root, "scripts/label-reports/ocr-drafts.json"),
            "utf8",
          ),
        ).map((draft) => [draft.id, draft]),
      )
    : new Map();
const env = readEnvFile(envPath);
// O token pode vir de arquivo temporário fora do repositório, para não aparecer
// em histórico de comando nem em variáveis impressas.
const tokenFile = process.env.MEASURE_TOKEN_FILE ?? "";
const settings = {
  accessToken:
    process.env.MEASURE_ACCESS_TOKEN ??
    (tokenFile && existsSync(tokenFile)
      ? readFileSync(tokenFile, "utf8").trim()
      : ""),
  condominiumId: process.env.MEASURE_CONDOMINIUM_ID ?? "",
  apiKey: process.env.GEMINI_API_KEY ?? "",
};

if (!options.dryRun) {
  if (options.mode === "gemini" && !settings.apiKey) {
    throw new Error("Defina GEMINI_API_KEY no ambiente (não use arquivos versionados).");
  }
  if (
    options.mode === "edge" &&
    (!settings.accessToken ||
      !settings.condominiumId ||
      !env.VITE_SUPABASE_URL ||
      !env.VITE_SUPABASE_ANON_KEY)
  ) {
    throw new Error(
      "Defina MEASURE_ACCESS_TOKEN, MEASURE_CONDOMINIUM_ID e VITE_SUPABASE_URL/ANON_KEY em .env.local.",
    );
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: options.dryRun ? "dry-run" : options.mode,
  model: "gemini-3.6-flash",
  dataset: "scripts/label-dataset.json",
  samples: [],
  pending: 0,
  failures: 0,
};

for (const [index, sample] of samples.entries()) {
  if (!options.all && (sample.confirmed !== true || !sample.expected)) {
    report.pending += 1;
    report.samples.push({
      id: sample.id,
      image: sample.image,
      skipped: "gabarito pendente",
    });
    continue;
  }

  const imagePath = resolve(root, "scripts", sample.image);
  if (!existsSync(imagePath)) {
    report.failures += 1;
    report.samples.push({ id: sample.id, error: `imagem não encontrada: ${imagePath}` });
    continue;
  }

  const mimeType = imagePath.toLowerCase().endsWith(".png")
    ? "image/png"
    : imagePath.toLowerCase().endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  const entry = {
    id: sample.id,
    image: sample.image,
    expected: sample.expected,
    datasetExpectedAddress: dataset.expectedAddress ?? {},
  };

  if (options.dryRun) {
    report.samples.push({ id: sample.id, image: sample.image, dryRun: true });
    continue;
  }

  const started = Date.now();
  try {
    const imageBase64 = readFileSync(imagePath).toString("base64");
    let actual;
    for (let attempt = 0; attempt <= options.retries; attempt += 1) {
      try {
        actual =
          options.mode === "local"
            ? readLabelFromDrafts(localDrafts.get(sample.id))
            : options.mode === "gemini"
              ? await readLabelFromGemini(
                  imageBase64,
                  mimeType,
                  entry.datasetExpectedAddress,
                  settings.apiKey,
                )
              : await readLabelFromEdge(
                  entry,
                  imageBase64,
                  mimeType,
                  settings,
                  env,
                );
        break;
      } catch (error) {
        const transient = /\b(429|502|503|504|timeout)\b/i.test(
          error instanceof Error ? error.message : String(error),
        );
        if (!transient || attempt === options.retries) throw error;
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, 1000 * (attempt + 1)),
        );
      }
    }
    report.samples.push({
      id: sample.id,
      image: sample.image,
      expected: sample.expected,
      actual,
      matches: sample.expected
        ? scoreSample(sample.expected, actual, {
            skipAddressStatus: options.mode === "local",
          })
        : undefined,
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    report.failures += 1;
    report.samples.push({
      id: sample.id,
      image: sample.image,
      expected: sample.expected,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - started,
    });
  }

  if (index < samples.length - 1 && options.delayMs > 0) {
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, options.delayMs),
    );
  }
}

report.totals = renderSummary(report);

if (!options.dryRun && options.mode !== "local") {
  const capturedFields = [
    "tracking_code",
    "carrier",
    "destination_cep",
    "recipient_name",
    "unit_number",
    "block_name",
    "destination_street",
    "destination_number",
    "address_status",
  ];
  const tsvValue = (value) =>
    String(value ?? "")
      .replace(/[\t\r\n]+/g, " ")
      .trim();
  const tsvPath = resolve(root, "scripts/label-reports/leituras-capturadas.tsv");
  const tsvRows = report.samples.map((sample) =>
    [
      sample.id,
      ...capturedFields.map((field) => tsvValue(sample.actual?.[field])),
      tsvValue(sample.error),
    ].join("\t"),
  );
  writeFileSync(
    tsvPath,
    `${["id", ...capturedFields, "error"].join("\t")}\n${tsvRows.join("\n")}\n`,
    "utf8",
  );
  console.log(`\nPlanilha para revisão: ${tsvPath}`);
}

const outputPath = options.out
  ? resolve(root, options.out)
  : resolve(root, `scripts/label-reports/${Date.now()}.json`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`\nRelatório: ${outputPath}`);
