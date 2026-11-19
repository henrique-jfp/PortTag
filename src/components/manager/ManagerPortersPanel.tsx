import { useEffect, useState, type FormEvent } from "react";
import { ConfirmationDialog } from "../ConfirmationDialog";
import { supabase } from "../../lib/supabase";
import { normalizePorterUsername } from "../../lib/porterAccounts";

type Block = { id: string; name: string };
type Porter = {
  id: string;
  name: string;
  username: string;
  active: boolean;
  access_expires_at: string | null;
};
type Action = "create" | "reset-password" | "deactivate" | "activate" | "renew-access";
type Duration = "never" | "seven-days" | "custom";
type Credentials = { name?: string; username?: string; password: string };
type PendingAction = { action: Action; porter?: Porter };

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

export function ManagerPortersPanel({
  condominiumId,
}: {
  condominiumId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [porters, setPorters] = useState<Porter[]>([]);
  const [blockAssignments, setBlockAssignments] = useState<
    Map<string, string[]>
  >(new Map());
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [duration, setDuration] = useState<Duration>("never");
  const [customExpiry, setCustomExpiry] = useState("");
  const [renewDuration, setRenewDuration] = useState<Duration>("seven-days");
  const [renewExpiry, setRenewExpiry] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [renewingPorter, setRenewingPorter] = useState<Porter | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      const [blocksResult, portersResult, assignmentsResult] =
        await Promise.all([
          supabase
            .from("blocks")
            .select("id, name")
            .eq("condominium_id", condominiumId)
            .order("name"),
          supabase
            .from("porter_accounts")
            .select("id, name, username, active, access_expires_at")
            .eq("condominium_id", condominiumId)
            .order("name"),
          supabase.from("porter_blocks").select("porter_account_id, block_id"),
        ]);

      if (!active) return;
      const failed =
        blocksResult.error ?? portersResult.error ?? assignmentsResult.error;
      if (failed) {
        setError(`Não foi possível carregar os porteiros. ${failed.message}`);
      } else {
        setBlocks(blocksResult.data ?? []);
        setPorters(portersResult.data ?? []);
        const assignments = new Map<string, string[]>();
        (assignmentsResult.data ?? []).forEach((row) => {
          const current = assignments.get(row.porter_account_id) ?? [];
          current.push(row.block_id);
          assignments.set(row.porter_account_id, current);
        });
        setBlockAssignments(assignments);
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
    const [{ data: portersData }, { data: assignmentsData }] =
      await Promise.all([
        supabase
          .from("porter_accounts")
          .select("id, name, username, active, access_expires_at")
          .eq("condominium_id", condominiumId)
          .order("name"),
        supabase.from("porter_blocks").select("porter_account_id, block_id"),
      ]);
    if (portersData) setPorters(portersData);
    if (assignmentsData) {
      const assignments = new Map<string, string[]>();
      assignmentsData.forEach((row) => {
        const current = assignments.get(row.porter_account_id) ?? [];
        current.push(row.block_id);
        assignments.set(row.porter_account_id, current);
      });
      setBlockAssignments(assignments);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCredentials(null);
    try {
      const accessExpiresAt = expiryFrom(duration, customExpiry);
      const created = await invoke("create", {
        name: name.trim(),
        username: normalizePorterUsername(username),
        blockIds: selectedBlockIds,
        accessExpiresAt,
      });
      if (created) {
        setName("");
        setUsername("");
        setSelectedBlockIds([]);
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
    const { action, porter } = pending;
    setPending(null);
    if (!porter || action === "create") return;

    setCredentials(null);
    const done = await invoke(action, { porterAccountId: porter.id });
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

  function toggleBlock(blockId: string) {
    setSelectedBlockIds((current) =>
      current.includes(blockId)
        ? current.filter((id) => id !== blockId)
        : [...current, blockId],
    );
  }

  return (
    <section className="manager-panel">
      <div className="manager-panel-heading">
        <div>
          <p className="eyebrow">Equipe</p>
          <h2>Porteiros</h2>
          <p>
            Contas de operação com acesso restrito ao seu condomínio e aos
            blocos selecionados.
          </p>
        </div>
      </div>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}
      {success && <p className="feedback-message">{success}</p>}

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
            {blocks.length > 0 && (
              <fieldset className="manager-fieldset">
                <legend>Blocos de atuação</legend>
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
              </fieldset>
            )}
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
              <button type="submit" disabled={busy}>
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
                      Blocos:{" "}
                      {(blockAssignments.get(porter.id) ?? [])
                        .map(
                          (blockId) =>
                            blocks.find((block) => block.id === blockId)?.name ??
                            "—",
                        )
                        .join(", ") || "Todos"}
                    </small>
                  </div>
                  <div className="manager-list-actions">
                    {porter.active ? (
                      <>
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
                          className="danger-button"
                          type="button"
                          onClick={() =>
                            setPending({ action: "deactivate", porter })
                          }
                        >
                          Remover acesso
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
          title="Remover acesso?"
          description={`O porteiro ${pending.porter?.name ?? ""} perderá o acesso ao app imediatamente.`}
          confirmLabel="Remover acesso"
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
    </section>
  );
}
