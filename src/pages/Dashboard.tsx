import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Building2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { cepDigits, lookupCepAddress } from "../lib/addressLookup";
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

type OperationMode = "single" | "central" | "per_block";

const operationModeOptions: { value: OperationMode; label: string }[] = [
  { value: "single", label: "Bloco único" },
  { value: "central", label: "Vários blocos com portaria central" },
  { value: "per_block", label: "Vários blocos com portaria por bloco" },
];

function operationModeLabel(value: string | null | undefined): string {
  return (
    operationModeOptions.find((option) => option.value === value)?.label ??
    "Vários blocos com portaria por bloco"
  );
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
  operation_mode?: OperationMode | null;
  created_at: string;
};

type ResetPreview = {
  packages: number;
  package_events: number;
  package_notifications: number;
  residents: number;
  unit_residents: number;
  units: number;
  blocks: number;
  porter_accounts: number;
  condominium_users: number;
  whatsapp_instances: number;
  label_lab_samples: number;
  storage_objects: number;
};

const resetPreviewLabels: { key: keyof ResetPreview; label: string }[] = [
  { key: "packages", label: "Encomendas" },
  { key: "package_events", label: "Eventos de encomendas" },
  { key: "package_notifications", label: "Avisos ao morador" },
  { key: "residents", label: "Moradores" },
  { key: "unit_residents", label: "Contatos de unidade" },
  { key: "units", label: "Unidades" },
  { key: "blocks", label: "Blocos" },
  { key: "porter_accounts", label: "Porteiros" },
  { key: "condominium_users", label: "Vínculos de acesso" },
  { key: "whatsapp_instances", label: "Instâncias de WhatsApp" },
  { key: "label_lab_samples", label: "Amostras do Label Lab" },
  { key: "storage_objects", label: "Fotos e arquivos privados" },
];

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
  operationMode: OperationMode;
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
  operationMode: "per_block",
};

