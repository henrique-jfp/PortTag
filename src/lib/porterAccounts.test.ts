import { describe, expect, it } from "vitest";
import {
  resolvePorterUsername,
  suggestPorterUsername,
} from "./porterAccounts";

describe("usuário automático do porteiro", () => {
  it("sugere iniciais do endereço, primeiro nome e número", () => {
    expect(
      suggestPorterUsername("Avenida Paulista", "João Silva", "1000"),
    ).toBe("apjoao1000");
  });

  it("volta a sugerir quando o campo é esvaziado", () => {
    const suggested = suggestPorterUsername("Avenida Paulista", "João", "1000");
    expect(resolvePorterUsername(null, suggested)).toBe(suggested);
    expect(resolvePorterUsername("", suggested)).toBe(suggested);
    expect(resolvePorterUsername("   ", suggested)).toBe(suggested);
  });

  it("preserva um usuário digitado manualmente", () => {
    expect(resolvePorterUsername("joao-noite", "apjoao1000")).toBe(
      "joao-noite",
    );
  });
});
