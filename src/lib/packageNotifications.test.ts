import { describe, expect, it } from "vitest";
import { buildPackageNotificationMessage, whatsappLink } from "./packageNotifications";

describe("aviso ao morador", () => {
  it("cita o porteiro, o rastreio e diz que já pode retirar", () => {
    const message = buildPackageNotificationMessage({
      condominiumName: "Residencial Sol",
      unitLabel: "o apartamento 101",
      recipientName: "Maria",
      porterName: "João Silva",
      trackingCode: "ABC123",
    });

    expect(message).toContain("Olá, Maria!");
    expect(message).toContain("já pode ser retirada");
    expect(message).toContain("Rastreio: ABC123.");
    expect(message).toContain("Recebido por João Silva.");
  });

  it("omite rastreio e nome quando não foram informados", () => {
    const message = buildPackageNotificationMessage({
      condominiumName: "Residencial Sol",
      unitLabel: "o apartamento 101",
      recipientName: "  ",
      porterName: "",
      trackingCode: "  ",
    });

    expect(message).toBe(
      "Olá! Sua encomenda para o apartamento 101 chegou na portaria do Residencial Sol e já pode ser retirada.",
    );
  });

  it("monta o link wa.me com o código do país", () => {
    expect(whatsappLink("(11) 98765-4321", "Olá")).toBe(
      "https://wa.me/5511987654321?text=Ol%C3%A1",
    );
  });
});
