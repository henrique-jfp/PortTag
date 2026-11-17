import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  normalizePorterUsername,
  suggestPorterUsername,
} from "../lib/porterAccounts";
import { supabase } from "../lib/supabase";

type Condominium = {
  id: string;
  name: string;
  street: string | null;
  number: string | null;
  block_count: number;
};

type Block = {
  id: string;
  name: string;
};

type Porter = {
  id: string;
  name: string;
  username: string;
  active: boolean;
  access_expires_at: string | null;
  blocks: string[];
};

type Manager = {
  id: string;
  user_id: string;
  status: "active" | "inactive";
  email: string;
};

type Credentials = {
  name: string;
  username: string;
  password: string;
};

type AccessDuration = "never" | "seven-days" | "custom";

function localDateTimeValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function formatAccessExpiry(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

async function getFunctionErrorMessage(error: {
  message: string;
  context?: unknown;
}) {
  if (error.context instanceof Response) {
    const response = error.context.clone();
    try {
      const body: unknown = await response.json();
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
      ) {
        return body.error;
      }
      if (
        body &&
        typeof body === "object" &&
        "message" in body &&
        typeof body.message === "string"
      ) {
        return body.message;
      }
    } catch {
      return `${error.message} (HTTP ${response.status}).`;
    }
    return `${error.message} (HTTP ${response.status}).`;
  }
  return error.message;
}

