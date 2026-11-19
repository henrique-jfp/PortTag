import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Central do Label Lab no Super Admin.
 *
 * Esta função autentica o JWT do Super Admin e faz o que o frontend nunca
 * poderia fazer: chamar `label-lab` com o segredo interno, ler fotos do bucket
 * privado e executar as RPCs de aprovação/publicação. Não substitui regras por
 * IA: o editor só aceita regex para quatro campos não determinísticos.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const bucket = "label-lab-private";
const maximumImageBytes = 2_800_000;
const maximumImages = 6;
const maximumCases = 20;
const labTimeoutMs = 45_000;
const allowedFields = new Set([
  "carrier",
  "tracking_code",
  "unit_number",
  "recipient_name",
]);
const mimeExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type LabImage = {
  name: string;
  imageBase64: string;
  mimeType: string;
};

type Rule = { pattern: string; note: string };
type Rules = Record<string, Rule[]>;

type RegressionCase = {
  id: string;
  name: string;
  field: string;
  expected: string;
  sampleId?: string;
  input?: string;
};

type AdminRequest = {
  action?: unknown;
  images?: unknown;
  sourceSampleId?: unknown;
  condominiumId?: unknown;
  expectedAddress?: unknown;
  saveSample?: unknown;
  rulesetId?: unknown;
  name?: unknown;
  description?: unknown;
  rules?: unknown;
  cases?: unknown;
  confirmationText?: unknown;
  expectedVersion?: unknown;
  sampleId?: unknown;
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

// A regressão roda as regex sobre o OCR original. Manter as quebras de linha
// é essencial: sugestões como `(?<=TRANSP:\s)[A-Z\s]+(?=\n)` deixariam de
// casar se o texto fosse achatado com `cleanText`.
function cleanOcrText(value: unknown, maxLength = 3000) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

// Expressões são trimadas e limitadas, mas o espaço interno é preservado.
function cleanPattern(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 160);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function base64Bytes(value: unknown): Uint8Array {
  if (typeof value !== "string") return new Uint8Array();
  const base64 = value
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s/g, "");
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return new Uint8Array();
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeImages(value: unknown): LabImage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumImages) {
    throw new Error(`Envie de 1 a ${maximumImages} imagens.`);
  }
  return value.map((item, index) => {
    const raw = isRecord(item) ? item : {};
    const mimeType = String(raw.mimeType ?? "");
    if (!(mimeType in mimeExtensions)) {
      throw new Error("Formato não suportado. Use JPEG, PNG ou WEBP.");
    }
    const bytes = base64Bytes(raw.imageBase64);
    if (!bytes.length || bytes.length > maximumImageBytes) {
      throw new Error("Imagem inválida ou grande demais.");
    }
    return {
      name: cleanText(raw.name, 120) || `etiqueta-${index + 1}`,
      imageBase64: bytesToBase64(bytes),
      mimeType,
    };
  });
}

function sanitizeRules(value: unknown): Rules {
  if (!isRecord(value)) throw new Error("Regras inválidas.");
  const rules: Rules = {};
  for (const [field, rawList] of Object.entries(value)) {
    if (!allowedFields.has(field)) {
      throw new Error(`Campo ${field} não pode ter regex. Use apenas campos não determinísticos.`);
    }
    if (!Array.isArray(rawList) || rawList.length > 12) {
      throw new Error("Cada campo aceita no máximo 12 expressões.");
    }
    rules[field] = rawList.map((item) => {
      const raw = isRecord(item) ? item : {};
      const pattern = cleanPattern(raw.pattern);
      if (pattern.length < 4) throw new Error("Regex muito curta.");
      try {
        new RegExp(pattern, "i");
      } catch {
        throw new Error(`Regex inválida: ${pattern}`);
      }
      return { pattern, note: cleanText(raw.note, 160) };
    });
  }
  return rules;
}

