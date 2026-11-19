import { useEffect, useState } from "react";
import { UnitResidentsPanel } from "../UnitResidentsPanel";
import { supabase } from "../../lib/supabase";

type Block = { id: string; name: string };
type Unit = {
  id: string;
  unit_number: string;
  block_id: string | null;
  status: "active" | "inactive";
};
type Resident = {
  id: string;
  unit_id: string;
  name: string | null;
  whatsapp: string | null;
};
type ResidentRow = {
  unit: Unit;
  label: string;
  residents: Resident[];
  hasWhatsapp: boolean;
};

const UNIT_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

export function ManagerResidentsPanel({
  condominiumId,
}: {
  condominiumId: string;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [onlyMissingWhatsapp, setOnlyMissingWhatsapp] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
        setError(`Não foi possível carregar as unidades. ${failed.message}`);
        setLoading(false);
        return;
      }

      const loadedUnits = (unitsResult.data ?? []) as Unit[];
      const unitIds = loadedUnits.map((unit) => unit.id);
      const residentResults = await Promise.all(
        chunk(unitIds, UNIT_CHUNK_SIZE).map((ids) =>
          supabase
            .from("unit_residents")
            .select("id, unit_id, name, whatsapp")
            .in("unit_id", ids),
        ),
      );
      if (!active) return;
      const residentError = residentResults.find((result) => result.error)?.error;
      if (residentError) {
        setError(`Não foi possível carregar os contatos. ${residentError.message}`);
      } else {
        setBlocks((blocksResult.data ?? []) as Block[]);
        setUnits(loadedUnits);
        setResidents(
          residentResults.flatMap(
            (result) => (result.data ?? []) as Resident[],
          ),
        );
        setError("");
      }
      setLoading(false);
    })().catch((cause: unknown) => {
      if (!active) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar os moradores.",
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId, refresh]);

  const rows: ResidentRow[] = units.map((unit) => {
    const blockName = blocks.find((block) => block.id === unit.block_id)?.name;
    const unitResidents = residents.filter(
      (resident) => resident.unit_id === unit.id,
    );
    return {
      unit,
      label: blockName ? `${blockName} · ${unit.unit_number}` : unit.unit_number,
      residents: unitResidents,
      hasWhatsapp: unitResidents.some((resident) =>
        Boolean(resident.whatsapp?.trim()),
      ),
    };
  });

  const normalizedSearch = search.toLocaleLowerCase("pt-BR").trim();
  const visibleRows = rows.filter((row) => {
    if (onlyMissingWhatsapp && row.hasWhatsapp) return false;
    if (!normalizedSearch) return true;
    return (
      row.label.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
      row.residents.some((resident) =>
        (resident.name ?? "")
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedSearch),
      )
    );
  });
  const missingCount = rows.filter((row) => !row.hasWhatsapp).length;

  return (
    <section className="manager-panel">
      <div className="manager-panel-heading">
        <div>
          <p className="eyebrow">Contatos</p>
          <h2>Moradores</h2>
          <p>
            Veja a cobertura de WhatsApp por unidade e gerencie os contatos que
            recebem o aviso da portaria.
          </p>
        </div>
      </div>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}

      <div className="manager-card">
        <div className="manager-list-heading">
          <div className="manager-resident-filters">
            <input
              type="search"
              placeholder="Buscar unidade ou morador"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              className={onlyMissingWhatsapp ? "secondary-button is-active" : "secondary-button"}
              type="button"
              aria-pressed={onlyMissingWhatsapp}
              onClick={() => setOnlyMissingWhatsapp((current) => !current)}
            >
              Sem WhatsApp cadastrado
            </button>
          </div>
          <strong>{missingCount} unidade(s) sem WhatsApp</strong>
        </div>

        {loading ? (
          <p className="manager-empty">Carregando moradores...</p>
        ) : visibleRows.length === 0 ? (
          <p className="manager-empty">
            {onlyMissingWhatsapp
              ? "Todas as unidades têm pelo menos um WhatsApp cadastrado."
              : "Nenhuma unidade encontrada."}
          </p>
        ) : (
          <div className="manager-table-wrap">
            <table className="manager-table manager-residents-table">
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>Contatos</th>
                  <th>WhatsApp</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.unit.id}>
                    <td>{row.label}</td>
                    <td>
                      {row.residents.length
                        ? row.residents
                            .map((resident) => resident.name || "Sem nome")
                            .join(", ")
                        : "Sem contato cadastrado"}
                    </td>
                    <td>
                      {row.hasWhatsapp
                        ? row.residents
                            .filter((resident) => resident.whatsapp?.trim())
                            .map((resident) => resident.whatsapp)
                            .join(", ")
                        : "—"}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setSelectedUnitId(row.unit.id)}
                      >
                        Gerenciar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="manager-card">
        <div className="manager-list-heading">
          <h3>Contatos por unidade</h3>
          <select
            aria-label="Unidade para gerenciar contatos"
            value={selectedUnitId}
            onChange={(event) => setSelectedUnitId(event.target.value)}
          >
            <option value="">Selecione a unidade</option>
            {rows.map((row) => (
              <option key={row.unit.id} value={row.unit.id}>
                {row.label}
              </option>
            ))}
          </select>
        </div>
        {selectedUnitId ? (
          <UnitResidentsPanel
            key={`${selectedUnitId}-${refresh}`}
            unitId={selectedUnitId}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        ) : (
          <p className="manager-empty">
            Selecione uma unidade na tabela ou no campo acima para adicionar ou
            editar contatos.
          </p>
        )}
      </div>
    </section>
  );
}
