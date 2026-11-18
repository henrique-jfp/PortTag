#!/usr/bin/env node
/**
 * Laboratório de etiquetas do PortTag.
 *
 * Envia fotos de etiquetas para a Edge Function `label-lab`, que roda o MESMO
 * pipeline de produção (Vision → regras → Groq ancorado), e gera um relatório
 * de cobertura com sugestões de padrões. Nenhuma sugestão é aplicada sozinha.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const maximumBase64Length = 2_800_000;
const batchSize = 6;

function help() {
  return `Uso:
  node scripts/label-lab.mjs <pasta|imagem...> [opções]

Opções:
  --out <arquivo>     Relatório Markdown (padrão: scripts/label-reports/label-coverage.md)
  --json <arquivo>    Resultado bruto em JSON (padrão: mesmo diretório do relatório)
  --cep <cep>         CEP do condomínio, se quiser validar endereço no relatório
  --street <rua>      Logradouro do condomínio
  --number <número>   Número do condomínio
  --no-suggest        Não pedir sugestões de regex ao Groq
  --help              Mostra esta ajuda

Variáveis de ambiente:
  LABEL_LAB_SECRET    Obrigatório. Mesmo valor configurado no Supabase.
  LABEL_LAB_URL       Opcional. Por padrão usa VITE_SUPABASE_URL de .env.local
                      + /functions/v1/label-lab
`;
}

function parseArgs(argv) {
  const options = {
    inputs: [],
    out: path.join(projectRoot, "scripts/label-reports/label-coverage.md"),
    json: "",
    cep: "",
    street: "",
    number: "",
    suggest: true,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help") {
      options.help = true;
      continue;
    }
    if (value === "--no-suggest") {
      options.suggest = false;
      continue;
    }
    if (["--out", "--json", "--cep", "--street", "--number"].includes(value)) {
      const next = argv[index + 1];
      if (!next) throw new Error(`Faltou valor para ${value}`);
      if (value === "--out") options.out = path.resolve(next);
      else if (value === "--json") options.json = path.resolve(next);
      else if (value === "--cep") options.cep = next;
      else if (value === "--street") options.street = next;
      else options.number = next;
      index += 1;
      continue;
    }
    if (value.startsWith("-")) throw new Error(`Opção desconhecida: ${value}`);
    options.inputs.push(path.resolve(value));
  }
  if (!options.json) {
    options.json = path.join(
      path.dirname(options.out),
      `${path.basename(options.out, path.extname(options.out))}.json`,
    );
  }
  return options;
}

async function readEnvFile() {
  const values = {};
  try {
    const text = await readFile(path.join(projectRoot, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Sem .env.local: ainda é possível usar LABEL_LAB_URL.
  }
  return values;
}

async function collectImages(inputs) {
  const files = [];
  for (const input of inputs) {
    let info;
    try {
      info = await stat(input);
    } catch {
      throw new Error(`Caminho não encontrado: ${input}`);
    }
    if (info.isDirectory()) {
      const entries = await readdir(input, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!imageExtensions.has(path.extname(entry.name).toLowerCase())) continue;
        files.push(path.join(input, entry.name));
      }
    } else if (imageExtensions.has(path.extname(input).toLowerCase())) {
      files.push(input);
    }
  }
  return files.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

async function imageToPayload(file) {
  let buffer = await readFile(file);
  let mimeType =
    path.extname(file).toLowerCase() === ".png"
      ? "image/png"
      : path.extname(file).toLowerCase() === ".webp"
        ? "image/webp"
        : "image/jpeg";

  // A Edge Function aceita até ~2 MB. Fotos de celular costumam passar disso,
  // então reduzimos sem perder a nitidez necessária para o OCR.
  if (buffer.length > 1_800_000) {
    try {
      const sharp = (await import("sharp")).default;
      buffer = await sharp(buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      mimeType = "image/jpeg";
    } catch {
      // Sem sharp, seguimos com a imagem original e deixamos a função avisar.
    }
  }

  const base64 = buffer.toString("base64");
  if (base64.length > maximumBase64Length) {
    throw new Error(
      `imagem grande demais (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Reduza para até 2 MB.`,
    );
  }
  return { name: path.basename(file), mimeType, imageBase64: base64 };
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

async function callLab(endpoint, secret, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-label-lab-secret": secret,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  if (!Array.isArray(body.results)) {
    throw new Error("Resposta inesperada da Edge Function.");
  }
  return body.results;
}

function fieldLabel(field) {
  const labels = {
    carrier: "Transportadora",
    tracking_code: "Rastreio",
    unit_number: "Unidade",
    recipient_name: "Destinatário",
    destination_cep: "CEP",
    destination_street: "Rua",
    destination_number: "Número",
  };
  return labels[field] ?? field;
}

function renderReport(results, options, endpoint) {
  const ok = results.filter((item) => item.ok);
  const failed = results.filter((item) => !item.ok);
  const carriers = new Map();
  for (const item of ok) {
    const carrier = item.fields?.carrier || "não identificado";
    const entry = carriers.get(carrier) ?? { total: 0, unit: 0, tracking: 0, name: 0 };
    entry.total += 1;
    if (item.fields?.unit_number) entry.unit += 1;
    if (item.fields?.tracking_code) entry.tracking += 1;
    if (item.fields?.recipient_name) entry.name += 1;
    carriers.set(carrier, entry);
  }

  const lines = [
    "# Cobertura de etiquetas — PortTag",
    "",
    `- Gerado em: ${new Date().toISOString()}`,
    `- Endpoint: \`${endpoint}\``,
    `- Fotos: ${results.length} (${ok.length} lidas, ${failed.length} com falha)`,
    `- Sugestões: **candidatas**, não aplicadas automaticamente`,
    "",
    "## Cobertura por transportadora",
    "",
    "| Transportadora | Fotos | Unidade | Rastreio | Destinatário |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const [carrier, entry] of [...carriers].sort((a, b) => b[1].total - a[1].total)) {
    lines.push(
      `| ${carrier} | ${entry.total} | ${entry.unit}/${entry.total} | ${entry.tracking}/${entry.total} | ${entry.name}/${entry.total} |`,
    );
  }
  if (!carriers.size) lines.push("| — | 0 | 0 | 0 | 0 |");

  lines.push("", "## Sugestões de regras (revisar antes de usar)", "");
  const withSuggestions = ok.filter((item) => item.suggestions?.length);
  if (!withSuggestions.length) {
    lines.push("Nenhuma sugestão gerada nesta rodada.");
  } else {
    lines.push("| Etiqueta | Campo | Regex candidata | Motivo |", "|---|---|---|---|");
    for (const item of withSuggestions) {
      for (const suggestion of item.suggestions) {
        lines.push(
          `| ${item.name} | ${fieldLabel(suggestion.field)} | \`${suggestion.pattern.replace(/\|/g, "\\|")}\` | ${suggestion.reason || "—"} |`,
        );
      }
    }
  }

  lines.push("", "## Resultado por etiqueta", "");
  for (const item of results) {
    lines.push(`### ${item.name}`, "");
    if (!item.ok) {
      lines.push(`**Falha:** ${item.error}`, "");
      continue;
    }
    lines.push(
      `- Transportadora: **${item.fields?.carrier || "—"}**`,
      `- Rastreio: **${item.fields?.tracking_code || "—"}**`,
      `- Unidade: **${item.fields?.unit_number || "—"}**`,
      `- Destinatário: **${item.fields?.recipient_name || "—"}**`,
      `- Endereço lido: ${item.fields?.destination_cep || "—"} · ${item.fields?.destination_street || "—"} · ${item.fields?.destination_number || "—"}`,
      `- Status do endereço: ${item.addressStatus}`,
      `- OCR: ${item.diagnostics?.ocrMs ?? "—"} ms · ${item.diagnostics?.ocrChars ?? "—"} caracteres`,
      `- IA: ${item.diagnostics?.aiUsed?.length ? item.diagnostics.aiUsed.join(", ") : "não usada"}`,
      "",
      "<details>",
      "<summary>Texto lido pelo OCR</summary>",
      "",
      "```text",
      item.ocrText || "(vazio)",
      "```",
      "",
      "</details>",
      "",
    );
  }

  if (failed.length) {
    lines.push("## Falhas", "");
    for (const item of failed) lines.push(`- ${item.name}: ${item.error}`);
    lines.push("");
  }

  lines.push(
    "## Como usar este relatório",
    "",
    "1. Confira a coluna **Cobertura por transportadora**: campos com poucos acertos precisam de regra nova.",
    "2. Veja o **texto OCR** das etiquetas problemáticas.",
    "3. As regex em **Sugestões** são apenas candidatas: valide cada uma contra todas as etiquetas antes de colar no código.",
    "4. Nunca crie regra para CEP/rua/número a partir da IA; isso continua determinístico.",
    "5. Depois de aceitar uma regra, rode `npm test` e publique a Edge Function se ela mudou.",
    "",
  );
  if (options.cep || options.street || options.number) {
    lines.push(
      "> Este relatório foi gerado com endereço esperado informado, então o status de endereço é comparativo.",
      "",
    );
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(help());
    return;
  }
  if (!options.inputs.length) {
    throw new Error("Informe uma pasta ou arquivos de imagem. Use --help.");
  }

  const env = await readEnvFile();
  const baseUrl = process.env.LABEL_LAB_URL || env.VITE_SUPABASE_URL || "";
  if (!baseUrl) throw new Error("Defina LABEL_LAB_URL ou VITE_SUPABASE_URL em .env.local.");
  const endpoint = `${baseUrl.replace(/\/$/, "")}/functions/v1/label-lab`;
  const secret = process.env.LABEL_LAB_SECRET || "";
  if (!secret) throw new Error("Defina LABEL_LAB_SECRET no ambiente.");

  const files = await collectImages(options.inputs);
  if (!files.length) throw new Error("Nenhuma imagem JPG/PNG/WEBP encontrada.");

  const results = [];
  for (const batch of chunks(files, batchSize)) {
    const payloads = await Promise.all(batch.map(imageToPayload));
    const batchResults = await callLab(endpoint, secret, {
      images: payloads,
      suggest: options.suggest,
      expectedAddress: {
        cep: options.cep,
        street: options.street,
        address_number: options.number,
      },
    });
    results.push(...batchResults);
    process.stdout.write(`.`);
  }
  process.stdout.write("\n");

  const report = renderReport(results, options, endpoint);
  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, report, "utf8");
  await writeFile(options.json, `${JSON.stringify(results, null, 2)}\n`, "utf8");

  const ok = results.filter((item) => item.ok).length;
  console.log(`Lidas: ${ok}/${results.length}`);
  console.log(`Relatório: ${options.out}`);
  console.log(`JSON: ${options.json}`);
}

main().catch((error) => {
  console.error(`label-lab: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
