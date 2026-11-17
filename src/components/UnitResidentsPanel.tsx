import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

type Resident = {
  id: string;
  name: string | null;
  whatsapp: string | null;
};

type UnitResidentsPanelProps = {
  unitId: string;
};

export function UnitResidentsPanel({ unitId }: UnitResidentsPanelProps) {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingResidentId, setEditingResidentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function loadResidents(): Promise<boolean> {
    const { data, error } = await supabase
      .from("unit_residents")
      .select("id, name, whatsapp")
      .eq("unit_id", unitId)
      .order("created_at");

    if (error) {
      setErrorMessage(`Não foi possível carregar os contatos. ${error.message}`);
      return false;
    }

    setResidents(data ?? []);
    return true;
  }

  useEffect(() => {
    let active = true;

    async function load() {
      const { data, error } = await supabase
        .from("unit_residents")
        .select("id, name, whatsapp")
        .eq("unit_id", unitId)
        .order("created_at");

      if (!active) return;

      if (error) {
        setErrorMessage(
          `Não foi possível carregar os contatos. ${error.message}`,
        );
      } else {
        setResidents(data ?? []);
      }
      setLoading(false);
    }

    void load().catch((error: unknown) => {
      if (!active) return;
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setErrorMessage(`Não foi possível carregar os contatos. ${message}`);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [unitId]);

  function startEditing(resident: Resident) {
    setEditingResidentId(resident.id);
    setName(resident.name ?? "");
    setWhatsapp(resident.whatsapp ?? "");
    setErrorMessage("");
    setSuccessMessage("");
  }

  function resetForm() {
    setEditingResidentId(null);
    setName("");
    setWhatsapp("");
    setErrorMessage("");
    setSuccessMessage("");
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    const cleanName = name.trim();
    const cleanWhatsapp = whatsapp.trim();
    if (!cleanName && !cleanWhatsapp) {
      setErrorMessage("Informe um nome ou WhatsApp para o contato.");
      return;
    }

    setSaving(true);
    try {
      const { error } = editingResidentId
        ? await supabase.rpc("update_unit_resident", {
            p_resident_id: editingResidentId,
            p_name: cleanName || null,
            p_whatsapp: cleanWhatsapp || null,
          })
        : await supabase.rpc("create_unit_resident", {
            p_unit_id: unitId,
            p_name: cleanName || null,
            p_whatsapp: cleanWhatsapp || null,
          });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      if (!(await loadResidents())) return;
      resetForm();
      setSuccessMessage(
        editingResidentId ? "Contato atualizado." : "Contato cadastrado.",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setErrorMessage(`Não foi possível salvar o contato. ${message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(resident: Resident) {
    const label = resident.name || resident.whatsapp || "este contato";
    if (!window.confirm(`Excluir ${label} desta unidade?`)) return;

    setErrorMessage("");
    setSuccessMessage("");
    try {
      const { error } = await supabase.rpc("delete_unit_resident", {
        p_resident_id: resident.id,
      });

      if (error) {
        setErrorMessage(`Não foi possível excluir o contato. ${error.message}`);
        return;
      }

      setResidents((current) =>
        current.filter((item) => item.id !== resident.id),
      );
      if (editingResidentId === resident.id) resetForm();
      setSuccessMessage("Contato excluído.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setErrorMessage(`Não foi possível excluir o contato. ${message}`);
    }
  }

  return (
    <div className="resident-panel">
      <h3>Moradores e contatos</h3>
      <p className="field-hint">
        Nome e WhatsApp são opcionais. Cadastre ao menos um dos dois por contato.
      </p>

      {loading ? (
        <p className="field-hint">Carregando contatos...</p>
      ) : residents.length === 0 ? (
        <p className="empty-state">Nenhum contato cadastrado para esta unidade.</p>
      ) : (
        <ul className="resident-list">
          {residents.map((resident) => (
            <li key={resident.id}>
              <span>
                <strong>{resident.name || "Sem nome"}</strong>
                <small>{resident.whatsapp || "Sem WhatsApp"}</small>
              </span>
              <div className="table-actions">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => startEditing(resident)}
                >
                  Editar
                </button>
                <button
                  className="text-button danger-text-button"
                  type="button"
                  onClick={() => void handleDelete(resident)}
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="resident-form" onSubmit={handleSave}>
        <label className="form-field">
          Nome do morador
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Opcional"
          />
        </label>
        <label className="form-field">
          WhatsApp
          <input
            autoComplete="tel"
            inputMode="tel"
            value={whatsapp}
            onChange={(event) => setWhatsapp(event.target.value)}
            placeholder="(11) 99999-9999 — opcional"
          />
        </label>
        <div className="form-actions">
          <button className="primary-button" disabled={saving}>
            {saving
              ? "Salvando..."
              : editingResidentId
                ? "Salvar contato"
                : "Adicionar contato"}
          </button>
          {editingResidentId && (
            <button
              className="secondary-button"
              type="button"
              onClick={resetForm}
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      {errorMessage && (
        <p className="feedback-message feedback-error" role="alert">
          {errorMessage}
        </p>
      )}
      {successMessage && (
        <p className="feedback-message feedback-success" role="status">
          {successMessage}
        </p>
      )}
    </div>
  );
}
