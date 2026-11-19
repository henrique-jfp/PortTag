import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decideLabelSample,
  maybeCollectLabelSample,
  minimumOcrChars,
  type LabelSampleInput,
} from "./labelLabCollection";
import type { CompressedPackagePhoto } from "./packageLabelOcr";

const completeRead: LabelSampleInput = {
  carrier: "Shopee",
  trackingCode: "SHP1234567890BR",
  recipientName: "MARIA SILVA",
  unitNumber: "302",
  unitCandidateCount: 1,
  addressStatus: "verified",
  ocrChars: 240,
  ocrText: "DESTINATARIO MARIA SILVA APT 302 SHOPEE SHP1234567890BR",
};

const compressed: CompressedPackagePhoto = {
  base64: "QUJD",
  mimeType: "image/jpeg",
  file: new File([], "etiqueta.jpg", { type: "image/jpeg" }),
  width: 1280,
  height: 960,
};

describe("decideLabelSample", () => {
  it("não coleta quando as regras já leram tudo", () => {
    expect(decideLabelSample(completeRead)).toEqual({
      collect: false,
      reasons: [],
    });
  });

  it("não coleta só por empresa e rastreio em branco", () => {
    const decision = decideLabelSample({
      ...completeRead,
      carrier: "",
      trackingCode: "",
    });

    expect(decision.collect).toBe(false);
  });

  it("coleta lacuna de destinatário e inclui razões leves quando há lacuna dura", () => {
    const decision = decideLabelSample({
      ...completeRead,
      recipientName: "   ",
      trackingCode: "",
    });

    expect(decision.collect).toBe(true);
    expect(decision.reasons).toEqual(["recipient-missing", "tracking-missing"]);
  });

  it("coleta unidade ausente, conflito de candidatos e divergência de endereço", () => {
    const decision = decideLabelSample({
      ...completeRead,
      unitNumber: "",
      unitCandidateCount: 2,
      addressStatus: "mismatch",
    });

    expect(decision.reasons).toEqual([
      "unit-missing",
      "unit-conflict",
      "address-mismatch",
    ]);
  });

  it("coleta OCR curto no limite exato", () => {
    const short = "x".repeat(minimumOcrChars);

    expect(
      decideLabelSample({ ...completeRead, ocrText: short, ocrChars: short.length })
        .reasons,
    ).not.toContain("short-ocr");
    expect(
      decideLabelSample({
        ...completeRead,
        ocrText: short.slice(0, -1),
        ocrChars: minimumOcrChars - 1,
      }).reasons,
    ).toContain("short-ocr");
  });

  it("usa o tamanho do texto quando a contagem da Vision não veio", () => {
    const decision = decideLabelSample({
      ...completeRead,
      ocrChars: 0,
      ocrText: "curto",
    });

    expect(decision.reasons).toContain("short-ocr");
  });

  it("marca erro de IA mesmo sem lacuna de campo", () => {
    const decision = decideLabelSample({
      ...completeRead,
      aiError: "Groq indisponível",
    });

    expect(decision.reasons).toEqual(["ai-error"]);
  });

  it("marca IA ignorada somente quando resta uma lacuna", () => {
    const withGap = decideLabelSample({
      ...completeRead,
      addressStatus: "unknown",
      aiSkipped: "sem campos vazios",
    });
    const withoutGap = decideLabelSample({
      ...completeRead,
      aiSkipped: "sem campos vazios",
    });

    expect(withGap.reasons).toEqual(["address-unknown", "ai-skipped"]);
    expect(withoutGap.collect).toBe(false);
  });
});

describe("maybeCollectLabelSample", () => {
  it("envia a amostra já comprimida para a Edge Function autenticada", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { collected: true }, error: null });
    const client = { functions: { invoke } } as unknown as SupabaseClient;

    const sent = await maybeCollectLabelSample({
      client,
      sample: {
        ...completeRead,
        condominiumId: "11111111-1111-4111-8111-111111111111",
        reasons: ["unit-missing"],
      },
      compressed,
    });

    expect(sent).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [name, options] = invoke.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(name).toBe("collect-label-sample");
    expect(options.body).toMatchObject({
      condominiumId: "11111111-1111-4111-8111-111111111111",
      imageBase64: "QUJD",
      mimeType: "image/jpeg",
      reasons: ["unit-missing"],
    });
    expect(options.body.parsedResult).toMatchObject({
      unit_number: "302",
      address_status: "verified",
    });
  });

  it("não chama a Edge Function sem condomínio, imagem ou razões", async () => {
    const invoke = vi.fn();
    const client = { functions: { invoke } } as unknown as SupabaseClient;

    const sent = await maybeCollectLabelSample({
      client,
      sample: {
        ...completeRead,
        condominiumId: "",
        reasons: ["unit-missing"],
      },
      compressed,
    });

    expect(sent).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("propaga falha de rede para o chamador tratar sem afetar o recebimento", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("rede indisponível"),
    });
    const client = { functions: { invoke } } as unknown as SupabaseClient;

    await expect(
      maybeCollectLabelSample({
        client,
        sample: {
          ...completeRead,
          condominiumId: "11111111-1111-4111-8111-111111111111",
          reasons: ["unit-missing"],
        },
        compressed,
      }),
    ).rejects.toThrow("rede indisponível");
  });
});
