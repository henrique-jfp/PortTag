import { useEffect, useState, type FormEvent } from "react";
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
        .select(
          "id, name, cep, street, number, neighborhood, city, state, block_count, status, created_at",
        )
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
    const digits = (form?.cep ?? "").replace(/\D/g, "");
    if (digits.length !== 8) return;
    const controller = new AbortController();

    void (async () => {
      setCepStatus("Consultando CEP...");
      try {
        const response = await fetch(
          `https://viacep.com.br/ws/${digits}/json/`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Falha na consulta.");
        const address = (await response.json()) as {
          logradouro?: string;
          bairro?: string;
          localidade?: string;
          uf?: string;
          erro?: boolean;
        };
        if (address.erro) {
          setCepStatus("CEP não encontrado.");
          return;
        }
        setForm((current) =>
          current
            ? {
                ...current,
                street: current.street || address.logradouro || "",
                neighborhood: current.neighborhood || address.bairro || "",
                city: current.city || address.localidade || "",
                state: current.state || address.uf || "",
              }
            : current,
        );
        setCepStatus("Endereço preenchido. Confira os campos.");
      } catch {
        if (!controller.signal.aborted) {
          setCepStatus("Não foi possível consultar o CEP. Preencha manualmente.");
        }
      }
    })();

    return () => controller.abort();
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

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const { error: rpcError } = await supabase.rpc("update_condominium", {
        p_condominium_id: condominiumId,
        p_name: form.name.trim(),
        p_cep: form.cep.trim(),
        p_street: form.street.trim(),
        p_address_number: form.addressNumber.trim(),
        p_neighborhood: form.neighborhood.trim(),
        p_city: form.city.trim(),
        p_state: form.state.trim(),
      });
      if (rpcError) throw new Error(rpcError.message);
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
                value={form.cep}
                onChange={(event) =>
                  setForm({ ...form, cep: event.target.value })
                }
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
            <p className="field-hint">
              Blocos cadastrados: {condominium.block_count} · Situação:{" "}
              {condominium.status === "active" ? "Ativo" : "Inativo"}
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
