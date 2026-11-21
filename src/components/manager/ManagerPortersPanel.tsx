import { useEffect, useState, type FormEvent } from "react";
import { ConfirmationDialog } from "../ConfirmationDialog";
import { supabase } from "../../lib/supabase";
import { normalizePorterUsername } from "../../lib/porterAccounts";

type Portaria = {
  id: string;
  name: string;
  block_id: string | null;
  active: boolean;
};
type Porter = {
  id: string;
  auth_user_id: string | null;
  name: string;
  username: string;
  active: boolean;
  access_expires_at: string | null;
  home_portaria_id: string | null;
  current_portaria_id: string | null;
  access_revoked_at: string | null;
};
type Action =
  | "create"
  | "reset-password"
  | "deactivate"
  | "activate"
  | "renew-access"
  | "set-portaria"
  | "delete-access";
type Duration = "never" | "seven-days" | "custom";
type Credentials = { name?: string; username?: string; password: string };
type PendingAction = {
  action: Action;
  porter?: Porter;
  portariaId?: string;
};

const DELETE_ACCESS_CONFIRMATION = "EXCLUIR";
const ACTIVITY_PAGE_SIZE = 500;

function localDateTimeValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

async function functionErrorMessage(error: {
  message: string;
  context?: unknown;
}) {
  if (error.context instanceof Response) {
    const response = error.context.clone();
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "error" in body) {
        const value = (body as { error?: unknown }).error;
        if (typeof value === "string") return value;
      }
      return `${error.message} (HTTP ${response.status}).`;
    } catch {
      return `${error.message} (HTTP ${response.status}).`;
    }
  }
  return error.message;
}

function formatExpiry(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Sem expiração";
}

function formatLastActivity(value: string | null) {
  return value
    ? `Último registro em ${new Date(value).toLocaleString("pt-BR")}`
    : "Sem registro no caderno";
}

