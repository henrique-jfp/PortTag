export type CepAddress = {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

export function cepDigits(value: string) {
  return value.replace(/\D/g, "");
}

type ViaCepResponse = {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

type BrasilApiResponse = {
  erro?: boolean;
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
};

function isAbort(error: unknown, signal?: AbortSignal) {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

/**
 * Consulta o endereço de um CEP. O ViaCEP é a fonte principal; o BrasilAPI
 * entra como fallback para não deixar o cadastro sem preenchimento quando o
 * serviço principal estiver indisponível.
 */
export async function lookupCepAddress(
  cep: string,
  signal?: AbortSignal,
): Promise<CepAddress | null> {
  const digits = cepDigits(cep);
  if (digits.length !== 8) return null;

  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal,
    });
    if (response.ok) {
      const data = (await response.json()) as ViaCepResponse;
      if (!data.erro) {
        const address: CepAddress = {
          street: data.logradouro?.trim() ?? "",
          neighborhood: data.bairro?.trim() ?? "",
          city: data.localidade?.trim() ?? "",
          state: data.uf?.trim() ?? "",
        };
        if (address.street || address.city) return address;
      }
    }
  } catch (error) {
    if (isAbort(error, signal)) throw error;
  }

  const response = await fetch(
    `https://brasilapi.com.br/api/cep/v1/${digits}`,
    { signal },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as BrasilApiResponse;
  if (data.erro) return null;
  return {
    street: data.street?.trim() ?? "",
    neighborhood: data.neighborhood?.trim() ?? "",
    city: data.city?.trim() ?? "",
    state: data.state?.trim() ?? "",
  };
}