export function CondominiumOperators({
  condominiumId,
}: {
  condominiumId: string;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [selectedCondominiumId, setSelectedCondominiumId] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [porters, setPorters] = useState<Porter[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [name, setName] = useState("");
  const [usernameOverride, setUsernameOverride] = useState<string | null>(null);
  const [accessDuration, setAccessDuration] = useState<AccessDuration>("never");
  const [customAccessExpiry, setCustomAccessExpiry] = useState("");
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [managerEmail, setManagerEmail] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [pageError, setPageError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [reactivatingId, setReactivatingId] = useState("");
  const [reactivateAction, setReactivateAction] = useState<
    "activate" | "renew-access"
  >("activate");
  const [reactivateDuration, setReactivateDuration] =
    useState<AccessDuration>("never");
  const [reactivateCustomExpiry, setReactivateCustomExpiry] = useState("");
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setCurrentTime(Date.now()), 0);
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPage() {
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("is_super_admin")
        .eq("id", user.id)
        .maybeSingle();

      if (!active) return;
      if (profileError) {
        setPageError(profileError.message);
        setLoading(false);
        return;
      }
      if (!profile?.is_super_admin) {
        setLoading(false);
        return;
      }

      setIsSuperAdmin(true);
      let condominiumQuery = supabase
        .from("condominiums")
        .select("id, name, street, number, block_count")
        .eq("status", "active");
      if (condominiumId) {
        condominiumQuery = condominiumQuery.eq("id", condominiumId);
      }
      const { data, error } = await condominiumQuery.order("name");

      if (!active) return;
      if (error) {
        setPageError(error.message);
      } else {
        setCondominiums(data ?? []);
        setSelectedCondominiumId(data?.[0]?.id ?? "");
        if (condominiumId && !data?.length) {
          setPageError("Condomínio ativo não encontrado.");
        }
      }
      setLoading(false);
    }

    void loadPage().catch((error: unknown) => {
      if (!active) return;
      setPageError(
        error instanceof Error ? error.message : "Falha inesperada.",
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId, user]);

  useEffect(() => {
    let active = true;

    async function loadAccounts() {
      if (!selectedCondominiumId || !isSuperAdmin) {
        setBlocks([]);
        setPorters([]);
        setManagers([]);
        return;
      }

      setPageError("");
      const [
        blocksResult,
        portersResult,
        managerMembershipsResult,
      ] = await Promise.all([
        supabase
          .from("blocks")
          .select("id, name")
          .eq("condominium_id", selectedCondominiumId)
          .order("name"),
        supabase
          .from("porter_accounts")
          .select("id, name, username, active, access_expires_at")
          .eq("condominium_id", selectedCondominiumId)
          .order("name"),
        supabase
          .from("condominium_users")
          .select("id, user_id, status")
          .eq("condominium_id", selectedCondominiumId)
          .eq("role", "admin")
          .order("created_at"),
      ]);

      if (!active) return;
      const loadError =
        blocksResult.error ??
        portersResult.error ??
        managerMembershipsResult.error;
      if (loadError) {
        setPageError(loadError.message);
        return;
      }

      const porterIds = (portersResult.data ?? []).map((porter) => porter.id);
      const { data: assignments, error: assignmentsError } = porterIds.length
        ? await supabase
            .from("porter_blocks")
            .select("porter_account_id, block_id")
            .in("porter_account_id", porterIds)
        : { data: [], error: null };
      if (!active) return;
      if (assignmentsError) {
        setPageError(assignmentsError.message);
        return;
      }

      const blockNames = new Map(
        (blocksResult.data ?? []).map((block) => [block.id, block.name]),
      );
      const assignedByPorter = new Map<string, string[]>();
      for (const assignment of assignments ?? []) {
        const blockName = blockNames.get(assignment.block_id);
        if (!blockName) continue;
        const current = assignedByPorter.get(assignment.porter_account_id) ?? [];
        current.push(blockName);
        assignedByPorter.set(assignment.porter_account_id, current);
      }
      setBlocks(blocksResult.data ?? []);
      setPorters(
        (portersResult.data ?? []).map((porter) => ({
          ...porter,
          blocks: assignedByPorter.get(porter.id) ?? [],
        })),
      );

      const managerUserIds = (managerMembershipsResult.data ?? []).map(
        (membership) => membership.user_id,
      );
      const { data: profiles, error: profileLookupError } = managerUserIds.length
        ? await supabase
            .from("profiles")
            .select("id, email")
            .in("id", managerUserIds)
        : { data: [], error: null };
      if (!active) return;
      if (profileLookupError) {
        setPageError(profileLookupError.message);
        return;
      }
      const emailById = new Map(
        (profiles ?? []).map((profile) => [profile.id, profile.email ?? ""]),
      );
      setManagers(
        (managerMembershipsResult.data ?? []).map((membership) => ({
          ...membership,
          email: emailById.get(membership.user_id) || membership.user_id,
        })),
      );
    }

    void loadAccounts().catch((error: unknown) => {
      if (!active) return;
      setPageError(
        error instanceof Error ? error.message : "Falha inesperada.",
      );
    });

    return () => {
      active = false;
    };
  }, [isSuperAdmin, listVersion, selectedCondominiumId]);

  const selectedCondominium = condominiums.find(
    (condominium) => condominium.id === selectedCondominiumId,
  );
  const suggestedUsername = suggestPorterUsername(
    selectedCondominium?.street ?? "",
    name,
    selectedCondominium?.number ?? "",
  );
  const username = usernameOverride ?? suggestedUsername;

  function toggleBlock(blockId: string) {
    setSelectedBlockIds((current) =>
      current.includes(blockId)
        ? current.filter((id) => id !== blockId)
        : [...current, blockId],
    );
  }

  async function handleCreatePorter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCondominiumId) return;

    let accessExpiresAt: string | null = null;
    if (accessDuration === "seven-days") {
      accessExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (accessDuration === "custom") {
      const expiryTimestamp = new Date(customAccessExpiry).getTime();
      if (!customAccessExpiry || !Number.isFinite(expiryTimestamp) || expiryTimestamp <= Date.now()) {
        setPageError("Escolha uma data e hora futuras para o fim do acesso.");
        return;
      }
      accessExpiresAt = new Date(expiryTimestamp).toISOString();
    }

    setPageError("");
    setSuccessMessage("");
    setCredentials(null);
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-porter", {
        body: {
          action: "create",
          condominiumId: selectedCondominiumId,
          name: name.trim(),
          username,
          blockIds: selectedBlockIds,
          accessExpiresAt,
        },
      });

      if (error) {
        setPageError(await getFunctionErrorMessage(error));
        return;
      }
      if (
        typeof data?.credentials?.username !== "string" ||
        typeof data?.credentials?.password !== "string"
      ) {
        setPageError("A conta pode ter sido criada, mas as credenciais não foram retornadas. Atualize a lista antes de tentar novamente.");
        setListVersion((version) => version + 1);
        return;
      }

      setCredentials({
        name: data.credentials.name,
        username: data.credentials.username,
        password: data.credentials.password,
      });
      setName("");
      setUsernameOverride(null);
      setSelectedBlockIds([]);
      setAccessDuration("never");
      setCustomAccessExpiry("");
      setSuccessMessage("Porteiro cadastrado. A senha temporária é exibida somente agora.");
      setListVersion((version) => version + 1);
    } catch (error) {
      setPageError(
        error instanceof Error
          ? `Não foi possível cadastrar o porteiro. ${error.message}`
          : "Não foi possível cadastrar o porteiro.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handlePorterAction(
    porter: Porter,
    action: "reset-password" | "deactivate" | "activate" | "renew-access",
    accessExpiresAt?: string | null,
  ) {
    if (
      action === "deactivate" &&
      !window.confirm(`Remover o acesso de ${porter.name}?`)
    ) {
      return;
    }
    if (
      action === "reset-password" &&
      !window.confirm(`Gerar uma nova senha temporária para ${porter.name}?`)
    ) {
      return;
    }

    setPageError("");
    setSuccessMessage("");
    setWorkingId(porter.id);
    try {
      const { data, error } = await supabase.functions.invoke("manage-porter", {
        body: {
          action,
          porterAccountId: porter.id,
          ...(accessExpiresAt !== undefined ? { accessExpiresAt } : {}),
        },
      });
      if (error) {
        setPageError(await getFunctionErrorMessage(error));
        return;
      }

      if (
        (action === "reset-password" || action === "activate") &&
        typeof data?.credentials?.password === "string"
      ) {
        setCredentials({
          name: porter.name,
          username: porter.username,
          password: data.credentials.password,
        });
        setSuccessMessage(
          action === "activate"
            ? "Acesso reativado. Guarde a nova senha temporária."
            : "Senha redefinida. Guarde a nova senha agora.",
        );
      } else {
        setSuccessMessage(
          action === "deactivate"
            ? `Acesso de ${porter.name} removido.`
            : typeof data?.message === "string"
              ? data.message
              : "Prazo de acesso atualizado.",
        );
      }
      setListVersion((version) => version + 1);
    } catch (error) {
      setPageError(
        error instanceof Error
          ? `Não foi possível atualizar o porteiro. ${error.message}`
          : "Não foi possível atualizar o porteiro.",
      );
    } finally {
      setWorkingId("");
    }
  }

  async function confirmPorterReactivation(porter: Porter) {
    let accessExpiresAt: string | null = null;
    if (reactivateDuration === "seven-days") {
      accessExpiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString();
    } else if (reactivateDuration === "custom") {
      const expiryTimestamp = new Date(reactivateCustomExpiry).getTime();
      if (
        !reactivateCustomExpiry ||
        !Number.isFinite(expiryTimestamp) ||
        expiryTimestamp <= Date.now()
      ) {
        setPageError("Escolha uma data e hora futuras para o fim do acesso.");
        return;
      }
      accessExpiresAt = new Date(expiryTimestamp).toISOString();
    }

    await handlePorterAction(porter, reactivateAction, accessExpiresAt);
    setReactivatingId("");
    setReactivateAction("activate");
    setReactivateDuration("never");
    setReactivateCustomExpiry("");
  }

  async function handleAssignManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCondominiumId) return;

    setPageError("");
    setSuccessMessage("");
    setSaving(true);
    try {
      const { error } = await supabase.rpc("assign_condominium_admin", {
        p_condominium_id: selectedCondominiumId,
        p_email: managerEmail.trim(),
      });
      if (error) {
        setPageError(error.message);
        return;
      }
      setManagerEmail("");
      setSuccessMessage("Síndico vinculado. Ele entra no app Síndico com a conta de e-mail.");
      setListVersion((version) => version + 1);
    } catch (error) {
      setPageError(
        error instanceof Error
          ? `Não foi possível vincular o síndico. ${error.message}`
          : "Não foi possível vincular o síndico.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivateManager(manager: Manager) {
    if (
      manager.status !== "active" ||
      !window.confirm(`Remover o acesso de ${manager.email}?`)
    ) {
      return;
    }
    try {
      const { error } = await supabase.rpc("deactivate_condominium_admin", {
        p_membership_id: manager.id,
      });
      if (error) {
        setPageError(error.message);
        return;
      }
      setSuccessMessage(`Acesso de ${manager.email} removido.`);
      setListVersion((version) => version + 1);
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Não foi possível remover o acesso.",
      );
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(
        `Usuário: ${credentials.username}\nSenha: ${credentials.password}`,
      );
      setSuccessMessage("Usuário e senha copiados.");
    } catch (error) {
      setPageError(
        error instanceof Error
          ? `Não foi possível copiar. ${error.message}`
          : "Não foi possível copiar as credenciais.",
      );
    }
  }

  if (loading) {
    return <div className="loading-screen">Carregando equipe...</div>;
  }

  return (
    <div>
      {pageError && (
        <p className="feedback-message feedback-error" role="alert">
          {pageError}
        </p>
      )}
      {!isSuperAdmin ? (
        <section className="welcome-card">
          <h2>Acesso restrito</h2>
          <p>Somente o Super Admin pode cadastrar porteiros e síndicos.</p>
        </section>
      ) : (
        <>
          <section className="admin-section">
            <div className="section-heading">
              <h2>Cadastrar porteiro</h2>
              <p>
                Condomínio: {selectedCondominium?.name ?? "Carregando..."}.
                A senha temporária de 8 caracteres aparece uma vez ao salvar.
              </p>
            </div>
            <form className="condominium-form" onSubmit={handleCreatePorter}>
              <label className="form-field">
                Nome do porteiro
                <input
                  required
                  maxLength={120}
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="form-field">
                Usuário para login
                <input
                  required
                  minLength={3}
                  maxLength={32}
                  autoComplete="off"
                  value={username}
                  onChange={(event) => {
                    setUsernameOverride(
                      normalizePorterUsername(event.target.value),
                    );
                  }}
                />
                <span className="field-hint">
                  Sugestão: iniciais do endereço, primeiro nome e número do
                  prédio. Se já existir, o sistema acrescenta um número. Você
                  pode editar.
                </span>
              </label>
              <label className="form-field">
                Prazo de acesso
                <select
                  value={accessDuration}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (
                      value === "never" ||
                      value === "seven-days" ||
                      value === "custom"
                    ) {
                      setAccessDuration(value);
                    }
                  }}
                >
                  <option value="never">Sem expiração</option>
                  <option value="seven-days">Teste por 7 dias</option>
                  <option value="custom">Escolher data e hora</option>
                </select>
                <span className="field-hint">
                  Porteiros sem prazo continuam ativos até você remover o acesso.
                </span>
              </label>
              {accessDuration === "custom" && (
                <label className="form-field">
                  Acesso até
                  <input
                    required
                    type="datetime-local"
                    min={localDateTimeValue()}
                    value={customAccessExpiry}
                    onChange={(event) => setCustomAccessExpiry(event.target.value)}
                  />
                </label>
              )}

              {selectedCondominium?.block_count ? (
                <fieldset className="form-field form-field-wide block-assignment">
                  <legend>Blocos onde o porteiro trabalha</legend>
                  {blocks.length ? (
                    <div className="block-assignment-options">
                      {blocks.map((block) => (
                        <label key={block.id}>
                          <input
                            type="checkbox"
                            checked={selectedBlockIds.includes(block.id)}
                            onChange={() => toggleBlock(block.id)}
                          />
                          {block.name}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <span className="field-hint">
                      Cadastre os blocos antes de criar um porteiro.
                    </span>
                  )}
                </fieldset>
              ) : (
                <p className="field-hint form-field-wide">
                  Este condomínio não tem blocos; o porteiro terá acesso a
                  todas as unidades.
                </p>
              )}

              <div className="form-actions">
                <button
                  className="primary-button"
                  disabled={
                    saving ||
                    !selectedCondominiumId ||
                    Boolean(selectedCondominium?.block_count && !selectedBlockIds.length)
                  }
                >
                  {saving ? "Criando conta..." : "Cadastrar porteiro"}
                </button>
              </div>
            </form>

            {credentials && (
              <div className="credentials-card" role="status">
                <strong>Credenciais temporárias de {credentials.name}</strong>
                <p>
                  Usuário: <code>{credentials.username}</code>
                  <br />
                  Senha: <code>{credentials.password}</code>
                </p>
                <div className="form-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void copyCredentials()}
                  >
                    Copiar credenciais
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setCredentials(null)}
                  >
                    Fechar
                  </button>
                </div>
              </div>
            )}

            {successMessage && (
              <p className="feedback-message feedback-success" role="status">
                {successMessage}
              </p>
            )}
          </section>

          <section className="admin-section">
            <div className="section-heading">
              <h2>Porteiros cadastrados</h2>
              <p>{selectedCondominium?.name}</p>
            </div>
            {porters.length === 0 ? (
              <p className="empty-state">Nenhum porteiro cadastrado.</p>
            ) : (
              <ul className="operator-list">
                {porters.map((porter) => (
                  <li
                    key={porter.id}
                    className={
                      reactivatingId === porter.id
                        ? "reactivate-item"
                        : undefined
                    }
                  >
                    <div>
                      <strong>{porter.name} (@{porter.username})</strong>
                      <span>
                        {!porter.active
                          ? "Inativo"
                          : porter.access_expires_at &&
                              new Date(porter.access_expires_at).getTime() <= currentTime
                            ? "Prazo expirado"
                            : "Ativo"}{" "}
                        · {porter.access_expires_at
                          ? `Acesso até ${formatAccessExpiry(porter.access_expires_at)}`
                          : "Sem expiração"} ·{" "}
                        {porter.blocks.length
                          ? porter.blocks.join(", ")
                          : "Todos os blocos"}
                      </span>
                    </div>
                    <div className="table-actions">
                      {porter.active && (
                        <>
                          {porter.access_expires_at &&
                            new Date(porter.access_expires_at).getTime() <=
                              currentTime && (
                              <button
                                className="text-button"
                                disabled={workingId === porter.id}
                                onClick={() => {
                                  setReactivatingId(porter.id);
                                  setReactivateAction("renew-access");
                                  setReactivateDuration("never");
                                  setReactivateCustomExpiry("");
                                  setPageError("");
                                }}
                              >
                                Renovar prazo
                              </button>
                            )}
                          <button
                            className="text-button"
                            disabled={workingId === porter.id}
                            onClick={() =>
                              void handlePorterAction(porter, "reset-password")
                            }
                          >
                            Nova senha
                          </button>
                          <button
                            className="text-button danger-text-button"
                            disabled={workingId === porter.id}
                            onClick={() =>
                              void handlePorterAction(porter, "deactivate")
                            }
                          >
                            Remover acesso
                          </button>
                        </>
                      )}
                      {!porter.active && (
                        <button
                          className="text-button"
                          disabled={workingId === porter.id}
                          onClick={() => {
                            setReactivatingId(porter.id);
                            setReactivateAction("activate");
                            setReactivateDuration("never");
                            setReactivateCustomExpiry("");
                            setPageError("");
                          }}
                        >
                          Reativar e gerar senha
                        </button>
                      )}
                    </div>
                    {reactivatingId === porter.id && (
                      <div className="reactivate-panel">
                        <p>
                          {reactivateAction === "activate" ? (
                            <>
                              Reativar <strong>{porter.name}</strong> e gerar
                              uma nova senha. Escolha o novo prazo de acesso:
                            </>
                          ) : (
                            <>
                              Renovar o prazo de acesso de{" "}
                              <strong>{porter.name}</strong>. Enquanto o prazo
                              estiver vencido, o banco bloqueia o acesso dele:
                            </>
                          )}
                        </p>
                        <label className="form-field">
                          Prazo de acesso
                          <select
                            value={reactivateDuration}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (
                                value === "never" ||
                                value === "seven-days" ||
                                value === "custom"
                              ) {
                                setReactivateDuration(value);
                              }
                            }}
                          >
                            <option value="never">Sem expiração</option>
                            <option value="seven-days">Teste por 7 dias</option>
                            <option value="custom">Escolher data e hora</option>
                          </select>
                        </label>
                        {reactivateDuration === "custom" && (
                          <label className="form-field">
                            Acesso até
                            <input
                              required
                              type="datetime-local"
                              min={localDateTimeValue()}
                              value={reactivateCustomExpiry}
                              onChange={(event) =>
                                setReactivateCustomExpiry(event.target.value)
                              }
                            />
                          </label>
                        )}
                        <div className="table-actions">
                          <button
                            className="primary-button"
                            disabled={workingId === porter.id}
                            onClick={() =>
                              void confirmPorterReactivation(porter)
                            }
                          >
                            {workingId === porter.id
                              ? "Salvando..."
                              : reactivateAction === "activate"
                                ? "Reativar e gerar senha"
                                : "Salvar novo prazo"}
                          </button>
                          <button
                            className="text-button"
                            disabled={workingId === porter.id}
                            onClick={() => setReactivatingId("")}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="admin-section">
            <div className="section-heading">
              <h2>Vincular síndico</h2>
              <p>
                Condomínio: {selectedCondominium?.name ?? "Carregando..."}.
                O síndico usa uma conta já criada no Supabase Authentication.
              </p>
            </div>
            <form className="inline-form" onSubmit={handleAssignManager}>
              <label className="form-field">
                E-mail do síndico
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={managerEmail}
                  onChange={(event) => setManagerEmail(event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={saving}>
                Vincular síndico
              </button>
            </form>
            {managers.length > 0 && (
              <ul className="operator-list manager-list">
                {managers.map((manager) => (
                  <li key={manager.id}>
                    <div>
                      <strong>{manager.email}</strong>
                      <span>
                        {manager.status === "active" ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                    {manager.status === "active" && (
                      <button
                        className="text-button danger-text-button"
                        onClick={() => void handleDeactivateManager(manager)}
                      >
                        Remover acesso
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
