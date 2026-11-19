import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Recebe a amostra determinística do app do porteiro DEPOIS do OCR.
 *
 * Esta função não chama Vision, Groq, Gemini nem qualquer outro modelo: o OCR
 * já aconteceu no pipeline de produção. Ela apenas valida a sessão, faz upload
 * do JPEG já comprimido para um bucket privado e registra a tarefa na fila.
 * Nenhuma resposta, texto ou loading aparece no app por causa dela.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const bucket = "label-lab-private";
const maximumImageBytes = 2_800_000;
const mimeExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const allowedReasons = new Set([
  "recipient-missing",
  "unit-missing",
  "unit-conflict",
  "address-unknown",
  "address-mismatch",
  "short-ocr",
  "ai-error",
  "ai-skipped",
  "carrier-missing",
  "tracking-missing",
]);
const allowedAddressStatus = new Set(["verified", "mismatch", "unknown"]);

type CollectRequest = {
  condominiumId?: unknown;
  imageBase64?: unknown;
  mimeType?: unknown;
  reasons?: unknown;
  carrierDetected?: unknown;
  trackingCode?: unknown;
  ocrText?: unknown;
  parsedResult?: unknown;
  confidenceStatus?: unknown;
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function base64Bytes(value: unknown): Uint8Array {
  if (typeof value !== "string") return new Uint8Array();
  const base64 = value
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s/g, "");
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return new Uint8Array();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const reasons = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && allowedReasons.has(item)) reasons.add(item);
  }
  return [...reasons].slice(0, 10);
}

function sanitizeParsed(value: unknown) {
  const raw = isRecord(value) ? value : {};
  const candidates = raw.unit_candidates;
  return {
    recipient_name: cleanText(raw.recipient_name, 200) || null,
    unit_number: cleanText(raw.unit_number, 40) || null,
    unit_candidates:
      typeof candidates === "number" && Number.isFinite(candidates)
        ? Math.max(0, Math.min(100, Math.trunc(candidates)))
        : 0,
    carrier: cleanText(raw.carrier, 80) || null,
    tracking_code: cleanText(raw.tracking_code, 80).replace(/\s+/g, "") || null,
    address_status: allowedAddressStatus.has(String(raw.address_status))
      ? String(raw.address_status)
      : "unknown",
  };
}

function sanitizeConfidence(value: unknown) {
  const raw = isRecord(value) ? value : {};
  const ocrChars = raw.ocr_chars;
  const aiUsed = Array.isArray(raw.ai_used)
    ? raw.ai_used
        .filter((item): item is string => typeof item === "string")
        .map((item) => cleanText(item, 40))
        .filter(Boolean)
        .slice(0, 10)
    : [];
  return {
    ocr_chars:
      typeof ocrChars === "number" && Number.isFinite(ocrChars)
        ? Math.max(0, Math.min(100000, Math.trunc(ocrChars)))
        : 0,
    ai_used: aiUsed,
    ai_error: cleanText(raw.ai_error, 240) || null,
    ai_skipped: cleanText(raw.ai_skipped, 240) || null,
  };
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

  let input: CollectRequest;
  try {
    input = await request.json();
  } catch {
    return respond({ error: "Corpo da solicitação inválido." }, 400);
  }

  if (!isUuid(input.condominiumId)) {
    return respond({ error: "Condomínio inválido." }, 400);
  }
  const { data: allowed, error: accessError } = await userClient.rpc(
    "can_collect_label_sample",
    { p_condominium_id: input.condominiumId },
  );
  if (accessError) {
    return respond({ error: accessError.message }, 500);
  }
  if (!allowed) {
    return respond({ error: "Acesso negado a este condomínio." }, 403);
  }

  const reasons = sanitizeReasons(input.reasons);
  const mimeType = String(input.mimeType ?? "");
  if (!reasons.length || !mimeExtensions[mimeType]) {
    return respond({ error: "Amostra sem critério ou formato inválido." }, 400);
  }

  const image = base64Bytes(input.imageBase64);
  if (!image.length || image.length > maximumImageBytes) {
    return respond({ error: "Imagem inválida ou grande demais." }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: settings, error: settingsError } = await supabase
    .from("label_lab_settings")
    .select("collection_enabled")
    .eq("id", true)
    .maybeSingle();
  if (settingsError) {
    return respond({ error: settingsError.message }, 500);
  }
  if (!settings?.collection_enabled) {
    return respond({ collected: false, reason: "disabled" });
  }

  const sampleId = crypto.randomUUID();
  const extension = mimeExtensions[mimeType];
  const path = `${input.condominiumId}/${sampleId}.${extension}`;
  const imageSha256 = await sha256Hex(image);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, image, {
      contentType: mimeType,
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadError) {
    return respond({ error: uploadError.message }, 500);
  }

  const { data: storedId, error: enqueueError } = await supabase.rpc(
    "enqueue_label_lab_sample",
    {
      p_id: sampleId,
      p_created_by: userData.user.id,
      p_condominium_id: input.condominiumId,
      p_storage_path: path,
      p_image_sha256: imageSha256,
      p_mime_type: mimeType,
      p_image_bytes: image.length,
      p_reasons: reasons,
      p_carrier_detected: cleanText(input.carrierDetected, 80) || null,
      p_tracking_code: cleanText(input.trackingCode, 80).replace(/\s+/g, "") || null,
      p_ocr_text: cleanText(input.ocrText, 3000) || null,
      p_parsed_result: sanitizeParsed(input.parsedResult),
      p_confidence_status: sanitizeConfidence(input.confidenceStatus),
    },
  );
  if (enqueueError) {
    await supabase.storage.from(bucket).remove([path]);
    return respond({ error: enqueueError.message }, 500);
  }
  if (storedId !== sampleId) {
    await supabase.storage.from(bucket).remove([path]);
    return respond({ collected: false, reason: "duplicate" });
  }

  return respond({ collected: true, id: storedId });
});
