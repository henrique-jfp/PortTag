import { createClient } from "jsr:@supabase/supabase-js@2";

type ManageWhatsappRequest = {
  action: "status" | "connect" | "disconnect" | "test-message";
  condominiumId: string;
  phoneNumber?: string;
  message?: string;
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

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const userClient = createClient(supabaseUrl, authHeader.replace("Bearer ", ""), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return respond({ error: "Faça login para continuar." }, 401);
  }

  let body: ManageWhatsappRequest;
  try {
    body = (await req.json()) as ManageWhatsappRequest;
  } catch {
    return respond({ error: "JSON inválido." }, 400);
  }

  const { action, condominiumId, phoneNumber, message } = body;
  if (!condominiumId) {
    return respond({ error: "Condomínio não informado." }, 400);
  }

  // Verifica permissão do usuário para o condomínio
  const { data: isAdmin, error: adminCheckError } = await adminClient.rpc(
    "is_condominium_admin",
    { target_condominium: condominiumId }
  );

  if (adminCheckError || !isAdmin) {
    return respond(
      { error: "Você não tem permissão para gerenciar o WhatsApp deste condomínio." },
      403
    );
  }

  const instance = instanceNameFor(condominiumId);

  try {
    if (action === "status") {
      // Consulta a Evolution API pelo estado da conexão
      const stateRes = await fetch(
        `${EVOLUTION_API_URL}/instance/connectionState/${instance}`,
        {
          headers: { apikey: EVOLUTION_API_KEY },
        }
      );

      if (stateRes.status === 404) {
        // Instância ainda não criada
        await adminClient
          .from("condominium_whatsapp_instances")
          .upsert({
            condominium_id: condominiumId,
            instance_name: instance,
            status: "disconnected",
            phone_number: null,
            qr_code: null,
            updated_at: new Date().toISOString(),
          });

        return respond({
          status: "disconnected",
          configured: false,
          instance,
        });
      }

      const stateData = await stateRes.json();
      const state = stateData?.instance?.state || stateData?.state;
      const isConnected = state === "open";
      const isConnecting = state === "connecting";
      const currentStatus = isConnected
        ? "connected"
        : isConnecting
        ? "connecting"
        : "disconnected";

      // Atualiza no banco
      await adminClient
        .from("condominium_whatsapp_instances")
        .upsert({
          condominium_id: condominiumId,
          instance_name: instance,
          status: currentStatus,
          updated_at: new Date().toISOString(),
        });

      return respond({
        status: currentStatus,
        configured: true,
        instance,
      });
    }

    if (action === "connect") {
      // 1. Tenta criar ou verificar a instância
      const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          instanceName: instance,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      });

      // 2. Solicita o QR Code para conexão
      const connectRes = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instance}`, {
        headers: { apikey: EVOLUTION_API_KEY },
      });

      const connectData = await connectRes.json();
      const qrCode = connectData?.base64 || connectData?.code || null;

      await adminClient
        .from("condominium_whatsapp_instances")
        .upsert({
          condominium_id: condominiumId,
          instance_name: instance,
          status: "connecting",
          qr_code: qrCode,
          updated_at: new Date().toISOString(),
        });

      return respond({
        status: "connecting",
        qrCode,
        instance,
      });
    }

    if (action === "disconnect") {
      // Desconecta a sessão na Evolution API
      await fetch(`${EVOLUTION_API_URL}/instance/logout/${instance}`, {
        method: "DELETE",
        headers: { apikey: EVOLUTION_API_KEY },
      });

      await adminClient
        .from("condominium_whatsapp_instances")
        .upsert({
          condominium_id: condominiumId,
          instance_name: instance,
          status: "disconnected",
          phone_number: null,
          qr_code: null,
          updated_at: new Date().toISOString(),
        });

      return respond({
        status: "disconnected",
        instance,
      });
    }

    if (action === "test-message") {
      if (!phoneNumber) {
        return respond({ error: "Informe o número de telefone de destino." }, 400);
      }

      const digits = phoneNumber.replace(/\D/g, "");
      const cleanNumber = digits.startsWith("55") ? digits : `55${digits}`;

      const textToSend =
        message ||
        "🎉 Teste do Encomendaí! O WhatsApp da portaria foi configurado e conectado com sucesso.";

      const sendRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instance}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          number: cleanNumber,
          text: textToSend,
          delay: 1000,
          linkPreview: false,
        }),
      });

      if (!sendRes.ok) {
        const errorData = await sendRes.json().catch(() => ({}));
        return respond(
          {
            error:
              errorData?.response?.message?.[0] ||
              errorData?.message ||
              "Não foi possível enviar a mensagem de teste. Verifique se o WhatsApp está conectado.",
          },
          400
        );
      }

      const sendData = await sendRes.json();
      return respond({
        success: true,
        messageId: sendData?.key?.id,
      });
    }

    return respond({ error: "Ação não reconhecida." }, 400);
  } catch (error) {
    return respond(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha na comunicação com a Evolution API.",
      },
      500
    );
  }
});
