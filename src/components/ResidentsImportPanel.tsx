import { useRef, useState, type ChangeEvent } from "react";
import {
  analyzeResidentImport,
  parseResidentFile,
  toRpcResidentRows,
  type ResidentImportAnalysis,
  type ResidentImportRow,
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
  const [rows, setRows] = useState<ResidentImportRow[]>([]);
  const [analysis, setAnalysis] = useState<ResidentImportAnalysis | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [createMissingUnits, setCreateMissingUnits] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");

  // `null` em todas as linhas significa que o arquivo não tem coluna de bloco.
  const fileHasBlockColumn = rows.some((row) => row.block_name !== null);
  const needsFallbackBlock =
    hasBlocks &&
    Boolean(
      analysis?.importableRows.some((row) => !row.block_name?.trim()),
    );

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setRows([]);
    setAnalysis(null);
    setError("");
    setSummary("");
  }

  async function handleAnalyze() {
    if (!file) {
      setError("Selecione um arquivo CSV ou XLSX antes de analisar.");
      return;
    }

    setParsing(true);
    setError("");
    setSummary("");
    try {
      const parsedRows = await parseResidentFile(file);
      setRows(parsedRows);
      setAnalysis(analyzeResidentImport(parsedRows));
    } catch (cause) {
      setRows([]);
      setAnalysis(null);
      setError(errorMessage(cause, "Não foi possível analisar o arquivo."));
    } finally {
      setParsing(false);
    }
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
      setFile(null);
      setRows([]);
      setAnalysis(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await onImported();
    } catch (cause) {
      setError(
        errorMessage(cause, "Não foi possível concluir a importação."),
      );
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
            Envie um CSV ou XLSX com as colunas de apartamento, bloco, nome e
            WhatsApp. Nome e WhatsApp são opcionais: uma linha sem ambos cria
            apenas a unidade. O porteiro não faz esse cadastro.
          </p>
        </div>
      </div>

      <div className="condominium-form">
        <label className="form-field">
          Arquivo (.csv, .xlsx ou .xls)
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
          />
        </label>

        <div className="form-field">
          Bloco padrão
          {hasBlocks ? (
            <>
              <select
                value={selectedBlockId}
                onChange={(event) => setSelectedBlockId(event.target.value)}
              >
                <option value="">Selecione um bloco</option>
                {blocks.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.name}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {fileHasBlockColumn
                  ? "Usado apenas nas linhas sem bloco preenchido; as demais usam o bloco da planilha."
                  : "As unidades serão criadas neste bloco."}
              </span>
            </>
          ) : (
            <span className="field-hint">
              Este condomínio não usa blocos.
            </span>
          )}
        </div>

        <div className="form-field">
          Opções
          <label className="choice-options">
            <input
              type="checkbox"
              checked={createMissingUnits}
              onChange={(event) =>
                setCreateMissingUnits(event.target.checked)
              }
            />
            Criar unidades que ainda não existem
          </label>
        </div>

        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={!file || parsing}
            onClick={() => void handleAnalyze()}
          >
            {parsing ? "Analisando..." : "Analisar arquivo"}
          </button>
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
