import { useRef, useState, type ChangeEvent } from "react";
import {
  analyzeResidentImport,
  guessResidentColumnMapping,
  mapResidentRows,
  readResidentFile,
  toRpcResidentRows,
  NO_COLUMN,
  type ResidentColumnMapping,
  type ResidentImportAnalysis,
  type ResidentImportSource,
} from "../lib/residentImport";
import { supabase } from "../lib/supabase";

type ResidentsImportPanelProps = {
  condominiumId: string;
  blocks: { id: string; name: string }[];
  hasBlocks: boolean;
  onImported: () => void | Promise<void>;
};

type ImportRpcResult = {
  units_created?: number;
  residents_created?: number;
  duplicates_skipped?: number;
};

const MAPPING_FIELDS: {
  key: keyof ResidentColumnMapping;
  label: string;
  hint: string;
  required?: boolean;
}[] = [
  {
    key: "unit",
    label: "Unidade / Apartamento",
    hint: "Obrigatório. Ex.: 101, Apto 201, Nº do imóvel.",
    required: true,
  },
  {
    key: "block",
    label: "Bloco / Torre",
    hint: "Opcional. Linhas sem bloco usam o bloco padrão.",
  },
  {
    key: "name",
    label: "Nome do morador",
    hint: "Opcional. Linhas sem nome criam apenas a unidade.",
  },
  {
    key: "phone",
    label: "Telefone / WhatsApp",
    hint: "Opcional. Números são normalizados ao importar.",
  },
];

const EMPTY_MAPPING: ResidentColumnMapping = {
  unit: NO_COLUMN,
  block: NO_COLUMN,
  name: NO_COLUMN,
  phone: NO_COLUMN,
};

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? `${fallback} ${cause.message}` : fallback;
}

