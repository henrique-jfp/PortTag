import { describe, expect, it } from "vitest";
import {
  buildAddressReason,
  decideAddressStatus,
} from "../../supabase/functions/extract-package-label/address";

describe("decisão determinística de endereço (Gemini)", () => {
  it("confere pelo CEP completo, mesmo com rua diferente", () => {
    expect(
      decideAddressStatus(
        { cep: "22041-050", street: "Praça Edmundo Bittencourt", number: "18" },
        { cep: "22041050", street: "Avenida Nossa Senhora de Copacabana" },
      ),
    ).toBe("verified");
  });

  it("bloqueia CEP divergente, ignorando o que a IA disse", () => {
    const status = decideAddressStatus(
      { cep: "22041050", street: "Praça Edmundo Bittencourt", number: "18" },
      { cep: "22050002", street: "Avenida Nossa Senhora de Copacabana" },
    );
    expect(status).toBe("mismatch");
    expect(buildAddressReason(
      status,
      { cep: "22041050" },
      { cep: "22050002" },
    )).toContain("22050-002");
  });

  it("usa logradouro + número quando o CEP está ausente", () => {
    expect(
      decideAddressStatus(
        { street: "PRAÇA EDMUNDO BITTENCOURT", number: "18" },
        { street: "praca edmundo bittencourt", address_number: "18" },
      ),
    ).toBe("verified");
    expect(
      decideAddressStatus(
        { street: "Rua Joseph Bloch", number: "18" },
        { street: "praca edmundo bittencourt", address_number: "18" },
      ),
    ).toBe("mismatch");
  });

  it("não inventa veredito com leitura incompleta", () => {
    expect(decideAddressStatus({}, { cep: "22050002" })).toBe("unknown");
    expect(
      decideAddressStatus(
        { cep: "22041", street: "Praça Edmundo Bittencourt" },
        { street: "Rua Joseph Bloch", address_number: "18" },
      ),
    ).toBe("unknown");
  });
});
