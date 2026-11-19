import { fetchActiveLabelRules } from "../extract-package-label/activeRules.ts";
import { buildAddressReason, decideAddressStatus } from "../extract-package-label/address.ts";
import { carrierForLabel } from "../extract-package-label/carrier.ts";
import { grounded } from "../extract-package-label/grounding.ts";
import { aiFields, interpretWithGroq } from "../extract-package-label/groq.ts";
import { parseLabel, type ParsedLabel } from "../extract-package-label/parser.ts";
import { readLabelText, visionConfig, visionConfigDebug } from "../extract-package-label/vision.ts";

/**
 * Laboratório de etiquetas. Usa EXATAMENTE o pipeline da função de produção
 * (Vision → regras → Groq ancorado), mas não grava nada e não exige sessão de
 * porteiro. É protegido por x-label-lab-secret e serve para mapear novos
 * modelos de etiqueta antes de colocá-los em produção.
 */

type LabImage = {
  name: string;
  imageBase64: string;
  mimeType: string;
};

type LabRequest = {
  images: LabImage[];
  expectedAddress?: {
    cep?: string;
    street?: string;
    address_number?: string;
  };
  suggest?: boolean;
};

type Suggestion = {
  field: string;
  pattern: string;
  reason: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-label-lab-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const acceptedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumBase64Length = 2_800_000;
const maximumImagesPerRequest = 6;
const visionTimeoutMs = 6_500;
const groqMaxTimeoutMs = 2_500;
const suggestionFields = new Set([
  "carrier",
  "tracking_code",
  "unit_number",
  "recipient_name",
]);

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function cleanText(value: unknown, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function digitsOnly(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "").slice(0, 8) : "";
}

function labelFrom(parsed: ParsedLabel, expectedAddress: {
  cep: string;
  street: string;
  address_number: string;
}) {
  const destination = {
    cep: digitsOnly(parsed.destination_cep),
    street: cleanText(parsed.destination_street, 160),
    number: cleanText(parsed.destination_number, 20),
  };
  const status = decideAddressStatus(destination, expectedAddress);
  return {
    label: {
      recipient_name: cleanText(parsed.recipient_name, 120),
      unit_number: cleanText(parsed.unit_number, 30),
      block_name: cleanText(parsed.block_name, 40),
      carrier: carrierForLabel(parsed.carrier),
      tracking_code: cleanText(parsed.tracking_code, 80).replace(/\s+/g, ""),
      destination_cep: destination.cep,
      destination_street: destination.street,
      destination_number: destination.number,
      address_status: status,
      address_reason: buildAddressReason(status, destination, expectedAddress),
    },
    status,
  };
}

function stripCodeFence(text: string) {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

async function suggestPatterns(
  ocrText: string,
  fields: ParsedLabel,
  apiKey: string,
): Promise<Suggestion[]> {
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
          max_tokens: 500,
          response_format: { type: "json_object" },
          reasoning_effort: "low",
          messages: [
            {
              role: "system",
              content: [
                "Você ajuda a mapear novos modelos de etiqueta de entrega.",
                "Proponha expressões regulares curtas e específicas para campos que o parser não conseguiu ler.",
                "Campos permitidos: carrier, tracking_code, unit_number, recipient_name.",
                "NUNCA proponha regras para CEP, rua ou número: esses campos são decididos por código determinístico.",
                "Cada regex precisa casar com um trecho REAL do texto OCR fornecido.",
                "Responda apenas JSON: {\"suggestions\":[{\"field\":\"\",\"pattern\":\"\",\"reason\":\"\"}]}.",
                "No máximo 3 sugestões. Se não houver algo confiável, devolva suggestions vazio.",
              ].join("\n"),
            },
            {
              role: "user",
              content: [
                "Texto OCR:",
                "<<<",
                ocrText.slice(0, 3000),
                ">>>",
                "Campos já lidos:",
                JSON.stringify(fields),
                "Campos vazios:",
                JSON.stringify(
                  [...aiFields].filter(
                    (field) => !String((fields as Record<string, unknown>)[field] ?? ""),
                  ),
                ),
              ].join("\n"),
            },
          ],
        }),
        signal: AbortSignal.timeout(groqMaxTimeoutMs),
      },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(stripCodeFence(content)) as {
      suggestions?: Array<Partial<Suggestion>>;
    };
    const valid: Suggestion[] = [];
    for (const item of parsed.suggestions ?? []) {
      if (
        typeof item.field !== "string" ||
        !suggestionFields.has(item.field) ||
        typeof item.pattern !== "string" ||
        item.pattern.length < 4 ||
        item.pattern.length > 160
      ) {
        continue;
      }
      try {
        const regex = new RegExp(item.pattern, "i");
        if (!regex.test(ocrText)) continue;
        valid.push({
          field: item.field,
          pattern: item.pattern,
          reason: cleanText(item.reason, 160),
        });
      } catch {
        // Regex inválida proposta pela IA é descartada.
      }
      if (valid.length >= 3) break;
    }
    return valid;
  } catch {
    return [];
  }
}

