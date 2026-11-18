/**
 * Ancoragem: o valor devolvido pela IA precisa aparecer no texto do OCR. É o
 * mecanismo que impede campo inventado e que vai sustentar o "campo amarelo" no
 * futuro. Porta de scripts/label-reports/engine-test/grounding.mjs.
 */

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

const compact = (value: unknown) => normalize(value).replace(/ /g, "");

function tokenCoverage(value: unknown, text: string) {
  const tokens = normalize(value)
    .split(" ")
    .filter((token) => token.length >= 2);
  if (!tokens.length) return null;
  const haystack = normalize(text);
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / tokens.length;
}

/**
 * true = aparece no texto; false = não aparece; null = não se aplica.
 */
export function grounded(field: string, value: unknown, text: string) {
  if (!value) return null;
  if (field === "carrier") return null;
  if (field === "destination_cep") return compact(text).includes(String(value));
  if (field === "tracking_code") {
    return compact(text).includes(
      String(value).toUpperCase().replace(/[^A-Z0-9]/g, ""),
    );
  }
  if (
    field === "recipient_name" ||
    field === "destination_street" ||
    field === "unit_number"
  ) {
    const coverage = tokenCoverage(value, text);
    return coverage === null ? null : coverage >= 0.8;
  }
  return normalize(text).split(" ").includes(normalize(value));
}
