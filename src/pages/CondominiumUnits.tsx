import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { CondominiumOperators } from "./CondominiumOperators";
import { UnitResidentsPanel } from "../components/UnitResidentsPanel";
import { useAuth } from "../contexts/AuthContext";
import { generateUnitNumbers, parseUnitRange } from "../lib/unitGeneration";
import { groupUnitsByFloor } from "../lib/unitFloors";
import { supabase } from "../lib/supabase";

type Condominium = {
  id: string;
  name: string;
  block_count: number;
};

type Block = {
  id: string;
  name: string;
};

type Unit = {
  id: string;
  unit_number: string;
  block_id: string | null;
  status: "active" | "inactive";
};

export function CondominiumUnits() {
  const { condominiumId } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [condominium, setCondominium] = useState<Condominium | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadError, setLoadError] = useState("");
  const [blockName, setBlockName] = useState("");
  const [blockError, setBlockError] = useState("");
  const [blockSuccess, setBlockSuccess] = useState("");
  const [savingBlock, setSavingBlock] = useState(false);
  const [unitNumber, setUnitNumber] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [unitStatus, setUnitStatus] = useState<"active" | "inactive">("active");
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [expandedResidentsUnitId, setExpandedResidentsUnitId] = useState<
    string | null
  >(null);
  const [unitError, setUnitError] = useState("");
  const [unitSuccess, setUnitSuccess] = useState("");
  const [savingUnit, setSavingUnit] = useState(false);
  const [deletingUnitId, setDeletingUnitId] = useState<string | null>(null);
  const [unitRange, setUnitRange] = useState("101-107");
  const [lastFloor, setLastFloor] = useState("9");
  const [savingBatch, setSavingBatch] = useState(false);
  const [managementTab, setManagementTab] = useState<"units" | "team">("units");
  const [unitMode, setUnitMode] = useState<"single" | "batch">("single");

  useEffect(() => {
    let active = true;

    async function loadPage() {
      if (!user || !condominiumId) {
        setLoadError("Condomínio não informado.");
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
        setLoadError(`Não foi possível verificar as permissões. ${profileError.message}`);
        setLoading(false);
        return;
      }

      if (!profile?.is_super_admin) {
        setLoading(false);
        return;
      }

      setIsSuperAdmin(true);

      const [condominiumResult, blocksResult, unitsResult] = await Promise.all([
        supabase
          .from("condominiums")
          .select("id, name, block_count")
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

      const dataError =
        condominiumResult.error ?? blocksResult.error ?? unitsResult.error;
      if (dataError) {
        setLoadError(`Não foi possível carregar os dados. ${dataError.message}`);
      } else if (!condominiumResult.data) {
        setLoadError("Condomínio não encontrado.");
      } else {
        setCondominium(condominiumResult.data);
        setBlocks(blocksResult.data ?? []);
        setSelectedBlockId(blocksResult.data?.[0]?.id ?? "");
        setUnits(unitsResult.data ?? []);
      }

      setLoading(false);
    }

    void loadPage().catch((error: unknown) => {
      if (!active) return;
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setLoadError(`Não foi possível carregar os dados. ${message}`);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId, user]);

  async function handleAddBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!condominiumId) return;

    setBlockError("");
    setBlockSuccess("");
    setSavingBlock(true);

    try {
      const name = blockName.trim();
      const { data, error } = await supabase.rpc("add_condominium_block", {
        p_condominium_id: condominiumId,
        p_name: name,
      });

      if (error) {
        setBlockError(error.message);
        return;
      }
      if (!data) {
        setBlockError("O bloco foi salvo, mas a API não retornou o identificador.");
        return;
      }

      setBlocks((current) =>
        [...current, { id: data, name }].sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR", { numeric: true }),
        ),
      );
      setCondominium((current) =>
        current
          ? {
              ...current,
              block_count: Math.max(current.block_count, blocks.length + 1),
            }
          : current,
      );
      setSelectedBlockId(data);
      setBlockName("");
      setBlockSuccess("Bloco cadastrado.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setBlockError(`Não foi possível cadastrar o bloco. ${message}`);
    } finally {
      setSavingBlock(false);
    }
  }

  function startEditingUnit(unit: Unit) {
    setEditingUnitId(unit.id);
    setUnitNumber(unit.unit_number);
    setSelectedBlockId(unit.block_id ?? "");
    setUnitStatus(unit.status);
    setUnitMode("single");
    setUnitError("");
    setUnitSuccess("");
    document
      .getElementById("unit-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelUnitEdit() {
    setEditingUnitId(null);
    setUnitNumber("");
    setUnitStatus("active");
    setUnitError("");
    setUnitSuccess("");
  }

  async function handleSaveUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!condominiumId) return;

    setUnitError("");
    setUnitSuccess("");
    setSavingUnit(true);

    try {
      const number = unitNumber.trim();
      const blockId = selectedBlockId || null;

      if (editingUnitId) {
        const { error } = await supabase.rpc("update_unit", {
          p_unit_id: editingUnitId,
          p_block_id: blockId,
          p_unit_number: number,
          p_status: unitStatus,
        });

        if (error) {
          setUnitError(error.message);
          return;
        }

        setUnits((current) =>
          current
            .map((unit) =>
              unit.id === editingUnitId
                ? {
                    ...unit,
                    unit_number: number,
                    block_id: blockId,
                    status: unitStatus,
                  }
                : unit,
            )
            .sort((a, b) =>
              a.unit_number.localeCompare(b.unit_number, "pt-BR", {
                numeric: true,
              }),
            ),
        );
        setUnitSuccess("Unidade atualizada.");
      } else {
        const { data, error } = await supabase.rpc("create_unit", {
          p_condominium_id: condominiumId,
          p_block_id: blockId,
          p_unit_number: number,
        });

        if (error) {
          setUnitError(error.message);
          return;
        }
        if (!data) {
          setUnitError("A unidade foi salva, mas a API não retornou o identificador.");
          return;
        }

        setUnits((current) =>
          [...current, {
            id: data,
            unit_number: number,
            block_id: blockId,
            status: "active" as const,
          }].sort((a, b) =>
            a.unit_number.localeCompare(b.unit_number, "pt-BR", {
              numeric: true,
            }),
          ),
        );
        setUnitSuccess(
          `Unidade ${number} cadastrada${blockId ? ` no bloco ${blocks.find((block) => block.id === blockId)?.name ?? ""}` : ""}.`,
        );
      }

      setEditingUnitId(null);
      setUnitNumber("");
      setUnitStatus("active");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setUnitError(`Não foi possível salvar a unidade. ${message}`);
    } finally {
      setSavingUnit(false);
    }
  }

  async function handleSaveBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!condominiumId) return;

    setUnitError("");
    setUnitSuccess("");
    setSavingBatch(true);

    try {
      const range = parseUnitRange(unitRange);
      const unitNumbers = generateUnitNumbers(range, Number(lastFloor));
      const blockId = selectedBlockId || null;
      const existingNumbers = new Set(
        units
          .filter((unit) => unit.block_id === blockId)
          .map((unit) => unit.unit_number.toLocaleLowerCase("pt-BR")),
      );
      if (
        unitNumbers.some((number) =>
          existingNumbers.has(number.toLocaleLowerCase("pt-BR")),
        )
      ) {
        throw new Error(
          "A faixa inclui apartamentos já cadastrados neste bloco. Ajuste a faixa e tente novamente.",
        );
      }

      const { error } = await supabase.rpc("create_units_batch", {
        p_condominium_id: condominiumId,
        p_block_id: blockId,
        p_unit_numbers: unitNumbers,
      });

      if (error) {
        setUnitError(error.message);
        return;
      }

      const { data, error: refreshError } = await supabase
        .from("units")
        .select("id, unit_number, block_id, status")
        .eq("condominium_id", condominiumId)
        .order("unit_number");

      if (refreshError) {
        setUnitError(
          `Os apartamentos foram criados, mas não foi possível atualizar a lista. ${refreshError.message}`,
        );
        return;
      }

      setUnits(data ?? []);
      setUnitSuccess(
        `${unitNumbers.length} apartamento(s) cadastrado(s) em ${blockId ? blocks.find((block) => block.id === blockId)?.name ?? "bloco selecionado" : "condomínio sem blocos"}.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setUnitError(message);
    } finally {
      setSavingBatch(false);
    }
  }

  async function handleDeleteUnit(unit: Unit) {
    const blockName = blocks.find((block) => block.id === unit.block_id)?.name;
    const location = blockName ? ` do bloco ${blockName}` : "";
    if (
      !window.confirm(
        `Excluir o apartamento ${unit.unit_number}${location}? Os contatos associados também serão excluídos.`,
      )
    ) {
      return;
    }

    setUnitError("");
    setUnitSuccess("");
    setDeletingUnitId(unit.id);
    try {
      const { error } = await supabase.rpc("delete_unit", {
        p_unit_id: unit.id,
      });

      if (error) {
        setUnitError(`Não foi possível excluir o apartamento. ${error.message}`);
        return;
      }

      setUnits((current) => current.filter((item) => item.id !== unit.id));
      if (expandedResidentsUnitId === unit.id) {
        setExpandedResidentsUnitId(null);
      }
      if (editingUnitId === unit.id) cancelUnitEdit();
      setUnitSuccess(`Apartamento ${unit.unit_number} excluído.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setUnitError(`Não foi possível excluir o apartamento. ${message}`);
    } finally {
      setDeletingUnitId(null);
    }
  }

  const selectedBlock = blocks.find((block) => block.id === selectedBlockId);
  const displayedUnits = blocks.length
    ? units.filter((unit) => unit.block_id === selectedBlockId)
    : units;
  const floorGroups = groupUnitsByFloor(displayedUnits);

  let batchPreview = "";
  try {
    const previewNumbers = generateUnitNumbers(
      parseUnitRange(unitRange),
      Number(lastFloor),
    );
    if (previewNumbers.length > 0) {
      batchPreview = `${previewNumbers.length} unidade(s): ${previewNumbers[0]} a ${previewNumbers[previewNumbers.length - 1]}`;
    }
  } catch {
    batchPreview = "";
  }

  function handleTabsKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();

    const next =
      event.key === "ArrowLeft" || event.key === "Home"
        ? "units"
        : "team";
    setManagementTab(next);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next === "units" ? 0 : 1]?.focus();
  }

  if (loading) {
    return <div className="loading-screen">Carregando unidades...</div>;
  }

  if (loadError) {
    return (
      <main className="dashboard">
        <p className="feedback-message feedback-error" role="alert">
          {loadError}
        </p>
        <Link className="text-button" to="/">
          Voltar aos condomínios
        </Link>
      </main>
    );
  }

  if (!isSuperAdmin || !condominium) {
    return (
      <main className="dashboard">
        <section className="welcome-card">
          <h1>Acesso restrito</h1>
          <p>Somente o Super Admin pode gerenciar estas unidades.</p>
          <Link className="text-button" to="/">
            Voltar aos condomínios
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Controle de Encomendas</p>
          <h1>{condominium.name}</h1>
          <p>
            {blocks.length} bloco(s) cadastrado(s)
            {condominium.block_count > blocks.length
              ? ` de ${condominium.block_count} previsto(s)`
              : ""}
          </p>
        </div>
        <Link className="text-button" to="/">
          Voltar aos condomínios
        </Link>
      </header>

      <nav
        className="admin-tabs"
        role="tablist"
        aria-label="Gerenciamento do condomínio"
        onKeyDown={handleTabsKeyDown}
      >
        <button
          className="admin-tab"
          id="admin-tab-units"
          role="tab"
          type="button"
          aria-selected={managementTab === "units"}
          aria-controls="admin-panel-units"
          onClick={() => setManagementTab("units")}
        >
          Blocos e unidades
        </button>
        <button
          className="admin-tab"
          id="admin-tab-team"
          role="tab"
          type="button"
          aria-selected={managementTab === "team"}
          aria-controls="admin-panel-team"
          onClick={() => setManagementTab("team")}
        >
          Equipe
        </button>
      </nav>

      <div
        className="admin-tab-panel"
        id={managementTab === "units" ? "admin-panel-units" : "admin-panel-team"}
        role="tabpanel"
        aria-labelledby={managementTab === "units" ? "admin-tab-units" : "admin-tab-team"}
      >
        {managementTab === "team" ? (
          <CondominiumOperators condominiumId={condominium.id} />
        ) : (
          <>
          <section className="admin-section">
            <div className="section-heading">
              <div>
                <h2>Bloco de trabalho</h2>
                <p>
                  Escolha o bloco usado no cadastro e na listagem abaixo. Outros
                  blocos podem ser adicionados agora ou depois.
                </p>
              </div>
            </div>

            <div className="admin-context-bar">
              <div>
                <span className="admin-context-label">Bloco selecionado</span>
                <span className="admin-context-value">
                  {selectedBlock?.name ??
                    (blocks.length ? "Nenhum bloco selecionado" : "Sem blocos")}
                  {selectedBlock && (
                    <span className="admin-context-badge">Bloco atual</span>
                  )}
                </span>
              </div>
              <div className="admin-context-meta">
                {displayedUnits.length} unidade(s) neste bloco
                {condominium.block_count > blocks.length
                  ? ` · ${condominium.block_count} previsto(s)`
                  : ""}
              </div>
            </div>

            {blocks.length > 0 ? (
              <div className="block-list" aria-label="Blocos cadastrados">
                {blocks.map((block) => {
                  const blockUnits = units.filter(
                    (unit) => unit.block_id === block.id,
                  ).length;
                  return (
                    <button
                      key={block.id}
                      className={`block-choice${selectedBlockId === block.id ? " block-choice-active" : ""}`}
                      type="button"
                      disabled={Boolean(editingUnitId)}
                      aria-pressed={selectedBlockId === block.id}
                      onClick={() => setSelectedBlockId(block.id)}
                    >
                      <strong>{block.name}</strong>
                      <span>{blockUnits} apartamento(s)</span>
                      {selectedBlockId === block.id && <small>Bloco atual</small>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="field-hint">
                {condominium.block_count > 0
                  ? "Nenhum bloco cadastrado ainda. Cadastre um bloco abaixo para começar."
                  : "Este condomínio foi cadastrado sem blocos."}
              </p>
            )}

            <form className="inline-form admin-inline-compact" onSubmit={handleAddBlock}>
              <label className="form-field">
                Nome ou identificação do bloco
                <input
                  required
                  placeholder="Ex.: A, Bloco 2, Torre Sul"
                  value={blockName}
                  onChange={(event) => setBlockName(event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={savingBlock}>
                {savingBlock ? "Salvando..." : "Adicionar bloco"}
              </button>
            </form>

            {blockError && (
              <p className="feedback-message feedback-error" role="alert">
                {blockError}
              </p>
            )}
            {blockSuccess && (
              <p className="feedback-message feedback-success" role="status">
                {blockSuccess}
              </p>
            )}
          </section>

          <section className="admin-section" id="unit-form">
            <div className="section-heading">
              <div>
                <h2>
                  {editingUnitId
                    ? `Editar unidade ${unitNumber || ""}`
                    : "Cadastrar unidades"}
                </h2>
                <p>
                  {editingUnitId
                    ? "Altere os dados e salve para voltar ao cadastro rápido."
                    : "Unidades podem existir sem moradores cadastrados."}
                </p>
              </div>
            </div>

            <div
              className="admin-segmented"
              role="group"
              aria-label="Forma de cadastro"
            >
              <button
                type="button"
                aria-pressed={unitMode === "single" || Boolean(editingUnitId)}
                disabled={Boolean(editingUnitId)}
                onClick={() => setUnitMode("single")}
              >
                Unidade avulsa
              </button>
              <button
                type="button"
                aria-pressed={unitMode === "batch" && !editingUnitId}
                disabled={Boolean(editingUnitId)}
                onClick={() => setUnitMode("batch")}
              >
                Em lote
              </button>
            </div>

            <p className="admin-form-context">
              Bloco de trabalho:{" "}
              <strong>{selectedBlock?.name ?? "condomínio sem blocos"}</strong>.
              {unitMode === "batch" && !editingUnitId
                ? " As unidades geradas serão criadas neste bloco."
                : " Para trocar, selecione outro bloco acima."}
            </p>

            {unitError && (
              <p className="feedback-message feedback-error" role="alert">
                {unitError}
              </p>
            )}
            {unitSuccess && (
              <p className="feedback-message feedback-success" role="status">
                {unitSuccess}
              </p>
            )}

            {unitMode === "single" || editingUnitId ? (
              <form className="inline-form" onSubmit={handleSaveUnit}>
                {blocks.length === 0 && condominium.block_count > 0 && (
                  <p className="field-hint">
                    Cadastre ao menos um bloco antes de criar unidades.
                  </p>
                )}

                <label className="form-field">
                  Número do apartamento ou sala
                  <input
                    required
                    value={unitNumber}
                    onChange={(event) => setUnitNumber(event.target.value)}
                  />
                </label>

                {editingUnitId && (
                  <label className="form-field">
                    Status
                    <select
                      value={unitStatus}
                      onChange={(event) =>
                        setUnitStatus(event.target.value as "active" | "inactive")
                      }
                    >
                      <option value="active">Ativo</option>
                      <option value="inactive">Inativo</option>
                    </select>
                  </label>
                )}

                <div className="form-actions">
                  <button
                    className="primary-button"
                    disabled={
                      savingUnit ||
                      (condominium.block_count > 0 && blocks.length === 0)
                    }
                  >
                    {savingUnit
                      ? "Salvando..."
                      : editingUnitId
                        ? "Salvar alterações"
                        : "Cadastrar unidade"}
                  </button>
                  {editingUnitId && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={cancelUnitEdit}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <form className="inline-form" onSubmit={handleSaveBatch}>
                <label className="form-field">
                  Faixa no primeiro andar
                  <input
                    required
                    inputMode="numeric"
                    placeholder="Ex.: 901-907"
                    value={unitRange}
                    onChange={(event) => setUnitRange(event.target.value)}
                  />
                </label>
                <label className="form-field floor-field">
                  Último andar a cadastrar
                  <input
                    required
                    inputMode="numeric"
                    min="0"
                    type="number"
                    value={lastFloor}
                    onChange={(event) => setLastFloor(event.target.value)}
                  />
                </label>

                <p className="admin-form-context">
                  Exemplo: faixa 101-107 e último andar 9 cria 101-107, 201-207
                  até 901-907. Para começar no 9º, use 901-907.
                </p>
                {batchPreview && (
                  <p className="admin-batch-preview" aria-live="polite">
                    {batchPreview}
                  </p>
                )}

                <div className="form-actions">
                  <button
                    className="primary-button"
                    disabled={
                      savingBatch ||
                      (condominium.block_count > 0 && !selectedBlockId)
                    }
                  >
                    {savingBatch ? "Cadastrando..." : "Gerar apartamentos"}
                  </button>
                </div>
              </form>
            )}

          <div className="section-heading units-heading">
            <h2>
              Unidades cadastradas
              {selectedBlock ? ` — ${selectedBlock.name}` : ""} ({displayedUnits.length})
            </h2>
          </div>
          {floorGroups.length === 0 ? (
            <p className="empty-state">Nenhuma unidade cadastrada ainda.</p>
          ) : (
            <div className="building-floor-list">
              {floorGroups.map((group) => (
                <section className="building-floor" key={group.key}>
                  <header className="building-floor-heading">
                    <strong>{group.label}</strong>
                    <span>{group.units.length} unidade(s)</span>
                  </header>
                  <div className="building-floor-units">
                    {group.units.map((unit) => (
                      <article className="building-unit" key={unit.id}>
                        <div className="building-unit-heading">
                          <strong>{unit.unit_number}</strong>
                          <span
                            className={`unit-status unit-status-${unit.status}`}
                          >
                            {unit.status === "active" ? "Ativo" : "Inativo"}
                          </span>
                        </div>
                        <div className="table-actions">
                          <button
                            className="text-button unit-action-edit"
                            type="button"
                            onClick={() => startEditingUnit(unit)}
                          >
                            Editar
                          </button>
                          <button
                            className="text-button unit-action-residents"
                            type="button"
                            aria-expanded={expandedResidentsUnitId === unit.id}
                            onClick={() =>
                              setExpandedResidentsUnitId((current) =>
                                current === unit.id ? null : unit.id,
                              )
                            }
                          >
                            Moradores
                          </button>
                          <button
                            className="text-button danger-text-button unit-action-delete"
                            type="button"
                            disabled={deletingUnitId === unit.id}
                            onClick={() => void handleDeleteUnit(unit)}
                          >
                            {deletingUnitId === unit.id
                              ? "Excluindo..."
                              : "Excluir"}
                          </button>
                        </div>
                        {expandedResidentsUnitId === unit.id && (
                          <UnitResidentsPanel unitId={unit.id} />
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          </section>
          </>
        )}
      </div>
    </main>
  );
}
