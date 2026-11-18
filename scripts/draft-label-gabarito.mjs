/**
 * Rascunho de gabarito: roda Tesseract local nas fotos reduzidas e sugere
 * rastreio/transportadora/CEP. Isso NÃO é gabarito: o texto precisa ser
 * conferido por humano antes de entrar em label-dataset.json.
 *
 * Uso: node scripts/draft-label-gabarito.mjs
 */
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "tesseract.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imagesDir = resolve(root, "scripts/label-dataset/images");
const reportDir = resolve(root, "scripts/label-reports");

const trackingPatterns = [
  ["Correios", /\b[A-Z]{2}[\s-]*\d{3}[\s-]*\d{3}[\s-]*\d{3}[\s-]*[A-Z]{2}\b/i],
  ["Amazon", /\bTBR[\s-]*\d{9,12}\b/i],
  ["Amazon", /\bAMZC[\s-]*\d{9}[\s-]*[A-Z]{2}\b/i],
  ["Shopee", /\bBR[\s-]*\d{12}[\s-]*[A-Z0-9]\b/i],
  ["Anjun", /\bAJ[\s-]*\d{15}\b/i],
  ["J&T Express", /\b(?:999|888)\d{12}\b/i],
  ["iMile", /\b\d{13,14}\b/i],
  ["Mercado Livre", /\b\d{11}\b/i],
];

function findTracking(text) {
  for (const [carrier, pattern] of trackingPatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        carrier,
        code: match[0].replace(/[\s-]/g, "").toUpperCase(),
      };
    }
  }
  return { carrier: "", code: "" };
}

