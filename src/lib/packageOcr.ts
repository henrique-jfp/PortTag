import { normalizeApartmentReference } from "./unitFloors";

type RecognizableUnit = {
  id: string;
  unit_number: string;
};

type RecognizableResident = {
  unit_id: string;
  name: string | null;
};

const unitTypeTokens = new Set(["apartamento", "casa", "cobertura"]);
const unitLabelTokens = new Set([
  "apartamento",
  "casa",
  "cobertura",
  "unidade",
]);
const unitLabelNoise = new Set(["n", "no", "numero"]);
const ignoredNameTokens = new Set(["da", "das", "de", "do", "dos", "e"]);
const ignoredAddressTokens = new Set([
  "a",
  "avenida",
  "av",
  "bairro",
  "de",
  "do",
  "da",
  "das",
  "dos",
  "estrada",
  "n",
  "no",
  "numero",
  "praca",
  "r",
  "rua",
  "travessa",
]);
const ocrDigitConfusions: Record<string, string> = {
  b: "8",
  i: "1",
  l: "1",
  o: "0",
  s: "5",
  z: "2",
};

function normalizeOcrToken(token: string) {
  return token.replace(/[bilosz]/g, (character) => ocrDigitConfusions[character]);
}

function normalizeAddressText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isSenderLine(line: string) {
  return /\b(remetente|origem|devolucao|retorno|sender|shipper|ship from|return address)\b/.test(
    normalizeAddressText(line),
  );
}

function findRecipientLine(lines: string[], residents: string[]) {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const nearbyTokens = new Set(
      normalizeAddressText(lines.slice(lineIndex, lineIndex + 3).join(" "))
        .split(" ")
        .filter(Boolean)
        .map(normalizeOcrToken),
    );

    for (const residentName of residents) {
      const nameTokens = normalizeAddressText(residentName)
        .split(" ")
        .filter((token) => token.length >= 3 && !ignoredNameTokens.has(token))
        .map(normalizeOcrToken);
      if (nameTokens.length < 2) continue;

      const matchedTokens = nameTokens.filter((token) =>
        nearbyTokens.has(token),
      ).length;
      if (matchedTokens >= Math.max(2, Math.ceil(nameTokens.length * 0.6))) {
        return lineIndex;
      }
    }
  }

  return -1;
}

function findStructuredDestinationLine(lines: string[]) {
  const destinationCityLine = lines.findIndex((line) =>
    /\b(?:cidade de destino|endereco de destino|cep de destino)\b/.test(
      normalizeAddressText(line),
    ),
  );
  if (destinationCityLine < 0) return -1;

  const firstLineToCheck = Math.max(0, destinationCityLine - 5);
  for (
    let index = destinationCityLine - 1;
    index >= firstLineToCheck;
    index -= 1
  ) {
    if (isSenderLine(lines[index])) break;
    if (/\bendereco\b/.test(normalizeAddressText(lines[index]))) {
      return Math.max(0, index - 1);
    }
  }
  return Math.max(0, destinationCityLine - 3);
}

function extractDestinationSection(text: string, residentNames: string[]) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const destinationLine = lines.findIndex((line) =>
    /\b(?:destinatario|ship to|deliver to|delivery address)\b/.test(
      normalizeAddressText(line),
    ),
  );
  const structuredDestinationLine =
    destinationLine < 0 ? findStructuredDestinationLine(lines) : -1;
  const recipientLine =
    destinationLine >= 0
      ? destinationLine
      : structuredDestinationLine >= 0
        ? structuredDestinationLine
        : findRecipientLine(lines, residentNames);
  if (recipientLine < 0) return "";

  const senderLine = lines.findIndex(
    (line, index) => index > recipientLine && isSenderLine(line),
  );
  return lines
    .slice(recipientLine, senderLine < 0 ? undefined : senderLine)
    .join("\n");
}

function findMatchingResidentName(
  lines: string[],
  startLine: number,
  residentNames: string[],
) {
  const nearbyTokens = new Set(
    normalizeAddressText(lines.slice(startLine, startLine + 3).join(" "))
      .split(" ")
      .filter(Boolean)
      .map(normalizeOcrToken),
  );

  return residentNames.find((residentName) => {
    const nameTokens = normalizeAddressText(residentName)
      .split(" ")
      .filter((token) => token.length >= 3 && !ignoredNameTokens.has(token))
      .map(normalizeOcrToken);
    if (nameTokens.length < 2) return false;
    const matchedTokens = nameTokens.filter((token) =>
      nearbyTokens.has(token),
    ).length;
    return matchedTokens >= Math.max(2, Math.ceil(nameTokens.length * 0.6));
  });
}

