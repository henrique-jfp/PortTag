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
  detectDeliveryCompany,
  extractTrackingCode,
  findResidentUnitCandidates,
  findUnitCandidates,
  preparePackageImage,
  readPackageCodes,
  releasePackageOcr,
  recognizePackageImage,
} from "../lib/packageLabelOcr";
import {
  extractRecipientName,
  verifyPackageDestinationAddress,
  type PackageAddressVerification,
} from "../lib/packageOcr";
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
};

type PorterView = "home" | "ledger" | "pending";

const receiptBucket = "package-receipts";
const maximumImageSize = 10 * 1024 * 1024;
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const packageFields =
  "id, unit_number, block_name, resident_name, recipient_is_resident, sender, delivery_person, tracking_code, received_at, status, collected_at, collected_by_name, collected_signature";

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

export function PorterReception() {
  const { user, signOut } = useAuth();
  const imageInput = useRef<HTMLInputElement>(null);
  const signatureCanvas = useRef<HTMLCanvasElement>(null);
  const signatureHasInk = useRef(false);
  const hasInternalHistory = useRef(false);
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
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [collectionPackageId, setCollectionPackageId] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [porterConfirmed, setPorterConfirmed] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [savingCollection, setSavingCollection] = useState(false);
  const unitDetailsRequest = useRef(0);

  const selectedUnit = useMemo(
    () => units.find((unit) => unit.id === unitId) ?? null,
    [unitId, units],
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
    void releasePackageOcr().catch((error: unknown) => {
      setPageError(
        error instanceof Error
          ? `Não foi possível liberar a memória do leitor de etiquetas. ${error.message}`
          : "Não foi possível liberar a memória do leitor de etiquetas.",
      );
    });
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

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0] ?? null;
    event.target.value = "";
    setPageError("");
    setSuccessMessage("");
    setOcrMessage("");
    setUnitCandidates([]);
    setUnitId("");
    setDeliveryPerson("");
    setCompany("");
    setTrackingCode("");
    setTrackingCodeDetected(false);
    setRecipientName("");
    setRecipientNameDetected(false);
    setRecipientIsResident(false);
    setAddressVerification(null);

    if (!image) return;
    if (!acceptedImageTypes.has(image.type)) {
      setPageError("A foto precisa ser JPG, PNG ou WEBP.");
      return;
    }
    if (image.size > maximumImageSize) {
      setPageError("A foto precisa ter no máximo 10 MB.");
      return;
    }

    setFile(image);
    setPreviewUrl(URL.createObjectURL(image));
    setIsReading(true);
    setOcrMessage("Preparando a foto para leitura...");
    try {
      const preparedImage = await preparePackageImage(image);
      setOcrMessage("Lendo QR e códigos de barras...");
      const [barcodeResult] = await Promise.allSettled([
        readPackageCodes(preparedImage),
      ]);
      const barcodeValues =
        barcodeResult.status === "fulfilled" ? barcodeResult.value : [];
      setOcrMessage("Lendo texto da etiqueta no celular...");
      const [ocrResult] = await Promise.allSettled([
        recognizePackageImage(preparedImage, (status, progress) => {
          setOcrMessage(
            status === "recognizing text"
              ? `Lendo etiqueta no celular... ${Math.round(progress * 100)}%`
              : "Preparando o leitor local de etiquetas...",
          );
        }),
      ]);
      const barcodeText = barcodeValues.join("\n");
      const recognizedText =
        ocrResult.status === "fulfilled" ? ocrResult.value : "";
      const detectedRecipientName = extractRecipientName(
        recognizedText,
        authorizedResidents
          .map((resident) => resident.name?.trim() ?? "")
          .filter(Boolean),
      );
      setRecipientName(detectedRecipientName);
      setRecipientNameDetected(Boolean(detectedRecipientName));
      setRecipientIsResident(false);
      const verification = condominium
        ? verifyPackageDestinationAddress(
            recognizedText,
            condominium,
            authorizedResidents
              .map((resident) => resident.name?.trim() ?? "")
              .filter(Boolean),
          )
        : {
            status: "unknown" as const,
            message:
              "Não foi possível carregar o endereço do condomínio para validar a etiqueta.",
          };
      setAddressVerification(verification);
      const combinedText = `${barcodeText}\n${recognizedText}`;
      const residentCandidates = findResidentUnitCandidates(
        combinedText,
        units,
        authorizedResidents,
      );
      const numberCandidates = findUnitCandidates(combinedText, units);
      const candidates = residentCandidates.length
        ? residentCandidates
        : numberCandidates;
      const code =
        barcodeValues.map(extractTrackingCode).find(Boolean) ||
        extractTrackingCode(recognizedText);
      const detectedCompany = detectDeliveryCompany(
        `${combinedText}\n${code}`,
      );

      setCompany(detectedCompany);
      setUnitCandidates(candidates);
      if (candidates.length === 1) setUnitId(candidates[0].id);
      setTrackingCode(code);
      setTrackingCodeDetected(Boolean(code));

      if (ocrResult.status === "rejected") {
        if (isStorageCapacityError(ocrResult.reason)) {
          setPageError(
            "O celular está sem espaço disponível para processar a etiqueta. Libere espaço e tente novamente.",
          );
          setOcrMessage("Não foi possível concluir o OCR por falta de espaço.");
          return;
        }
        const details =
          ocrResult.reason instanceof Error
            ? ` ${ocrResult.reason.message}`
            : "";
        setOcrMessage(
          code || detectedCompany || candidates.length
            ? "Código da etiqueta lido, mas o texto não foi reconhecido; confira os dados."
            : `Não foi possível ler o texto da etiqueta.${details}`,
        );
        return;
      }

      const detectedFields = [
        detectedRecipientName ? "destinatário" : "",
        candidates.length === 1 ? "apartamento" : "",
        detectedCompany ? "empresa" : "",
        code ? "rastreio" : "",
      ].filter(Boolean);
      setOcrMessage(
        detectedFields.length
          ? `Leitura concluída: ${detectedFields.join(", ")}. Confira os dados.`
          : `O OCR leu ${recognizedText.replace(/\s/g, "").length} caracteres, mas não identificou os campos. Confira as sugestões e tente novamente se necessário.`,
      );
    } catch (error) {
      if (isStorageCapacityError(error)) {
        setPageError(
          "O celular está sem espaço disponível para processar a etiqueta. Libere espaço e tente novamente.",
        );
      }
      setAddressVerification({
        status: "unknown",
        message:
          "Não foi possível confirmar o endereço de destino. Tire outra foto mostrando o logradouro, o número e o CEP.",
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
    if (!user || !account || !file || !selectedUnit) return;
    if (!recipientName.trim()) {
      setPageError("Confira ou informe o nome do destinatário da etiqueta.");
      return;
    }
    if (addressVerification?.status !== "verified") {
      setPageError(
        addressVerification?.message ??
          "O endereço de destino precisa ser confirmado antes do recebimento.",
      );
      return;
    }

    setPageError("");
    setSuccessMessage("");
    setIsSaving(true);
    const path = `${account.condominium_id}/${selectedUnit.block_id ?? "no-block"}/${user.id}/${crypto.randomUUID()}.${imageExtension(file)}`;

    try {
      await releasePackageOcr();
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

      const { error: createError } = await supabase.rpc("create_package", {
        p_condominium_id: account.condominium_id,
        p_unit_id: selectedUnit.id,
        p_receipt_path: path,
        p_sender: company.trim(),
        p_delivery_person: deliveryPerson.trim(),
        p_tracking_code: trackingCode.trim() || null,
        p_resident_name: recipientName.trim(),
        p_recipient_is_resident: recipientIsResident,
      });

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

      setSuccessMessage(`Encomenda registrada para o apartamento ${selectedUnit.unit_number}.`);
      setFile(null);
      setPreviewUrl("");
      setUnitId("");
      setUnitCandidates([]);
      setCompany("");
      setDeliveryPerson("");
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
        p_resident_signature: canvas.toDataURL("image/png"),
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
    context.lineWidth = 6;
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
    setOcrMessage("");
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
                    {isReading ? "Analisando no celular..." : ocrMessage}
                  </p>
                  {addressVerification && !isReading && (
                    <p
                      className={`porter-address-check porter-address-check-${addressVerification.status}`}
                      role={
                        addressVerification.status === "verified"
                          ? "status"
                          : "alert"
                      }
                    >
                      {addressVerification.message}
                    </p>
                  )}

                  {!isReading && (
                    <form className="porter-form" onSubmit={handleReceive}>
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

                      <button
                        className="porter-primary-button"
                        disabled={
                          isSaving ||
                          !unitId ||
                          addressVerification?.status !== "verified"
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
                              width={720}
                              height={720}
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
