import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { useAuth } from "../contexts/AuthContext";
import {
  applyLabelLabRule,
  emptyLabelLabRules,
  isLabelLabField,
  validateLabelLabRules,
  type LabelLabField,
  type LabelLabRegressionResult,
  type LabelLabRules,
  type LabelLabRule,
} from "../lib/labelLabRules";
import { supabase } from "../lib/supabase";

type Condominium = {
  id: string;
  name: string;
  cep: string | null;
  street: string | null;
  address_number: string | null;
};

type Sample = {
  id: string;
  condominium_id: string;
  storage_path: string;
  status: string;
  reasons: string[];
  carrier_detected: string | null;
  tracking_code: string | null;
  ocr_text: string | null;
  analysis: Record<string, unknown> | null;
  created_at: string;
  condominiums: { name: string } | null;
};

type Suggestion = {
  field: string;
  pattern: string;
  reason: string;
};

type AnalysisFields = {
  recipient_name?: string;
  unit_number?: string;
  carrier?: string;
  tracking_code?: string;
  address_status?: string;
};

type AnalysisResult = {
  name: string;
  ok: boolean;
  error?: string;
  ocrText?: string;
  fields?: AnalysisFields;
  diagnostics?: Record<string, unknown>;
  suggestions?: Suggestion[];
};

type RegressionCase = {
  id: string;
  name: string;
  field: LabelLabField;
  sampleId: string;
  expected: string;
};

type RegressionSummary = {
  total: number;
  passed: number;
  failed: number;
  testedAt: string | null;
};

type Ruleset = {
  id: string;
  version: number;
  status: "draft" | "approved" | "published" | "superseded";
  name: string;
  description: string;
  rules: LabelLabRules;
  regression: RegressionSummary & { cases?: RegressionCase[] };
  artifact: Record<string, unknown> | null;
  checksum: string | null;
  source_sample_ids: string[];
  approved_at: string | null;
  published_at: string | null;
};

