export type AddressStatus = "verified" | "mismatch" | "unknown";

export type RawAddress = {
  cep?: unknown;
  street?: unknown;
  number?: unknown;
};

export type ExpectedAddress = {
  cep?: unknown;
  street?: unknown;
  address_number?: unknown;
};

function digits(value: unknown) {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function normalizeCep(value: unknown) {
  const valueDigits = digits(value);
  return valueDigits.length === 8 ? valueDigits : "";
}

function formatCep(value: unknown) {
  const valueDigits = digits(value);
  if (valueDigits.length !== 8) return "";
  return `${valueDigits.slice(0, 5)}-${valueDigits.slice(5)}`;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(av|avenida|rua|praça|praca|pca|logradouro)\b/g,
      (token) =>
        token === "av" || token === "avenida"
          ? "avenida"
          : token === "rua"
            ? "rua"
            : "praca",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  return value.replace(/[^0-9a-z]/gi, "").toLocaleLowerCase("pt-BR");
}

/**
 * Decisão determinística: a IA extrai os campos, mas quem compara com o
 * condomínio é este código. CEP completo tem prioridade; na ausência dele,
 * usa logradouro + número. Sem dados suficientes, o resultado é `unknown`.
 */
export function decideAddressStatus(
  destination: RawAddress,
  expected: ExpectedAddress,
): AddressStatus {
  const expectedCep = normalizeCep(expected.cep);
  const labelCep = normalizeCep(destination.cep);
  if (expectedCep && labelCep) {
    return expectedCep === labelCep ? "verified" : "mismatch";
  }

  const expectedStreet = normalizeText(expected.street);
  const labelStreet = normalizeText(destination.street);
  const expectedNumber = normalizeNumber(expected.address_number);
  const labelNumber = normalizeNumber(destination.number);
  if (expectedStreet && labelStreet && expectedNumber && labelNumber) {
    return expectedStreet === labelStreet && expectedNumber === labelNumber
      ? "verified"
      : "mismatch";
  }

  return "unknown";
}

export function buildAddressReason(
  status: AddressStatus,
  destination: RawAddress,
  expected: ExpectedAddress,
) {
  const labelCep = formatCep(destination.cep);
  const expectedCep = formatCep(expected.cep);

  if (status === "verified") {
    return `CEP da etiqueta ${labelCep} confere com o cadastrado ${expectedCep}.`;
  }
  if (status === "mismatch") {
    return `CEP da etiqueta ${labelCep || "ilegível"} difere do cadastrado ${expectedCep || "não informado"}.`;
  }
  return "CEP, logradouro ou número da etiqueta não foram lidos por completo; confira fisicamente.";
}
