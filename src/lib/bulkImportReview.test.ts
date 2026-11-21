import { describe, expect, it } from "vitest";
import {
  bulkReviewReasons,
  duplicateTrackingIds,
  normalizeTrackingCode,
} from "./bulkImportReview";

const saved = {
  unitId: "unit-1",
  unitExists: true,
  deliveryPerson: "Carlos",
  addressStatus: "verified" as const,
  addressAcknowledged: false,
  duplicate: false,
  allowDuplicate: false,
};

describe("revisão da importação em massa", () => {
  it("não exige empresa para salvar", () => {
    expect(bulkReviewReasons(saved)).toEqual([]);
  });

  it("pede unidade e entregador quando faltam", () => {
    expect(
      bulkReviewReasons({
        ...saved,
        unitId: "",
        deliveryPerson: "  ",
      }),
    ).toEqual(["apartamento", "entregador"]);
  });

  it("exige aceite para endereço divergente", () => {
    const withMismatch = { ...saved, addressStatus: "mismatch" as const };

    expect(bulkReviewReasons(withMismatch)).toEqual(["endereço divergente"]);
    expect(
      bulkReviewReasons({ ...withMismatch, addressAcknowledged: true }),
    ).toEqual([]);
  });

  it("endereço inconclusivo também depende do aceite do lote", () => {
    const unknown = { ...saved, addressStatus: "unknown" as const };

    expect(bulkReviewReasons(unknown)).toEqual(["endereço não confirmado"]);
    expect(bulkReviewReasons({ ...unknown, addressAcknowledged: true })).toEqual(
      [],
    );
  });

  it("exige aceite para rastreio repetido", () => {
    const duplicate = { ...saved, duplicate: true };

    expect(bulkReviewReasons(duplicate)).toEqual(["rastreio repetido"]);
    expect(bulkReviewReasons({ ...duplicate, allowDuplicate: true })).toEqual(
      [],
    );
  });
});

describe("rastreio na fila", () => {
  it("normaliza caixa e espaços", () => {
    expect(normalizeTrackingCode("  ab123br ")).toBe("AB123BR");
    expect(normalizeTrackingCode(null)).toBe("");
  });

  it("marca todas as fotos com o mesmo rastreio", () => {
    const duplicated = duplicateTrackingIds([
      { id: "a", trackingCode: "AB123BR" },
      { id: "b", trackingCode: " ab123br " },
      { id: "c", trackingCode: "CD456BR" },
      { id: "d", trackingCode: "" },
    ]);

    expect([...duplicated].sort()).toEqual(["a", "b"]);
  });

  it("não marca rastreios vazios", () => {
    expect(
      duplicateTrackingIds([
        { id: "a", trackingCode: "" },
        { id: "b", trackingCode: null },
      ]).size,
    ).toBe(0);
  });
});
