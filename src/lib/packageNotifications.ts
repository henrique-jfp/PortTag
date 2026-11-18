export type PackageNotification = {
  id: string;
  channel: string;
  recipient: string;
  message: string;
  status: string;
};

export type PackageNotificationMessage = {
  condominiumName: string;
  unitLabel: string;
  recipientName?: string;
  porterName?: string;
  trackingCode?: string;
};

const brazilCountryCode = "55";

/**
 * Texto enviado ao morador. O servidor monta a mesma mensagem na RPC
 * `register_package_notification`; esta versão atende os links criados no
 * próprio aparelho antes da gravação (importação em massa, por exemplo).
 */
export function buildPackageNotificationMessage({
  condominiumName,
  unitLabel,
  recipientName,
  porterName,
  trackingCode,
}: PackageNotificationMessage) {
  const recipient = recipientName?.trim();
  const porter = porterName?.trim();
  const tracking = trackingCode?.trim();
  const greeting = recipient ? `Olá, ${recipient}!` : "Olá!";
  const lines = [
    `${greeting} Sua encomenda para ${unitLabel} chegou na portaria do ${condominiumName} e já pode ser retirada.`,
  ];

  if (tracking) lines.push(`Rastreio: ${tracking}.`);
  if (porter) lines.push(`Recebido por ${porter}.`);

  return lines.join("\n");
}

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
