export function normalizePorterUsername(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 32);
}

/**
 * Sugestão padrão: iniciais do endereço + primeiro nome + inicial do
 * sobrenome + bloco (quando há) + número do prédio. O porteiro pode editar.
 */
export function suggestPorterUsername(
  street: string,
  porterName: string,
  buildingNumber: string,
  blockName?: string,
) {
  const nameParts = porterName.trim().split(/\s+/).filter(Boolean);
  const firstName = normalizePorterUsername(
    nameParts[0] ?? "",
  ).replace(/[^a-z0-9]/g, "");
  if (!firstName) return "";

  const surnameInitial = nameParts.length > 1
    ? (normalizePorterUsername(nameParts[nameParts.length - 1]).replace(
        /[^a-z0-9]/g,
        "",
      )[0] ?? "")
    : "";

  const streetInitials = (
    street
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  )
    .map((word) => word[0])
    .join("");

  const normalizedBlock = normalizePorterUsername(blockName ?? "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const normalizedNumber = normalizePorterUsername(buildingNumber)
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);

  const suffix = `${surnameInitial}${normalizedBlock}${normalizedNumber}`;
  const normalizedFirstName = firstName.slice(
    0,
    Math.max(0, 32 - suffix.length),
  );
  const availableInitials = Math.max(
    0,
    32 - normalizedFirstName.length - suffix.length,
  );

  return `${streetInitials.slice(0, availableInitials)}${normalizedFirstName}${suffix}`;
}

/**
 * O campo de usuário começa vazio e acompanha a sugestão automática. Se a
 * pessoa apagar o que digitou, voltamos a sugerir em vez de travar o campo
 * vazio para sempre.
 */
export function resolvePorterUsername(
  override: string | null,
  suggested: string,
) {
  return override?.trim() ? override : suggested;
}

export function porterLoginEmail(username: string) {
  return `porter-${normalizePorterUsername(username)}@porter.invalid`;
}
