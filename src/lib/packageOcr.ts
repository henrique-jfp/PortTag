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
  "apto",
  "apt",
  "ap",
  "casa",
  "cobertura",
  "cob",
  "complemento",
  "compl",
  "unidade",
  "un",
]);
const unitLabelNoise = new Set(["n", "no", "numero"]);
const ignoredNameTokens = new Set(["da", "das", "de", "do", "dos", "e"]);

/**
 * Tipo do logradouro. O cadastro e a etiqueta discordam com frequência
 * ("Rua" x "R", "Avenida" x "Av"), então essas palavras nunca entram na
 * comparação do nome da rua.
 */
const addressTypeTokens = new Set([
  "al",
  "alameda",
  "av",
  "avenida",
  "beco",
  "caminho",
  "campo",
  "conjunto",
  "estr",
  "estrada",
  "jardim",
  "jd",
  "largo",
  "lgo",
  "passagem",
  "pc",
  "pca",
  "praca",
  "praia",
  "quadra",
  "r",
  "rod",
  "rodovia",
  "rua",
  "trav",
  "travessa",
  "tv",
  "via",
  "viela",
  "vila",
  "vl",
]);

/**
 * Palavras que aparecem no bloco de endereço sem identificar o imóvel.
 */
const addressNoiseTokens = new Set([
  "a",
  "bairro",
  "bloco",
  "br",
  "brasil",
  "brazil",
  "caixa",
  "cep",
  "cidade",
  "complemento",
  "condominio",
  "de",
  "do",
  "da",
  "das",
  "dos",
  "edificio",
  "lote",
  "n",
  "no",
  "numero",
  "o",
  "os",
  "torre",
  "unidade",
]);

const ignoredAddressTokens = new Set([
  ...addressTypeTokens,
  ...addressNoiseTokens,
]);

/**
 * Abreviações comuns em etiquetas. O cadastro quase sempre traz a palavra
 * inteira, então expandimos antes de comparar.
 */
const addressAbbreviations: Record<string, string> = {
  alm: "almirante",
  cel: "coronel",
  dr: "doutor",
  eng: "engenheiro",
  gen: "general",
  mal: "marechal",
  min: "ministro",
  pe: "padre",
  pres: "presidente",
  prof: "professor",
  sta: "santa",
  sto: "santo",
};

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

function addressTokens(value: string) {
  return normalizeAddressText(value)
    .split(" ")
    .filter(Boolean)
    .map((token) => addressAbbreviations[token] ?? token)
    .filter((token) => token.length > 1 && !ignoredAddressTokens.has(token));
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Distância de edição limitada a 1. Existe para absorver o ruído típico do
 * OCR ("VIANA" x "VTANA") sem aproximar palavras realmente diferentes.
 */
function withinOneEdit(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) {
      leftIndex += 1;
    } else if (right.length > left.length) {
      rightIndex += 1;
    } else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  return edits + (left.length - leftIndex) + (right.length - rightIndex) <= 1;
}

function tokensLooselyEqual(left: string, right: string) {
  if (left === right) return true;

  // O mesmo mapa usado na unidade: o OCR troca letra por dígito parecido.
  const foldedLeft = normalizeOcrToken(left);
  const foldedRight = normalizeOcrToken(right);
  if (foldedLeft === foldedRight) return true;

  // Palavras curtas são curtas demais para tolerar erro.
  if (Math.min(foldedLeft.length, foldedRight.length) < 5) return false;
  return withinOneEdit(foldedLeft, foldedRight);
}

function streetMatchRatio(scope: string, street: string) {
  const streetTokens = addressTokens(street);
  if (!streetTokens.length) return 0;

  const scopeTokens = addressTokens(scope);
  if (!scopeTokens.length) return 0;

  const matched = streetTokens.filter((streetToken) =>
    scopeTokens.some((scopeToken) => tokensLooselyEqual(streetToken, scopeToken)),
  ).length;
  return matched / streetTokens.length;
}

function numberTokens(value: string) {
  return (value.match(/\d+/g) ?? []).map((number) => String(Number(number)));
}

function numberMatches(scope: string, addressNumber: string) {
  const expected = numberTokens(addressNumber);
  if (!expected.length) return false;
  const found = new Set(numberTokens(scope));
  return expected.every((number) => found.has(number));
}

const postalCodePattern = /(?:^|[^\d])\d{5}[\s.-]?\d{3}(?=$|[^\d])/g;

function extractPostalCodes(value: string) {
  return (value.match(postalCodePattern) ?? []).map((code) =>
    code.replace(/\D/g, ""),
  );
}

