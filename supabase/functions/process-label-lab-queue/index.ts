import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Worker assíncrono do Label Lab. Roda fora do recebimento, buscando na fila as
 * amostras já guardadas. A função `label-lab` é reutilizada sem alteração: ela
 * continua sendo o único lugar que chama Vision → regras → Groq ancorado.
 */

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};
const bucket = "label-lab-private";
const maximumSamplesPerRun = 4;
const labTimeoutMs = 45_000;
const allowedAddressStatus = new Set(["verified", "mismatch", "unknown"]);

type Sample = {
  id: string;
  condominium_id: string;
  storage_path: string;
  mime_type: string;
  attempts: number;
};

type Condominium = {
  id: string;
  cep: string | null;
  street: string | null;
  address_number: string | null;
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function cleanText(value: unknown, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function sanitizeParsed(value: unknown) {
  const raw = isRecord(value) ? value : {};
  const candidates = raw.unit_candidates;
  return {
    recipient_name: cleanText(raw.recipient_name, 120) || null,
    unit_number: cleanText(raw.unit_number, 30) || null,
    block_name: cleanText(raw.block_name, 40) || null,
    carrier: cleanText(raw.carrier, 60) || null,
    tracking_code: cleanText(raw.tracking_code, 80).replace(/\s+/g, "") || null,
    destination_cep: cleanText(raw.destination_cep, 20).replace(/\D/g, "").slice(0, 8) || null,
    destination_street: cleanText(raw.destination_street, 160) || null,
    destination_number: cleanText(raw.destination_number, 20) || null,
    address_status: allowedAddressStatus.has(String(raw.address_status))
      ? String(raw.address_status)
      : "unknown",
    unit_candidates:
      typeof candidates === "number" && Number.isFinite(candidates)
        ? Math.max(0, Math.min(100, Math.trunc(candidates)))
        : 0,
  };
}

function sanitizeDiagnostics(value: unknown) {
  const raw = isRecord(value) ? value : {};
  const aiUsed = Array.isArray(raw.ai_used)
    ? raw.ai_used
        .filter((item): item is string => typeof item === "string")
        .map((item) => cleanText(item, 40))
        .filter(Boolean)
        .slice(0, 10)
    : [];
  return {
    engine: cleanText(raw.engine, 60) || null,
    ocrMs: typeof raw.ocrMs === "number" ? Math.trunc(raw.ocrMs) : 0,
    ocrWords: typeof raw.ocrWords === "number" ? Math.trunc(raw.ocrWords) : 0,
    ocrChars: typeof raw.ocrChars === "number" ? Math.trunc(raw.ocrChars) : 0,
    aiMs: typeof raw.aiMs === "number" ? Math.trunc(raw.aiMs) : 0,
    ai_used: aiUsed,
    ai_error: cleanText(raw.aiError, 240) || null,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("LABEL_LAB_WORKER_SECRET");
  const suppliedSecret = request.headers.get("x-cron-secret");
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const labSecret = Deno.env.get("LABEL_LAB_SECRET");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !labSecret) {
    return respond({ error: "Server configuration missing" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: settings, error: settingsError } = await supabase
    .from("label_lab_settings")
    .select("max_attempts")
    .eq("id", true)
    .maybeSingle();
  if (settingsError) {
    return respond({ error: settingsError.message }, 500);
  }
  const maxAttempts =
    typeof settings?.max_attempts === "number" ? settings.max_attempts : 3;

  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_label_lab_samples",
    { p_limit: maximumSamplesPerRun },
  );
  if (claimError) {
    return respond({ error: claimError.message }, 500);
  }
  const samples = (claimed ?? []) as Sample[];
  if (!samples.length) {
    return respond({ processed: 0 });
  }

  const condominiumIds = [...new Set(samples.map((sample) => sample.condominium_id))];
  const { data: condominiums, error: condominiumError } = await supabase
    .from("condominiums")
    .select("id, cep, street, address_number")
    .in("id", condominiumIds);
  if (condominiumError) {
    return respond({ error: condominiumError.message }, 500);
  }
  const condominiumById = new Map<string, Condominium>(
    ((condominiums ?? []) as Condominium[]).map((item) => [item.id, item]),
  );

  let analyzed = 0;
  let failed = 0;

  for (const sample of samples) {
    const condominium = condominiumById.get(sample.condominium_id);
    let errorMessage = "";

    try {
      if (!condominium) throw new Error("Condomínio não encontrado.");

      const { data: file, error: downloadError } = await supabase.storage
        .from(bucket)
        .download(sample.storage_path);
      if (downloadError || !file) {
        throw new Error(downloadError?.message ?? "Arquivo da amostra ausente.");
      }
      const imageBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      if (!imageBase64) throw new Error("Arquivo da amostra vazio.");

      const labResponse = await fetch(
        `${supabaseUrl}/functions/v1/label-lab`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: anonKey,
            "x-label-lab-secret": labSecret,
          },
          body: JSON.stringify({
            images: [
              { name: sample.id, imageBase64, mimeType: sample.mime_type },
            ],
            expectedAddress: {
              cep: condominium.cep ?? "",
              street: condominium.street ?? "",
              address_number: condominium.address_number ?? "",
            },
            suggest: true,
          }),
          signal: AbortSignal.timeout(labTimeoutMs),
        },
      );
      if (!labResponse.ok) {
        throw new Error(`label-lab respondeu HTTP ${labResponse.status}.`);
      }
      const labBody = (await labResponse.json()) as {
        results?: Array<Record<string, unknown>>;
      };
      const result = labBody.results?.[0];
      if (!isRecord(result) || result.ok !== true) {
        throw new Error(
          cleanText(result?.error, 240) || "A análise da etiqueta falhou.",
        );
      }

      const { error: updateError } = await supabase
        .from("label_lab_queue")
        .update({
          status: "analyzed",
          analysis: result,
          ocr_text: cleanText(result.ocrText, 3000) || null,
          parsed_result: sanitizeParsed(result.fields),
          confidence_status: sanitizeDiagnostics(result.diagnostics),
          error: null,
        })
        .eq("id", sample.id)
        .is("deleted_at", null);
      if (updateError) throw updateError;

      const { error: auditError } = await supabase
        .from("label_lab_audit")
        .insert({
          sample_id: sample.id,
          condominium_id: sample.condominium_id,
          action: "analyzed",
          details: { attempts: sample.attempts },
        });
      if (auditError) console.error("label-lab audit:", auditError.message);
      analyzed += 1;
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? cleanText(error.message, 240) || "Falha na análise."
          : "Falha na análise.";
      const permanent = sample.attempts >= maxAttempts;
      const { error: updateError } = await supabase
        .from("label_lab_queue")
        .update({
          status: permanent ? "failed" : "pending",
          error: errorMessage,
        })
        .eq("id", sample.id)
        .is("deleted_at", null);
      if (updateError) console.error("label-lab update:", updateError.message);

      const { error: auditError } = await supabase
        .from("label_lab_audit")
        .insert({
          sample_id: sample.id,
          condominium_id: sample.condominium_id,
          action: "analysis_failed",
          details: { attempts: sample.attempts, permanent, error: errorMessage },
        });
      if (auditError) console.error("label-lab audit:", auditError.message);
      failed += 1;
    }
  }

  return respond({ claimed: samples.length, analyzed, failed });
});
