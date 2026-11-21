import { createClient } from "jsr:@supabase/supabase-js@2";

const responseHeaders = { "Content-Type": "application/json" };

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: responseHeaders,
    });
  }

  const expectedSecret = Deno.env.get("PACKAGE_PHOTO_CLEANUP_SECRET");
  const suppliedSecret = request.headers.get("x-cron-secret");
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: responseHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Server configuration missing" }), {
      status: 500,
      headers: responseHeaders,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Limpeza definitiva do caderno conforme o prazo configurado por condomínio.
  // Antes disso, apenas a foto da etiqueta era removida; os registros ficavam
  // para sempre. A RPC usa service_role e apaga também eventos e avisos.
  const { data: retentionResult, error: retentionError } = await supabase.rpc(
    "cleanup_expired_notebook_records",
  );
  if (retentionError) {
    return new Response(JSON.stringify({ error: retentionError.message }), {
      status: 500,
      headers: responseHeaders,
    });
  }
  const notebookDeleted = (retentionResult as { deleted?: number } | null)?.deleted ?? 0;

  const { data: expiredPackages, error: queryError } = await supabase
    .from("packages")
    .select("id, receipt_path")
    .not("receipt_path", "is", null)
    .lte("photo_expires_at", new Date().toISOString())
    .limit(500);

  if (queryError) {
    return new Response(JSON.stringify({ error: queryError.message }), {
      status: 500,
      headers: responseHeaders,
    });
  }

  if (!expiredPackages?.length) {
    return new Response(JSON.stringify({ deleted: 0, notebookDeleted }), {
      status: 200,
      headers: responseHeaders,
    });
  }

  const paths = expiredPackages.flatMap((item) =>
    item.receipt_path ? [item.receipt_path] : [],
  );
  const { error: storageError } = await supabase.storage
    .from("package-receipts")
    .remove(paths);

  if (storageError) {
    return new Response(JSON.stringify({ error: storageError.message }), {
      status: 500,
      headers: responseHeaders,
    });
  }

  const deletedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("packages")
    .update({ receipt_path: null, photo_deleted_at: deletedAt })
    .in(
      "id",
      expiredPackages.map((item) => item.id),
    );

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 500,
      headers: responseHeaders,
    });
  }

  return new Response(JSON.stringify({ deleted: paths.length, notebookDeleted }), {
    status: 200,
    headers: responseHeaders,
  });
});
