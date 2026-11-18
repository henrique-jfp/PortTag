/**
 * Monta label-dataset.json a partir dos rascunhos de OCR e do gabarito já
 * revisado em label-confirmed.json. Fotos sem gabarito revisado ficam marcadas
 * como pendentes e não entram no cálculo de acerto.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const draftsPath = resolve(root, "scripts/label-reports/ocr-drafts.json");
const confirmedPath = resolve(root, "scripts/label-confirmed.json");
const outputPath = resolve(root, "scripts/label-dataset.json");

const drafts = JSON.parse(readFileSync(draftsPath, "utf8"));
const confirmedFile = existsSync(confirmedPath)
  ? JSON.parse(readFileSync(confirmedPath, "utf8"))
  : { samples: {} };
const confirmed = confirmedFile.samples ?? {};

const dataset = {
  expectedAddress: {
    cep: "22210040",
    street: "Rua Ferreira Viana",
    address_number: "45",
  },
  notes:
    "Endereço de referência sintético, igual ao da etiqueta de correios. Troque pelo endereço real do condomínio ao medir fotos de produção.",
  samples: drafts.map((draft) => ({
    id: draft.id,
    image: draft.image,
    confirmed: Object.hasOwn(confirmed, draft.id),
    expected: confirmed[draft.id] ?? null,
    ocrDraft: {
      carrier: draft.ocrCarrier,
      tracking_code: draft.ocrTrackingCode,
      destination_cep: draft.ocrCep,
    },
    notes: Object.hasOwn(confirmed, draft.id)
      ? "Gabarito revisado."
      : "Rascunho por OCR local: conferir na foto e mover para label-confirmed.json.",
  })),
};

writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
console.log(
  `Dataset: ${dataset.samples.length} fotos, ${dataset.samples.filter((sample) => sample.confirmed).length} com gabarito revisado -> ${outputPath}`,
);
