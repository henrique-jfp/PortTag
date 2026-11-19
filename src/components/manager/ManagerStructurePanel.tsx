import { useEffect, useState, type FormEvent } from "react";
import { ConfirmationDialog } from "../ConfirmationDialog";
import { UnitResidentsPanel } from "../UnitResidentsPanel";
import { supabase } from "../../lib/supabase";
import {
  generateUnitNumbers,
  parseUnitRange,
} from "../../lib/unitGeneration";

type Block = { id: string; name: string };
type Unit = {
  id: string;
  unit_number: string;
  block_id: string | null;
  status: "active" | "inactive";
};

type Tab = "units" | "residents";

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? `${fallback} ${cause.message}` : fallback;
}

export function ManagerStructurePanel({
  condominiumId,
  initialTab = "units",
}: {
  condominiumId: string;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [blockCount, setBlockCount] = useState(0);
  const [blockName, setBlockName] = useState("");
  const [savingBlock, setSavingBlock] = useState(false);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [unitNumber, setUnitNumber] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [unitStatus, setUnitStatus] = useState<"active" | "inactive">("active");
  const [editingUnitId, setEditingUnitId] = useState("");
  const [range, setRange] = useState("101-107");
  const [lastFloor, setLastFloor] = useState("9");
  const [search, setSearch] = useState("");
  const [residentUnitId, setResidentUnitId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      const [condominiumResult, blocksResult, unitsResult] = await Promise.all([
        supabase
          .from("condominiums")
          .select("block_count")
          .eq("id", condominiumId)
          .maybeSingle(),
        supabase
          .from("blocks")
          .select("id, name")
          .eq("condominium_id", condominiumId)
          .order("name"),
        supabase
          .from("units")
          .select("id, unit_number, block_id, status")
          .eq("condominium_id", condominiumId)
          .order("unit_number"),
      ]);

      if (!active) return;
      const failed =
        condominiumResult.error ?? blocksResult.error ?? unitsResult.error;
      if (failed) {
        setError(`Não foi possível carregar os cadastros. ${failed.message}`);
      } else {
        setBlockCount(condominiumResult.data?.block_count ?? 0);
        setBlocks(blocksResult.data ?? []);
        setUnits(unitsResult.data ?? []);
        setSelectedBlockId(blocksResult.data?.[0]?.id ?? "");
        setResidentUnitId(unitsResult.data?.[0]?.id ?? "");
      }
      setLoading(false);
    })().catch((cause: unknown) => {
      if (!active) return;
      setError(errorMessage(cause, "Não foi possível carregar os cadastros."));
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId]);

  function resetUnitForm() {
    setEditingUnitId("");
    setUnitNumber("");
    setUnitStatus("active");
  }

  function feedback(message: string, isError = false) {
    setError(isError ? message : "");
    setSuccess(isError ? "" : message);
  }

  async function handleAddBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingBlock(true);
    setError("");
    setSuccess("");
    try {
      const name = blockName.trim();
      const { data, error: rpcError } = await supabase.rpc(
        "add_condominium_block",
        { p_condominium_id: condominiumId, p_name: name },
      );
      if (rpcError) throw new Error(rpcError.message);
      setBlocks((current) =>
        [...current, { id: data as string, name }].sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR", { numeric: true }),
        ),
      );
      setBlockCount((current) => Math.max(current, blocks.length + 1));
      setSelectedBlockId(data as string);
      setBlockName("");
      feedback("Bloco cadastrado.");
    } catch (cause) {
      feedback(errorMessage(cause, "Não foi possível cadastrar o bloco."), true);
    } finally {
      setSavingBlock(false);
    }
  }

  async function handleSaveUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const number = unitNumber.trim();
      const blockId = blockCount > 0 ? selectedBlockId || null : null;
      if (blockCount > 0 && !blockId) {
        throw new Error("Selecione um bloco para a unidade.");
      }

      if (editingUnitId) {
        const { error: rpcError } = await supabase.rpc("update_unit", {
          p_unit_id: editingUnitId,
          p_block_id: blockId,
          p_unit_number: number,
          p_status: unitStatus,
        });
        if (rpcError) throw new Error(rpcError.message);
        setUnits((current) =>
          current.map((unit) =>
            unit.id === editingUnitId
              ? {
                  ...unit,
                  unit_number: number,
                  block_id: blockId,
                  status: unitStatus,
                }
              : unit,
          ),
        );
        feedback("Unidade atualizada.");
      } else {
        const { data, error: rpcError } = await supabase.rpc("create_unit", {
          p_condominium_id: condominiumId,
          p_block_id: blockId,
          p_unit_number: number,
        });
        if (rpcError) throw new Error(rpcError.message);
        setUnits((current) =>
          [
            ...current,
            {
              id: data as string,
              unit_number: number,
              block_id: blockId,
              status: unitStatus,
            },
          ].sort((a, b) =>
            a.unit_number.localeCompare(b.unit_number, "pt-BR", {
              numeric: true,
            }),
          ),
        );
        feedback("Unidade cadastrada.");
      }
      resetUnitForm();
    } catch (cause) {
      feedback(errorMessage(cause, "Não foi possível salvar a unidade."), true);
    } finally {
      setBusy(false);
    }
  }

  async function handleBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const blockId = blockCount > 0 ? selectedBlockId || null : null;
      if (blockCount > 0 && !blockId) {
        throw new Error("Selecione um bloco para as unidades.");
      }
      const numbers = generateUnitNumbers(
        parseUnitRange(range),
        Number(lastFloor),
      );
      const { data, error: rpcError } = await supabase.rpc(
        "create_units_batch",
        {
          p_condominium_id: condominiumId,
          p_block_id: blockId,
          p_unit_numbers: numbers,
        },
      );
      if (rpcError) throw new Error(rpcError.message);
      feedback(`${data as number} unidade(s) criada(s).`);

      const { data: refreshed } = await supabase
        .from("units")
        .select("id, unit_number, block_id, status")
        .eq("condominium_id", condominiumId)
        .order("unit_number");
      if (refreshed) setUnits(refreshed);
    } catch (cause) {
      feedback(errorMessage(cause, "Não foi possível gerar as unidades."), true);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteUnit() {
    if (!deleteTarget) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const { error: rpcError } = await supabase.rpc("delete_unit", {
        p_unit_id: deleteTarget.id,
      });
      if (rpcError) throw new Error(rpcError.message);
      setUnits((current) => current.filter((unit) => unit.id !== deleteTarget.id));
      if (editingUnitId === deleteTarget.id) resetUnitForm();
      if (residentUnitId === deleteTarget.id) setResidentUnitId("");
      feedback("Unidade excluída.");
    } catch (cause) {
      feedback(errorMessage(cause, "Não foi possível excluir a unidade."), true);
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  }

  const visibleUnits = units.filter((unit) =>
    `${unit.unit_number} ${blocks.find((block) => block.id === unit.block_id)?.name ?? ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(search.toLocaleLowerCase("pt-BR")),
  );

  return (
    <section className="manager-panel">
      <div className="manager-panel-heading">
        <div>
          <p className="eyebrow">Cadastros</p>
          <h2>Blocos, unidades e moradores</h2>
          <p>
            Estrutura usada para conferir o endereço das etiquetas e associar
            as encomendas.
          </p>
        </div>
      </div>

      <div className="manager-tabs" role="tablist" aria-label="Cadastros">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "units"}
          className={tab === "units" ? "is-active" : ""}
          onClick={() => setTab("units")}
        >
          Blocos e unidades
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "residents"}
          className={tab === "residents" ? "is-active" : ""}
          onClick={() => setTab("residents")}
        >
          Moradores e contatos
        </button>
      </div>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}
      {success && <p className="feedback-message">{success}</p>}

      {loading ? (
        <p className="manager-empty">Carregando cadastros...</p>
      ) : tab === "units" ? (
        <div className="manager-two-column">
          <div className="manager-card">
            <h3>Blocos</h3>
            <p className="field-hint">
              {blockCount > 0
                ? "Este condomínio usa blocos na identificação das unidades."
                : "Este condomínio não utiliza blocos."}
            </p>
            {blockCount > 0 && (
              <ul className="manager-list">
                {blocks.map((block) => (
                  <li key={block.id}>
                    <strong>{block.name}</strong>
                    <small>
                      {
                        units.filter((unit) => unit.block_id === block.id)
                          .length
                      }{" "}
                      unidade(s)
                    </small>
                  </li>
                ))}
              </ul>
            )}
            <form className="manager-inline-form" onSubmit={handleAddBlock}>
              <input
                aria-label="Nome do bloco"
                placeholder="Nome do novo bloco"
                value={blockName}
                onChange={(event) => setBlockName(event.target.value)}
                required
              />
              <button
                className="secondary-button"
                type="submit"
                disabled={savingBlock || !blockName.trim()}
              >
                {savingBlock ? "Salvando..." : "Adicionar bloco"}
              </button>
            </form>
          </div>

          <div className="manager-card">
            <h3>Unidades</h3>
            <div className="manager-mode-switch">
              <button
                type="button"
                className={mode === "single" ? "is-active" : ""}
                onClick={() => {
                  setMode("single");
                  resetUnitForm();
                }}
              >
                Uma
              </button>
              <button
                type="button"
                className={mode === "batch" ? "is-active" : ""}
                onClick={() => {
                  setMode("batch");
                  resetUnitForm();
                }}
              >
                Várias de uma vez
              </button>
            </div>

            {mode === "single" ? (
              <form
                className="manager-form"
                id="manager-unit-form"
                onSubmit={handleSaveUnit}
              >
                <label>
                  Número
                  <input
                    value={unitNumber}
                    onChange={(event) => setUnitNumber(event.target.value)}
                    placeholder="902"
                    required
                  />
                </label>
                {blockCount > 0 && (
                  <label>
                    Bloco
                    <select
                      value={selectedBlockId}
                      onChange={(event) =>
                        setSelectedBlockId(event.target.value)
                      }
                      required
                    >
                      <option value="">Selecione</option>
                      {blocks.map((block) => (
                        <option key={block.id} value={block.id}>
                          {block.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Situação
                  <select
                    value={unitStatus}
                    onChange={(event) =>
                      setUnitStatus(event.target.value as "active" | "inactive")
                    }
                  >
                    <option value="active">Ativa</option>
                    <option value="inactive">Inativa</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button type="submit" disabled={busy}>
                    {busy
                      ? "Salvando..."
                      : editingUnitId
                        ? "Salvar alterações"
                        : "Cadastrar unidade"}
                  </button>
                  {editingUnitId && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={resetUnitForm}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <form className="manager-form" onSubmit={handleBatch}>
                <label>
                  Faixa do primeiro andar
                  <input
                    value={range}
                    onChange={(event) => setRange(event.target.value)}
                    placeholder="101-107"
                    required
                  />
                </label>
                <label>
                  Último andar
                  <input
                    type="number"
                    min={1}
                    value={lastFloor}
                    onChange={(event) => setLastFloor(event.target.value)}
                    required
                  />
                </label>
                {blockCount > 0 && (
                  <label>
                    Bloco
                    <select
                      value={selectedBlockId}
                      onChange={(event) =>
                        setSelectedBlockId(event.target.value)
                      }
                      required
                    >
                      <option value="">Selecione</option>
                      {blocks.map((block) => (
                        <option key={block.id} value={block.id}>
                          {block.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="form-actions">
                  <button type="submit" disabled={busy}>
                    {busy ? "Gerando..." : "Gerar unidades"}
                  </button>
                </div>
                <p className="field-hint">
                  Exemplo: 101-107 até o andar 9 gera 901-907.
                </p>
              </form>
            )}
          </div>
        </div>
      ) : (
        <div className="manager-card">
          <h3>Moradores e contatos</h3>
          <p className="field-hint">
            Nome e WhatsApp são opcionais. Uma unidade pode existir sem morador
            cadastrado.
          </p>
          <label className="manager-field">
            Unidade
            <select
              value={residentUnitId}
              onChange={(event) => setResidentUnitId(event.target.value)}
            >
              <option value="">Selecione a unidade</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {blocks.find((block) => block.id === unit.block_id)?.name
                    ? `${blocks.find((block) => block.id === unit.block_id)?.name} · `
                    : ""}
                  {unit.unit_number}
                </option>
              ))}
            </select>
          </label>
          {residentUnitId ? (
            <UnitResidentsPanel key={residentUnitId} unitId={residentUnitId} />
          ) : (
            <p className="manager-empty">Selecione uma unidade para continuar.</p>
          )}
        </div>
      )}

      {tab === "units" && (
        <div className="manager-card">
          <div className="manager-list-heading">
            <h3>Unidades cadastradas</h3>
            <input
              type="search"
              placeholder="Buscar unidade ou bloco"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {visibleUnits.length === 0 ? (
            <p className="manager-empty">Nenhuma unidade encontrada.</p>
          ) : (
            <ul className="manager-list">
              {visibleUnits.map((unit) => (
                <li key={unit.id}>
                  <div>
                    <strong>
                      {blocks.find((block) => block.id === unit.block_id)?.name
                        ? `${blocks.find((block) => block.id === unit.block_id)?.name} · `
                        : ""}
                      {unit.unit_number}
                    </strong>
                    <small>
                      {unit.status === "active" ? "Ativa" : "Inativa"}
                    </small>
                  </div>
                  <div className="manager-list-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setEditingUnitId(unit.id);
                        setUnitNumber(unit.unit_number);
                        setSelectedBlockId(unit.block_id ?? "");
                        setUnitStatus(unit.status);
                        setMode("single");
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setResidentUnitId(unit.id);
                        setTab("residents");
                      }}
                    >
                      Moradores
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => setDeleteTarget(unit)}
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {deleteTarget && (
        <ConfirmationDialog
          title="Excluir unidade?"
          description={`A unidade ${deleteTarget.unit_number} e seus moradores serão removidos. Encomendas já registradas continuam no caderno.`}
          confirmLabel="Excluir unidade"
          loading={busy}
          onConfirm={confirmDeleteUnit}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}
