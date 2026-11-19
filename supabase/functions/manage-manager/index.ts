import { createClient } from "jsr:@supabase/supabase-js@2";

type ManageManagerRequest = {
  action: "create" | "reset-password" | "activate";
  condominiumId?: string;
  name?: string;
  email?: string;
  membershipId?: string;
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

// service_role ignora RLS; a RPC confere prazo/status do condomínio no banco
// antes de permitir criar ou reativar o vínculo do síndico.
async function condominiumAccessError(
  serviceClient: ReturnType<typeof createClient>,
  condominiumId: string,
): Promise<{ error: string; status: number } | null> {
  const { data, error } = await serviceClient.rpc("condominium_access_is_active", {
    p_condominium_id: condominiumId,
  });
  if (error) return { error: error.message, status: 500 };
  if (data !== true) {
    return {
      error:
        "O prazo de acesso deste condomínio venceu ou o condomínio está inativo. Entre em contato com o suporte técnico para regularizar.",
      status: 403,
    };
  }
  return null;
}

function randomIndex(maxExclusive: number) {
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % maxExclusive;
}

function randomCharacter(characters: string) {
  return characters[randomIndex(characters.length)];
}

function createTemporaryPassword() {
  const characters = [
    randomCharacter("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    randomCharacter("0123456789"),
    randomCharacter("0123456789"),
    randomCharacter("0123456789"),
    randomCharacter("!@#$%&*"),
    randomCharacter("abcdefghijklmnopqrstuvwxyz"),
    randomCharacter("abcdefghijklmnopqrstuvwxyz"),
    randomCharacter("abcdefghijklmnopqrstuvwxyz"),
  ];

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex],
      characters[index],
    ];
  }

  return characters.join("");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isValidEmail(value: string) {
  if (value.length > 254 || /\s/.test(value)) return false;
  const parts = value.split("@");
  return parts.length === 2 && parts[0].length > 0 && parts[1].includes(".");
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

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) return respond({ error: profileError.message }, 500);
  if (!profile?.is_super_admin) {
    return respond({ error: "Apenas o Super Admin pode gerenciar síndicos." }, 403);
  }

  let input: ManageManagerRequest;
  try {
    input = await request.json();
  } catch {
    return respond({ error: "Corpo da solicitação inválido." }, 400);
  }

  if (input.action === "create") {
    if (
      typeof input.name !== "string" ||
      typeof input.email !== "string" ||
      typeof input.condominiumId !== "string"
    ) {
      return respond({ error: "Os dados do síndico são inválidos." }, 400);
    }

    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    const condominiumId = input.condominiumId;

    if (
      !name ||
      name.length > 120 ||
      !isValidEmail(email) ||
      !isUuid(condominiumId)
    ) {
      return respond(
        { error: "Informe nome, e-mail e condomínio válidos." },
        400,
      );
    }

    const { data: condominium, error: condominiumError } = await serviceClient
      .from("condominiums")
      .select("id, status")
      .eq("id", condominiumId)
      .maybeSingle();
    if (condominiumError) return respond({ error: condominiumError.message }, 500);
    if (!condominium || condominium.status !== "active") {
      return respond({ error: "Condomínio ativo não encontrado." }, 404);
    }
    const accessError = await condominiumAccessError(serviceClient, condominiumId);
    if (accessError) return respond({ error: accessError.error }, accessError.status);

    const password = createTemporaryPassword();
    const { data: createdUser, error: createUserError } =
      await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: name,
          account_type: "manager",
        },
      });

    if (createUserError || !createdUser.user) {
      const alreadyExists =
        createUserError?.code === "email_exists" ||
        /already (registered|exists)/i.test(createUserError?.message ?? "");
      return respond(
        {
          error: alreadyExists
            ? "Já existe uma conta com esse e-mail. Para conectá-la a este condomínio, use 'Vincular síndico existente'. Se ela já for síndico aqui, use 'Nova senha' na lista."
            : createUserError?.message ?? "Não foi possível criar a conta.",
        },
        alreadyExists ? 409 : 400,
      );
    }

    // Usa a RPC com o JWT do Super Admin: ela valida o vínculo e impede
    // promover uma conta que já tenha outro perfil no condomínio.
    const { error: linkError } = await userClient.rpc("assign_condominium_admin", {
      p_condominium_id: condominiumId,
      p_email: email,
    });
    if (linkError) {
      await serviceClient.auth.admin.deleteUser(createdUser.user.id);
      return respond({ error: linkError.message }, 500);
    }

    return respond({
      credentials: { name, email, password },
      message: "Síndico cadastrado. Guarde a senha temporária agora.",
    });
  }

  if (input.action === "reset-password" || input.action === "activate") {
    if (
      typeof input.membershipId !== "string" ||
      !isUuid(input.membershipId)
    ) {
      return respond({ error: "Informe o síndico." }, 400);
    }

    const { data: membership, error: membershipError } = await serviceClient
      .from("condominium_users")
      .select("id, user_id, condominium_id, status")
      .eq("id", input.membershipId)
      .eq("role", "admin")
      .maybeSingle();
    if (membershipError) return respond({ error: membershipError.message }, 500);
    if (!membership) return respond({ error: "Síndico não encontrado." }, 404);

    if (input.action === "reset-password" && membership.status !== "active") {
      return respond(
        { error: "Reative o acesso antes de redefinir a senha." },
        409,
      );
    }
    if (input.action === "activate" && membership.status === "active") {
      return respond({ error: "Este síndico já está ativo." }, 409);
    }

    if (input.action === "activate") {
      const accessError = await condominiumAccessError(
        serviceClient,
        membership.condominium_id,
      );
      if (accessError) return respond({ error: accessError.error }, accessError.status);
    }

    const { data: authUser, error: authUserError } =
      await serviceClient.auth.admin.getUserById(membership.user_id);
    if (authUserError || !authUser.user) {
      return respond(
        { error: authUserError?.message ?? "Conta do síndico não encontrada." },
        404,
      );
    }

    const displayName =
      typeof authUser.user.user_metadata?.display_name === "string" &&
      authUser.user.user_metadata.display_name.trim()
        ? authUser.user.user_metadata.display_name.trim()
        : authUser.user.email ?? "Síndico";

    const password = createTemporaryPassword();
    const { error: updateError } = await serviceClient.auth.admin.updateUserById(
      membership.user_id,
      { password },
    );
    if (updateError) return respond({ error: updateError.message }, 500);

    if (input.action === "activate") {
      const { error: activateError } = await serviceClient
        .from("condominium_users")
        .update({ status: "active" })
        .eq("id", membership.id);
      if (activateError) return respond({ error: activateError.message }, 500);
    }

    return respond({
      credentials: {
        name: displayName,
        email: authUser.user.email ?? "",
        password,
      },
      message:
        input.action === "activate"
          ? "Acesso reativado. Guarde a nova senha temporária."
          : "Senha redefinida. Guarde a nova senha agora.",
    });
  }

  return respond({ error: "Ação não suportada." }, 400);
});
