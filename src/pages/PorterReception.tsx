import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  LogOut,
  PackageCheck,
  Search,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Pagination } from "../components/Pagination";
import {
  RECORD_PAGE_SIZE,
  fetchPackageRecords,
  fetchPackageSignature,
  type PackageSort,
} from "../lib/packageQueries";
import {
  bulkReviewReasons,
  isDuplicateBulkMessage,
} from "../lib/bulkImportReview";
import {
  buildLabelDiagnostics,
  compressPackagePhoto,
  detectDeliveryCompany,
  extractPackageLabelWithAi,
  extractTrackingCode,
  findResidentUnitCandidates,
  findUnitCandidates,
  matchKnownBarcode,
  preparePackageImage,
  readPackageCodes,
  readPackageLabel,
  releasePackageOcr,
  type AiLabelExtraction,
  type LabelReadResult,
  type PreparedPackageImage,
} from "../lib/packageLabelOcr";
import {
  extractRecipientName,
  findDestinationSection,
  verifyPackageDestinationAddress,
  type PackageAddressVerification,
} from "../lib/packageOcr";
import {
  buildPackageNotificationMessage,
  whatsappLink,
  type PackageNotification,
} from "../lib/packageNotifications";
import { supabase } from "../lib/supabase";
import {
  clearReceptionDraft,
  dataUrlToFile,
  fileToDataUrl,
  loadReceptionDraft,
  saveReceptionDraft,
  type DraftUnit,
  type DraftView,
  type ReceptionDraft,
} from "../lib/receptionDraft";

/** Evento não padronizado emitido pelo Chrome quando o app pode ser instalado. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type PorterAccount = {
  id: string;
  condominium_id: string;
  name: string;
  username: string;
  access_expires_at: string | null;
};

type Condominium = {
  id: string;
  name: string;
  block_count: number;
  cep: string;
  street: string;
  address_number: string;
};

type Block = {
  id: string;
  name: string;
};

type Unit = {
  id: string;
  unit_number: string;
  block_id: string | null;
};

type UnitResident = {
  id: string;
  name: string | null;
  whatsapp: string | null;
};

type AuthorizedResident = {
  unit_id: string;
  name: string | null;
  whatsapp?: string | null;
};

type PackageRecord = {
  id: string;
  unit_number: string;
  block_name: string | null;
  resident_name: string | null;
  recipient_is_resident: boolean;
  sender: string | null;
  delivery_person: string | null;
  tracking_code: string | null;
  received_at: string;
  status: "received" | "collected";
  collected_at: string | null;
  collected_by_name: string | null;
  collected_signature?: string | null;
  is_damaged: boolean;
  last_notified_at: string | null;
};

type PorterView = "home" | "ledger" | "pending";

const UNIT_SEARCH_PAGE_SIZE = 6;

const receiptBucket = "package-receipts";
const maximumImageSize = 10 * 1024 * 1024;
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const packageFields =
  "id, unit_number, block_name, resident_name, recipient_is_resident, sender, delivery_person, tracking_code, received_at, status, collected_at, collected_by_name, collected_signature, is_damaged, last_notified_at";

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

function getPorterViewFromLocation(): PorterView {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "ledger" || view === "pending" ? view : "home";
}

const DEVICE_RESOURCE_MESSAGE =
  "O aparelho não tinha recursos suficientes para processar a etiqueta. Feche outros aplicativos e tente novamente.";

function isDeviceResourceError(error: unknown) {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "object" && error !== null
        ? `${"name" in error ? String(error.name) : ""} ${
            "message" in error ? String(error.message) : ""
          }`
        : String(error ?? "");
  // Tesseract erra com "memory/alloc"; a câmera do Android fala em
  // "espaço/storage". Nenhum dos dois quer dizer que o celular está sem
  // espaço de armazenamento — mostrar essa mensagem engana o porteiro.
  return /quota|out of memory|memory|mem[oó]ria|alloc|storage|armazenamento|insufficient space|no space|not enough (storage|space)|falta de espaço|sem espaço|espaço insuficiente|espaço disponível/i.test(
    message,
  );
}

function friendlyError(error: unknown, fallback: string) {
  if (isDeviceResourceError(error)) {
    return DEVICE_RESOURCE_MESSAGE;
  }
  return error instanceof Error && error.message.trim()
    ? `${fallback} ${error.message}`
    : fallback;
}

function deliveryPersonStorageKey(condominiumId: string) {
  return `encomenda-last-delivery-person:${condominiumId}`;
}

function readSavedDeliveryPerson(condominiumId: string) {
  try {
    return window.sessionStorage.getItem(deliveryPersonStorageKey(condominiumId)) ?? "";
  } catch {
    return "";
  }
}

function defaultAddressMessage(status: "verified" | "mismatch" | "unknown") {
  if (status === "verified") return "Endereço de destino confirmado na etiqueta.";
  if (status === "mismatch") {
    return "A etiqueta indica um endereço diferente deste condomínio. Confira fisicamente antes de registrar.";
  }
  return "Não foi possível confirmar o endereço automaticamente; confira na etiqueta antes de salvar.";
}

/**
 * WebP é ~4x menor que PNG para traço de caneta. Navegador antigo devolve o
 * PNG silenciosamente, então conferimos o prefixo antes de confiar.
 */
function signatureDataUrl(canvas: HTMLCanvasElement) {
  const webp = canvas.toDataURL("image/webp", 0.82);
  return webp.startsWith("data:image/webp")
    ? webp
    : canvas.toDataURL("image/png");
}

/**
 * Estado de uma etiqueta já lida. Serve tanto ao formulário individual quanto
 * à fila de importação. A foto comprimida vai só para a leitura e é descartada
 * depois; nenhuma imagem da etiqueta é enviada ao Storage.
 */
type PackageDraft = {
  /** Arquivo original, guardado para permitir nova tentativa de leitura. */
  source: File;
  /** JPEG comprimido enviado apenas para a leitura da etiqueta. */
  file: File;
  unitId: string;
  unitCandidates: Unit[];
  recipientName: string;
  recipientIsResident: boolean;
  company: string;
  deliveryPerson: string;
  trackingCode: string;
  addressVerification: PackageAddressVerification;
  labelRead: LabelReadResult | null;
  ocrMessage: string;
};

type BulkItemStatus = "queued" | "processing" | "done" | "error" | "review";

const bulkStatusLabel: Record<BulkItemStatus, string> = {
  queued: "Na fila",
  processing: "Processando",
  done: "Registrado",
  error: "Erro",
  review: "Revisar",
};

type BulkItem = {
  id: string;
  name: string;
  source: File;
  status: BulkItemStatus;
  draft: PackageDraft | null;
  message: string;
  /** Aceite explícito de endereço divergente. */
  acknowledged: boolean;
  /** Aceite explícito de rastreio repetido (outro volume). */
  allowDuplicate: boolean;
  createdPackageId: string;
  whatsappLink: string;
};

class DuplicatePackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicatePackageError";
  }
}

type LabelReadContext = {
  condominium: Condominium;
  units: Unit[];
  blocks: Block[];
  residents: AuthorizedResident[];
  onProgress?: (message: string) => void;
};

function draftFromAi(
  ai: AiLabelExtraction<Unit>,
  barcodeValues: string[],
  file: File,
  source: File,
): PackageDraft {
  const detectedRecipient = ai.recipientName.trim();
  const barcodeMatch = matchKnownBarcode(barcodeValues);
  const localCode = barcodeValues.map(extractTrackingCode).find(Boolean) ?? "";
  // Código de barras lido na foto original vence a IA quando bate com um
  // formato conhecido; sem correspondência, mantém a ordem anterior.
  const code = barcodeMatch?.code || ai.trackingCode || localCode;
  const carrier =
    barcodeMatch?.carrier ||
    ai.carrier ||
    detectDeliveryCompany(`${barcodeValues.join("\n")}\n${code}`);

  const diag = ai.diagnostics;
  const transcript = [
    `origem: nuvem (${ai.durationMs} ms)`,
    ...(diag?.engine ? [`motor: ${diag.engine}`] : []),
    ...(diag
      ? [
          `tempos: ocr ${diag.ocrMs ?? "-"} ms · ia ${diag.aiMs ?? "-"} ms · ${diag.ocrWords ?? "-"} palavras`,
        ]
      : []),
    ...(diag?.aiUsed?.length
      ? [`campos IA ancorados: ${diag.aiUsed.join(", ")}`]
      : diag?.aiError
        ? [`IA indisponível: ${diag.aiError}`]
        : diag
          ? ["campos IA: nenhum (somente regras)"]
          : []),
    `destinatario: ${ai.recipientName || "-"}`,
    `unidade: ${ai.unitNumber || "-"}${ai.blockName ? ` / ${ai.blockName}` : ""}`,
    `transportadora: ${carrier || "-"}`,
    `rastreio: ${code || "-"}${barcodeMatch ? " (código de barras)" : ""}`,
    `codigo barras: ${
      barcodeMatch
        ? `${barcodeMatch.code} / ${barcodeMatch.carrier}`
        : barcodeValues.join(" | ") || "-"
    }`,
    `cep destino: ${ai.destinationCep || "-"}`,
    `endereco destino: ${
      [ai.destinationStreet, ai.destinationNumber].filter(Boolean).join(", ") || "-"
    }`,
    `status: ${ai.addressStatus}`,
    `motivo: ${ai.addressReason || "-"}`,
    ...(diag?.ocrText ? ["", "--- OCR Vision ---", diag.ocrText] : []),
  ].join("\n");

  const detectedFields = [
    detectedRecipient ? "destinatário" : "",
    ai.unitCandidates.length === 1 ? "apartamento" : "",
    carrier ? "empresa" : "",
    code ? "rastreio" : "",
    barcodeMatch ? "código de barras" : "",
    ai.addressStatus === "verified" ? "endereço" : "",
  ].filter(Boolean);

  return {
    source,
    file,
    unitId: ai.unitId,
    unitCandidates: ai.unitCandidates,
    recipientName: detectedRecipient,
    recipientIsResident: false,
    company: carrier,
    deliveryPerson: "",
    trackingCode: code,
    addressVerification: {
      status: ai.addressStatus,
      message: ai.addressReason || defaultAddressMessage(ai.addressStatus),
    },
    labelRead: {
      text: transcript,
      numericText: ai.destinationCep,
      barcodeValues,
      attempts: [
        {
          pass: "nuvem",
          durationMs: ai.durationMs,
          characters: transcript.replace(/\s/g, "").length,
        },
      ],
      durationMs: ai.durationMs,
      cropped: false,
      postalCodes: ai.postalCodes,
    },
    ocrMessage: detectedFields.length
      ? `Leitura na nuvem concluída: ${detectedFields.join(", ")}. Confira os dados.`
      : "Leitura na nuvem concluída, mas o endereço não foi confirmado automaticamente. Confira a etiqueta antes de salvar.",
  };
}

function draftFromLocalOcr(
  label: LabelReadResult,
  ctx: LabelReadContext,
  file: File,
  source: File,
): PackageDraft {
  const expectedCep = ctx.condominium.cep ?? "";
  const residentNames = ctx.residents
    .map((resident) => resident.name?.trim() ?? "")
    .filter(Boolean);
  const barcodeText = label.barcodeValues.join("\n");
  const recognizedText = label.text;
  const destinationText = findDestinationSection(
    recognizedText,
    residentNames,
    expectedCep,
  );
  const detectedRecipientName = extractRecipientName(
    recognizedText,
    residentNames,
    expectedCep,
  );
  const verification = verifyPackageDestinationAddress({
    recognizedText,
    numericText: label.numericText,
    barcodeText,
    address: ctx.condominium,
    residentNames,
  });
  const residentCandidates = findResidentUnitCandidates(
    `${barcodeText}\n${recognizedText}`,
    ctx.units,
    ctx.residents,
  );
  const numberCandidates = findUnitCandidates(
    `${barcodeText}\n${destinationText || recognizedText}`,
    ctx.units,
  );
  const candidates = residentCandidates.length
    ? residentCandidates
    : numberCandidates;
  const barcodeMatch = matchKnownBarcode(label.barcodeValues);
  const code =
    barcodeMatch?.code ||
    label.barcodeValues.map(extractTrackingCode).find(Boolean) ||
    extractTrackingCode(recognizedText);
  const detectedCompany =
    barcodeMatch?.carrier ||
    detectDeliveryCompany(`${barcodeText}\n${recognizedText}\n${code}`);

  let ocrMessage: string;
  if (label.error) {
    if (isDeviceResourceError(label.error)) {
      ocrMessage = DEVICE_RESOURCE_MESSAGE;
    } else if (code || detectedCompany || candidates.length) {
      ocrMessage =
        "Leitura no aparelho (modo offline): código da etiqueta lido, mas o texto não foi reconhecido; confira os dados.";
    } else {
      const details =
        label.error instanceof Error ? ` ${label.error.message}` : "";
      ocrMessage = `Leitura no aparelho (modo offline): não foi possível ler o texto da etiqueta.${details}`;
    }
  } else {
    const detectedFields = [
      detectedRecipientName ? "destinatário" : "",
      candidates.length === 1 ? "apartamento" : "",
      detectedCompany ? "empresa" : "",
      code ? "rastreio" : "",
      barcodeMatch ? "código de barras" : "",
      verification.status === "verified" ? "endereço" : "",
    ].filter(Boolean);
    const characters = recognizedText.replace(/\s/g, "").length;
    ocrMessage = detectedFields.length
      ? `Leitura no aparelho (modo offline): ${detectedFields.join(", ")}. Confira os dados.`
      : `Leitura no aparelho (modo offline): a etiqueta foi lida (${characters} caracteres), mas o endereço não foi confirmado. Enquadre a etiqueta inteira, com boa luz, e tire outra foto.`;
  }

  return {
    source,
    file,
    unitId: candidates.length === 1 ? candidates[0].id : "",
    unitCandidates: candidates,
    recipientName: detectedRecipientName,
    recipientIsResident: false,
    company: detectedCompany,
    deliveryPerson: "",
    trackingCode: code,
    addressVerification: verification,
    labelRead: label,
    ocrMessage,
  };
}

