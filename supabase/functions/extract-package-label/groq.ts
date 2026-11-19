/**
 * Interpretação do TEXTO do OCR pelo Groq — segundo voto, usado só nas
 * exceções. O prompt não recebe o endereço do condomínio nem a imagem: a
 * checagem de endereço continua determinística em address.ts.
 */

import type { ParsedLabel } from "./parser.ts";

const systemPrompt = [
  "Você extrai campos de etiquetas de encomenda brasileiras a partir do TEXTO de OCR.",
  "Responda SOMENTE com um objeto JSON.",
  "Regras:",
  "- Extraia apenas os dados do DESTINATÁRIO. Ignore remetente, vendedor, transportadora emitente, NF-e, pedido e dados fiscais.",
  "- Use exclusivamente o texto fornecido. Não invente, não complete com conhecimento externo, não corrija nomes ou endereços por conta própria.",
  "- Campo ausente ou ilegível fica string vazia.",
  '- unit_number é só o número da unidade (ex.: "901", "102B", "Cobertura 1"). block_name é o bloco/torre (ex.: "A", "Bloco 2").',
  "- destination_cep deve conter somente dígitos.",
  "- destination_street é o logradouro, sem o número. destination_number é o número do imóvel.",
  '- carrier deve ser uma destas opções: "Correios", "Amazon", "Shopee", "Anjun", "J&T Express", "iMile", "Mercado Livre", "Jadlog", "Total Express", "Shippify", "unknown".',
  "- Só identifique a transportadora pelo nome impresso ou pelo formato do rastreio. Na dúvida, use \"unknown\".",
  "- Se o texto tiver mais de um endereço (remetente e destinatário), escolha o do destinatário.",
].join("\n");

const asText = (value: unknown, maxLength: number) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";

export type GroqFields = Pick<
  ParsedLabel,
  | "recipient_name"
  | "unit_number"
  | "block_name"
  | "destination_cep"
  | "destination_street"
  | "destination_number"
>;

export type GroqResult = {
  fields: GroqFields | null;
  durationMs: number;
  error?: string;
};

/** Campos em que a IA pode substituir o parser, sempre com ancoragem no OCR. */
export const aiFields: Array<keyof GroqFields> = [
  "recipient_name",
  "unit_number",
  "block_name",
  "destination_cep",
  "destination_street",
  "destination_number",
];

export async function interpretWithGroq(
  ocrText: string,
  apiKey: string,
  timeoutMs: number,
): Promise<GroqResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b",
          temperature: 0,
          // São 8 campos curtos; 1500 tokens só alongava a exceção.
          max_tokens: 400,
          response_format: { type: "json_object" },
          reasoning_effort: "low",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                "Texto do OCR da etiqueta:",
                "<<<",
                ocrText,
                ">>>",
                "",
                "Devolva JSON com exatamente estas chaves:",
                '{"recipient_name":"","unit_number":"","block_name":"","carrier":"unknown","tracking_code":"","destination_cep":"","destination_street":"","destination_number":""}',
              ].join("\n"),
            },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = (payload as { error?: { message?: string } })?.error
        ?.message;
      throw new Error(
        `Groq respondeu ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    const content = (payload as {
      choices?: Array<{ message?: { content?: string } }>;
    }).choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq não devolveu conteúdo.");

    const fenced = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const raw = JSON.parse(fenced ? fenced[1] : content) as Record<
      string,
      unknown
    >;
    return {
      fields: {
        recipient_name: asText(raw.recipient_name, 120),
        unit_number: asText(raw.unit_number, 30),
        block_name: asText(raw.block_name, 40),
        destination_cep: asText(raw.destination_cep, 20)
          .replace(/\D/g, "")
          .slice(0, 8),
        destination_street: asText(raw.destination_street, 160),
        destination_number: asText(raw.destination_number, 20),
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      fields: null,
      durationMs: Date.now() - startedAt,
      error:
        error instanceof Error ? error.message.slice(0, 200) : "Falha no Groq.",
    };
  }
}
