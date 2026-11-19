import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AiLabelAddressStatus,
  CompressedPackagePhoto,
} from "./packageLabelOcr";

/**
 * Critérios determinísticos de coleta para o Label Lab. Esta decisão roda no
 * aparelho, depois do OCR, e nunca substitui a leitura: ela apenas responde se
 * aquela etiqueta merece uma segunda análise no laboratório.
 *
 * Nada aqui usa IA, não há limiar ajustável por transportadora e nenhum resultado
 * altera o que o porteiro vê. As razões "leves" (empresa/rastreio em branco)
 * sozinhas não disparam coleta: há etiqueta que simplesmente não imprime esses
 * campos, e guardar todas elas seria excesso de dados pessoais.
 */
export type LabelSampleReason =
  | "recipient-missing"
  | "unit-missing"
  | "unit-conflict"
  | "address-unknown"
  | "address-mismatch"
  | "short-ocr"
  | "ai-error"
  | "ai-skipped"
  | "carrier-missing"
  | "tracking-missing";

export type LabelSampleInput = {
  carrier: string;
  trackingCode: string;
  recipientName: string;
  unitNumber: string;
  unitCandidateCount: number;
  addressStatus: AiLabelAddressStatus;
  ocrChars: number;
  ocrText: string;
  aiUsed?: string[];
  aiError?: string;
  aiSkipped?: string;
};

export type LabelSample = LabelSampleInput & {
  condominiumId: string;
  reasons: LabelSampleReason[];
};

export type LabelSampleDecision = {
  collect: boolean;
  reasons: LabelSampleReason[];
};

/** Mesmo piso usado pela Edge Function para decidir se a IA entra na leitura. */
export const minimumOcrChars = 20;

export function decideLabelSample(input: LabelSampleInput): LabelSampleDecision {
  const ocrText = input.ocrText.trim();
  const ocrChars =
    Number.isFinite(input.ocrChars) && input.ocrChars > 0
      ? input.ocrChars
      : ocrText.replace(/\s/g, "").length;

  const gaps: LabelSampleReason[] = [];
  if (!input.recipientName.trim()) gaps.push("recipient-missing");
  if (!input.unitNumber.trim()) gaps.push("unit-missing");
  if (input.unitCandidateCount > 1) gaps.push("unit-conflict");
  if (input.addressStatus === "unknown") gaps.push("address-unknown");
  if (input.addressStatus === "mismatch") gaps.push("address-mismatch");

  const quality: LabelSampleReason[] = [];
  if (!ocrText || ocrChars < minimumOcrChars) quality.push("short-ocr");
  if (input.aiError?.trim()) quality.push("ai-error");
  // IA ignorada sem lacunas é o caso normal: as regras já leram tudo.
  if (input.aiSkipped?.trim() && gaps.length > 0) {
    quality.push("ai-skipped");
  }

  const collect = gaps.length > 0 || quality.length > 0;
  if (!collect) return { collect: false, reasons: [] };

  const soft: LabelSampleReason[] = [];
  if (!input.carrier.trim()) soft.push("carrier-missing");
  if (!input.trackingCode.trim()) soft.push("tracking-missing");

  return { collect: true, reasons: [...gaps, ...quality, ...soft] };
}

type CollectLabelSampleInput = {
  /** Cliente autenticado do app; nunca service_role. */
  client: SupabaseClient;
  sample: LabelSample;
  /** JPEG já comprimido para o OCR — não existe segunda leitura nem compressão. */
  compressed: CompressedPackagePhoto;
};

/**
 * Envia a amostra para a Edge Function, que persiste a tarefa e faz o upload.
 * O chamador dispara sem `await`: falha de rede ou do laboratório nunca
 * interfere no recebimento. Se a aba fechar, a tarefa já persistida continua.
 */
export async function maybeCollectLabelSample(
  input: CollectLabelSampleInput,
): Promise<boolean> {
  const { client, sample, compressed } = input;
  if (!sample.condominiumId || !compressed.base64 || !sample.reasons.length) {
    return false;
  }

  const ocrChars = sample.ocrText
    ? sample.ocrText.replace(/\s/g, "").length
    : 0;
  const { error } = await client.functions.invoke("collect-label-sample", {
    body: {
      condominiumId: sample.condominiumId,
      imageBase64: compressed.base64,
      mimeType: compressed.mimeType,
      reasons: sample.reasons,
      carrierDetected: sample.carrier.trim().slice(0, 80) || null,
      trackingCode: sample.trackingCode.trim().slice(0, 80) || null,
      ocrText: sample.ocrText.slice(0, 3000) || null,
      parsedResult: {
        recipient_name: sample.recipientName.trim().slice(0, 200) || null,
        unit_number: sample.unitNumber.trim().slice(0, 40) || null,
        unit_candidates: sample.unitCandidateCount,
        carrier: sample.carrier.trim().slice(0, 80) || null,
        tracking_code: sample.trackingCode.trim().slice(0, 80) || null,
        address_status: sample.addressStatus,
      },
      confidenceStatus: {
        ocr_chars: ocrChars,
        ai_used: sample.aiUsed ?? [],
        ai_error: sample.aiError?.trim().slice(0, 240) || null,
        ai_skipped: sample.aiSkipped?.trim().slice(0, 240) || null,
      },
    },
  });
  if (error) throw error;
  return true;
}