type Settled<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

function settled<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true, value } as const),
    (error: unknown) => ({ ok: false, error } as const),
  );
}

/**
 * Uma foto, uma leitura: Vision primeiro, OCR local como fallback. O código de
 * barras é lido da foto original em paralelo com a IA, porque a compressão
 * para a nuvem pode apagar linhas finas do código. Não toca no estado do React
 * para que a mesma função sirva à fila de importação.
 */
async function readLabelFromPhoto(
  image: File,
  ctx: LabelReadContext,
  options?: { compressed?: Awaited<ReturnType<typeof compressPackagePhoto>> },
): Promise<PackageDraft> {
  ctx.onProgress?.("Preparando a foto para leitura...");
  let preparedImage: PreparedPackageImage | null = null;
  let compressed: Awaited<ReturnType<typeof compressPackagePhoto>>;
  if (options?.compressed) {
    // O chamador já comprimiu para salvar o rascunho antes da leitura.
    compressed = options.compressed;
    preparedImage = await preparePackageImage(image);
  } else {
    // As duas etapas decodificam a mesma foto; rodando em paralelo poupamos
    // 100-350 ms no celular sem mudar um único pixel das imagens usadas.
    [compressed, preparedImage] = await Promise.all([
      compressPackagePhoto(image),
      preparePackageImage(image),
    ]);
  }
  const prepared = preparedImage;
  if (!prepared) {
    throw new Error("Não foi possível preparar a imagem para leitura.");
  }
  try {

    const [aiResult, barcodeValues] = await Promise.all([
      settled(
        extractPackageLabelWithAi({
          client: supabase,
          condominiumId: ctx.condominium.id,
          imageBase64: compressed.base64,
          mimeType: compressed.mimeType,
          expectedAddress: {
            cep: ctx.condominium.cep,
            street: ctx.condominium.street,
            address_number: ctx.condominium.address_number,
          },
          units: ctx.units,
          blocks: ctx.blocks,
          residents: ctx.residents,
        }),
      ),
      readPackageCodes(prepared.preview).catch(() => [] as string[]),
    ]);

    if (aiResult.ok) {
      return draftFromAi(aiResult.value, barcodeValues, compressed.file, image);
    }

    const detail =
      aiResult.error instanceof Error
        ? aiResult.error.message.replace(/\s+/g, " ").trim()
        : "";
    ctx.onProgress?.(
      `Leitura na nuvem indisponível; lendo a etiqueta no aparelho (modo offline)${
        detail ? `: ${detail.slice(0, 120)}` : ""
      }...`,
    );

    const label = await readPackageLabel(
      prepared,
      {
        expectedCep: ctx.condominium.cep ?? "",
        barcodeValues,
      },
      (status) => ctx.onProgress?.(status),
    );
    return draftFromLocalOcr(label, ctx, compressed.file, image);
  } finally {
    preparedImage?.dispose();
  }
}

function buildWhatsappLink(
  condominiumName: string,
  whatsapp: string,
  unitLabel: string,
  recipient: string,
  porterName: string,
  trackingCode: string,
) {
  const message = buildPackageNotificationMessage({
    condominiumName,
    unitLabel,
    recipientName: recipient,
    porterName,
    trackingCode,
  });
  return whatsappLink(whatsapp, message);
}

/**
 * Grava o recebimento. A foto da etiqueta não é enviada ao Storage: ela só
 * existe na memória durante a leitura. Quando há avaria, uma foto separada do
 * volume inteiro é anexada e removida pela limpeza após 20 dias.
 */