export function ResidentsImportPanel({
  condominiumId,
  blocks,
  hasBlocks,
  onImported,
}: ResidentsImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<ResidentImportSource | null>(null);
  const [mapping, setMapping] = useState<ResidentColumnMapping>(EMPTY_MAPPING);
  const [analysis, setAnalysis] = useState<ResidentImportAnalysis | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [createMissingUnits, setCreateMissingUnits] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");

  const needsFallbackBlock =
    hasBlocks &&
    Boolean(
      analysis?.importableRows.some((row) => !row.block_name?.trim()),
    );

  function resetFile() {
    setFile(null);
    setSource(null);
    setMapping(EMPTY_MAPPING);
    setAnalysis(null);
    setError("");
    setSummary("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    resetFile();
    setFile(event.target.files?.[0] ?? null);
  }

  async function handleAnalyze() {
    if (!file) {
      setError("Selecione um arquivo CSV ou XLSX antes de analisar.");
      return;
    }

    setParsing(true);
    setError("");
    setSummary("");
    setAnalysis(null);
    try {
      const nextSource = await readResidentFile(file);
      setSource(nextSource);
      setMapping(guessResidentColumnMapping(nextSource.headers));
      setSummary(
        `${nextSource.rows.length} linha(s) encontrada(s). Confira o mapeamento das colunas antes de continuar.`,
      );
    } catch (cause) {
      setSource(null);
      setMapping(EMPTY_MAPPING);
      setError(errorMessage(cause, "Não foi possível analisar o arquivo."));
    } finally {
      setParsing(false);
    }
  }

  function updateMapping(field: keyof ResidentColumnMapping, value: string) {
    setMapping((current) => ({
      ...current,
      [field]: Number.parseInt(value, 10),
    }));
    setAnalysis(null);
    setSummary("");
    setError("");
  }

  function handlePreview() {
    if (!source || mapping.unit < 0) return;
    setAnalysis(analyzeResidentImport(mapResidentRows(source, mapping)));
    setError("");
    setSummary("");
  }

  async function handleImport() {
    if (!analysis || analysis.importableRows.length === 0) return;

    setImporting(true);
    setError("");
    setSummary("");
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "import_condominium_residents",
        {
          p_condominium_id: condominiumId,
          p_block_id: selectedBlockId || null,
          p_create_missing_units: createMissingUnits,
          p_rows: toRpcResidentRows(analysis.importableRows),
        },
      );

      if (rpcError) throw new Error(rpcError.message);

      const result = (data ?? {}) as ImportRpcResult;
      setSummary(
        `Importação concluída: ${result.units_created ?? 0} unidade(s) criada(s), ` +
          `${result.residents_created ?? 0} morador(es) cadastrado(s) e ` +
          `${result.duplicates_skipped ?? 0} duplicata(s) ignorada(s).`,
      );
      resetFile();
      await onImported();
    } catch (cause) {
      setError(errorMessage(cause, "Não foi possível concluir a importação."));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="resident-panel" id="residents-import">
      <div className="section-heading">
        <div>
          <h3>Importar planilha de moradores</h3>
          <p>
            Envie um CSV ou XLSX, analise o arquivo e informe em qual coluna está
            cada dado. Nada é adivinhado: as sugestões podem ser trocadas antes
            da importação. Nome e WhatsApp são opcionais: uma linha sem ambos
            cria apenas a unidade. O porteiro não faz esse cadastro.
          </p>
        </div>
      </div>

      <div className="condominium-form">
        <label className="form-field">
          Arquivo (.csv, .xlsx ou .xls)
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,.xls"
            onChange={handleFileChange}
            disabled={importing}
          />
          <span className="field-hint">{file ? file.name : "Nenhum arquivo"}</span>
        </label>

        {hasBlocks && (
          <div className="form-field">
            Bloco padrão
            <select
              value={selectedBlockId}
              onChange={(event) => setSelectedBlockId(event.target.value)}
              disabled={importing}
            >
              <option value="">Selecione um bloco</option>
              {blocks.map((block) => (
                <option key={block.id} value={block.id}>
                  {block.name}
                </option>
              ))}
            </select>
            <span className="field-hint">
              {source && mapping.block >= 0
                ? "Usado apenas nas linhas sem bloco preenchido; as demais usam o bloco da planilha."
                : "As unidades serão criadas neste bloco."}
            </span>
          </div>
        )}

        <div className="form-field">
          Opções
          <label className="choice-options">
            <input
              type="checkbox"
              checked={createMissingUnits}
              onChange={(event) =>
                setCreateMissingUnits(event.target.checked)
              }
              disabled={importing}
            />
            Criar unidades que ainda não existem
          </label>
        </div>

        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={!file || parsing || importing}
            onClick={() => void handleAnalyze()}
          >
            {parsing ? "Analisando..." : "Analisar arquivo"}
          </button>
          {source && (
            <button
              className="secondary-button"
              type="button"
              disabled={mapping.unit < 0 || importing}
              onClick={handlePreview}
            >
              Atualizar prévia
            </button>
          )}
          <button
            className="primary-button"
            type="button"
            disabled={
              !analysis ||
              analysis.importableRows.length === 0 ||
              analysis.counts.errors > 0 ||
              (needsFallbackBlock && !selectedBlockId) ||
              importing
            }
            onClick={() => void handleImport()}
          >
            {importing ? "Importando..." : "Importar"}
          </button>
        </div>
      </div>

      {source && (
        <div className="resident-import-mapping">
          <div className="section-heading">
            <div>
              <h4>Mapear colunas do arquivo</h4>
              <p>
                Encontramos {source.headers.length} coluna(s). Escolha em qual
                coluna está cada informação; apenas a unidade é obrigatória.
              </p>
            </div>
          </div>
          <div className="resident-import-mapping-grid">
            {MAPPING_FIELDS.map((field) => (
              <label className="form-field" key={field.key}>
                {field.label}
                {field.required ? " *" : ""}
                <select
                  value={mapping[field.key]}
                  onChange={(event) =>
                    updateMapping(field.key, event.target.value)
                  }
                  disabled={importing}
                >
                  <option value={NO_COLUMN}>Não usar</option>
                  {source.headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={index}>
                      {index + 1}. {header || `(coluna ${index + 1})`}
                    </option>
                  ))}
                </select>
                <span className="field-hint">{field.hint}</span>
              </label>
            ))}
          </div>
          <p className="field-hint">
            Cabeçalhos encontrados:{" "}
            {source.headers
              .map((header, index) => `${index + 1}. ${header || "—"}`)
              .join(" · ")}
          </p>
        </div>
      )}

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}
      {needsFallbackBlock && !selectedBlockId && (
        <p className="feedback-message feedback-error" role="alert">
          Selecione um bloco padrão para as linhas sem bloco informado.
        </p>
      )}
      {summary && (
        <p className="feedback-message feedback-success" role="status">
          {summary}
        </p>
      )}

      {analysis && (
        <>
          <p className="field-hint" aria-live="polite">
            {analysis.counts.total} linha(s) encontrada(s): {" "}
            {analysis.counts.ready} pronta(s), {analysis.counts.unitOnly} só
            unidade, {analysis.counts.duplicates} duplicada(s) e {" "}
            {analysis.counts.errors} com erro.
          </p>
          <div className="table-scroll">
            <table className="condominium-table">
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>Bloco</th>
                  <th>Nome</th>
                  <th>Telefone</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.map((row) => (
                  <tr key={row.line}>
                    <td>
                      <strong>{row.unit_number || "—"}</strong>
                      <small className="field-hint"> Linha {row.line}</small>
                    </td>
                    <td>{row.block_name || "—"}</td>
                    <td>{row.name || "—"}</td>
                    <td>{row.whatsapp || "—"}</td>
                    <td>
                      <span className="field-hint">{row.message}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