async function fetchLastActivity(
  condominiumId: string,
  actorIds: Set<string>,
): Promise<Map<string, string>> {
  const activity = new Map<string, string>();
  if (!actorIds.size) return activity;

  let from = 0;
  while (true) {
    const { data, error, count } = await supabase
      .from("package_events")
      .select("actor_id, occurred_at", { count: "exact" })
      .eq("condominium_id", condominiumId)
      .order("occurred_at", { ascending: false })
      .range(from, from + ACTIVITY_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = data ?? [];
    page.forEach((event) => {
      if (event.actor_id && actorIds.has(event.actor_id)) {
        activity.set(event.actor_id, event.occurred_at);
      }
    });
    const total = count ?? 0;
    from += ACTIVITY_PAGE_SIZE;
    if (!page.length || from >= total || activity.size === actorIds.size) {
      break;
    }
  }

  return activity;
}

export function ManagerPortersPanel({
  condominiumId,
}: {
  condominiumId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [portarias, setPortarias] = useState<Portaria[]>([]);
  const [portariasError, setPortariasError] = useState("");
  const [porters, setPorters] = useState<Porter[]>([]);
  const [lastActivity, setLastActivity] = useState<Map<string, string>>(
    new Map(),
  );
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [selectedPortariaId, setSelectedPortariaId] = useState("");
  const [duration, setDuration] = useState<Duration>("never");
  const [customExpiry, setCustomExpiry] = useState("");
  const [renewDuration, setRenewDuration] = useState<Duration>("seven-days");
  const [renewExpiry, setRenewExpiry] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [renewingPorter, setRenewingPorter] = useState<Porter | null>(null);
  const [changingPorter, setChangingPorter] = useState<Porter | null>(null);
  const [targetPortariaId, setTargetPortariaId] = useState("");
  const [deleteAccessTarget, setDeleteAccessTarget] = useState<Porter | null>(
    null,
  );
  const [deleteAccessText, setDeleteAccessText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      const [portariasResult, portersResult] = await Promise.all([
        supabase
          .from("portarias")
          .select("id, name, block_id, active")
          .eq("condominium_id", condominiumId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("porter_accounts")
          .select(
            "id, auth_user_id, name, username, active, access_expires_at, home_portaria_id, current_portaria_id, access_revoked_at",
          )
          .eq("condominium_id", condominiumId)
          .is("access_revoked_at", null)
          .order("name"),
      ]);

      if (!active) return;
      if (portersResult.error) {
        setError(
          `Não foi possível carregar os porteiros. ${portersResult.error.message}`,
        );
      } else {
        const portersData = (portersResult.data ?? []) as Porter[];
        setPorters(portersData);
        const actorIds = new Set(
          portersData
            .map((porter) => porter.auth_user_id)
            .filter((id): id is string => Boolean(id)),
        );
        const activity = await fetchLastActivity(condominiumId, actorIds);
        if (!active) return;
        setLastActivity(activity);
      }
      if (portariasResult.error) {
        setPortariasError(
          `Não foi possível carregar as portarias. ${portariasResult.error.message}`,
        );
      } else {
        const rows = (portariasResult.data ?? []) as Portaria[];
        setPortarias(rows.filter((portaria) => portaria.active));
      }
      setLoading(false);
    })().catch((cause: unknown) => {
      if (!active) return;
      setError(
        cause instanceof Error
          ? `Não foi possível carregar os porteiros. ${cause.message}`
          : "Não foi possível carregar os porteiros.",
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId]);

  function expiryFrom(durationValue: Duration, custom: string) {
    if (durationValue === "never") return null;
    if (durationValue === "seven-days") {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }
    if (!custom) throw new Error("Informe a data e hora de expiração.");
    const parsed = new Date(custom);
    if (!Number.isFinite(parsed.getTime())) {
      throw new Error("Data de expiração inválida.");
    }
    return parsed.toISOString();
  }

  function portariaName(portariaId: string | null) {
    if (!portariaId) return "—";
    return portarias.find((portaria) => portaria.id === portariaId)?.name ?? "—";
  }

  async function invoke(action: Action, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const { data, error: functionError } = await supabase.functions.invoke(
        "manage-porter",
        { body: { action, condominiumId, ...extra } },
      );
      if (functionError) throw new Error(await functionErrorMessage(functionError));
      const payload = data as {
        credentials?: Credentials;
        message?: string;
      } | null;
      if (payload?.credentials) setCredentials(payload.credentials);
      if (payload?.message) setSuccess(payload.message);
      else if (action === "create") {
        setSuccess("Porteiro cadastrado. Guarde a senha temporária agora.");
      } else if (action === "reset-password") {
        setSuccess("Nova senha temporária gerada.");
      } else if (action === "activate") {
        setSuccess("Acesso reativado.");
      } else if (action === "set-portaria") {
        setSuccess("Portaria atual do porteiro alterada.");
      } else if (action === "delete-access") {
        setSuccess(
          "Acesso excluído. Nenhum registro do caderno foi apagado.",
        );
      }
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir a operação.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reloadPorters() {
    const { data: portersData } = await supabase
      .from("porter_accounts")
      .select(
        "id, auth_user_id, name, username, active, access_expires_at, home_portaria_id, current_portaria_id, access_revoked_at",
      )
      .eq("condominium_id", condominiumId)
      .is("access_revoked_at", null)
      .order("name");
    if (portersData) setPorters(portersData);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCredentials(null);
    try {
      const accessExpiresAt = expiryFrom(duration, customExpiry);
      const created = await invoke("create", {
        name: name.trim(),
        username: normalizePorterUsername(username),
        portariaId: selectedPortariaId,
        accessExpiresAt,
      });
      if (created) {
        setName("");
        setUsername("");
        setSelectedPortariaId("");
        setDuration("never");
        setCustomExpiry("");
        await reloadPorters();
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível salvar.",
      );
    }
  }

  async function handleConfirm() {
    if (!pending) return;
    const { action, porter, portariaId } = pending;
    setPending(null);
    if (!porter || action === "create") return;

    setCredentials(null);
    const extra: Record<string, unknown> = { porterAccountId: porter.id };
    if (action === "set-portaria") {
      if (portariaId === "home") extra.home = true;
      else extra.portariaId = portariaId;
    }
    const done = await invoke(action, extra);
    if (done) await reloadPorters();
  }

  async function handleRenew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renewingPorter) return;
    try {
      const done = await invoke("renew-access", {
        porterAccountId: renewingPorter.id,
        accessExpiresAt: expiryFrom(renewDuration, renewExpiry),
      });
      if (done) {
        setRenewingPorter(null);
        await reloadPorters();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Praço inválido.");
    }
  }

  async function confirmDeleteAccess() {
    if (!deleteAccessTarget) return;
    if (deleteAccessText.trim().toUpperCase() !== DELETE_ACCESS_CONFIRMATION) {
      setError(`Digite ${DELETE_ACCESS_CONFIRMATION} para confirmar.`);
      return;
    }
    const porter = deleteAccessTarget;
    setDeleteAccessTarget(null);
    setDeleteAccessText("");
    const done = await invoke("delete-access", { porterAccountId: porter.id });
    if (done) await reloadPorters();
  }

  function handleChangePortaria(porter: Porter) {
    setChangingPorter(porter);
    setTargetPortariaId(
      portarias.find((portaria) => portaria.id !== porter.current_portaria_id)
        ?.id ?? "",
    );
  }

  return (
    <section className="manager-panel">
      <div className="manager-panel-heading">
        <div>
          <p className="eyebrow">Equipe</p>
          <h2>Porteiros</h2>
          <p>
            A permissão é da portaria: o porteiro registra e consulta somente o
            caderno da portaria onde está trabalhando.
          </p>
        </div>
      </div>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}
      {success && <p className="feedback-message">{success}</p>}
      {portariasError && (
        <p className="feedback-message feedback-error" role="alert">
          {portariasError}
        </p>
      )}

      {credentials && (
        <div className="manager-credentials" role="status">
          <h3>Dados de acesso temporários</h3>
          <p>
            Usuário: <strong>{credentials.username ?? "—"}</strong>
            <br />
            Senha: <strong>{credentials.password}</strong>
          </p>
          <p className="field-hint">
            A senha aparece apenas neste momento. Entregue-a ao porteiro e
            oriente a trocar depois do primeiro acesso.
          </p>
        </div>
      )}

      <div className="manager-two-column">
        <div className="manager-card">
          <h3>Cadastrar porteiro</h3>
          <form className="manager-form" onSubmit={handleCreate}>
            <label>
              Nome
              <input
                value={name}
                onChange={(event) => {
                  const value = event.target.value;
                  setName(value);
                  setUsername((current) =>
                    current ? current : normalizePorterUsername(value),
                  );
                }}
                placeholder="Nome do porteiro"
                required
              />
            </label>
            <label>
              Usuário
              <input
                value={username}
                onChange={(event) =>
                  setUsername(normalizePorterUsername(event.target.value))
                }
                placeholder="Usuario123"
                required
              />
            </label>
            <label>
              Portaria de origem
              <select
                value={selectedPortariaId}
                onChange={(event) => setSelectedPortariaId(event.target.value)}
                required
                disabled={portarias.length === 0}
              >
                <option value="">
                  {portarias.length
                    ? "Selecione a portaria"
                    : "Cadastre uma portaria antes"}
                </option>
                {portarias.map((portaria) => (
                  <option key={portaria.id} value={portaria.id}>
                    {portaria.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-hint">
              A portaria de origem é onde o porteiro trabalha normalmente. Você
              pode trocar a portaria atual a qualquer momento.
            </p>
            <label>
              Prazo de acesso
              <select
                value={duration}
                onChange={(event) =>
                  setDuration(event.target.value as Duration)
                }
              >
                <option value="never">Sem expiração</option>
                <option value="seven-days">7 dias</option>
                <option value="custom">Data personalizada</option>
              </select>
            </label>
            {duration === "custom" && (
              <label>
                Vence em
                <input
                  type="datetime-local"
                  value={customExpiry}
                  onChange={(event) => setCustomExpiry(event.target.value)}
                  required
                />
              </label>
            )}
            <div className="form-actions">
              <button type="submit" disabled={busy || !selectedPortariaId}>
                {busy ? "Cadastrando..." : "Criar acesso"}
              </button>
            </div>
          </form>
        </div>

        <div className="manager-card">
          <h3>Porteiros cadastrados</h3>
          {loading ? (
            <p className="manager-empty">Carregando...</p>
          ) : porters.length === 0 ? (
            <p className="manager-empty">Nenhum porteiro cadastrado.</p>
          ) : (
            <ul className="manager-list">
              {porters.map((porter) => (
                <li key={porter.id}>
                  <div>
                    <strong>{porter.name}</strong>
                    <small>
                      {porter.username} · {porter.active ? "Ativo" : "Inativo"}
                      <br />
                      {formatExpiry(porter.access_expires_at)}
                      <br />
                      {formatLastActivity(
                        porter.auth_user_id
                          ? (lastActivity.get(porter.auth_user_id) ?? null)
                          : null,
                      )}
                      <br />
                      Origem: {portariaName(porter.home_portaria_id)} · Atual:{" "}
                      {portariaName(porter.current_portaria_id)}
                    </small>
                  </div>
                  <div className="manager-list-actions">
                    {porter.active ? (
                      <>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => handleChangePortaria(porter)}
                          disabled={!portarias.length}
                        >
                          Trocar portaria
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={
                            !porter.current_portaria_id ||
                            porter.current_portaria_id ===
                              porter.home_portaria_id
                          }
                          onClick={() =>
                            setPending({
                              action: "set-portaria",
                              porter,
                              portariaId: "home",
                            })
                          }
                        >
                          Voltar à origem
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => {
                            setRenewExpiry(
                              localDateTimeValue(
                                new Date(Date.now() + 7 * 86400000),
                              ),
                            );
                            setRenewDuration("seven-days");
                            setRenewingPorter(porter);
                          }}
                        >
                          Renovar prazo
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            setPending({ action: "reset-password", porter })
                          }
                        >
                          Nova senha
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() =>
                            setPending({ action: "deactivate", porter })
                          }
                        >
                          Desativar (férias)
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => {
                            setDeleteAccessTarget(porter);
                            setDeleteAccessText("");
                            setError("");
                          }}
                        >
                          Excluir acesso
                        </button>
                      </>
                    ) : (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setPending({ action: "activate", porter })}
                      >
                        Reativar e gerar senha
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {changingPorter && (
        <form
          className="manager-card manager-inline-renew"
          onSubmit={(event) => {
            event.preventDefault();
            const porter = changingPorter;
            setChangingPorter(null);
            setPending({
              action: "set-portaria",
              porter,
              portariaId: targetPortariaId,
            });
          }}
        >
          <label>
            Nova portaria para {changingPorter.name}
            <select
              value={targetPortariaId}
              onChange={(event) => setTargetPortariaId(event.target.value)}
              required
            >
              <option value="">Selecione a portaria</option>
              {portarias.map((portaria) => (
                <option key={portaria.id} value={portaria.id}>
                  {portaria.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" disabled={!targetPortariaId}>
              Continuar
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setChangingPorter(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {renewingPorter && (
        <form className="manager-card manager-inline-renew" onSubmit={handleRenew}>
          <label>
            Novo prazo para {renewingPorter.name}
            <select
              value={renewDuration}
              onChange={(event) =>
                setRenewDuration(event.target.value as Duration)
              }
            >
              <option value="seven-days">7 dias</option>
              <option value="custom">Data personalizada</option>
            </select>
          </label>
          {renewDuration === "custom" && (
            <label>
              Vence em
              <input
                type="datetime-local"
                value={renewExpiry}
                onChange={(event) => setRenewExpiry(event.target.value)}
                required
              />
            </label>
          )}
          <div className="form-actions">
            <button type="submit" disabled={busy}>
              {busy ? "Renovando..." : "Renovar prazo"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setRenewingPorter(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {pending?.action === "reset-password" && (
        <ConfirmationDialog
          title="Gerar nova senha?"
          description={`A senha atual de ${pending.porter?.name ?? "o porteiro"} deixará de funcionar. A nova senha será exibida uma única vez.`}
          confirmLabel="Gerar nova senha"
          loading={busy}
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.action === "deactivate" && (
        <ConfirmationDialog
          title="Desativar porteiro (férias)?"
          description={`${pending.porter?.name ?? "O porteiro"} ficará sem acesso temporariamente. Os registros feitos por ele permanecem no caderno e ele poderá ser reativado depois.`}
          confirmLabel="Desativar"
          loading={busy}
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.action === "set-portaria" && (
        <ConfirmationDialog
          title="Trocar a portaria atual?"
          description={
            pending.portariaId === "home"
              ? `${pending.porter?.name ?? "O porteiro"} voltará à portaria de origem e passará a registrar e ver somente o caderno dela.`
              : `${pending.porter?.name ?? "O porteiro"} passará a registrar e ver somente o caderno de ${portariaName(pending.portariaId ?? null)}.`
          }
          confirmLabel="Confirmar troca"
          loading={busy}
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.action === "activate" && (
        <ConfirmationDialog
          title="Reativar porteiro?"
          description={`Uma nova senha temporária será gerada para ${pending.porter?.name ?? "o porteiro"}.`}
          confirmLabel="Reativar"
          loading={busy}
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
        />
      )}

      {deleteAccessTarget && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setDeleteAccessTarget(null);
              setDeleteAccessText("");
            }
          }}
        >
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-porter-access-title"
          >
            <h2 id="delete-porter-access-title">
              Excluir acesso de {deleteAccessTarget.name}?
            </h2>
            <p>
              Use esta opção para demissão. O login será bloqueado
              definitivamente e a conta não aparecerá mais na lista de ativos.
            </p>
            <p>
              <strong>
                NENHUM dado registrado será apagado. Tudo o que ele recebeu
                permanece no caderno pelo prazo de retenção configurado.
              </strong>
            </p>
            <label className="form-field">
              Digite <strong>{DELETE_ACCESS_CONFIRMATION}</strong> para confirmar
              <input
                autoComplete="off"
                value={deleteAccessText}
                onChange={(event) => setDeleteAccessText(event.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setDeleteAccessTarget(null);
                  setDeleteAccessText("");
                }}
              >
                Cancelar
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={
                  busy ||
                  deleteAccessText.trim().toUpperCase() !==
                    DELETE_ACCESS_CONFIRMATION
                }
                onClick={() => void confirmDeleteAccess()}
              >
                {busy ? "Excluindo acesso..." : "Excluir acesso"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
