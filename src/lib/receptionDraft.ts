import type { LabelReadResult } from "./packageLabelOcr";
import type { PackageAddressVerification } from "./packageOcr";

export type DraftView = "home" | "ledger" | "pending";

export type DraftUnit = {
  id: string;
  unit_number: string;
  block_id: string | null;
};

/**
 * Rascunho local do recebimento. Fica apenas no IndexedDB do aparelho e é
 * apagado depois do registro (ou após 24 h). A foto da etiqueta aqui é a já
 * comprimida para leitura; ela nunca vai ao Storage do Supabase.
 */
export type ReceptionDraft = {
  savedAt: number;
  condominiumId: string;
  activeView: DraftView;
  labelPhoto: string;
  unitId: string;
  unitCandidates: DraftUnit[];
  /** Opcional para não invalidar rascunhos salvos antes desta versão. */
  readUnitNumber?: string;
  recipientName: string;
  recipientNameDetected: boolean;
  recipientIsResident: boolean;
  company: string;
  deliveryPerson: string;
  trackingCode: string;
  trackingCodeDetected: boolean;
  addressVerification: PackageAddressVerification | null;
  lastLabelRead: LabelReadResult | null;
  ocrMessage: string;
  mismatchAcknowledged: boolean;
  notifyOnReceive: boolean;
  duplicateWarning: string;
  isDamaged: boolean;
  damagePhoto: string;
  collectionBaseId: string;
  collectionSelectionOverride: string[] | null;
  collectionName: string;
  porterConfirmed: boolean;
  hasSignature: boolean;
  signature: string;
};

/**
 * Um rascunho só vale avisar ao porteiro quando há algo para retomar. O
 * autosave dispara ao abrir a tela; sem esta checagem ele gravava um rascunho
 * vazio e o aviso aparecia em toda abertura do app.
 */
export function hasReceptionDraftContent(draft: ReceptionDraft) {
  return Boolean(
    draft.labelPhoto ||
      draft.damagePhoto ||
      draft.unitId ||
      draft.readUnitNumber ||
      draft.recipientName ||
      draft.company ||
      draft.trackingCode ||
      draft.deliveryPerson ||
      draft.addressVerification ||
      draft.lastLabelRead ||
      draft.ocrMessage ||
      draft.isDamaged ||
      draft.collectionBaseId ||
      draft.collectionSelectionOverride?.length ||
      draft.collectionName ||
      draft.porterConfirmed ||
      draft.hasSignature ||
      draft.notifyOnReceive ||
      draft.duplicateWarning ||
      draft.mismatchAcknowledged ||
      draft.unitCandidates?.length,
  );
}

const DB_NAME = "porttag-reception";
const STORE = "drafts";
const DB_VERSION = 1;
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;

function openDraftsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponível"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function serializeLabelRead(labelRead: LabelReadResult | null) {
  if (!labelRead) return null;
  const error = labelRead.error as
    | { name?: string; message?: string }
    | string
    | null
    | undefined;
  const serializedError =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : typeof error === "string"
        ? error
        : error && typeof error === "object"
          ? { name: error.name ?? "Error", message: error.message ?? "" }
          : undefined;
  return { ...labelRead, error: serializedError };
}

function deserializeLabelRead(labelRead: LabelReadResult | null) {
  if (!labelRead) return null;
  if (!labelRead.error) return labelRead;
  const error = labelRead.error as { name?: string; message?: string } | string;
  if (typeof error === "string") {
    return { ...labelRead, error: new Error(error) };
  }
  const restored = new Error(error.message ?? "Falha no OCR");
  restored.name = error.name ?? "Error";
  return { ...labelRead, error: restored };
}

export async function saveReceptionDraft(draft: ReceptionDraft): Promise<void> {
  try {
    const db = await openDraftsDb();
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(
      { ...draft, lastLabelRead: serializeLabelRead(draft.lastLabelRead) },
      draft.condominiumId,
    );
    await transactionDone(transaction);
    db.close();
  } catch {
    // Rascunho é conveniência: se o aparelho não permitir gravar, o app segue.
  }
}

export async function loadReceptionDraft(
  condominiumId: string,
): Promise<ReceptionDraft | null> {
  try {
    const db = await openDraftsDb();
    const transaction = db.transaction(STORE, "readonly");
    const stored = await requestResult<ReceptionDraft | undefined>(
      transaction.objectStore(STORE).get(condominiumId),
    );
    db.close();
    if (!stored || Date.now() - stored.savedAt > MAX_DRAFT_AGE_MS) return null;
    return {
      ...stored,
      lastLabelRead: deserializeLabelRead(stored.lastLabelRead ?? null),
    };
  } catch {
    return null;
  }
}

export async function clearReceptionDraft(condominiumId: string): Promise<void> {
  try {
    const db = await openDraftsDb();
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(condominiumId);
    await transactionDone(transaction);
    db.close();
  } catch {
    // Nada a fazer se o storage estiver indisponível.
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}
