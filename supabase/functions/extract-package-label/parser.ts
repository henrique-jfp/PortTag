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

/** CEP completo: 8 dígitos, com ou sem hífen. Evita fragmentos de "Order ID". */
const cepPattern = /\b(?:\d{5}-\d{3}|\d{8})\b/g;

const cepSenderLine =
  /\b(?:remetente|sender|shipper|ship\s*from|origem|source)\b/i;
/** Bloco logístico da Amazon e campos de rota não são endereço de entrega. */
const cepLogisticsLine =
  /\b(?:cajamar|via\s*de\s*acesso|galp[aã]o|rodovia|rod\.?|km|nts|aft|fc|xfc|xcv|sorter|fulfillment|centro\s*de\s*distribui[çc]ao|oversize|cycle|lrj|cgh|srj|frj)\b/i;
const cepDestinationLine =
  /\b(?:cep|endere[çc]o|destino|destinat[aá]ri[oa]|ship\s*to|deliver\s*to|consignat[aá]ri[oa]|cidade\s+de\s+destino)\b/i;
const cepCountryLine = /\b(?:brasil|brazil)\b/i;
const cepStateToken =
  /\b(?:ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\b/i;
/** Amazon também imprime o CEP de entrega como "R 22041012". */
const cepShorthandLine = /^\s*r\s*\d{5}-?\d{3}\s*$/i;

function formatCep(raw: string) {
  const digits = raw.replace(/\D/g, "");
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/**
 * Escolhe o CEP por contexto, nunca pelo primeiro da etiqueta. Etiquetas da
 * Amazon e do Mercado Livre imprimem o CEP do centro de distribuição antes do
 * CEP de entrega; o texto do destinatário não basta para separá-los porque
 * essas etiquetas não trazem o cabeçalho "DESTINATÁRIO".
 */
function findCep(text: string, recipientName = "") {
  const lines = text.split(/\r?\n/);
  const senderLine = lines.findIndex((line) => cepSenderLine.test(line));
  const recipientLine = recipientName
    ? lines.findIndex((line) => line.includes(recipientName))
    : -1;

  const candidates = lines.flatMap((line, lineIndex) =>
    Array.from(line.matchAll(cepPattern), (match) => ({
      value: formatCep(match[0]),
      line,
      lineIndex,
    })),
  );
  if (candidates.length === 0) return "";

  const occurrences = new Map<string, number>();
  for (const candidate of candidates) {
    occurrences.set(
      candidate.value,
      (occurrences.get(candidate.value) ?? 0) + 1,
    );
  }

  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    let score = 0;
    if (senderLine >= 0 && candidate.lineIndex >= senderLine) score -= 12;
    if (cepSenderLine.test(candidate.line)) score -= 12;
    if (cepLogisticsLine.test(candidate.line)) score -= 8;
    if (cepDestinationLine.test(candidate.line)) score += 6;
    if (cepCountryLine.test(candidate.line)) score += 4;
    if (cepStateToken.test(candidate.line)) score += 2;
    if (cepShorthandLine.test(candidate.line)) score += 3;
    if (recipientLine >= 0 && candidate.lineIndex > recipientLine) score += 3;
    score += Math.min(4, ((occurrences.get(candidate.value) ?? 1) - 1) * 2);
    // Desempate estável quando a etiqueta não tem âncora de destinatário.
    score += candidate.lineIndex / 1000;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best.value;
}

const addressKeywords =
  /\b(?:rua|r\.|avenida|av\.|travessa|estrada|via|acesso|rodovia|rod\.|km|pra[çc]a|logradouro|bairro|cep|apto|apartamento|bloco|complemento|endere[çc]o|remetente|origem|sender|shipper|telefone|celular)\b/i;

/** "Cajamar SP" e "Rio de Janeiro RJ" são linhas de cidade, não de pessoa. */
const cityStateLine = new RegExp(
  "\\b(?:brasil|brazil|ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\\b$",
  "i",
);

/** Códigos de centro de distribuição da Amazon não são nome de morador. */
const logisticsMarkers =
  /\b(?:nts|aft|fc|xfc|xcv|sorter|fulfillment|centro de distribui[çc]ao|galp[aã]o|oversize|cycle|lrj|cgh|srj|frj)\b/i;
const nameConnectors = /^(?:e|de|da|do|das|dos)$/i;

function cleanRecipient(candidate: string) {
  const name = candidate
    .replace(
      /^.*(?:destinat[aá]ri[oa]s?|ship\s*to|deliver\s*to|consignat[aá]ri[oa])\s*:?\s*/i,
      "",
    )
    .replace(/^\s*(?:nome|cliente)\s*[:-]\s*/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(
      /\s+(?:rua|avenida|av\.|travessa|estrada|via|acesso|rodovia|rod\.|km|logradouro|bairro|cep|apto|apartamento|bloco|complemento|endere[çc]o)\b.*$/i,
      "",
    )
    .replace(/\s+\d.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = name.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8 || /\d/.test(name)) return "";
  if (addressKeywords.test(name.toLowerCase())) return "";
  if (cityStateLine.test(name)) return "";
  if (logisticsMarkers.test(name)) return "";
  if (tokens.includes("-")) return "";
  const meaningful = tokens.filter((token) => !nameConnectors.test(token));
  if (meaningful.length < 2) return "";
  // "NTS AFT - X FC" sobrevive quando o OCR perde o 9 de "XCV9". Siglas
  // curtas em caixa alta não são nome de pessoa.
  if (meaningful.some((token) => /^[A-Z]{1,3}$/.test(token))) return "";
  return name;
}

function findRecipient(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const anchor = lines.findIndex((line) =>
    /destinat[aá]ri[oa]s?|ship\s*to|deliver\s*to|consignat[aá]ri[oa]/i.test(line),
  );
  if (anchor >= 0) {
    for (const candidate of lines.slice(anchor, anchor + 4)) {
      const name = cleanRecipient(candidate);
      if (name) return name;
    }
    return "";
  }

  // Etiqueta do Mercado Livre não escreve "destinatário". Nela o nome vem
  // logo acima de "Endereço:"; sem isto o primeiro endereço do remetente
  // ("Rodovia ...") era confundido com o nome do morador.
  const addressAnchor = lines.findIndex((line) =>
    /^endere[çc]o\s*:/i.test(line),
  );
  if (addressAnchor > 0) {
    for (
      let index = addressAnchor - 1;
      index >= Math.max(0, addressAnchor - 3);
      index -= 1
    ) {
      const name = cleanRecipient(lines[index]);
      if (name) return name;
    }
  }

  for (const candidate of lines.slice(0, 10)) {
    const name = cleanRecipient(candidate);
    if (name) return name;
  }
  return "";
}

function findUnit(text: string) {
  // Etiquetas do Mercado Livre identificam a unidade como "complemento:307".
  // O OCR também costuma perder uma leitura da palavra ("comlemento"), então
  // as variantes conhecidas entram aqui como âncora determinística.
  const match = text.match(
    /\b(?:apto|apartamento|apt|ap|depto|departamento|unidade|casa|complemento|comlemento|complemto|complmento|compl)\.?\s*[:#=-]?\s*([0-9]+[a-z]?)/i,
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
  const lines = text.split(/\r?\n/);
  // "Endereço:", "Rua" etc. são âncoras fortes e vêm primeiro: no Mercado Livre
  // a rodovia do VENDEDOR aparece acima do endereço do destinatário.
  const strong =
    /\b(?:rua|avenida|av\.|travessa|estrada|r\.?|endere[çc]o)\b/i;
  const weak = /\b(?:via|acesso|rodovia|rod\.?)\b/i;
  return lines.find((line) => strong.test(line)) ?? lines.find((line) => weak.test(line));
}

function findStreet(text: string) {
  const line = findStreetLine(text);
  if (!line) return "";
  if (/^endere[çc]o\s*:/i.test(line)) {
    return line
      .replace(/^endere[çc]o\s*:\s*/i, "")
      .replace(/[,\n].*$/, "")
      .replace(/\d.*$/, "")
      .replace(/[.,;:\s]+$/g, "")
      .trim();
  }
  const match = line.match(
    /\b(rua|avenida|av\.|travessa|estrada|via|acesso|rodovia|rod\.?|r\.?)\s+([^\d,\n]+)/i,
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
    /^.*?\b(?:rua|avenida|av\.|travessa|estrada|via|acesso|rodovia|rod\.?|r\.?)\b[^0-9]*/i,
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
  const recipientName = findRecipient(destination);
  return {
    recipient_name: recipientName,
    unit_number: findUnit(destination),
    block_name: findBlock(destination),
    carrier: tracking.carrier,
    tracking_code: tracking.code,
    destination_cep: findCep(destination, recipientName),
    destination_street: findStreet(destination),
    destination_number: findStreetNumber(destination),
  };
}
