import type { SupabaseClient } from "@supabase/supabase-js";
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

type OcrWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
type TesseractModule = typeof import("tesseract.js");
type PageSegMode = NonNullable<
  NonNullable<Parameters<OcrWorker["setParameters"]>[0]>["tessedit_pageseg_mode"]
>;
type OcrProgressListener = (status: string, progress: number) => void;

type WordBox = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

type OcrBlock = {
  paragraphs?: Array<{
    lines?: Array<{ words?: WordBox[] }>;
  }>;
};

export type ImageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PreparedPackageImage = {
  /** Cópia reduzida, usada para localizar a etiqueta e ler códigos. */
  preview: HTMLCanvasElement;
  /** Dimensões na resolução original do arquivo. */
  width: number;
  height: number;
  /** Recorta da resolução original, não da cópia reduzida. */
  drawRegion(rect: ImageRect, targetLongEdge: number): HTMLCanvasElement;
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
  /** Falha do OCR. O código de barras e o texto parcial continuam válidos. */
  error?: unknown;
};

export type LabelReadOptions = {
  expectedCep?: string;
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
  ["pegaki", "Pegaki"],
  ["kangu", "Kangu"],
  ["braspress", "Braspress"],
  ["gfl", "GFL"],
] as const;

/** Cópia usada para localizar a etiqueta. Pequena de propósito: é rápida. */
const previewDimension = 1600;
/**
 * Resolução final do recorte entregue ao Tesseract. 2000 px custava 7 s por
 * passada em celular e não lia melhor: etiqueta térmica tem traço grosso e o
 * que atrapalha é ruído, não falta de pixel.
 */
const cropLongEdge = 1600;
/** Ampliar demais só engrossa o serrilhado da impressão térmica. */
const maximumUpscale = 1.8;
/**
 * Orçamento de tempo para as passadas extras. O porteiro está com o pacote na
 * mão: melhor devolver o que já foi lido do que segurar a fila.
 */
const optionalPassBudgetMs = 12000;
const minimumWordConfidence = 30;
const minimumWordsForCrop = 6;
const minimumTextLength = 40;
const minimumCropArea = 0.08;
const maximumCropArea = 0.92;

const progressListeners = new Set<OcrProgressListener>();
let workerPromise: Promise<OcrWorker> | null = null;
let ocrWorker: OcrWorker | null = null;
let tesseractModule: TesseractModule | null = null;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeLine(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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
  /\b(?:c[oó]digo\s+de\s+(?:rastreio|rastreamento)|rastreio|rastreamento|tracking(?:\s*(?:code|number|id|no))?|awb)\b\s*[:#-]?\s*/i;

export function extractTrackingCode(value: string) {
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

export function detectDeliveryCompany(value: string) {
  const normalized = normalizeText(value);
  const trackingCode = extractTrackingCode(value);

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

async function getTesseractModule() {
  if (!tesseractModule) {
    tesseractModule = await import("tesseract.js");
  }
  return tesseractModule;
}

async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await getTesseractModule();
      const worker = await createWorker("por", OEM.LSTM_ONLY, {
        workerPath: "/ocr/worker.min.js",
        langPath: "/ocr/lang",
        corePath: "/ocr/core",
        gzip: true,
        cacheMethod: "readOnly",
        logger: ({ status, progress }) => {
          // O progresso do reconhecimento é reportado por readPackageLabel,
          // que conhece cada passada. Aqui importa a inicialização do worker.
          if (status === "recognizing text") return;
          for (const listener of progressListeners) {
            listener("Preparando o leitor local de etiquetas...", progress);
          }
        },
      });

      try {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
        ocrWorker = worker;
        return worker;
      } catch (error) {
        await worker.terminate();
        throw error;
      }
    })().catch((error: unknown) => {
      workerPromise = null;
      throw error;
    });
  }

  return workerPromise;
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
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

function otsuThreshold(gray: Uint8ClampedArray) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < gray.length; index += 1) {
    histogram[gray[index]] += 1;
  }

  const total = gray.length;
  let sum = 0;
  for (let level = 0; level < 256; level += 1) sum += level * histogram[level];

  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = 0;
  let threshold = 128;

  for (let level = 0; level < 256; level += 1) {
    weightBackground += histogram[level];
    if (weightBackground === 0) continue;

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += level * histogram[level];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = level;
    }
  }

  return threshold;
}

