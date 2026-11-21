import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

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

function unitLabel(unit: UnitOption, blocks: BlockOption[]) {
  const block = blocks.find((candidate) => candidate.id === unit.block_id)?.name;
  return block ? `${block} · ${unit.unit_number}` : unit.unit_number;
}

/**
 * Campo de apartamento da revisão em lote. Digitar o número é mais rápido do
 * que rolar a lista inteira do condomínio no celular; as sugestões da leitura
 * ficam a um toque e o Enter passa para a próxima foto.
 *
 * O valor vem do OCR depois de o componente já estar montado, então o texto
 * precisa acompanhar `value` — guardá-lo só no estado inicial fazia o
 * apartamento aparecer como sugestão em vez de vir preenchido.
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
  const inputId = useId();
  const blockSelectId = useId();
  const selected = units.find((unit) => unit.id === value) ?? null;
  const [draftQuery, setDraftQuery] = useState<string | null>(null);
  const previousValue = useRef(value);
  // A leitura chega depois de o campo existir. Quando o valor selecionado muda,
  // o texto digitado deixa de valer e o número reconhecido aparece preenchido.
  if (previousValue.current !== value) {
    previousValue.current = value;
    setDraftQuery(null);
  }
  const query = draftQuery ?? selected?.unit_number ?? "";

  const visibleUnits = useMemo(
    () => (blockId ? units.filter((unit) => unit.block_id === blockId) : units),
    [units, blockId],
  );

  const visibleBlocks = useMemo(
    () => blocks.filter((block) => units.some((unit) => unit.block_id === block.id)),
    [blocks, units],
  );

  const term = query.trim().toLocaleLowerCase("pt-BR");
  const matches = useMemo(() => {
    if (!term) return [];
    const rank = (unit: UnitOption) => {
      const number = unit.unit_number.toLocaleLowerCase("pt-BR");
      if (number === term) return 0;
      return number.startsWith(term) ? 1 : 2;
    };
    return visibleUnits
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
  }, [term, visibleUnits]);

  const readCandidates = useMemo(() => {
    const map = new Map<string, UnitOption>();
    for (const unit of candidates) map.set(unit.id, unit);
    return Array.from(map.values()).slice(0, 4);
  }, [candidates]);

  const readNumberRegistered = readUnitNumber
    ? units.some(
        (unit) =>
          unit.unit_number.toLocaleLowerCase("pt-BR") ===
          readUnitNumber.toLocaleLowerCase("pt-BR"),
      )
    : true;

  function select(unit: UnitOption) {
    setDraftQuery(null);
    onChange(unit.id);
  }

  function handleQuery(next: string) {
    setDraftQuery(next);
    if (selected && next.trim() !== selected.unit_number) onChange("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (matches.length) select(matches[0]);
    onCommit();
  }

  const showMatches = Boolean(term) && query !== selected?.unit_number;

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
        onChange={(event) => handleQuery(event.target.value)}
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
                unit.id === value ? " porter-bulk-chip-active" : ""
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
    </div>
  );
}
