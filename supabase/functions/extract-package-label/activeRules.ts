import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { LabelLabDynamicRules } from "./parser.ts";

/**
 * Lê as regex publicadas no Label Lab. A RPC é pública e devolve somente as
 * regras (versão, checksum e quatro campos não determinísticos): não há segredo
 * nem dado de morador nesse payload. Qualquer falha mantém o parser embutido.
 */

const allowedFields = new Set([
  "carrier",
  "tracking_code",
  "unit_number",
  "recipient_name",
]);
const timeoutMs = 800;
const cacheTtlMs = 5_000;

let cache: { rules: LabelLabDynamicRules; at: number } | null = null;

function sanitize(payload: unknown): LabelLabDynamicRules | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const rawRules = (payload as { rules?: unknown }).rules;
  if (!rawRules || typeof rawRules !== "object" || Array.isArray(rawRules)) {
    return null;
  }
  const rules: LabelLabDynamicRules = {};
  for (const [field, rawList] of Object.entries(rawRules)) {
    if (!allowedFields.has(field) || !Array.isArray(rawList)) continue;
    rules[field as keyof LabelLabDynamicRules] = rawList
      .filter(
        (item): item is { pattern: string; note?: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { pattern?: unknown }).pattern === "string" &&
          (item as { pattern: string }).pattern.length >= 4 &&
          (item as { pattern: string }).pattern.length <= 160,
      )
      .slice(0, 12)
      .map((item) => ({
        pattern: item.pattern,
        ...(typeof item.note === "string" ? { note: item.note.slice(0, 160) } : {}),
      }));
  }
  return rules;
}

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: number | undefined;
  const limit = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise, limit]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function readRules(client?: SupabaseClient): Promise<unknown> {
  if (client) {
    const { data, error } = await client.rpc("get_active_label_lab_rules");
    if (error) throw error;
    return data;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) throw new Error("Supabase não configurado.");
  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/get_active_label_lab_rules`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

export async function fetchActiveLabelRules(
  client?: SupabaseClient,
): Promise<LabelLabDynamicRules | null> {
  if (cache && Date.now() - cache.at < cacheTtlMs) return cache.rules;
  try {
    const payload = await withTimeout(readRules(client), null);
    const rules = sanitize(payload);
    if (!rules) return cache?.rules ?? null;
    cache = { rules, at: Date.now() };
    return rules;
  } catch {
    return cache?.rules ?? null;
  }
}