function hasAddressTypeToken(value: string) {
  return normalizeAddressText(value)
    .split(" ")
    .some((token) => addressTypeTokens.has(token));
}

const destinationAnchorPattern =
  /\b(?:destinatari[oa]s?|ship to|deliver to|delivery address|entregar (?:a|para)|consignatari[oa])\b/;

const structuredDestinationPattern =
  /\b(?:cidade de destino|endereco de destino|cep de destino)\b/;

const senderPattern =
  /\b(?:remetente|origem|devolucao|retorno|sender|shipper|ship from|return address)\b/;

function isSenderLine(line: string) {
  return senderPattern.test(normalizeAddressText(line));
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

function structuredDestinationStart(lines: string[]) {
  const destinationCityLine = lines.findIndex((line) =>
    structuredDestinationPattern.test(normalizeAddressText(line)),
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

type DestinationRange = { start: number; end: number };

function rangeUntilSender(lines: string[], start: number): DestinationRange {
  const senderLine = lines.findIndex(
    (line, index) => index > start && isSenderLine(line),
  );
  return { start, end: senderLine < 0 ? lines.length : senderLine };
}

/**
 * Texto antes do primeiro marcador de remetente. Serve de rede de segurança
 * quando a etiqueta não imprime "DESTINATÁRIO" e o bloco não é localizado: o
 * endereço do condomínio pode estar em qualquer linha antes do remetente, mas
 * nunca depois dele. Confirmar por esse trecho evita falso negativo; bloquear
 * continua exigindo o bloco do destinatário, para não condenar o porteiro pelo
 * CEP do remetente.
 */
function textBeforeFirstSender(value: string) {
  const lines = splitLines(value);
  const senderLine = lines.findIndex(isSenderLine);
  return (senderLine < 0 ? lines : lines.slice(0, senderLine)).join("\n");
}

/**
 * Localiza o bloco do destinatário sem exigir um cabeçalho fixo. Etiquetas da
 * Amazon, por exemplo, não imprimem "DESTINATÁRIO": nelas o bloco é achado
 * pelo CEP do condomínio. Sem isso, o texto inteiro era descartado.
 */
function destinationRange(
  lines: string[],
  residentNames: string[],
  expectedCep: string,
): DestinationRange | null {
  const anchorLine = lines.findIndex((line) =>
    destinationAnchorPattern.test(normalizeAddressText(line)),
  );
  if (anchorLine >= 0) return rangeUntilSender(lines, anchorLine);

  const structuredStart = structuredDestinationStart(lines);
  if (structuredStart >= 0) return rangeUntilSender(lines, structuredStart);

  const recipientLine = findRecipientLine(lines, residentNames);
  if (recipientLine >= 0) return rangeUntilSender(lines, recipientLine);

  // O CEP chega do cadastro com hífen; na etiqueta ele vem só com dígitos.
  const cep = expectedCep.replace(/\D/g, "");
  if (cep.length !== 8) return null;
  const cepLine = lines.findIndex((line) =>
    extractPostalCodes(line).includes(cep),
  );
  if (cepLine < 0) return null;

  // Ancorado no CEP: a janela fica curta de propósito para não engolir o
  // bloco do remetente, que costuma ficar logo abaixo.
  const start = Math.max(0, cepLine - 3);
  const senderLine = lines.findIndex(
    (line, index) => index > cepLine && isSenderLine(line),
  );
  const end = Math.min(
    senderLine < 0 ? lines.length : senderLine,
    cepLine + 3,
  );
  return { start, end };
}

export function findDestinationSection(
  recognizedText: string,
  residentNames: string[] = [],
  expectedCep = "",
) {
  const lines = splitLines(recognizedText);
  const range = destinationRange(lines, residentNames, expectedCep);
  if (!range) return "";
  return lines.slice(range.start, range.end).join("\n");
}

const recipientNamePrefixPattern =
  /^.*(?:destinat[aá]ri[oa]s?|ship\s*to|deliver\s*to|delivery\s*address|consignat[aá]ri[oa])\s*:?\s*/i;

function cleanRecipientCandidate(candidate: string) {
  const name = candidate
    .replace(recipientNamePrefixPattern, "")
    .replace(/^\s*(?:nome|cliente)\s*[:-]\s*/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(
      /\s+(?:rua|r\.|avenida|av\.|travessa|estrada|logradouro|bairro|cep|apto|apartamento|bloco|complemento|endereco)\b.*$/i,
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
    /\b(?:rua|avenida|travessa|estrada|logradouro|bairro|cep|apto|apartamento|bloco|telefone|celular|remetente|origem|sender|shipper|ship|from|endereco|destinatario|complemento)\b/.test(
      normalizedName,
    )
  ) {
    return "";
  }
  return name;
}

export function extractRecipientName(
  recognizedText: string,
  residentNames: string[] = [],
  expectedCep = "",
) {
  const lines = splitLines(recognizedText);
  const range = destinationRange(lines, residentNames, expectedCep);
  if (!range) return "";

  const block = lines.slice(range.start, range.end);
  for (const candidate of block) {
    const name = cleanRecipientCandidate(candidate);
    if (name) return name;
  }

  return "";
}

export type PackageDestinationAddress = {
  cep: string;
  street: string;
  address_number: string;
};

export type PackageAddressSignals = {
  destinationFound: boolean;
  postalCodes: string[];
  postalCodeMatched: boolean;
  postalCodeConflict: boolean;
  streetMatchSection: number;
  streetMatchAnywhere: number;
  numberMatched: boolean;
  residentMatched: boolean;
};

export type PackageAddressVerification = {
  status: "verified" | "mismatch" | "unknown";
  message: string;
  signals?: PackageAddressSignals;
};

export type DestinationVerificationInput = {
  recognizedText: string;
  /** Saída da passada só de dígitos. É a fonte mais confiável de CEP. */
  numericText?: string;
  /** Conteúdo lido dos códigos de barras/QR da etiqueta. */
  barcodeText?: string;
  address: PackageDestinationAddress;
  residentNames?: string[];
};

const verifiedStreetThreshold = 0.75;
const conflictingStreetThreshold = 0.34;

/**
 * Confere se a etiqueta é deste condomínio.
 *
 * A decisão continua determinística: nada de IA nem comparação frouxa. O que
 * mudou é a ordem das evidências. O CEP é a chave primária porque é o único
 * campo da etiqueta que não depende de o OCR acertar palavras longas. Quando
 * ele não aparece, caem as regras de logradouro + número e de morador.
 */
export function verifyPackageDestinationAddress(
  input: DestinationVerificationInput,
): PackageAddressVerification {
  const { recognizedText, address } = input;
  const numericText = input.numericText ?? "";
  const barcodeText = input.barcodeText ?? "";
  const residentNames = input.residentNames ?? [];

  const expectedCep = address.cep.replace(/\D/g, "");
  const hasExpectedCep = expectedCep.length === 8;

  const lines = splitLines(recognizedText);
  const range = destinationRange(lines, residentNames, expectedCep);
  const destinationText = range
    ? lines.slice(range.start, range.end).join("\n")
    : "";
  // Sem bloco de destinatário localizado, o texto antes do remetente ainda
  // pode provar o endereço. O trecho depois de "remetente"/"sender" nunca
  // entra: é o endereço de quem enviou.
  const looseText = range ? "" : textBeforeFirstSender(recognizedText);

  const destinationCodes = extractPostalCodes(destinationText);
  const allCodes = new Set(
    extractPostalCodes(`${recognizedText}\n${numericText}\n${barcodeText}`),
  );
  // CEPs impressos que não são do condomínio. Servem de aviso, nunca de prova:
  // o CEP do remetente está sempre na etiqueta.
  const otherPostalCodes = [...allCodes].filter(
    (code) => code !== expectedCep,
  );

  const postalCodeMatched = hasExpectedCep && allCodes.has(expectedCep);
  // Divergência só é conclusiva dentro do bloco do destinatário. Fora dele
  // estão os CEPs do remetente, que nunca conferem por definição.
  const postalCodeConflict =
    hasExpectedCep &&
    destinationCodes.length > 0 &&
    !destinationCodes.includes(expectedCep);

  const streetMatchSection = streetMatchRatio(destinationText, address.street);
  const streetMatchAnywhere = streetMatchRatio(
    range ? recognizedText : looseText,
    address.street,
  );
  // Para confirmar, qualquer lugar da etiqueta serve (o endereço pode ter sido
  // lido numa passada que não delimitou o bloco). Sem bloco, só o texto antes
  // do remetente; para bloquear, só o bloco.
  const streetMatch = Math.max(streetMatchSection, streetMatchAnywhere);
  const numberMatched =
    numberMatches(destinationText, address.address_number) ||
    numberMatches(range ? recognizedText : looseText, address.address_number);
  const residentMatched = findRecipientLine(lines, residentNames) >= 0;

  const signals: PackageAddressSignals = {
    destinationFound: destinationText.length > 0,
    postalCodes: destinationCodes,
    postalCodeMatched,
    postalCodeConflict,
    streetMatchSection,
    streetMatchAnywhere,
    numberMatched,
    residentMatched,
  };

  if (hasExpectedCep && postalCodeMatched) {
    return {
      status: "verified",
      message: "CEP do condomínio lido na etiqueta. Endereço de destino confirmado.",
      signals,
    };
  }

  if (streetMatch >= verifiedStreetThreshold && numberMatched) {
    return {
      status: "verified",
      message: "Logradouro e número da etiqueta conferem com o condomínio.",
      signals,
    };
  }

  if (residentMatched && streetMatch >= verifiedStreetThreshold) {
    return {
      status: "verified",
      message: "Nome do morador e endereço da etiqueta conferem com o condomínio.",
      signals,
    };
  }

  if (signals.destinationFound && postalCodeConflict) {
    return {
      status: "mismatch",
      message:
        "O CEP de destino da etiqueta não corresponde ao condomínio. O recebimento foi bloqueado.",
      signals,
    };
  }

  if (
    signals.destinationFound &&
    hasAddressTypeToken(destinationText) &&
    addressTokens(address.street).length >= 2 &&
    streetMatchSection <= conflictingStreetThreshold &&
    numberMatches(destinationText, address.address_number) &&
    destinationText.length >= 30
  ) {
    return {
      status: "mismatch",
      message:
        "O endereço de destino da etiqueta não corresponde ao condomínio. O recebimento foi bloqueado.",
      signals,
    };
  }

  return {
    status: "unknown",
    message: signals.destinationFound
      ? "Não foi possível confirmar o endereço de destino. Tire outra foto mostrando o logradouro, o número e o CEP."
      : unknownWithoutBlockMessage(hasExpectedCep, expectedCep, otherPostalCodes),
    signals,
  };
}

function formatPostalCode(code: string) {
  return code.length === 8 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/**
 * Sem bloco de destinatário não há como provar que o CEP impresso é o do
 * destino. Mas dizer só "tire outra foto" faz o porteiro fotografar cinco vezes
 * uma encomenda que provavelmente não é do prédio; citar o CEP que está na
 * etiqueta resolve a dúvida em uma linha.
 */
function unknownWithoutBlockMessage(
  hasExpectedCep: boolean,
  expectedCep: string,
  otherPostalCodes: string[],
) {
  if (hasExpectedCep && otherPostalCodes.length) {
    const printed = otherPostalCodes
      .slice(0, 3)
      .map(formatPostalCode)
      .join(", ");
    return `A etiqueta mostra o CEP ${printed}, diferente do condomínio (${formatPostalCode(expectedCep)}). Não foi possível confirmar o destino; confira antes de registrar.`;
  }

  return "Não foi possível identificar o endereço do destinatário. Tire outra foto mostrando o bloco do destinatário, o logradouro, o número e o CEP.";
}

function findExplicitUnitTokens(text: string) {
  const normalizedText = normalizeApartmentReference(text);
  const tokens = normalizedText.match(/[a-z0-9]+/g) ?? [];
  const explicitTokens = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    // Etiquetas colam o rótulo no número: AP901, APTO901, UN102, COB1.
    const glued = token.match(
      /^(?:apartamento|apto|apt|ap|unidade|un|cobertura|cob|casa)([a-z]?\d+[a-z]?)$/,
    );
    if (glued) explicitTokens.add(glued[1]);

    if (!unitLabelTokens.has(token)) continue;
    let valueIndex = index + 1;
    while (unitLabelNoise.has(tokens[valueIndex] ?? "")) valueIndex += 1;
    const value = tokens[valueIndex];
    if (!value) continue;

    explicitTokens.add(value);
    if (/^[a-z]$/.test(value) || /^[a-z]$/.test(tokens[valueIndex + 1] ?? "")) {
      if (tokens[valueIndex + 1]) explicitTokens.add(tokens[valueIndex + 1]);
    }
  }

  // BL1-901, BLOCO 2 - AP 102: o número da unidade vem depois do bloco.
  for (const match of normalizedText.matchAll(
    /\b(?:bl|bloco|torre|td)[- ]?\d+[- ]?(?:ap|apto|apt|apartamento|un)?[- ]?([a-z]?\d{2,4}[a-z]?)\b/g,
  )) {
    if (match[1]) explicitTokens.add(match[1]);
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
