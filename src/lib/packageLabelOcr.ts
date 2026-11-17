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

type OcrWorker = Awaited<
  ReturnType<typeof import("tesseract.js").createWorker>
>;
type OcrProgressListener = (status: string, progress: number) => void;

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

const maximumRecognitionDimension = 2200;
const progressListeners = new Set<OcrProgressListener>();
let workerPromise: Promise<OcrWorker> | null = null;
let ocrWorker: OcrWorker | null = null;

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

async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await import("tesseract.js");
      const worker = await createWorker("por", OEM.LSTM_ONLY, {
        workerPath: "/ocr/worker.min.js",
        langPath: "/ocr/lang",
        corePath: "/ocr/core",
        gzip: true,
        cacheMethod: "readOnly",
        logger: ({ status, progress }) => {
          for (const listener of progressListeners) {
            listener(status, progress);
          }
        },
      });

      try {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
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

export async function preparePackageImage(file: File) {
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let bitmap: ImageBitmap | null = null;
  let imageUrl = "";

  if (typeof createImageBitmap === "function") {
    bitmap = await createImageBitmap(file);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } else {
    const image = new Image();
    imageUrl = URL.createObjectURL(file);
    image.src = imageUrl;
    try {
      await image.decode();
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
  }

  try {
    const scale = Math.min(1, maximumRecognitionDimension / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext("2d", { willReadFrequently: false });
    if (!context) {
      throw new Error("Não foi possível preparar a imagem para leitura.");
    }
    context.filter = "grayscale(1) contrast(1.2)";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap?.close();
  }
}

export async function readPackageCodes(canvas: HTMLCanvasElement) {
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

export function releasePackageOcr() {
  const worker = ocrWorker;
  ocrWorker = null;
  workerPromise = null;
  return worker?.terminate() ?? Promise.resolve();
}

export async function recognizePackageImage(
  image: HTMLCanvasElement,
  onProgress: OcrProgressListener,
) {
  progressListeners.add(onProgress);
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(image, {}, { text: true });
    return data.text.trim();
  } finally {
    progressListeners.delete(onProgress);
  }
}

export { findResidentUnitCandidates, findUnitCandidates };
