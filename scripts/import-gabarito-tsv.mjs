/**
 * Converte o TSV revisado em label-confirmed.json.
 *
 * Convenção das células:
 *   vazia    -> null (campo não medido)
 *   #vazio   -> "" (confirmado que a etiqueta não traz o dado)
 *   texto    -> valor literal do gabarito
 *
 * O TSV é a fonte autoritativa do gabarito: o que não estiver nele não é
 * medido. `address_status` só entra quando o TSV declara o valor, porque a
 * decisão depende do endereço cadastrado do condomínio e é calculada pelo
 * código determinístico, nunca pela IA.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsvArgument =
  process.argv[2] ?? "scripts/label-reports/gabarito-revisado.tsv";
const tsvPath = resolve(root, tsvArgument);
const confirmedPath = resolve(root, "scripts/label-confirmed.json");

const lines = readFileSync(tsvPath, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim());
const header = lines.shift().split("\t");

function cell(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "#vazio") return "";
  return trimmed;
}

const samples = {};
for (const line of lines) {
  const columns = line.split("\t");
  const sample = {};
  header.forEach((name, index) => {
    if (name === "id" || name === "notes") return;
    sample[name] = cell(columns[index] ?? "");
  });
  samples[columns[0]] = sample;
}

writeFileSync(
  confirmedPath,
  `${JSON.stringify({ notes: "Gabarito revisado por humano. #vazio = string vazia confirmada; célula vazia = não medir.", samples }, null, 2)}\n`,
  "utf8",
);
console.log(
  `Gabarito importado: ${Object.keys(samples).length} fotos -> ${confirmedPath}`,
);
