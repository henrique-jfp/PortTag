import { normalizeTrackingCode } from "./bulkImportReview";
import type { PackageAddressVerification } from "./packageOcr";

/**
 * Regras do recebimento em rajada. Ficam puras para poderem ser testadas sem
 * navegador e para que a tela de exceção mostre exatamente o que faltou.
 */

export type BurstDeliveryPerson = {
  name: string;
  document: string;
};

export function burstDeliveryLabel(person: BurstDeliveryPerson | null | undefined) {
  if (!person) return "";
  return [person.name.trim(), person.document.trim()].filter(Boolean).join(" · ");
}

export type BurstIssueCode =
  | "address"
  | "unit"
  | "tracking"
  | "carrier"
  | "delivery";

export type BurstIssue = {
  code: BurstIssueCode;
  field:
    | "address"
    | "unitId"
    | "trackingCode"
    | "company"
    | "deliveryPerson";
  message: string;
};

export type BurstValidationInput = {
  address: PackageAddressVerification | null;
  addressAcknowledged: boolean;
  unitId: string;
  unitExists: boolean;
  readUnitNumber?: string;
  trackingCode: string;
  /** Já registrado no condomínio ou repetido dentro do mesmo lote. */
  duplicated: boolean;
  carrier: string;
  deliveryPerson: string;
};

/**
 * A decisão de endereço continua sendo a determinística de `packageOcr`.
 * Aqui só traduzimos o resultado: divergência ou leitura inconclusiva travam
 * o caminho rápido e exigem conferência explícita do porteiro.
 */
export function burstIssues(input: BurstValidationInput): BurstIssue[] {
  const issues: BurstIssue[] = [];

  if (!input.addressAcknowledged) {
    if (input.address?.status === "mismatch") {
      issues.push({
        code: "address",
        field: "address",
        message: "Atenção: Endereço pertence a outro condomínio.",
      });
    } else if (input.address?.status !== "verified") {
      issues.push({
        code: "address",
        field: "address",
        message: "Atenção: Não foi possível confirmar o endereço da etiqueta.",
      });
    }
  }

  if (!input.unitId || !input.unitExists) {
    const number = input.readUnitNumber?.trim();
    issues.push({
      code: "unit",
      field: "unitId",
      message: number
        ? `Apartamento ${number} não existe neste prédio.`
        : "Não foi possível ler o apartamento da etiqueta.",
    });
  }

  if (!normalizeTrackingCode(input.trackingCode)) {
    issues.push({
      code: "tracking",
      field: "trackingCode",
      message: "Não foi possível ler o código de rastreio.",
    });
  } else if (input.duplicated) {
    issues.push({
      code: "tracking",
      field: "trackingCode",
      message: "Atenção: Este código de rastreio já foi registrado.",
    });
  }

  if (!input.carrier.trim()) {
    issues.push({
      code: "carrier",
      field: "company",
      message: "Não foi possível identificar a transportadora.",
    });
  }

  if (!input.deliveryPerson.trim()) {
    issues.push({
      code: "delivery",
      field: "deliveryPerson",
      message: "Informe o entregador desta encomenda.",
    });
  }

  return issues;
}

function nameKey(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Quando o número lido não existe no cadastro, o nome do destinatário ajuda a
 * encontrar a unidade provável. A sugestão nunca é aplicada sozinha: o
 * porteiro confirma com um toque na tela de exceção.
 */
export function suggestBurstUnit<
  T extends { id: string; unit_number: string },
  R extends { unit_id: string; name: string | null },
>(input: {
  recipientName: string;
  readUnitNumber?: string;
  units: T[];
  residents: R[];
}): { unitId: string; reason: string } | null {
  const readNumber = nameKey(input.readUnitNumber);
  const byNumber = input.units.filter(
    (unit) => nameKey(unit.unit_number) === readNumber,
  );
  if (byNumber.length === 1) {
    return {
      unitId: byNumber[0].id,
      reason: "Número conferido com o cadastro do condomínio.",
    };
  }

  const recipient = nameKey(input.recipientName);
  if (!recipient) return null;

  const tokens = recipient.split(" ").filter((part) => part.length > 1);
  if (!tokens.length) return null;

  const matches = input.residents.filter((resident) => {
    const name = nameKey(resident.name);
    if (!name) return false;
    return tokens.every((token) => name.includes(token));
  });

  const unitsFromName = new Map<string, number>();
  for (const resident of matches) {
    unitsFromName.set(
      resident.unit_id,
      (unitsFromName.get(resident.unit_id) ?? 0) + 1,
    );
  }
  const ranked = Array.from(unitsFromName.entries()).sort(
    (left, right) => right[1] - left[1],
  );
  const unitId = ranked.find(([id]) =>
    input.units.some((unit) => unit.id === id),
  )?.[0];
  if (!unitId) return null;

  return {
    unitId,
    reason: `Nome "${input.recipientName.trim()}" encontrado no cadastro. Confira antes de continuar.`,
  };
}

export type BurstConfirmation = {
  blockName: string | null;
  unitNumber: string;
  recipientName: string;
  carrier: string;
};

export function burstConfirmationLabel(item: BurstConfirmation) {
  return [
    item.blockName ? `Bloco ${item.blockName}` : null,
    `Apto ${item.unitNumber}`,
    item.recipientName.trim() || null,
    item.carrier.trim() || null,
  ]
    .filter(Boolean)
    .join(" — ");
}
