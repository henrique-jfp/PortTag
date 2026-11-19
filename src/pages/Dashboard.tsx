import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Building2 } from "lucide-react";
import { Link } from "react-router-dom";
import { PackageNotebook, type NotebookBuilding } from "../components/PackageNotebook";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

type AccessDuration =
  | "none"
  | "7d"
  | "14d"
  | "1m"
  | "3m"
  | "6m"
  | "1y";

const accessDurationOptions: { value: AccessDuration; label: string }[] = [
  { value: "none", label: "Sem expiração" },
  { value: "7d", label: "7 dias" },
  { value: "14d", label: "14 dias" },
  { value: "1m", label: "1 mês" },
  { value: "3m", label: "3 meses" },
  { value: "6m", label: "6 meses" },
  { value: "1y", label: "1 ano" },
];

function accessDurationLabel(value: string | null): string {
  return (
    accessDurationOptions.find((option) => option.value === value)?.label ??
    "Não informado"
  );
}

function accessExpiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Sem expiração";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "Data inválida";
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function isCondominiumExpired(condominium: Condominium): boolean {
  if (!condominium.access_expires_at) return false;
  return new Date(condominium.access_expires_at).getTime() <= Date.now();
}

type Condominium = {
  id: string;
  name: string;
  cep: string | null;
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  block_count: number;
  status: "active" | "inactive";
  access_expires_at: string | null;
  access_duration: string | null;
  created_at: string;
};

