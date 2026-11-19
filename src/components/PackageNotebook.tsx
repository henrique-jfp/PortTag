import { useEffect, useState } from "react";
import { ArrowLeft, Building2, ChevronRight } from "lucide-react";
import { PackageReceipt } from "./PackageReceipt";
import { Pagination } from "./Pagination";
import { supabase } from "../lib/supabase";
import {
  DRAWER_PAGE_SIZE,
  RECORD_PAGE_SIZE,
  fetchDrawers,
  fetchPackageRecords,
  fetchPackageSignature,
  type DrawerRecord,
  type PackageRecordRow,
} from "../lib/packageQueries";

export type NotebookBuilding = {
  id: string;
  name: string;
  meta?: string;
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function drawerLabel(drawer: DrawerRecord) {
  return drawer.block_name
    ? `${drawer.block_name} · Apartamento ${drawer.unit_number}`
    : `Apartamento ${drawer.unit_number}`;
}

/** Rastreio é opcional: na lista, a empresa ocupa o lugar do código. */
function recordLabel(record: PackageRecordRow) {
  return (
    record.tracking_code ||
    record.sender ||
    record.delivery_person ||
    "Sem identificação"
  );
}

/**
 * Caderno digital único: prédios (só no Super Admin) → gavetas de apartamento
 * → lista compacta de rastreios → detalhe da entrega com assinatura.
 *
 * A assinatura é carregada sob demanda porque é base64 de imagem gravada na
 * própria linha do pacote. Nunca entra na listagem.
 */
export function PackageNotebook({
  buildings,
  forceBuildingList = false,
}: {
  buildings: NotebookBuilding[];
  forceBuildingList?: boolean;
}) {
  const [buildingId, setBuildingId] = useState("");
  const [porterNames, setPorterNames] = useState<Map<string, string>>(new Map());
  const [drawers, setDrawers] = useState<DrawerRecord[]>([]);
  const [drawerTotal, setDrawerTotal] = useState(0);
  const [drawerPage, setDrawerPage] = useState(1);
  const [drawersLoading, setDrawersLoading] = useState(true);
  const [activeDrawer, setActiveDrawer] = useState<DrawerRecord | null>(null);
  const [records, setRecords] = useState<PackageRecordRow[]>([]);
  const [recordTotal, setRecordTotal] = useState(0);
  const [recordPage, setRecordPage] = useState(1);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [signatureCache, setSignatureCache] = useState<
    Record<string, string | null>
  >({});
  const [signatureLoadingId, setSignatureLoadingId] = useState("");
  const [error, setError] = useState("");
  const [signatureError, setSignatureError] = useState("");

  // O Super Admin sempre começa pela lista de prédios; síndico e porteiro,
  // que têm um único condomínio, entram direto nas gavetas.
  const activeBuildingId =
    buildingId ||
    (!forceBuildingList && buildings.length === 1 ? buildings[0].id : "");

  useEffect(() => {
    if (!activeBuildingId) return;
    let active = true;
    fetchDrawers(activeBuildingId, {}, drawerPage)
      .then((result) => {
        if (!active) return;
        setDrawers(result.items);
        setDrawerTotal(result.total);
        if (drawerPage > 1 && result.items.length === 0) setDrawerPage(1);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Falha inesperada.");
      })
      .finally(() => {
        if (active) setDrawersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeBuildingId, drawerPage]);

  useEffect(() => {
    if (!activeBuildingId || !activeDrawer?.unit_id) return;
    let active = true;
    fetchPackageRecords({
      condominiumId: activeBuildingId,
      unitId: activeDrawer.unit_id,
      sort: "recent",
      page: recordPage,
    })
      .then((result) => {
        if (!active) return;
        setRecords(result.items);
        setRecordTotal(result.total);
        if (recordPage > 1 && result.items.length === 0) setRecordPage(1);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Falha inesperada.");
      })
      .finally(() => {
        if (active) setRecordsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeBuildingId, activeDrawer, recordPage]);

  // Nomes dos porteiros são apenas informativos. Operadores não leem outros
  // porteiros por RLS; nesse caso o nome simplesmente fica "Não identificado".
  useEffect(() => {
    if (!activeBuildingId) return;
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("porter_accounts")
        .select("auth_user_id, name")
        .eq("condominium_id", activeBuildingId);
      if (!active) return;
      setPorterNames(
        new Map(
          (data ?? []).map((porter) => [porter.auth_user_id, porter.name]),
        ),
      );
    })().catch(() => {
      // Sem acesso aos nomes, o caderno continua legível.
    });
    return () => {
      active = false;
    };
  }, [activeBuildingId]);

  const selectedRecord =
    records.find((record) => record.id === selectedRecordId) ?? null;
  const currentBuilding = buildings.find(
    (building) => building.id === activeBuildingId,
  );

  function resetDrawer() {
    setActiveDrawer(null);
    setSelectedRecordId("");
    setRecords([]);
    setRecordTotal(0);
    setRecordPage(1);
  }

  async function loadSignature(packageId: string) {
    if (Object.prototype.hasOwnProperty.call(signatureCache, packageId)) return;
    setSignatureLoadingId(packageId);
    setSignatureError("");
    try {
      const signature = await fetchPackageSignature(packageId);
      setSignatureCache((current) => ({ ...current, [packageId]: signature }));
    } catch (cause) {
      setSignatureError(
        cause instanceof Error
          ? `Não foi possível carregar a assinatura. ${cause.message}`
          : "Não foi possível carregar a assinatura.",
      );
    } finally {
      setSignatureLoadingId("");
    }
  }

  function selectRecord(record: PackageRecordRow) {
    setSelectedRecordId((current) => (current === record.id ? "" : record.id));
    if (record.status === "collected") void loadSignature(record.id);
  }

  if (!buildings.length) {
    return (
      <p className="notebook-empty">
        Nenhum condomínio disponível para consulta.
      </p>
    );
  }

  if (!activeBuildingId) {
    return (
      <div className="notebook">
        <section className="notebook-section">
          <div className="notebook-heading">
            <div>
              <h2>Cadernos dos condomínios</h2>
              <p>
                {buildings.length} condomínio(s) cadastrado(s). Abra um caderno
                para consultar as gavetas por apartamento.
              </p>
            </div>
          </div>
          <ul className="notebook-building-list">
            {buildings.map((building) => (
              <li key={building.id}>
                <button
                  className="notebook-building-card"
                  type="button"
                  onClick={() => {
                    setBuildingId(building.id);
                    setDrawerPage(1);
                    setDrawersLoading(true);
                    setError("");
                    resetDrawer();
                  }}
                >
                  <span className="notebook-building-icon" aria-hidden="true">
                    <Building2 size={20} />
                  </span>
                  <span className="notebook-building-info">
                    <strong>{building.name}</strong>
                    <small>{building.meta ?? "Caderno digital"}</small>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <div className="notebook">
      {error && (
        <p className="notebook-error" role="alert">
          Não foi possível carregar o caderno. {error}
        </p>
      )}
      {signatureError && (
        <p className="notebook-error" role="alert">
          {signatureError}
        </p>
      )}

      {(forceBuildingList || buildings.length > 1) && currentBuilding && (
        <div className="notebook-building-bar">
          <button
            className="notebook-back"
            type="button"
            onClick={() => {
              setBuildingId("");
              setDrawerPage(1);
              resetDrawer();
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Todos os cadernos
          </button>
          <strong>{currentBuilding.name}</strong>
        </div>
      )}

      <div className="notebook-layout">
        <section className="notebook-panel">
          <div className="notebook-heading">
            <div>
              <h2>Gavetas de apartamentos</h2>
              <p>
                {drawerTotal.toLocaleString("pt-BR")} apartamento(s) com
                registros. Abra uma gaveta para ver os recebimentos do mais
                recente ao mais antigo.
              </p>
            </div>
          </div>

          {drawersLoading ? (
            <p className="notebook-empty">Carregando gavetas...</p>
          ) : drawers.length === 0 ? (
            <p className="notebook-empty">Nenhuma gaveta encontrada.</p>
          ) : (
            <ul className="notebook-drawer-list">
              {drawers.map((drawer) => (
                <li key={`${drawer.unit_id ?? "sem-id"}-${drawer.unit_number}`}>
                  <button
                    className={[
                      "notebook-drawer-card",
                      activeDrawer?.unit_id === drawer.unit_id &&
                      activeDrawer?.unit_number === drawer.unit_number
                        ? "is-active"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    onClick={() => {
                      setActiveDrawer(drawer);
                      setSelectedRecordId("");
                      setRecords([]);
                      setRecordTotal(0);
                      setRecordPage(1);
                      setRecordsLoading(true);
                      setError("");
                    }}
                  >
                    <strong>{drawerLabel(drawer)}</strong>
                    <small>
                      {drawer.package_count.toLocaleString("pt-BR")}{" "}
                      {drawer.package_count === 1
                        ? "recebimento"
                        : "recebimentos"}
                    </small>
                    {drawer.pending_count > 0 && (
                      <small className="notebook-pending">
                        {drawer.pending_count} aguardando retirada
                      </small>
                    )}
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Pagination
            page={drawerPage}
            total={drawerTotal}
            pageSize={DRAWER_PAGE_SIZE}
            onChange={(page) => {
              setDrawerPage(page);
              setDrawersLoading(true);
            }}
            label="Páginas de gavetas"
            disabled={drawersLoading}
          />
        </section>

        <section className="notebook-panel notebook-records-panel">
          {!activeDrawer ? (
            <div className="notebook-placeholder">
              <h2>Registros da gaveta</h2>
              <p>Selecione uma gaveta para consultar os recebimentos.</p>
            </div>
          ) : (
            <>
              <div className="notebook-heading notebook-records-heading">
                <div>
                  <h2>{drawerLabel(activeDrawer)}</h2>
                  <p>
                    {recordTotal.toLocaleString("pt-BR")} registro(s) · do mais
                    recente ao mais antigo
                  </p>
                </div>
                <button
                  className="notebook-close"
                  type="button"
                  onClick={resetDrawer}
                >
                  Fechar gaveta
                </button>
              </div>

              {recordsLoading ? (
                <p className="notebook-empty">Carregando registros...</p>
              ) : records.length === 0 ? (
                <p className="notebook-empty">
                  Nenhum registro nesta gaveta.
                </p>
              ) : (
                <ul className="notebook-record-list">
                  {records.map((record) => (
                    <li key={record.id}>
                      <button
                        className={[
                          "notebook-record-row",
                          selectedRecordId === record.id
                            ? "is-active"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        type="button"
                        aria-expanded={selectedRecordId === record.id}
                        onClick={() => selectRecord(record)}
                      >
                        <strong title={recordLabel(record)}>
                          {recordLabel(record)}
                        </strong>
                        <span
                          className={[
                            "notebook-status",
                            record.status === "collected"
                              ? "is-collected"
                              : "is-pending",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {record.status === "collected"
                            ? "Retirado"
                            : "Na portaria"}
                        </span>
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>

                      {selectedRecordId === record.id && selectedRecord && (
                        <div className="notebook-record-detail">
                          <dl className="notebook-detail-grid">
                            <div>
                              <dt>Destinatário</dt>
                              <dd>
                                {selectedRecord.resident_name ||
                                  "Não identificado"}
                              </dd>
                            </div>
                            <div>
                              <dt>Morador do apartamento</dt>
                              <dd>
                                {selectedRecord.recipient_is_resident
                                  ? "Confirmado"
                                  : "Não confirmado"}
                              </dd>
                            </div>
                            <div>
                              <dt>Recebida em</dt>
                              <dd>{formatDate(selectedRecord.received_at)}</dd>
                            </div>
                            <div>
                              <dt>Porteiro</dt>
                              <dd>
                                {porterNames.get(selectedRecord.received_by) ||
                                  "Não identificado"}
                              </dd>
                            </div>
                            <div>
                              <dt>Entregador</dt>
                              <dd>
                                {selectedRecord.delivery_person || "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Empresa</dt>
                              <dd>{selectedRecord.sender || "—"}</dd>
                            </div>
                            <div>
                              <dt>Código de rastreio</dt>
                              <dd>
                                {selectedRecord.tracking_code ||
                                  "Não informado"}
                              </dd>
                            </div>
                            <div>
                              <dt>Estado na chegada</dt>
                              <dd>
                                {selectedRecord.is_damaged
                                  ? "Avariado"
                                  : "Sem avaria"}
                              </dd>
                            </div>
                            <div>
                              <dt>Retirada em</dt>
                              <dd>{formatDate(selectedRecord.collected_at)}</dd>
                            </div>
                            <div>
                              <dt>Retirado por</dt>
                              <dd>
                                {selectedRecord.collected_by_name || "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Confirmado pelo porteiro</dt>
                              <dd>
                                {selectedRecord.collected_confirmed_by
                                  ? porterNames.get(
                                      selectedRecord.collected_confirmed_by,
                                    ) || "Porteiro"
                                  : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Aviso ao morador</dt>
                              <dd>
                                {selectedRecord.last_notified_at
                                  ? formatDate(selectedRecord.last_notified_at)
                                  : "Não avisado"}
                              </dd>
                            </div>
                          </dl>

                          <PackageReceipt
                            path={selectedRecord.receipt_path}
                            deletedAt={selectedRecord.photo_deleted_at}
                            isDamaged={selectedRecord.is_damaged}
                          />

                          {selectedRecord.status === "collected" && (
                            <div className="notebook-signature">
                              <h3>Assinatura do morador</h3>
                              {Object.prototype.hasOwnProperty.call(
                                signatureCache,
                                selectedRecord.id,
                              ) ? (
                                signatureCache[selectedRecord.id] ? (
                                  <img
                                    src={
                                      signatureCache[selectedRecord.id] as string
                                    }
                                    alt={`Assinatura de ${selectedRecord.collected_by_name || "quem retirou a encomenda"}`}
                                  />
                                ) : (
                                  <p>Assinatura não disponível.</p>
                                )
                              ) : (
                                <button
                                  className="notebook-signature-button"
                                  type="button"
                                  disabled={
                                    signatureLoadingId === selectedRecord.id
                                  }
                                  onClick={() =>
                                    void loadSignature(selectedRecord.id)
                                  }
                                >
                                  {signatureLoadingId === selectedRecord.id
                                    ? "Carregando assinatura..."
                                    : "Ver assinatura"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Pagination
                page={recordPage}
                total={recordTotal}
                pageSize={RECORD_PAGE_SIZE}
                onChange={(page) => {
                  setRecordPage(page);
                  setRecordsLoading(true);
                }}
                label="Páginas de registros da gaveta"
                disabled={recordsLoading}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
