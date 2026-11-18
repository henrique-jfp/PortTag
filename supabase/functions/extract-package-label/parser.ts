/**
 * Parser determinístico da etiqueta, porta do mesmo conjunto de regras medido
 * em scripts/label-reports/engine-test/parser.mjs.
 *
 * Rastreio e transportadora são lidos do texto inteiro (1º voto). Nome, unidade,
 * bloco e endereço vêm do bloco do destinatário, para não confundir com o
 * remetente. A IA entra depois apenas como 2º voto nos campos em branco.
 */

const trackingPatterns: Array<[string, RegExp]> = [
  ["Correios", /\b[A-Z]{2}[\s-]*\d{3}[\s-]*\d{3}[\s-]*\d{3}[\s-]*[A-Z]{2}\b/i],
  ["Amazon", /\bTBR[\s-]*\d{9,12}\b/i],
  ["Amazon", /\bAMZC[\s-]*\d{9}[\s-]*[A-Z]{2}\b/i],
  ["Shopee", /\bBR[\s-]*\d{12}[\s-]*[A-Z0-9]\b/i],
  ["Anjun", /\bAJ[\s-]*\d{15}\b/i],
  ["J&T Express", /\b(?:999|888)\d{12}\b/i],
  ["iMile", /\b\d{13,14}\b/i],
  ["Mercado Livre", /\b\d{11}\b/i],
];

/**
 * O nome impresso vence a dedução pelo formato do código. Sem isto, um rótulo
 * Jadlog com código de 11 dígitos virava "Mercado Livre" e um rótulo Mercado
 * Livre com código de 13 dígitos virava "iMile".
 */
const carrierNamePatterns: Array<[string, RegExp]> = [
  ["Correios", /\b(?:correios|sedex)\b/i],
  ["Amazon", /\bamazon\b/i],
  ["Shopee", /\b(?:shopee|spx)\b/i],
  ["Anjun", /\banjun\b/i],
  ["J&T Express", /\bj\s*&\s*t(?:\s*express)?\b/i],
  ["iMile", /\bimile\b/i],
  ["Mercado Livre", /\b(?:mercado\s*livre|meli|ml)\b/i],
  ["Jadlog", /\bjadlog\b/i],
  ["Total Express", /\btotal\s*express\b/i],
];

function findCarrierFromName(text: string) {
  for (const [carrier, pattern] of carrierNamePatterns) {
    if (pattern.test(text)) return carrier;
  }
  return "";
}

function findTracking(text: string) {
  for (const [carrier, pattern] of trackingPatterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        carrier: findCarrierFromName(text) || carrier,
        code: match[0].replace(/[\s-]/g, "").toUpperCase(),
      };
    }
  }
  return { carrier: findCarrierFromName(text), code: "" };
}

function findCep(text: string) {
  const match = text.match(/\b\d{5}-?\d{3}\b/);
  if (!match) return "";
  const digits = match[0].replace(/\D/g, "");
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

const addressKeywords =
  /\b(?:rua|r\.|avenida|av\.|travessa|estrada|logradouro|bairro|cep|apto|apartamento|bloco|complemento|remetente|origem|sender|shipper|telefone|celular)\b/i;

function cleanRecipient(candidate: string) {
  const name = candidate
    .replace(
      /^.*(?:destinat[aá]ri[oa]s?|ship\s*to|deliver\s*to|consignat[aá]ri[oa])\s*:?\s*/i,
      "",
    )
    .replace(/^\s*(?:nome|cliente)\s*[:-]\s*/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(
      /\s+(?:rua|avenida|av\.|travessa|estrada|logradouro|bairro|cep|apto|apartamento|bloco|complemento|endereco)\b.*$/i,
      "",
    )
    .replace(/\s+\d.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = name.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8 || /\d/.test(name)) return "";
  if (addressKeywords.test(name.toLowerCase())) return "";
  return name;
}

function findRecipient(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const anchor = lines.findIndex((line) =>
    /destinat[aá]ri[oa]s?|ship\s*to|deliver\s*to|consignat[aá]ri[oa]/i.test(line),
  );
  const candidates =
    anchor >= 0 ? lines.slice(anchor, anchor + 4) : lines.slice(0, 10);
  for (const candidate of candidates) {
    const name = cleanRecipient(candidate);
    if (name) return name;
  }
  return "";
}

function findUnit(text: string) {
  // Etiquetas do Mercado Livre identificam a unidade como "complemento:307".
  // A âncora continua determinística: rótulo + número, sem decisão de IA.
  const match = text.match(
    /\b(?:apto|apartamento|apt|ap|depto|departamento|unidade|casa|complemento|compl)\.?\s*[:#=-]?\s*([0-9]+[a-z]?)/i,
  );
  return match ? match[1].toUpperCase() : "";
}

function findBlock(text: string) {
  // O lookahead impede que "BLOCH" seja lido como "BL" + "OCH".
  const match = text.match(
    /\b(?:bloco|bl|torre)(?![a-z])\.?\s*[:#-]?\s*([a-z0-9]+)/i,
  );
  return match ? match[1].toUpperCase() : "";
}

function findStreetLine(text: string) {
  return text
    .split(/\r?\n/)
    .find((candidate) =>
      /\b(?:rua|avenida|av\.|travessa|estrada|r\.?)\b/i.test(candidate),
    );
}

function findStreet(text: string) {
  const line = findStreetLine(text);
  if (!line) return "";
  const match = line.match(
    /\b(rua|avenida|av\.|travessa|estrada|r\.?)\s+([^\d,\n]+)/i,
  );
  if (!match) return "";
  return `${match[1].replace(/\./g, "")} ${match[2].trim()}`
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findStreetNumber(text: string) {
  const line = findStreetLine(text);
  if (!line) return "";
  const afterStreet = line.replace(
    /^.*?\b(?:rua|avenida|av\.|travessa|estrada|r\.?)\b[^0-9]*/i,
    "",
  );
  const match = afterStreet.match(/\b(\d+[a-z]?)\b/i);
  return match ? match[1].toUpperCase() : "";
}

/** Recorte do destinatário: do âncora até o remetente. */
export function destinationText(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const anchor = lines.findIndex((line) =>
    /destinat[aá]ri[oa]s?|ship\s*to|deliver\s*to|consignat[aá]ri[oa]/i.test(line),
  );
  if (anchor < 0) return text;
  const sender = lines.findIndex(
    (line, index) =>
      index > anchor && /\b(?:remetente|sender|shipper|ship\s*from)\b/i.test(line),
  );
  return lines.slice(anchor, sender < 0 ? lines.length : sender).join("\n");
}

export type ParsedLabel = {
  recipient_name: string;
  unit_number: string;
  block_name: string;
  carrier: string;
  tracking_code: string;
  destination_cep: string;
  destination_street: string;
  destination_number: string;
};

export function parseLabel(text: string): ParsedLabel {
  const tracking = findTracking(text);
  const destination = destinationText(text);
  return {
    recipient_name: findRecipient(destination),
    unit_number: findUnit(destination),
    block_name: findBlock(destination),
    carrier: tracking.carrier,
    tracking_code: tracking.code,
    destination_cep: findCep(destination),
    destination_street: findStreet(destination),
    destination_number: findStreetNumber(destination),
  };
}