async function analyzeImage(
  image: LabImage,
  options: {
    vision: NonNullable<ReturnType<typeof visionConfig>>;
    expectedAddress: { cep: string; street: string; address_number: string };
    groqKey: string;
    suggest: boolean;
  },
): Promise<Record<string, unknown>> {
  const name = cleanText(image.name, 120) || "etiqueta";
  const mimeType = image.mimeType ?? "";
  if (!acceptedMimeTypes.has(mimeType)) {
    return { name, ok: false, error: "Formato não suportado. Use JPEG, PNG ou WEBP." };
  }
  const imageBase64 = (image.imageBase64 ?? "").replace(
    /^data:[^;]+;base64,/,
    "",
  );
  if (!imageBase64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(imageBase64)) {
    return { name, ok: false, error: "Imagem inválida." };
  }
  if (imageBase64.length > maximumBase64Length) {
    return { name, ok: false, error: "Imagem grande demais. Reduza para até 2 MB." };
  }

  try {
    const read = await readLabelText(imageBase64, options.vision, visionTimeoutMs);
    const ocrText = read.text;
    // A Análise da Central usa exatamente as regras que estão valendo no
    // recebimento; a RPC é pública e tem fallback para o parser embutido.
    const activeRules = await fetchActiveLabelRules();
    const rules = parseLabel(ocrText, activeRules);

    const needsAi =
      ocrText.length >= 20 &&
      Boolean(options.groqKey) &&
      (!rules.recipient_name ||
        !rules.unit_number ||
        !rules.destination_cep ||
        !rules.destination_street);

    const final: ParsedLabel = { ...rules };
    const aiUsed: string[] = [];
    let aiMs = 0;
    let aiError = "";
    if (needsAi) {
      const ai = await interpretWithGroq(
        ocrText,
        options.groqKey,
        groqMaxTimeoutMs,
      );
      aiMs = ai.durationMs;
      if (ai.fields) {
        for (const field of aiFields) {
          const value = ai.fields[field];
          if (value && grounded(field, value, ocrText) !== false) {
            final[field] = value;
            aiUsed.push(field);
          }
        }
      } else {
        aiError = ai.error ?? "Falha na IA";
      }
    }

    // Rastreio e transportadora são sempre das regras, nunca da IA.
    final.tracking_code = rules.tracking_code;
    final.carrier = rules.carrier;

    const result = labelFrom(final, options.expectedAddress);
    const suggestions =
      options.suggest && options.groqKey
        ? await suggestPatterns(ocrText, final, options.groqKey)
        : [];

    return {
      name,
      ok: true,
      ocrText: ocrText.slice(0, 3000),
      fields: result.label,
      addressStatus: result.status,
      diagnostics: {
        engine: needsAi ? "vision+regras+groq" : "vision+regras",
        ocrMs: read.durationMs,
        ocrWords: read.words,
        ocrChars: ocrText.length,
        aiUsed,
        aiMs,
        ...(aiError ? { aiError } : {}),
      },
      suggestions,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const configuredSecret = Deno.env.get("LABEL_LAB_SECRET");
  const providedSecret = request.headers.get("x-label-lab-secret");
  if (!configuredSecret || providedSecret !== configuredSecret) {
    return respond({ error: "Não autorizado." }, 401);
  }

  let input: LabRequest;
  try {
    input = await request.json();
  } catch {
    return respond({ error: "Corpo da solicitação inválido." }, 400);
  }

  const images = Array.isArray(input.images) ? input.images : [];
  if (!images.length || images.length > maximumImagesPerRequest) {
    return respond(
      { error: `Envie de 1 a ${maximumImagesPerRequest} imagens por chamada.` },
      400,
    );
  }

  const vision = visionConfig();
  if (!vision) {
    console.error("label-lab: credencial da Vision ausente", visionConfigDebug());
    return respond({ error: "Vision OCR not configured" }, 503);
  }

  const expectedAddress = {
    cep: cleanText(input.expectedAddress?.cep, 9),
    street: cleanText(input.expectedAddress?.street, 160),
    address_number: cleanText(input.expectedAddress?.address_number, 20),
  };
  const groqKey = (Deno.env.get("GROQ_API_KEY") ?? "").trim();

  const results = await Promise.all(
    images.map((image) =>
      analyzeImage(image, {
        vision,
        expectedAddress,
        groqKey,
        suggest: input.suggest !== false,
      }),
    ),
  );
  return respond({ results });
});
