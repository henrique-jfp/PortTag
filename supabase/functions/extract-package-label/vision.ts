/**
 * Leitura de texto com Google Cloud Vision (DOCUMENT_TEXT_DETECTION).
 *
 * Aceita duas credenciais, nesta ordem:
 *   - VISION_SERVICE_ACCOUNT_JSON: JSON da service account (recomendado);
 *   - VISION_API_KEY: chave de API simples.
 *
 * Nada é impresso. O token OAuth da service account fica em memória e é
 * renovado apenas quando perto de expirar.
 */

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type TokenCache = { value: string; expiresAt: number };

let tokenCache: TokenCache | null = null;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function pemToBytes(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Aceita JSON cru ou escapado uma ou mais vezes por camadas de shell. */
function parseCredential(raw: string): ServiceAccount | null {
  let value: unknown = raw;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (typeof object.private_key === "string") {
        return {
          client_email: String(object.client_email ?? ""),
          private_key: object.private_key,
          token_uri:
            typeof object.token_uri === "string" ? object.token_uri : undefined,
        };
      }
      return null;
    }
    const text = String(value);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const slice = text.slice(start, end + 1);
    try {
      value = JSON.parse(slice);
    } catch {
      try {
        value = JSON.parse(`"${slice}"`);
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function serviceAccessToken(account: ServiceAccount) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.value;
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const claims = base64url(
    encoder.encode(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: account.token_uri ?? "https://oauth2.googleapis.com/token",
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingInput),
  );
  const assertion = `${signingInput}.${base64url(new Uint8Array(signature))}`;

  const response = await fetch(
    account.token_uri ?? "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !(payload as { access_token?: string }).access_token) {
    throw new Error("Não foi possível autenticar na Vision API.");
  }
  const typed = payload as { access_token: string; expires_in?: number };
  tokenCache = {
    value: typed.access_token,
    expiresAt: Date.now() + Number(typed.expires_in ?? 3600) * 1000,
  };
  return typed.access_token;
}

/** Só metadados, nunca o valor das credenciais: usado no diagnóstico da função. */
export function visionConfigDebug() {
  const serviceAccountRaw = Deno.env.get("VISION_SERVICE_ACCOUNT_JSON") ?? "";
  const apiKey = (Deno.env.get("VISION_API_KEY") ?? "").trim();
  return {
    serviceAccountPresent: serviceAccountRaw.length > 0,
    serviceAccountLength: serviceAccountRaw.length,
    serviceAccountParsed: Boolean(parseCredential(serviceAccountRaw)),
    apiKeyPresent: apiKey.length > 0,
  };
}

export function visionConfig() {
  const serviceAccountRaw = Deno.env.get("VISION_SERVICE_ACCOUNT_JSON") ?? "";
  const apiKey = (Deno.env.get("VISION_API_KEY") ?? "").trim();
  const account = serviceAccountRaw ? parseCredential(serviceAccountRaw) : null;
  if (!account && !apiKey) return null;
  return { account, apiKey };
}

export type VisionRead = {
  text: string;
  words: number;
  durationMs: number;
};

export async function readLabelText(
  imageBase64: string,
  config: NonNullable<ReturnType<typeof visionConfig>>,
  timeoutMs: number,
): Promise<VisionRead> {
  const startedAt = Date.now();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let url = "https://vision.googleapis.com/v1/images:annotate";
  if (config.apiKey) {
    url = `${url}?key=${encodeURIComponent(config.apiKey)}`;
  } else if (config.account) {
    headers.Authorization = `Bearer ${await serviceAccessToken(config.account)}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["pt"] },
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status;
    const message = (payload as { error?: { message?: string } })?.error?.message;
    throw new Error(`Vision respondeu ${status}${message ? `: ${message}` : ""}`);
  }

  const result = (payload as {
    responses?: Array<Record<string, unknown>>;
  }).responses?.[0];
  if (!result) throw new Error("Vision não devolveu resposta.");
  const error = result.error as { message?: string } | undefined;
  if (error?.message) throw new Error(`Vision: ${error.message}`);

  const annotation = (result.fullTextAnnotation ?? {}) as {
    text?: string;
    pages?: Array<{
      blocks?: Array<{
        paragraphs?: Array<{ words?: unknown[] }>;
      }>;
    }>;
  };
  const text = (annotation.text ?? "").replace(/\r/g, "").trim();
  let words = 0;
  for (const page of annotation.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        words += paragraph.words?.length ?? 0;
      }
    }
  }

  return { text, words, durationMs: Date.now() - startedAt };
}