function sanitizeCases(value: unknown): RegressionCase[] {
  if (!Array.isArray(value) || value.length > maximumCases) {
    throw new Error(`Máximo de ${maximumCases} casos de regressão.`);
  }
  return value.map((item, index) => {
    const raw = isRecord(item) ? item : {};
    const field = String(raw.field ?? "");
    const expected = cleanText(raw.expected, 120);
    if (!allowedFields.has(field) || !expected) {
      throw new Error(`Caso ${index + 1} inválido.`);
    }
    const sampleId = isUuid(raw.sampleId) ? raw.sampleId : undefined;
    const input = typeof raw.input === "string"
      ? cleanOcrText(raw.input, 3000)
      : undefined;
    if (!sampleId && !input) {
      throw new Error(`Caso ${index + 1} precisa de uma amostra ou texto OCR.`);
    }
    return {
      id: cleanText(raw.id, 80) || `caso-${index + 1}`,
      name: cleanText(raw.name, 120) || `Caso ${index + 1}`,
      field,
      expected,
      ...(sampleId ? { sampleId } : {}),
      ...(input ? { input } : {}),
    };
  });
}

function normalize(value: unknown) {
  return cleanText(value, 200)
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, "");
}

function runRegression(rules: Rules, cases: RegressionCase[]) {
  const details = cases.map((item) => {
    const input = item.input ?? "";
    const matched = (rules[item.field] ?? []).flatMap((rule) => {
      try {
        const match = new RegExp(rule.pattern, "i").exec(input);
        if (!match) return [];
        return [{ value: cleanText(match[1] ?? match[0], 200), pattern: rule.pattern }];
      } catch {
        return [];
      }
    })[0];
    const actual = matched?.value ?? "";
    return {
      id: item.id,
      name: item.name,
      field: item.field,
      expected: item.expected,
      actual: actual.slice(0, 120),
      pattern: matched?.pattern ?? null,
      sampleId: item.sampleId ?? null,
      passed: normalize(actual) === normalize(item.expected),
    };
  });
  const passed = details.filter((item) => item.passed).length;
  return {
    summary: {
      total: details.length,
      passed,
      failed: details.length - passed,
      testedAt: new Date().toISOString(),
    },
    details,
  };
}

