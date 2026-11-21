import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveLabelRules } from "./labelLabActiveRules";
import { applyLabelLabRule, type LabelLabRules } from "./labelLabRules";
import {
  findResidentUnitCandidates,
  findUnitCandidates,
} from "./packageOcr";
import { normalizeApartmentReference } from "./unitFloors";

type NativeBarcode = {
  rawValue: string;
};

type NativeBarcodeDetector = {
  detect(source: CanvasImageSource): Promise<NativeBarcode[]>;
};

type NativeBarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
};

export type PreparedPackageImage = {
  /** Cópia reduzida, usada para localizar a etiqueta e ler códigos. */
  preview: HTMLCanvasElement;
  /** Dimensões na resolução original do arquivo. */
  width: number;
  height: number;
  dispose(): void;
};

export type LabelReadAttempt = {
  pass: string;
  durationMs: number;
  characters: number;
};

export type LabelReadResult = {
  text: string;
  numericText: string;
  barcodeValues: string[];
  attempts: LabelReadAttempt[];
  durationMs: number;
  cropped: boolean;
  /** CEPs que apareceram no texto, na passada numérica ou nos códigos. */
  postalCodes: string[];
  /** Falha da leitura na nuvem. O código de barras continua válido. */
  error?: unknown;
};

const courierNames = [
  ["correios", "Correios"],
  ["sedex", "Correios"],
  ["pac", "Correios"],
  ["mercado livre", "Mercado Livre"],
  ["meli", "Mercado Livre"],
  ["amazon", "Amazon"],
  ["shopee", "Shopee"],
  ["spx", "Shopee"],
  ["shein", "Shein"],
  ["jadlog", "Jadlog"],
  ["loggi", "Loggi"],
  ["total express", "Total Express"],
  ["azul cargo", "Azul Cargo"],
  ["dhl", "DHL"],
  ["fedex", "FedEx"],
  ["ups", "UPS"],
  ["sequoia", "Sequoia"],
  ["flash courier", "Flash Courier"],
  ["j&t express", "J&T Express"],
  ["cainiao", "Cainiao"],
  ["aliexpress", "AliExpress"],
  ["anjun", "Anjun"],
  ["shippify", "Shippify"],
  ["pegaki", "Pegaki"],
  ["kangu", "Kangu"],
  ["braspress", "Braspress"],
  ["gfl", "GFL"],
] as const;

/** Cópia usada para ler os códigos de barras. Pequena de propósito: é rápida. */
const previewDimension = 1600;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function extractKnownTrackingCode(value: string) {
  const correiosCode = value.match(
    /\b[A-Z]{2}[\s-]*\d{3}[\s-]*\d{3}[\s-]*\d{3}[\s-]*[A-Z]{2}\b/i,
  );
  if (correiosCode) return correiosCode[0].replace(/[\s-]/g, "").toUpperCase();

  const carrierPatterns = [
    /\bTBR[\s-]*\d{9,12}\b/i,
    /\b(?:BR|SPX)[\s-]*\d{10,20}\b/i,
    /\b[A-Z]{2}\d{9}[A-Z]{2}\b/i,
  ];
  for (const pattern of carrierPatterns) {
    const match = value.match(pattern);
    if (match) return match[0].replace(/[\s-]/g, "").toUpperCase();
  }
  return "";
}

function isOrderIdLine(line: string) {
  return /\b(?:order|pedido|ordem|purchase)\b/.test(normalizeText(line));
}

