import { describe, expect, it } from "vitest";
import {
  hasReceptionDraftContent,
  type ReceptionDraft,
} from "./receptionDraft";

function emptyDraft(): ReceptionDraft {
  return {
    savedAt: Date.now(),
    condominiumId: "condo-1",
    activeView: "home",
    labelPhoto: "",
    unitId: "",
    unitCandidates: [],
    recipientName: "",
    recipientNameDetected: false,
    recipientIsResident: false,
    company: "",
    deliveryPerson: "",
    trackingCode: "",
    trackingCodeDetected: false,
    addressVerification: null,
    lastLabelRead: null,
    ocrMessage: "",
    mismatchAcknowledged: false,
    notifyOnReceive: false,
    duplicateWarning: "",
    isDamaged: false,
    damagePhoto: "",
    collectionBaseId: "",
    collectionSelectionOverride: null,
    collectionName: "",
    porterConfirmed: false,
    hasSignature: false,
    signature: "",
  };
}

describe("hasReceptionDraftContent", () => {
  it("ignora um rascunho criado apenas pelo autosave ao abrir a tela", () => {
    expect(hasReceptionDraftContent(emptyDraft())).toBe(false);
  });

  it("considera a unidade lida sem correspondência no cadastro", () => {
    const draft = emptyDraft();
    draft.readUnitNumber = "307";

    expect(hasReceptionDraftContent(draft)).toBe(true);
  });

  it("considera uma foto já capturada mesmo antes da leitura", () => {
    const draft = emptyDraft();
    draft.labelPhoto = "data:image/jpeg;base64,AAA";

    expect(hasReceptionDraftContent(draft)).toBe(true);
  });
});
