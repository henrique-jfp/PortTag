import { createClient } from "jsr:@supabase/supabase-js@2";

type ManagePorterRequest = {
  action:
    | "create"
    | "reset-password"
    | "deactivate"
    | "activate"
    | "renew-access";
  condominiumId?: string;
  name?: string;
  username?: string;
  blockIds?: string[];
  porterAccountId?: string;
  accessExpiresAt?: string | null;
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

function porterEmail(username: string) {
  return `porter-${username}@porter.invalid`;
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
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

  // Síndicos gerenciam apenas os porteiros dos condomínios aos quais estão
  // vinculados como admin ativo. A checagem é repetida depois de resolver o
  // condomínio/porteiro de cada ação (service_role ignora RLS).
  const allowedCondominiumIds: string[] = [];
  if (!profile?.is_super_admin) {
    const { data: memberships, error: membershipError } = await serviceClient
      .from("condominium_users")
      .select("condominium_id")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .eq("status", "active");
    if (membershipError) {
      return respond({ error: membershipError.message }, 500);
    }
    allowedCondominiumIds.push(
      ...(memberships ?? []).map((membership) => membership.condominium_id),
    );
    if (!allowedCondominiumIds.length) {
      return respond(
        { error: "Sem permissão para gerenciar porteiros." },
        403,
      );
    }
  }

  let input: ManagePorterRequest;
  try {
    input = await request.json();
  } catch {
    return respond({ error: "Corpo da solicitação inválido." }, 400);
  }

  if (input.action === "create") {
    if (
      typeof input.name !== "string" ||
      typeof input.username !== "string" ||
      (input.blockIds !== undefined && !Array.isArray(input.blockIds)) ||
      (input.accessExpiresAt !== undefined &&
        input.accessExpiresAt !== null &&
        typeof input.accessExpiresAt !== "string")
    ) {
      return respond({ error: "Os dados do porteiro são inválidos." }, 400);
    }

    const name = input.name.trim();
    const username = input.username.trim().toLowerCase();
    const condominiumId = input.condominiumId;
    const blockIds = [...new Set(input.blockIds ?? [])];

    if (
      !name ||
      name.length > 120 ||
      !username ||
      typeof condominiumId !== "string" ||
      !isUuid(condominiumId)
    ) {
      return respond({ error: "Informe nome, usuário e condomínio." }, 400);
    }
    if (
      !profile?.is_super_admin &&
      !allowedCondominiumIds.includes(condominiumId)
    ) {
      return respond({ error: "Sem permissão para gerenciar este condomínio." }, 403);
    }
    if (!blockIds.every((blockId) => isUuid(blockId))) {
      return respond({ error: "A seleção de blocos é inválida." }, 400);
    }
    const expiresAtValue = input.accessExpiresAt
      ? Date.parse(input.accessExpiresAt)
      : null;
    if (
      expiresAtValue !== null &&
      (!Number.isFinite(expiresAtValue) || expiresAtValue <= Date.now())
    ) {
      return respond({ error: "A data de expiração precisa estar no futuro." }, 400);
    }
    const accessExpiresAt =
      expiresAtValue === null ? null : new Date(expiresAtValue).toISOString();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
      return respond(
        { error: "O usuário deve ter de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado." },
        400,
      );
    }

    const { data: condominium, error: condominiumError } = await serviceClient
      .from("condominiums")
      .select("id, block_count, status")
      .eq("id", condominiumId)
      .maybeSingle();
    if (condominiumError) return respond({ error: condominiumError.message }, 500);
    if (!condominium || condominium.status !== "active") {
      return respond({ error: "Condomínio ativo não encontrado." }, 404);
    }
    if (
      (condominium.block_count > 0 && blockIds.length === 0) ||
      (condominium.block_count === 0 && blockIds.length > 0)
    ) {
      return respond(
        { error: "Selecione ao menos um bloco de trabalho para este condomínio." },
        400,
      );
    }

    if (blockIds.length) {
      const { data: blocks, error: blocksError } = await serviceClient
        .from("blocks")
        .select("id")
        .eq("condominium_id", condominiumId)
        .in("id", blockIds);
      if (blocksError) return respond({ error: blocksError.message }, 500);
      if ((blocks ?? []).length !== blockIds.length) {
        return respond({ error: "Um ou mais blocos não pertencem ao condomínio." }, 400);
      }
    }

    let resolvedUsername = username;
    let suffix = 1;
    while (suffix <= 9999) {
      const { data: existingAccount, error: existingError } = await serviceClient
        .from("porter_accounts")
        .select("id")
        .ilike("username", escapeLikePattern(resolvedUsername))
        .maybeSingle();
      if (existingError) return respond({ error: existingError.message }, 500);
      if (!existingAccount) break;

      suffix += 1;
      if (suffix <= 9999) {
        const suffixText = String(suffix);
        resolvedUsername = `${username.slice(0, 32 - suffixText.length)}${suffixText}`;
      }
    }
    if (suffix > 9999) {
      return respond(
        { error: "Não foi possível gerar um usuário único. Edite o nome de usuário e tente novamente." },
        409,
      );
    }

    const password = createTemporaryPassword();
    const { data: createdUser, error: createUserError } =
      await serviceClient.auth.admin.createUser({
        email: porterEmail(resolvedUsername),
        password,
        email_confirm: true,
        user_metadata: {
          display_name: name,
          username: resolvedUsername,
          account_type: "porter",
        },
      });
    if (createUserError || !createdUser.user) {
      return respond(
        { error: createUserError?.message ?? "Não foi possível criar a conta." },
        400,
      );
    }

    const { data: account, error: accountError } = await serviceClient
      .from("porter_accounts")
      .insert({
        auth_user_id: createdUser.user.id,
        condominium_id: condominiumId,
        username: resolvedUsername,
        name,
        access_expires_at: accessExpiresAt,
        created_by: userData.user.id,
      })
      .select("id")
      .single();

    if (accountError || !account) {
      await serviceClient.auth.admin.deleteUser(createdUser.user.id);
      return respond(
        { error: accountError?.message ?? "Não foi possível salvar o cadastro." },
        500,
      );
    }

    const { error: membershipError } = await serviceClient
      .from("condominium_users")
      .insert({
        condominium_id: condominiumId,
        user_id: createdUser.user.id,
        role: "operator",
        status: "active",
        created_by: userData.user.id,
      });

    if (membershipError) {
      await serviceClient.auth.admin.deleteUser(createdUser.user.id);
      return respond({ error: membershipError.message }, 500);
    }

    if (blockIds.length) {
      const { error: assignmentsError } = await serviceClient
        .from("porter_blocks")
        .insert(
          blockIds.map((blockId) => ({
            porter_account_id: account.id,
            block_id: blockId,
          })),
        );
      if (assignmentsError) {
        await serviceClient.auth.admin.deleteUser(createdUser.user.id);
        return respond({ error: assignmentsError.message }, 500);
      }
    }

    return respond({
      credentials: { name, username: resolvedUsername, password },
      message: "Porteiro cadastrado. Guarde a senha temporária agora.",
    });
  }

  if (
    input.action === "reset-password" ||
    input.action === "deactivate" ||
    input.action === "activate" ||
    input.action === "renew-access"
  ) {
    if (
      typeof input.porterAccountId !== "string" ||
      !isUuid(input.porterAccountId)
    ) {
      return respond({ error: "Informe o porteiro." }, 400);
    }

    const { data: account, error: accountError } = await serviceClient
      .from("porter_accounts")
      .select("id, auth_user_id, condominium_id, active, access_expires_at")
      .eq("id", input.porterAccountId)
      .maybeSingle();
    if (accountError) return respond({ error: accountError.message }, 500);
    if (!account) return respond({ error: "Porteiro não encontrado." }, 404);
    if (
      !profile?.is_super_admin &&
      !allowedCondominiumIds.includes(account.condominium_id)
    ) {
      return respond({ error: "Sem permissão para gerenciar este porteiro." }, 403);
    }

    // undefined = manter o prazo atual; null = sem expiração.
    let nextExpiry: string | null | undefined;
    if (input.action === "activate" || input.action === "renew-access") {
      const rawExpiry = input.accessExpiresAt;
      if (rawExpiry === null) {
        nextExpiry = null;
      } else if (rawExpiry !== undefined) {
        if (typeof rawExpiry !== "string") {
          return respond({ error: "A data de expiração é inválida." }, 400);
        }
        const parsedExpiry = Date.parse(rawExpiry);
        if (!Number.isFinite(parsedExpiry) || parsedExpiry <= Date.now()) {
          return respond(
            { error: "A data de expiração precisa estar no futuro." },
            400,
          );
        }
        nextExpiry = new Date(parsedExpiry).toISOString();
      }
    }

    if (input.action === "renew-access") {
      if (!account.active) {
        return respond(
          { error: "Reative o acesso antes de renovar o prazo." },
          409,
        );
      }
      if (nextExpiry === undefined) {
        return respond({ error: "Informe o novo prazo de acesso." }, 400);
      }
      const { error: renewError } = await serviceClient
        .from("porter_accounts")
        .update({ access_expires_at: nextExpiry })
        .eq("id", account.id);
      if (renewError) return respond({ error: renewError.message }, 500);
      return respond({
        message:
          nextExpiry === null
            ? "Prazo removido: o acesso ficou sem expiração."
            : "Prazo de acesso atualizado.",
      });
    }

    if (input.action === "reset-password" || input.action === "activate") {
      if (!account.active) {
        if (input.action !== "activate") {
          return respond({ error: "Reative o acesso antes de redefinir a senha." }, 409);
        }
      } else if (input.action === "activate") {
        return respond({ error: "Este porteiro já está ativo." }, 409);
      }
      const password = createTemporaryPassword();
      const { error } = await serviceClient.auth.admin.updateUserById(
        account.auth_user_id,
        { password },
      );
      if (error) return respond({ error: error.message }, 500);
      if (input.action === "activate") {
        const accountUpdate: Record<string, unknown> = { active: true };
        if (nextExpiry !== undefined) {
          accountUpdate.access_expires_at = nextExpiry;
        } else if (
          account.access_expires_at &&
          Date.parse(account.access_expires_at) <= Date.now()
        ) {
          // Manter um prazo já vencido deixaria o porteiro bloqueado depois de
          // "Reativar". Sem uma nova data, o acesso volta sem expiração.
          accountUpdate.access_expires_at = null;
        }
        const { error: accountUpdateError } = await serviceClient
          .from("porter_accounts")
          .update(accountUpdate)
          .eq("id", account.id);
        if (accountUpdateError) {
          return respond({ error: accountUpdateError.message }, 500);
        }
        const { error: membershipUpdateError } = await serviceClient
          .from("condominium_users")
          .update({ status: "active" })
          .eq("user_id", account.auth_user_id)
          .eq("condominium_id", account.condominium_id)
          .eq("role", "operator");
        if (membershipUpdateError) {
          return respond({ error: membershipUpdateError.message }, 500);
        }
        const expiryNote =
          accountUpdate.access_expires_at === null
            ? " O prazo anterior venceu e foi removido: o acesso ficou sem expiração."
            : "";
        return respond({
          credentials: { password },
          message: `Acesso reativado com nova senha temporária.${expiryNote}`,
        });
      }
      return respond({ credentials: { password } });
    }

    const { error: accountUpdateError } = await serviceClient
      .from("porter_accounts")
      .update({ active: false })
      .eq("id", account.id);
    if (accountUpdateError) {
      return respond({ error: accountUpdateError.message }, 500);
    }

    const { error: membershipUpdateError } = await serviceClient
      .from("condominium_users")
      .update({ status: "inactive" })
      .eq("user_id", account.auth_user_id)
      .eq("condominium_id", account.condominium_id)
      .eq("role", "operator");
    if (membershipUpdateError) {
      return respond({
        error: `A conta foi bloqueada, mas o vínculo não foi atualizado: ${membershipUpdateError.message}`,
      }, 500);
    }
    return respond({ message: "Acesso do porteiro removido." });
  }

  return respond({ error: "Ação não suportada." }, 400);
});
