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
  company?: string;
  trackingCode?: string;
  receivedAt?: string | Date;
};

const brazilCountryCode = "55";

export function formatNotificationDate(dateInput?: string | Date): string {
  const d =
    dateInput instanceof Date
      ? dateInput
      : dateInput
        ? new Date(dateInput)
        : new Date();
  const safeDate = isNaN(d.getTime()) ? new Date() : d;

  const formatted = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(safeDate);

  return formatted.replace(/,?\s+/, " às ");
}

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
  company,
  trackingCode,
  receivedAt,
}: PackageNotificationMessage) {
  const recipient = recipientName?.trim();
  const porter = porterName?.trim();
  const tracking = trackingCode?.trim() || "Não informado";
  const carrier = company?.trim() || "Não informada";
  const condo = condominiumName?.trim() || "Condomínio";
  const unit = unitLabel.replace(/^(o\s+)?apartamento\s+/i, "").trim();
  const greeting = recipient ? `Olá, ${recipient}!` : "Olá!";
  const receivedBy = porter
    ? `foi recebida pelo porteiro ${porter}.`
    : "foi recebida pela portaria.";
  const dateStr = formatNotificationDate(receivedAt);

  return [
    "📦 Aviso de recebimento de encomenda",
    "",
    greeting,
    "",
    `Informamos que uma encomenda destinada ao apartamento ${unit} ${receivedBy}`,
    "",
    "📋 Detalhes da entrega:",
    `- Empresa: ${carrier}`,
    `- Código de rastreio: ${tracking}`,
    `- Recebimento: ${dateStr}`,
    "",
    "Sua encomenda está disponível para retirada na portaria.",
    "",
    "Atenciosamente,",
    `Portaria do ${condo} 🏢`,
  ].join("\n");
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
