import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Retenção do Label Lab. Apaga a foto e sanitiza os dados identificáveis da
 * fila quando a amostra expira ou é descartada. Nenhuma outra tabela do caderno
 * é alterada. Também reconcilia arquivos órfãos do bucket privado.
 */

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};
const bucket = "label-lab-private";
const maximumPerRun = 200;

type Sample = {
  id: string;
  condominium_id: string;
  storage_path: string | null;
  status: string;
  expires_at: string;
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("LABEL_LAB_CLEANUP_SECRET");
  const suppliedSecret = request.headers.get("x-cron-secret");
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return respond({ error: "Server configuration missing" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date().toISOString();

  const { data: expired, error: expiredError } = await supabase
    .from("label_lab_queue")
    .select("id, condominium_id, storage_path, status, expires_at")
    .is("deleted_at", null)
    .lte("expires_at", now)
    .limit(maximumPerRun);
  if (expiredError) {
    return respond({ error: expiredError.message }, 500);
  }

  const { data: discarded, error: discardedError } = await supabase
    .from("label_lab_queue")
    .select("id, condominium_id, storage_path, status, expires_at")
    .is("deleted_at", null)
    .in("status", ["discarded", "published"])
    .limit(maximumPerRun);
  if (discardedError) {
    return respond({ error: discardedError.message }, 500);
  }

  const samples = new Map<string, Sample>();
  for (const item of [...(expired ?? []), ...(discarded ?? [])] as Sample[]) {
    samples.set(item.id, item);
  }

  let deleted = 0;
  let failures = 0;
  for (const sample of samples.values()) {
    const expiredByTime = new Date(sample.expires_at).getTime() <= Date.now();
    if (sample.storage_path) {
      const { error: removeError } = await supabase.storage
        .from(bucket)
        .remove([sample.storage_path]);
      if (removeError) {
        console.error("label-lab storage:", removeError.message);
        failures += 1;
        continue;
      }
    }

    const { error: updateError } = await supabase
      .from("label_lab_queue")
      .update({
        deleted_at: now,
        status: "deleted",
        ocr_text: null,
        tracking_code: null,
        parsed_result: {},
        confidence_status: {},
        analysis: null,
        error: null,
      })
      .eq("id", sample.id)
      .is("deleted_at", null);
    if (updateError) {
      console.error("label-lab cleanup:", updateError.message);
      failures += 1;
      continue;
    }

    const { error: auditError } = await supabase
      .from("label_lab_audit")
      .insert({
        sample_id: sample.id,
        condominium_id: sample.condominium_id,
        action: "deleted",
        details: { previous_status: sample.status, expired: expiredByTime },
      });
    if (auditError) console.error("label-lab audit:", auditError.message);
    deleted += 1;
  }

  const { data: orphanPaths, error: orphanError } = await supabase.rpc(
    "label_lab_orphan_paths",
  );
  if (orphanError) {
    console.error("label-lab orphans:", orphanError.message);
  }
  const paths = Array.isArray(orphanPaths)
    ? orphanPaths.filter((path): path is string => typeof path === "string")
    : [];
  let orphanPathsRemoved = 0;
  for (let index = 0; index < paths.length; index += maximumPerRun) {
    const chunk = paths.slice(index, index + maximumPerRun);
    const { error: removeError } = await supabase.storage.from(bucket).remove(chunk);
    if (removeError) {
      console.error("label-lab orphan storage:", removeError.message);
      failures += 1;
    } else {
      orphanPathsRemoved += chunk.length;
    }
  }

  return respond({ deleted, orphanPathsRemoved, failures });
});