function findCep(text) {
  const match = text.match(/\b\d{5}-?\d{3}\b/);
  if (!match) return "";
  const digits = match[0].replace(/\D/g, "");
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

const addressKeywords =
  /\b(?:rua|r\.|avenida|av\.|travessa|estrada|logradouro|bairro|cep|apto|apartamento|bloco|complemento|remetente|origem|sender|shipper|telefone|celular)\b/i;

function cleanRecipient(candidate) {
  const name = candidate
    .replace(
      /^.*(?:destinat[aá]ri[oa]s?|ship\s*to|deliver\s*to|consignat[aá]ri[oa])\s*:?\s*/i,
      "",
    )
    .replace(/^\s*(?:nome|cliente)\s*[:-]\s*/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+(?:rua|avenida|av\.|travessa|estrada|logradouro|bairro|cep|apto|apartamento|bloco|complemento|endereco)\b.*$/i, "")
    .replace(/\s+\d.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = name.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8 || /\d/.test(name)) return "";
  if (addressKeywords.test(name.toLowerCase())) return "";
  return name;
}

function findRecipient(lines) {
  const anchor = lines.findIndex((line) =>
    /destinat[aá]ri[oa]s?|ship\s*to|deliver\s*to|consignat[aá]ri[oa]/i.test(line),
  );
  if (anchor >= 0) {
    for (const candidate of lines.slice(anchor, anchor + 4)) {
      const name = cleanRecipient(candidate);
      if (name) return name;
    }
    return "";
  }

  const addressAnchor = lines.findIndex((line) => /^endere[çc]o\s*:/i.test(line));
  if (addressAnchor > 0) {
    for (
      let index = addressAnchor - 1;
      index >= Math.max(0, addressAnchor - 3);
      index -= 1
    ) {
      const name = cleanRecipient(lines[index]);
      if (name) return name;
    }
  }

  for (const candidate of lines.slice(0, 10)) {
    const name = cleanRecipient(candidate);
    if (name) return name;
  }
  return "";
}

function findUnit(text) {
  const match = text.match(
    /\b(?:apto|apartamento|apt|ap|depto|departamento|unidade|casa|complemento|compl)\.?\s*[:#=-]?\s*([0-9]+[a-z]?)/i,
  );
  return match ? match[1].toUpperCase() : "";
}

function findBlock(text) {
  const match = text.match(
    /\b(?:bloco|bl|torre)(?![a-z])\s*[:#-]?\s*([a-z0-9]+)/i,
  );
  return match ? match[1].toUpperCase() : "";
}

function findStreet(text) {
  const line = text
    .split(/\r?\n/)
    .find((candidate) =>
      /\b(?:rua|avenida|av\.|travessa|estrada|endere[çc]o)\b/i.test(candidate),
    );
  if (!line) return "";
  if (/^endere[çc]o\s*:/i.test(line)) {
    return line
      .replace(/^endere[çc]o\s*:\s*/i, "")
      .replace(/[,\n].*$/, "")
      .replace(/\d.*$/, "")
      .replace(/[.,;:\s]+$/g, "")
      .trim();
  }
  const match = line.match(
    /\b(rua|avenida|av\.|travessa|estrada)\s+([^\d,\n]+)/i,
  );
  if (!match) return "";
  return `${match[1].replace(/\./g, "")} ${match[2].trim()}`
    .replace(/\s+/g, " ")
    .trim();
}

function findStreetNumber(text) {
  const line = text
    .split(/\r?\n/)
    .find((candidate) => /\b(?:rua|avenida|av\.|travessa|estrada)\b/i.test(candidate));
  if (!line) return "";
  const afterStreet = line.replace(/^.*?\b(?:rua|avenida|av\.|travessa|estrada)\b[^0-9]*/i, "");
  const match = afterStreet.match(/\b(\d+[a-z]?)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function tsvCell(value) {
  return String(value ?? "")
    .replace(/[\t\r\n]+/g, " ")
    .trim();
}

const numericSort = (left, right) => {
  const leftNumber = Number.parseInt(left, 10);
  const rightNumber = Number.parseInt(right, 10);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
};
const files = readdirSync(imagesDir)
  .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
  .sort(numericSort);

mkdirSync(reportDir, { recursive: true });
// No Node, o worker navegador (public/ocr/worker.min.js) não funciona: ele
// espera addEventListener no global. Usamos os caminhos padrão do pacote.
const worker = await createWorker("por", 1, { logger: () => {} });

const drafts = [];
for (const file of files) {
  const started = Date.now();
  const { data } = await worker.recognize(resolve(imagesDir, file));
  const text = data.text.replace(/\r/g, "").trim();
  const tracking = findTracking(text);
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  drafts.push({
    id: file.replace(/\.[^.]+$/, ""),
    image: `label-dataset/images/${file}`,
    ocrCep: findCep(text),
    ocrCarrier: tracking.carrier,
    ocrTrackingCode: tracking.code,
    ocrRecipientName: findRecipient(lines),
    ocrUnitNumber: findUnit(text),
    ocrBlockName: findBlock(text),
    ocrDestinationStreet: findStreet(text),
    ocrDestinationNumber: findStreetNumber(text),
    ocrConfidence: data.confidence,
    durationMs: Date.now() - started,
    text,
  });
  console.log(
    `${drafts.at(-1).id.padEnd(36)} ${tracking.code.padEnd(22)} ${tracking.carrier.padEnd(14)} ${findCep(text)}`,
  );
}
await worker.terminate();

const output = resolve(reportDir, "ocr-drafts.json");
writeFileSync(output, `${JSON.stringify(drafts, null, 2)}\n`, "utf8");

const tsvColumns = [
  "id",
  "tracking_code",
  "carrier",
  "destination_cep",
  "recipient_name",
  "unit_number",
  "block_name",
  "destination_street",
  "destination_number",
];
const tsvPath = resolve(reportDir, "leituras-ocr-local.tsv");
const tsvRows = drafts.map((draft) =>
  [
    draft.id,
    draft.ocrTrackingCode,
    draft.ocrCarrier,
    draft.ocrCep,
    draft.ocrRecipientName,
    draft.ocrUnitNumber,
    draft.ocrBlockName,
    draft.ocrDestinationStreet,
    draft.ocrDestinationNumber,
  ]
    .map(tsvCell)
    .join("\t"),
);
writeFileSync(
  tsvPath,
  `${tsvColumns.join("\t")}\n${tsvRows.join("\n")}\n`,
  "utf8",
);
console.log(`\nRascunhos (precisam de conferência humana): ${output}`);
console.log(`Planilha para correção: ${tsvPath}`);
