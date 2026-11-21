import { afterEach, describe, expect, it, vi } from "vitest";
import { cepDigits, lookupCepAddress } from "./addressLookup";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("busca de endereço pelo CEP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aceita CEP com máscara", () => {
    expect(cepDigits("01310-100")).toBe("01310100");
  });

  it("usa o ViaCEP quando disponível", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        logradouro: "Avenida Paulista",
        bairro: "Bela Vista",
        localidade: "São Paulo",
        uf: "SP",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupCepAddress("01310-100")).resolves.toEqual({
      street: "Avenida Paulista",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("viacep.com.br");
  });

  it("cai para o BrasilAPI se o ViaCEP falhar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "indisponível" }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          street: "Avenida Paulista",
          neighborhood: "Bela Vista",
          city: "São Paulo",
          state: "SP",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupCepAddress("01310100")).resolves.toEqual({
      street: "Avenida Paulista",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("brasilapi.com.br");
  });

  it("não inventa endereço quando os serviços não encontram o CEP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => jsonResponse({ erro: true })),
    );

    await expect(lookupCepAddress("00000000")).resolves.toBeNull();
  });
});