async function persistPackage(
  draft: PackageDraft,
  ctx: {
    userId: string;
    condominiumId: string;
    condominiumName: string;
    unit: Unit;
    company: string;
    deliveryPerson: string;
    porterName: string;
    whatsapp: string;
    allowDuplicate: boolean;
    isDamaged: boolean;
    damageFile: File | null;
  },
): Promise<{ id: string; whatsappLink: string }> {
  const trimmedTrackingCode = draft.trackingCode.trim();
  if (trimmedTrackingCode && !ctx.allowDuplicate) {
    const { data: duplicateRows } = await supabase.rpc("find_duplicate_package", {
      p_condominium_id: ctx.condominiumId,
      p_tracking_code: trimmedTrackingCode,
    });
    const duplicate = (
      Array.isArray(duplicateRows) ? duplicateRows[0] : duplicateRows
    ) as
      | {
          unit_number: string;
          block_name: string | null;
          received_at: string;
        }
      | null;
    if (duplicate?.unit_number) {
      throw new DuplicatePackageError(
        `Já existe uma encomenda com o rastreio ${trimmedTrackingCode}: ${
          duplicate.block_name ? `${duplicate.block_name} · ` : ""
        }${duplicate.unit_number}, recebida em ${formatDate(duplicate.received_at)}. Se for outro volume, registre mesmo assim.`,
      );
    }
  }

  let damagePath: string | null = null;
  if (ctx.isDamaged && ctx.damageFile) {
    const evidence = await compressPackagePhoto(ctx.damageFile, {
      longEdge: 1920,
      quality: 0.85,
    });
    damagePath = `${ctx.condominiumId}/${ctx.unit.block_id ?? "no-block"}/${ctx.userId}/damage-${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(receiptBucket)
      .upload(damagePath, evidence.file, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });
    if (uploadError) {
      throw new Error(
        `Não foi possível enviar a foto da avaria. ${uploadError.message}`,
      );
    }
  }

  const { data: createdPackageId, error: createError } = await supabase.rpc(
    "create_package",
    {
      p_condominium_id: ctx.condominiumId,
      p_unit_id: ctx.unit.id,
      p_receipt_path: damagePath,
      p_sender: ctx.company.trim(),
      p_delivery_person: ctx.deliveryPerson.trim(),
      p_tracking_code: trimmedTrackingCode || null,
      p_resident_name: draft.recipientName.trim(),
      p_recipient_is_resident: draft.recipientIsResident,
      p_is_damaged: ctx.isDamaged,
    },
  );

  if (createError) {
    if (damagePath) {
      await supabase.storage.from(receiptBucket).remove([damagePath]);
    }
    throw new Error(createError.message);
  }

  return {
    id: typeof createdPackageId === "string" ? createdPackageId : "",
    whatsappLink: ctx.whatsapp
      ? buildWhatsappLink(
          ctx.condominiumName,
          ctx.whatsapp,
          `o apartamento ${ctx.unit.unit_number}`,
          draft.recipientName.trim(),
          ctx.porterName,
          trimmedTrackingCode,
        )
      : "",
  };
}

export function PorterReception() {
  const { user, signOut } = useAuth();
  const imageInput = useRef<HTMLInputElement>(null);
  const damageInput = useRef<HTMLInputElement>(null);
  const bulkInput = useRef<HTMLInputElement>(null);
  const signatureCanvas = useRef<HTMLCanvasElement>(null);
  const signatureHasInk = useRef(false);
  const hasInternalHistory = useRef(false);
  const receiveForm = useRef<HTMLFormElement>(null);
  const allowDuplicate = useRef(false);
  // Invalida leituras antigas quando o porteiro cancela ou troca de foto, para
  // que um resultado tardio não reapareça depois de voltar à tela inicial.
  const readRequestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<PorterAccount | null>(null);
  const [condominium, setCondominium] = useState<Condominium | null>(null);
  const [activeView, setActiveView] = useState<PorterView>(
    getPorterViewFromLocation,
  );
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [authorizedResidents, setAuthorizedResidents] = useState<
    AuthorizedResident[]
  >([]);
  const [pendingPackages, setPendingPackages] = useState<PackageRecord[]>([]);
  const [unitSearchQuery, setUnitSearchQuery] = useState("");
  const [searchedUnitId, setSearchedUnitId] = useState("");
  const [unitResidents, setUnitResidents] = useState<UnitResident[]>([]);
  const [unitPackages, setUnitPackages] = useState<PackageRecord[]>([]);
  const [unitTotal, setUnitTotal] = useState(0);
  const [unitPending, setUnitPending] = useState<PackageRecord[]>([]);
  const [unitPage, setUnitPage] = useState(1);
  const [unitSearchPage, setUnitSearchPage] = useState(1);
  const [isLoadingUnitDetails, setIsLoadingUnitDetails] = useState(false);
  const [unitDetailsError, setUnitDetailsError] = useState("");
  const [ledgerRecords, setLedgerRecords] = useState<PackageRecord[]>([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerSort, setLedgerSort] = useState<PackageSort>("recent");
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [pendingPage, setPendingPage] = useState(1);
  const [signatureCache, setSignatureCache] = useState<
    Record<string, string | null>
  >({});
  const [pageError, setPageError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isDamaged, setIsDamaged] = useState(false);
  const [damageFile, setDamageFile] = useState<File | null>(null);
  const [damagePreviewUrl, setDamagePreviewUrl] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [ocrMessage, setOcrMessage] = useState("");
  const [unitCandidates, setUnitCandidates] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState("");
  const [deliveryPerson, setDeliveryPerson] = useState("");
  const [company, setCompany] = useState("");
  const [trackingCode, setTrackingCode] = useState("");
  const [trackingCodeDetected, setTrackingCodeDetected] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientNameDetected, setRecipientNameDetected] = useState(false);
  const [recipientIsResident, setRecipientIsResident] = useState(false);
  const [addressVerification, setAddressVerification] =
    useState<PackageAddressVerification | null>(null);
  const [lastLabelRead, setLastLabelRead] = useState<LabelReadResult | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [notifyingId, setNotifyingId] = useState("");
  const [notificationLink, setNotificationLink] = useState("");
  /** Confirmação do recebimento do entregador feita no ato do cadastro. */
  const [notifyOnReceive, setNotifyOnReceive] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [collectionBaseId, setCollectionBaseId] = useState("");
  /** null = todos os pacotes do grupo; array = desmarques feitos pelo porteiro. */
  const [collectionSelectionOverride, setCollectionSelectionOverride] = useState<
    string[] | null
  >(null);
  const [collectionName, setCollectionName] = useState("");
  const [porterConfirmed, setPorterConfirmed] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [savingCollection, setSavingCollection] = useState(false);
  const [mismatchAcknowledged, setMismatchAcknowledged] = useState(false);
  const [savedDeliveryPersonRevision, setSavedDeliveryPersonRevision] =
    useState(0);
  const [contactsByUnit, setContactsByUnit] = useState<{
    unitId: string;
    contacts: UnitResident[];
  } | null>(null);
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkCompany, setBulkCompany] = useState("");
  const [bulkDeliveryPerson, setBulkDeliveryPerson] = useState("");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const bulkCancelled = useRef(false);
  const unitDetailsRequest = useRef(0);
  const draftReady = useRef(false);
  const buildDraftRef = useRef<() => Promise<ReceptionDraft | null>>(
    () => Promise.resolve(null),
  );
  const restoredSignature = useRef("");
  const [draftRecovered, setDraftRecovered] = useState(false);

  const selectedUnit = useMemo(
    () => units.find((unit) => unit.id === unitId) ?? null,
    [unitId, units],
  );
  const selectedUnitId = selectedUnit?.id ?? "";
  const lastDeliveryPerson = useMemo(() => {
    // A revisão força uma nova leitura do sessionStorage após salvar.
    void savedDeliveryPersonRevision;
    return account ? readSavedDeliveryPerson(account.condominium_id) : "";
  }, [account, savedDeliveryPersonRevision]);
  const selectedUnitContacts = useMemo(
    () =>
      contactsByUnit?.unitId === selectedUnitId ? contactsByUnit.contacts : [],
    [contactsByUnit, selectedUnitId],
  );
  const selectedUnitResidentNames = selectedUnit
    ? authorizedResidents
        .filter((resident) => resident.unit_id === selectedUnit.id)
        .map((resident) => resident.name?.trim() ?? "")
        .filter(Boolean)
    : [];
  const selectedSearchUnit = useMemo(
    () => units.find((unit) => unit.id === searchedUnitId) ?? null,
    [searchedUnitId, units],
  );
  const pendingUnitPackages = unitPending;
  const matchingSearchUnits = useMemo(() => {
    const query = unitSearchQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return [];
    return units.filter((unit) =>
      unit.unit_number.toLocaleLowerCase("pt-BR").includes(query),
    );
  }, [unitSearchQuery, units]);
  const unitSearchResults = useMemo(
    () =>
      matchingSearchUnits.slice(
        (unitSearchPage - 1) * UNIT_SEARCH_PAGE_SIZE,
        unitSearchPage * UNIT_SEARCH_PAGE_SIZE,
      ),
    [matchingSearchUnits, unitSearchPage],
  );
  const safePendingPage = Math.min(
    pendingPage,
    Math.max(1, Math.ceil(pendingPackages.length / RECORD_PAGE_SIZE)),
  );
  const visiblePackages =
    activeView === "pending"
      ? pendingPackages.slice(
          (safePendingPage - 1) * RECORD_PAGE_SIZE,
          safePendingPage * RECORD_PAGE_SIZE,
        )
      : ledgerRecords;
  const bulkCounts = useMemo(
    () => ({
      done: bulkItems.filter((item) => item.status === "done").length,
      review: bulkItems.filter((item) => item.status === "review").length,
      error: bulkItems.filter((item) => item.status === "error").length,
      pending: bulkItems.filter(
        (item) => item.status === "queued" || item.status === "processing",
      ).length,
    }),
    [bulkItems],
  );
  const batchCandidates = useMemo(() => {
    if (!collectionBaseId) return [];
    const base = pendingPackages.find((item) => item.id === collectionBaseId);
    if (!base) return [];
    return pendingPackages.filter(
      (item) =>
        item.unit_number === base.unit_number &&
        (item.block_name ?? "") === (base.block_name ?? ""),
    );
  }, [collectionBaseId, pendingPackages]);
  const collectionCandidateIds = useMemo(
    () => batchCandidates.map((item) => item.id),
    [batchCandidates],
  );
  const selectedCollectionIds =
    collectionSelectionOverride ?? collectionCandidateIds;
  const batchBase = batchCandidates.find((item) => item.id === collectionBaseId);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // O Chrome só dispara este evento quando considera o app instalável. Usar o
  // prompt dele garante um app standalone, e não um atalho com barra de URL.
  useEffect(() => {
    function handleBeforeInstall(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    }
    function handleInstalled() {
      setInstallPrompt(null);
      setSuccessMessage(
        "App instalado. Se o ícone não apareceu na tela inicial, abra a gaveta de apps, procure “PortTag” e toque e segure no ícone para adicionar à tela inicial.",
      );
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  // Não aquecemos o Tesseract ao abrir a tela: carregar o WASM consume memória
  // e já fez o Android descartar o PWA ao voltar da câmera. O worker só é
  // criado se a leitura na nuvem falhar.
  useEffect(() => {
    return () => {
      void releasePackageOcr().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!selectedUnitId) return;

    let active = true;
    supabase
      .from("unit_residents")
      .select("id, name, whatsapp")
      .eq("unit_id", selectedUnitId)
      .order("created_at")
      .then(({ data, error }) => {
        if (!active || error) return;
        setContactsByUnit({
          unitId: selectedUnitId,
          contacts: (data ?? []) as UnitResident[],
        });
      });

    return () => {
      active = false;
    };
  }, [selectedUnitId]);

  useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      const view = getPorterViewFromLocation();
      setActiveView(view);
      if (view === "pending") setPendingPage(1);
      setCollectionBaseId(params.get("collect") ?? "");
      setCollectionSelectionOverride(null);
      setCollectionName("");
      setPorterConfirmed(false);
      setHasSignature(false);
      signatureHasInk.current = false;
      hasInternalHistory.current = view !== "home";
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPorter() {
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: porterData, error: porterError } = await supabase
        .from("porter_accounts")
        .select("id, condominium_id, name, username, access_expires_at")
        .eq("auth_user_id", user.id)
        .eq("active", true)
        .maybeSingle();

      if (!active) return;
      if (porterError) {
        setPageError(`Não foi possível carregar o acesso do porteiro. ${porterError.message}`);
        setLoading(false);
        return;
      }
      if (!porterData) {
        setPageError("Esta conta não tem acesso ativo. Peça ao Super Admin para verificar o cadastro.");
        setLoading(false);
        return;
      }
      if (
        porterData.access_expires_at &&
        new Date(porterData.access_expires_at).getTime() <= Date.now()
      ) {
        setPageError("O prazo de acesso desta conta expirou. Procure o Super Admin.");
        setLoading(false);
        return;
      }

      setAccount(porterData);
      const [condominiumResult, assignmentResult] = await Promise.all([
        supabase
          .from("condominiums")
          .select("id, name, block_count, cep, street, address_number")
          .eq("id", porterData.condominium_id)
          .maybeSingle(),
        supabase
          .from("porter_blocks")
          .select("block_id")
          .eq("porter_account_id", porterData.id),
      ]);

      if (!active) return;
      const setupError = condominiumResult.error ?? assignmentResult.error;
      if (setupError) {
        setPageError(setupError.message);
        setLoading(false);
        return;
      }
      if (!condominiumResult.data) {
        setPageError("Condomínio não encontrado.");
        setLoading(false);
        return;
      }

      const assignedBlockIds = (assignmentResult.data ?? []).map(
        (assignment) => assignment.block_id,
      );
      if (
        condominiumResult.data.block_count > 0 &&
        assignedBlockIds.length === 0
      ) {
        setPageError("Nenhum bloco foi vinculado a esta conta. Avise o Super Admin.");
        setLoading(false);
        return;
      }

      const [blocksResult, unitsResult] = await Promise.all([
        supabase
          .from("blocks")
          .select("id, name")
          .eq("condominium_id", porterData.condominium_id)
          .order("name"),
        supabase
          .from("units")
          .select("id, unit_number, block_id")
          .eq("condominium_id", porterData.condominium_id)
          .eq("status", "active")
          .order("unit_number"),
      ]);

      if (!active) return;
      const loadError = blocksResult.error ?? unitsResult.error;
      if (loadError) {
        setPageError(loadError.message);
        setLoading(false);
        return;
      }
      const allowedUnits =
        condominiumResult.data.block_count > 0
          ? (unitsResult.data ?? []).filter((unit) =>
              assignedBlockIds.includes(unit.block_id ?? ""),
            )
          : unitsResult.data ?? [];
      setCondominium(condominiumResult.data);
      setBlocks(blocksResult.data ?? []);
      setUnits(allowedUnits);

      const [pendingPackagesResult, residentDirectoryResult] =
        await Promise.all([
          supabase
            .from("packages")
            .select(packageFields)
            .eq("condominium_id", porterData.condominium_id)
            .eq("status", "received")
            .order("received_at", { ascending: false }),
          supabase.from("unit_residents").select("unit_id, name, whatsapp"),
        ]);

      if (!active) return;
      if (pendingPackagesResult.error) {
        setPageError(pendingPackagesResult.error.message);
      } else {
        setPendingPackages(pendingPackagesResult.data ?? []);
      }
      if (residentDirectoryResult.error) {
        setPageError(
          `Não foi possível carregar os moradores autorizados. ${residentDirectoryResult.error.message}`,
        );
      } else {
        const allowedUnitIds = new Set(allowedUnits.map((unit) => unit.id));
        setAuthorizedResidents(
          (residentDirectoryResult.data ?? []).filter((resident) =>
            allowedUnitIds.has(resident.unit_id),
          ),
        );
      }

      if (!draftReady.current) {
        const draft = await loadReceptionDraft(porterData.condominium_id);
        if (draft) await restoreDraft(draft);
        else draftReady.current = true;
      }
      setLoading(false);
    }

    void loadPorter().catch((error: unknown) => {
      if (!active) return;
      setPageError(error instanceof Error ? error.message : "Falha inesperada.");
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

  // Salva o rascunho no aparelho para que trocar de app ou perder a conexão
  // não desfaca o que o porteiro já preencheu. A gravação é debounced e
  // silenciosa: se o storage falhar, o fluxo continua normalmente.
  useEffect(() => {
    if (!draftReady.current) return;
    const timer = window.setTimeout(() => {
      void buildDraftRef.current().then((draft) => {
        if (draft) return saveReceptionDraft(draft);
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    account,
    activeView,
    file,
    unitId,
    unitCandidates,
    recipientName,
    recipientNameDetected,
    recipientIsResident,
    company,
    deliveryPerson,
    trackingCode,
    trackingCodeDetected,
    addressVerification,
    lastLabelRead,
    ocrMessage,
    mismatchAcknowledged,
    notifyOnReceive,
    duplicateWarning,
    isDamaged,
    damageFile,
    collectionBaseId,
    collectionSelectionOverride,
    collectionName,
    porterConfirmed,
    hasSignature,
  ]);

  useEffect(() => {
    if (!account || activeView !== "ledger") return;
    let active = true;
    void (async () => {
      setRecordsLoading(true);
      try {
        const result = await fetchPackageRecords({
          condominiumId: account.condominium_id,
          sort: ledgerSort,
          page: ledgerPage,
        });
        if (!active) return;
        setLedgerRecords(result.items as PackageRecord[]);
        setLedgerTotal(result.total);
        if (ledgerPage > 1 && result.items.length === 0) setLedgerPage(1);
      } catch (error) {
        if (!active) return;
        setPageError(
          error instanceof Error
            ? `Não foi possível carregar o caderno. ${error.message}`
            : "Não foi possível carregar o caderno.",
        );
      } finally {
        if (active) setRecordsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [account, activeView, ledgerPage, ledgerSort]);

  async function reloadPackages() {
    if (!account) return;
    const pendingPackagesResult = await supabase
      .from("packages")
      .select(packageFields)
      .eq("condominium_id", account.condominium_id)
      .eq("status", "received")
      .order("received_at", { ascending: false });
    if (pendingPackagesResult.error) {
      setPageError(pendingPackagesResult.error.message);
      return;
    }
    setPendingPackages(pendingPackagesResult.data ?? []);
    if (activeView === "ledger") {
      const result = await fetchPackageRecords({
        condominiumId: account.condominium_id,
        sort: ledgerSort,
        page: ledgerPage,
      });
      setLedgerRecords(result.items as PackageRecord[]);
      setLedgerTotal(result.total);
    }
  }

  function handleUnitSearchChange(value: string) {
    unitDetailsRequest.current += 1;
    setUnitSearchQuery(value);
    setSearchedUnitId("");
    setUnitResidents([]);
    setUnitPackages([]);
    setUnitPending([]);
    setUnitTotal(0);
    setUnitPage(1);
    setUnitSearchPage(1);
    setUnitDetailsError("");
    setIsLoadingUnitDetails(false);
  }

  function navigateToView(view: PorterView, replace = false) {
    if (view === activeView) return;
    const url = new URL(window.location.href);
    if (view === "home") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", view);
    }
    url.searchParams.delete("collect");

    const state = window.history.state;
    const nextState =
      state && typeof state === "object"
        ? { ...state, porterView: view }
        : { porterView: view };
    if (replace) {
      window.history.replaceState(nextState, "", url);
    } else {
      window.history.pushState(nextState, "", url);
      if (view !== "home") hasInternalHistory.current = true;
    }
    setActiveView(view);
    if (view === "pending") setPendingPage(1);
  }

  function returnToHome() {
    if (hasInternalHistory.current) {
      hasInternalHistory.current = false;
      window.history.back();
      return;
    }
    navigateToView("home", true);
  }

  function openCollection(packageRecord: PackageRecord) {
    const candidates = pendingPackages.filter(
      (item) =>
        item.unit_number === packageRecord.unit_number &&
        (item.block_name ?? "") === (packageRecord.block_name ?? ""),
    );
    const ids = candidates.map((item) => item.id);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "pending");
    url.searchParams.set("collect", packageRecord.id);
    window.history.pushState(
      { porterView: "pending", collectionBaseId: packageRecord.id },
      "",
      url,
    );
    setActiveView("pending");
    setPendingPage(1);
    setCollectionBaseId(packageRecord.id);
    setCollectionSelectionOverride(ids);
    setCollectionName(packageRecord.resident_name ?? "");
  }

  function openCamera() {
    setPageError("");
    imageInput.current?.click();
  }

  async function showUnitDetails(unit: Unit) {
    const requestId = ++unitDetailsRequest.current;
    if (!account) return;
    setUnitSearchQuery(unit.unit_number);
    setSearchedUnitId(unit.id);
    setUnitResidents([]);
    setUnitPackages([]);
    setUnitPending([]);
    setUnitTotal(0);
    setUnitPage(1);
    setUnitDetailsError("");
    setIsLoadingUnitDetails(true);

    try {
      const [residentsResult, packagesResult, pendingResult] =
        await Promise.all([
          supabase
            .from("unit_residents")
            .select("id, name, whatsapp")
            .eq("unit_id", unit.id)
            .order("created_at"),
          fetchPackageRecords({
            condominiumId: account.condominium_id,
            unitId: unit.id,
            page: 1,
          }),
          supabase
            .from("packages")
            .select(packageFields)
            .eq("unit_id", unit.id)
            .eq("status", "received")
            .order("received_at", { ascending: false }),
        ]);

      if (requestId !== unitDetailsRequest.current) return;
      const loadError = residentsResult.error ?? pendingResult.error;
      if (loadError) {
        setUnitDetailsError(
          `Não foi possível carregar os dados do apartamento. ${loadError.message}`,
        );
        return;
      }

      setUnitResidents(residentsResult.data ?? []);
      setUnitPackages(packagesResult.items as PackageRecord[]);
      setUnitTotal(packagesResult.total);
      setUnitPending(pendingResult.data ?? []);
    } catch (error) {
      if (requestId !== unitDetailsRequest.current) return;
      setUnitDetailsError(
        error instanceof Error
          ? `Não foi possível carregar os dados do apartamento. ${error.message}`
          : "Não foi possível carregar os dados do apartamento.",
      );
    } finally {
      if (requestId === unitDetailsRequest.current) {
        setIsLoadingUnitDetails(false);
      }
    }
  }

  useEffect(() => {
    if (!account || !searchedUnitId || unitPage < 2) return;
    let active = true;
    void (async () => {
      setIsLoadingUnitDetails(true);
      try {
        const result = await fetchPackageRecords({
          condominiumId: account.condominium_id,
          unitId: searchedUnitId,
          page: unitPage,
        });
        if (!active) return;
        setUnitPackages(result.items as PackageRecord[]);
        setUnitTotal(result.total);
      } catch (error) {
        if (!active) return;
        setUnitDetailsError(
          error instanceof Error ? error.message : "Não foi possível carregar.",
        );
      } finally {
        if (active) setIsLoadingUnitDetails(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [account, searchedUnitId, unitPage]);

  async function loadRecordSignature(packageId: string) {
    if (Object.prototype.hasOwnProperty.call(signatureCache, packageId)) return;
    try {
      const signature = await fetchPackageSignature(packageId);
      setSignatureCache((current) => ({ ...current, [packageId]: signature }));
    } catch (error) {
      setPageError(
        error instanceof Error
          ? `Não foi possível carregar a assinatura. ${error.message}`
          : "Não foi possível carregar a assinatura.",
      );
    }
  }

  function handleUnitSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = unitSearchQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return;

    const exactMatches = units.filter(
      (unit) => unit.unit_number.toLocaleLowerCase("pt-BR") === query,
    );
    const matches = exactMatches.length
      ? exactMatches
      : units.filter((unit) =>
          unit.unit_number.toLocaleLowerCase("pt-BR").includes(query),
        );
    if (matches.length === 1) {
      void showUnitDetails(matches[0]);
    }
  }

  function packageWhatsappLink(
    whatsapp: string,
    unitLabel: string,
    recipient: string,
    trackingCode: string,
  ) {
    return buildWhatsappLink(
      condominium?.name ?? "condomínio",
      whatsapp,
      unitLabel,
      recipient,
      account?.name ?? "",
      trackingCode,
    );
  }

  function resetReceptionFields() {
    setPageError("");
    setSuccessMessage("");
    setOcrMessage("");
    setUnitCandidates([]);
    setUnitId("");
    setCompany("");
    setTrackingCode("");
    setTrackingCodeDetected(false);
    setRecipientName("");
    setRecipientNameDetected(false);
    setRecipientIsResident(false);
    setAddressVerification(null);
    setLastLabelRead(null);
    setMismatchAcknowledged(false);
    setDuplicateWarning("");
    setNotificationMessage("");
    setNotificationLink("");
    setNotifyOnReceive(false);
    allowDuplicate.current = false;
  }

  function applyDraftToForm(draft: PackageDraft, preview: string) {
    setFile(draft.file);
    setPreviewUrl(preview);
    setUnitCandidates(draft.unitCandidates);
    setUnitId(draft.unitId);
    setDeliveryPerson(draft.deliveryPerson || lastDeliveryPerson);
    setCompany(draft.company);
    setTrackingCode(draft.trackingCode);
    setTrackingCodeDetected(Boolean(draft.trackingCode));
    setRecipientName(draft.recipientName);
    setRecipientNameDetected(Boolean(draft.recipientName));
    setRecipientIsResident(draft.recipientIsResident);
    setAddressVerification(draft.addressVerification);
    setLastLabelRead(draft.labelRead);
    setOcrMessage(draft.ocrMessage);
    setMismatchAcknowledged(false);
    setDuplicateWarning("");
  }

  async function buildCurrentDraft(): Promise<ReceptionDraft | null> {
    if (!account) return null;
    const params = new URLSearchParams(window.location.search);
    const rawView = params.get("view");
    const view: DraftView =
      rawView === "ledger" || rawView === "pending" || rawView === "home"
        ? rawView
        : activeView;
    return {
      savedAt: Date.now(),
      condominiumId: account.condominium_id,
      activeView: view,
      labelPhoto: file ? await fileToDataUrl(file) : "",
      unitId,
      unitCandidates: unitCandidates as DraftUnit[],
      recipientName,
      recipientNameDetected,
      recipientIsResident,
      company,
      deliveryPerson,
      trackingCode,
      trackingCodeDetected,
      addressVerification,
      lastLabelRead,
      ocrMessage,
      mismatchAcknowledged,
      notifyOnReceive,
      duplicateWarning,
      isDamaged,
      damagePhoto: damageFile ? await fileToDataUrl(damageFile) : "",
      collectionBaseId,
      collectionSelectionOverride,
      collectionName,
      porterConfirmed,
      hasSignature,
      signature:
        hasSignature && signatureCanvas.current
          ? signatureDataUrl(signatureCanvas.current)
          : "",
    };
  }
  useEffect(() => {
    buildDraftRef.current = buildCurrentDraft;
  });

  async function restoreDraft(draft: ReceptionDraft) {
    const params = new URLSearchParams(window.location.search);
    const rawView = params.get("view");
    setActiveView(
      rawView === "ledger" || rawView === "pending" || rawView === "home"
        ? rawView
        : draft.activeView,
    );
    setUnitCandidates(
      (draft.unitCandidates ?? []) as unknown as Unit[],
    );
    setUnitId(draft.unitId);
    setRecipientName(draft.recipientName);
    setRecipientNameDetected(draft.recipientNameDetected);
    setRecipientIsResident(draft.recipientIsResident);
    setCompany(draft.company);
    setDeliveryPerson(draft.deliveryPerson);
    setTrackingCode(draft.trackingCode);
    setTrackingCodeDetected(draft.trackingCodeDetected);
    setAddressVerification(draft.addressVerification);
    setLastLabelRead(draft.lastLabelRead);
    setOcrMessage(draft.ocrMessage);
    setMismatchAcknowledged(draft.mismatchAcknowledged);
    setNotifyOnReceive(draft.notifyOnReceive);
    setDuplicateWarning(draft.duplicateWarning);
    setIsDamaged(draft.isDamaged);
    setCollectionBaseId(params.get("collect") ?? draft.collectionBaseId);
    setCollectionSelectionOverride(draft.collectionSelectionOverride ?? null);
    setCollectionName(draft.collectionName);
    setPorterConfirmed(draft.porterConfirmed);
    setHasSignature(draft.hasSignature);
    restoredSignature.current = draft.signature ?? "";

    if (draft.labelPhoto) {
      try {
        setFile(await dataUrlToFile(draft.labelPhoto, "etiqueta.jpg"));
        setPreviewUrl(draft.labelPhoto);
      } catch {
        // Sem foto não há prévia, mas os campos preenchidos são preservados.
      }
    }
    if (draft.damagePhoto) {
      try {
        setDamageFile(await dataUrlToFile(draft.damagePhoto, "avaria.jpg"));
        setDamagePreviewUrl(draft.damagePhoto);
      } catch {
        // A foto da avaria pode ser refeita sem perder o restante.
      }
    }
    setDraftRecovered(true);
    draftReady.current = true;
  }

  function rememberDeliveryPerson(value: string) {
    if (!account || !value) return;
    setSavedDeliveryPersonRevision((current) => current + 1);
    try {
      window.sessionStorage.setItem(
        deliveryPersonStorageKey(account.condominium_id),
        value,
      );
    } catch {
      // Sessão sem storage: só não memoriza o entregador.
    }
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0] ?? null;
    event.target.value = "";
    void processPhoto(image);
  }

  /**
   * Grava a foto no rascunho antes de iniciar a leitura. Se o Android matar o
   * PWA durante o OCR, o porteiro reabre o app e a etiqueta continua ali.
   */
  async function saveEarlyPhotoDraft(photo: File) {
    if (!account) return;
    const draft = await buildCurrentDraft();
    if (!draft) return;
    draft.labelPhoto = await fileToDataUrl(photo);
    draft.unitId = "";
    draft.unitCandidates = [];
    draft.recipientName = "";
    draft.recipientNameDetected = false;
    draft.recipientIsResident = false;
    draft.company = "";
    draft.trackingCode = "";
    draft.trackingCodeDetected = false;
    draft.addressVerification = null;
    draft.lastLabelRead = null;
    draft.ocrMessage = "Foto guardada neste aparelho. Lendo a etiqueta...";
    draft.mismatchAcknowledged = false;
    draft.duplicateWarning = "";
    draft.notifyOnReceive = false;
    draft.isDamaged = false;
    draft.damagePhoto = "";
    await saveReceptionDraft(draft);
  }

  async function processPhoto(image: File | null) {
    resetReceptionFields();
    setFile(null);
    clearPreviewUrl();
    setDeliveryPerson(lastDeliveryPerson);

    if (!image) return;
    if (!acceptedImageTypes.has(image.type)) {
      setPageError("A foto precisa ser JPG, PNG ou WEBP.");
      return;
    }
    if (image.size > maximumImageSize) {
      setPageError("A foto precisa ter no máximo 10 MB.");
      return;
    }
    if (!account || !condominium) return;

    const requestId = ++readRequestId.current;
    setIsReading(true);
    setOcrMessage("Preparando a foto para leitura...");

    let compressed: Awaited<ReturnType<typeof compressPackagePhoto>>;
    try {
      compressed = await compressPackagePhoto(image);
    } catch (error) {
      if (requestId === readRequestId.current) {
        setIsReading(false);
        setPageError(
          friendlyError(
            error,
            "Não foi possível preparar a foto. Tente novamente.",
          ),
        );
      }
      return;
    }
    if (requestId !== readRequestId.current) return;

    void saveEarlyPhotoDraft(compressed.file).catch(() => {});

    try {
      const draft = await readLabelFromPhoto(
        image,
        {
          condominium,
          units,
          blocks,
          residents: authorizedResidents,
          onProgress: (message) => {
            if (requestId === readRequestId.current) setOcrMessage(message);
          },
        },
        { compressed },
      );
      if (requestId !== readRequestId.current) return;
      applyDraftToForm(draft, URL.createObjectURL(draft.file));
      if (isDeviceResourceError(draft.labelRead?.error)) {
        setPageError(DEVICE_RESOURCE_MESSAGE);
      }
    } catch (error) {
      if (requestId !== readRequestId.current) return;
      const message = friendlyError(
        error,
        "Não foi possível processar a foto. Tente novamente.",
      );
      setPageError(message);
      setAddressVerification({
        status: "unknown",
        message: defaultAddressMessage("unknown"),
      });
      setOcrMessage(message);
    } finally {
      if (requestId === readRequestId.current) setIsReading(false);
    }
  }

  async function handleReceive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !account || !condominium || !file || !selectedUnit) return;
    if (!recipientName.trim()) {
      setPageError("Confira ou informe o nome do destinatário da etiqueta.");
      return;
    }
    if (addressVerification?.status === "mismatch" && !mismatchAcknowledged) {
      setPageError(
        "A etiqueta indica outro endereço. Confira fisicamente a etiqueta e marque a confirmação antes de registrar.",
      );
      return;
    }
    if (isDamaged && !damageFile) {
      setPageError("Tire a foto do volume avariado antes de confirmar.");
      return;
    }

    setPageError("");
    setSuccessMessage("");
    setNotificationMessage("");
    setNotificationLink("");
    setDuplicateWarning("");

    const draft: PackageDraft = {
      source: file,
      file,
      unitId: selectedUnit.id,
      unitCandidates,
      recipientName,
      recipientIsResident,
      company,
      deliveryPerson,
      trackingCode,
      addressVerification:
        addressVerification ??
        {
          status: "unknown" as const,
          message: defaultAddressMessage("unknown"),
        },
      labelRead: lastLabelRead,
      ocrMessage,
    };

    setIsSaving(true);
    // O checkbox pode ser desligado pelo reset abaixo; guardamos a decisão
    // feita no momento em que o porteiro confirmou o recebimento do entregador.
    const shouldNotify = notifyOnReceive;
    try {
      const savedWhatsapp =
        selectedUnitContacts.find((resident) => resident.whatsapp)?.whatsapp ??
        "";
      const result = await persistPackage(draft, {
        userId: user.id,
        condominiumId: account.condominium_id,
        condominiumName: condominium.name,
        unit: selectedUnit,
        company,
        deliveryPerson,
        porterName: account.name,
        whatsapp: savedWhatsapp,
        allowDuplicate: allowDuplicate.current,
        isDamaged,
        damageFile,
      });

      rememberDeliveryPerson(deliveryPerson.trim());
      if (account) void clearReceptionDraft(account.condominium_id);
      setDraftRecovered(false);
      setSuccessMessage(
        `Encomenda registrada para o apartamento ${selectedUnit.unit_number}.`,
      );

      const trimmedDeliveryPerson = deliveryPerson.trim();
      resetReceptionFields();
      clearPreviewUrl();
      setFile(null);
      setDeliveryPerson(trimmedDeliveryPerson || lastDeliveryPerson);
      // notifyPackage já recarrega a lista; evitar um segundo fetch seguido.
      if (shouldNotify && result.id) await notifyPackage(result.id);
      else await reloadPackages();
    } catch (error) {
      if (error instanceof DuplicatePackageError) {
        setDuplicateWarning(error.message);
      } else {
        setPageError(
          error instanceof Error
            ? `Não foi possível registrar a encomenda. ${error.message}`
            : "Não foi possível registrar a encomenda.",
        );
      }
    } finally {
      setIsSaving(false);
    }
  }

  function updateBulkItem(id: string, patch: Partial<BulkItem>) {
    setBulkItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function reviewReasonsFor(item: BulkItem, draft: PackageDraft) {
    return bulkReviewReasons({
      unitId: draft.unitId,
      unitExists: units.some((unit) => unit.id === draft.unitId),
      deliveryPerson: draft.deliveryPerson,
      addressStatus: draft.addressVerification.status,
      acknowledged: item.acknowledged,
      duplicateMessage: isDuplicateBulkMessage(item.message),
      allowDuplicate: item.allowDuplicate,
    });
  }

  function handleBulkFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const accepted = files.filter(
      (file) =>
        acceptedImageTypes.has(file.type) && file.size <= maximumImageSize,
    );
    if (!accepted.length) {
      setPageError("Nenhuma foto foi aceita. Use JPG, PNG ou WEBP de até 10 MB.");
      return;
    }
    setPageError("");
    setSuccessMessage("");
    if (accepted.length !== files.length) {
      setPageError(
        `${files.length - accepted.length} foto(s) ignorada(s): use JPG, PNG ou WEBP de até 10 MB.`,
      );
    }

    const newItems: BulkItem[] = accepted.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      source: file,
      status: "queued",
      draft: null,
      message: "Na fila",
      acknowledged: false,
      allowDuplicate: false,
      createdPackageId: "",
      whatsappLink: "",
    }));
    setBulkItems((current) => [...current, ...newItems]);
    setBulkDeliveryPerson((current) => current || lastDeliveryPerson);
  }

  function clearBulkQueue() {
    if (bulkRunning) return;
    setBulkItems([]);
    setBulkCompany("");
    setBulkDeliveryPerson(lastDeliveryPerson);
    setSuccessMessage("");
  }

  function updateBulkDraft(id: string, patch: Partial<PackageDraft>) {
    setBulkItems((current) =>
      current.map((item) =>
        item.id === id && item.draft
          ? { ...item, draft: { ...item.draft, ...patch } }
          : item,
      ),
    );
  }

  async function saveBulkItem(item: BulkItem, draft: PackageDraft) {
    if (!user || !account || !condominium) return;

    const reasons = reviewReasonsFor(item, draft);
    if (reasons.length) {
      // Rastreio repetido mostra os dados do volume anterior; não perdemos essa
      // mensagem ao devolver o item para revisão.
      const duplicatePending =
        isDuplicateBulkMessage(item.message) && !item.allowDuplicate;
      const otherReasons = reasons.filter(
        (reason) => reason !== "rastreio repetido",
      );
      const message = duplicatePending
        ? otherReasons.length
          ? `${item.message} Falta também: ${otherReasons.join(", ")}.`
          : item.message
        : `Confira antes de salvar: ${reasons.join(", ")}.`;
      updateBulkItem(item.id, {
        status: "review",
        draft,
        message,
      });
      return;
    }

    const unit = units.find((candidate) => candidate.id === draft.unitId);
    if (!unit) return; // reviewReasonsFor já exige uma unidade válida.

    updateBulkItem(item.id, {
      status: "processing",
      message: "Salvando no caderno...",
    });
    try {
      const whatsapp =
        authorizedResidents.find(
          (resident) => resident.unit_id === unit.id && resident.whatsapp,
        )?.whatsapp ?? "";
      const result = await persistPackage(draft, {
        userId: user.id,
        condominiumId: account.condominium_id,
        condominiumName: condominium.name,
        unit,
        company: draft.company,
        deliveryPerson: draft.deliveryPerson,
        porterName: account.name,
        whatsapp,
        allowDuplicate: item.allowDuplicate,
        isDamaged: false,
        damageFile: null,
      });
      updateBulkItem(item.id, {
        status: "done",
        draft,
        message: "Encomenda registrada.",
        createdPackageId: result.id,
        whatsappLink: result.whatsappLink,
      });
      rememberDeliveryPerson(draft.deliveryPerson.trim());
    } catch (error) {
      if (error instanceof DuplicatePackageError) {
        updateBulkItem(item.id, {
          status: "review",
          draft,
          allowDuplicate: false,
          message: error.message,
        });
        return;
      }
      updateBulkItem(item.id, {
        status: "error",
        draft,
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar esta foto.",
      });
    }
  }

  async function processBulkItem(item: BulkItem) {
    if (!account || !condominium) return;
    updateBulkItem(item.id, {
      status: "processing",
      message: "Lendo a etiqueta...",
    });

    let draft: PackageDraft;
    try {
      draft = await readLabelFromPhoto(item.source, {
        condominium,
        units,
        blocks,
        residents: authorizedResidents,
        onProgress: (message) => updateBulkItem(item.id, { message }),
      });
    } catch (error) {
      updateBulkItem(item.id, {
        status: "error",
        draft: null,
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível ler esta foto.",
      });
      return;
    }

    if (isDeviceResourceError(draft.labelRead?.error)) {
      updateBulkItem(item.id, {
        status: "error",
        draft,
        message: DEVICE_RESOURCE_MESSAGE,
      });
      return;
    }

    // Empresa e entregador podem ser definidos uma vez para a fila inteira.
    // A leitura preenche o que faltar. Empresa não é obrigatória: a etiqueta
    // nem sempre traz a transportadora e isso não pode travar a fila.
    const effective: PackageDraft = {
      ...draft,
      company: bulkCompany.trim() || draft.company.trim(),
      deliveryPerson: bulkDeliveryPerson.trim() || lastDeliveryPerson.trim(),
    };
    const reasons = reviewReasonsFor(item, effective);
    if (reasons.length) {
      updateBulkItem(item.id, {
        status: "review",
        draft: effective,
        message: `Confira antes de salvar: ${reasons.join(", ")}.`,
      });
      return;
    }

    await saveBulkItem(item, effective);
  }

  async function startBulkImport() {
    if (!account || !condominium || bulkRunning) return;
    const queue = bulkItems.filter((item) => item.status === "queued");
    if (!queue.length) return;

    setPageError("");
    setSuccessMessage("");
    bulkCancelled.current = false;
    setBulkRunning(true);
    try {
      for (const item of queue) {
        if (bulkCancelled.current) break;
        await processBulkItem(item);
      }
    } finally {
      setBulkRunning(false);
    }
    if (bulkCancelled.current) {
      setSuccessMessage(
        "Importação interrompida. As fotos já processadas foram salvas.",
      );
    } else {
      setSuccessMessage(
        `${queue.length} foto(s) processada(s). Confira o resultado na fila.`,
      );
    }
    await reloadPackages();
  }

  async function retryBulkItem(item: BulkItem) {
    if (bulkRunning) return;
    bulkCancelled.current = false;
    setBulkRunning(true);
    try {
      // Falha de gravação já tem a etiqueta lida; só falha de leitura precisa
      // abrir a foto original de novo.
      if (item.draft) await saveBulkItem(item, item.draft);
      else await processBulkItem(item);
    } finally {
      setBulkRunning(false);
    }
    await reloadPackages();
  }

  async function notifyPackage(packageId: string) {
    setPageError("");
    setNotificationMessage("");
    setNotificationLink("");
    setNotifyingId(packageId);
    try {
      const { data, error } = await supabase.rpc(
        "register_package_notification",
        { p_package_id: packageId },
      );
      if (error) {
        setPageError(error.message);
        return;
      }
      const notification = (
        Array.isArray(data) ? data[0] : data
      ) as PackageNotification | null;
      if (!notification?.recipient || !notification?.message) {
        setPageError("Não foi possível preparar o aviso ao morador.");
        return;
      }

      await reloadPackages();
      const link = whatsappLink(notification.recipient, notification.message);
      setNotificationMessage("Aviso registrado. Abrindo o WhatsApp...");
      setNotificationLink(link);
      window.open(link, "_blank", "noopener,noreferrer");
    } catch (error) {
      setPageError(
        error instanceof Error
          ? `Não foi possível avisar o morador. ${error.message}`
          : "Não foi possível avisar o morador.",
      );
    } finally {
      setNotifyingId("");
    }
  }

  async function handleCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const packageIds = selectedCollectionIds.filter((id) =>
      collectionCandidateIds.includes(id),
    );
    if (!collectionBaseId || !packageIds.length || !collectionName.trim()) return;
    if (packageIds.length > 50) {
      setPageError("Selecione no máximo 50 encomendas por retirada.");
      return;
    }
    const canvas = signatureCanvas.current;
    if (!canvas || !signatureHasInk.current || !porterConfirmed) {
      setPageError("Peça a assinatura do morador e confirme que você presenciou a retirada.");
      return;
    }

    setPageError("");
    setSavingCollection(true);
    try {
      const { data, error } = await supabase.rpc(
        "confirm_package_collection_batch",
        {
          p_package_ids: packageIds,
          p_collected_by_name: collectionName.trim(),
          p_resident_signature: signatureDataUrl(canvas),
          p_porter_confirmed: porterConfirmed,
        },
      );
      if (error) {
        setPageError(error.message);
        return;
      }
      // O banco grava a mesma assinatura e o mesmo horário em todos os IDs.
      const count =
        typeof data === "number" ? data : packageIds.length;
      cancelCollection();
      await reloadPackages();
      setSuccessMessage(`Retirada registrada em ${count} encomenda(s).`);
    } catch (error) {
      setPageError(
        error instanceof Error
          ? `Não foi possível registrar a retirada. ${error.message}`
          : "Não foi possível registrar a retirada.",
      );
    } finally {
      setSavingCollection(false);
    }
  }

  useEffect(() => {
    if (!collectionBaseId) return;
    const canvas = signatureCanvas.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) {
      setPageError("Não foi possível abrir o espaço para assinatura neste dispositivo.");
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#172033";

    const restored = restoredSignature.current;
    restoredSignature.current = "";
    if (restored) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        signatureHasInk.current = true;
        setHasSignature(true);
      };
      image.src = restored;
      return;
    }

    signatureHasInk.current = false;
    setHasSignature(false);
    setPorterConfirmed(false);
  }, [collectionBaseId]);

  function drawSignature(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvas.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * canvas.width;
    const y = ((event.clientY - bounds.top) / bounds.height) * canvas.height;

    if (event.type === "pointerdown") {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      context.beginPath();
      context.moveTo(x, y);
      signatureHasInk.current = true;
      setHasSignature(true);
      return;
    }

    if (event.type === "pointermove" && event.buttons === 1) {
      context.lineTo(x, y);
      context.stroke();
    }
  }

  function clearSignature() {
    const canvas = signatureCanvas.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    signatureHasInk.current = false;
    setHasSignature(false);
    setPorterConfirmed(false);
  }

  function cancelCollection() {
    if (account) void clearReceptionDraft(account.condominium_id);
    setDraftRecovered(false);
    restoredSignature.current = "";
    const url = new URL(window.location.href);
    if (url.searchParams.get("collect") === collectionBaseId) {
      window.history.back();
    }
    setCollectionBaseId("");
    setCollectionSelectionOverride(null);
    setCollectionName("");
    setPorterConfirmed(false);
    setHasSignature(false);
    signatureHasInk.current = false;
  }

  function toggleCollectionId(id: string) {
    setCollectionSelectionOverride((current) => {
      const selected = current ?? collectionCandidateIds;
      return selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id];
    });
  }

  async function copyDiagnostics() {
    if (!lastLabelRead) return;
    try {
      await navigator.clipboard.writeText(
        buildLabelDiagnostics(lastLabelRead, {
          cep: condominium?.cep ?? "",
          status: addressVerification?.status ?? "unknown",
        }),
      );
      setOcrMessage("Diagnóstico copiado. Envie o texto para o suporte.");
    } catch {
      setPageError(
        "Não foi possível copiar o diagnóstico. Tire um print desta tela.",
      );
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Não foi possível sair.");
    }
  }

  async function handleInstallApp() {
    if (!installPrompt) return;
    const prompt = installPrompt;
    setInstallPrompt(null);
    try {
      await prompt.prompt();
      void prompt.userChoice.catch(() => undefined);
    } catch {
      setPageError(
        "Não foi possível abrir a instalação. Use o menu do Chrome → Instalar app.",
      );
    }
  }

  function clearDamagePhoto() {
    if (damagePreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(damagePreviewUrl);
    }
    setDamagePreviewUrl("");
    setDamageFile(null);
  }

  function handleDamagePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0];
    event.target.value = "";
    if (!image) return;
    if (!acceptedImageTypes.has(image.type)) {
      setPageError("Use uma foto JPG, PNG ou WebP.");
      return;
    }
    if (image.size > maximumImageSize) {
      setPageError("A foto precisa ter no máximo 10 MB.");
      return;
    }
    clearDamagePhoto();
    setDamageFile(image);
    setDamagePreviewUrl(URL.createObjectURL(image));
    setPageError("");
  }

  function clearPreviewUrl() {
    // As prévias são blob URLs; revogar evita acumular memória no celular ao
    // cancelar, trocar de foto ou registrar a encomenda.
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    clearDamagePhoto();
  }

  function resetPhoto() {
    clearPreviewUrl();
    setFile(null);
    setIsDamaged(false);
    setUnitCandidates([]);
    setUnitId("");
    setCompany("");
    setDeliveryPerson("");
    setTrackingCode("");
    setTrackingCodeDetected(false);
    setRecipientName("");
    setRecipientNameDetected(false);
    setRecipientIsResident(false);
    setAddressVerification(null);
    setMismatchAcknowledged(false);
    setOcrMessage("");
    setDuplicateWarning("");
    setNotificationMessage("");
    setNotificationLink("");
    setNotifyOnReceive(false);
    setLastLabelRead(null);
    setPageError("");
    setSuccessMessage("");
    allowDuplicate.current = false;
  }

  /** Volta ao início sem registrar nada, mesmo se a leitura ainda estiver rodando. */
  function cancelReception() {
    readRequestId.current += 1;
    if (account) void clearReceptionDraft(account.condominium_id);
    setDraftRecovered(false);
    resetPhoto();
    setIsReading(false);
    setIsSaving(false);
    navigateToView("home", true);
  }

  if (loading) {
    return <div className="loading-screen">Carregando acesso do porteiro...</div>;
  }

  if (!account || !condominium) {
    return (
      <main className="porter-shell">
        <section className="porter-card">
          <h1>Acesso indisponível</h1>
          <p role="alert">{pageError || "Solicite ajuda ao Super Admin."}</p>
          <button className="porter-secondary-button" onClick={() => void handleSignOut()}>
            Sair
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="porter-shell">
      <header className="porter-header">
        <div>
          <span>{condominium.name}</span>
          <h1>Olá, {account.name}</h1>
        </div>
        <div className="porter-header-actions">
          {installPrompt && (
            <button
              className="porter-install-button"
              type="button"
              onClick={() => void handleInstallApp()}
            >
              <Download size={18} aria-hidden="true" />
              <span>Instalar app</span>
            </button>
          )}
          <button
            className="porter-logout"
            aria-label="Sair"
            onClick={() => void handleSignOut()}
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <div className="porter-content">
        {pageError && <p className="porter-error" role="alert">{pageError}</p>}
        {successMessage && (
          <p className="porter-success" role="status">
            <Check size={18} />
            {successMessage}
          </p>
        )}
        {draftRecovered && (
          <p className="porter-success" role="status">
            <Check size={18} />
            Rascunho recuperado deste aparelho. Continue de onde parou.
            <button
              type="button"
              className="porter-text-button"
              onClick={() => {
                if (account) void clearReceptionDraft(account.condominium_id);
                setDraftRecovered(false);
                resetPhoto();
              }}
            >
              Descartar
            </button>
          </p>
        )}

        {notificationMessage && (
          <p className="porter-success" role="status">
            <Check size={18} />
            {notificationMessage}
            {notificationLink && (
              <a
                className="porter-whatsapp-link"
                href={notificationLink}
                target="_blank"
                rel="noreferrer"
              >
                Abrir conversa no WhatsApp (sem custo)
              </a>
            )}
          </p>
        )}

        {activeView === "home" && (
          <>
            <section className="porter-card porter-receive-card">
              {!file && (
                <div className="porter-home-hero-heading">
                  <strong>PORTARIA</strong>
                  <PackageCheck size={34} aria-hidden="true" />
                  <h2>Registrar encomenda</h2>
                  <p>Fotografe a etiqueta para começar</p>
                </div>
              )}
              <input
                ref={imageInput}
                className="porter-hidden-input"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => void handlePhotoChange(event)}
              />
              {!file ? (
                <>
                  <button
                    className="porter-camera-button"
                    type="button"
                    onClick={openCamera}
                    disabled={!units.length}
                  >
                    <Camera size={22} aria-hidden="true" />
                    <span>Tirar foto</span>
                  </button>
                  {!units.length && (
                    <p className="porter-error">
                      Não há apartamentos ativos vinculados ao seu bloco.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="porter-photo-preview">
                    <img src={previewUrl} alt="Foto da etiqueta da encomenda" />
                    <div className="porter-photo-actions">
                      <button
                        type="button"
                        className="porter-secondary-button"
                        onClick={resetPhoto}
                        disabled={isReading || isSaving}
                      >
                        Tirar outra foto
                      </button>
                      <button
                        type="button"
                        className="porter-cancel-button"
                        onClick={cancelReception}
                        disabled={isSaving}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                  <p className="porter-ocr-status" role="status">
                    {isReading
                      ? ocrMessage || "Analisando a foto..."
                      : ocrMessage}
                  </p>
                  {lastLabelRead && !isReading && (
                    <details className="porter-diagnostics">
                      <summary>Diagnóstico da leitura</summary>
                      <p>
                        {lastLabelRead.attempts
                          .map(
                            (attempt) =>
                              `${attempt.pass}: ${attempt.characters} caract. em ${attempt.durationMs} ms`,
                          )
                          .join(" · ")}
                      </p>
                      <pre className="porter-diagnostics-text">
                        {lastLabelRead.text}
                      </pre>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => void copyDiagnostics()}
                      >
                        Copiar diagnóstico
                      </button>
                    </details>
                  )}
                  {addressVerification && !isReading && (
                    <div
                      className={`porter-address-check porter-address-check-${addressVerification.status}`}
                      role={
                        addressVerification.status === "verified"
                          ? "status"
                          : "alert"
                      }
                    >
                      <p>{addressVerification.message}</p>
                      {addressVerification.status === "unknown" && (
                        <p className="porter-address-check-detail">
                          Não foi possível confirmar o endereço automaticamente;
                          confira na etiqueta antes de salvar.
                        </p>
                      )}
                      {addressVerification.status === "mismatch" && (
                        <label className="porter-mismatch-check">
                          <input
                            type="checkbox"
                            checked={mismatchAcknowledged}
                            onChange={(event) =>
                              setMismatchAcknowledged(event.target.checked)
                            }
                          />
                          Confirmo que conferi a etiqueta fisicamente e a entrega
                          pertence a este condomínio.
                        </label>
                      )}
                    </div>
                  )}

                  {!isReading && (
                    <form
                      ref={receiveForm}
                      className="porter-form"
                      onSubmit={handleReceive}
                    >
                      <label>
                        Apartamento
                        <select
                          required
                          value={unitId}
                          onChange={(event) => setUnitId(event.target.value)}
                        >
                          <option value="">Selecione o apartamento</option>
                          {unitCandidates.length > 0 && (
                            <optgroup label="Sugestões da etiqueta">
                              {unitCandidates.map((unit) => (
                                <option key={`suggested-${unit.id}`} value={unit.id}>
                                  {blocks.find((block) => block.id === unit.block_id)?.name
                                    ? `${blocks.find((block) => block.id === unit.block_id)?.name} · `
                                    : ""}
                                  {unit.unit_number}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="Todos os apartamentos do seu bloco">
                            {units.map((unit) => (
                              <option key={unit.id} value={unit.id}>
                                {blocks.find((block) => block.id === unit.block_id)?.name
                                  ? `${blocks.find((block) => block.id === unit.block_id)?.name} · `
                                  : ""}
                                {unit.unit_number}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        {unitCandidates.length === 1 && (
                          <small>Apartamento reconhecido. Confira antes de salvar.</small>
                        )}
                        {selectedUnit && (
                          <small className="porter-resident-hint">
                            {selectedUnitResidentNames.length
                              ? `Moradores cadastrados para conferência: ${selectedUnitResidentNames.join(", ")}`
                              : "Não há moradores cadastrados nesta unidade; confira o nome impresso na etiqueta."}
                          </small>
                        )}
                      </label>
                      {selectedUnit &&
                        selectedUnitContacts.some(
                          (resident) => resident.whatsapp,
                        ) && (
                          <div className="porter-whatsapp-actions">
                            {selectedUnitContacts
                              .filter((resident) => resident.whatsapp)
                              .map((resident) => (
                                <a
                                  key={resident.id}
                                  className="porter-whatsapp-link"
                                  href={packageWhatsappLink(
                                    resident.whatsapp as string,
                                    `o apartamento ${selectedUnit.unit_number}`,
                                    resident.name ?? "",
                                    trackingCode,
                                  )}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Avisar {resident.name || "morador"} no WhatsApp
                                </a>
                              ))}
                          </div>
                        )}

                      <label>
                        Nome do destinatário
                        <input
                          required
                          autoComplete="name"
                          maxLength={120}
                          value={recipientName}
                          onChange={(event) => {
                            setRecipientName(event.target.value);
                            setRecipientIsResident(false);
                          }}
                        />
                        {recipientNameDetected && (
                          <small>Nome lido da etiqueta; confira antes de salvar.</small>
                        )}
                        {!recipientNameDetected && (
                          <small>
                            Não foi possível ler o nome automaticamente; confira a etiqueta e informe o destinatário.
                          </small>
                        )}
                      </label>

                      <label className="porter-resident-confirmation">
                        <input
                          type="checkbox"
                          checked={recipientIsResident}
                          onChange={(event) =>
                            setRecipientIsResident(event.target.checked)
                          }
                        />
                        Confirmo que o destinatário é morador deste apartamento.
                      </label>

                      <label>
                        Nome do entregador
                        <input
                          required
                          autoComplete="off"
                          maxLength={120}
                          value={deliveryPerson}
                          onChange={(event) => setDeliveryPerson(event.target.value)}
                        />
                        {lastDeliveryPerson &&
                          deliveryPerson !== lastDeliveryPerson && (
                            <button
                              className="text-button"
                              type="button"
                              onClick={() => setDeliveryPerson(lastDeliveryPerson)}
                            >
                              Usar último entregador ({lastDeliveryPerson})
                            </button>
                          )}
                      </label>

                      <label className="porter-resident-confirmation">
                        <input
                          type="checkbox"
                          checked={notifyOnReceive}
                          onChange={(event) =>
                            setNotifyOnReceive(event.target.checked)
                          }
                        />
                        Confirmo que recebi a encomenda do entregador e quero avisar o morador no WhatsApp.
                      </label>

                      <label>
                        Empresa (opcional)
                        <input
                          autoComplete="organization"
                          maxLength={120}
                          value={company}
                          onChange={(event) => setCompany(event.target.value)}
                        />
                      </label>

                      <label>
                        Código de rastreio (opcional)
                        <input
                          autoComplete="off"
                          maxLength={80}
                          value={trackingCode}
                          onChange={(event) => setTrackingCode(event.target.value)}
                        />
                        {trackingCodeDetected && (
                          <small>Detectado automaticamente; corrija se necessário.</small>
                        )}
                      </label>

                      {duplicateWarning && (
                        <div className="porter-duplicate-warning" role="alert">
                          <p>{duplicateWarning}</p>
                          <button
                            className="porter-secondary-button"
                            type="button"
                            onClick={() => {
                              allowDuplicate.current = true;
                              receiveForm.current?.requestSubmit();
                            }}
                          >
                            Registrar mesmo assim
                          </button>
                        </div>
                      )}

                      <div className="porter-damage-field">
                        <label className="porter-damage-toggle">
                          <input
                            type="checkbox"
                            checked={isDamaged}
                            disabled={isSaving}
                            onChange={(event) => {
                              setIsDamaged(event.target.checked);
                              if (!event.target.checked) clearDamagePhoto();
                            }}
                          />
                          <AlertTriangle size={18} aria-hidden="true" />
                          <span>Pacote chegou avariado</span>
                        </label>
                        <p className="field-hint">
                          A foto da etiqueta não é salva. Se houver avaria, tire
                          uma foto do volume inteiro — ela fica guardada por 20
                          dias e depois é excluída.
                        </p>
                        {isDamaged && (
                          <div className="porter-damage-photo">
                            <input
                              ref={damageInput}
                              className="porter-hidden-input"
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={handleDamagePhotoChange}
                            />
                            {!damageFile ? (
                              <button
                                className="porter-secondary-button"
                                type="button"
                                onClick={() => damageInput.current?.click()}
                                disabled={isSaving}
                              >
                                <Camera size={18} aria-hidden="true" />
                                Fotografar avaria
                              </button>
                            ) : (
                              <div className="porter-photo-preview">
                                <img
                                  src={damagePreviewUrl}
                                  alt="Foto do volume avariado"
                                />
                                <div className="porter-photo-actions">
                                  <button
                                    className="porter-secondary-button"
                                    type="button"
                                    onClick={() => damageInput.current?.click()}
                                    disabled={isSaving}
                                  >
                                    Tirar outra foto
                                  </button>
                                  <button
                                    className="porter-cancel-button"
                                    type="button"
                                    onClick={clearDamagePhoto}
                                    disabled={isSaving}
                                  >
                                    Remover
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="porter-form-actions">
                        <button
                          className="porter-primary-button"
                          disabled={
                            isSaving ||
                            !unitId ||
                            (isDamaged && !damageFile) ||
                            (addressVerification?.status === "mismatch" &&
                              !mismatchAcknowledged)
                          }
                        >
                          {isSaving ? "Salvando..." : "Confirmar recebimento"}
                        </button>
                        <button
                          className="porter-cancel-button"
                          type="button"
                          onClick={cancelReception}
                          disabled={isSaving}
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </section>

            {!file && (
              <>
                <section className="porter-card porter-bulk-card">
                  <div className="porter-section-heading">
                    <div>
                      <h2>Importar várias fotos</h2>
                      <p>
                        Selecione várias etiquetas da galeria. O sistema processa
                        uma por vez e mostra o resultado de cada foto.
                      </p>
                    </div>
                    <ClipboardList size={24} aria-hidden="true" />
                  </div>
                  <input
                    ref={bulkInput}
                    className="porter-hidden-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => void handleBulkFilesChange(event)}
                  />
                  <div className="porter-bulk-config">
                    <label>
                      Empresa padrão (opcional)
                      <input
                        autoComplete="off"
                        maxLength={120}
                        placeholder="Ex.: Shopee"
                        value={bulkCompany}
                        disabled={bulkRunning}
                        onChange={(event) => setBulkCompany(event.target.value)}
                      />
                    </label>
                    <label>
                      Entregador padrão
                      <input
                        autoComplete="off"
                        maxLength={120}
                        placeholder="Nome de quem entregou"
                        value={bulkDeliveryPerson}
                        disabled={bulkRunning}
                        onChange={(event) =>
                          setBulkDeliveryPerson(event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <button
                    className="porter-secondary-button"
                    type="button"
                    disabled={bulkRunning || !units.length}
                    onClick={() => bulkInput.current?.click()}
                  >
                    Escolher fotos da galeria
                  </button>

                  {bulkItems.length > 0 && (
                    <>
                      <div className="porter-bulk-progress" role="status">
                        <span>{bulkCounts.done} registrada(s)</span>
                        <span>{bulkCounts.review} para revisar</span>
                        <span>{bulkCounts.error} com erro</span>
                        <span>{bulkCounts.pending} na fila</span>
                      </div>
                      <ul className="porter-bulk-list">
                        {bulkItems.map((item) => (
                          <li
                            key={item.id}
                            className={`porter-bulk-item porter-bulk-item-${item.status}`}
                          >
                            <div className="porter-bulk-item-head">
                              <strong>{item.name}</strong>
                              <span>{bulkStatusLabel[item.status]}</span>
                            </div>
                            <p>{item.message}</p>
                            {item.status === "done" && item.whatsappLink && (
                              <a
                                className="porter-whatsapp-link"
                                href={item.whatsappLink}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Avisar morador no WhatsApp
                              </a>
                            )}
                            {item.status === "error" && (
                              <button
                                className="porter-secondary-button"
                                type="button"
                                disabled={bulkRunning}
                                onClick={() => void retryBulkItem(item)}
                              >
                                Tentar novamente
                              </button>
                            )}
                            {item.status === "review" && item.draft && (
                              <div className="porter-bulk-review">
                                <label>
                                  Apartamento
                                  <select
                                    value={item.draft.unitId}
                                    disabled={bulkRunning}
                                    onChange={(event) =>
                                      updateBulkDraft(item.id, {
                                        unitId: event.target.value,
                                      })
                                    }
                                  >
                                    <option value="">Selecione</option>
                                    {units.map((unit) => (
                                      <option key={unit.id} value={unit.id}>
                                        {blocks.find(
                                          (block) => block.id === unit.block_id,
                                        )?.name
                                          ? `${blocks.find((block) => block.id === unit.block_id)?.name} · `
                                          : ""}
                                        {unit.unit_number}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Empresa (opcional)
                                  <input
                                    autoComplete="off"
                                    maxLength={120}
                                    value={item.draft.company}
                                    disabled={bulkRunning}
                                    onChange={(event) =>
                                      updateBulkDraft(item.id, {
                                        company: event.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  Entregador
                                  <input
                                    autoComplete="off"
                                    maxLength={120}
                                    placeholder="Nome de quem entregou"
                                    value={item.draft.deliveryPerson}
                                    disabled={bulkRunning}
                                    onChange={(event) =>
                                      updateBulkDraft(item.id, {
                                        deliveryPerson: event.target.value,
                                      })
                                    }
                                  />
                                  {lastDeliveryPerson &&
                                    item.draft.deliveryPerson !==
                                      lastDeliveryPerson && (
                                      <button
                                        className="text-button"
                                        type="button"
                                        disabled={bulkRunning}
                                        onClick={() =>
                                          updateBulkDraft(item.id, {
                                            deliveryPerson: lastDeliveryPerson,
                                          })
                                        }
                                      >
                                        Usar último entregador ({lastDeliveryPerson})
                                      </button>
                                    )}
                                </label>
                                {item.draft.addressVerification.status ===
                                  "mismatch" && (
                                  <label className="porter-mismatch-check">
                                    <input
                                      type="checkbox"
                                      checked={item.acknowledged}
                                      onChange={(event) =>
                                        updateBulkItem(item.id, {
                                          acknowledged: event.target.checked,
                                        })
                                      }
                                    />
                                    Confiro que conferi a etiqueta fisicamente e
                                    a entrega pertence a este condomínio.
                                  </label>
                                )}
                                {isDuplicateBulkMessage(item.message) && (
                                  <label className="porter-mismatch-check">
                                    <input
                                      type="checkbox"
                                      checked={item.allowDuplicate}
                                      onChange={(event) =>
                                        updateBulkItem(item.id, {
                                          allowDuplicate: event.target.checked,
                                        })
                                      }
                                    />
                                    Confirmo que é outro volume com o mesmo
                                    rastreio.
                                  </label>
                                )}
                                <button
                                  className="porter-primary-button"
                                  type="button"
                                  disabled={
                                    bulkRunning ||
                                    reviewReasonsFor(item, item.draft).length > 0
                                  }
                                  onClick={() => {
                                    if (item.draft) void saveBulkItem(item, item.draft);
                                  }}
                                >
                                  Salvar este pacote
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                      <div className="porter-bulk-actions">
                        <button
                          className="porter-primary-button"
                          type="button"
                          disabled={bulkRunning || bulkCounts.pending === 0}
                          onClick={() => void startBulkImport()}
                        >
                          {bulkRunning
                            ? "Processando fila..."
                            : `Processar ${bulkCounts.pending} foto(s)`}
                        </button>
                        {bulkRunning ? (
                          <button
                            className="porter-secondary-button"
                            type="button"
                            onClick={() => {
                              bulkCancelled.current = true;
                            }}
                          >
                            Cancelar
                          </button>
                        ) : (
                          <button
                            className="porter-secondary-button"
                            type="button"
                            onClick={clearBulkQueue}
                          >
                            Limpar fila
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </section>

                <section className="porter-card porter-unit-search">
                  <div className="porter-section-heading">
                    <div>
                      <h2>Buscar apartamento</h2>
                      <p>Digite o número para consultar moradores e encomendas.</p>
                    </div>
                    <Search size={24} aria-hidden="true" />
                  </div>
                  <form
                    className="porter-search-form"
                    role="search"
                    onSubmit={handleUnitSearchSubmit}
                  >
                    <label htmlFor="porter-unit-search">Número do apartamento</label>
                    <div className="porter-search-control">
                      <input
                        id="porter-unit-search"
                        type="search"
                        inputMode="search"
                        autoComplete="off"
                        placeholder="Ex.: 901"
                        value={unitSearchQuery}
                        onChange={(event) =>
                          handleUnitSearchChange(event.target.value)
                        }
                      />
                      <button
                        className="porter-search-button"
                        type="submit"
                        disabled={!unitSearchQuery.trim()}
                      >
                        <Search size={18} aria-hidden="true" />
                        <span>Buscar</span>
                      </button>
                    </div>
                  </form>

                  {unitSearchQuery.trim() && unitSearchResults.length > 0 && (
                    <ul className="porter-search-results">
                      {unitSearchResults.map((unit) => {
                        const blockName = blocks.find(
                          (block) => block.id === unit.block_id,
                        )?.name;
                        return (
                          <li key={unit.id}>
                            <button
                              type="button"
                              aria-pressed={searchedUnitId === unit.id}
                              onClick={() => void showUnitDetails(unit)}
                            >
                              <span>
                                <strong>{unit.unit_number}</strong>
                                {blockName && <small>{blockName}</small>}
                              </span>
                              <ChevronRight size={20} aria-hidden="true" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {unitSearchQuery.trim() && unitSearchResults.length === 0 && (
                    <p className="porter-empty">
                      Nenhum apartamento autorizado encontrado com esse número.
                    </p>
                  )}
                  {matchingSearchUnits.length > UNIT_SEARCH_PAGE_SIZE && (
                    <Pagination
                      page={unitSearchPage}
                      total={matchingSearchUnits.length}
                      pageSize={UNIT_SEARCH_PAGE_SIZE}
                      onChange={setUnitSearchPage}
                      label="Páginas de apartamentos"
                      disabled={isLoadingUnitDetails}
                    />
                  )}

                  {selectedSearchUnit && (
                    <div className="porter-unit-details" aria-live="polite">
                      <div className="porter-unit-details-heading">
                        <div>
                          <h3>
                            {blocks.find(
                              (block) => block.id === selectedSearchUnit.block_id,
                            )?.name
                              ? `${blocks.find((block) => block.id === selectedSearchUnit.block_id)?.name} · `
                              : ""}
                            Apartamento {selectedSearchUnit.unit_number}
                          </h3>
                          <span>Dados deste apartamento</span>
                        </div>
                        <button
                          className="porter-clear-search"
                          type="button"
                          aria-label="Fechar dados do apartamento"
                          onClick={() => handleUnitSearchChange("")}
                        >
                          <X size={20} aria-hidden="true" />
                        </button>
                      </div>

                      {isLoadingUnitDetails ? (
                        <p className="porter-empty">Carregando os dados...</p>
                      ) : unitDetailsError ? (
                        <p className="porter-error" role="alert">
                          {unitDetailsError}
                        </p>
                      ) : (
                        <>
                          <section className="porter-unit-data-section">
                            <h4>Moradores</h4>
                            {unitResidents.length === 0 ? (
                              <p className="porter-empty">
                                Nenhum morador cadastrado neste apartamento.
                              </p>
                            ) : (
                              <ul className="porter-resident-list">
                                {unitResidents.map((resident) => (
                                  <li key={resident.id}>
                                    <strong>{resident.name || "Nome não informado"}</strong>
                                    {resident.whatsapp && (
                                      <span>WhatsApp: {resident.whatsapp}</span>
                                    )}
                                    {resident.whatsapp &&
                                      selectedSearchUnit &&
                                      (pendingUnitPackages.length > 0 ? (
                                        <a
                                          className="porter-whatsapp-link"
                                          href={packageWhatsappLink(
                                            resident.whatsapp,
                                            `o apartamento ${selectedSearchUnit.unit_number}`,
                                            resident.name ?? "",
                                            pendingUnitPackages[0]?.tracking_code ?? "",
                                          )}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          Avisar no WhatsApp
                                        </a>
                                      ) : (
                                        <small className="porter-notify-status">
                                          Sem encomendas para avisar
                                        </small>
                                      ))}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </section>

                          <section className="porter-unit-data-section">
                            <h4>
                              Encomendas e retiradas
                              {unitTotal > 0 && (
                                <small> · {unitTotal.toLocaleString("pt-BR")} no total</small>
                              )}
                            </h4>
                            {unitPackages.length === 0 ? (
                              <p className="porter-empty">
                                Nenhuma encomenda registrada neste apartamento.
                              </p>
                            ) : (
                              <>
                                <ul className="porter-unit-package-list">
                                  {unitPackages.map((item) => (
                                    <li key={item.id}>
                                      <strong>
                                        {item.status === "received"
                                          ? "Na portaria"
                                          : "Retirada"}
                                      </strong>
                                      <span>Recebida {formatDate(item.received_at)}</span>
                                      {item.resident_name && (
                                        <span>Morador: {item.resident_name}</span>
                                      )}
                                      <span>
                                        Morador do apartamento:{" "}
                                        {item.recipient_is_resident
                                          ? "confirmado"
                                          : "não confirmado"}
                                      </span>
                                      {item.sender && <span>Empresa: {item.sender}</span>}
                                      {item.delivery_person && (
                                        <span>Entregador: {item.delivery_person}</span>
                                      )}
                                      {item.tracking_code && (
                                        <span>Rastreio: {item.tracking_code}</span>
                                      )}
                                      {item.collected_at && (
                                        <span>
                                          Retirada {formatDate(item.collected_at)}
                                          {item.collected_by_name
                                            ? ` por ${item.collected_by_name}`
                                            : ""}
                                        </span>
                                      )}
                                      {item.status === "collected" &&
                                        (Object.prototype.hasOwnProperty.call(
                                          signatureCache,
                                          item.id,
                                        ) ? (
                                          signatureCache[item.id] ? (
                                            <img
                                              className="porter-unit-signature"
                                              src={signatureCache[item.id] as string}
                                              alt={`Assinatura da retirada de ${item.unit_number}`}
                                            />
                                          ) : (
                                            <small className="porter-notify-status">
                                              Assinatura não disponível.
                                            </small>
                                          )
                                        ) : (
                                          <button
                                            className="porter-secondary-button"
                                            type="button"
                                            onClick={() => void loadRecordSignature(item.id)}
                                          >
                                            Ver assinatura
                                          </button>
                                        ))}
                                    </li>
                                  ))}
                                </ul>
                                <Pagination
                                  page={unitPage}
                                  total={unitTotal}
                                  pageSize={RECORD_PAGE_SIZE}
                                  onChange={setUnitPage}
                                  label="Páginas de encomendas do apartamento"
                                  disabled={isLoadingUnitDetails}
                                />
                              </>
                            )}
                          </section>
                        </>
                      )}
                    </div>
                  )}
                </section>

                <nav
                  className="porter-home-actions"
                  aria-label="Consultas do porteiro"
                >
                  <button
                    type="button"
                    onClick={() => navigateToView("ledger")}
                  >
                    <BookOpen size={24} aria-hidden="true" />
                    <strong>Caderno digital</strong>
                    <small>Consultar registros recentes</small>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToView("pending")}
                  >
                    <ClipboardList size={24} aria-hidden="true" />
                    <strong>Na portaria</strong>
                    <small>
                      {pendingPackages.length} encomenda(s) aguardando retirada
                    </small>
                  </button>
                </nav>
              </>
            )}
          </>
        )}

        {activeView !== "home" && (
          <section className="porter-card">
            <div className="porter-section-heading">
              <div>
                <h2>
                  {activeView === "pending" ? "Na portaria" : "Caderno digital"}
                </h2>
                <p>
                  {activeView === "pending"
                    ? `${pendingPackages.length.toLocaleString("pt-BR")} encomenda(s) aguardando retirada.`
                    : `${ledgerTotal.toLocaleString("pt-BR")} registros no condomínio.`}
                </p>
              </div>
              {activeView === "ledger" && (
                <label className="porter-ledger-sort">
                  Ordenar por
                  <select
                    value={ledgerSort}
                    onChange={(event) => {
                      setLedgerSort(event.target.value as PackageSort);
                      setLedgerPage(1);
                    }}
                  >
                    <option value="recent">Mais recente (dia)</option>
                    <option value="tracking">Rastreio / entregador / loja</option>
                    <option value="sender">Entregador ou loja</option>
                  </select>
                </label>
              )}
              <button
                className="porter-back-button"
                type="button"
                onClick={returnToHome}
              >
                <ArrowLeft size={18} aria-hidden="true" />
                Início
              </button>
            </div>

            {activeView === "pending" && collectionBaseId && batchBase && (
              <form
                className="porter-collection-form"
                onSubmit={handleCollection}
                role="dialog"
                aria-modal="true"
                aria-labelledby="collection-signature-title"
              >
                <h3 id="collection-signature-title">Retirada em lote</h3>
                <p>
                  {batchBase.block_name
                    ? `${batchBase.block_name} · `
                    : ""}
                  Apartamento {batchBase.unit_number}. Todos os pacotes
                  pendentes deste apartamento vêm marcados. Desmarque os que não
                  foram retirados.
                </p>
                <ul className="porter-batch-list">
                  {batchCandidates.map((candidate) => (
                    <li key={candidate.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedCollectionIds.includes(candidate.id)}
                          disabled={savingCollection}
                          onChange={() => toggleCollectionId(candidate.id)}
                        />
                        <span>
                          <strong>{candidate.sender || "Encomenda"}</strong>
                          <small>
                            {candidate.tracking_code || "Sem rastreio"} ·{" "}
                            {formatDate(candidate.received_at)}
                          </small>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="porter-batch-count">
                  {selectedCollectionIds.length} de {batchCandidates.length}{" "}
                  selecionado(s). A mesma assinatura e o mesmo horário serão
                  gravados em todos os selecionados.
                </p>
                <label>
                  Nome de quem está retirando
                  <input
                    required
                    maxLength={120}
                    autoComplete="off"
                    value={collectionName}
                    onChange={(event) => setCollectionName(event.target.value)}
                  />
                </label>
                <div className="porter-signature-pad">
                  <canvas
                    ref={signatureCanvas}
                    width={500}
                    height={500}
                    aria-label="Espaço para o morador assinar"
                    onPointerDown={drawSignature}
                    onPointerMove={drawSignature}
                    onPointerUp={(event) => {
                      if (
                        event.currentTarget.hasPointerCapture(event.pointerId)
                      ) {
                        event.currentTarget.releasePointerCapture(
                          event.pointerId,
                        );
                      }
                    }}
                    onPointerCancel={(event) => {
                      if (
                        event.currentTarget.hasPointerCapture(event.pointerId)
                      ) {
                        event.currentTarget.releasePointerCapture(
                          event.pointerId,
                        );
                      }
                    }}
                  />
                  {!hasSignature && (
                    <span>Assine aqui usando o dedo</span>
                  )}
                </div>
                <button
                  className="porter-secondary-button"
                  type="button"
                  onClick={clearSignature}
                  disabled={!hasSignature || savingCollection}
                >
                  Apagar e assinar novamente
                </button>
                <label className="porter-confirmation-check">
                  <input
                    type="checkbox"
                    checked={porterConfirmed}
                    onChange={(event) =>
                      setPorterConfirmed(event.target.checked)
                    }
                  />
                  Confirmo que presenciei a retirada e a assinatura do morador.
                </label>
                <div className="porter-collection-actions">
                  <button
                    className="porter-primary-button"
                    disabled={
                      savingCollection ||
                      !selectedCollectionIds.length ||
                      !hasSignature ||
                      !porterConfirmed
                    }
                  >
                    {savingCollection
                      ? "Salvando..."
                      : `Confirmar retirada de ${selectedCollectionIds.length} encomenda(s)`}
                  </button>
                  <button
                    className="porter-secondary-button"
                    type="button"
                    onClick={cancelCollection}
                    disabled={savingCollection}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {recordsLoading && activeView === "ledger" ? (
              <p className="porter-empty">Carregando registros...</p>
            ) : visiblePackages.length === 0 ? (
              <p className="porter-empty">
                {activeView === "pending"
                  ? "Nenhuma encomenda aguardando retirada."
                  : "Nenhuma encomenda registrada ainda."}
              </p>
            ) : (
              <ul className="porter-package-list">
                {visiblePackages.map((item) => (
                  <li key={item.id}>
                    <div className="porter-package-info">
                      <strong>
                        {item.block_name ? `${item.block_name} · ` : ""}
                        {item.unit_number}
                      </strong>
                      {item.is_damaged && (
                        <span className="porter-damaged-badge">
                          <AlertTriangle size={14} aria-hidden="true" />
                          Avariado
                        </span>
                      )}
                      <span>{item.resident_name || "Morador não cadastrado"}</span>
                      <small>
                        Morador do apartamento:{" "}
                        {item.recipient_is_resident
                          ? "confirmado"
                          : "não confirmado"}
                      </small>
                      <small>Recebida {formatDate(item.received_at)}</small>
                      {item.sender && <small>{item.sender}</small>}
                      {item.tracking_code && (
                        <small>Rastreio: {item.tracking_code}</small>
                      )}
                      {item.status === "collected" && (
                        <small>
                          Retirada{" "}
                          {item.collected_at ? formatDate(item.collected_at) : ""}
                          {item.collected_by_name
                            ? ` por ${item.collected_by_name}`
                            : ""}
                        </small>
                      )}
                    </div>
                    {item.status === "received" && (
                      <div className="porter-notify-block">
                        <small
                          className={
                            item.last_notified_at
                              ? "porter-notify-status porter-notify-status-sent"
                              : "porter-notify-status porter-notify-status-pending"
                          }
                        >
                          {item.last_notified_at
                            ? `Morador avisado em ${formatDate(item.last_notified_at)}`
                            : "Morador ainda não avisado"}
                        </small>
                        <button
                          className="porter-secondary-button"
                          type="button"
                          disabled={notifyingId === item.id}
                          onClick={() => void notifyPackage(item.id)}
                        >
                          {notifyingId === item.id
                            ? "Abrindo o WhatsApp..."
                            : item.last_notified_at
                              ? "Avisar novamente"
                              : "Avisar morador"}
                        </button>
                      </div>
                    )}
                    {item.status === "received" && (
                      <button
                        className="porter-collection-button"
                        type="button"
                        onClick={() => openCollection(item)}
                      >
                        {collectionBaseId &&
                        selectedCollectionIds.includes(item.id)
                          ? "Selecionado para retirada"
                          : "Registrar retirada"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Pagination
              page={activeView === "pending" ? safePendingPage : ledgerPage}
              total={activeView === "pending" ? pendingPackages.length : ledgerTotal}
              pageSize={RECORD_PAGE_SIZE}
              onChange={activeView === "pending" ? setPendingPage : setLedgerPage}
              label="Páginas de encomendas"
              disabled={recordsLoading}
            />
          </section>
        )}
      </div>
    </main>
  );
}
