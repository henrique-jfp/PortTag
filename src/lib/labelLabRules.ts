export const LABEL_LAB_FIELDS = [
  "carrier",
  "tracking_code",
  "unit_number",
  "recipient_name",
] as const;

export type LabelLabField = (typeof LABEL_LAB_FIELDS)[number];

export type LabelLabRule = {
  pattern: string;
  note: string;
};

export type LabelLabRules = Record<LabelLabField, LabelLabRule[]>;

export type LabelLabRegressionCase = {
  id: string;
  name: string;
  field: LabelLabField;
  sampleId: string;
  expected: string;
};

export type LabelLabRegressionResult = {
  id: string;
  name: string;
  field: LabelLabField;
  expected: string;
  actual: string;
  pattern: string | null;
  sampleId: string;
  passed: boolean;
};

export function emptyLabelLabRules(): LabelLabRules {
  return {
    carrier: [],
    tracking_code: [],
    unit_number: [],
    recipient_name: [],
  };
}

export function isLabelLabField(value: string): value is LabelLabField {
  return (LABEL_LAB_FIELDS as readonly string[]).includes(value);
}

export function validateLabelLabRules(rules: LabelLabRules): string[] {
  const errors: string[] = [];
  for (const field of LABEL_LAB_FIELDS) {
    const list = rules[field] ?? [];
    if (list.length > 12) {
      errors.push(`Máximo de 12 expressões para ${field}.`);
    }
    list.forEach((rule, index) => {
      const label = `${field} #${index + 1}`;
      if (!rule.pattern || rule.pattern.length < 4 || rule.pattern.length > 160) {
        errors.push(`Regex inválida em ${label}.`);
        return;
      }
      try {
        new RegExp(rule.pattern, "i");
      } catch {
        errors.push(`Regex inválida em ${label}.`);
      }
    });
  }
  return errors;
}

export function normalizeLabelLabValue(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, "");
}

export function applyLabelLabRule(
  rules: LabelLabRules,
  field: LabelLabField,
  text: string,
) {
  for (const rule of rules[field] ?? []) {
    try {
      const match = new RegExp(rule.pattern, "i").exec(text);
      if (!match) continue;
      return {
        value: (match[1] ?? match[0]).replace(/\s+/g, " ").trim().slice(0, 200),
        pattern: rule.pattern,
      };
    } catch {
      // Regex inválida já foi bloqueada no editor.
    }
  }
  return { value: "", pattern: null };
}

export function formatLabelLabField(field: LabelLabField) {
  const labels: Record<LabelLabField, string> = {
    carrier: "Transportadora",
    tracking_code: "Rastreio",
    unit_number: "Unidade",
    recipient_name: "Destinatário",
  };
  return labels[field];
}