export function Dashboard({ listView = false }: { listView?: boolean }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [listError, setListError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [cepLookupStatus, setCepLookupStatus] =
    useState<CepLookupStatus>("idle");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Condominium | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [resetTarget, setResetTarget] = useState<Condominium | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetAck, setResetAck] = useState(false);
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null);
  const [loadingResetPreview, setLoadingResetPreview] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [renewingCondominiumId, setRenewingCondominiumId] = useState("");
  const [renewDuration, setRenewDuration] = useState<AccessDuration>("1m");
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState("");
  const [togglingCondominiumId, setTogglingCondominiumId] = useState("");
  const [updatingOperationId, setUpdatingOperationId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");

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
        .select("*")
        .order("created_at", { ascending: false });

      if (!active) return;

      if (condominiumsError) {
        setListError(condominiumsError.message);
      } else {
        const rows = (data ?? []) as Condominium[];
        setCondominiums(rows);
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
    const cep = cepDigits(form.cep);
    if (cep.length !== 8) return;

    const controller = new AbortController();
    let active = true;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const address = await lookupCepAddress(cep, controller.signal);
          if (!active) return;

          if (!address) {
            setCepLookupStatus("not-found");
            return;
          }

          setForm((current) => ({
            ...current,
            street: current.street || address.street,
            neighborhood: current.neighborhood || address.neighborhood,
            city: current.city || address.city,
            state: current.state || address.state,
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

  function applyCepValue(cep: string) {
    setCepLookupStatus(cepDigits(cep).length === 8 ? "loading" : "idle");
    setForm((current) => {
      const replaceAddress =
        cepDigits(current.cep).length === 8 && current.cep !== cep;
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
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setSuccessMessage("");
    setSaving(true);

    try {
      const args = {
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
      };
      const { error } = await supabase.rpc("create_condominium", {
        ...args,
        p_operation_mode: form.operationMode,
      });

      if (error) {
        setFormError(error.message);
        return;
      }

      setForm(emptyForm);
      setSuccessMessage("Condomínio cadastrado com sucesso.");

      const { data, error: condominiumsError } = await supabase
        .from("condominiums")
        .select("*")
        .order("created_at", { ascending: false });

      if (condominiumsError) {
        setListError(condominiumsError.message);
      } else {
        setListError("");
        const rows = (data ?? []) as Condominium[];
        setCondominiums(rows);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setFormError(`Não foi possível cadastrar o condomínio. (${message})`);
    } finally {
      setSaving(false);
    }
  }

  async function handleOperationModeChange(
    condominium: Condominium,
    operationMode: OperationMode,
  ) {
    setStatusError("");
    setStatusMessage("");
    setUpdatingOperationId(condominium.id);

    try {
      const { error } = await supabase.rpc("update_condominium_operation", {
        p_condominium_id: condominium.id,
        p_operation_mode: operationMode,
      });

      if (error) {
        setStatusError(error.message);
        return;
      }

      const rows = condominiums.map((item) =>
        item.id === condominium.id
          ? { ...item, operation_mode: operationMode }
          : item,
      );
      setCondominiums(rows);
      setStatusMessage("Modelo de operação atualizado.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setStatusError(`Não foi possível atualizar o modelo. (${message})`);
    } finally {
      setUpdatingOperationId("");
    }
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

  async function openResetDialog(condominium: Condominium) {
    setDeleteTarget(null);
    setResetTarget(condominium);
    setResetConfirmation("");
    setResetAck(false);
    setResetPreview(null);
    setResetError("");
    setLoadingResetPreview(true);

    try {
      const { data, error } = await supabase.rpc(
        "get_condominium_reset_preview",
        { p_condominium_id: condominium.id },
      );
      if (error) {
        setResetError(error.message);
        return;
      }
      setResetPreview((data ?? {}) as ResetPreview);
    } catch (error) {
      setResetError(
        error instanceof Error ? error.message : "Falha inesperada.",
      );
    } finally {
      setLoadingResetPreview(false);
    }
  }

  async function handleResetCondominium(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !resetTarget ||
      !resetAck ||
      resetConfirmation.trim() !== resetTarget.name.trim()
    ) {
      return;
    }

    setResetting(true);
    setResetError("");

    try {
      const { error } = await supabase.rpc("reset_condominium_data", {
        p_condominium_id: resetTarget.id,
        p_confirmation_name: resetConfirmation.trim(),
        p_ack: resetAck,
      });
      if (error) {
        setResetError(error.message);
        return;
      }

      const { data, error: listError } = await supabase
        .from("condominiums")
        .select("*")
        .order("created_at", { ascending: false });

      setResetTarget(null);
      setResetConfirmation("");
      setResetAck(false);
      setResetPreview(null);

      if (listError) {
        setStatusError(
          `Dados zerados, mas não foi possível atualizar a lista: ${listError.message}`,
        );
        return;
      }

      const rows = (data ?? []) as Condominium[];
      setCondominiums(rows);
      setSuccessMessage(
        `Dados de ${resetTarget.name} zerados. O cadastro do condomínio foi mantido.`,
      );
    } catch (error) {
      setResetError(
        error instanceof Error ? error.message : "Falha inesperada.",
      );
    } finally {
      setResetting(false);
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
        .select("*")
        .order("created_at", { ascending: false });
      if (listError) {
        setListError(listError.message);
        return;
      }
      setListError("");
      const rows = (data ?? []) as Condominium[];
      setCondominiums(rows);
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

  async function handleToggleStatus(condominium: Condominium) {
    const nextStatus = condominium.status === "active" ? "inactive" : "active";

    setTogglingCondominiumId(condominium.id);
    setStatusError("");
    setStatusMessage("");

    try {
      const { error } = await supabase.rpc("set_condominium_status", {
        p_condominium_id: condominium.id,
        p_status: nextStatus,
      });
      if (error) {
        setStatusError(error.message);
        return;
      }

      const { data, error: listError } = await supabase
        .from("condominiums")
        .select("*")
        .order("created_at", { ascending: false });
      if (listError) {
        setListError(listError.message);
        return;
      }
      setListError("");
      const rows = (data ?? []) as Condominium[];
      setCondominiums(rows);
      setStatusMessage(
        nextStatus === "active"
          ? `Acesso de ${condominium.name} reativado.`
          : `Acesso de ${condominium.name} suspenso. Os dados do condomínio foram mantidos.`,
      );
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : "Falha inesperada.",
      );
    } finally {
      setTogglingCondominiumId("");
    }
  }

  if (loading) {
    return <div className="loading-screen">Carregando painel...</div>;
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div className="admin-page-title">
          <p className="eyebrow">Controle de Encomendas</p>
          <h1>
            {isSuperAdmin
              ? listView
                ? "Condomínios"
                : "Painel do Super Admin"
              : "Acesso de operador"}
          </h1>
          <p>Conectado como {user?.email}</p>
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
            Entre no app Síndico ou na Portaria usando o endereço entregue pelo
            responsável pelo sistema.
          </p>
          <div className="header-actions">
            <a className="primary-button button-link" href="/manager.html">
              Síndico
            </a>
            <a className="secondary-button button-link" href="/porter.html">
              Portaria
            </a>
          </div>
        </section>
      ) : (
        <>
          <section className="admin-section" hidden={listView}>
            <div className="section-heading">
              <div>
                <h2>Cadastrar condomínio</h2>
                <p>
                  Cadastre unidades, vincule porteiros e registre os
                  recebimentos de cada condomínio. Nome e endereço são
                  definitivos após o cadastro; para suspender o acesso sem
                  excluir os dados, use a aba Condomínios.
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
                      onChange={(event) => applyCepValue(event.target.value)}
                      onBlur={(event) => {
                        // Alguns navegadores preenchem o CEP via autocomplete
                        // sem disparar o evento que o React observa.
                        if (event.target.value !== form.cep) {
                          applyCepValue(event.target.value);
                        }
                      }}
                    />
                    <span className="field-hint" aria-live="polite">
                      {cepLookupStatus === "idle" &&
                        "Digite o CEP para preencher o endereço."}
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

              <section className="admin-form-group" aria-label="Modelo de operação">
                <h3>Modelo de operação</h3>
                <p className="admin-form-group-hint">
                  Define como as portarias e os cadernos são organizados. O
                  padrão é um caderno por bloco.
                </p>
                <div className="admin-form-grid">
                  <label className="form-field form-field-wide">
                    Modelo de operação
                    <select
                      required
                      value={form.operationMode}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          operationMode: event.target.value as OperationMode,
                        }))
                      }
                    >
                      {operationModeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

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
                    {saving ? "Salvando..." : "Cadastrar condomínio"}
                  </button>
                </div>
              </div>
            </form>
          </section>

          <section className="welcome-card admin-home-summary" hidden={listView}>
            <h2>Condomínios cadastrados</h2>
            <p>
              {condominiums.length} registro(s) cadastrado(s). Gerencie blocos,
              unidades, porteiros e prazos de acesso na aba própria.
            </p>
            <div className="header-actions">
              <Link className="primary-button button-link" to="/condominiums">
                Abrir Condomínios
              </Link>
            </div>
          </section>

          <section className="admin-section" hidden={!listView}>
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
            {statusError && (
              <p className="feedback-message feedback-error" role="alert">
                {statusError}
              </p>
            )}
            {statusMessage && (
              <p className="feedback-message feedback-success" role="status">
                {statusMessage}
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
                        {condominium.block_count} bloco(s) ·{" "}
                        {operationModeLabel(condominium.operation_mode)}
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
                          <p className="field-hint">
                            Renovar o prazo não reativa um condomínio inativo.
                          </p>
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
                      <label className="form-field">
                        Modelo de operação
                        <select
                          value={
                            (condominium.operation_mode ?? "per_block") as OperationMode
                          }
                          disabled={updatingOperationId === condominium.id}
                          onChange={(event) =>
                            void handleOperationModeChange(
                              condominium,
                              event.target.value as OperationMode,
                            )
                          }
                        >
                          {operationModeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
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
                        className={`admin-status-toggle${
                          condominium.status === "active"
                            ? " is-active"
                            : " is-inactive"
                        }`}
                        type="button"
                        disabled={togglingCondominiumId === condominium.id}
                        aria-label={`Acesso de ${condominium.name} ${condominium.status === "active" ? "ativo" : "inativo"}. Clique para alternar.`}
                        title="Clique para suspender ou reativar o acesso"
                        onClick={() => void handleToggleStatus(condominium)}
                      >
                        {togglingCondominiumId === condominium.id
                          ? "Salvando..."
                          : condominium.status === "active"
                            ? "Ativo"
                            : "Inativo"}
                      </button>
                      <button
                        className="text-button danger-text-button"
                        type="button"
                        title="Apaga os dados do condomínio, mas mantém o cadastro"
                        onClick={() => void openResetDialog(condominium)}
                      >
                        Zerar dados
                      </button>
                      <button
                        className="text-button danger-text-button"
                        type="button"
                        onClick={() => {
                          setResetTarget(null);
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
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) {
              setDeleteTarget(null);
            }
          }}
        >
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

      {resetTarget && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !resetting) {
              setResetTarget(null);
            }
          }}
        >
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-condominium-title"
          >
            <h2 id="reset-condominium-title">
              Zerar dados de {resetTarget.name}?
            </h2>
            <p>
              Serão apagados encomendas, eventos, avisos, moradores, unidades,
              blocos, porteiros, vínculos de acesso, fotos e amostras do Label
              Lab deste condomínio. O cadastro — nome, endereço, status e prazo
              de acesso — e as regras do Label Lab serão mantidos.
            </p>
            <p>
              Contas de login e a instância externa de WhatsApp não são
              removidas automaticamente: apenas os vínculos e a configuração
              local são apagados.
            </p>

            {loadingResetPreview ? (
              <p className="field-hint" role="status">
                Carregando contadores...
              </p>
            ) : resetPreview ? (
              <div className="reset-summary">
                <h3>O que será apagado</h3>
                {resetPreviewLabels.every(
                  ({ key }) => Number(resetPreview[key] ?? 0) === 0,
                ) ? (
                  <p className="field-hint">
                    Nenhum registro apagável encontrado.
                  </p>
                ) : (
                  <ul className="reset-summary-list">
                    {resetPreviewLabels
                      .filter(
                        ({ key }) => Number(resetPreview[key] ?? 0) > 0,
                      )
                      .map(({ key, label }) => (
                        <li key={key}>
                          <span>{label}</span>
                          <strong>{Number(resetPreview[key] ?? 0)}</strong>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ) : null}

            <form onSubmit={handleResetCondominium}>
              <label className="form-field">
                Digite <strong>{resetTarget.name}</strong> para confirmar
                <input
                  autoComplete="off"
                  required
                  value={resetConfirmation}
                  onChange={(event) =>
                    setResetConfirmation(event.target.value)
                  }
                />
              </label>
              <label className="reset-ack">
                <input
                  type="checkbox"
                  required
                  checked={resetAck}
                  onChange={(event) => setResetAck(event.target.checked)}
                />
                <span>
                  Entendo que esta ação é irreversível e que os dados apagados
                  não poderão ser recuperados.
                </span>
              </label>
              {resetError && (
                <p className="feedback-message feedback-error" role="alert">
                  {resetError}
                </p>
              )}
              <div className="form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={resetting}
                  onClick={() => setResetTarget(null)}
                >
                  Cancelar
                </button>
                <button
                  className="danger-button"
                  disabled={
                    resetting ||
                    loadingResetPreview ||
                    !resetAck ||
                    resetConfirmation.trim() !== resetTarget.name.trim()
                  }
                >
                  {resetting ? "Zerando..." : "Zerar condomínio"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
