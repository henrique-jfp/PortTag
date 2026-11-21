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
  readUnitNumber?: string;
  candidates: UnitOption[];
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
 * Campo de apartamento da revisão em lote. Digitar o número é mais rápido do
 * que rolar a lista inteira do condomínio no celular; as sugestões da leitura
 * ficam a um toque e o Enter passa para a próxima foto.
 */
export function BulkUnitField({
  units,
  blocks,
  value,
  readUnitNumber,
  candidates,
  itemId,
  disabled,
  onChange,
  onCommit,
}: BulkUnitFieldProps) {
  const inputId = useId();
  const selected = units.find((unit) => unit.id === value) ?? null;
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
    setQuery(unit.unit_number);
    onChange(unit.id);
  }

  function handleQuery(next: string) {
    setQuery(next);
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
