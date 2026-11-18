/**
 * Caminho antigo (Gemini), mantido atrás da flag OCR_ENGINE=gemini para
 * comparação A/B. Não é o padrão: o pipeline novo usa Vision + regras + Groq.
 */

import { carrierValues } from "./carrier.ts";

const responseSchema = {
  type: "OBJECT",
  properties: {
    recipient_name: { type: "STRING" },
    unit_number: { type: "STRING" },
    block_name: { type: "STRING" },
    carrier: {
      type: "STRING",
      enum: [...carrierValues],
      description:
        "Use unknown quando a transportadora ou o código não permitirem identificação segura.",
    },
    tracking_code: { type: "STRING" },
    destination_cep: { type: "STRING" },
    destination_street: { type: "STRING" },
    destination_number: { type: "STRING" },
  },
  required: [
    "recipient_name",
    "unit_number",
    "block_name",
    "carrier",
    "tracking_code",
    "destination_cep",
    "destination_street",
    "destination_number",
  ],
};

function buildPrompt(expectedAddress: {
  cep: string;
  street: string;
  address_number: string;
}) {
  return [
    "Leia esta foto de etiqueta de encomenda brasileira.",
    "Extraia SOMENTE os dados do DESTINATÁRIO. Ignore remetente, vendedor, transportadora emitente, código de acesso da NF-e, pedido e dados fiscais.",
    'unit_number é só o número da unidade (ex.: "901", "102B", "Cobertura 1"). block_name é o bloco/torre (ex.: "A", "Bloco 2").',
    "destination_cep deve conter somente dígitos. Se a etiqueta mostrar o endereço em duas linhas, junte rua e número.",
    `Endereço do condomínio que está recebendo (referência para a leitura): CEP ${expectedAddress.cep || "não informado"}, logradouro ${expectedAddress.street || "não informado"}, número ${expectedAddress.address_number || "não informado"}.`,
    "Para carrier, escolha somente uma das opções do schema. Use unknown se a transportadora estiver ilegível, ausente ou se o código não permitir identificação segura.",
    "Padrões de código de rastreio:",
    "- Correios: 2 letras + 9 dígitos + BR;",
    "- Amazon: TBR + 9 dígitos, ou AMZC + 9 dígitos + 2 letras;",
    "- Shopee: BR + 12 dígitos + 1 letra ou dígito, totalizando 15 caracteres;",
    "- Anjun: AJ + 15 dígitos;",
    "- J&T Express: 15 dígitos, na prática começando com 999 ou 888;",
    "- iMile: 13 ou 14 dígitos;",
    "- Mercado Livre: 11 dígitos.",
    "Os padrões de J&T Express, iMile e Mercado Livre são fracos: na dúvida, prefira unknown a inventar a empresa.",
    "Não invente dados. Campo ilegível fica string vazia; carrier usa unknown.",
  ].join("\n");
}

function stripJsonFence(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

export type GeminiRead = {
  fields: Record<string, unknown> | null;
  durationMs: number;
  error?: string;
  fallback?: boolean;
  status?: number;
};

export async function readWithGemini(
  input: {
    imageBase64: string;
    mimeType: string;
    expectedAddress: { cep: string; street: string; address_number: string };
    apiKey: string;
  },
  timeoutMs: number,
): Promise<GeminiRead> {
  const startedAt = Date.now();
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: buildPrompt(input.expectedAddress) },
                {
                  inlineData: {
                    mimeType: input.mimeType,
                    data: input.imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema,
            maxOutputTokens: 1024,
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return {
        fields: null,
        durationMs: Date.now() - startedAt,
        error: `Vision OCR failed (${response.status}).`,
        fallback: true,
        status: response.status === 429 ? 429 : 502,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      promptFeedback?: { blockReason?: string };
    };
    const raw = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!raw) {
      return {
        fields: null,
        durationMs: Date.now() - startedAt,
        error:
          payload.promptFeedback?.blockReason ??
          "A leitura na nuvem não devolveu conteúdo.",
        fallback: true,
        status: 422,
      };
    }

    return {
      fields: JSON.parse(stripJsonFence(raw)) as Record<string, unknown>,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      fields: null,
      durationMs: Date.now() - startedAt,
      error: timedOut
        ? "A leitura na nuvem excedeu o tempo limite."
        : "Não foi possível falar com a leitura na nuvem.",
      fallback: true,
      status: timedOut ? 504 : 502,
    };
  }
}
