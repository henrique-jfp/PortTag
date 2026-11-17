import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent } from "react";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  ClipboardList,
  LogOut,
  PackageCheck,
  Search,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
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
  whatsappLink,
  type PackageNotification,
} from "../lib/packageNotifications";
import { supabase } from "../lib/supabase";

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
  collected_signature: string | null;
  last_notified_at: string | null;
};

type PorterView = "home" | "ledger" | "pending";

const receiptBucket = "package-receipts";
const maximumImageSize = 10 * 1024 * 1024;
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const packageFields =
  "id, unit_number, block_name, resident_name, recipient_is_resident, sender, delivery_person, tracking_code, received_at, status, collected_at, collected_by_name, collected_signature, last_notified_at";

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

function imageExtension(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function getPorterViewFromLocation(): PorterView {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "ledger" || view === "pending" ? view : "home";
}

function isStorageCapacityError(error: unknown) {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : String(error ?? "");
  return /quota|storage|armazenamento|insufficient space|no space/i.test(
    message,
  );
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
 * à fila de importação: a foto comprimida é a mesma para a IA e para o Storage.
 */
type PackageDraft = {
  /** Arquivo original, guardado para permitir nova tentativa de leitura. */
  source: File;
  /** JPEG comprimido que vai para a nuvem e para o bucket. */
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
  const localCode = barcodeValues.map(extractTrackingCode).find(Boolean) ?? "";
  const code = ai.trackingCode || localCode;
  const carrier =
    ai.carrier ||
    detectDeliveryCompany(`${barcodeValues.join("\n")}\n${code}`);

  const transcript = [
    `origem: nuvem (${ai.durationMs} ms)`,
    `destinatario: ${ai.recipientName || "-"}`,
    `unidade: ${ai.unitNumber || "-"}${ai.blockName ? ` / ${ai.blockName}` : ""}`,
    `transportadora: ${ai.carrier || "-"}`,
    `rastreio: ${ai.trackingCode || "-"}`,
    `cep destino: ${ai.destinationCep || "-"}`,
    `endereco destino: ${
      [ai.destinationStreet, ai.destinationNumber].filter(Boolean).join(", ") || "-"
    }`,
    `status: ${ai.addressStatus}`,
    `motivo: ${ai.addressReason || "-"}`,
  ].join("\n");

  const detectedFields = [
    detectedRecipient ? "destinatário" : "",
    ai.unitCandidates.length === 1 ? "apartamento" : "",
    carrier ? "empresa" : "",
    code ? "rastreio" : "",
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
  const code =
    label.barcodeValues.map(extractTrackingCode).find(Boolean) ||
    extractTrackingCode(recognizedText);
  const detectedCompany = detectDeliveryCompany(
    `${barcodeText}\n${recognizedText}\n${code}`,
  );

  let ocrMessage: string;
  if (label.error) {
    if (isStorageCapacityError(label.error)) {
      ocrMessage =
        "Não foi possível concluir a leitura por falta de espaço no aparelho.";
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

/**
 * Uma foto, uma leitura: Vision primeiro, OCR local como fallback. Não toca no
 * estado do React para que a mesma função sirva à fila de importação.
 */
async function readLabelFromPhoto(
  image: File,
  ctx: LabelReadContext,
): Promise<PackageDraft> {
  const compressed = await compressPackagePhoto(image);
  ctx.onProgress?.("Preparando a foto para leitura...");

  let preparedImage: PreparedPackageImage | null = null;
  try {
    preparedImage = await preparePackageImage(compressed.file);

    let barcodeValues: string[] = [];
    try {
      barcodeValues = await readPackageCodes(preparedImage.preview);
    } catch {
      // Código ilegível não impede a leitura do texto.
    }

    try {
      const ai = await extractPackageLabelWithAi({
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
      });
      return draftFromAi(ai, barcodeValues, compressed.file, image);
    } catch (aiError) {
      const detail =
        aiError instanceof Error
          ? aiError.message.replace(/\s+/g, " ").trim()
          : "";
      ctx.onProgress?.(
        `Leitura na nuvem indisponível; lendo a etiqueta no aparelho (modo offline)${
          detail ? `: ${detail.slice(0, 120)}` : ""
        }...`,
      );
    }

    const label = await readPackageLabel(
      preparedImage,
      { expectedCep: ctx.condominium.cep ?? "" },
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
) {
  const message = `Olá! Chegou uma encomenda para ${unitLabel}${
    recipient ? ` (${recipient})` : ""
  } no ${condominiumName}. Por favor, retire na portaria.`;
  return whatsappLink(whatsapp, message);
}

/** Upload + create_package. Nunca grava no banco antes da foto estar no Storage. */
async function persistPackage(
  draft: PackageDraft,
  ctx: {
    userId: string;
    condominiumId: string;
    condominiumName: string;
    unit: Unit;
    company: string;
    deliveryPerson: string;
    whatsapp: string;
    allowDuplicate: boolean;
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

  const path = `${ctx.condominiumId}/${ctx.unit.block_id ?? "no-block"}/${ctx.userId}/${crypto.randomUUID()}.${imageExtension(draft.file)}`;
  const { error: uploadError } = await supabase.storage
    .from(receiptBucket)
    .upload(path, draft.file, {
      contentType: draft.file.type,
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadError) {
    throw new Error(`Não foi possível enviar a foto. ${uploadError.message}`);
  }

  const { data: createdPackageId, error: createError } = await supabase.rpc(
    "create_package",
    {
      p_condominium_id: ctx.condominiumId,
      p_unit_id: ctx.unit.id,
      p_receipt_path: path,
      p_sender: ctx.company.trim(),
      p_delivery_person: ctx.deliveryPerson.trim(),
      p_tracking_code: trimmedTrackingCode || null,
      p_resident_name: draft.recipientName.trim(),
      p_recipient_is_resident: draft.recipientIsResident,
    },
  );

  if (createError) {
    const { error: cleanupError } = await supabase.storage
      .from(receiptBucket)
      .remove([path]);
    throw new Error(
      cleanupError
        ? `Não foi possível registrar (${createError.message}) nem remover a foto enviada (${cleanupError.message}).`
        : createError.message,
    );
  }

  return {
    id: typeof createdPackageId === "string" ? createdPackageId : "",
    whatsappLink: ctx.whatsapp
      ? buildWhatsappLink(
          ctx.condominiumName,
          ctx.whatsapp,
          `o apartamento ${ctx.unit.unit_number}`,
          draft.recipientName.trim(),
        )
      : "",
  };
}

export function PorterReception() {
  const { user, signOut } = useAuth();
  const imageInput = useRef<HTMLInputElement>(null);
  const bulkInput = useRef<HTMLInputElement>(null);
  const signatureCanvas = useRef<HTMLCanvasElement>(null);
  const signatureHasInk = useRef(false);
  const hasInternalHistory = useRef(false);
  const receiveForm = useRef<HTMLFormElement>(null);
  const allowDuplicate = useRef(false);
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
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [pendingPackages, setPendingPackages] = useState<PackageRecord[]>([]);
  const [unitSearchQuery, setUnitSearchQuery] = useState("");
  const [searchedUnitId, setSearchedUnitId] = useState("");
  const [unitResidents, setUnitResidents] = useState<UnitResident[]>([]);
  const [unitPackages, setUnitPackages] = useState<PackageRecord[]>([]);
  const [isLoadingUnitDetails, setIsLoadingUnitDetails] = useState(false);
  const [unitDetailsError, setUnitDetailsError] = useState("");
  const [pageError, setPageError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
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
  const [lastPackageId, setLastPackageId] = useState("");
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
  const [lastPackageWhatsapp, setLastPackageWhatsapp] = useState("");
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkCompany, setBulkCompany] = useState("");
  const [bulkDeliveryPerson, setBulkDeliveryPerson] = useState("");
  const bulkCancelled = useRef(false);
  const unitDetailsRequest = useRef(0);

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
  const unitSearchResults = useMemo(() => {
    const query = unitSearchQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return [];
    return units
      .filter((unit) =>
        unit.unit_number.toLocaleLowerCase("pt-BR").includes(query),
      )
      .slice(0, 12);
  }, [unitSearchQuery, units]);
  const visiblePackages =
    activeView === "pending"
      ? pendingPackages
      : packages;
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

  // O worker do Tesseract custa segundos para carregar o WASM. Ele só morre
  // quando o app fecha ou quando dá erro de memória; cada foto reutiliza o
  // mesmo worker.
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

      const [
        recentPackagesResult,
        pendingPackagesResult,
        residentDirectoryResult,
      ] = await Promise.all([
        supabase
          .from("packages")
          .select(packageFields)
          .eq("condominium_id", porterData.condominium_id)
          .order("received_at", { ascending: false })
          .limit(40),
        supabase
          .from("packages")
          .select(packageFields)
          .eq("condominium_id", porterData.condominium_id)
          .eq("status", "received")
          .order("received_at", { ascending: false }),
        supabase.from("unit_residents").select("unit_id, name, whatsapp"),
      ]);

      if (!active) return;
      const packagesError =
        recentPackagesResult.error ?? pendingPackagesResult.error;
      if (packagesError) {
        setPageError(packagesError.message);
      } else {
        setPackages(recentPackagesResult.data ?? []);
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

  async function reloadPackages() {
    if (!account) return;
    const [recentPackagesResult, pendingPackagesResult] = await Promise.all([
      supabase
        .from("packages")
        .select(packageFields)
        .eq("condominium_id", account.condominium_id)
        .order("received_at", { ascending: false })
        .limit(40),
      supabase
        .from("packages")
        .select(packageFields)
        .eq("condominium_id", account.condominium_id)
        .eq("status", "received")
        .order("received_at", { ascending: false }),
    ]);
    const error = recentPackagesResult.error ?? pendingPackagesResult.error;
    if (error) {
      setPageError(error.message);
      return;
    }
    setPackages(recentPackagesResult.data ?? []);
    setPendingPackages(pendingPackagesResult.data ?? []);
  }

  function handleUnitSearchChange(value: string) {
    unitDetailsRequest.current += 1;
    setUnitSearchQuery(value);
    setSearchedUnitId("");
    setUnitResidents([]);
    setUnitPackages([]);
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
    setUnitSearchQuery(unit.unit_number);
    setSearchedUnitId(unit.id);
    setUnitResidents([]);
    setUnitPackages([]);
    setUnitDetailsError("");
    setIsLoadingUnitDetails(true);

    try {
      const [residentsResult, packagesResult] = await Promise.all([
        supabase
          .from("unit_residents")
          .select("id, name, whatsapp")
          .eq("unit_id", unit.id)
          .order("created_at"),
        supabase
          .from("packages")
          .select(packageFields)
          .eq("unit_id", unit.id)
          .order("received_at", { ascending: false }),
      ]);

      if (requestId !== unitDetailsRequest.current) return;
      const loadError = residentsResult.error ?? packagesResult.error;
      if (loadError) {
        setUnitDetailsError(
          `Não foi possível carregar os dados do apartamento. ${loadError.message}`,
        );
        return;
      }

      setUnitResidents(residentsResult.data ?? []);
      setUnitPackages(packagesResult.data ?? []);
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
  ) {
    return buildWhatsappLink(
      condominium?.name ?? "condomínio",
      whatsapp,
      unitLabel,
      recipient,
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
    setLastPackageId("");
    setLastPackageWhatsapp("");
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

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0] ?? null;
    event.target.value = "";
    resetReceptionFields();
    setFile(null);
    setPreviewUrl("");
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

    setIsReading(true);
    setOcrMessage("Preparando a foto para leitura...");
    try {
      const draft = await readLabelFromPhoto(image, {
        condominium,
        units,
        blocks,
        residents: authorizedResidents,
        onProgress: (message) => setOcrMessage(message),
      });
      applyDraftToForm(draft, URL.createObjectURL(draft.file));
      if (isStorageCapacityError(draft.labelRead?.error)) {
        setPageError(
          "O celular está sem espaço disponível para processar a etiqueta. Libere espaço e tente novamente.",
        );
      }
    } catch (error) {
      if (isStorageCapacityError(error)) {
        setPageError(
          "O celular está sem espaço disponível para processar a etiqueta. Libere espaço e tente novamente.",
        );
      }
      setAddressVerification({
        status: "unknown",
        message: defaultAddressMessage("unknown"),
      });
      setOcrMessage(
        error instanceof Error
          ? `Não foi possível processar a foto. ${error.message}`
          : "Não foi possível processar a foto. Tente novamente.",
      );
    } finally {
      setIsReading(false);
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

    setPageError("");
    setSuccessMessage("");
    setNotificationMessage("");
    setLastPackageId("");
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
        whatsapp: savedWhatsapp,
        allowDuplicate: allowDuplicate.current,
      });

      rememberDeliveryPerson(deliveryPerson.trim());
      setSuccessMessage(
        `Encomenda registrada para o apartamento ${selectedUnit.unit_number}.`,
      );
      setLastPackageId(result.id);
      setLastPackageWhatsapp(result.whatsappLink);

      const trimmedDeliveryPerson = deliveryPerson.trim();
      resetReceptionFields();
      setFile(null);
      setPreviewUrl("");
      setDeliveryPerson(trimmedDeliveryPerson || lastDeliveryPerson);
      await reloadPackages();
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
        whatsapp,
        allowDuplicate: item.allowDuplicate,
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

    if (isStorageCapacityError(draft.labelRead?.error)) {
      updateBulkItem(item.id, {
        status: "error",
        draft,
        message: "Sem espaço no aparelho para processar a etiqueta.",
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

  async function handleNotify(packageId: string) {
    setPageError("");
    setNotificationMessage("");
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
      setNotificationMessage("Aviso registrado. Abrindo o WhatsApp...");
      window.location.assign(
        whatsappLink(notification.recipient, notification.message),
      );
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

  function resetPhoto() {
    setFile(null);
    setPreviewUrl("");
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
    setLastPackageId("");
    setLastPackageWhatsapp("");
    setLastLabelRead(null);
    allowDuplicate.current = false;
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
        <button
          className="porter-logout"
          aria-label="Sair"
          onClick={() => void handleSignOut()}
        >
          <LogOut size={20} />
        </button>
      </header>

      <div className="porter-content">
        {pageError && <p className="porter-error" role="alert">{pageError}</p>}
        {successMessage && (
          <p className="porter-success" role="status">
            <Check size={18} />
            {successMessage}
          </p>
        )}

        {notificationMessage && (
          <p className="porter-success" role="status">
            <Check size={18} />
            {notificationMessage}
          </p>
        )}

        {lastPackageId && (
          <section className="porter-notify-prompt">
            <p>Avise o morador que a encomenda chegou.</p>
            <button
              className="porter-primary-button"
              type="button"
              disabled={notifyingId === lastPackageId}
              onClick={() => void handleNotify(lastPackageId)}
            >
              {notifyingId === lastPackageId
                ? "Abrindo o WhatsApp..."
                : "Avisar morador no WhatsApp"}
            </button>
            {lastPackageWhatsapp && (
              <a
                className="porter-whatsapp-link"
                href={lastPackageWhatsapp}
                target="_blank"
                rel="noreferrer"
              >
                Abrir conversa direta no WhatsApp (sem custo)
              </a>
            )}
            <button
              className="porter-secondary-button"
              type="button"
              onClick={() => {
                setLastPackageId("");
                setLastPackageWhatsapp("");
              }}
            >
              Agora não
            </button>
          </section>
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
                    <button
                      type="button"
                      className="porter-secondary-button"
                      onClick={resetPhoto}
                      disabled={isReading || isSaving}
                    >
                      Tirar outra foto
                    </button>
                  </div>
                  <p className="porter-ocr-status" role="status">
                    {isReading ? "Analisando a foto..." : ocrMessage}
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

                      <button
                        className="porter-primary-button"
                        disabled={
                          isSaving ||
                          !unitId ||
                          (addressVerification?.status === "mismatch" &&
                            !mismatchAcknowledged)
                        }
                      >
                        {isSaving ? "Salvando..." : "Confirmar recebimento"}
                      </button>
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
                                    {resident.whatsapp && selectedSearchUnit && (
                                      <a
                                        className="porter-whatsapp-link"
                                        href={packageWhatsappLink(
                                          resident.whatsapp,
                                          `o apartamento ${selectedSearchUnit.unit_number}`,
                                          resident.name ?? "",
                                        )}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Avisar no WhatsApp
                                      </a>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </section>

                          <section className="porter-unit-data-section">
                            <h4>Encomendas e retiradas</h4>
                            {unitPackages.length === 0 ? (
                              <p className="porter-empty">
                                Nenhuma encomenda registrada neste apartamento.
                              </p>
                            ) : (
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
                                    {item.collected_signature && (
                                      <img
                                        className="porter-unit-signature"
                                        src={item.collected_signature}
                                        alt={`Assinatura da retirada de ${item.unit_number}`}
                                      />
                                    )}
                                  </li>
                                ))}
                              </ul>
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
                    ? "Encomendas aguardando retirada."
                    : "Registros recentes do condomínio."}
                </p>
              </div>
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
                    height={260}
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

            {visiblePackages.length === 0 ? (
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
                          onClick={() => void handleNotify(item.id)}
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
          </section>
        )}
      </div>
    </main>
  );
}