/**
 * Limiar adaptativo por integral image: compensa reflexo no plástico e sombra
 * nos cantos, que a binarização global (Otsu) transforma em borrão.
 */
function adaptiveThreshold(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  output: Uint8ClampedArray,
) {
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const rowOffset = (y + 1) * stride;
    const previousRow = y * stride;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x];
      integral[rowOffset + x + 1] = integral[previousRow + x + 1] + rowSum;
    }
  }

  const radius = Math.max(8, Math.round(Math.min(width, height) / 32));
  const bias = 10;

  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    const topOffset = top * stride;
    const bottomOffset = (bottom + 1) * stride;

    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const area = (right - left + 1) * (bottom - top + 1);

      const sum =
        integral[bottomOffset + right + 1] -
        integral[topOffset + right + 1] -
        integral[bottomOffset + left] +
        integral[topOffset + left];

      output[y * width + x] = gray[y * width + x] < sum / area - bias ? 0 : 255;
    }
  }
}

type BinarizationMode = "adaptive" | "otsu";

function binarizeCanvas(source: HTMLCanvasElement, mode: BinarizationMode) {
  const canvas = createCanvas(source.width, source.height);
  const context = canvasContext(canvas);
  context.drawImage(source, 0, 0);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const pixelCount = canvas.width * canvas.height;
  const gray = new Uint8ClampedArray(pixelCount);

  for (let index = 0, pixel = 0; pixel < pixelCount; index += 4, pixel += 1) {
    gray[pixel] =
      (pixels[index] * 299 +
        pixels[index + 1] * 587 +
        pixels[index + 2] * 114) /
      1000;
  }

  const output = new Uint8ClampedArray(pixelCount);
  if (mode === "otsu") {
    const threshold = otsuThreshold(gray);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      output[pixel] = gray[pixel] < threshold ? 0 : 255;
    }
  } else {
    adaptiveThreshold(gray, canvas.width, canvas.height, output);
  }

  for (let index = 0, pixel = 0; pixel < pixelCount; index += 4, pixel += 1) {
    const value = output[pixel];
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

async function loadImageSource(file: File) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
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
    drawRegion(rect, targetLongEdge) {
      const scale = Math.min(
        maximumUpscale,
        targetLongEdge / Math.max(rect.width, rect.height, 1),
      );
      const canvas = createCanvas(
        Math.max(1, Math.round(rect.width * scale)),
        Math.max(1, Math.round(rect.height * scale)),
      );
      const cropContext = canvasContext(canvas);
      cropContext.imageSmoothingEnabled = true;
      cropContext.imageSmoothingQuality = "high";
      cropContext.drawImage(
        source.element,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      return canvas;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      source.dispose();
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

/** Lado maior da foto enviada à Vision API e ao Storage. */
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
 * A imagem original do celular tem 3–8 MB e não serve nem para a Vision API
 * (limite de payload) nem para o Storage (cota). A compressão é feita uma vez
 * e o MESMO arquivo vai para as duas pontas. Nada de grayscale ou filtro
 * destrutivo: a IA lê a etiqueta colorida, inclusive logos de transportadora.
 */
export async function compressPackagePhoto(
  file: File,
): Promise<CompressedPackagePhoto> {
  const source = await loadImageSource(file);
  try {
    const scale = Math.min(
      1,
      aiImageLongEdge / Math.max(source.width, source.height, 1),
    );
    const canvas = createCanvas(
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

    const blob = await canvasToBlob(canvas, "image/jpeg", aiImageQuality);
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
  }
}

export type AiLabelAddressStatus = "verified" | "mismatch" | "unknown";

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
  expectedAddress: { cep: string; street: string; address_number: string };
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
  error?: string;
  fallback?: boolean;
};

function textField(value: unknown, maxLength = 200) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function parseAiLabel(raw: Record<string, unknown>): AiPackageLabel {
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

/**
 * Casa a unidade devolvida pela IA com o cadastro local. A IA lê "APTO 901" ou
 * "Bloco B, 102"; o banco guarda "901" e "Bloco B". A comparação é por chaves
 * normalizadas, e o bloco restringe a busca para não pegar a unidade 901 de
 * outra torre.
 */
function matchAiUnits<T extends AiLabelUnit>(
  label: AiPackageLabel,
  units: T[],
  blocks: AiLabelBlock[],
  residents: AiLabelResident[],
) {
  const block = label.blockName ? blockKey(label.blockName) : "";
  const blockId = block
    ? blocks.find((candidate) => {
        const key = blockKey(candidate.name);
        return (
          Boolean(key) && (key === block || key.includes(block) || block.includes(key))
        );
      })?.id
    : "";

  const scoped = blockId
    ? units.filter((unit) => unit.block_id === blockId)
    : units;
  const pool = scoped.length ? scoped : units;

  if (label.unitNumber) {
    const matches = pool.filter((unit) =>
      sharesUnitKey(label.unitNumber, unit.unit_number),
    );
    if (matches.length) return matches;
  }

  if (label.recipientName) {
    return findResidentUnitCandidates(label.recipientName, units, residents);
  }

  return [];
}

/**
 * Extrai a etiqueta na nuvem (Gemini) com prazo curto. Em qualquer falha,
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

    const label = parseAiLabel(payload.label);
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
  const reader = new BrowserMultiFormatReader();
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
    try {
      const rotated = await decodeBarcodes(rotateCanvas(canvas, degrees));
      if (rotated.length) return rotated;
    } catch {
      // Rotação sem leitura: segue para a próxima.
    }
  }

  return [];
}

function collectWords(blocks: OcrBlock[] | null) {
  const words: WordBox[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (word.text.trim()) words.push(word);
        }
      }
    }
  }
  return words;
}

type PassResult = {
  text: string;
  words: WordBox[];
  durationMs: number;
};

async function runOcrPass(
  worker: OcrWorker,
  image: HTMLCanvasElement,
  options: { pass: string; psm: PageSegMode; whitelist?: string; words?: boolean },
): Promise<PassResult> {
  const startedAt = performance.now();
  await worker.setParameters({
    tessedit_pageseg_mode: options.psm,
    tessedit_char_whitelist: options.whitelist ?? "",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const { data } = await worker.recognize(
    image,
    {},
    { text: true, blocks: options.words === true },
  );

  return {
    text: (data.text ?? "").trim(),
    words: options.words === true ? collectWords(data.blocks) : [],
    durationMs: Math.round(performance.now() - startedAt),
  };
}

function recordAttempt(pass: string, result: PassResult): LabelReadAttempt {
  return {
    pass,
    durationMs: result.durationMs,
    characters: result.text.replace(/\s/g, "").length,
  };
}

/**
 * Palavras que formam a etiqueta.
 *
 * O fundo da foto (parede, piso, plástico do pacote) só aparece com confiança
 * baixa. Incluí-lo na caixa fazia o recorte engolir o quadro inteiro: o
 * Tesseract gastava segundos com ruído e o texto saía repetido e sujo.
 *
 * O miolo legível define a etiqueta; dentro dele entra tudo, inclusive as
 * palavras de baixa confiança, que costumam ser o endereço em letra pequena.
 * Se o miolo não representar a maior parte do texto lido, ele não é a etiqueta
 * e vale a união de tudo — melhor recortar errado do que perder o texto.
 */
function confidentWords(words: WordBox[]) {
  const readable = words.filter(
    (word) => word.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 2,
  );

  let core = readable.filter((word) => word.confidence >= 60);
  if (core.length < minimumWordsForCrop) {
    core = readable.filter((word) => word.confidence >= 45);
  }
  if (core.length < minimumWordsForCrop) {
    core = readable.filter(
      (word) => word.confidence >= minimumWordConfidence,
    );
  }
  if (core.length < minimumWordsForCrop) return core;

  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const word of core) {
    x0 = Math.min(x0, word.bbox.x0);
    y0 = Math.min(y0, word.bbox.y0);
    x1 = Math.max(x1, word.bbox.x1);
    y1 = Math.max(y1, word.bbox.y1);
  }

  const padX = Math.max(8, (x1 - x0) * 0.06);
  const padY = Math.max(8, (y1 - y0) * 0.06);
  const inside = readable.filter((word) => {
    const centerX = (word.bbox.x0 + word.bbox.x1) / 2;
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
    return (
      centerX >= x0 - padX &&
      centerX <= x1 + padX &&
      centerY >= y0 - padY &&
      centerY <= y1 + padY
    );
  });

  return inside.length >= readable.length * 0.5 ? inside : readable;
}

/**
 * Região da etiqueta a partir das caixas de palavra do Tesseract. É o que
 * permite recortar da foto original em vez de ler o quadro inteiro reduzido.
 */
function labelRegion(
  words: WordBox[],
  preview: HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
): ImageRect | null {
  const useful = confidentWords(words);
  if (useful.length < minimumWordsForCrop) return null;

  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const word of useful) {
    x0 = Math.min(x0, word.bbox.x0);
    y0 = Math.min(y0, word.bbox.y0);
    x1 = Math.max(x1, word.bbox.x1);
    y1 = Math.max(y1, word.bbox.y1);
  }

  const scaleX = sourceWidth / preview.width;
  const scaleY = sourceHeight / preview.height;
  const padX = Math.max(14, (x1 - x0) * 0.1);
  const padY = Math.max(14, (y1 - y0) * 0.1);

  const left = Math.max(0, Math.round((x0 - padX) * scaleX));
  const top = Math.max(0, Math.round((y0 - padY) * scaleY));
  const right = Math.min(
    sourceWidth,
    Math.round((x1 + padX) * scaleX),
  );
  const bottom = Math.min(
    sourceHeight,
    Math.round((y1 + padY) * scaleY),
  );

  const width = right - left;
  const height = bottom - top;
  if (width < 40 || height < 40) return null;

  const areaRatio = (width * height) / (sourceWidth * sourceHeight);
  if (areaRatio < minimumCropArea || areaRatio > maximumCropArea) return null;

  return { x: left, y: top, width, height };
}

function collectPostalCodes(values: string[]) {
  const codes = new Set<string>();
  for (const value of values) {
    for (const match of value.match(/(?:^|[^\d])\d{5}[\s.-]?\d{3}(?=$|[^\d])/g) ??
      []) {
      codes.add(match.replace(/\D/g, ""));
    }
  }
  return codes;
}

function foundExpectedCep(
  variants: string[],
  numericText: string,
  barcodeValues: string[],
  expectedCep: string,
) {
  if (expectedCep.length !== 8) return false;
  return collectPostalCodes([
    ...variants,
    numericText,
    ...barcodeValues,
  ]).has(expectedCep);
}

/**
 * Escolhe a melhor leitura e só completa o que faltar nela.
 *
 * Antes as passadas eram concatenadas: a mesma etiqueta aparecia três vezes no
 * texto final, cada vez com erros diferentes, e a âncora do destinatário podia
 * cair na cópia errada. Agora a passada mais informativa é a base e as outras
 * só acrescentam linha que a base não tem.
 */
function mergeTextVariants(variants: string[]) {
  const unique = variants.filter((variant) => variant.trim().length > 0);
  if (!unique.length) return "";

  const score = (text: string) => {
    const tokens = normalizeLine(text).match(/[a-z0-9]{3,}/g) ?? [];
    // CEP vale muito mais que uma palavra: é ele que confirma o endereço.
    return tokens.length + collectPostalCodes([text]).size * 25;
  };
  const ordered = [...unique].sort((left, right) => score(right) - score(left));

  const lines: string[] = [];
  const seen = new Set<string>();
  const knownTokens = new Set<string>();

  const push = (rawLine: string) => {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return false;

    const key = normalizeLine(line);
    if (seen.has(key)) return false;

    seen.add(key);
    lines.push(line);
    for (const token of key.match(/[a-z0-9]{3,}/g) ?? []) knownTokens.add(token);
    return true;
  };

  const [base, ...rest] = ordered;
  for (const line of base.split(/\r?\n/)) push(line);

  for (const variant of rest) {
    for (const line of variant.split(/\r?\n/)) {
      const key = normalizeLine(line.replace(/\s+/g, " ").trim());
      if (seen.has(key)) continue;

      const tokens = key.match(/[a-z0-9]{3,}/g) ?? [];
      if (tokens.length) {
        const contained =
          tokens.filter((token) => knownTokens.has(token)).length /
          tokens.length;
        // Linha que já está representada na base, só com outro erro de OCR.
        if (contained >= 0.6) {
          seen.add(key);
          continue;
        }
      }

      push(line);
    }
  }

  return lines.join("\n");
}

/**
 * Lê a etiqueta em até quatro passadas e para assim que o CEP do condomínio
 * aparece. Uma passada só, no quadro inteiro reduzido, era o motivo de o OCR
 * devolver pouco mais de cem caracteres.
 */
export async function readPackageLabel(
  prepared: PreparedPackageImage,
  options: LabelReadOptions,
  onProgress: OcrProgressListener,
): Promise<LabelReadResult> {
  const startedAt = performance.now();
  const attempts: LabelReadAttempt[] = [];
  const expectedCep = (options.expectedCep ?? "").replace(/\D/g, "");
  const variants: string[] = [];

  let barcodeValues: string[] = [];
  let numericText = "";
  let cropped = false;
  let error: unknown = null;

  try {
    onProgress("Lendo QR e códigos de barras...", 0.02);
    try {
      barcodeValues = await readPackageCodes(prepared.preview);
    } catch {
      // Código de barras é bônus: sem ele seguimos com o texto.
    }

    progressListeners.add(onProgress);

    try {
      const { PSM } = await getTesseractModule();
      const worker = await getOcrWorker();

      onProgress("Localizando o texto da etiqueta...", 0.12);
      const layout = await runOcrPass(worker, prepared.preview, {
        pass: "geral",
        psm: PSM.SPARSE_TEXT,
        words: true,
      });
      attempts.push(recordAttempt("geral", layout));
      variants.push(layout.text);

      const region = labelRegion(
        layout.words,
        prepared.preview,
        prepared.width,
        prepared.height,
      );

      const elapsedMs = () => performance.now() - startedAt;
      const confirmed = () =>
        foundExpectedCep(variants, numericText, barcodeValues, expectedCep);

      if (region) {
        cropped = true;
        const crop = prepared.drawRegion(region, cropLongEdge);

        if (!confirmed()) {
          // Otsu primeiro: a binarização global é limpa e o Tesseract voa
          // nela. A adaptativa recupera reflexo, mas enche a imagem de ruído
          // (era ela que levava 7 s por passada e devolvia lixo).
          onProgress("Recortando e reforçando a leitura...", 0.4);
          const otsu = binarizeCanvas(crop, "otsu");
          const enhanced = await runOcrPass(worker, otsu, {
            pass: "recorte",
            psm: PSM.SPARSE_TEXT,
          });
          attempts.push(recordAttempt("recorte", enhanced));
          variants.unshift(enhanced.text);

          // Recorte já lendo bem: a passada adaptativa custa segundos e
          // devolve quase o mesmo texto. Ela fica reservada para quando a
          // binarização global não deu conta (reflexo, sombra).
          const enhancedCharacters = enhanced.text.replace(/\s/g, "").length;

          if (
            !confirmed() &&
            enhancedCharacters < 200 &&
            elapsedMs() < optionalPassBudgetMs
          ) {
            onProgress("Tentando com contraste adaptativo...", 0.62);
            const adaptive = binarizeCanvas(crop, "adaptive");
            const adaptivePass = await runOcrPass(worker, adaptive, {
              pass: "contraste",
              psm: PSM.SPARSE_TEXT,
            });
            attempts.push(recordAttempt("contraste", adaptivePass));
            variants.unshift(adaptivePass.text);
          }

          // A passada só de dígitos existe para salvar um CEP quando o texto
          // saiu fraco. Com texto bom e sem CEP lido, o CEP provavelmente não
          // está na etiqueta — e a passada custa segundos.
          if (
            !confirmed() &&
            enhancedCharacters < 200 &&
            elapsedMs() < optionalPassBudgetMs &&
            collectPostalCodes(variants).size === 0
          ) {
            onProgress("Lendo os números da etiqueta...", 0.8);
            const digits = await runOcrPass(worker, otsu, {
              pass: "numeros",
              psm: PSM.SPARSE_TEXT,
              whitelist: "0123456789",
            });
            attempts.push(recordAttempt("numeros", digits));
            numericText = digits.text;
          }
        }

        if (!barcodeValues.length && elapsedMs() < optionalPassBudgetMs * 2) {
          try {
            barcodeValues = await readPackageCodes(crop);
          } catch {
            // Sem código legível: o texto continua valendo.
          }
        }
      } else {
        onProgress("Reforçando a leitura da etiqueta...", 0.4);
        const enhanced = await runOcrPass(
          worker,
          binarizeCanvas(prepared.preview, "adaptive"),
          { pass: "binarizado", psm: PSM.SPARSE_TEXT },
        );
        attempts.push(recordAttempt("binarizado", enhanced));
        variants.unshift(enhanced.text);
      }

      let merged = mergeTextVariants(variants);

      // Quase nada lido e nenhum código: provavelmente a foto está deitada.
      if (
        merged.replace(/\s/g, "").length < minimumTextLength &&
        !barcodeValues.length
      ) {
        onProgress("Girando a etiqueta e tentando de novo...", 0.9);
        const sideways = await runOcrPass(
          worker,
          rotateCanvas(prepared.preview, 90),
          { pass: "girada", psm: PSM.SPARSE_TEXT },
        );
        attempts.push(recordAttempt("girada", sideways));
        variants.unshift(sideways.text);
        merged = mergeTextVariants(variants);
      }

      return {
        text: merged,
        numericText,
        barcodeValues,
        attempts,
        durationMs: Math.round(performance.now() - startedAt),
        cropped,
        postalCodes: [
          ...collectPostalCodes([merged, numericText, ...barcodeValues]),
        ],
      };
    } catch (ocrError) {
      error = ocrError;
      // Terminar o worker obriga a recarregar o WASM na próxima foto. Só vale
      // a pena quando o erro é de memória; erro de leitura comum não deixa o
      // worker inutilizável.
      if (isOcrWorkerMemoryError(ocrError)) {
        void releasePackageOcr().catch(() => {});
      }

      const partialText = mergeTextVariants(variants);
      return {
        text: partialText,
        numericText,
        barcodeValues,
        attempts,
        durationMs: Math.round(performance.now() - startedAt),
        cropped,
        postalCodes: [
          ...collectPostalCodes([partialText, numericText, ...barcodeValues]),
        ],
        error,
      };
    }
  } finally {
    progressListeners.delete(onProgress);
    prepared.dispose();
  }
}

export function buildLabelDiagnostics(
  result: LabelReadResult,
  extra: { cep: string; status: string },
) {
  const passes = result.attempts
    .map((attempt) => `${attempt.pass}=${attempt.characters}ch/${attempt.durationMs}ms`)
    .join(" ");
  const lines = [
    `total_ms: ${result.durationMs}`,
    `recorte: ${result.cropped ? "sim" : "nao"}`,
    `passadas: ${passes}`,
    `cep_esperado: ${extra.cep || "-"}`,
    `ceps_lidos: ${result.postalCodes.join(", ") || "-"}`,
    `verificacao: ${extra.status}`,
    `codigos: ${result.barcodeValues.join(" | ") || "-"}`,
    "",
    "--- texto ---",
    result.text,
  ];

  if (result.numericText) {
    lines.push("", "--- numeros ---", result.numericText);
  }

  return lines.join("\n");
}

export function releasePackageOcr() {
  const worker = ocrWorker;
  ocrWorker = null;
  workerPromise = null;
  return worker?.terminate() ?? Promise.resolve();
}

function isOcrWorkerMemoryError(error: unknown) {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : String(error ?? "");
  return /quota|memory|mem[oó]ria|alloc|insufficient space|no space|out of space/i.test(
    message,
  );
}

export { findResidentUnitCandidates, findUnitCandidates };
