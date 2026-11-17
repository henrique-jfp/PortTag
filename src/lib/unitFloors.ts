export type UnitForFloorGrouping = {
  unit_number: string;
};

export type UnitFloorGroup<T extends UnitForFloorGrouping> = {
  key: string;
  label: string;
  order: number;
  units: T[];
};

export function normalizeApartmentReference(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:apartament(?:o)?|apto|apart|ap)\b/g, "apartamento")
    .replace(/\b(?:cobertura|cobert|cobe|cob)\b/g, "cobertura")
    .replace(/\s+/g, " ")
    .trim();
}

export function groupUnitsByFloor<T extends UnitForFloorGrouping>(
  units: T[],
): UnitFloorGroup<T>[] {
  const groups = new Map<string, UnitFloorGroup<T>>();

  for (const unit of units) {
    const normalized = normalizeApartmentReference(unit.unit_number);
    const isCoverage = /\bcobertura\b/.test(normalized);
    const isGroundFloor = /\bterreo\b/.test(normalized);
    const apartmentNumber = normalized.match(/\d{3,}/)?.[0];
    let key = "other";
    let label = "Sem andar identificado";
    let order = -2;

    if (isCoverage) {
      key = "coverage";
      label = "Cobertura";
      order = Number.POSITIVE_INFINITY;
    } else if (isGroundFloor) {
      key = "ground";
      label = "Térreo";
      order = -1;
    } else if (apartmentNumber) {
      const floor = Number(apartmentNumber.slice(0, -2));
      if (Number.isSafeInteger(floor)) {
        if (floor === 0) {
          key = "ground";
          label = "Térreo";
          order = -1;
        } else {
          key = `floor-${floor}`;
          label = `${floor}º andar`;
          order = floor;
        }
      }
    }

    const group = groups.get(key) ?? { key, label, order, units: [] };
    group.units.push(unit);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      units: group.units.sort((a, b) =>
        a.unit_number.localeCompare(b.unit_number, "pt-BR", {
          numeric: true,
        }),
      ),
    }))
    .sort((a, b) => b.order - a.order);
}
