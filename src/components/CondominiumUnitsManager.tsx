import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { ResidentsImportPanel } from "./ResidentsImportPanel";
import { UnitResidentsPanel } from "./UnitResidentsPanel";
import { generateUnitNumbers, parseUnitRange } from "../lib/unitGeneration";
import { groupUnitsByFloor } from "../lib/unitFloors";
import { supabase } from "../lib/supabase";

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

/**
 * Gestão completa de blocos, unidades e moradores. Usada tanto pelo Super Admin
 * (aba "Blocos e unidades") quanto pelo Síndico (página "Moradores"). Toda
 * escrita passa pelas RPCs, que validam o vínculo e o prazo do condomínio.
 */
export function CondominiumUnitsManager({
  condominiumId,
  blockCount,
}: {
  condominiumId: string;
  blockCount: number;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [blockName, setBlockName] = useState("");
  const [blockError, setBlockError] = useState("");
  const [blockSuccess, setBlockSuccess] = useState("");
  const [savingBlock, setSavingBlock] = useState(false);
  const [unitNumber, setUnitNumber] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [updatingUnitId, setUpdatingUnitId] = useState<string | null>(null);
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
  const [unitMode, setUnitMode] = useState<"single" | "batch" | "import">(
    "single",
  );
  const [unitSearch, setUnitSearch] = useState("");
  const [collapsedFloors, setCollapsedFloors] = useState<string[]>([]);
  const [deleteUnitTarget, setDeleteUnitTarget] = useState<Unit | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      const [blocksResult, unitsResult] = await Promise.all([
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
      const failed = blocksResult.error ?? unitsResult.error;
      if (failed) {
        setLoadError(`Não foi possível carregar os dados. ${failed.message}`);
      } else {
        setBlocks((blocksResult.data ?? []) as Block[]);
        setSelectedBlockId(blocksResult.data?.[0]?.id ?? "");
        setUnits((unitsResult.data ?? []) as Unit[]);
      }
      setLoading(false);
    })().catch((error: unknown) => {
      if (!active) return;
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setLoadError(`Não foi possível carregar os dados. ${message}`);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId]);

  async function handleAddBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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

  async function handleSaveUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setUnitError("");
    setUnitSuccess("");
    setSavingUnit(true);

    try {
      const number = unitNumber.trim();
      const blockId = selectedBlockId || null;
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
      setUnitNumber("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setUnitError(`Não foi possível salvar a unidade. ${message}`);
    } finally {
      setSavingUnit(false);
    }
  }

  async function toggleUnitStatus(unit: Unit) {
    const nextStatus = unit.status === "active" ? "inactive" : "active";

    setUnitError("");
    setUnitSuccess("");
    setUpdatingUnitId(unit.id);

    try {
      const { error } = await supabase.rpc("update_unit", {
        p_unit_id: unit.id,
        p_block_id: unit.block_id,
        p_unit_number: unit.unit_number,
        p_status: nextStatus,
      });

      if (error) {
        setUnitError(`Não foi possível alterar o status. ${error.message}`);
        return;
      }

      setUnits((current) =>
        current.map((item) =>
          item.id === unit.id ? { ...item, status: nextStatus } : item,
        ),
      );
      setUnitSuccess(
        `Apartamento ${unit.unit_number} marcado como ${nextStatus === "active" ? "ativo" : "inativo"}.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setUnitError(`Não foi possível alterar o status. ${message}`);
    } finally {
      setUpdatingUnitId(null);
    }
  }

  async function handleSaveBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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

      await reloadUnits();
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

  async function reloadUnits(preferredBlockName?: string | null) {
    const [blocksResult, unitsResult] = await Promise.all([
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

    const error = blocksResult.error ?? unitsResult.error;
    if (error) {
      setUnitError(
        `A importação terminou, mas não foi possível atualizar a lista. ${error.message}`,
      );
      return;
    }

    const nextBlocks = (blocksResult.data ?? []) as Block[];
    setBlocks(nextBlocks);
    setUnits((unitsResult.data ?? []) as Unit[]);
    setSelectedBlockId((current) => {
      if (preferredBlockName === null) return "";
      if (preferredBlockName) {
        const normalized = preferredBlockName.toLocaleLowerCase("pt-BR");
        const match = nextBlocks.find(
          (block) => block.name.toLocaleLowerCase("pt-BR") === normalized,
        );
        if (match) return match.id;
      }
      return nextBlocks.some((block) => block.id === current)
        ? current
        : (nextBlocks[0]?.id ?? "");
    });
  }

  function requestDeleteUnit(unit: Unit) {
    setDeleteUnitTarget(unit);
    setUnitError("");
    setUnitSuccess("");
  }

  async function confirmDeleteUnit() {
    const unit = deleteUnitTarget;
    if (!unit) return;

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
      setUnitSuccess(`Apartamento ${unit.unit_number} excluído.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setUnitError(`Não foi possível excluir o apartamento. ${message}`);
    } finally {
      setDeletingUnitId(null);
      setDeleteUnitTarget(null);
    }
  }

  const selectedBlock = blocks.find((block) => block.id === selectedBlockId);
  const noBlockUnits = units.filter((unit) => unit.block_id === null);
  const displayedUnits = blocks.length
    ? selectedBlockId === ""
      ? noBlockUnits
      : units.filter((unit) => unit.block_id === selectedBlockId)
    : units;
  const normalizedUnitSearch = unitSearch.trim().toLocaleLowerCase("pt-BR");
  const filteredUnits = normalizedUnitSearch
    ? displayedUnits.filter((unit) =>
        unit.unit_number.toLocaleLowerCase("pt-BR").includes(normalizedUnitSearch),
      )
    : displayedUnits;
  const floorGroups = groupUnitsByFloor(filteredUnits);
  const allFloorsCollapsed =
    floorGroups.length > 0 &&
    floorGroups.every((group) => collapsedFloors.includes(group.key));

  function toggleFloor(key: string) {
    setCollapsedFloors((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

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

  if (loading) {
    return <div className="loading-screen">Carregando unidades...</div>;
  }

  if (loadError) {
    return (
      <p className="feedback-message feedback-error" role="alert">
        {loadError}
      </p>
    );
  }

  return (
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
                (blocks.length
                  ? selectedBlockId === ""
                    ? "Sem bloco"
                    : "Nenhum bloco selecionado"
                  : "Sem blocos")}
              {selectedBlock && (
                <span className="admin-context-badge">Bloco atual</span>
              )}
            </span>
          </div>
          <div className="admin-context-meta">
            {displayedUnits.length} unidade(s) neste bloco
            {blockCount > blocks.length
              ? ` · ${blockCount} previsto(s)`
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
                  aria-pressed={selectedBlockId === block.id}
                  onClick={() => setSelectedBlockId(block.id)}
                >
                  <strong>{block.name}</strong>
                  <span>{blockUnits} apartamento(s)</span>
                  {selectedBlockId === block.id && <small>Bloco atual</small>}
                </button>
              );
            })}
            {noBlockUnits.length > 0 && (
              <button
                className={`block-choice${selectedBlockId === "" ? " block-choice-active" : ""}`}
                type="button"
                aria-pressed={selectedBlockId === ""}
                onClick={() => setSelectedBlockId("")}
              >
                <strong>Sem bloco</strong>
                <span>{noBlockUnits.length} apartamento(s)</span>
                {selectedBlockId === "" && <small>Bloco atual</small>}
              </button>
            )}
          </div>
        ) : (
          <p className="field-hint">
            {blockCount > 0
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
            <h2>Cadastrar unidades</h2>
            <p>Unidades podem existir sem moradores cadastrados.</p>
          </div>
        </div>

        <div
          className="admin-segmented"
          role="group"
          aria-label="Forma de cadastro"
        >
          <button
            type="button"
            aria-pressed={unitMode === "single"}
            onClick={() => setUnitMode("single")}
          >
            Unidade avulsa
          </button>
          <button
            type="button"
            aria-pressed={unitMode === "batch"}
            onClick={() => setUnitMode("batch")}
          >
            Em lote
          </button>
          <button
            type="button"
            aria-pressed={unitMode === "import"}
            onClick={() => setUnitMode("import")}
          >
            Importar planilha
          </button>
        </div>

        <p className="admin-form-context">
          Bloco de trabalho:{" "}
          <strong>
            {selectedBlock?.name ??
              (blocks.length ? "Sem bloco" : "condomínio sem blocos")}
          </strong>
          .
          {unitMode === "batch"
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

        {unitMode === "single" ? (
          <form className="inline-form" onSubmit={handleSaveUnit}>
            {blocks.length === 0 && blockCount > 0 && (
              <p className="field-hint">
                Cadastre ao menos um bloco antes de criar unidades.
              </p>
            )}
            {blocks.length > 0 && selectedBlockId === "" && (
              <p className="field-hint">
                Selecione um bloco para cadastrar novas unidades. As unidades
                importadas sem bloco aparecem em “Sem bloco”.
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

            <div className="form-actions">
              <button
                className="primary-button"
                disabled={
                  savingUnit ||
                  (blockCount > 0 && blocks.length === 0) ||
                  (blocks.length > 0 && selectedBlockId === "")
                }
              >
                {savingUnit ? "Salvando..." : "Cadastrar unidade"}
              </button>
            </div>
          </form>
        ) : unitMode === "batch" ? (
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
                  ((blockCount > 0 || blocks.length > 0) && !selectedBlockId)
                }
              >
                {savingBatch ? "Cadastrando..." : "Gerar apartamentos"}
              </button>
            </div>
          </form>
        ) : (
          <ResidentsImportPanel
            condominiumId={condominiumId}
            onImported={(importedRows) => {
              const importedBlock =
                importedRows.find((row) => row.block_name?.trim())?.block_name?.trim() ??
                null;
              void reloadUnits(importedBlock);
            }}
          />
        )}

        <div className="section-heading units-heading admin-units-heading">
          <div>
            <h2>
              Unidades cadastradas
              {selectedBlock ? ` — ${selectedBlock.name}` : ""} ({displayedUnits.length})
            </h2>
            {normalizedUnitSearch && (
              <p>
                {filteredUnits.length} resultado(s) para “{unitSearch.trim()}”.
              </p>
            )}
          </div>
          <div className="admin-unit-toolbar">
            <input
              className="admin-unit-search"
              type="search"
              placeholder="Buscar unidade"
              aria-label="Buscar unidade"
              value={unitSearch}
              onChange={(event) => {
                setUnitSearch(event.target.value);
                setCollapsedFloors([]);
              }}
            />
            <button
              className="text-button"
              type="button"
              disabled={floorGroups.length === 0}
              onClick={() =>
                setCollapsedFloors(
                  allFloorsCollapsed ? [] : floorGroups.map((group) => group.key),
                )
              }
            >
              {allFloorsCollapsed ? "Expandir tudo" : "Recolher tudo"}
            </button>
          </div>
        </div>
        {floorGroups.length === 0 ? (
          <p className="empty-state">
            {normalizedUnitSearch
              ? "Nenhuma unidade encontrada para esta busca."
              : "Nenhuma unidade cadastrada ainda."}
          </p>
        ) : (
          <div className="building-floor-list">
            {floorGroups.map((group) => {
              const isCollapsed = collapsedFloors.includes(group.key);
              return (
                <section
                  className={`building-floor${isCollapsed ? " building-floor-collapsed" : ""}`}
                  key={group.key}
                >
                  <header className="building-floor-heading">
                    <button
                      className="building-floor-toggle"
                      type="button"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleFloor(group.key)}
                    >
                      <span className="admin-floor-title">
                        <strong>{group.label}</strong>
                        <ChevronDown
                          size={16}
                          aria-hidden="true"
                          className={
                            isCollapsed
                              ? "admin-chevron admin-chevron-collapsed"
                              : "admin-chevron"
                          }
                        />
                      </span>
                      <span>{group.units.length} unidade(s)</span>
                    </button>
                  </header>
                  {!isCollapsed && (
                  <div className="building-floor-units">
                    {group.units.map((unit) => (
                      <article className="building-unit" key={unit.id}>
                        <div className="building-unit-heading">
                          <strong>{unit.unit_number}</strong>
                          <button
                            className={`unit-status unit-status-toggle unit-status-${unit.status}`}
                            type="button"
                            disabled={updatingUnitId === unit.id}
                            aria-label={`Apartamento ${unit.unit_number} ${unit.status === "active" ? "ativo" : "inativo"}. Clique para alternar.`}
                            title="Clique para alternar entre ativo e inativo"
                            onClick={() => void toggleUnitStatus(unit)}
                          >
                            {updatingUnitId === unit.id
                              ? "Salvando..."
                              : unit.status === "active"
                                ? "Ativo"
                                : "Inativo"}
                          </button>
                        </div>
                        <div className="table-actions">
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
                            onClick={() => requestDeleteUnit(unit)}
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
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>

      {deleteUnitTarget && (
        <ConfirmationDialog
          title="Excluir unidade?"
          description={`Excluir a unidade ${deleteUnitTarget.unit_number}? Os contatos associados também serão excluídos.`}
          confirmLabel="Excluir unidade"
          busyLabel="Excluindo..."
          loading={Boolean(deletingUnitId)}
          onConfirm={confirmDeleteUnit}
          onCancel={() => setDeleteUnitTarget(null)}
        />
      )}
    </>
  );
}
