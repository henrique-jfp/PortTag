const MAX_UNITS_PER_BATCH = 500;

export type UnitRange = {
  firstFloor: number;
  firstFloorWidth: number;
  firstApartment: number;
  lastApartment: number;
};

export function parseUnitRange(value: string): UnitRange {
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(value);
  if (!match) {
    throw new Error("Informe a faixa no formato 901-907.");
  }

  const [, firstNumber, lastNumber] = match;
  if (
    firstNumber.length < 3 ||
    firstNumber.length !== lastNumber.length ||
    firstNumber.slice(0, -2) !== lastNumber.slice(0, -2)
  ) {
    throw new Error(
      "Use números do mesmo andar, como 901-907 ou 1001-1007.",
    );
  }

  const firstFloorText = firstNumber.slice(0, -2);
  const firstApartment = Number(firstNumber.slice(-2));
  const lastApartment = Number(lastNumber.slice(-2));

  if (
    !firstFloorText ||
    !Number.isSafeInteger(Number(firstFloorText)) ||
    firstApartment > lastApartment
  ) {
    throw new Error("A faixa de apartamentos é inválida.");
  }

  return {
    firstFloor: Number(firstFloorText),
    firstFloorWidth: firstFloorText.length,
    firstApartment,
    lastApartment,
  };
}

export function generateUnitNumbers(
  range: UnitRange,
  lastFloor: number,
): string[] {
  if (!Number.isSafeInteger(lastFloor) || lastFloor < range.firstFloor) {
    throw new Error("O último andar deve ser igual ou maior que o inicial.");
  }

  const count =
    (lastFloor - range.firstFloor + 1) *
    (range.lastApartment - range.firstApartment + 1);
  if (count > MAX_UNITS_PER_BATCH) {
    throw new Error("Gere no máximo 500 unidades por vez.");
  }

  const unitNumbers: string[] = [];
  for (let floor = range.firstFloor; floor <= lastFloor; floor += 1) {
    const floorPrefix = String(floor).padStart(range.firstFloorWidth, "0");
    for (
      let apartment = range.firstApartment;
      apartment <= range.lastApartment;
      apartment += 1
    ) {
      unitNumbers.push(`${floorPrefix}${String(apartment).padStart(2, "0")}`);
    }
  }

  return unitNumbers;
}
