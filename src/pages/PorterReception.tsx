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

export function PorterReception() {
  const { user, signOut } = useAuth();
  const imageInput = useRef<HTMLInputElement>(null);
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
  const [collectionPackageId, setCollectionPackageId] = useState("");
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
      setCollectionPackageId(params.get("collect") ?? "");
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
        supabase.from("unit_residents").select("unit_id, name"),
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
    const url = new URL(window.location.href);
    url.searchParams.set("view", "pending");
    url.searchParams.set("collect", packageRecord.id);
    window.history.pushState(
      { porterView: "pending", collectionPackageId: packageRecord.id },
      "",
      url,
    );
    setActiveView("pending");
    setCollectionPackageId(packageRecord.id);
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
    const message = `Olá! Chegou uma encomenda para ${unitLabel}${
      recipient ? ` (${recipient})` : ""
    } no ${condominium?.name ?? "condomínio"}. Por favor, retire na portaria.`;
    return whatsappLink(whatsapp, message);
  }

  function applyAiResult(ai: AiLabelExtraction<Unit>, barcodeValues: string[]) {
    const detectedRecipient = ai.recipientName.trim();
    setRecipientName(detectedRecipient);
    setRecipientNameDetected(Boolean(detectedRecipient));
    setRecipientIsResident(false);

    const localCode = barcodeValues.map(extractTrackingCode).find(Boolean) ?? "";
    const code = ai.trackingCode || localCode;
    const carrier =
      ai.carrier ||
      detectDeliveryCompany(`${barcodeValues.join("\n")}\n${code}`);

    setCompany(carrier);
    setTrackingCode(code);
    setTrackingCodeDetected(Boolean(code));
    setUnitCandidates(ai.unitCandidates);
    if (ai.unitId) setUnitId(ai.unitId);

    setAddressVerification({
      status: ai.addressStatus,
      message: ai.addressReason || defaultAddressMessage(ai.addressStatus),
    });

    const transcript = [
      `origem: nuvem (${ai.durationMs} ms)`,
      `destinatario: ${ai.recipientName || "-"}`,
      `unidade: ${ai.unitNumber || "-"}${
        ai.blockName ? ` / ${ai.blockName}` : ""
      }`,
      `transportadora: ${ai.carrier || "-"}`,
      `rastreio: ${ai.trackingCode || "-"}`,
      `cep destino: ${ai.destinationCep || "-"}`,
      `endereco destino: ${
        [ai.destinationStreet, ai.destinationNumber].filter(Boolean).join(", ") ||
        "-"
      }`,
      `status: ${ai.addressStatus}`,
      `motivo: ${ai.addressReason || "-"}`,
    ].join("\n");

    setLastLabelRead({
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
    });

    const detectedFields = [
      detectedRecipient ? "destinatário" : "",
      ai.unitCandidates.length === 1 ? "apartamento" : "",
      carrier ? "empresa" : "",
      code ? "rastreio" : "",
      ai.addressStatus === "verified" ? "endereço" : "",
    ].filter(Boolean);

    setOcrMessage(
      detectedFields.length
        ? `Leitura na nuvem concluída: ${detectedFields.join(", ")}. Confira os dados.`
        : "Leitura na nuvem concluída, mas o endereço não foi confirmado automaticamente. Confira a etiqueta antes de salvar.",
    );
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0] ?? null;
    event.target.value = "";
    setPageError("");
    setSuccessMessage("");
    setOcrMessage("");
    setUnitCandidates([]);
    setUnitId("");
    setDeliveryPerson(lastDeliveryPerson);
    setCompany("");
    setTrackingCode("");
    setTrackingCodeDetected(false);
    setRecipientName("");
    setRecipientNameDetected(false);
    setRecipientIsResident(false);
    setAddressVerification(null);
    setMismatchAcknowledged(false);
    setDuplicateWarning("");
    setNotificationMessage("");
    setLastPackageId("");
    setLastPackageWhatsapp("");
    allowDuplicate.current = false;

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
    setLastLabelRead(null);

    let preparedImage: PreparedPackageImage | null = null;
    try {
      // A mesma foto comprimida vai para a nuvem e para o Storage: uma
      // compressão, ~150–250 KB, em vez de 3–8 MB no bucket.
      const compressed = await compressPackagePhoto(image);
      setFile(compressed.file);
      setPreviewUrl(URL.createObjectURL(compressed.file));

      preparedImage = await preparePackageImage(compressed.file);

      let barcodeValues: string[] = [];
      try {
        barcodeValues = await readPackageCodes(preparedImage.preview);
      } catch {
        // Código ilegível não impede a leitura do texto.
      }

      const expectedCep = condominium.cep ?? "";
      const residentNames = authorizedResidents
        .map((resident) => resident.name?.trim() ?? "")
        .filter(Boolean);

      // Caminho principal: Vision LLM. Qualquer falha cai no leitor local.
      try {
        const ai = await extractPackageLabelWithAi({
          client: supabase,
          condominiumId: condominium.id,
          imageBase64: compressed.base64,
          mimeType: compressed.mimeType,
          expectedAddress: {
            cep: condominium.cep,
            street: condominium.street,
            address_number: condominium.address_number,
          },
          units,
          blocks,
          residents: authorizedResidents,
        });
        applyAiResult(ai, barcodeValues);
        return;
      } catch (aiError) {
        const detail =
          aiError instanceof Error ? aiError.message.replace(/\s+/g, " ").trim() : "";
        setOcrMessage(
          `Leitura na nuvem indisponível; lendo a etiqueta no aparelho (modo offline)${
            detail ? `: ${detail.slice(0, 120)}` : ""
          }...`,
        );
      }

      const label = await readPackageLabel(
        preparedImage,
        { expectedCep },
        (status) => setOcrMessage(status),
      );
      setLastLabelRead(label);

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
      setRecipientName(detectedRecipientName);
      setRecipientNameDetected(Boolean(detectedRecipientName));
      setRecipientIsResident(false);

      const verification = verifyPackageDestinationAddress({
        recognizedText,
        numericText: label.numericText,
        barcodeText,
        address: condominium,
        residentNames,
      });
      setAddressVerification(verification);

      const residentCandidates = findResidentUnitCandidates(
        `${barcodeText}\n${recognizedText}`,
        units,
        authorizedResidents,
      );
      // Fora do bloco do destinatário, todo número é pedido, contrato ou CEP.
      const numberCandidates = findUnitCandidates(
        `${barcodeText}\n${destinationText || recognizedText}`,
        units,
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

      setCompany(detectedCompany);
      setUnitCandidates(candidates);
      if (candidates.length === 1) setUnitId(candidates[0].id);
      setTrackingCode(code);
      setTrackingCodeDetected(Boolean(code));

      if (label.error) {
        if (isStorageCapacityError(label.error)) {
          setPageError(
            "O celular está sem espaço disponível para processar a etiqueta. Libere espaço e tente novamente.",
          );
          setOcrMessage("Não foi possível concluir a leitura por falta de espaço.");
          return;
        }
        const details =
          label.error instanceof Error ? ` ${label.error.message}` : "";
        setOcrMessage(
          code || detectedCompany || candidates.length
            ? "Leitura no aparelho (modo offline): código da etiqueta lido, mas o texto não foi reconhecido; confira os dados."
            : `Leitura no aparelho (modo offline): não foi possível ler o texto da etiqueta.${details}`,
        );
        return;
      }

      const detectedFields = [
        detectedRecipientName ? "destinatário" : "",
        candidates.length === 1 ? "apartamento" : "",
        detectedCompany ? "empresa" : "",
        code ? "rastreio" : "",
        verification.status === "verified" ? "endereço" : "",
      ].filter(Boolean);
      const characters = recognizedText.replace(/\s/g, "").length;

      setOcrMessage(
        detectedFields.length
          ? `Leitura no aparelho (modo offline): ${detectedFields.join(", ")}. Confira os dados.`
          : `Leitura no aparelho (modo offline): a etiqueta foi lida (${characters} caracteres), mas o endereço não foi confirmado. Enquadre a etiqueta inteira, com boa luz, e tire outra foto.`,
      );
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
      preparedImage?.dispose();
      setIsReading(false);
    }
  }

  async function handleReceive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !account || !file || !selectedUnit) return;
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

    const trimmedTrackingCode = trackingCode.trim();
    if (trimmedTrackingCode && !allowDuplicate.current) {
      const { data: duplicateRows } = await supabase.rpc(
        "find_duplicate_package",
        {
          p_condominium_id: account.condominium_id,
          p_tracking_code: trimmedTrackingCode,
        },
      );
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
        setDuplicateWarning(
          `Já existe uma encomenda com o rastreio ${trimmedTrackingCode}: ${
            duplicate.block_name ? `${duplicate.block_name} · ` : ""
          }${duplicate.unit_number}, recebida em ${formatDate(duplicate.received_at)}. Se for outro volume, registre mesmo assim.`,
        );
        return;
      }
    }

    setIsSaving(true);
    const path = `${account.condominium_id}/${selectedUnit.block_id ?? "no-block"}/${user.id}/${crypto.randomUUID()}.${imageExtension(file)}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from(receiptBucket)
        .upload(path, file, {
          contentType: file.type,
          cacheControl: "3600",
          upsert: false,
        });
      if (uploadError) {
        setPageError(`Não foi possível enviar a foto. ${uploadError.message}`);
        return;
      }

      const { data: createdPackageId, error: createError } = await supabase.rpc(
        "create_package",
        {
          p_condominium_id: account.condominium_id,
          p_unit_id: selectedUnit.id,
          p_receipt_path: path,
          p_sender: company.trim(),
          p_delivery_person: deliveryPerson.trim(),
          p_tracking_code: trackingCode.trim() || null,
          p_resident_name: recipientName.trim(),
          p_recipient_is_resident: recipientIsResident,
        },
      );

      if (createError) {
        const { error: cleanupError } = await supabase.storage
          .from(receiptBucket)
          .remove([path]);
        setPageError(
          cleanupError
            ? `Não foi possível registrar (${createError.message}) nem remover a foto enviada (${cleanupError.message}).`
            : createError.message,
        );
        return;
      }

      const savedWhatsapp =
        selectedUnitContacts.find((resident) => resident.whatsapp)?.whatsapp ??
        "";
      setLastPackageWhatsapp(
        savedWhatsapp
          ? packageWhatsappLink(
              savedWhatsapp,
              `o apartamento ${selectedUnit.unit_number}`,
              recipientName.trim(),
            )
          : "",
      );

      const trimmedDeliveryPerson = deliveryPerson.trim();
      if (trimmedDeliveryPerson) {
        setSavedDeliveryPersonRevision((current) => current + 1);
        try {
          window.sessionStorage.setItem(
            deliveryPersonStorageKey(account.condominium_id),
            trimmedDeliveryPerson,
          );
        } catch {
          // Sessão sem storage: só não memoriza o entregador.
        }
      }

      setSuccessMessage(`Encomenda registrada para o apartamento ${selectedUnit.unit_number}.`);
      allowDuplicate.current = false;
      setMismatchAcknowledged(false);
      setDuplicateWarning("");
      setLastPackageId(
        typeof createdPackageId === "string" ? createdPackageId : "",
      );
      setFile(null);
      setPreviewUrl("");
      setUnitId("");
      setUnitCandidates([]);
      setCompany("");
      setDeliveryPerson(trimmedDeliveryPerson || lastDeliveryPerson);
      setTrackingCode("");
      setTrackingCodeDetected(false);
      setRecipientName("");
      setRecipientNameDetected(false);
      setRecipientIsResident(false);
      setAddressVerification(null);
      setOcrMessage("");
      await reloadPackages();
    } catch (error) {
      setPageError(
        error instanceof Error
          ? `Não foi possível registrar a encomenda. ${error.message}`
          : "Não foi possível registrar a encomenda.",
      );
    } finally {
      setIsSaving(false);
    }
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
    if (!collectionPackageId || !collectionName.trim()) return;
    const canvas = signatureCanvas.current;
    if (!canvas || !signatureHasInk.current || !porterConfirmed) {
      setPageError("Peça a assinatura do morador e confirme que você presenciou a retirada.");
      return;
    }

    setPageError("");
    setSavingCollection(true);
    try {
      const { error } = await supabase.rpc("confirm_package_collection", {
        p_package_id: collectionPackageId,
        p_collected_by_name: collectionName.trim(),
        p_resident_signature: signatureDataUrl(canvas),
        p_porter_confirmed: porterConfirmed,
      });
      if (error) {
        setPageError(error.message);
        return;
      }
      cancelCollection();
      await reloadPackages();
      setSuccessMessage("Retirada registrada.");
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
    if (!collectionPackageId) return;
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
  }, [collectionPackageId]);

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
    if (url.searchParams.get("collect") === collectionPackageId) {
      window.history.back();
    }
    setCollectionPackageId("");
    setCollectionName("");
    setPorterConfirmed(false);
    setHasSignature(false);
    signatureHasInk.current = false;
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
                        Empresa
                        <input
                          required
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
                    {item.status === "received" &&
                      (collectionPackageId === item.id ? (
                        <form
                          className="porter-collection-form"
                          onSubmit={handleCollection}
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="collection-signature-title"
                        >
                          <h3 id="collection-signature-title">
                            Assinatura do morador
                          </h3>
                          <p>
                            A assinatura e o nome ficarão vinculados
                            permanentemente a este registro no caderno do
                            condomínio.
                          </p>
                          <label>
                            Nome de quem está retirando
                            <input
                              required
                              maxLength={120}
                              autoComplete="off"
                              value={collectionName}
                              onChange={(event) =>
                                setCollectionName(event.target.value)
                              }
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
                                  event.currentTarget.hasPointerCapture(
                                    event.pointerId,
                                  )
                                ) {
                                  event.currentTarget.releasePointerCapture(
                                    event.pointerId,
                                  );
                                }
                              }}
                              onPointerCancel={(event) => {
                                if (
                                  event.currentTarget.hasPointerCapture(
                                    event.pointerId,
                                  )
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
                            Confirmo que presenciei a retirada e a assinatura do
                            morador.
                          </label>
                          <div className="porter-collection-actions">
                            <button
                              className="porter-primary-button"
                              disabled={
                                savingCollection ||
                                !hasSignature ||
                                !porterConfirmed
                              }
                            >
                              {savingCollection
                                ? "Salvando..."
                                : "Confirmar assinatura e retirada"}
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
                      ) : (
                        <button
                          className="porter-collection-button"
                          onClick={() => openCollection(item)}
                        >
                          Registrar retirada
                        </button>
                      ))}
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
