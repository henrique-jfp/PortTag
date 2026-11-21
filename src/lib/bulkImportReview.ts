/**
 * Regras para decidir se um item da importação em massa pode ser salvo.
 *
 * Empresa é opcional: a etiqueta nem sempre informa a transportadora e o
 * recebimento não pode ficar preso por isso. Entregador é obrigatório, assim
 * como unidade. Endereço divergente ou não confirmado e rastreio repetido
 * exigem aceite explícito do porteiro. O aceite do endereço é único por lote:
 * o porteiro confere fisicamente as etiquetas e responde uma vez, em vez de
 * marcar uma caixa por foto.
 */

export type BulkReviewCheck = {
  unitId: string;
  unitExists: boolean;
  deliveryPerson: string;
  addressStatus: "verified" | "mismatch" | "unknown";
  /** Aceite único do lote; cobre divergência e leitura inconclusiva. */
  addressAcknowledged: boolean;
  /** Já existe no condomínio (pré-checagem) ou repetido na própria fila. */
  duplicate: boolean;
  allowDuplicate: boolean;
};

export function bulkReviewReasons(check: BulkReviewCheck): string[] {
  const reasons: string[] = [];

  if (!check.unitId || !check.unitExists) reasons.push("apartamento");
  if (!check.deliveryPerson.trim()) reasons.push("entregador");
  if (check.addressStatus !== "verified" && !check.addressAcknowledged) {
    reasons.push(
      check.addressStatus === "mismatch"
        ? "endereço divergente"
        : "endereço não confirmado",
    );
  }
  if (check.duplicate && !check.allowDuplicate) {
    reasons.push("rastreio repetido");
  }

  return reasons;
}

/** Comparação usada no banco: caixa alta, sem espaços nas pontas. */
export function normalizeTrackingCode(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

/**
 * Ids das fotos cujo rastreio aparece mais de uma vez na mesma fila. A
 * pré-checagem do banco só enxerga o que já foi gravado; esta função cobre o
 * caso de duas fotos do mesmo volume enviadas juntas.
 */
export function duplicateTrackingIds(
  items: Array<{ id: string; trackingCode: string | null | undefined }>,
) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const code = normalizeTrackingCode(item.trackingCode);
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  const duplicated = new Set<string>();
  for (const item of items) {
    const code = normalizeTrackingCode(item.trackingCode);
    if (code && (counts.get(code) ?? 0) > 1) duplicated.add(item.id);
  }
  return duplicated;
}
