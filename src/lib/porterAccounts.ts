export function normalizePorterUsername(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 32);
}

export function suggestPorterUsername(
  street: string,
  porterName: string,
  buildingNumber: string,
) {
  const firstName = normalizePorterUsername(
    porterName.trim().split(/\s+/)[0] ?? "",
  ).replace(/[^a-z0-9]/g, "");
  if (!firstName) return "";

  const streetInitials = (
    street
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  )
    .map((word) => word[0])
    .join("");
  const normalizedNumber = normalizePorterUsername(buildingNumber)
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  const normalizedFirstName = firstName.slice(
    0,
    Math.max(0, 32 - normalizedNumber.length),
  );
  const availableInitials = Math.max(
    0,
    32 - normalizedFirstName.length - normalizedNumber.length,
  );

  return `${streetInitials.slice(0, availableInitials)}${normalizedFirstName}${normalizedNumber}`;
}

export function porterLoginEmail(username: string) {
  return `porter-${normalizePorterUsername(username)}@porter.invalid`;
}
