export type PackageNotification = {
  id: string;
  channel: string;
  recipient: string;
  message: string;
  status: string;
};

const brazilCountryCode = "55";

/**
 * Monta o link do WhatsApp a partir do número já normalizado pelo banco.
 * Um número local tem no máximo 11 dígitos; a partir de 12 ele já vem com o
 * código do país.
 */
export function whatsappLink(recipient: string, message: string) {
  const digits = recipient.replace(/\D/g, "");
  const withCountryCode =
    digits.length >= 12 && digits.startsWith(brazilCountryCode)
      ? digits
      : `${brazilCountryCode}${digits}`;
  return `https://wa.me/${withCountryCode}?text=${encodeURIComponent(message)}`;
}
