import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  analyzeResidentImport,
  applyImportBlockChoice,
  guessResidentColumnMapping,
  mapResidentRows,
  readResidentFile,
  RESIDENT_COLUMN_KINDS,
  toRpcResidentRows,
  type ResidentColumnKind,
  type ResidentColumnMapping,
  type ResidentImportAnalysis,
  type ResidentImportBlockChoice,
  type ResidentImportRow,
  type ResidentImportSource,
} from "../lib/residentImport";
import { supabase } from "../lib/supabase";

type ResidentsImportPanelProps = {
  condominiumId: string;
  onImported: (rows: readonly ResidentImportRow[]) => void | Promise<void>;
};

type ImportRpcResult = {
  blocks_created?: number;
  units_created?: number;
  residents_created?: number;
  duplicates_skipped?: number;
};

const EMPTY_MAPPING: ResidentColumnMapping = [];

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? `${fallback} ${cause.message}` : fallback;
}

export function ResidentsImportPanel({
  condominiumId,
  onImported,
}: ResidentsImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<ResidentImportSource | null>(null);
  const [mapping, setMapping] = useState<ResidentColumnMapping>(EMPTY_MAPPING);
  const [blockChoice, setBlockChoice] =
    useState<ResidentImportBlockChoice>(null);
  const [analysis, setAnalysis] = useState<ResidentImportAnalysis | null>(null);
  const [createMissingUnits, setCreateMissingUnits] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");

  const hasUnitColumn = mapping.includes("unit");
  const blockColumnIndex = mapping.findIndex((kind) => kind === "block");

  const mappedRows = useMemo(
    () => (source && hasUnitColumn ? mapResidentRows(source, mapping) : []),
    [source, mapping, hasUnitColumn],
  );

  const effectiveRows = useMemo(
    () => applyImportBlockChoice(mappedRows, blockChoice),
    [mappedRows, blockChoice],
  );

  const preview = useMemo(
    () => analyzeResidentImport(effectiveRows),
    [effectiveRows],
  );

  const blockValues = useMemo(() => {
    if (!source || blockColumnIndex < 0) return [];
    const values = new Set<string>();
    source.rows.forEach((row) => {
      const cell = row[blockColumnIndex];
      const value =
        cell === null || cell === undefined ? "" : String(cell).trim();
      if (value) values.add(value);
    });
    return [...values];
  }, [source, blockColumnIndex]);

  const emptyBlockRows = useMemo(
    () =>
      source && blockColumnIndex >= 0
        ? source.rows.filter((row) => {
            const cell = row[blockColumnIndex];
            return !(cell !== null && cell !== undefined && String(cell).trim());
          }).length
        : 0,
    [source, blockColumnIndex],
  );

  const needsBlockQuestion = Boolean(
    source && hasUnitColumn && blockValues.length === 0,
  );

  const canImport = Boolean(
    analysis &&
      hasUnitColumn &&
      analysis.importableRows.length > 0 &&
      analysis.counts.errors === 0 &&
      (!needsBlockQuestion || blockChoice !== null),
  );

  function resetFile() {
    setFile(null);
    setSource(null);
    setMapping(EMPTY_MAPPING);
    setBlockChoice(null);
    setAnalysis(null);
    setError("");
    setSummary("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    // Captura o arquivo antes de limpar o input: limpar o value esvazia o
    // FileList do evento e faz o arquivo escolhido "desaparecer".
    const selected = event.target.files?.[0] ?? null;
    resetFile();
    setFile(selected);
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
    setBlockChoice(null);
    try {
      const nextSource = await readResidentFile(file);
      setSource(nextSource);
      setMapping(guessResidentColumnMapping(nextSource.headers));
      setSummary(
        `${nextSource.rows.length} linha(s) e ${nextSource.headers.length} coluna(s) encontradas. Escolha o que cada coluna representa.`,
      );
    } catch (cause) {
      setSource(null);
      setMapping(EMPTY_MAPPING);
      setError(errorMessage(cause, "Não foi possível analisar o arquivo."));
    } finally {
      setParsing(false);
    }
  }

  function invalidatePreview() {
    setBlockChoice(null);
    setAnalysis(null);
    setSummary("");
    setError("");
  }

  function updateColumnMapping(index: number, value: ResidentColumnKind) {
    setMapping((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
    invalidatePreview();
  }

  function chooseBlock(choice: Exclude<ResidentImportBlockChoice, null>) {
    setBlockChoice(choice);
    if (source && hasUnitColumn) {
      setAnalysis(
        analyzeResidentImport(
          applyImportBlockChoice(mapResidentRows(source, mapping), choice),
        ),
      );
    }
    setSummary("");
    setError("");
  }

  function handlePreview() {
    if (!hasUnitColumn) {
      setError("Marque pelo menos uma coluna como Apartamento / unidade.");
      return;
    }
    setAnalysis(preview);
    setError("");
    setSummary("");
  }

  async function handleImport() {
    if (!analysis || !canImport) return;

    const importedRows = analysis.importableRows;
    setImporting(true);
    setError("");
    setSummary("");
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "import_condominium_residents",
        {
          p_condominium_id: condominiumId,
          p_block_id: null,
          p_create_missing_units: createMissingUnits,
          p_rows: toRpcResidentRows(importedRows),
        },
      );

      if (rpcError) throw new Error(rpcError.message);

      const result = (data ?? {}) as ImportRpcResult;
      setSummary(
        `Importação concluída: ${result.blocks_created ?? 0} bloco(s) criado(s), ` +
          `${result.units_created ?? 0} unidade(s) criada(s), ` +
          `${result.residents_created ?? 0} morador(es) cadastrado(s) e ` +
          `${result.duplicates_skipped ?? 0} duplicata(s) ignorada(s).`,
      );
      resetFile();
      await onImported(importedRows);
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
            Envie um CSV ou XLSX, analise o arquivo e diga o que representa
            cada coluna. Se o arquivo tiver 9 colunas, você recebe 9 campos
            para mapear. Repita a opção <strong>Morador</strong> quantos
            moradores houver no apartamento; o mesmo vale para telefone,
            e-mail e observações. Blocos citados na planilha são criados
            automaticamente. O porteiro não faz esse cadastro.
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
          <span className="field-hint">
            {file ? file.name : "Nenhum arquivo selecionado"}
          </span>
        </label>

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
              disabled={!hasUnitColumn || importing}
              onClick={handlePreview}
            >
              Atualizar prévia
            </button>
          )}
          <button
            className="primary-button"
            type="button"
            disabled={!canImport || importing}
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
                Encontramos {source.headers.length} coluna(s). Escolha abaixo
                o que cada uma contém. Colunas que não servem para nada ficam
                em <strong>Não usar</strong>.
              </p>
            </div>
          </div>
          <div className="resident-import-columns">
            {source.headers.map((header, index) => (
              <label className="form-field" key={`column-${index}`}>
                <span className="resident-import-column-title">
                  Coluna {index + 1}: {header || "(sem cabeçalho)"}
                </span>
                <select
                  value={mapping[index] ?? "none"}
                  onChange={(event) =>
                    updateColumnMapping(
                      index,
                      event.target.value as ResidentColumnKind,
                    )
                  }
                  disabled={importing}
                >
                  {RESIDENT_COLUMN_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="field-hint">
            Repita <strong>Morador</strong> em várias colunas para cadastrar
            vários moradores no mesmo apartamento. A 1ª coluna de Morador
            combina com a 1ª de Telefone, E-mail e Observações; a 2ª com a 2ª,
            e assim por diante. Se mais de uma coluna for marcada como
            Apartamento, Bloco ou Andar, apenas a primeira será usada.
          </p>
          {!hasUnitColumn && (
            <p className="feedback-message feedback-error" role="alert">
              Marque pelo menos uma coluna como Apartamento / unidade para
              liberar a prévia e a importação.
            </p>
          )}
        </div>
      )}

      {source && blockColumnIndex >= 0 && blockValues.length > 0 && (
        <div className="resident-import-block-info">
          <strong>Blocos encontrados na planilha</strong>
          <p className="field-hint">
            {blockValues.length} bloco(s): {blockValues.join(" · ")}. Eles serão
            criados automaticamente se ainda não existirem.
          </p>
          {emptyBlockRows > 0 && (
            <p className="field-hint">
              {emptyBlockRows} linha(s) sem bloco ficarão sem bloco.
            </p>
          )}
        </div>
      )}

      {needsBlockQuestion && (
        <fieldset className="resident-import-block-choice">
          <legend>
            O condomínio não tem bloco ou você está cadastrando o primeiro bloco?
          </legend>
          <label className="choice-options">
            <input
              type="radio"
              name="resident-import-block-choice"
              checked={blockChoice === "none"}
              onChange={() => chooseBlock("none")}
              disabled={importing}
            />
            Não tem bloco: criar só os apartamentos (prédio de bloco único)
          </label>
          <label className="choice-options">
            <input
              type="radio"
              name="resident-import-block-choice"
              checked={blockChoice === "first"}
              onChange={() => chooseBlock("first")}
              disabled={importing}
            />
            Estou criando o primeiro bloco: cadastrar como Bloco 1
          </label>
          {!blockChoice && (
            <p className="field-hint">
              Escolha uma das opções acima para liberar a importação.
            </p>
          )}
        </fieldset>
      )}

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
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
                  <th>Andar</th>
                  <th>Bloco</th>
                  <th>Morador</th>
                  <th>Telefone</th>
                  <th>E-mail</th>
                  <th>Observações</th>
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
                    <td>{row.floor_label || "—"}</td>
                    <td>{row.block_name || "—"}</td>
                    <td>{row.name || "—"}</td>
                    <td>{row.whatsapp || "—"}</td>
                    <td>{row.email || "—"}</td>
                    <td>{row.notes || "—"}</td>
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