const trackingLabelPattern =
  /\b(?:c[oó]digo\s+de\s+(?:rastreio|rastreamento|entrega)|rastreio|rastreamento|tracking(?:\s*(?:code|number|id|no))?|awb)\b\s*[:#-]?\s*/i;

export function extractTrackingCode(
  value: string,
  rules: LabelLabRules | null = getActiveLabelRules(),
) {
  // Regra publicada no Label Lab tem prioridade sobre os formatos embutidos.
  const published = rules
    ? applyLabelLabRule(rules, "tracking_code", value.slice(0, 3000)).value
    : "";
  if (published) return published.replace(/[\s-]/g, "").toUpperCase();

  const lines = value.split(/\r?\n/).map((line) => line.trim());
  const eligibleLines = lines.filter(
    (line) => line && !isOrderIdLine(line),
  );

  for (const [lineIndex, line] of lines.entries()) {
    if (!trackingLabelPattern.test(line)) continue;
    const labelMatch = trackingLabelPattern.exec(line);
    if (!labelMatch) continue;
    const valueAfterLabel = line
      .slice((labelMatch.index ?? 0) + labelMatch[0].length)
      .trim();
    const nextLine = lines[lineIndex + 1] ?? "";
    for (const candidate of [valueAfterLabel, nextLine]) {
      if (!candidate || isOrderIdLine(candidate)) continue;
      // Etiquetas Shippify (regra publicada no Label Lab v1) imprimem um
      // "CODIGO DE ENTREGA" de 6 dígitos, abaixo do rótulo.
      if (/c[oó]digo\s+de\s+entrega/i.test(labelMatch[0])) {
        const deliveryCode = candidate.match(/\b\d{6}\b/);
        if (deliveryCode) return deliveryCode[0];
      }
      const knownCode = extractKnownTrackingCode(candidate);
      if (knownCode) return knownCode;
      const numericCode = candidate.match(/\b\d{10,20}\b/);
      if (numericCode) return numericCode[0];
      const genericCode = candidate.match(
        /\b(?=[A-Z0-9-]{10,30}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/i,
      );
      if (
        genericCode &&
        !/^\d{2,4}-\d{5,9}-\d{5,9}$/.test(genericCode[0])
      ) {
        return genericCode[0].replace(/-/g, "").toUpperCase();
      }
    }
  }

  for (const line of eligibleLines) {
    const code = extractKnownTrackingCode(line);
    if (code) return code;
  }

  return "";
}

export type KnownBarcodeMatch = {
  code: string;
  carrier: string;
};

/**
 * Códigos lidos do código de barras não passam por OCR: quando o valor inteiro
 * bate com um formato conhecido, são mais confiáveis que a IA. A comparação é
 * exata de propósito, para não confundir com chave de NF-e ou payload de QR
 * que contenha um código de 11 dígitos no meio.
 */
const knownBarcodeFormats: Array<{ pattern: RegExp; carrier: string }> = [
  { pattern: /^[A-Z]{2}\d{9}BR$/, carrier: "Correios" },
  { pattern: /^TBR\d{9,12}$/, carrier: "Amazon" },
  { pattern: /^AMZC\d{9}[A-Z]{2}$/, carrier: "Amazon" },
  { pattern: /^BR\d{12}[A-Z0-9]$/, carrier: "Shopee" },
  { pattern: /^AJ\d{15}$/, carrier: "Anjun" },
  { pattern: /^(?:999|888)\d{12}$/, carrier: "J&T Express" },
  { pattern: /^\d{13,14}$/, carrier: "iMile" },
  { pattern: /^\d{11}$/, carrier: "Mercado Livre" },
];

export function matchKnownBarcode(values: string[]): KnownBarcodeMatch | null {
  for (const value of values) {
    const code = value.replace(/[\s-]/g, "").toUpperCase();
    if (!code) continue;
    const format = knownBarcodeFormats.find(({ pattern }) => pattern.test(code));
    if (format) return { code, carrier: format.carrier };
  }
  return null;
}

export function detectDeliveryCompany(
  value: string,
  rules: LabelLabRules | null = getActiveLabelRules(),
) {
  const normalized = normalizeText(value);
  const published = rules
    ? applyLabelLabRule(rules, "carrier", value.slice(0, 3000)).value
    : "";
  if (published) {
    return (
      courierNames.find(([needle]) => normalizeText(needle) === normalizeText(published))?.[1] ??
      published
    );
  }
  const trackingCode = extractTrackingCode(value, rules);

  if (/^TBR\d{9,12}$/.test(trackingCode)) return "Amazon";
  if (/^[A-Z]{2}\d{9}BR$/.test(trackingCode) || /\bsedex\b/.test(normalized)) {
    return "Correios";
  }
  if (/^(?:BR|SPX)\d{10,20}$/.test(trackingCode)) return "Shopee";

  for (const [needle, company] of courierNames) {
    const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escapedNeedle}\\b`).test(normalized)) {
      return company;
    }
  }

  const labelMatch = value.match(
    /(?:transportadora|empresa|entrega por)\s*[-:]\s*([^\r\n]{2,60})/i,
  );
  return labelMatch?.[1]?.trim() ?? "";
}

function getNativeBarcodeDetector() {
  return (
    globalThis as typeof globalThis & {
      BarcodeDetector?: NativeBarcodeDetectorConstructor;
    }
  ).BarcodeDetector;
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Zerar width/height libera o buffer de pixels do canvas imediatamente.
 * No Android WebView, esperar o GC entre fotos era suficiente para o sistema
 * matar a aba ao voltar da câmera.
 */
function releaseCanvas(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function canvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Não foi possível preparar a imagem para leitura.");
  }
  return context;
}

function rotateCanvas(source: HTMLCanvasElement, degrees: number) {
  const quarterTurn = degrees % 180 !== 0;
  const canvas = createCanvas(
    quarterTurn ? source.height : source.width,
    quarterTurn ? source.width : source.height,
  );
  const context = canvasContext(canvas);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

async function loadImageSource(file: File, maxWidth?: number) {
  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap;
    try {
      // Decodificar já reduzido evita manter o bitmap inteiro do celular
      // (4000x3000 ≈ 48 MB) na memória só para desenhar num canvas de 1280 px.
      // Quando só resizeWidth é passado, a altura acompanha a proporção.
      bitmap =
        maxWidth && maxWidth > 0
          ? await createImageBitmap(file, {
              resizeWidth: maxWidth,
              resizeQuality: "high",
            })
          : await createImageBitmap(file);
    } catch {
      // WebView antigo sem opções de redimensionamento: decodifica inteiro.
      bitmap = await createImageBitmap(file);
    }
    return {
      element: bitmap as CanvasImageSource,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }

  const image = new Image();
  const imageUrl = URL.createObjectURL(file);
  try {
    image.src = imageUrl;
    await image.decode();
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
  return {
    element: image as CanvasImageSource,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dispose: () => {},
  };
}

export async function preparePackageImage(
  file: File,
): Promise<PreparedPackageImage> {
  const source = await loadImageSource(file);
  const { width, height } = source;

  const previewScale = Math.min(
    1,
    previewDimension / Math.max(width, height),
  );
  const preview = createCanvas(
    Math.max(1, Math.round(width * previewScale)),
    Math.max(1, Math.round(height * previewScale)),
  );
  const context = canvasContext(preview);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source.element, 0, 0, preview.width, preview.height);

  let disposed = false;

  return {
    preview,
    width,
    height,
    dispose() {
      if (disposed) return;
      disposed = true;
      source.dispose();
      releaseCanvas(preview);
    },
  };
}

export type CompressedPackagePhoto = {
  file: File;
  base64: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
};

/** Lado maior da foto enviada à Vision API. */
const aiImageLongEdge = 1280;
const aiImageQuality = 0.8;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Não foi possível converter a foto para JPEG."));
      },
      type,
      quality,
    );
  });
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function jpegFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, "").trim() || "etiqueta";
  return `${base}.jpg`;
}

/**
 * Normaliza a foto em JPEG de até 1280 px no maior lado.
 *
 * A imagem original do celular tem 3–8 MB e não serve para a Vision API
 * (limite de payload). Nada de grayscale ou filtro destrutivo: a IA lê a
 * etiqueta colorida, inclusive logos de transportadora. Para a foto de avaria,
 * os parâmetros opcionais permitem guardar mais detalhe do volume inteiro.
 */
export async function compressPackagePhoto(
  file: File,
  options: { longEdge?: number; quality?: number } = {},
): Promise<CompressedPackagePhoto> {
  const longEdge = options.longEdge ?? aiImageLongEdge;
  const quality = options.quality ?? aiImageQuality;
  // Fotos pequenas não cabem mais de 1 MB e decodificar inteira é mais barato
  // do que redimensionar — evita ampliar uma imagem já menor que o alvo.
  const source = await loadImageSource(
    file,
    file.size > 800_000 ? longEdge : undefined,
  );
  let canvas: HTMLCanvasElement | null = null;
  try {
    const scale = Math.min(
      1,
      longEdge / Math.max(source.width, source.height, 1),
    );
    canvas = createCanvas(
      Math.max(1, Math.round(source.width * scale)),
      Math.max(1, Math.round(source.height * scale)),
    );
    const context = canvasContext(canvas);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // JPEG não guarda transparência. Sem o fundo branco, PNG com alfa vira
    // preto e a etiqueta some.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source.element, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    const base64 = await blobToBase64(blob);

    return {
      file: new File([blob], jpegFileName(file.name), {
        type: "image/jpeg",
        lastModified: Date.now(),
      }),
      base64,
      mimeType: "image/jpeg",
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    source.dispose();
    releaseCanvas(canvas);
  }
}

export type AiLabelAddressStatus = "verified" | "mismatch" | "unknown";

/** Diagnóstico da leitura na nuvem, aparece no painel de detalhes do porteiro. */
export type LabelDiagnostics = {
  engine?: string;
  ocrMs?: number;
  ocrWords?: number;
  ocrChars?: number;
  ocrText?: string;
  aiMs?: number;
  aiUsed?: string[];
  aiError?: string;
  aiSkipped?: string;
};

export type AiPackageLabel = {
  recipientName: string;
  unitNumber: string;
  blockName: string;
  carrier: string;
  trackingCode: string;
  destinationCep: string;
  destinationStreet: string;
  destinationNumber: string;
  addressStatus: AiLabelAddressStatus;
  addressReason: string;
  diagnostics?: LabelDiagnostics;
};

export type AiLabelUnit = {
  id: string;
  unit_number: string;
  block_id: string | null;
};

export type AiLabelBlock = { id: string; name: string };

export type AiLabelResident = { unit_id: string; name: string | null };

export type AiLabelExtraction<T extends AiLabelUnit> = AiPackageLabel & {
  durationMs: number;
  postalCodes: string[];
  unitCandidates: T[];
  unitId: string;
};

export type AiLabelExtractionInput<
  T extends AiLabelUnit,
  B extends AiLabelBlock,
  R extends AiLabelResident,
> = {
  /** Cliente Supabase já autenticado do app (nunca service role). */
  client: SupabaseClient;
  condominiumId: string;
  imageBase64: string;
  mimeType: string;
  expectedAddress: {
    cep: string | null;
    street: string | null;
    address_number: string | null;
  };
  units: T[];
  blocks: B[];
  residents: R[];
  /** Limite curto: o porteiro está com o pacote na mão. */
  timeoutMs?: number;
};

export class AiLabelExtractionError extends Error {
  readonly reason: "timeout" | "unavailable" | "invalid";

  constructor(message: string, reason: "timeout" | "unavailable" | "invalid") {
    super(message);
    this.name = "AiLabelExtractionError";
    this.reason = reason;
  }
}

type EdgeExtractResponse = {
  label?: Record<string, unknown>;
  diagnostics?: LabelDiagnostics;
  error?: string;
  fallback?: boolean;
};

function textField(value: unknown, maxLength = 200) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function parseAiLabel(
  raw: Record<string, unknown>,
  diagnostics?: LabelDiagnostics,
): AiPackageLabel {
  const status = raw.address_status;
  return {
    recipientName: textField(raw.recipient_name, 120),
    unitNumber: textField(raw.unit_number, 30),
    blockName: textField(raw.block_name, 40),
    carrier: textField(raw.carrier, 60),
    trackingCode: textField(raw.tracking_code, 80).replace(/\s+/g, ""),
    destinationCep: textField(raw.destination_cep, 20)
      .replace(/\D/g, "")
      .slice(0, 8),
    destinationStreet: textField(raw.destination_street, 160),
    destinationNumber: textField(raw.destination_number, 20),
    addressStatus:
      status === "verified" || status === "mismatch" ? status : "unknown",
    addressReason: textField(raw.address_reason, 240),
    diagnostics,
  };
}

function unitKeys(value: string) {
  const normalized = normalizeApartmentReference(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const keys = new Set<string>();
  if (!normalized) return keys;

  const compact = normalized.replace(/\s+/g, "");
  keys.add(compact);
  const stripped = compact.replace(
    /^(?:apartamento|apto|ap|unidade|un|cobertura|casa)/,
    "",
  );
  if (stripped) keys.add(stripped);
  for (const digits of normalized.match(/\d+[a-z]?/g) ?? []) keys.add(digits);
  return keys;
}

/** Compara "AP901", "Apto 901" e "901" sem depender do formato da etiqueta. */
function sharesUnitKey(left: string, right: string) {
  const leftKeys = unitKeys(left);
  if (!leftKeys.size) return false;
  const rightKeys = unitKeys(right);
  for (const key of leftKeys) {
    if (rightKeys.has(key)) return true;
  }
  return false;
}

function blockKey(value: string) {
  return normalizeApartmentReference(value)
    .replace(/\b(?:bloco|bl|torre|edificio|edif|td)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Resolve o nome de bloco lido na etiqueta para um bloco do cadastro. */
export function findAiBlockId<B extends AiLabelBlock>(
  blockName: string,
  blocks: B[],
): string {
  const block = blockKey(blockName);
  if (!block) return "";
  return (
    blocks.find((candidate) => {
      const key = blockKey(candidate.name);
      return (
        Boolean(key) && (key === block || key.includes(block) || block.includes(key))
      );
    })?.id ?? ""
  );
}

/**
 * Casa a unidade devolvida pela IA com o cadastro local. A IA lê "APTO 901" ou
 * "Bloco B, 102"; o banco guarda "901" e "Bloco B". A comparação é por chaves
 * normalizadas, e o bloco restringe a busca para não pegar a unidade 901 de
 * outra torre.
 */
export function matchAiUnits<T extends AiLabelUnit>(
  label: AiPackageLabel,
  units: T[],
  blocks: AiLabelBlock[],
  residents: AiLabelResident[],
) {
  const blockId = label.blockName
    ? findAiBlockId(label.blockName, blocks)
    : "";

  const scoped = blockId
    ? units.filter((unit) => unit.block_id === blockId)
    : units;
  const pool = scoped.length ? scoped : units;

  if (label.unitNumber) {
    // "307" e "307A" podem existir no mesmo cadastro. Quando o número lido é
    // exatamente um deles, não deixe a chave frouxa criar ambiguidade.
    const exactKey = (value: string) =>
      normalizeApartmentReference(value).replace(/[^a-z0-9]/g, "");
    const expected = exactKey(label.unitNumber);
    const exact = pool.filter(
      (unit) => exactKey(unit.unit_number) === expected,
    );
    if (exact.length) return exact;

    const matches = pool.filter((unit) =>
      sharesUnitKey(label.unitNumber, unit.unit_number),
    );
    if (matches.length) return matches;

    // Se o OCR leu o bloco errado, a busca restrita não encontra a unidade.
    // `units` já contém só as unidades que o porteiro pode registrar.
    if (blockId) {
      const anywhere = units.filter((unit) =>
        sharesUnitKey(label.unitNumber, unit.unit_number),
      );
      if (anywhere.length) return anywhere;
    }
  }

  if (label.recipientName) {
    return findResidentUnitCandidates(label.recipientName, units, residents);
  }

  return [];
}

/**
 * Extrai a etiqueta na nuvem (Vision + regras + Groq) com prazo curto. Em qualquer falha,
 * timeout ou ausência de configuração a função lança: o chamador cai para o
 * leitor local. Nada aqui bloqueia o recebimento.
 */
export async function extractPackageLabelWithAi<
  T extends AiLabelUnit,
  B extends AiLabelBlock,
  R extends AiLabelResident,
>(
  input: AiLabelExtractionInput<T, B, R>,
): Promise<AiLabelExtraction<T>> {
  const startedAt = performance.now();
  const timeoutMs = input.timeoutMs ?? 9000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const invocation = input.client.functions.invoke("extract-package-label", {
    body: {
      condominiumId: input.condominiumId,
      imageBase64: input.imageBase64,
      mimeType: input.mimeType,
      expectedAddress: input.expectedAddress,
    },
  });

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new AiLabelExtractionError(
            "A leitura na nuvem excedeu o tempo limite.",
            "timeout",
          ),
        ),
      timeoutMs,
    );
  });

  try {
    const { data, error } = await Promise.race([invocation, timeout]);
    if (error) {
      const invokeError = error as {
        message?: string;
        context?: { body?: { detail?: string; error?: string } };
      };
      const detail =
        invokeError.context?.body?.detail ??
        invokeError.context?.body?.error ??
        invokeError.message ??
        "A leitura na nuvem não respondeu.";
      throw new AiLabelExtractionError(detail, "unavailable");
    }

    const payload = data as EdgeExtractResponse | null;
    if (!payload?.label) {
      throw new AiLabelExtractionError(
        payload?.error ?? "A leitura na nuvem não devolveu a etiqueta.",
        "invalid",
      );
    }

    const label = parseAiLabel(payload.label, payload.diagnostics);
    const unitCandidates = matchAiUnits(
      label,
      input.units,
      input.blocks,
      input.residents,
    );

    return {
      ...label,
      durationMs: Math.round(performance.now() - startedAt),
      postalCodes: label.destinationCep ? [label.destinationCep] : [],
      unitCandidates,
      unitId: unitCandidates.length === 1 ? unitCandidates[0].id : "",
    };
  } catch (error) {
    if (error instanceof AiLabelExtractionError) throw error;
    throw new AiLabelExtractionError(
      error instanceof Error ? error.message : "A leitura na nuvem falhou.",
      "unavailable",
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Um único leitor para a sessão inteira. Criar um a cada rotação (4 por foto)
// retém buffers do tamanho da imagem e derruba o WebView depois de poucas fotos.
let sharedBarcodeReader: import("@zxing/browser").BrowserMultiFormatReader | null =
  null;

async function decodeBarcodes(canvas: HTMLCanvasElement) {
  const nativeFormats = [
    "qr_code",
    "data_matrix",
    "pdf417",
    "aztec",
    "code_128",
    "code_39",
    "code_93",
    "itf",
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
  ];
  const NativeDetector = getNativeBarcodeDetector();
  if (NativeDetector) {
    try {
      const supportedFormats = await NativeDetector.getSupportedFormats();
      const formats = nativeFormats.filter((format) =>
        supportedFormats.includes(format),
      );
      if (formats.length) {
        const results = await new NativeDetector({ formats }).detect(canvas);
        const codes = results.map((result) => result.rawValue).filter(Boolean);
        if (codes.length) return codes;
      }
    } catch {
      // Fall back to ZXing when the native detector is unavailable.
    }
  }

  const { BarcodeFormat, BrowserMultiFormatReader } = await import(
    "@zxing/browser"
  );
  const reader = sharedBarcodeReader ?? new BrowserMultiFormatReader();
  sharedBarcodeReader = reader;
  reader.possibleFormats = [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.PDF_417,
    BarcodeFormat.AZTEC,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.ITF,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ];
  try {
    return [reader.decodeFromCanvas(canvas).getText()];
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundException") {
      return [];
    }
    throw error;
  }
}

/**
 * Etiqueta fotografada deitada é comum. Girar e tentar de novo custa alguns
 * milissegundos e evita o "não consegui ler" que obriga o preenchimento manual.
 */
export async function readPackageCodes(canvas: HTMLCanvasElement) {
  const direct = await decodeBarcodes(canvas);
  if (direct.length) return direct;

  for (const degrees of [90, 270, 180]) {
    const rotated = rotateCanvas(canvas, degrees);
    try {
      const codes = await decodeBarcodes(rotated);
      if (codes.length) return codes;
    } catch {
      // Rotação sem leitura: segue para a próxima.
    } finally {
      // Força a liberação do buffer do canvas antes da próxima rotação.
      rotated.width = 0;
      rotated.height = 0;
    }
  }

  return [];
}

/**
 * Resultado de uma leitura sem texto: só o código de barras foi reconhecido.
 * A nuvem é a única fonte automática de CEP, logradouro, número e nome.
 */
export function barcodeOnlyLabelRead(
  barcodeValues: string[],
  detail: string,
): LabelReadResult {
  return {
    text: "",
    numericText: "",
    barcodeValues,
    attempts: [],
    durationMs: 0,
    cropped: false,
    postalCodes: [],
    error: new Error(detail),
  };
}

export function buildLabelDiagnostics(
  result: LabelReadResult,
  extra: { cep: string; status: string },
) {
  const lines = [
    `total_ms: ${result.durationMs}`,
    `modo: somente-codigo-de-barras`,
    `cep_esperado: ${extra.cep || "-"}`,
    `ceps_lidos: ${result.postalCodes.join(", ") || "-"}`,
    `verificacao: ${extra.status}`,
    `codigos: ${result.barcodeValues.join(" | ") || "-"}`,
    "",
    "--- texto ---",
    result.text,
  ];

  if (result.error) {
    lines.push("", `erro: ${result.error instanceof Error ? result.error.message : String(result.error)}`);
  }

  return lines.join("\n");
}

export { findResidentUnitCandidates, findUnitCandidates };
