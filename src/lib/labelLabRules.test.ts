import { describe, expect, it } from "vitest";
import {
  applyLabelLabRule,
  emptyLabelLabRules,
  isLabelLabField,
  normalizeLabelLabValue,
  validateLabelLabRules,
} from "./labelLabRules";

describe("editor de regras do Label Lab", () => {
  it("aceita apenas campos não determinísticos", () => {
    expect(isLabelLabField("carrier")).toBe(true);
    expect(isLabelLabField("tracking_code")).toBe(true);
    expect(isLabelLabField("unit_number")).toBe(true);
    expect(isLabelLabField("recipient_name")).toBe(true);
    expect(isLabelLabField("destination_cep")).toBe(false);
    expect(isLabelLabField("destination_street")).toBe(false);
    expect(isLabelLabField("destination_number")).toBe(false);
  });

  it("rejeita regex inválida e excesso de expressões", () => {
    const rules = emptyLabelLabRules();
    rules.carrier = [
      { pattern: "[", note: "quebrada" },
      ...Array.from({ length: 12 }, (_, index) => ({
        pattern: `JADLOG-${index}`,
        note: "",
      })),
    ];
    const errors = validateLabelLabRules(rules);
    expect(errors).toContain("Regex inválida em carrier #1.");
    expect(errors).toContain("Máximo de 12 expressões para carrier.");
  });

  it("usa grupo de captura quando existe", () => {
    const rules = emptyLabelLabRules();
    rules.tracking_code = [{ pattern: "RASTREIO:\\s*([A-Z0-9]{8,})", note: "" }];
    const result = applyLabelLabRule(
      rules,
      "tracking_code",
      "pedido 10 RASTREIO: ABC1234567 fim",
    );
    expect(result.value).toBe("ABC1234567");
    expect(result.pattern).toContain("RASTREIO");
  });

  it("mantém âncoras de linha ao aplicar regras sobre OCR", () => {
    const rules = emptyLabelLabRules();
    rules.carrier = [{ pattern: "(?<=TRANSP:\\s)([A-Z]+)(?=\\s)", note: "" }];
    const result = applyLabelLabRule(
      rules,
      "carrier",
      "TRANSP: SHIPPIFY TECNOLOGIA LTDA\nREMETENTE\n",
    );
    expect(result.value).toBe("SHIPPIFY");
  });

  it("normaliza espaços e caixa na regressão", () => {
    expect(normalizeLabelLabValue("  João   Silva ")).toBe("joãosilva");
  });
});
