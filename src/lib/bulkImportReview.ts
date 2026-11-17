/**
 * Regras para decidir se um item da importação em massa pode ser salvo.
 *
 * Empresa é opcional: a etiqueta nem sempre informa a transportadora e o
 * recebimento não pode ficar preso por isso. Entregador é obrigatório, assim
 * como unidade. Endereço divergente e rastreio repetido exigem aceite
 * explícito do porteiro.
 */

export type BulkReviewCheck = {
  unitId: string;
  unitExists: boolean;
  deliveryPerson: string;
  addressStatus: "verified" | "mismatch" | "unknown";
  acknowledged: boolean;
  duplicateMessage: boolean;
  allowDuplicate: boolean;
};

export function bulkReviewReasons(check: BulkReviewCheck): string[] {
  const reasons: string[] = [];

  if (!check.unitId || !check.unitExists) reasons.push("apartamento");
  if (!check.deliveryPerson.trim()) reasons.push("entregador");
  if (check.addressStatus === "mismatch" && !check.acknowledged) {
    reasons.push("endereço divergente");
  }
  if (check.duplicateMessage && !check.allowDuplicate) {
    reasons.push("rastreio repetido");
  }

  return reasons;
}

export function isDuplicateBulkMessage(message: string) {
  return message.startsWith("Já existe uma encomenda");
}
