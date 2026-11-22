import { describe, expect, it } from "vitest";
import {
  burstConfirmationLabel,
  burstDeliveryLabel,
  burstIssues,
  suggestBurstUnit,
  type BurstValidationInput,
} from "./burstReception";

const verified = { status: "verified" as const, message: "Endereço conferido." };

function validInput(): BurstValidationInput {
  return {
    address: verified,
    addressAcknowledged: false,
    unitId: "u1",
    unitExists: true,
    readUnitNumber: "102",
    trackingCode: "BR123",
    duplicated: false,
    carrier: "Shopee",
    deliveryPerson: "João",
  };
}

describe("validação da rajada", () => {
  it("não aponta problema quando a leitura está íntegra", () => {
    expect(burstIssues(validInput())).toEqual([]);
  });

  it("bloqueia endereço divergente e leitura inconclusiva até o aceite", () => {
    const mismatch = burstIssues({
      ...validInput(),
      address: { status: "mismatch", message: "Outro CEP" },
    });
    expect(mismatch[0].message).toContain("outro condomínio");
    expect(
      burstIssues({
        ...validInput(),
        address: { status: "unknown", message: "Sem CEP" },
        addressAcknowledged: true,
      }),
    ).toEqual([]);
  });

  it("aponta cada campo ausente ou repetido", () => {
    const issues = burstIssues({
      ...validInput(),
      address: null,
      unitId: "",
      trackingCode: "  ",
      duplicated: true,
      carrier: "",
      deliveryPerson: "",
    });
    expect(issues.map((issue) => issue.code)).toEqual([
      "address",
      "unit",
      "tracking",
      "carrier",
      "delivery",
    ]);
  });

  it("mostra o número lido quando o apartamento não existe", () => {
    expect(
      burstIssues({
        ...validInput(),
        unitId: "",
        readUnitNumber: "1002",
      })[0].message,
    ).toContain("1002");
  });
});

describe("sugestão de unidade por nome", () => {
  const units = [
    { id: "u1", unit_number: "102" },
    { id: "u2", unit_number: "402" },
  ];
  const residents = [
    { unit_id: "u1", name: "Maria de Souza" },
    { unit_id: "u2", name: "João Silva" },
  ];

  it("usa o número quando ele existe no cadastro", () => {
    expect(
      suggestBurstUnit({
        recipientName: "Maria Souza",
        readUnitNumber: "402",
        units,
        residents,
      }),
    ).toMatchObject({ unitId: "u2" });
  });

  it("cruza o nome do destinatário com os moradores", () => {
    expect(
      suggestBurstUnit({
        recipientName: "MARIA SOUZA",
        readUnitNumber: "10O2",
        units,
        residents,
      }),
    ).toMatchObject({ unitId: "u1" });
  });

  it("não inventa unidade quando o nome não confere", () => {
    expect(
      suggestBurstUnit({
        recipientName: "Pedro Oliveira",
        readUnitNumber: "999",
        units,
        residents,
      }),
    ).toBeNull();
  });
});

describe("textos da confirmação", () => {
  it("junta entregador, nome e documento", () => {
    expect(
      burstDeliveryLabel({ name: "João", document: "123" }),
    ).toBe("João · 123");
    expect(burstDeliveryLabel({ name: "", document: "123" })).toBe("123");
  });

  it("mostra os dados conferidos em uma linha", () => {
    expect(
      burstConfirmationLabel({
        blockName: "B",
        unitNumber: "102",
        recipientName: "Maria Souza",
        carrier: "Shopee",
      }),
    ).toBe("Bloco B — Apto 102 — Maria Souza — Shopee");
  });
});