async function callLab(
  supabaseUrl: string,
  anonKey: string,
  labSecret: string,
  images: LabImage[],
  expectedAddress: Record<string, string>,
) {
  const response = await fetch(`${supabaseUrl}/functions/v1/label-lab`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      "x-label-lab-secret": labSecret,
    },
    body: JSON.stringify({
      images,
      expectedAddress,
      suggest: true,
    }),
    signal: AbortSignal.timeout(labTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`label-lab respondeu HTTP ${response.status}.`);
  }
  const body = (await response.json()) as {
    results?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(body.results) || body.results.length !== images.length) {
    throw new Error("O laboratório não devolveu um resultado por imagem.");
  }
  return body.results;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const labSecret = Deno.env.get("LABEL_LAB_SECRET");
  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return respond({ error: "Sessão inválida." }, 401);
  }
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !labSecret) {
    return respond({ error: "Configuração ausente." }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return respond({ error: "Sessão inválida." }, 401);
  }
  const actor = userData.user.id;
  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("is_super_admin")
    .eq("id", actor)
    .maybeSingle();
  if (profileError) return respond({ error: profileError.message }, 500);
  if (!profile?.is_super_admin) {
    return respond({ error: "Acesso exclusivo do Super Admin." }, 403);
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let input: AdminRequest;
  try {
    input = await request.json();
  } catch {
    return respond({ error: "Corpo da solicitação inválido." }, 400);
  }

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await service.rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
  }

  try {
    switch (String(input.action ?? "")) {
      case "analyze": {
        let images: LabImage[];
        let imageBytes: Uint8Array[] = [];
        let expectedAddress = {
          cep: cleanText((input.expectedAddress as Record<string, unknown> | undefined)?.cep, 9),
          street: cleanText((input.expectedAddress as Record<string, unknown> | undefined)?.street, 160),
          address_number: cleanText(
            (input.expectedAddress as Record<string, unknown> | undefined)?.address_number,
            20,
          ),
        };

        if (input.sourceSampleId) {
          if (!isUuid(input.sourceSampleId)) {
            return respond({ error: "Amostra inválida." }, 400);
          }
          const { data: sample, error: sampleError } = await service
            .from("label_lab_queue")
            .select("id, condominium_id, storage_path, mime_type")
            .eq("id", input.sourceSampleId)
            .is("deleted_at", null)
            .maybeSingle();
          if (sampleError) return respond({ error: sampleError.message }, 500);
          if (!sample || !(sample.mime_type in mimeExtensions)) {
            return respond({ error: "Amostra não encontrada." }, 404);
          }
          const { data: file, error: fileError } = await service.storage
            .from(bucket)
            .download(sample.storage_path);
          if (fileError || !file) {
            return respond({ error: "Foto da amostra ausente." }, 404);
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          imageBytes = [bytes];
          images = [{
            name: cleanText(sample.id, 120),
            imageBase64: bytesToBase64(bytes),
            mimeType: sample.mime_type,
          }];
          if (!expectedAddress.cep) {
            const { data: condominium } = await service
              .from("condominiums")
              .select("cep, street, address_number")
              .eq("id", sample.condominium_id)
              .maybeSingle();
            expectedAddress = {
              cep: cleanText(condominium?.cep, 9),
              street: cleanText(condominium?.street, 160),
              address_number: cleanText(condominium?.address_number, 20),
            };
          }
        } else {
          images = sanitizeImages(input.images);
          imageBytes = images.map((image) => base64Bytes(image.imageBase64));
        }

        const results = await callLab(
          supabaseUrl,
          anonKey,
          labSecret,
          images,
          expectedAddress,
        );
        const saved: Array<{ index: number; sampleId: string; duplicate: boolean }> = [];

        if (input.saveSample === true && !input.sourceSampleId) {
          if (!isUuid(input.condominiumId)) {
            return respond({ error: "Escolha o condomínio para salvar a amostra." }, 400);
          }
          for (let index = 0; index < results.length; index += 1) {
            const result = results[index];
            if (result.ok !== true) continue;
            const bytes = imageBytes[index];
            const mimeType = images[index].mimeType;
            const sampleId = crypto.randomUUID();
            const path = `${input.condominiumId}/${sampleId}.${mimeExtensions[mimeType]}`;
            const { error: uploadError } = await service.storage
              .from(bucket)
              .upload(path, bytes, {
                contentType: mimeType,
                cacheControl: "3600",
                upsert: false,
              });
            if (uploadError) {
              saved.push({ index, sampleId: "", duplicate: false });
              continue;
            }
            const storedId = await rpc<string>("enqueue_label_lab_manual_sample", {
              p_id: sampleId,
              p_actor: actor,
              p_condominium_id: input.condominiumId,
              p_storage_path: path,
              p_image_sha256: await sha256Hex(bytes),
              p_mime_type: mimeType,
              p_image_bytes: bytes.length,
              p_analysis: result,
            });
            const duplicate = storedId !== sampleId;
            if (duplicate) {
              await service.storage.from(bucket).remove([path]);
            }
            saved.push({ index, sampleId: storedId, duplicate });
          }
        }

        return respond({ results, saved });
      }

      case "test": {
        const rules = sanitizeRules(input.rules);
        const cases = sanitizeCases(input.cases);
        const resolved: RegressionCase[] = [];
        for (const item of cases) {
          if (!item.sampleId) {
            resolved.push(item);
            continue;
          }
          const { data: sample, error: sampleError } = await service
            .from("label_lab_queue")
            .select("ocr_text, analysis")
            .eq("id", item.sampleId)
            .is("deleted_at", null)
            .maybeSingle();
          if (sampleError) throw new Error(sampleError.message);
          const analysis = isRecord(sample?.analysis) ? sample.analysis : {};
          const ocrText = cleanOcrText(
            sample?.ocr_text ?? analysis.ocrText,
            3000,
          );
          if (!ocrText) {
            throw new Error("Uma amostra selecionada ainda não tem OCR para testar.");
          }
          resolved.push({ ...item, input: ocrText });
        }
        if (!resolved.length) throw new Error("Adicione ao menos um caso de regressão.");

        const { summary, details } = runRegression(rules, resolved);
        const regression = {
          ...summary,
          // Resultado rico volta para a tela, mas o rascunho guarda só o
          // necessário para repetir o teste: sem texto OCR nem valor lido.
          cases: details.map(({ id, name, field, expected, pattern, sampleId, passed }) => ({
            id, name, field, expected, pattern, sampleId, passed,
          })),
        };
        const ruleset = await rpc<Record<string, unknown>>("save_label_lab_ruleset", {
          p_ruleset_id: isUuid(input.rulesetId) ? input.rulesetId : null,
          p_actor: actor,
          p_name: cleanText(input.name, 120),
          p_description: cleanText(input.description, 1000),
          p_rules: rules,
          p_regression: regression,
          p_source_sample_ids: resolved
            .map((item) => item.sampleId)
            .filter((value): value is string => Boolean(value)),
        });
        return respond({ ruleset, results: details });
      }

      case "save": {
        const rules = sanitizeRules(input.rules);
        const ruleset = await rpc<Record<string, unknown>>("save_label_lab_ruleset", {
          p_ruleset_id: isUuid(input.rulesetId) ? input.rulesetId : null,
          p_actor: actor,
          p_name: cleanText(input.name, 120),
          p_description: cleanText(input.description, 1000),
          p_rules: rules,
          p_regression: {
            total: 0,
            passed: 0,
            failed: 0,
            testedAt: null,
            cases: [],
          },
          p_source_sample_ids: [],
        });
        return respond({ ruleset });
      }

      case "approve": {
        if (!isUuid(input.rulesetId)) return respond({ error: "Rascunho inválido." }, 400);
        const ruleset = await rpc<Record<string, unknown>>("approve_label_lab_ruleset", {
          p_ruleset_id: input.rulesetId,
          p_actor: actor,
          p_confirmation_text: input.confirmationText ?? "",
        });
        return respond({ ruleset });
      }

      case "publish": {
        if (!isUuid(input.rulesetId) || typeof input.expectedVersion !== "number") {
          return respond({ error: "Rascunho ou versão inválida." }, 400);
        }
        const ruleset = await rpc<Record<string, unknown>>("publish_label_lab_ruleset", {
          p_ruleset_id: input.rulesetId,
          p_actor: actor,
          p_confirmation_text: input.confirmationText ?? "",
          p_expected_version: input.expectedVersion,
        });
        return respond({ ruleset });
      }

      case "activate": {
        if (!isUuid(input.rulesetId)) {
          return respond({ error: "Versão inválida." }, 400);
        }
        const ruleset = await rpc<Record<string, unknown>>(
          "activate_label_lab_ruleset",
          {
            p_ruleset_id: input.rulesetId,
            p_actor: actor,
            p_confirmation_text: input.confirmationText ?? "",
          },
        );
        return respond({ ruleset });
      }

      case "discard": {
        if (!isUuid(input.sampleId)) return respond({ error: "Amostra inválida." }, 400);
        const discarded = await rpc<boolean>("discard_label_lab_sample", {
          p_sample_id: input.sampleId,
          p_actor: actor,
        });
        return respond({ discarded });
      }

      case "delete": {
        if (!isUuid(input.rulesetId)) return respond({ error: "Rascunho inválido." }, 400);
        const deleted = await rpc<boolean>("delete_label_lab_ruleset", {
          p_ruleset_id: input.rulesetId,
          p_actor: actor,
        });
        return respond({ deleted });
      }

      default:
        return respond({ error: "Ação desconhecida." }, 400);
    }
  } catch (error) {
    return respond(
      { error: error instanceof Error ? error.message : "Falha inesperada." },
      400,
    );
  }
});
