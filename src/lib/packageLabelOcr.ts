import {
  findResidentUnitCandidates,
  findUnitCandidates,
} from "./packageOcr";

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
/** Resolução final do recorte entregue ao Tesseract. */
const cropLongEdge = 2000;
/** Ampliar demais só engrossa o serrilhado da impressão térmica. */
const maximumUpscale = 2.2;
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
 * Região da etiqueta a partir das caixas de palavra do Tesseract. É o que
 * permite recortar da foto original em vez de ler o quadro inteiro reduzido.
 */
function labelRegion(
  words: WordBox[],
  preview: HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
): ImageRect | null {
  const useful = words.filter(
    (word) =>
      word.confidence >= minimumWordConfidence &&
      word.text.replace(/[^\p{L}\p{N}]/gu, "").length >= 2,
  );
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

function mergeTextVariants(variants: string[]) {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const variant of variants) {
    for (const rawLine of variant.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (line.replace(/[^\p{L}\p{N}]/gu, "").length < 2) continue;

      const key = normalizeLine(line);
      if (seen.has(key)) continue;

      seen.add(key);
      lines.push(line);
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

      if (region) {
        cropped = true;
        const crop = prepared.drawRegion(region, cropLongEdge);
        const adaptive = binarizeCanvas(crop, "adaptive");

        onProgress("Recortando e reforçando a leitura...", 0.4);
        const enhanced = await runOcrPass(worker, adaptive, {
          pass: "recorte",
          psm: PSM.SPARSE_TEXT,
        });
        attempts.push(recordAttempt("recorte", enhanced));
        variants.unshift(enhanced.text);

        if (!foundExpectedCep(variants, numericText, barcodeValues, expectedCep)) {
          onProgress("Tentando outro modo de leitura...", 0.62);
          const otsu = binarizeCanvas(crop, "otsu");
          const blockPass = await runOcrPass(worker, otsu, {
            pass: "contraste",
            psm: PSM.SINGLE_BLOCK,
          });
          attempts.push(recordAttempt("contraste", blockPass));
          variants.unshift(blockPass.text);
        }

        if (!foundExpectedCep(variants, numericText, barcodeValues, expectedCep)) {
          onProgress("Lendo os números da etiqueta...", 0.8);
          const digits = await runOcrPass(worker, adaptive, {
            pass: "numeros",
            psm: PSM.SPARSE_TEXT,
            whitelist: "0123456789",
          });
          attempts.push(recordAttempt("numeros", digits));
          numericText = digits.text;
        }

        if (!barcodeValues.length) {
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
      };
    } catch (ocrError) {
      // O worker pode ter ficado em estado ruim: a próxima foto começa limpa.
      error = ocrError;
      void releasePackageOcr().catch(() => {});

      return {
        text: mergeTextVariants(variants),
        numericText,
        barcodeValues,
        attempts,
        durationMs: Math.round(performance.now() - startedAt),
        cropped,
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

export { findResidentUnitCandidates, findUnitCandidates };
