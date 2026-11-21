import { useEffect, useState, type FormEvent } from "react";
import { cepDigits, lookupCepAddress } from "../../lib/addressLookup";
import { supabase } from "../../lib/supabase";

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
  operation_mode?: "single" | "central" | "per_block" | null;
  notebook_retention_months?: number | null;
  created_at: string;
};

type FormState = {
  name: string;
  cep: string;
  street: string;
  addressNumber: string;
  neighborhood: string;
  city: string;
  state: string;
  retentionMonths: string;
};

const operationModeLabels: Record<string, string> = {
  single: "Bloco único",
  central: "Vários blocos com portaria central",
  per_block: "Vários blocos com portaria por bloco",
};

function toForm(data: Condominium): FormState {
  return {
    name: data.name,
    cep: data.cep ?? "",
    street: data.street ?? "",
    addressNumber: data.number ?? "",
    neighborhood: data.neighborhood ?? "",
    city: data.city,
    state: data.state,
    retentionMonths:
      data.notebook_retention_months == null
        ? ""
        : String(data.notebook_retention_months),
  };
}

export function ManagerCondominiumPanel({
  condominiumId,
}: {
  condominiumId: string;
}) {
  const [condominium, setCondominium] = useState<Condominium | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cepStatus, setCepStatus] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      const { data, error: queryError } = await supabase
        .from("condominiums")
        .select("*")
        .eq("id", condominiumId)
        .maybeSingle();
      if (!active) return;
      if (queryError) {
        setError(`Não foi possível carregar o condomínio. ${queryError.message}`);
      } else if (data) {
        setCondominium(data as Condominium);
        setForm(toForm(data as Condominium));
      } else {
        setError("Condomínio não encontrado.");
      }
      setLoading(false);
    })().catch((cause: unknown) => {
      if (!active) return;
      setError(
        cause instanceof Error ? cause.message : "Falha inesperada.",
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId]);

  useEffect(() => {
    const digits = cepDigits(form?.cep ?? "");
    if (digits.length !== 8) return;
    const controller = new AbortController();
    let active = true;

    void (async () => {
      setCepStatus("Consultando CEP...");
      try {
        const address = await lookupCepAddress(digits, controller.signal);
        if (!active) return;
        if (!address) {
          setCepStatus("CEP não encontrado.");
          return;
        }
        setForm((current) =>
          current
            ? {
                ...current,
                street: current.street || address.street,
                neighborhood: current.neighborhood || address.neighborhood,
                city: current.city || address.city,
                state: current.state || address.state,
              }
            : current,
        );
        setCepStatus("Endereço preenchido. Confira os campos.");
      } catch {
        if (active && !controller.signal.aborted) {
          setCepStatus("Não foi possível consultar o CEP. Preencha manualmente.");
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [form?.cep]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !condominium) return;

    const addressChanged =
      form.cep.trim() !== (condominium.cep ?? "").trim() ||
      form.street.trim() !== (condominium.street ?? "").trim() ||
      form.addressNumber.trim() !== (condominium.number ?? "").trim() ||
      form.neighborhood.trim() !== (condominium.neighborhood ?? "").trim() ||
      form.city.trim() !== condominium.city.trim() ||
      form.state.trim().toUpperCase() !== condominium.state.trim().toUpperCase();

    if (
      addressChanged &&
      !window.confirm(
        "Este endereço é usado para validar as etiquetas na portaria. Alterar incorretamente fará as entregas exibirem alerta de divergência. Deseja salvar?",
      )
    ) {
      return;
    }

    const retentionText = form.retentionMonths.trim();
    let retentionMonths: number | null = null;
    if (retentionText) {
      const parsed = Number(retentionText);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setError("Informe um número inteiro de meses ou deixe em branco.");
        return;
      }
      retentionMonths = parsed;
    }

    const currentRetention = condominium.notebook_retention_months ?? null;
    const retentionChanged = retentionMonths !== currentRetention;
    if (
      retentionChanged &&
      !window.confirm(
        retentionMonths === null
          ? "O caderno passará a ser mantido indefinidamente. Deseja salvar?"
          : `A retenção será de ${retentionMonths} meses. A limpeza do caderno é definitiva: registros e fotos mais antigos poderão ser apagados sem recuperação. Deseja continuar?`,
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const args = {
        p_condominium_id: condominiumId,
        p_name: form.name.trim(),
        p_cep: form.cep.trim(),
        p_street: form.street.trim(),
        p_address_number: form.addressNumber.trim(),
        p_neighborhood: form.neighborhood.trim(),
        p_city: form.city.trim(),
        p_state: form.state.trim(),
      };
      const { error: rpcError } = await supabase.rpc(
        "update_condominium",
        args,
      );
      if (rpcError) throw new Error(rpcError.message);

      if (retentionChanged) {
        const { error: retentionError } = await supabase.rpc(
          "update_notebook_retention",
          {
            p_condominium_id: condominiumId,
            p_retention_months: retentionMonths,
          },
        );
        if (retentionError) throw new Error(retentionError.message);
      }

      setSuccess("Dados do condomínio atualizados.");
      setCondominium((current) =>
        current
          ? {
              ...current,
              name: form.name.trim(),
              cep: form.cep.trim(),
              street: form.street.trim(),
              number: form.addressNumber.trim(),
              neighborhood: form.neighborhood.trim(),
              city: form.city.trim(),
              state: form.state.trim().toUpperCase(),
              notebook_retention_months: retentionMonths,
            }
          : current,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Não foi possível salvar. ${cause.message}`
          : "Não foi possível salvar.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="manager-panel">
      <div className="manager-panel-heading">
        <div>
          <p className="eyebrow">Configurações</p>
          <h2>Dados do condomínio</h2>
          <p>
            Endereço oficial usado na conferência determinística da etiqueta.
            Alterações aqui não afetam registros já salvos.
          </p>
        </div>
      </div>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}
      {success && <p className="feedback-message">{success}</p>}

      {loading || !form || !condominium ? (
        <p className="manager-empty">Carregando dados...</p>
      ) : (
        <div className="manager-card manager-narrow">
          <form className="manager-form" onSubmit={handleSave}>
            <label>
              Nome do condomínio
              <input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                required
              />
            </label>
            <label>
              CEP
              <input
                autoComplete="postal-code"
                inputMode="numeric"
                value={form.cep}
                onChange={(event) =>
                  setForm({ ...form, cep: event.target.value })
                }
                onBlur={(event) => {
                  if (event.target.value !== form.cep) {
                    setForm({ ...form, cep: event.target.value });
                  }
                }}
                required
              />
            </label>
            {cepStatus && <p className="field-hint">{cepStatus}</p>}
            <label>
              Rua / avenida
              <input
                value={form.street}
                onChange={(event) =>
                  setForm({ ...form, street: event.target.value })
                }
                required
              />
            </label>
            <div className="manager-form-row">
              <label>
                Número
                <input
                  value={form.addressNumber}
                  onChange={(event) =>
                    setForm({ ...form, addressNumber: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                Bairro
                <input
                  value={form.neighborhood}
                  onChange={(event) =>
                    setForm({ ...form, neighborhood: event.target.value })
                  }
                  required
                />
              </label>
            </div>
            <div className="manager-form-row">
              <label>
                Cidade
                <input
                  value={form.city}
                  onChange={(event) =>
                    setForm({ ...form, city: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                Estado
                <input
                  value={form.state}
                  maxLength={2}
                  onChange={(event) =>
                    setForm({ ...form, state: event.target.value })
                  }
                  required
                />
              </label>
            </div>
            <label>
              Manter registros do caderno por (meses)
              <input
                type="number"
                min="1"
                step="1"
                placeholder="Vazio = nunca apagar"
                value={form.retentionMonths}
                onChange={(event) =>
                  setForm({ ...form, retentionMonths: event.target.value })
                }
              />
            </label>
            <p className="field-hint">
              Deixe em branco para manter os registros para sempre. Os registros
              mais antigos que o prazo podem ser removidos pela limpeza automática.
            </p>
            <p className="field-hint">
              Blocos cadastrados: {condominium.block_count} · Situação:{" "}
              {condominium.status === "active" ? "Ativo" : "Inativo"} · Modelo:{" "}
              {operationModeLabels[condominium.operation_mode ?? ""] ??
                "Vários blocos com portaria por bloco"}
            </p>
            <div className="form-actions">
              <button type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Salvar alterações"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
