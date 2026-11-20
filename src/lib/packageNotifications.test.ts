import { describe, expect, it } from "vitest";
import {
  buildPackageNotificationMessage,
  whatsappLink,
} from "./packageNotifications";

describe("aviso ao morador", () => {
  it("formata a mensagem personalizada completa com todos os detalhes", () => {
    const fixedDate = new Date("2026-11-20T14:30:00Z");
    const message = buildPackageNotificationMessage({
      condominiumName: "Residencial Sol",
      unitLabel: "101",
      recipientName: "Maria",
      porterName: "João Silva",
      company: "Amazon",
      trackingCode: "BR123456789",
      receivedAt: fixedDate,
    });

    expect(message).toContain("📦 Aviso de recebimento de encomenda");
    expect(message).toContain("Olá, Maria!");
    expect(message).toContain(
      "Informamos que uma encomenda destinada ao apartamento 101 foi recebida pelo porteiro João Silva.",
    );
    expect(message).toContain("📋 Detalhes da entrega:");
    expect(message).toContain("- Empresa: Amazon");
    expect(message).toContain("- Código de rastreio: BR123456789");
    expect(message).toContain("- Recebimento: ");
    expect(message).toContain("Sua encomenda está disponível para retirada na portaria.");
    expect(message).toContain("Atenciosamente,\nPortaria do Residencial Sol 🏢");
  });

  it("trata valores ausentes com padrões amigáveis", () => {
    const message = buildPackageNotificationMessage({
      condominiumName: "Residencial Sol",
      unitLabel: "o apartamento 202 (bloco B)",
      recipientName: "  ",
      porterName: "",
      trackingCode: "  ",
    });

    expect(message).toContain("Olá!");
    expect(message).toContain(
      "Informamos que uma encomenda destinada ao apartamento 202 (bloco B) foi recebida pela portaria.",
    );
    expect(message).toContain("- Empresa: Não informada");
    expect(message).toContain("- Código de rastreio: Não informado");
    expect(message).toContain("Portaria do Residencial Sol 🏢");
  });

  it("monta o link wa.me com o código do país", () => {
    expect(whatsappLink("(11) 98765-4321", "Olá")).toBe(
      "https://wa.me/5511987654321?text=Ol%C3%A1",
    );
  });
});
