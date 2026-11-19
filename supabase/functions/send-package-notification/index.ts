import { createClient } from "jsr:@supabase/supabase-js@2";

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

const EVOLUTION_API_URL =
  Deno.env.get("EVOLUTION_API_URL") || "https://evolution.henriquedejesus.dev";
const EVOLUTION_API_KEY =
  Deno.env.get("EVOLUTION_API_KEY") || "evo_key_condo_98a7fbc3829104ad8ef4129e7102cba3";

function instanceNameFor(condominiumId: string) {
  return `condo_${condominiumId.replace(/-/g, "")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return respond({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization");

  if (!supabaseUrl || !supabaseServiceKey || !authHeader) {
    return respond({ error: "Configuração do servidor incompleta." }, 500);
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");
  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(token);

  if (authError || !user) {
    return respond({ error: "Faça login para continuar." }, 401);
  }

  let body: { notificationId?: string; packageId?: string };
  try {
    body = await req.json();
  } catch {
    return respond({ error: "JSON inválido." }, 400);
  }

  const { notificationId } = body;
  if (!notificationId) {
    return respond({ error: "notificationId é obrigatório." }, 400);
  }

  // Busca a notificação gravada
  const { data: notification, error: notifError } = await adminClient
    .from("package_notifications")
    .select("*, packages(unit_number, block_name, sender, tracking_code)")
    .eq("id", notificationId)
    .single();

  if (notifError || !notification) {
    return respond({ error: "Notificação não encontrada." }, 404);
  }

  // Se já foi enviada, não duplica
  if (notification.status === "sent") {
    return respond({
      success: true,
      status: "sent",
      providerMessageId: notification.provider_message_id,
      alreadySent: true,
    });
  }

  const condominiumId = notification.condominium_id;
  const instance = instanceNameFor(condominiumId);

  // Normaliza o número do morador (deve ter 55 e apenas dígitos)
  const recipientDigits = notification.recipient.replace(/\D/g, "");
  const cleanRecipient = recipientDigits.startsWith("55")
    ? recipientDigits
    : `55${recipientDigits}`;

  try {
    const sendRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instance}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        number: cleanRecipient,
        text: notification.message,
        delay: 1200,
        linkPreview: false,
      }),
    });

    if (!sendRes.ok) {
      const errBody = await sendRes.json().catch(() => ({}));
      const errorMessage =
        errBody?.response?.message?.[0] ||
        errBody?.message ||
        `Erro HTTP ${sendRes.status} na Evolution API`;

      await adminClient.rpc("update_package_notification_status", {
        p_notification_id: notificationId,
        p_status: "failed",
        p_provider_message_id: null,
        p_error: errorMessage,
      });

      return respond({
        success: false,
        status: "failed",
        error: errorMessage,
        fallback: true,
      });
    }

    const sendData = await sendRes.json();
    const providerMessageId = sendData?.key?.id || null;

    await adminClient.rpc("update_package_notification_status", {
      p_notification_id: notificationId,
      p_status: "sent",
      p_provider_message_id: providerMessageId,
      p_error: null,
    });

    return respond({
      success: true,
      status: "sent",
      providerMessageId,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Falha na conexão com a Evolution API.";

    await adminClient.rpc("update_package_notification_status", {
      p_notification_id: notificationId,
      p_status: "failed",
      p_provider_message_id: null,
      p_error: errorMessage,
    });

    return respond({
      success: false,
      status: "failed",
      error: errorMessage,
      fallback: true,
    });
  }
});
