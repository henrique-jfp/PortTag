import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { Pagination } from "./Pagination";
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
  floor_label: string | null;
  status: "active" | "inactive";
};

const BLOCK_PAGE_SIZE = 50;
const UNIT_PAGE_SIZE = 50;
const UNIT_COLUMNS = "id, unit_number, block_id, floor_label, status";

async function fetchBlockPage(condominiumId: string, page: number) {
  const from = (page - 1) * BLOCK_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("blocks")
    .select("id, name", { count: "exact" })
    .eq("condominium_id", condominiumId)
    .order("name")
    .range(from, from + BLOCK_PAGE_SIZE - 1);

  if (error) throw new Error(error.message);
  return {
    blocks: (data ?? []) as Block[],
    total: count ?? 0,
  };
}

async function fetchAllBlocks(condominiumId: string): Promise<Block[]> {
  const blocks: Block[] = [];
  let from = 0;

  while (true) {
    const { data, error, count } = await supabase
      .from("blocks")
      .select("id, name", { count: "exact" })
      .eq("condominium_id", condominiumId)
      .order("name")
      .range(from, from + BLOCK_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as Block[];
    blocks.push(...page);
    const total = count ?? 0;
    from += BLOCK_PAGE_SIZE;
    if (!page.length || from >= total) break;
  }

  return blocks;
}

async function fetchBlockUnitCounts(condominiumId: string, blocks: Block[]) {
  const [byBlock, withoutBlock] = await Promise.all([
    Promise.all(
      blocks.map(async (block) => {
        const { count, error } = await supabase
          .from("units")
          .select("id", { count: "exact", head: true })
          .eq("condominium_id", condominiumId)
          .eq("block_id", block.id);
        if (error) throw new Error(error.message);
        return [block.id, count ?? 0] as const;
      }),
    ),
    supabase
      .from("units")
      .select("id", { count: "exact", head: true })
      .eq("condominium_id", condominiumId)
      .is("block_id", null),
  ]);

  if (withoutBlock.error) throw new Error(withoutBlock.error.message);
  return {
    counts: Object.fromEntries(byBlock) as Record<string, number>,
    withoutBlock: withoutBlock.count ?? 0,
  };
}

async function fetchUnitPage(
  condominiumId: string,
  selectedBlockId: string,
  hasBlocks: boolean,
  search: string,
  page: number,
) {
  const from = (page - 1) * UNIT_PAGE_SIZE;
  let query = supabase
    .from("units")
    .select(UNIT_COLUMNS, { count: "exact" })
    .eq("condominium_id", condominiumId);

  if (hasBlocks) {
    query = selectedBlockId
      ? query.eq("block_id", selectedBlockId)
      : query.is("block_id", null);
  }
  if (search) {
    query = query.ilike("unit_number", `%${search}%`);
  }

  const { data, error, count } = await query
    .order("unit_number")
    .range(from, from + UNIT_PAGE_SIZE - 1);

  if (error) throw new Error(error.message);
  return {
    units: (data ?? []) as Unit[],
    total: count ?? 0,
  };
}

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
  const [allBlocks, setAllBlocks] = useState<Block[]>([]);
  const [blocksLoaded, setBlocksLoaded] = useState(false);
  const [blockPage, setBlockPage] = useState(1);
  const [blockTotal, setBlockTotal] = useState(0);
  const [blockUnitCounts, setBlockUnitCounts] = useState<Record<string, number>>({});
  const [noBlockCount, setNoBlockCount] = useState(0);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitTotal, setUnitTotal] = useState(0);
  const [unitPage, setUnitPage] = useState(1);
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
  const [deleteBlockTarget, setDeleteBlockTarget] = useState<Block | null>(null);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setBlockPage(1);
    setUnitPage(1);
    setUnitSearch("");
    setSelectedBlockId("");
    setBlocksLoaded(false);
  }, [condominiumId]);

  useEffect(() => {
    let active = true;

    void (async () => {
      const [pageResult, allBlocksResult] = await Promise.all([
        fetchBlockPage(condominiumId, blockPage),
        fetchAllBlocks(condominiumId),
      ]);
      const counts = await fetchBlockUnitCounts(condominiumId, allBlocksResult);

      if (!active) return;
      setBlocks(pageResult.blocks);
      setBlockTotal(pageResult.total);
      setAllBlocks(allBlocksResult);
      setBlockUnitCounts(counts.counts);
      setNoBlockCount(counts.withoutBlock);
      setBlocksLoaded(true);
      setSelectedBlockId((current) => current || allBlocksResult[0]?.id || "");
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
  }, [condominiumId, blockPage]);

  useEffect(() => {
    if (!blocksLoaded) return;
    let active = true;

    void fetchUnitPage(
      condominiumId,
      selectedBlockId,
      allBlocks.length > 0,
      unitSearch.trim(),
      unitPage,
    )
      .then((result) => {
        if (!active) return;
        setUnits(result.units);
        setUnitTotal(result.total);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : "Falha inesperada.";
        setLoadError(`Não foi possível carregar os dados. ${message}`);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    blocksLoaded,
    condominiumId,
    selectedBlockId,
    unitSearch,
    unitPage,
    allBlocks.length,
  ]);

  async function refreshBlockData(preferredBlockId?: string) {
    const nextBlocks = await fetchAllBlocks(condominiumId);
    const counts = await fetchBlockUnitCounts(condominiumId, nextBlocks);
    const index = preferredBlockId
      ? nextBlocks.findIndex((block) => block.id === preferredBlockId)
      : -1;
    const nextPage =
      index >= 0 ? Math.floor(index / BLOCK_PAGE_SIZE) + 1 : blockPage;
    const from = (nextPage - 1) * BLOCK_PAGE_SIZE;

    setAllBlocks(nextBlocks);
    setBlocks(nextBlocks.slice(from, from + BLOCK_PAGE_SIZE));
    setBlockPage(nextPage);
    setBlockTotal(nextBlocks.length);
    setBlockUnitCounts(counts.counts);
    setNoBlockCount(counts.withoutBlock);
    if (preferredBlockId) setSelectedBlockId(preferredBlockId);
  }

  async function refreshUnits(targetPage = unitPage) {
    const result = await fetchUnitPage(
      condominiumId,
      selectedBlockId,
      allBlocks.length > 0,
      unitSearch.trim(),
      targetPage,
    );
    setUnits(result.units);
    setUnitTotal(result.total);
  }

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

      await refreshBlockData(data);
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

      setUnitPage(1);
      await refreshUnits(1);
      const counts = await fetchBlockUnitCounts(condominiumId, allBlocks);
      setBlockUnitCounts(counts.counts);
      setNoBlockCount(counts.withoutBlock);
      setUnitSuccess(
        `Unidade ${number} cadastrada${blockId ? ` no bloco ${allBlocks.find((block) => block.id === blockId)?.name ?? ""}` : ""}.`,
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
      let existingQuery = supabase
        .from("units")
        .select("unit_number")
        .eq("condominium_id", condominiumId)
        .in("unit_number", unitNumbers);
      existingQuery = blockId
        ? existingQuery.eq("block_id", blockId)
        : existingQuery.is("block_id", null);
      const { data: existingRows, error: existingError } = await existingQuery;
      if (existingError) throw new Error(existingError.message);
      const existingNumbers = new Set(
        (existingRows ?? []).map((unit) =>
          unit.unit_number.toLocaleLowerCase("pt-BR"),
        ),
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

      const reloaded = await reloadUnits();
      if (!reloaded) return;
      setUnitSuccess(
        `${unitNumbers.length} apartamento(s) cadastrado(s) em ${blockId ? allBlocks.find((block) => block.id === blockId)?.name ?? "bloco selecionado" : "condomínio sem blocos"}.`,
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
    try {
      const nextBlocks = await fetchAllBlocks(condominiumId);
      const counts = await fetchBlockUnitCounts(condominiumId, nextBlocks);
      const pageResult = await fetchBlockPage(condominiumId, 1);

      let nextBlockId = selectedBlockId;
      if (preferredBlockName === null) {
        nextBlockId = "";
      } else if (preferredBlockName) {
        const normalized = preferredBlockName.toLocaleLowerCase("pt-BR");
        nextBlockId =
          nextBlocks.find(
            (block) => block.name.toLocaleLowerCase("pt-BR") === normalized,
          )?.id ?? "";
      } else if (!nextBlocks.some((block) => block.id === nextBlockId)) {
        nextBlockId = nextBlocks[0]?.id ?? "";
      }

      const unitResult = await fetchUnitPage(
        condominiumId,
        nextBlockId,
        nextBlocks.length > 0,
        unitSearch.trim(),
        1,
      );

      setAllBlocks(nextBlocks);
      setBlocks(pageResult.blocks);
      setBlockPage(1);
      setBlockTotal(pageResult.total);
      setBlockUnitCounts(counts.counts);
      setNoBlockCount(counts.withoutBlock);
      setSelectedBlockId(nextBlockId);
      setUnits(unitResult.units);
      setUnitTotal(unitResult.total);
      setUnitPage(1);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setUnitError(
        `A importação terminou, mas não foi possível atualizar a lista. ${message}`,
      );
      return false;
    }
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

      await refreshUnits();
      const counts = await fetchBlockUnitCounts(condominiumId, allBlocks);
      setBlockUnitCounts(counts.counts);
      setNoBlockCount(counts.withoutBlock);
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

  function requestDeleteBlock(block: Block) {
    setDeleteBlockTarget(block);
    setBlockError("");
    setBlockSuccess("");
  }

  async function confirmDeleteBlock() {
    const block = deleteBlockTarget;
    if (!block) return;

    setBlockError("");
    setBlockSuccess("");
    setDeletingBlockId(block.id);
    try {
      const { error } = await supabase.rpc("delete_condominium_block", {
        p_block_id: block.id,
      });

      if (error) {
        setBlockError(`Não foi possível excluir o bloco. ${error.message}`);
        return;
      }

      await refreshBlockData(selectedBlockId === block.id ? undefined : selectedBlockId);
      setSelectedBlockId((current) =>
        current === block.id ? "" : current,
      );
      setBlockSuccess(`Bloco ${block.name} excluído.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setBlockError(`Não foi possível excluir o bloco. ${message}`);
    } finally {
      setDeletingBlockId(null);
      setDeleteBlockTarget(null);
    }
  }

  const selectedBlockName =
    allBlocks.find((block) => block.id === selectedBlockId)?.name ?? "";
  const normalizedUnitSearch = unitSearch.trim().toLocaleLowerCase("pt-BR");
  const floorGroups = groupUnitsByFloor(units);
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
              {selectedBlockName ||
                (allBlocks.length
                  ? selectedBlockId === ""
                    ? "Sem bloco"
                    : "Bloco selecionado em outra página"
                  : "Sem blocos")}
              {selectedBlockName && (
                <span className="admin-context-badge">Bloco atual</span>
              )}
            </span>
          </div>
          <div className="admin-context-actions">
            <span className="admin-context-meta">
              {unitTotal.toLocaleString("pt-BR")} unidade(s) neste bloco
              {blockCount > blockTotal
                ? ` · ${blockCount} previsto(s)`
                : ""}
            </span>
            {selectedBlockName && (
              <button
                className="admin-block-delete"
                type="button"
                title={`Excluir bloco ${selectedBlockName}`}
                disabled={Boolean(deletingBlockId)}
                onClick={() => {
                  const block = allBlocks.find(
                    (item) => item.id === selectedBlockId,
                  );
                  if (block) requestDeleteBlock(block);
                }}
              >
                <Trash2 size={15} aria-hidden="true" />
                {deletingBlockId ? "Excluindo..." : "Excluir bloco"}
              </button>
            )}
          </div>
        </div>

        {allBlocks.length > 0 ? (
          <>
            <div className="block-list" aria-label="Blocos cadastrados">
              {blocks.map((block) => (
                <button
                  key={block.id}
                  className={`block-choice${selectedBlockId === block.id ? " block-choice-active" : ""}`}
                  type="button"
                  aria-pressed={selectedBlockId === block.id}
                  onClick={() => {
                    setSelectedBlockId(block.id);
                    setUnitPage(1);
                    setCollapsedFloors([]);
                  }}
                >
                  <strong>{block.name}</strong>
                  <span>
                    {(blockUnitCounts[block.id] ?? 0).toLocaleString("pt-BR")}{" "}
                    apartamento(s)
                  </span>
                  {selectedBlockId === block.id && <small>Bloco atual</small>}
                </button>
              ))}
              {noBlockCount > 0 && (
                <button
                  className={`block-choice${selectedBlockId === "" ? " block-choice-active" : ""}`}
                  type="button"
                  aria-pressed={selectedBlockId === ""}
                  onClick={() => {
                    setSelectedBlockId("");
                    setUnitPage(1);
                    setCollapsedFloors([]);
                  }}
                >
                  <strong>Sem bloco</strong>
                  <span>{noBlockCount.toLocaleString("pt-BR")} apartamento(s)</span>
                  {selectedBlockId === "" && <small>Bloco atual</small>}
                </button>
              )}
            </div>
            <Pagination
              page={blockPage}
              total={blockTotal}
              pageSize={BLOCK_PAGE_SIZE}
              onChange={setBlockPage}
              label="Paginação de blocos"
            />
          </>
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
            {selectedBlockName ||
              (allBlocks.length ? "Sem bloco" : "condomínio sem blocos")}
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
            {allBlocks.length === 0 && (
              <p className="field-hint">
                Sem blocos cadastrados: a unidade será criada sem bloco.
              </p>
            )}
            {allBlocks.length > 0 && selectedBlockId === "" && (
              <p className="field-hint">
                Bloco de trabalho: <strong>Sem bloco</strong>. A unidade será
                criada sem bloco; selecione outro bloco acima para vinculá-la.
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
                disabled={savingUnit}
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
                disabled={savingBatch}
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
              {selectedBlockName ? ` — ${selectedBlockName}` : ""} (
              {unitTotal.toLocaleString("pt-BR")})
            </h2>
            {normalizedUnitSearch && (
              <p>
                {unitTotal.toLocaleString("pt-BR")} resultado(s) para “
                {unitSearch.trim()}”.
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
                setUnitPage(1);
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
        <Pagination
          page={unitPage}
          total={unitTotal}
          pageSize={UNIT_PAGE_SIZE}
          onChange={(page) => {
            setUnitPage(page);
            setCollapsedFloors([]);
          }}
          label="Paginação de unidades"
        />
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

      {deleteBlockTarget && (
        <ConfirmationDialog
          title="Excluir bloco?"
          description={`Excluir o bloco ${deleteBlockTarget.name}? O bloco só pode ser excluído se não houver unidades nem encomendas vinculadas.`}
          confirmLabel="Excluir bloco"
          busyLabel="Excluindo..."
          loading={Boolean(deletingBlockId)}
          onConfirm={confirmDeleteBlock}
          onCancel={() => setDeleteBlockTarget(null)}
        />
      )}
    </>
  );
}