export function extractRecipientName(
  recognizedText: string,
  residentNames: string[] = [],
) {
  const lines = recognizedText.split(/\r?\n/).map((line) => line.trim());
  const destinationLine = lines.findIndex((line) =>
    /\b(?:destinatario|ship to|deliver to|delivery address)\b/.test(
      normalizeAddressText(line),
    ),
  );
  const structuredDestinationLine =
    destinationLine < 0 ? findStructuredDestinationLine(lines) : -1;
  if (destinationLine < 0 && structuredDestinationLine < 0) {
    const residentLine = findRecipientLine(lines, residentNames);
    return residentLine < 0
      ? ""
      : findMatchingResidentName(lines, residentLine, residentNames) ?? "";
  }

  const recipientStartLine =
    destinationLine >= 0 ? destinationLine : structuredDestinationLine;
  const senderLine = lines.findIndex(
    (line, index) => index > recipientStartLine && isSenderLine(line),
  );
  const recipientLines = lines.slice(
    recipientStartLine,
    senderLine < 0 ? undefined : senderLine,
  );
  const inlineName = recipientLines[0].replace(
    /^.*(?:destinat[aá]rio|ship\s*to|deliver\s*to|delivery\s*address)\s*:?\s*/i,
    "",
  );
  const candidates = [inlineName, ...recipientLines.slice(1)];
  for (const candidate of candidates) {
    const name = candidate
      .replace(
        /^.*(?:destinat[aá]rio|ship\s*to|deliver\s*to|delivery\s*address)\s*:?\s*/i,
        "",
      )
      .replace(/^\s*(?:nome|cliente)\s*[:-]\s*/i, "")
      .replace(/\([^)]*\)/g, "")
      .replace(
        /\s+(?:rua|r\.|avenida|av\.|travessa|estrada|logradouro|bairro|cep|apto|apartamento|bloco)\b.*$/i,
        "",
      )
      .replace(/\s+\d.*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    const normalizedName = normalizeAddressText(name);
    const tokens = normalizedName.split(" ").filter(Boolean);
    if (
      tokens.length < 2 ||
      tokens.length > 8 ||
      /\d/.test(name) ||
      /\b(?:rua|avenida|travessa|estrada|logradouro|bairro|cep|apto|apartamento|bloco|telefone|celular|remetente|origem|sender|shipper|ship|from)\b/.test(
        normalizedName,
      )
    ) {
      continue;
    }
    return name;
  }

  return "";
}

function extractPostalCodes(value: string) {
  return (value.match(/(?:^|[^\d])\d{5}[\s.-]?\d{3}(?=$|[^\d])/g) ?? []).map(
    (code) => code.replace(/\D/g, ""),
  );
}

function matchesDestinationStreetAndNumber(
  destinationText: string,
  street: string,
  addressNumber: string,
) {
  const destinationTokens = new Set(normalizeAddressText(destinationText).split(" "));
  const streetTokens = normalizeAddressText(street)
    .split(" ")
    .filter((token) => token.length > 1 && !ignoredAddressTokens.has(token));
  if (!streetTokens.length) return false;

  const matchedStreetTokens = streetTokens.filter((token) =>
    destinationTokens.has(token),
  ).length;
  const requiredStreetMatches = Math.max(
    1,
    Math.ceil(streetTokens.length * 0.75),
  );
  if (matchedStreetTokens < requiredStreetMatches) return false;

  const expectedNumbers: string[] = addressNumber.match(/\d+/g) ?? [];
  if (expectedNumbers.length) {
    const destinationNumbers: string[] =
      normalizeAddressText(destinationText).match(/\d+/g) ?? [];
    return expectedNumbers.every((number) =>
      destinationNumbers.includes(number),
    );
  }

  return /\b(?:s\s*n|sem numero)\b/.test(
    normalizeAddressText(destinationText),
  );
}

export type PackageDestinationAddress = {
  cep: string;
  street: string;
  address_number: string;
};

export type PackageAddressVerification = {
  status: "verified" | "mismatch" | "unknown";
  message: string;
};

