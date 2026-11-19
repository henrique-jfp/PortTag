/**
 * Lista fechada de transportadoras aceitas pelo extrator de etiquetas.
 * `unknown` é o valor de escape: a empresa continua opcional no app e no banco,
 * e a detecção local ainda pode tentar identificar a transportadora depois.
 */
export const carrierValues = [
  "Correios",
  "Amazon",
  "Shopee",
  "Anjun",
  "J&T Express",
  "iMile",
  "Mercado Livre",
  "Jadlog",
  "Total Express",
  "Shippify",
  "unknown",
] as const;

export type Carrier = (typeof carrierValues)[number];

export const unknownCarrier: Carrier = "unknown";

const allowedCarriers = new Set<string>(carrierValues);

function isCarrier(value: string): value is Carrier {
  return allowedCarriers.has(value);
}

/** Aceita somente os valores do enum; qualquer outra resposta vira `unknown`. */
export function normalizeCarrier(value: unknown): Carrier {
  if (typeof value !== "string") return unknownCarrier;
  const candidate = value.replace(/\s+/g, " ").trim();
  return isCarrier(candidate) ? candidate : unknownCarrier;
}

/** `unknown` sai como string vazia para não obrigar empresa no recebimento. */
export function carrierForLabel(value: unknown): Carrier | "" {
  const carrier = normalizeCarrier(value);
  return carrier === unknownCarrier ? "" : carrier;
}