type ViaCepResponse = {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

type CepLookupStatus = "idle" | "loading" | "success" | "not-found" | "error";

type CondominiumForm = {
  name: string;
  cep: string;
  street: string;
  addressNumber: string;
  neighborhood: string;
  city: string;
  state: string;
  hasBlocks: boolean;
  blockCount: string;
  initialBlockName: string;
  accessDuration: AccessDuration;
};

const emptyForm: CondominiumForm = {
  name: "",
  cep: "",
  street: "",
  addressNumber: "",
  neighborhood: "",
  city: "",
  state: "",
  blockCount: "0",
  hasBlocks: false,
  initialBlockName: "",
  accessDuration: "none",
};

export function Dashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [listError, setListError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingCondominiumId, setEditingCondominiumId] = useState<string | null>(null);
  const [cepLookupStatus, setCepLookupStatus] =
    useState<CepLookupStatus>("idle");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Condominium | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [renewingCondominiumId, setRenewingCondominiumId] = useState("");
  const [renewDuration, setRenewDuration] = useState<AccessDuration>("1m");
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState("");
  const [notebookOpen, setNotebookOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
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
        setSetupError(
          `Não foi possível carregar o perfil. Confira se a migração do banco foi executada no Supabase. (${profileError.message})`,
        );
        setLoading(false);
        return;
      }

      if (!profile?.is_super_admin) {
        setLoading(false);
        return;
      }

      setIsSuperAdmin(true);

      const { data, error: condominiumsError } = await supabase
        .from("condominiums")
        .select(
          "id, name, cep, street, number, neighborhood, city, state, block_count, status, access_expires_at, access_duration, created_at",
        )
        .order("created_at", { ascending: false });

      if (!active) return;

      if (condominiumsError) {
        setListError(condominiumsError.message);
      } else {
        setCondominiums(data ?? []);
      }

      setLoading(false);
    }

    void loadDashboard().catch((error: unknown) => {
      if (!active) return;
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setSetupError(`Não foi possível carregar o painel. (${message})`);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    const cep = form.cep.replace(/\D/g, "");
    if (cep.length !== 8) return;

    const controller = new AbortController();
    let active = true;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `https://viacep.com.br/ws/${cep}/json/`,
            { signal: controller.signal },
          );
          if (!response.ok) {
            throw new Error("Falha na consulta do CEP.");
          }

          const address = (await response.json()) as ViaCepResponse;
          if (!active) return;

          if (address.erro) {
            setCepLookupStatus("not-found");
            return;
          }

          setForm((current) => ({
            ...current,
            street: current.street || address.logradouro || "",
            neighborhood: current.neighborhood || address.bairro || "",
            city: current.city || address.localidade || "",
            state: current.state || address.uf || "",
          }));
          setCepLookupStatus("success");
        } catch {
          if (active && !controller.signal.aborted) {
            setCepLookupStatus("error");
          }
        }
      })();
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [form.cep]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setSuccessMessage("");
    setSaving(true);

    try {
      const { error } = editingCondominiumId
        ? await supabase.rpc("update_condominium", {
            p_condominium_id: editingCondominiumId,
            p_name: form.name,
            p_cep: form.cep,
            p_street: form.street,
            p_address_number: form.addressNumber,
            p_neighborhood: form.neighborhood,
            p_city: form.city,
            p_state: form.state,
          })
        : await supabase.rpc("create_condominium", {
            p_name: form.name,
            p_cep: form.cep,
            p_street: form.street,
            p_address_number: form.addressNumber,
            p_complement: null,
            p_neighborhood: form.neighborhood,
            p_city: form.city,
            p_state: form.state,
            p_has_blocks: form.hasBlocks,
            p_block_count: form.hasBlocks ? Number(form.blockCount) : 0,
            p_initial_block_name: form.hasBlocks
              ? form.initialBlockName.trim()
              : null,
            p_access_duration: form.accessDuration,
          });

      if (error) {
        setFormError(error.message);
        return;
      }

      setForm(emptyForm);
      setEditingCondominiumId(null);
      setSuccessMessage(
        editingCondominiumId
          ? "Condomínio atualizado com sucesso."
          : "Condomínio cadastrado com sucesso.",
      );

      const { data, error: condominiumsError } = await supabase
        .from("condominiums")
        .select(
          "id, name, cep, street, number, neighborhood, city, state, block_count, status, access_expires_at, access_duration, created_at",
        )
        .order("created_at", { ascending: false });

      if (condominiumsError) {
        setListError(condominiumsError.message);
      } else {
        setListError("");
        setCondominiums(data ?? []);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setFormError(`Não foi possível cadastrar o condomínio. (${message})`);
    } finally {
      setSaving(false);
    }
  }

  function handleEditCondominium(condominium: Condominium) {
    setEditingCondominiumId(condominium.id);
    setCepLookupStatus("idle");
    setForm({
      ...emptyForm,
      name: condominium.name,
      cep: condominium.cep ?? "",
      street: condominium.street ?? "",
      addressNumber: condominium.number ?? "",
      neighborhood: condominium.neighborhood ?? "",
      city: condominium.city,
      state: condominium.state,
      hasBlocks: condominium.block_count > 0,
      blockCount: String(condominium.block_count),
      accessDuration: accessDurationOptions.some(
        (option) => option.value === condominium.access_duration,
      )
        ? (condominium.access_duration as AccessDuration)
        : "none",
    });
    document
      .getElementById("condominium-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleCancelEdit() {
    setEditingCondominiumId(null);
    setForm(emptyForm);
    setFormError("");
    setSuccessMessage("");
    setCepLookupStatus("idle");
  }

  async function handleDeleteCondominium(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (
      !deleteTarget ||
      deleteConfirmation.trim() !== deleteTarget.name.trim()
    ) {
      return;
    }

    setDeleting(true);
    setDeleteError("");

    try {
      const { error } = await supabase.rpc("delete_condominium", {
        p_condominium_id: deleteTarget.id,
      });

      if (error) {
        setDeleteError(error.message);
        return;
      }

      setCondominiums((current) =>
        current.filter((condominium) => condominium.id !== deleteTarget.id),
      );
      if (editingCondominiumId === deleteTarget.id) {
        handleCancelEdit();
      }
      setDeleteTarget(null);
      setDeleteConfirmation("");
      setSuccessMessage("Condomínio excluído.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setDeleteError(`Não foi possível excluir o condomínio. ${message}`);
    } finally {
      setDeleting(false);
    }
  }

  async function handleRenewAccess() {
    if (!renewingCondominiumId) return;

    setRenewing(true);
    setRenewError("");
    try {
      const { error } = await supabase.rpc("update_condominium_access", {
        p_condominium_id: renewingCondominiumId,
        p_access_duration: renewDuration,
      });
      if (error) {
        setRenewError(error.message);
        return;
      }

      const { data, error: listError } = await supabase
        .from("condominiums")
        .select(
          "id, name, cep, street, number, neighborhood, city, state, block_count, status, access_expires_at, access_duration, created_at",
        )
        .order("created_at", { ascending: false });
      if (listError) {
        setListError(listError.message);
        return;
      }
      setListError("");
      setCondominiums(data ?? []);
      setSuccessMessage("Prazo de acesso atualizado.");
      setRenewingCondominiumId("");
    } catch (error) {
      setRenewError(
        error instanceof Error ? error.message : "Falha inesperada.",
      );
    } finally {
      setRenewing(false);
    }
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setSetupError(`Não foi possível sair: ${error.message}`);
  }

  if (loading) {
    return <div className="loading-screen">Carregando painel...</div>;
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div className="admin-page-title">
          <p className="eyebrow">Controle de Encomendas</p>
          <h1>{isSuperAdmin ? "Painel do Super Admin" : "Acesso de operador"}</h1>
          <p>Conectado como {user?.email}</p>
        </div>
        <div className="admin-header-actions">
          {isSuperAdmin && (
            <nav className="admin-shortcuts" aria-label="Acesso rápido">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setNotebookOpen(true)}
              >
                Caderno
              </button>
              <Link className="secondary-button button-link" to="/label-lab">
                Label Lab
              </Link>
              <a className="secondary-button button-link" href="/porter.html">
                App Porteiro
              </a>
            </nav>
          )}
          <button className="secondary-button" onClick={handleSignOut}>
            Sair
          </button>
        </div>
      </header>

      {setupError ? (
        <p className="feedback-message feedback-error" role="alert">
          {setupError}
        </p>
      ) : !isSuperAdmin ? (
        <section className="welcome-card">
          <h2>Esta área é exclusiva do Super Admin</h2>
          <p>
            Entre no app do Síndico ou do Porteiro usando o endereço entregue
            pelo responsável pelo sistema.
          </p>
          <div className="header-actions">
            <a className="primary-button button-link" href="/manager.html">
              App Síndico
            </a>
            <a className="secondary-button button-link" href="/porter.html">
              App Porteiro
            </a>
          </div>
        </section>
      ) : notebookOpen ? (
        <PackageNotebook
          forceBuildingList
          buildings={condominiums.map((condominium): NotebookBuilding => ({
            id: condominium.id,
            name: condominium.name,
            meta: `${condominium.city}, ${condominium.state} · ${condominium.block_count} bloco(s)${condominium.status === "inactive" ? " · inativo" : ""}`,
          }))}
        />
      ) : (
        <>
          <section className="admin-section">
            <div className="section-heading">
              <div>
                <h2>
                  {editingCondominiumId
                    ? "Editar condomínio"
                    : "Cadastrar condomínio"}
                </h2>
                <p>
                  Cadastre unidades, vincule porteiros e registre os
                  recebimentos de cada condomínio.
                </p>
              </div>
            </div>

            <form
              id="condominium-form"
              className="condominium-form"
              onSubmit={handleSubmit}
            >
              <section className="admin-form-group" aria-label="Identificação">
                <h3>Identificação</h3>
                <div className="admin-form-grid">
                  <label className="form-field form-field-wide">
                    Nome do condomínio
                    <input
                      required
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="admin-form-group" aria-label="Endereço">
                <h3>Endereço</h3>
                <p className="admin-form-group-hint">
                  CEP, rua e número são conferidos na validação da etiqueta.
                </p>
                <div className="admin-form-grid">
                  <label className="form-field">
                    CEP
                    <input
                      required
                      autoComplete="postal-code"
                      inputMode="numeric"
                      value={form.cep}
                      onChange={(event) => {
                        const cep = event.target.value;
                        setCepLookupStatus(
                          cep.replace(/\D/g, "").length === 8 ? "loading" : "idle",
                        );
                        setForm((current) => {
                          const replaceAddress =
                            current.cep.replace(/\D/g, "").length === 8 &&
                            current.cep !== cep;
                          return {
                            ...current,
                            cep,
                            ...(replaceAddress
                              ? {
                                  street: "",
                                  neighborhood: "",
                                  city: "",
                                  state: "",
                                }
                              : {}),
                          };
                        });
                      }}
                    />
                    <span className="field-hint" aria-live="polite">
                      {cepLookupStatus === "loading" &&
                        "Buscando endereço pelo CEP..."}
                      {cepLookupStatus === "success" &&
                        "Endereço preenchido; confira os dados."}
                      {cepLookupStatus === "not-found" &&
                        "CEP não encontrado. Preencha o endereço manualmente."}
                      {cepLookupStatus === "error" &&
                        "Não foi possível consultar o CEP. Preencha o endereço manualmente."}
                    </span>
                  </label>

                  <label className="form-field form-field-wide">
                    Rua ou avenida
                    <input
                      required
                      autoComplete="address-line1"
                      value={form.street}
                      onChange={(event) =>
                        setForm({ ...form, street: event.target.value })
                      }
                    />
                  </label>

                  <label className="form-field">
                    Número
                    <input
                      required
                      autoComplete="address-line2"
                      value={form.addressNumber}
                      onChange={(event) =>
                        setForm({ ...form, addressNumber: event.target.value })
                      }
                    />
                  </label>

                  <label className="form-field">
                    Bairro
                    <input
                      required
                      autoComplete="address-level3"
                      value={form.neighborhood}
                      onChange={(event) =>
                        setForm({ ...form, neighborhood: event.target.value })
                      }
                    />
                  </label>

                  <label className="form-field">
                    Cidade
                    <input
                      required
                      autoComplete="address-level2"
                      value={form.city}
                      onChange={(event) =>
                        setForm({ ...form, city: event.target.value })
                      }
                    />
                  </label>

                  <label className="form-field">
                    Estado (UF)
                    <input
                      required
                      minLength={2}
                      maxLength={2}
                      autoComplete="address-level1"
                      value={form.state}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          state: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </label>
                </div>
              </section>

              {!editingCondominiumId && (
              <section className="admin-form-group" aria-label="Blocos">
                <h3>Blocos</h3>
                <p className="admin-form-group-hint">
                  Defina agora o primeiro bloco; os demais podem ser adicionados depois.
                </p>
                <div className="admin-form-grid">
                  <fieldset className="form-field form-field-wide choice-field">
                    <legend>Este edifício possui blocos?</legend>
                    <div className="choice-options">
                      <label>
                        <input
                          type="radio"
                          name="hasBlocks"
                          checked={!form.hasBlocks}
                          onChange={() =>
                            setForm((current) => ({
                              ...current,
                              hasBlocks: false,
                              blockCount: "0",
                              initialBlockName: "",
                            }))
                          }
                        />
                        Não
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="hasBlocks"
                          checked={form.hasBlocks}
                          onChange={() =>
                            setForm((current) => ({
                              ...current,
                              hasBlocks: true,
                              blockCount:
                                current.blockCount === "0"
                                  ? "1"
                                  : current.blockCount,
                            }))
                          }
                        />
                        Sim
                      </label>
                    </div>
                  </fieldset>

                  {form.hasBlocks && (
                  <>
                    <label className="form-field">
                      Quantos blocos existem?
                      <input
                        required
                        type="number"
                        min="1"
                        step="1"
                        value={form.blockCount}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            blockCount: event.target.value,
                          }))
                        }
                      />
                    </label>

                    <label className="form-field">
                      Qual bloco será cadastrado primeiro?
                      <input
                        required
                        placeholder="Ex.: A, Bloco 1, Torre Sul"
                        value={form.initialBlockName}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            initialBlockName: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </>
                  )}
                </div>
              </section>
              )}

              {!editingCondominiumId && (
                <section className="admin-form-group" aria-label="Prazo de acesso">
                  <h3>Prazo de acesso</h3>
                  <p className="admin-form-group-hint">
                    Defina por quanto tempo o síndico e o porteiro poderão usar o
                    aplicativo. A contagem começa na confirmação do cadastro e
                    pode ser renovada depois na lista de condomínios.
                  </p>
                  <div className="admin-form-grid">
                    <label className="form-field form-field-wide">
                      Duração do acesso
                      <select
                        required
                        value={form.accessDuration}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            accessDuration: event.target.value as AccessDuration,
                          }))
                        }
                      >
                        {accessDurationOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>
              )}

              <div className="admin-form-footer">
                {formError && (
                  <p className="feedback-message feedback-error" role="alert">
                    {formError}
                  </p>
                )}
                {successMessage && (
                  <p className="feedback-message feedback-success" role="status">
                    {successMessage}
                  </p>
                )}

                <div className="form-actions">
                  <button className="primary-button" disabled={saving}>
                    {saving
                      ? "Salvando..."
                      : editingCondominiumId
                        ? "Salvar alterações"
                        : "Cadastrar condomínio"}
                  </button>
                  {editingCondominiumId && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={handleCancelEdit}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            </form>
          </section>

          <section className="admin-section">
            <div className="section-heading">
              <div>
                <h2>Condomínios cadastrados</h2>
                <p>{condominiums.length} registro(s)</p>
              </div>
            </div>

            {listError && (
              <p className="feedback-message feedback-error" role="alert">
                Não foi possível carregar a lista: {listError}
              </p>
            )}

            {condominiums.length === 0 ? (
              <p className="empty-state">
                Nenhum condomínio cadastrado ainda.
              </p>
            ) : (
              <div className="admin-condominium-list">
                {condominiums.map((condominium) => (
                  <article
                    className="admin-condominium-card"
                    key={condominium.id}
                  >
                    <div className="admin-condominium-info">
                      <div className="admin-condominium-heading">
                        <span className="admin-condominium-icon" aria-hidden="true">
                          <Building2 size={18} />
                        </span>
                        <h3>{condominium.name}</h3>
                        <span
                          className={`admin-status-badge${
                            condominium.status === "active"
                              ? " is-active"
                              : " is-inactive"
                          }`}
                        >
                          {condominium.status === "active" ? "Ativo" : "Inativo"}
                        </span>
                      </div>
                      <p>
                        {condominium.city}, {condominium.state} ·{" "}
                        {condominium.street
                          ? `${condominium.street}, ${condominium.number ?? "s/n"}`
                          : "Endereço não informado"}
                      </p>
                      <p className="admin-condominium-meta">
                        {condominium.block_count} bloco(s)
                        {condominium.cep ? ` · CEP ${condominium.cep}` : ""}
                      </p>
                      <p className="admin-condominium-meta">
                        Acesso: {accessDurationLabel(condominium.access_duration)} ·{" "}
                        {accessExpiryLabel(condominium.access_expires_at)}
                        {isCondominiumExpired(condominium) && (
                          <strong className="access-expired-label"> · Vencido</strong>
                        )}
                      </p>
                      {renewingCondominiumId === condominium.id && (
                        <div className="renew-access-form">
                          {renewError && (
                            <p className="feedback-message feedback-error" role="alert">
                              {renewError}
                            </p>
                          )}
                          <label className="form-field">
                            Novo prazo
                            <select
                              value={renewDuration}
                              onChange={(event) =>
                                setRenewDuration(
                                  event.target.value as AccessDuration,
                                )
                              }
                            >
                              {accessDurationOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="form-actions">
                            <button
                              className="primary-button"
                              type="button"
                              disabled={renewing}
                              onClick={() => void handleRenewAccess()}
                            >
                              {renewing ? "Salvando..." : "Aplicar prazo"}
                            </button>
                            <button
                              className="secondary-button"
                              type="button"
                              disabled={renewing}
                              onClick={() => {
                                setRenewingCondominiumId("");
                                setRenewError("");
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="admin-card-actions">
                      <Link
                        className="secondary-button button-link"
                        to={`/condominiums/${condominium.id}/units`}
                      >
                        Abrir <ArrowUpRight size={15} aria-hidden="true" />
                      </Link>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          setRenewingCondominiumId(condominium.id);
                          setRenewDuration(
                            accessDurationOptions.some(
                              (option) => option.value === condominium.access_duration,
                            )
                              ? (condominium.access_duration as AccessDuration)
                              : "1m",
                          );
                          setRenewError("");
                        }}
                      >
                        Renovar prazo
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => handleEditCondominium(condominium)}
                      >
                        Editar
                      </button>
                      <button
                        className="text-button danger-text-button"
                        type="button"
                        onClick={() => {
                          setDeleteTarget(condominium);
                          setDeleteConfirmation("");
                          setDeleteError("");
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {deleteTarget && (
        <div className="dialog-backdrop">
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-condominium-title"
          >
            <h2 id="delete-condominium-title">Excluir condomínio?</h2>
            <p>
              Esta ação é permanente e também exclui os blocos, unidades e
              vínculos associados.
            </p>
            <form onSubmit={handleDeleteCondominium}>
              <label className="form-field">
                Digite <strong>{deleteTarget.name}</strong> para confirmar
                <input
                  autoComplete="off"
                  required
                  value={deleteConfirmation}
                  onChange={(event) =>
                    setDeleteConfirmation(event.target.value)
                  }
                />
              </label>
              {deleteError && (
                <p className="feedback-message feedback-error" role="alert">
                  {deleteError}
                </p>
              )}
              <div className="form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancelar
                </button>
                <button
                  className="danger-button"
                  disabled={
                    deleting ||
                    deleteConfirmation.trim() !== deleteTarget.name.trim()
                  }
                >
                  {deleting ? "Excluindo..." : "Excluir permanentemente"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
