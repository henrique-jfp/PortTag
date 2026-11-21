import { useId, useMemo, useState, type KeyboardEvent } from "react";

type UnitOption = {
  id: string;
  unit_number: string;
  block_id: string | null;
};

type BlockOption = {
  id: string;
  name: string;
};

type BulkUnitFieldProps = {
  units: UnitOption[];
  blocks: BlockOption[];
  value: string;
  blockId?: string;
  readUnitNumber?: string;
  candidates: UnitOption[];
  itemId: string;
  disabled?: boolean;
  showBlock?: boolean;
  allowAnyBlock?: boolean;
  onChange: (unitId: string) => void;
  onBlockChange: (blockId: string) => void;
  onCommit: () => void;
};

type UnitInputProps = {
  units: UnitOption[];
  blocks: BlockOption[];
  selected: UnitOption | null;
  readCandidates: UnitOption[];
  readUnitNumber?: string;
  itemId: string;
  disabled?: boolean;
  onChange: (unitId: string) => void;
  onCommit: () => void;
};

function unitLabel(unit: UnitOption, blocks: BlockOption[]) {
  const block = blocks.find((candidate) => candidate.id === unit.block_id)?.name;
  return block ? `${block} · ${unit.unit_number}` : unit.unit_number;
}

/**
 * O texto digitado fica isolado aqui. Quando a leitura preenche `value`, o
 * componente é remontado e o número reconhecido aparece no campo em vez de
 * ficar só como sugestão.
 */
function UnitInput({
  units,
  blocks,
  selected,
  readCandidates,
  readUnitNumber,
  itemId,
  disabled,
  onChange,
  onCommit,
}: UnitInputProps) {
  const inputId = useId();
  const [query, setQuery] = useState(selected?.unit_number ?? "");

  const term = query.trim().toLocaleLowerCase("pt-BR");
  const matches = useMemo(() => {
    if (!term) return [];
    const rank = (unit: UnitOption) => {
      const number = unit.unit_number.toLocaleLowerCase("pt-BR");
      if (number === term) return 0;
      return number.startsWith(term) ? 1 : 2;
    };
    return units
      .filter((unit) =>
        unit.unit_number.toLocaleLowerCase("pt-BR").includes(term),
      )
      .sort(
        (left, right) =>
          rank(left) - rank(right) ||
          left.unit_number.localeCompare(right.unit_number, "pt-BR", {
            numeric: true,
          }),
      )
      .slice(0, 6);
  }, [term, units]);

  const readNumberRegistered = readUnitNumber
    ? units.some(
        (unit) =>
          unit.unit_number.toLocaleLowerCase("pt-BR") ===
          readUnitNumber.toLocaleLowerCase("pt-BR"),
      )
    : true;
  const showMatches = Boolean(term) && query !== selected?.unit_number;

  function select(unit: UnitOption) {
    setQuery(unit.unit_number);
    onChange(unit.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (matches.length) select(matches[0]);
    onCommit();
  }

  return (
    <>
      <label htmlFor={inputId}>Apartamento</label>
      <input
        id={inputId}
        data-bulk-unit={itemId}
        autoComplete="off"
        autoCapitalize="none"
        enterKeyHint="next"
        placeholder="Digite o número"
        value={query}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          if (selected && next.trim() !== selected.unit_number) onChange("");
        }}
        onKeyDown={handleKeyDown}
      />
      {selected && (
        <small className="porter-bulk-unit-selected">
          Selecionado: {unitLabel(selected, blocks)}
        </small>
      )}
      {readCandidates.length > 0 && (
        <div className="porter-bulk-unit-suggestions">
          <small>Leitura:</small>
          {readCandidates.map((unit) => (
            <button
              key={unit.id}
              type="button"
              className={`porter-bulk-chip${
                unit.id === selected?.id ? " porter-bulk-chip-active" : ""
              }`}
              disabled={disabled}
              onClick={() => select(unit)}
            >
              {unitLabel(unit, blocks)}
            </button>
          ))}
        </div>
      )}
      {!readNumberRegistered && (
        <small className="porter-bulk-hint">
          A etiqueta indica {readUnitNumber}, que não existe no cadastro.
        </small>
      )}
      {showMatches && (
        <div className="porter-bulk-unit-suggestions">
          {matches.map((unit) => (
            <button
              key={unit.id}
              type="button"
              className="porter-bulk-chip"
              disabled={disabled}
              onClick={() => select(unit)}
            >
              {unitLabel(unit, blocks)}
            </button>
          ))}
          {matches.length === 0 && (
            <small className="porter-bulk-hint">
              Nenhuma unidade encontrada.
            </small>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Campo de apartamento da revisão em lote. Digitar o número é mais rápido do
 * que rolar a lista inteira do condomínio no celular; as sugestões da leitura
 * ficam a um toque e o Enter passa para a próxima foto.
 */
export function BulkUnitField({
  units,
  blocks,
  value,
  blockId = "",
  readUnitNumber,
  candidates,
  itemId,
  disabled,
  showBlock = false,
  allowAnyBlock = false,
  onChange,
  onBlockChange,
  onCommit,
}: BulkUnitFieldProps) {
  const blockSelectId = useId();
  const selected = units.find((unit) => unit.id === value) ?? null;

  const visibleUnits = useMemo(
    () => (blockId ? units.filter((unit) => unit.block_id === blockId) : units),
    [units, blockId],
  );

  const visibleBlocks = useMemo(
    () =>
      blocks.filter((block) =>
        units.some((unit) => unit.block_id === block.id),
      ),
    [blocks, units],
  );

  const readCandidates = useMemo(() => {
    const map = new Map<string, UnitOption>();
    for (const unit of candidates) map.set(unit.id, unit);
    return Array.from(map.values()).slice(0, 4);
  }, [candidates]);

  return (
    <div className="porter-bulk-unit">
      {showBlock && visibleBlocks.length > 0 && (
        <label className="porter-bulk-block" htmlFor={blockSelectId}>
          Bloco
          <select
            id={blockSelectId}
            value={blockId}
            disabled={disabled}
            onChange={(event) => onBlockChange(event.target.value)}
          >
            {allowAnyBlock && <option value="">Todos os blocos</option>}
            {visibleBlocks.map((block) => (
              <option key={block.id} value={block.id}>
                {block.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <UnitInput
        key={`${itemId}:${value}`}
        units={visibleUnits}
        blocks={blocks}
        selected={selected}
        readCandidates={readCandidates}
        readUnitNumber={readUnitNumber}
        itemId={itemId}
        disabled={disabled}
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}
