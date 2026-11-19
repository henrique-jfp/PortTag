import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emptyLabelLabRules,
  isLabelLabField,
  type LabelLabRules,
} from "./labelLabRules";

/**
 * Cache das regras publicadas no Label Lab. Usado somente pelo leitor local do
 * porteiro, quando a nuvem falha: a RPC é anônima, silenciosa e devolve apenas
 * as quatro regex não determinísticas. Nenhuma tela muda por causa dela.
 */

const cacheTtlMs = 5_000;

let cached: { rules: LabelLabRules; at: number } | null = null;

function sanitize(payload: unknown): LabelLabRules | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const rawRules = (payload as { rules?: unknown }).rules;
  if (!rawRules || typeof rawRules !== "object" || Array.isArray(rawRules)) {
    return null;
  }
  const rules = emptyLabelLabRules();
  for (const [field, rawList] of Object.entries(rawRules)) {
    if (!isLabelLabField(field) || !Array.isArray(rawList)) continue;
    rules[field] = rawList
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
        note: typeof item.note === "string" ? item.note.slice(0, 160) : "",
      }));
  }
  return rules;
}

export async function loadActiveLabelRules(client: SupabaseClient) {
  try {
    const { data, error } = await client.rpc("get_active_label_lab_rules");
    if (error) return;
    const rules = sanitize(data);
    if (rules) cached = { rules, at: Date.now() };
  } catch {
    // Sem regras novas o leitor local continua com o comportamento anterior.
  }
}

export function getActiveLabelRules(): LabelLabRules | null {
  if (!cached || Date.now() - cached.at > cacheTtlMs) return null;
  return cached.rules;
}
