import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildAddressReason, decideAddressStatus } from "./address.ts";
import { carrierForLabel } from "./carrier.ts";
import { grounded } from "./grounding.ts";
import { readWithGemini } from "./gemini.ts";
import { aiFields, interpretWithGroq } from "./groq.ts";
import { parseLabel, type ParsedLabel } from "./parser.ts";
import { readLabelText, visionConfig, visionConfigDebug } from "./vision.ts";

type ExtractLabelRequest = {
  condominiumId?: string;
  imageBase64?: string;
  mimeType?: string;
  expectedAddress?: {
    cep?: string;
    street?: string;
    address_number?: string;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function isUuid(value: string) {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function cleanText(value: unknown, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function digitsOnly(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "").slice(0, 8) : "";
}

const acceptedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
// ~2 MB em binário viram ~2,7 MB em base64. Acima disso a foto não é de uma
// etiqueta: é engano do cliente ou tentativa de abuso.
const maximumBase64Length = 2_800_000;
const requestTimeoutMs = 15_000;
// O cliente espera no máximo 9 s. O orçamento de 8,5 s é medido desde o início
// da requisição: se a Vision consumir quase tudo, a IA é pulada e devolvemos o
// que as regras encontraram em vez de estourar o timeout do celular.
const visionTimeoutMs = 6_500;
const requestBudgetMs = 8_500;
const groqMaxTimeoutMs = 3_000;

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
    destination,
    status,
  };
}

Deno.serve(async (request: Request) => {
  const requestStartedAt = Date.now();
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return respond({ error: "Server configuration or login missing" }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return respond({ error: "Sessão inválida." }, 401);
  }

  let input: ExtractLabelRequest;
  try {
    input = await request.json();
  } catch {
    return respond({ error: "Corpo da solicitação inválido." }, 400);
  }

  const condominiumId = input.condominiumId;
  if (typeof condominiumId !== "string" || !isUuid(condominiumId)) {
    return respond({ error: "Informe o condomínio." }, 400);
  }

  const mimeType = input.mimeType ?? "";
  if (!acceptedMimeTypes.has(mimeType)) {
    return respond(
      { error: "Formato de imagem não suportado. Envie JPEG, PNG ou WEBP." },
      415,
    );
  }

  const imageBase64 = (input.imageBase64 ?? "").replace(
    /^data:[^;]+;base64,/,
    "",
  );
  if (!imageBase64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(imageBase64)) {
    return respond({ error: "Imagem da etiqueta inválida." }, 400);
  }
  if (imageBase64.length > maximumBase64Length) {
    return respond(
      { error: "Imagem grande demais. Envie uma foto de até 2 MB." },
      413,
    );
  }

  const expectedAddress = {
    cep: cleanText(input.expectedAddress?.cep, 9),
    street: cleanText(input.expectedAddress?.street, 160),
    address_number: cleanText(input.expectedAddress?.address_number, 20),
  };

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Porteiro vinculado e dentro do prazo, ou Super Admin. A mesma regra das
  // policies do banco: o app não pode usar esta função para ler etiqueta de
  // condomínio alheio.
  const { data: porterAccount, error: porterError } = await serviceClient
    .from("porter_accounts")
    .select("id, active, access_expires_at")
    .eq("auth_user_id", userData.user.id)
    .eq("condominium_id", condominiumId)
    .eq("active", true)
    .maybeSingle();

  if (porterError) return respond({ error: porterError.message }, 500);

  const porterActive =
    Boolean(porterAccount) &&
    (!porterAccount?.access_expires_at ||
      Date.parse(porterAccount.access_expires_at) > Date.now());

  if (!porterActive) {
    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("is_super_admin")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) return respond({ error: profileError.message }, 500);
    if (!profile?.is_super_admin) {
      return respond({ error: "Sem acesso a este condomínio." }, 403);
    }
  }

  // Caminho antigo, só para comparação A/B. Não é o padrão.
  if (
    Deno.env.get("OCR_ENGINE") === "gemini" ||
    Deno.env.get("USE_GEMINI") === "1"
  ) {
    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!geminiKey) {
      return respond(
        { error: "Vision OCR not configured", fallback: true },
        503,
      );
    }
    const read = await readWithGemini(
      { imageBase64, mimeType, expectedAddress, apiKey: geminiKey },
      requestTimeoutMs,
    );
    if (!read.fields) {
      return respond(
        { error: read.error ?? "Falha na leitura na nuvem.", fallback: read.fallback ?? true },
        read.status ?? 502,
      );
    }
    const parsed: ParsedLabel = {
      recipient_name: cleanText(read.fields.recipient_name, 120),
      unit_number: cleanText(read.fields.unit_number, 30),
      block_name: cleanText(read.fields.block_name, 40),
      carrier: cleanText(read.fields.carrier, 60),
      tracking_code: cleanText(read.fields.tracking_code, 80).replace(/\s+/g, ""),
      destination_cep: digitsOnly(read.fields.destination_cep),
      destination_street: cleanText(read.fields.destination_street, 160),
      destination_number: cleanText(read.fields.destination_number, 20),
    };
    const result = labelFrom(parsed, expectedAddress);
    return respond({
      label: result.label,
      diagnostics: { engine: "gemini", aiMs: read.durationMs, aiUsed: [...aiFields] },
    });
  }

  const vision = visionConfig();
  if (!vision) {
    // Sem credencial da Vision o app continua com o leitor local. O diagnóstico
    // vai só para o log: nunca devolvemos metadados da credencial ao cliente.
    console.error(
      "extract-package-label: credencial da Vision ausente",
      visionConfigDebug(),
    );
    return respond({ error: "Vision OCR not configured", fallback: true }, 503);
  }

  let ocrText = "";
  let ocrWords = 0;
  let ocrMs = 0;
  try {
    const read = await readLabelText(imageBase64, vision, visionTimeoutMs);
    ocrText = read.text;
    ocrWords = read.words;
    ocrMs = read.durationMs;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("extract-package-label: falha na Vision", detail);
    const quotaExhausted = /Cota da Vision esgotada/i.test(detail);
    return respond(
      {
        error: quotaExhausted
          ? "Cota da Vision esgotada. Ative o faturamento no Google Cloud."
          : "Não foi possível ler a etiqueta na nuvem.",
        fallback: true,
      },
      502,
    );
  }

  // 1º voto: regras determinísticas. Rastreio e transportadora ficam aqui para
  // sempre — o LLM erra esses dois campos e não é determinístico.
  const rules = parseLabel(ocrText);
  const groqKey = (Deno.env.get("GROQ_API_KEY") ?? "").trim();
  const remainingMs = requestBudgetMs - (Date.now() - requestStartedAt);
  // A IA entra só quando falta campo. Um CEP divergente é decisão determinística:
  // chamar o LLM só porque o endereço é de outro prédio custava ~2 s e não
  // mudava o resultado — o endereço nunca é decidido pela IA.
  const needsAi =
    ocrText.length >= 20 &&
    Boolean(groqKey) &&
    remainingMs >= 800 &&
    (!rules.recipient_name ||
      !rules.unit_number ||
      !rules.destination_cep ||
      !rules.destination_street ||
      !rules.destination_number);

  const diagnostics: Record<string, unknown> = {
    engine: needsAi ? "vision+regras+groq" : "vision+regras",
    ...(groqKey && remainingMs < 800 ? { aiSkipped: "sem tempo no orçamento" } : {}),
    ocrMs,
    ocrWords,
    ocrChars: ocrText.length,
    ocrText: ocrText.slice(0, 3000),
    aiUsed: [] as string[],
  };

  const final: ParsedLabel = { ...rules };

  if (needsAi) {
    const ai = await interpretWithGroq(
      ocrText,
      groqKey,
      Math.min(groqMaxTimeoutMs, remainingMs),
    );
    diagnostics.aiMs = ai.durationMs;
    if (ai.fields) {
      const accepted: string[] = [];
      for (const field of aiFields) {
        const value = ai.fields[field];
        if (value && grounded(field, value, ocrText) !== false) {
          final[field] = value;
          accepted.push(field);
        }
      }
      diagnostics.aiUsed = accepted;
    } else {
      diagnostics.aiError = ai.error;
    }
  }

  // Rastreio e transportadora nunca são substituídos pela IA.
  final.tracking_code = rules.tracking_code;
  final.carrier = rules.carrier;

  const result = labelFrom(final, expectedAddress);
  return respond({ label: result.label, diagnostics });
});
