import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  analyzeResidentImport,
  applyImportBlockChoice,
  guessResidentColumnMapping,
  mapResidentRows,
  readResidentFile,
  toRpcResidentRows,
  NO_COLUMN,
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

const UNIT_FIELD = {
  key: "unit" as const,
  label: "Unidade / Apartamento",
  hint: "Obrigatório. Ex.: 101, Apto 201, Nº do imóvel.",
  required: true,
};

const BLOCK_FIELD = {
  key: "block" as const,
  label: "Bloco / Torre",
  hint: "Opcional. Os blocos encontrados são criados automaticamente.",
  required: false,
};

const EMPTY_MAPPING: ResidentColumnMapping = {
  unit: NO_COLUMN,
  block: NO_COLUMN,
  names: [],
  phones: [],
};

function ensureOneSlot(values: readonly number[]): number[] {
  return values.length > 0 ? [...values] : [NO_COLUMN];
}

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

  const mappedRows = useMemo(
    () =>
      source && mapping.unit >= 0 ? mapResidentRows(source, mapping) : [],
    [source, mapping],
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
    if (!source || mapping.block < 0) return [];
    const values = new Set<string>();
    source.rows.forEach((row) => {
      const cell = row[mapping.block];
      const value =
        cell === null || cell === undefined ? "" : String(cell).trim();
      if (value) values.add(value);
    });
    return [...values];
  }, [source, mapping]);

  const emptyBlockRows = useMemo(
    () =>
      source && mapping.block >= 0
        ? source.rows.filter((row) => {
            const cell = row[mapping.block];
            return !(cell !== null && cell !== undefined && String(cell).trim());
          }).length
        : 0,
    [source, mapping],
  );

  const needsBlockQuestion = Boolean(
    source && mapping.unit >= 0 && blockValues.length === 0,
  );

  const canImport = Boolean(
    analysis &&
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

  function invalidatePreview() {
    setBlockChoice(null);
    setAnalysis(null);
    setSummary("");
    setError("");
  }

  function updateSimpleMapping(field: "unit" | "block", value: string) {
    setMapping((current) => ({
      ...current,
      [field]: Number.parseInt(value, 10),
    }));
    invalidatePreview();
  }

  function updateListMapping(
    field: "names" | "phones",
    index: number,
    value: string,
  ) {
    setMapping((current) => {
      const list = ensureOneSlot(current[field]);
      list[index] = Number.parseInt(value, 10);
      return { ...current, [field]: list };
    });
    invalidatePreview();
  }

  function addListSlot(field: "names" | "phones") {
    setMapping((current) => ({
      ...current,
      [field]: [...ensureOneSlot(current[field]), NO_COLUMN],
    }));
    invalidatePreview();
  }

  function removeListSlot(field: "names" | "phones", index: number) {
    setMapping((current) => {
      const list = ensureOneSlot(current[field]);
      list.splice(index, 1);
      return { ...current, [field]: ensureOneSlot(list) };
    });
    invalidatePreview();
  }

  function chooseBlock(choice: Exclude<ResidentImportBlockChoice, null>) {
    setBlockChoice(choice);
    if (source && mapping.unit >= 0) {
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
            Envie um CSV ou XLSX, analise o arquivo e informe em qual coluna está
            cada dado. Nada é adivinhado: as sugestões podem ser trocadas antes
            da importação. Blocos citados na planilha são criados
            automaticamente. Nome e WhatsApp são opcionais: uma linha sem ambos
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
              disabled={mapping.unit < 0 || importing}
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
                Encontramos {source.headers.length} coluna(s). Escolha em qual
                coluna está cada informação; apenas a unidade é obrigatória.
                Se houver Morador 1, Morador 2 etc., adicione uma coluna de
                morador para cada um. Cada nome é pareado com o telefone da
                mesma posição.
              </p>
            </div>
          </div>
          <div className="resident-import-mapping-grid">
            {[UNIT_FIELD, BLOCK_FIELD].map((field) => (
              <label className="form-field" key={field.key}>
                {field.label}
                {field.required ? " *" : ""}
                <select
                  value={mapping[field.key]}
                  onChange={(event) =>
                    updateSimpleMapping(field.key, event.target.value)
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

          <div className="resident-import-mapping-list">
            <div className="resident-import-list-heading">
              <h5>Colunas de morador</h5>
              <p className="field-hint">
                Uma linha da planilha pode gerar vários moradores no mesmo
                apartamento.
              </p>
            </div>
            <div className="resident-import-mapping-grid">
              {ensureOneSlot(mapping.names).map((value, index) => (
                <div className="form-field" key={`name-${index}`}>
                  Nome do morador {mapping.names.length > 1 ? index + 1 : ""}
                  <div className="mapping-slot-row">
                    <select
                      value={value}
                      onChange={(event) =>
                        updateListMapping("names", index, event.target.value)
                      }
                      disabled={importing}
                    >
                      <option value={NO_COLUMN}>Não usar</option>
                      {source.headers.map((header, headerIndex) => (
                        <option
                          key={`${header}-${headerIndex}`}
                          value={headerIndex}
                        >
                          {headerIndex + 1}. {header || `(coluna ${headerIndex + 1})`}
                        </option>
                      ))}
                    </select>
                    {mapping.names.length > 1 && (
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Remover coluna de morador ${index + 1}`}
                        title="Remover esta coluna de morador"
                        disabled={importing}
                        onClick={() => removeListSlot("names", index)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="text-button"
              type="button"
              disabled={importing}
              onClick={() => addListSlot("names")}
            >
              + Adicionar outra coluna de morador
            </button>
          </div>

          <div className="resident-import-mapping-list">
            <div className="resident-import-list-heading">
              <h5>Colunas de telefone / WhatsApp</h5>
              <p className="field-hint">
                Opcional. O telefone 1 fica com o morador 1, o 2 com o morador 2
                e assim por diante.
              </p>
            </div>
            <div className="resident-import-mapping-grid">
              {ensureOneSlot(mapping.phones).map((value, index) => (
                <div className="form-field" key={`phone-${index}`}>
                  Telefone / WhatsApp {mapping.phones.length > 1 ? index + 1 : ""}
                  <div className="mapping-slot-row">
                    <select
                      value={value}
                      onChange={(event) =>
                        updateListMapping("phones", index, event.target.value)
                      }
                      disabled={importing}
                    >
                      <option value={NO_COLUMN}>Não usar</option>
                      {source.headers.map((header, headerIndex) => (
                        <option
                          key={`${header}-${headerIndex}`}
                          value={headerIndex}
                        >
                          {headerIndex + 1}. {header || `(coluna ${headerIndex + 1})`}
                        </option>
                      ))}
                    </select>
                    {mapping.phones.length > 1 && (
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Remover coluna de telefone ${index + 1}`}
                        title="Remover esta coluna de telefone"
                        disabled={importing}
                        onClick={() => removeListSlot("phones", index)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="text-button"
              type="button"
              disabled={importing}
              onClick={() => addListSlot("phones")}
            >
              + Adicionar outro telefone / WhatsApp
            </button>
          </div>
          <p className="field-hint">
            Cabeçalhos encontrados:{" "}
            {source.headers
              .map((header, index) => `${index + 1}. ${header || "—"}`)
              .join(" · ")}
          </p>
        </div>
      )}

      {source && mapping.unit >= 0 && blockValues.length > 0 && (
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
