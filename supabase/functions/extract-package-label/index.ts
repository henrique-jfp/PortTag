import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildAddressReason, decideAddressStatus } from "./address.ts";

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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
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

/**
 * Schema devolvido pelo Gemini. A IA apenas extrai campos: `address_status`
 * e `address_reason` são recalculados no servidor por `address.ts`, porque
 * decisão de endereço não pode depender do modelo.
 */
const responseSchema = {
  type: "OBJECT",
  properties: {
    recipient_name: { type: "STRING" },
    unit_number: { type: "STRING" },
    block_name: { type: "STRING" },
    carrier: { type: "STRING" },
    tracking_code: { type: "STRING" },
    destination_cep: { type: "STRING" },
    destination_street: { type: "STRING" },
    destination_number: { type: "STRING" },
    address_status: {
      type: "STRING",
      enum: ["verified", "mismatch", "unknown"],
    },
    address_reason: { type: "STRING" },
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
    "address_status",
    "address_reason",
  ],
};

function buildPrompt(expectedAddress: {
  cep: string;
  street: string;
  address_number: string;
}) {
  return [
    "Leia esta foto de etiqueta de encomenda brasileira.",
    "Transportadoras comuns: Mercado Livre, Shopee, Amazon, Correios, Shein, Jadlog, Loggi, Total Express.",
    "Extraia SOMENTE os dados do DESTINATÁRIO. Ignore remetente, vendedor, transportadora emitente, código de acesso da NF-e, pedido e dados fiscais.",
    "unit_number é só o número da unidade (ex.: \"901\", \"102B\", \"Cobertura 1\"). block_name é o bloco/torre (ex.: \"A\", \"Bloco 2\").",
    "destination_cep deve conter somente dígitos. Se a etiqueta mostrar o endereço em duas linhas, junte rua e número.",
    `Endereço do condomínio que está recebendo: CEP ${expectedAddress.cep || "não informado"}, logradouro ${expectedAddress.street || "não informado"}, número ${expectedAddress.address_number || "não informado"}.`,
    "address_status:",
    "- verified: o CEP do destino confere, ou o logradouro e o número conferem com o condomínio;",
    "- mismatch: você tem certeza de que o CEP ou o logradouro+número do destino pertencem a OUTRO endereço;",
    "- unknown: qualquer parte do destino está ilegível, ausente ou ambígua.",
    "address_status e address_reason são recalculados no servidor: preencha com unknown se não souber, mas sempre extraia os campos de destino.",
    "Não invente dados. Campo ilegível fica string vazia (exceto address_status, que fica unknown).",
  ].join("\n");
}

type GeminiCandidate = {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

function stripJsonFence(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return respond({ error: "Server configuration or login missing" }, 500);
  }

  // Sem chave da Vision API o app deve continuar funcionando com o leitor
  // local. 503 + fallback é o sinal para o cliente não tratar como erro.
  if (!geminiApiKey) {
    return respond(
      { error: "Vision OCR not configured", fallback: true },
      503,
    );
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
      return respond(
        { error: "Sem acesso a este condomínio." },
        403,
      );
    }
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildPrompt(expectedAddress) },
          {
            inlineData: {
              mimeType: mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      maxOutputTokens: 350,
      temperature: 0.1,
      // gemini-3.5-flash-lite rejeita thinkingBudget: 0; o nível minimal é o
      // que desliga o raciocínio sem invalidar a requisição.
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  };

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiApiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMs),
      },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error(
      "extract-package-label: falha ao chamar Gemini",
      timedOut ? "timeout" : error instanceof Error ? error.message : error,
    );
    return respond(
      {
        error: timedOut
          ? "A leitura na nuvem excedeu o tempo limite."
          : "Não foi possível falar com a leitura na nuvem.",
        fallback: true,
      },
      timedOut ? 504 : 502,
    );
  }

  if (!geminiResponse.ok) {
    const detail = await geminiResponse.text().catch(() => "");
    console.error(
      "extract-package-label: Gemini respondeu",
      geminiResponse.status,
      detail.slice(0, 500),
    );
    // 429/403/400 do Gemini são problemas de configuração ou cota: o porteiro
    // não deve ficar preso, então o cliente cai para o OCR local.
    return respond(
      {
        error: `Vision OCR failed (${geminiResponse.status}).`,
        fallback: true,
        detail: detail.slice(0, 300),
      },
      geminiResponse.status === 429 ? 429 : 502,
    );
  }

  let payload: GeminiResponse;
  try {
    payload = (await geminiResponse.json()) as GeminiResponse;
  } catch (error) {
    console.error(
      "extract-package-label: JSON inválido do Gemini",
      error instanceof Error ? error.message : error,
    );
    return respond(
      { error: "Resposta inválida da leitura na nuvem.", fallback: true },
      502,
    );
  }

  const candidate = payload.candidates?.[0];
  const raw = candidate?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!raw) {
    return respond(
      {
        error:
          payload.promptFeedback?.blockReason ??
          "A leitura na nuvem não devolveu conteúdo.",
        fallback: true,
      },
      422,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
  } catch {
    return respond(
      { error: "A leitura na nuvem devolveu um formato inesperado.", fallback: true },
      502,
    );
  }

  const destination = {
    cep: digitsOnly(parsed.destination_cep),
    street: cleanText(parsed.destination_street, 160),
    number: cleanText(parsed.destination_number, 20),
  };
  const status = decideAddressStatus(destination, expectedAddress);

  return respond({
    label: {
      recipient_name: cleanText(parsed.recipient_name, 120),
      unit_number: cleanText(parsed.unit_number, 30),
      block_name: cleanText(parsed.block_name, 40),
      carrier: cleanText(parsed.carrier, 60),
      tracking_code: cleanText(parsed.tracking_code, 80).replace(/\s+/g, ""),
      destination_cep: destination.cep,
      destination_street: destination.street,
      destination_number: destination.number,
      address_status: status,
      address_reason: buildAddressReason(status, destination, expectedAddress),
    },
  });
});