type AuditEntry = {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

type PendingImage = {
  name: string;
  imageBase64: string;
  mimeType: string;
};

type DraftCase = {
  field: LabelLabField;
  sampleId: string;
  expected: string;
};

const fieldLabels: Record<LabelLabField, string> = {
  carrier: "Transportadora",
  tracking_code: "Rastreio",
  unit_number: "Unidade",
  recipient_name: "Destinatário",
};

const reasonLabels: Record<string, string> = {
  "recipient-missing": "Destinatário ausente",
  "unit-missing": "Unidade ausente",
  "unit-conflict": "Conflito de unidade",
  "address-unknown": "Endereço inconclusivo",
  "address-mismatch": "Endereço divergente",
  "short-ocr": "OCR curto",
  "ai-error": "Falha da IA",
  "ai-skipped": "IA ignorada",
  "carrier-missing": "Transportadora ausente",
  "tracking-missing": "Rastreio ausente",
  "manual-import": "Importação manual",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeCase(cases: RegressionCase[]) {
  return cases.map((item) => ({
    id: item.id,
    name: item.name,
    field: item.field,
    expected: item.expected,
    sampleId: item.sampleId,
  }));
}

export function LabelLab() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [pageError, setPageError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [selectedCondominiumId, setSelectedCondominiumId] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState("");

  const [rules, setRules] = useState<LabelLabRules>(emptyLabelLabRules());
  const [cases, setCases] = useState<RegressionCase[]>([]);
  const [draftCase, setDraftCase] = useState<DraftCase>({
    field: "carrier",
    sampleId: "",
    expected: "",
  });
  const [regressionResults, setRegressionResults] = useState<LabelLabRegressionResult[]>([]);
  const [rulesetId, setRulesetId] = useState("");
  const [rulesetName, setRulesetName] = useState("Modelo de etiqueta");
  const [rulesetDescription, setRulesetDescription] = useState("");
  const [approvalText, setApprovalText] = useState("");
  const [publishText, setPublishText] = useState("");
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [publishedArtifact, setPublishedArtifact] = useState<Record<string, unknown> | null>(null);
  const [discardTarget, setDiscardTarget] = useState<Sample | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Ruleset | null>(null);

  const selectedCondominium = useMemo(
    () => condominiums.find((item) => item.id === selectedCondominiumId) ?? null,
    [condominiums, selectedCondominiumId],
  );
  const selectedRuleset = useMemo(
    () => rulesets.find((item) => item.id === rulesetId) ?? null,
    [rulesets, rulesetId],
  );
  const selectedSample = useMemo(
    () => samples.find((item) => item.id === selectedSampleId) ?? null,
    [samples, selectedSampleId],
  );

  async function callAdmin<T>(body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 75_000);
    try {
      const { data, error } = await supabase.functions.invoke("admin-label-lab", {
        body,
        signal: controller.signal,
      });
      if (error) throw new Error(error.message);
      const response = data as Record<string, unknown> | null;
      if (!response) throw new Error("O laboratório não respondeu.");
      if (typeof response.error === "string") throw new Error(response.error);
      return response as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("O laboratório demorou para responder. Tente novamente.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function reloadData() {
    const [samplesResult, rulesetsResult, auditResult] = await Promise.all([
      supabase
        .from("label_lab_queue")
        .select(
          "id, condominium_id, storage_path, status, reasons, carrier_detected, tracking_code, ocr_text, analysis, created_at, condominiums(name)",
        )
        .order("created_at", { ascending: false })
        .limit(60),
      supabase
        .from("label_lab_rulesets")
        .select("*")
        .order("version", { ascending: false })
        .limit(30),
      supabase
        .from("label_lab_audit")
        .select("id, action, details, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    const firstError =
      samplesResult.error ?? rulesetsResult.error ?? auditResult.error;
    if (firstError) throw new Error(firstError.message);
    setSamples((samplesResult.data ?? []) as unknown as Sample[]);
    setRulesets((rulesetsResult.data ?? []) as unknown as Ruleset[]);
    setAudit((auditResult.data ?? []) as unknown as AuditEntry[]);
  }

  useEffect(() => {
    let active = true;

    async function loadPage() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("is_super_admin")
        .eq("id", user.id)
        .maybeSingle();
      if (!active) return;
      if (profileError) {
        setPageError(profileError.message);
        setLoading(false);
        return;
      }
      if (!profile?.is_super_admin) {
        setLoading(false);
        return;
      }
      setIsSuperAdmin(true);
      const { data: condominiumData, error: condominiumError } = await supabase
        .from("condominiums")
        .select("id, name, cep, street, address_number")
        .order("name");
      if (!active) return;
      if (condominiumError) {
        setPageError(condominiumError.message);
        setLoading(false);
        return;
      }
      const list = (condominiumData ?? []) as Condominium[];
      setCondominiums(list);
      setSelectedCondominiumId(list[0]?.id ?? "");
      try {
        await reloadData();
      } catch (error) {
        if (active) setPageError(error instanceof Error ? error.message : "Falha ao carregar.");
      }
      if (active) setLoading(false);
    }

    void loadPage().catch((error: unknown) => {
      if (!active) return;
      setPageError(error instanceof Error ? error.message : "Falha inesperada.");
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    let active = true;
    if (!selectedSampleId) return () => {
      active = false;
    };
    const sample = samples.find((item) => item.id === selectedSampleId);
    if (!sample) return () => {
      active = false;
    };
    void supabase.storage
      .from("label-lab-private")
      .createSignedUrl(sample.storage_path, 120)
      .then(({ data, error }) => {
        if (active && !error) setPreviewUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [selectedSampleId, samples]);

  function setBusyState(next: string) {
    setBusy(next);
    setPageError("");
    setSuccessMessage("");
  }

  function selectSample(id: string) {
    setSelectedSampleId(id);
    setPreviewUrl("");
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 6);
    setPageError("");
    setSuccessMessage("");
    const images: PendingImage[] = [];
    for (const file of files) {
      if (file.size > 2_800_000) {
        setPageError(`${file.name} passa de 2,8 MB.`);
        continue;
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setPageError(`${file.name} não é JPEG, PNG ou WEBP.`);
        continue;
      }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
        reader.readAsDataURL(file);
      });
      images.push({ name: file.name, imageBase64: base64, mimeType: file.type });
    }
    setPendingImages(images);
    setResults([]);
  }

  async function handleAnalyze(saveSample: boolean) {
    if (!pendingImages.length) {
      setPageError("Importe ao menos uma foto.");
      return;
    }
    if (!selectedCondominium) {
      setPageError("Cadastre e selecione um condomínio.");
      return;
    }
    setBusyState("analyze");
    try {
      const response = await callAdmin<{
        results: AnalysisResult[];
        saved: Array<{ index: number; sampleId: string; duplicate: boolean }>;
      }>({
        action: "analyze",
        images: pendingImages,
        condominiumId: selectedCondominium.id,
        expectedAddress: {
          cep: selectedCondominium.cep ?? "",
          street: selectedCondominium.street ?? "",
          address_number: selectedCondominium.address_number ?? "",
        },
        saveSample,
      });
      setResults(response.results);
      const savedSamples = (response.saved ?? []).filter((item) => item.sampleId);
      if (savedSamples.length) {
        await reloadData();
        selectSample(savedSamples[0].sampleId);
        setDraftCase((current) => ({
          ...current,
          sampleId: savedSamples[0].sampleId,
        }));
        setSuccessMessage(
          `${savedSamples.length} amostra(s) salva(s) no cofre privado para regressão.`,
        );
      } else {
        setSuccessMessage("Análise concluída. As fotos não foram guardadas.");
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Falha na análise.");
    } finally {
      setBusy("");
    }
  }

  async function handleAnalyzeSample() {
    if (!selectedSampleId) {
      setPageError("Selecione uma amostra coletada.");
      return;
    }
    setBusyState("sample-analysis");
    try {
      const response = await callAdmin<{ results: AnalysisResult[] }>({
        action: "analyze",
        sourceSampleId: selectedSampleId,
      });
      setResults(response.results);
      setSuccessMessage("Amostra reanalisada sem salvar nova foto.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Falha na análise.");
    } finally {
      setBusy("");
    }
  }

  function addSuggestion(suggestion: Suggestion) {
    const field = suggestion.field;
    if (!isLabelLabField(field)) return;
    setRules((current) => ({
      ...current,
      [field]: [
        ...current[field],
        { pattern: suggestion.pattern, note: suggestion.reason || "Sugestão da IA" },
      ],
    }));
    setSuccessMessage(`Sugestão adicionada ao campo ${fieldLabels[field]}.`);
  }

  function addRule(field: LabelLabField) {
    setRules((current) => ({
      ...current,
      [field]: [...current[field], { pattern: "", note: "" }],
    }));
  }

  function updateRule(field: LabelLabField, index: number, patch: Partial<LabelLabRule>) {
    setRules((current) => ({
      ...current,
      [field]: current[field].map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule
      ),
    }));
  }

  function removeRule(field: LabelLabField, index: number) {
    setRules((current) => ({
      ...current,
      [field]: current[field].filter((_, ruleIndex) => ruleIndex !== index),
    }));
  }

  function addCase() {
    if (!draftCase.sampleId) {
      setPageError("Salve uma foto importada ou selecione uma amostra coletada antes de criar o caso.");
      return;
    }
    if (!draftCase.expected.trim()) {
      setPageError("Informe o valor esperado do caso.");
      return;
    }
    const sample = samples.find((item) => item.id === draftCase.sampleId);
    setCases((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: sample?.condominiums?.name ?? `Amostra ${current.length + 1}`,
        field: draftCase.field,
        sampleId: draftCase.sampleId,
        expected: draftCase.expected.trim().slice(0, 120),
      },
    ]);
    setDraftCase({ ...draftCase, expected: "" });
    setPageError("");
  }

  function applySelectedRule(item: RegressionCase) {
    const sample = samples.find((sampleItem) => sampleItem.id === item.sampleId);
    const text = sample?.ocr_text ?? "";
    if (!text) return { value: "", pattern: null };
    return applyLabelLabRule(rules, item.field, text);
  }

  async function handleSaveDraft(createNew: boolean) {
    const errors = validateLabelLabRules(rules);
    if (errors.length) {
      setPageError(errors.join(" "));
      return;
    }
    if (rulesetName.trim().length < 3) {
      setPageError("Informe um nome com pelo menos 3 caracteres para a versão.");
      return;
    }
    setBusyState("save");
    try {
      const editable =
        selectedRuleset?.status === "draft" || selectedRuleset?.status === "approved";
      const response = await callAdmin<{ ruleset: Ruleset }>({
        action: "save",
        // "Nova versão" sempre cria um snapshot com o nome digitado; "Atualizar"
        // reescreve a versão selecionada. Publicadas nunca são alteradas.
        rulesetId: !createNew && editable ? rulesetId || null : null,
        name: rulesetName,
        description: rulesetDescription,
        rules,
      });
      setRulesetId(response.ruleset.id);
      setApprovalConfirmed(false);
      setPublishConfirmed(false);
      setSuccessMessage(
        createNew
          ? `Nova versão v${response.ruleset.version} criada com o nome "${response.ruleset.name}".`
          : `Versão v${response.ruleset.version} atualizada.`,
      );
      await reloadData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setBusy("");
    }
  }

  async function handleRunRegression() {
    const errors = validateLabelLabRules(rules);
    if (errors.length) {
      setPageError(errors.join(" "));
      return;
    }
    if (!cases.length) {
      setPageError("Adicione ao menos um caso de regressão.");
      return;
    }
    setBusyState("test");
    try {
      const response = await callAdmin<{
        ruleset: Ruleset;
        results: LabelLabRegressionResult[];
      }>({
        action: "test",
        rulesetId:
          selectedRuleset?.status === "published" ||
          selectedRuleset?.status === "superseded"
            ? null
            : rulesetId || null,
        name: rulesetName,
        description: rulesetDescription,
        rules,
        cases: normalizeCase(cases),
      });
      setRulesetId(response.ruleset.id);
      setRegressionResults(response.results);
      setApprovalConfirmed(false);
      setPublishConfirmed(false);
      const failed = response.ruleset.regression?.failed ?? 0;
      setSuccessMessage(
        failed === 0
          ? `Regressão verde: ${response.ruleset.regression.passed}/${response.ruleset.regression.total} casos.`
          : `Regressão com ${failed} falha(s). Ajuste as regras antes de aprovar.`,
      );
      await reloadData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Falha no teste.");
    } finally {
      setBusy("");
    }
  }

  async function handleApprove() {
    if (!rulesetId) {
      setPageError("Salve e teste um rascunho antes de aprovar.");
      return;
    }
    if (!approvalConfirmed || approvalText.trim().toUpperCase() !== "APROVAR") {
      setPageError("Marque o aceite e digite APROVAR para continuar.");
      return;
    }
    setBusyState("approve");
    try {
      const response = await callAdmin<{ ruleset: Ruleset }>({
        action: "approve",
        rulesetId,
        confirmationText: approvalText,
      });
      setApprovalText("");
      setApprovalConfirmed(false);
      setSuccessMessage(`Versão v${response.ruleset.version} aprovada.`);
      await reloadData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Falha na aprovação.");
    } finally {
      setBusy("");
    }
  }

  async function handlePublish() {
    if (!selectedRuleset || selectedRuleset.status !== "approved") {
      setPageError("A versão precisa estar aprovada.");
      return;
    }
    if (!publishConfirmed || publishText.trim().toUpperCase() !== "PUBLICAR") {
      setPageError("Marque o aceite e digite PUBLICAR para continuar.");
      return;
    }
    setBusyState("publish");
    try {
      const response = await callAdmin<{ ruleset: Ruleset }>({
        action: "publish",
        rulesetId: selectedRuleset.id,
        confirmationText: publishText,
        expectedVersion: selectedRuleset.version,
      });
      setPublishedArtifact(response.ruleset.artifact);
      setPublishText("");
      setPublishConfirmed(false);
      setSuccessMessage(
        `Versão v${response.ruleset.version} publicada. Fotos e OCR das amostras usadas foram excluídos.`,
      );
      selectSample("");
      await reloadData();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Falha na publicação.");
    } finally {
      setBusy("");
    }
  }

  function downloadArtifact() {
    if (!publishedArtifact) return;
    const blob = new Blob([JSON.stringify(publishedArtifact, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `label-lab-rules-v${(publishedArtifact.version as number) ?? 1}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleDiscard() {
    if (!discardTarget) return;
    setBusyState("discard");
    try {
      await callAdmin({ action: "discard", sampleId: discardTarget.id });
      if (selectedSampleId === discardTarget.id) selectSample("");
      setDiscardTarget(null);
      setSuccessMessage("Amostra, foto e OCR excluídos.");
      await reloadData();
    } catch (error) {
      setDiscardTarget(null);
      setPageError(error instanceof Error ? error.message : "Falha ao descartar.");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteRuleset() {
    if (!deleteTarget) return;
    setBusyState("delete-ruleset");
    try {
      const response = await callAdmin<{ deleted: boolean }>({
        action: "delete",
        rulesetId: deleteTarget.id,
      });
      if (!response.deleted) {
        setPageError("O rascunho já não existe.");
        return;
      }
      if (deleteTarget.id === rulesetId) {
        setRulesetId("");
        setRules(emptyLabelLabRules());
        setCases([]);
        setRulesetName("Modelo de etiqueta");
        setRulesetDescription("");
        setRegressionResults([]);
        setApprovalText("");
        setPublishText("");
        setApprovalConfirmed(false);
        setPublishConfirmed(false);
        setPublishedArtifact(null);
      }
      setDeleteTarget(null);
      setSuccessMessage(`Rascunho v${deleteTarget.version} excluído.`);
      await reloadData();
    } catch (error) {
      setDeleteTarget(null);
      setPageError(error instanceof Error ? error.message : "Falha ao excluir.");
    } finally {
      setBusy("");
    }
  }

  function selectRuleset(item: Ruleset) {
    setRulesetId(item.id);
    setRules(item.rules ?? emptyLabelLabRules());
    const storedCases = (item.regression?.cases ?? []) as RegressionCase[];
    const reusable =
      item.status === "published" || item.status === "superseded"
        ? []
        : storedCases.filter(
            (entry) =>
              isLabelLabField(entry.field) &&
              samples.some((sample) => sample.id === entry.sampleId && sample.ocr_text),
          );
    setCases(reusable);
    setRulesetName(item.name);
    setRulesetDescription(item.description ?? "");
    setRegressionResults([]);
    setApprovalText("");
    setPublishText("");
    setApprovalConfirmed(false);
    setPublishConfirmed(false);
    setPublishedArtifact(item.status === "published" ? item.artifact : null);
    setPageError("");
  }

  if (loading) {
    return <div className="loading-screen">Carregando Central do Label Lab...</div>;
  }

  if (!isSuperAdmin) {
    return (
      <main className="dashboard">
        <section className="welcome-card">
          <h2>Área exclusiva do Super Admin</h2>
          <p>A Central de Inteligência de Etiquetas não está disponível nesta conta.</p>
          <Link className="primary-button button-link" to="/">Voltar ao painel</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard lab-page">
      <header className="dashboard-header">
        <div className="admin-page-title">
          <p className="eyebrow">Central de Inteligência de Etiquetas</p>
          <h1>Label Lab</h1>
          <p>
            Importe fotos, analise com o pipeline de produção, ajuste regras,
            rode a regressão e publique com rastreio de aprovação.
          </p>
        </div>
        <div className="admin-header-actions">
          <Link className="secondary-button button-link" to="/">Voltar ao painel</Link>
        </div>
      </header>

      {pageError ? (
        <p className="feedback-message feedback-error" role="alert">{pageError}</p>
      ) : null}
      {successMessage ? (
        <p className="feedback-message feedback-success" role="status">{successMessage}</p>
      ) : null}

      <section className="admin-section">
        <div className="section-heading">
          <h2>1. Importar e analisar</h2>
          <p>
            O Vision é chamado uma vez por foto. Sem &ldquo;Salvar como amostra&rdquo;,
            a imagem é descartada: a Central não cria cópia por padrão.
          </p>
        </div>
        <div className="lab-grid">
          <div className="lab-card">
            <label className="form-field">
              Condomínio de referência
              <select
                value={selectedCondominiumId}
                onChange={(event) => setSelectedCondominiumId(event.target.value)}
              >
                {condominiums.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            {selectedCondominium ? (
              <p className="lab-hint">
                Endereço conferido pelo determinístico: {selectedCondominium.street ?? "—"},
                {" "}
                {selectedCondominium.address_number ?? "—"} · {selectedCondominium.cep ?? "—"}
              </p>
            ) : null}
            <label className="form-field">
              Fotos da etiqueta (JPEG, PNG ou WEBP · até 2,8 MB cada)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) => void handleFiles(event)}
              />
            </label>
            {pendingImages.length ? (
              <p className="lab-hint">{pendingImages.length} foto(s) pronta(s) para análise.</p>
            ) : null}
            <div className="form-actions">
              <button
                className="primary-button"
                type="button"
                disabled={busy === "analyze" || !pendingImages.length}
                onClick={() => void handleAnalyze(false)}
              >
                {busy === "analyze" ? "Analisando..." : "Analisar sem guardar"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy === "analyze" || !pendingImages.length}
                onClick={() => void handleAnalyze(true)}
              >
                Analisar e salvar amostra
              </button>
            </div>
          </div>

          <div className="lab-card">
            <h3>Amostra coletada</h3>
            <label className="form-field">
              Selecionar da fila
              <select
                value={selectedSampleId}
                onChange={(event) => selectSample(event.target.value)}
              >
                <option value="">Nenhuma</option>
                {samples
                  .filter((item) => item.status !== "deleted")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.condominiums?.name ?? "Condomínio"} · {formatDate(item.created_at)}
                    </option>
                  ))}
              </select>
            </label>
            {selectedSample ? (
              <>
                <div className="lab-meta">
                  <span className="lab-badge">{selectedSample.status}</span>
                  <span>
                    {selectedSample.reasons
                      .map((reason) => reasonLabels[reason] ?? reason)
                      .join(" · ")}
                  </span>
                </div>
                {previewUrl ? (
                  <img className="lab-preview" src={previewUrl} alt="Etiqueta da amostra" />
                ) : null}
                <div className="form-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy === "sample-analysis"}
                    onClick={() => void handleAnalyzeSample()}
                  >
                    {busy === "sample-analysis" ? "Analisando..." : "Reanalisar amostra"}
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => setDiscardTarget(selectedSample)}
                  >
                    Descartar
                  </button>
                </div>
              </>
            ) : (
              <p className="lab-hint">
                As amostras entram sozinhas quando o OCR do porteiro encontra uma lacuna real.
              </p>
            )}
          </div>
        </div>

        {results.length ? (
          <div className="lab-results">
            <h3>Resultado da análise</h3>
            {results.map((result, index) => (
              <article
                key={`${result.name}-${index}`}
                className={`lab-result ${result.ok ? "lab-result-ok" : "lab-result-error"}`}
              >
                <header>
                  <strong>{result.name}</strong>
                  <span>{result.ok ? "leitura concluída" : "falha"}</span>
                </header>
                {result.ok ? (
                  <>
                    <dl className="lab-field-grid">
                      <div>
                        <dt>Transportadora</dt>
                        <dd>{result.fields?.carrier || "—"}</dd>
                      </div>
                      <div>
                        <dt>Rastreio</dt>
                        <dd>{result.fields?.tracking_code || "—"}</dd>
                      </div>
                      <div>
                        <dt>Unidade</dt>
                        <dd>{result.fields?.unit_number || "—"}</dd>
                      </div>
                      <div>
                        <dt>Destinatário</dt>
                        <dd>{result.fields?.recipient_name || "—"}</dd>
                      </div>
                      <div>
                        <dt>Endereço</dt>
                        <dd>{result.fields?.address_status ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Motor</dt>
                        <dd>{String(result.diagnostics?.engine ?? "—")}</dd>
                      </div>
                    </dl>
                    {result.suggestions?.length ? (
                      <div className="lab-suggestions">
                        <h4>Sugestões de regex</h4>
                        {result.suggestions.map((suggestion) => (
                          <div className="lab-suggestion" key={`${suggestion.field}-${suggestion.pattern}`}>
                            <div>
                              <strong>{isLabelLabField(suggestion.field)
                                ? fieldLabels[suggestion.field]
                                : suggestion.field}</strong>
                              <code>{suggestion.pattern}</code>
                              <p>{suggestion.reason}</p>
                            </div>
                            {isLabelLabField(suggestion.field) ? (
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() => addSuggestion(suggestion)}
                              >
                                Adicionar ao editor
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="lab-hint">Nenhuma sugestão confiável para esta etiqueta.</p>
                    )}
                  </>
                ) : (
                  <p className="feedback-message feedback-error">{result.error}</p>
                )}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <h2>2. Editor de expressões</h2>
          <p>
            A IA sugere, mas só quatro campos podem ter regex. CEP, logradouro e
            número continuam sendo decididos pelo código determinístico. As regex
            desta seção valem no teste de regressão e no artefato publicado; elas
            não alteram a análise acima nem o OCR do porteiro automaticamente.
          </p>
        </div>
        <div className="lab-toolbar">
          <label className="form-field">
            Nome da versão
            <input
              value={rulesetName}
              onChange={(event) => setRulesetName(event.target.value)}
            />
          </label>
          <label className="form-field form-field-wide">
            Descrição
            <input
              value={rulesetDescription}
              onChange={(event) => setRulesetDescription(event.target.value)}
              placeholder="Modelo Amazon caixa pequena, novo layout Shopee..."
            />
          </label>
        </div>
        <div className="lab-rule-grid">
          {(Object.keys(fieldLabels) as LabelLabField[]).map((field) => (
            <div className="lab-card" key={field}>
              <div className="lab-rule-heading">
                <h3>{fieldLabels[field]}</h3>
                <button className="secondary-button" type="button" onClick={() => addRule(field)}>
                  Adicionar regex
                </button>
              </div>
              {rules[field].length === 0 ? (
                <p className="lab-hint">Nenhuma regra. O parser atual já resolve este campo.</p>
              ) : null}
              {rules[field].map((rule, index) => (
                <div className="lab-rule-row" key={`${field}-${index}`}>
                  <label className="form-field">
                    Expressão regular
                    <input
                      value={rule.pattern}
                      onChange={(event) => updateRule(field, index, { pattern: event.target.value })}
                      placeholder="Ex.: RASTREIO:\s*([A-Z0-9]{8,})"
                    />
                  </label>
                  <label className="form-field">
                    Observação
                    <input
                      value={rule.note}
                      onChange={(event) => updateRule(field, index, { note: event.target.value })}
                    />
                  </label>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => removeRule(field, index)}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="lab-hint">
          Cada nome gera uma versão independente. Use <strong>Nova versão</strong> para
          guardar um novo teste; <strong>Atualizar</strong> apenas reescreve a versão
          selecionada. O botão de exclusão fica na lista de versões.
        </p>
        <div className="form-actions">
          <button
            className="primary-button"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void handleSaveDraft(true)}
          >
            {busy === "save" ? "Salvando..." : "Salvar como nova versão"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={Boolean(busy) || selectedRuleset?.status !== "draft"}
            onClick={() => void handleSaveDraft(false)}
          >
            Atualizar versão selecionada
          </button>
        </div>
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <h2>3. Teste de regressão</h2>
          <p>
            Os casos usam o OCR já guardado nas amostras; o texto identificável
            não é copiado para o rascunho nem para o artefato publicado.
          </p>
        </div>
        <div className="lab-toolbar">
          <label className="form-field">
            Amostra de origem
            <select
              value={draftCase.sampleId}
              onChange={(event) =>
                setDraftCase({ ...draftCase, sampleId: event.target.value })
              }
            >
              <option value="">Selecione</option>
              {samples
                .filter((item) => Boolean(item.ocr_text))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.condominiums?.name ?? "Condomínio"} · {formatDate(item.created_at)}
                  </option>
                ))}
            </select>
          </label>
          <label className="form-field">
            Campo
            <select
              value={draftCase.field}
              onChange={(event) =>
                setDraftCase({ ...draftCase, field: event.target.value as LabelLabField })
              }
            >
              {(Object.keys(fieldLabels) as LabelLabField[]).map((field) => (
                <option key={field} value={field}>{fieldLabels[field]}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Valor esperado
            <input
              value={draftCase.expected}
              onChange={(event) =>
                setDraftCase({ ...draftCase, expected: event.target.value })
              }
            />
          </label>
          <button className="secondary-button" type="button" onClick={addCase}>
            Adicionar caso
          </button>
        </div>

        {cases.length ? (
          <div className="lab-table-wrap">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>Amostra</th>
                  <th>Campo</th>
                  <th>Esperado</th>
                  <th>Prévia da regra</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => {
                  const preview = applySelectedRule(item);
                  return (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{fieldLabels[item.field]}</td>
                      <td><code>{item.expected}</code></td>
                      <td>{preview.value || <span className="lab-hint">sem casamento</span>}</td>
                      <td>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setCases((current) => current.filter((entry) => entry.id !== item.id))}
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="lab-hint">Nenhum caso de teste adicionado.</p>
        )}

        <div className="form-actions">
          <button
            className="primary-button"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void handleRunRegression()}
          >
            {busy === "test" ? "Testando..." : "Rodar regressão e salvar versão"}
          </button>
        </div>

        {regressionResults.length ? (
          <div className="lab-table-wrap">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Esperado</th>
                  <th>Obtido</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {regressionResults.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td><code>{item.expected}</code></td>
                    <td><code>{item.actual || "—"}</code></td>
                    <td>
                      <span className={`lab-status ${item.passed ? "lab-status-ok" : "lab-status-error"}`}>
                        {item.passed ? "passou" : "falhou"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <h2>4. Versões, aprovação e publicação</h2>
          <p>
            Aprovar e publicar são atos separados, com confirmação digitada e
            auditoria. Publicar exclui as fotos e sanitiza o OCR das amostras usadas.
            Rascunhos descartados podem ser excluídos pelo botão ao lado da versão.
          </p>
        </div>
        <div className="lab-grid">
          <div className="lab-card">
            <h3>Versões salvas</h3>
            {rulesets.length ? (
              <div className="lab-version-list">
                {rulesets.map((item) => (
                  <div className="lab-version-row" key={item.id}>
                    <button
                      type="button"
                      className={`lab-version ${item.id === rulesetId ? "lab-version-active" : ""}`}
                      onClick={() => selectRuleset(item)}
                    >
                      <span>
                        <strong>v{item.version}</strong> · {item.name}
                      </span>
                      <span className="lab-badge">{item.status}</span>
                      <small>
                        {item.regression?.total
                          ? `${item.regression.passed}/${item.regression.total} casos`
                          : "sem regressão"}
                      </small>
                    </button>
                    {item.status === "draft" ? (
                      <button
                        className="danger-button lab-version-delete"
                        type="button"
                        disabled={Boolean(busy)}
                        title={`Excluir rascunho v${item.version}`}
                        onClick={() => setDeleteTarget(item)}
                      >
                        Excluir
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="lab-hint">Salve um rascunho ou rode a regressão para criar a v1.</p>
            )}
          </div>
          <div className="lab-card">
            <h3>Aprovação explícita</h3>
            {selectedRuleset ? (
              <dl className="lab-details">
                <div>
                  <dt>Versão</dt>
                  <dd>v{selectedRuleset.version} · {selectedRuleset.status}</dd>
                </div>
                <div>
                  <dt>Regressão</dt>
                  <dd>
                    {selectedRuleset.regression?.total
                      ? `${selectedRuleset.regression.passed}/${selectedRuleset.regression.total}`
                      : "não executada"}
                  </dd>
                </div>
                <div>
                  <dt>Aprovado em</dt>
                  <dd>{formatDate(selectedRuleset.approved_at)}</dd>
                </div>
                <div>
                  <dt>Publicado em</dt>
                  <dd>{formatDate(selectedRuleset.published_at)}</dd>
                </div>
              </dl>
            ) : (
              <p className="lab-hint">Selecione uma versão.</p>
            )}
            <label className="lab-checkbox">
              <input
                type="checkbox"
                checked={approvalConfirmed}
                onChange={(event) => setApprovalConfirmed(event.target.checked)}
              />
              Revisei as regras, os casos e o impacto no recebimento.
            </label>
            <label className="form-field">
              Digite APROVAR
              <input
                value={approvalText}
                onChange={(event) => setApprovalText(event.target.value)}
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              disabled={Boolean(busy) || selectedRuleset?.status !== "draft"}
              onClick={() => void handleApprove()}
            >
              {busy === "approve" ? "Aprovando..." : "Aprovar versão"}
            </button>

            <hr />
            <label className="lab-checkbox">
              <input
                type="checkbox"
                checked={publishConfirmed}
                onChange={(event) => setPublishConfirmed(event.target.checked)}
              />
              Confirmo a publicação e a exclusão das amostras usadas.
            </label>
            <label className="form-field">
              Digite PUBLICAR
              <input
                value={publishText}
                onChange={(event) => setPublishText(event.target.value)}
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(busy) || selectedRuleset?.status !== "approved"}
              onClick={() => void handlePublish()}
            >
              {busy === "publish" ? "Publicando..." : "Publicar versão"}
            </button>
            {publishedArtifact ? (
              <div className="lab-artifact">
                <p>
                  Artefato v{String(publishedArtifact.version ?? "?")} pronto:
                  {" "}
                  <code>{String(publishedArtifact.checksum ?? selectedRuleset?.checksum ?? "")}</code>
                </p>
                <button className="secondary-button" type="button" onClick={downloadArtifact}>
                  Baixar JSON versionado
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {audit.length ? (
          <div className="lab-table-wrap">
            <h3>Auditoria recente</h3>
            <table className="lab-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Ação</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.created_at)}</td>
                    <td>{entry.action}</td>
                    <td><code>{JSON.stringify(entry.details)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {discardTarget ? (
        <ConfirmationDialog
          title="Descartar amostra"
          description="A foto, o OCR e o resultado associados serão excluídos do cofre privado. Esta ação não pode ser desfeita."
          confirmLabel="Excluir amostra"
          busyLabel="Excluindo..."
          loading={busy === "discard"}
          onConfirm={() => void handleDiscard()}
          onCancel={() => setDiscardTarget(null)}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmationDialog
          title="Excluir rascunho"
          description={`A versão v${deleteTarget.version} ("${deleteTarget.name}") será excluída. Versões aprovadas ou publicadas não podem ser excluídas. As amostras usadas na regressão serão mantidas. Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir rascunho"
          busyLabel="Excluindo..."
          loading={busy === "delete-ruleset"}
          onConfirm={() => void handleDeleteRuleset()}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </main>
  );
}