export function verifyPackageDestinationAddress(
  recognizedText: string,
  address: PackageDestinationAddress,
  residentNames: string[],
): PackageAddressVerification {
  const destinationText = extractDestinationSection(
    recognizedText,
    residentNames,
  );
  if (!destinationText) {
    return {
      status: "unknown",
      message:
        "Não foi possível identificar o endereço do destinatário. Tire outra foto mostrando o bloco do destinatário, o logradouro, o número e o CEP.",
    };
  }

  const expectedCep = address.cep.replace(/\D/g, "");
  const postalCodes = extractPostalCodes(destinationText);
  if (postalCodes.length && !postalCodes.includes(expectedCep)) {
    return {
      status: "mismatch",
      message:
        "O CEP de destino da etiqueta não corresponde ao condomínio. O recebimento foi bloqueado.",
    };
  }

  if (
    matchesDestinationStreetAndNumber(
      destinationText,
      address.street,
      address.address_number,
    )
  ) {
    return {
      status: "verified",
      message: "Endereço de destino confirmado para este condomínio.",
    };
  }

  const destinationTokens = normalizeAddressText(destinationText)
    .split(" ")
    .filter(Boolean);
  const destinationNumbers = destinationText.match(/\d+/g) ?? [];
  if (destinationTokens.length >= 6 && destinationNumbers.length > 0) {
    return {
      status: "mismatch",
      message:
        "O endereço de destino da etiqueta não corresponde ao condomínio. O recebimento foi bloqueado.",
    };
  }

  return {
    status: "unknown",
    message:
      "Não foi possível confirmar o endereço de destino. Tire outra foto mostrando o logradouro, o número e o CEP.",
  };
}

function findExplicitUnitTokens(text: string) {
  const tokens = normalizeApartmentReference(text).match(/[a-z0-9]+/g) ?? [];
  const explicitTokens = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    if (!unitLabelTokens.has(tokens[index])) continue;
    let valueIndex = index + 1;
    while (unitLabelNoise.has(tokens[valueIndex] ?? "")) valueIndex += 1;
    const value = tokens[valueIndex];
    if (!value) continue;

    explicitTokens.add(value);
    if (/^[a-z]$/.test(value) || /^[a-z]$/.test(tokens[valueIndex + 1] ?? "")) {
      if (tokens[valueIndex + 1]) explicitTokens.add(tokens[valueIndex + 1]);
    }
  }

  return explicitTokens;
}

export function findUnitCandidates<T extends RecognizableUnit>(
  recognizedText: string,
  units: T[],
) {
  const normalizedText = normalizeApartmentReference(recognizedText);
  const recognizedTokens = new Set(
    normalizedText.match(/[a-z0-9]+/g) ?? [],
  );
  const fuzzyNumericTokens = new Set(
    [...recognizedTokens]
      .filter((token) => /\d/.test(token))
      .map(normalizeOcrToken),
  );
  const explicitUnitTokens = findExplicitUnitTokens(recognizedText);

  const matchesTokens = (
    tokens: string[],
    identifiers: string[],
    allowFuzzyNumbers: boolean,
  ) =>
    identifiers.every(
      (token) =>
        tokens.includes(token) ||
        (allowFuzzyNumbers &&
          /^\d{3,}$/.test(token) &&
          tokens.some(
            (recognizedToken) =>
              /\d/.test(recognizedToken) &&
              normalizeOcrToken(recognizedToken) === token,
          )),
    );

  const explicitMatches = units.filter((unit) => {
    const normalizedUnit = normalizeApartmentReference(unit.unit_number);
    const unitTokens = normalizedUnit.match(/[a-z0-9]+/g) ?? [];
    const identifiers = unitTokens.filter(
      (token) => !unitTypeTokens.has(token),
    );
    return (
      identifiers.length > 0 &&
      matchesTokens([...explicitUnitTokens], identifiers, true)
    );
  });
  if (explicitMatches.length) return explicitMatches;

  return units.filter((unit) => {
    const normalizedUnit = normalizeApartmentReference(unit.unit_number);
    const unitTokens = normalizedUnit.match(/[a-z0-9]+/g) ?? [];
    const identifiers = unitTokens.filter((token) => !unitTypeTokens.has(token));
    if (identifiers.length === 0) {
      return unitTokens.some((token) => recognizedTokens.has(token));
    }
    return matchesTokens([...recognizedTokens, ...fuzzyNumericTokens], identifiers, true);
  });
}

export function findResidentUnitCandidates<
  T extends RecognizableUnit,
  R extends RecognizableResident,
>(recognizedText: string, units: T[], residents: R[]) {
  const recognizedTokens = new Set(
    (normalizeApartmentReference(recognizedText).match(/[a-z0-9]+/g) ?? [])
      .map(normalizeOcrToken),
  );
  const unitIds = new Set(
    residents
      .filter((resident) => {
        if (!resident.name) return false;
        const nameTokens = normalizeApartmentReference(resident.name)
          .match(/[a-z0-9]+/g)
          ?.filter(
            (token) => token.length >= 3 && !ignoredNameTokens.has(token),
          )
          .map(normalizeOcrToken) ?? [];
        if (nameTokens.length < 2) return false;

        const matchedTokens = nameTokens.filter((token) =>
          recognizedTokens.has(token),
        ).length;
        return matchedTokens >= Math.max(2, Math.ceil(nameTokens.length * 0.6));
      })
      .map((resident) => resident.unit_id),
  );

  return units.filter((unit) => unitIds.has(unit.id));
}
