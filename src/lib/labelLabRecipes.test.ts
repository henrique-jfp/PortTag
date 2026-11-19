import { describe, expect, it } from "vitest";
import {
  applyLabelLabRule,
  emptyLabelLabRules,
  validateLabelLabRules,
} from "./labelLabRules";
import { LABEL_LAB_RECIPES } from "./labelLabRecipes";

describe("receitas de regex do manual do Label Lab", () => {
  it("são expresses válidas para o mesmo motor do teste de regressão", () => {
    const rules = emptyLabelLabRules();
    for (const recipe of LABEL_LAB_RECIPES) {
      rules[recipe.field].push({ pattern: recipe.pattern, note: recipe.note });
    }
    expect(validateLabelLabRules(rules)).toEqual([]);
  });

  it("capturam exatamente o valor anunciado no exemplo", () => {
    for (const recipe of LABEL_LAB_RECIPES) {
      const rules = emptyLabelLabRules();
      rules[recipe.field] = [{ pattern: recipe.pattern, note: recipe.note }];
      const result = applyLabelLabRule(rules, recipe.field, recipe.sample);
      expect(result.value, `${recipe.id}: ${recipe.pattern}`).toBe(
        recipe.expected,
      );
    }
  });

  it("cobrem as quatro situações pedidas e os quatro campos editáveis", () => {
    const ids = new Set(LABEL_LAB_RECIPES.map((recipe) => recipe.id));
    expect(ids.has("label-abaixo")).toBe(true);
    expect(ids.has("numero-ao-lado")).toBe(true);
    expect(ids.has("texto-ao-lado")).toBe(true);
    expect(new Set(LABEL_LAB_RECIPES.map((recipe) => recipe.field)).size).toBe(4);
  });
});
