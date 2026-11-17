import { describe, expect, it } from "vitest";
import { bulkReviewReasons, isDuplicateBulkMessage } from "./bulkImportReview";

const saved = {
  unitId: "unit-1",
  unitExists: true,
  deliveryPerson: "Carlos",
  addressStatus: "verified" as const,
  acknowledged: false,
  duplicateMessage: false,
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
      bulkReviewReasons({ ...withMismatch, acknowledged: true }),
    ).toEqual([]);
  });

  it("endereço inconclusivo não trava o recebimento", () => {
    expect(
      bulkReviewReasons({ ...saved, addressStatus: "unknown" }),
    ).toEqual([]);
  });

  it("exige aceite para rastreio repetido", () => {
    const duplicate = { ...saved, duplicateMessage: true };

    expect(bulkReviewReasons(duplicate)).toEqual(["rastreio repetido"]);
    expect(bulkReviewReasons({ ...duplicate, allowDuplicate: true })).toEqual(
      [],
    );
    expect(isDuplicateBulkMessage("Já existe uma encomenda com o rastreio X"))
      .toBe(true);
    expect(isDuplicateBulkMessage("Confira antes de salvar")).toBe(false);
  });
});
