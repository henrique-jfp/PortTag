import { useEffect, useMemo, useState } from "react";
import { ChevronRight, LogOut, Search, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { PackageReceipt } from "../components/PackageReceipt";
import { Pagination } from "../components/Pagination";
import {
  DRAWER_PAGE_SIZE,
  RECORD_PAGE_SIZE,
  fetchDailyCounts,
  fetchDrawers,
  fetchPackageRecords,
  fetchPackageSignature,
  type DailyCount,
  type DrawerRecord,
  type PackageFilters,
  type PackageRecordRow,
  type PackageSort,
} from "../lib/packageQueries";
import { supabase } from "../lib/supabase";

type Condominium = {
  id: string;
  name: string;
};

type Block = {
  id: string;
  name: string;
};

type Unit = {
  unit_number: string;
  block_id: string | null;
};

type LedgerFilters = {
  selectedDate: string;
  dateFrom: string;
  dateTo: string;
  unit: string;
  tracking: string;
  company: string;
  porter: string;
  status: string;
};

const emptyFilters: LedgerFilters = {
  selectedDate: "",
  dateFrom: "",
  dateTo: "",
  unit: "",
  tracking: "",
  company: "",
  porter: "",
  status: "",
};

const currentYear = new Date().getFullYear();

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function MonthCalendar({
  year,
  month,
  counts,
  selectedDate,
  onSelectDate,
}: {
  year: number;
  month: number;
  counts: Map<string, number>;
  selectedDate: string;
  onSelectDate: (value: string) => void;
}) {
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = firstDay.toLocaleDateString("pt-BR", { month: "long" });

  return (
    <section className="calendar-month" aria-label={`${monthName} de ${year}`}>
      <h3>{monthName}</h3>
      <div className="calendar-grid calendar-weekdays" aria-hidden="true">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {Array.from({ length: offset }, (_, index) => (
          <span key={`empty-${index}`} aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const count = counts.get(key) ?? 0;
          return (
            <button
              key={key}
              type="button"
              className={[
                "calendar-day",
                count ? "calendar-day-has-records" : "",
                selectedDate === key ? "calendar-day-selected" : "",
              ].filter(Boolean).join(" ")}
              aria-pressed={selectedDate === key}
              aria-label={`${day} de ${monthName}: ${count} recebimentos`}
              onClick={() => onSelectDate(selectedDate === key ? "" : key)}
            >
              {day}
              {count > 0 && <small>{count}</small>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function drawerLabel(drawer: DrawerRecord) {
  return drawer.block_name
    ? `${drawer.block_name} · Apartamento ${drawer.unit_number}`
    : `Apartamento ${drawer.unit_number}`;
}

export function ManagerLedger() {
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [condominiumId, setCondominiumId] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [porterNames, setPorterNames] = useState<Map<string, string>>(new Map());
  const [filters, setFilters] = useState<LedgerFilters>(emptyFilters);
  const [dailyCounts, setDailyCounts] = useState<DailyCount[]>([]);
  const [drawers, setDrawers] = useState<DrawerRecord[]>([]);
  const [drawerPage, setDrawerPage] = useState(1);
  const [drawerTotal, setDrawerTotal] = useState(0);
  const [drawersLoading, setDrawersLoading] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<DrawerRecord | null>(null);
  const [records, setRecords] = useState<PackageRecordRow[]>([]);
  const [recordPage, setRecordPage] = useState(1);
  const [recordTotal, setRecordTotal] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordSort, setRecordSort] = useState<PackageSort>("recent");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [signatureCache, setSignatureCache] = useState<
    Record<string, string | null>
  >({});
  const [signatureLoadingId, setSignatureLoadingId] = useState("");
  const [pageError, setPageError] = useState("");
  const [signatureError, setSignatureError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadAccess() {
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

      const superAdmin = Boolean(profile?.is_super_admin);
      setIsSuperAdmin(superAdmin);
      if (superAdmin) {
        const { data, error } = await supabase
          .from("condominiums")
          .select("id, name")
          .eq("status", "active")
          .order("name");
        if (!active) return;
        if (error) setPageError(error.message);
        else {
          setCondominiums(data ?? []);
          setCondominiumId(data?.[0]?.id ?? "");
        }
      } else {
        const { data: memberships, error: membershipError } = await supabase
          .from("condominium_users")
          .select("condominium_id")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .eq("status", "active");
        if (!active) return;
        if (membershipError) {
          setPageError(membershipError.message);
          setLoading(false);
          return;
        }

        const ids = (memberships ?? []).map((membership) => membership.condominium_id);
        if (ids.length) {
          const { data, error } = await supabase
            .from("condominiums")
            .select("id, name")
            .in("id", ids)
            .eq("status", "active")
            .order("name");
          if (!active) return;
          if (error) setPageError(error.message);
          else {
            setCondominiums(data ?? []);
            setCondominiumId(data?.[0]?.id ?? "");
          }
        }
      }
      if (active) setLoading(false);
    }

    void loadAccess().catch((error: unknown) => {
      if (!active) return;
      setPageError(error instanceof Error ? error.message : "Falha inesperada.");
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

  // Listas de referência são pequenas e mudam só quando troca o condomínio.
  useEffect(() => {
    let active = true;
    if (!condominiumId) return;

    void (async () => {
      const [blocksResult, unitsResult, porterResult] = await Promise.all([
        supabase
          .from("blocks")
          .select("id, name")
          .eq("condominium_id", condominiumId)
          .order("name"),
        supabase
          .from("units")
          .select("unit_number, block_id")
          .eq("condominium_id", condominiumId)
          .eq("status", "active")
          .order("unit_number"),
        supabase
          .from("porter_accounts")
          .select("auth_user_id, name")
          .eq("condominium_id", condominiumId),
      ]);
      if (!active) return;
      const error = blocksResult.error ?? unitsResult.error ?? porterResult.error;
      if (error) {
        setPageError(error.message);
        return;
      }
      setBlocks(blocksResult.data ?? []);
      setUnits(unitsResult.data ?? []);
      setPorterNames(
        new Map(
          (porterResult.data ?? []).map((porter) => [
            porter.auth_user_id,
            porter.name,
          ]),
        ),
      );
    })().catch((error: unknown) => {
      if (!active) return;
      setPageError(error instanceof Error ? error.message : "Falha inesperada.");
    });

    return () => {
      active = false;
    };
  }, [condominiumId]);

  const apiFilters = useMemo<PackageFilters>(
    () => ({
      dateFrom: filters.selectedDate || filters.dateFrom,
      dateTo: filters.selectedDate || filters.dateTo,
      unit: filters.unit,
      tracking: filters.tracking,
      company: filters.company,
      porter: filters.porter,
      status: filters.status,
    }),
    [filters],
  );

  useEffect(() => {
    let active = true;
    if (!condominiumId) return;

    void (async () => {
      setDrawersLoading(true);
      setPageError("");
      try {
        const [counts, result] = await Promise.all([
          fetchDailyCounts(condominiumId, currentYear),
          fetchDrawers(condominiumId, apiFilters, drawerPage),
        ]);
        if (!active) return;
        setDailyCounts(counts);
        setDrawers(result.items);
        setDrawerTotal(result.total);
        if (drawerPage > 1 && result.items.length === 0) setDrawerPage(1);
      } catch (error) {
        if (!active) return;
        setPageError(
          error instanceof Error
            ? `Não foi possível carregar o caderno. ${error.message}`
            : "Não foi possível carregar o caderno.",
        );
      } finally {
        if (active) setDrawersLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [condominiumId, apiFilters, drawerPage]);

  useEffect(() => {
    let active = true;
    if (!condominiumId || !activeDrawer?.unit_id) return;

    void (async () => {
      setRecordsLoading(true);
      try {
        const result = await fetchPackageRecords({
          condominiumId,
          unitId: activeDrawer.unit_id,
          filters: apiFilters,
          sort: recordSort,
          page: recordPage,
        });
        if (!active) return;
        setRecords(result.items);
        setRecordTotal(result.total);
        if (recordPage > 1 && result.items.length === 0) setRecordPage(1);
      } catch (error) {
        if (!active) return;
        setPageError(
          error instanceof Error
            ? `Não foi possível carregar os recebimentos. ${error.message}`
            : "Não foi possível carregar os recebimentos.",
        );
      } finally {
        if (active) setRecordsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [condominiumId, activeDrawer, apiFilters, recordSort, recordPage]);

  const countsByDay = useMemo(
    () => new Map(dailyCounts.map((count) => [count.day, count.total])),
    [dailyCounts],
  );
  const yearTotals = useMemo(
    () =>
      dailyCounts.reduce(
        (totals, count) => ({
          total: totals.total + count.total,
          pending: totals.pending + count.pending,
          collected: totals.collected + count.collected,
        }),
        { total: 0, pending: 0, collected: 0 },
      ),
    [dailyCounts],
  );
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;

  function updateFilter<K extends keyof LedgerFilters>(
    key: K,
    value: LedgerFilters[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
    setDrawerPage(1);
    setActiveDrawer(null);
    setSelectedRecordId("");
    setRecordPage(1);
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setDrawerPage(1);
    setActiveDrawer(null);
    setSelectedRecordId("");
    setRecordPage(1);
  }

  function openDrawer(drawer: DrawerRecord) {
    setActiveDrawer(drawer);
    setRecordSort("recent");
    setRecordPage(1);
    setSelectedRecordId("");
    setRecords([]);
    setRecordTotal(0);
  }

  async function loadSignature(packageId: string) {
    if (Object.prototype.hasOwnProperty.call(signatureCache, packageId)) return;
    setSignatureLoadingId(packageId);
    setSignatureError("");
    try {
      const signature = await fetchPackageSignature(packageId);
      setSignatureCache((current) => ({ ...current, [packageId]: signature }));
    } catch (error) {
      setSignatureError(
        error instanceof Error
          ? `Não foi possível carregar a assinatura. ${error.message}`
          : "Não foi possível carregar a assinatura.",
      );
    } finally {
      setSignatureLoadingId("");
    }
  }

  function selectRecord(record: PackageRecordRow) {
    setSelectedRecordId(record.id);
    if (record.status === "collected") void loadSignature(record.id);
  }

  async function handleSignOut() {
    try {
      await signOut();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Não foi possível sair.");
    }
  }

  const blockNameForUnit = (blockId: string | null) =>
    blocks.find((block) => block.id === blockId)?.name ?? "";

  if (loading && condominiums.length === 0) {
    return <div className="loading-screen">Carregando caderno...</div>;
  }

  return (
    <main className="ledger-page">
      <header className="ledger-header">
        <div>
          <p className="eyebrow">Controle de Encomendas · Área do Síndico</p>
          <h1>Caderno de registros</h1>
          <p>{user?.email}</p>
        </div>
        <div className="header-actions">
          {isSuperAdmin && (
            <a className="secondary-button button-link" href="/">
              Super Admin
            </a>
          )}
          <a className="secondary-button button-link" href="/porter.html">
            App Porteiro
          </a>
          <button className="secondary-button" onClick={() => void handleSignOut()}>
            <LogOut size={17} /> Sair
          </button>
        </div>
      </header>

      {pageError && <p className="feedback-message feedback-error" role="alert">{pageError}</p>}
      {signatureError && (
        <p className="feedback-message feedback-error" role="alert">
          {signatureError}
        </p>
      )}
      {!condominiums.length ? (
        <section className="welcome-card">
          <h2>Sem acesso a um condomínio</h2>
          <p>Peça ao Super Admin para vincular sua conta como síndico.</p>
        </section>
      ) : (
        <>
          <section className="ledger-controls">
            <label className="form-field">
              Condomínio
              <select
                value={condominiumId}
                onChange={(event) => {
                  setCondominiumId(event.target.value);
                  clearFilters();
                }}
              >
                {condominiums.map((condominium) => (
                  <option key={condominium.id} value={condominium.id}>
                    {condominium.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ledger-stats">
              <span><strong>{yearTotals.total.toLocaleString("pt-BR")}</strong> registros em {currentYear}</span>
              <span><strong>{yearTotals.pending.toLocaleString("pt-BR")}</strong> aguardando retirada</span>
              <span><strong>{yearTotals.collected.toLocaleString("pt-BR")}</strong> retirados</span>
            </div>
          </section>

          <section className="admin-section ledger-calendar-section">
            <div className="section-heading">
              <div>
                <h2>Calendário de {currentYear}</h2>
                <p>Toque em um dia para ver as gavetas com registros daquela data.</p>
              </div>
              {filters.selectedDate && (
                <button className="text-button" onClick={() => updateFilter("selectedDate", "")}>
                  Limpar dia
                </button>
              )}
            </div>
            <div className="year-calendar">
              {Array.from({ length: 12 }, (_, month) => (
                <MonthCalendar
                  key={month}
                  year={currentYear}
                  month={month}
                  counts={countsByDay}
                  selectedDate={filters.selectedDate}
                  onSelectDate={(value) => updateFilter("selectedDate", value)}
                />
              ))}
            </div>
          </section>

          <section className="admin-section ledger-search-section">
            <div className="section-heading">
              <div>
                <h2><Search size={19} /> Busca avançada</h2>
                <p>Filtre por data, apartamento, rastreio, empresa, porteiro ou situação.</p>
              </div>
              <button className="text-button" onClick={clearFilters}>
                <X size={16} /> Limpar filtros
              </button>
            </div>
            <div className="ledger-filters">
              <label className="form-field">
                Data inicial
                <input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} />
              </label>
              <label className="form-field">
                Data final
                <input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} />
              </label>
              <label className="form-field">
                Apartamento
                <input
                  list="ledger-units"
                  placeholder="Ex.: 901"
                  value={filters.unit}
                  onChange={(event) => updateFilter("unit", event.target.value)}
                />
                <datalist id="ledger-units">
                  {units.map((unit) => (
                    <option
                      key={`${unit.block_id}-${unit.unit_number}`}
                      value={unit.unit_number}
                    >
                      {blockNameForUnit(unit.block_id)}
                    </option>
                  ))}
                </datalist>
              </label>
              <label className="form-field">
                Código de rastreio
                <input
                  value={filters.tracking}
                  onChange={(event) => updateFilter("tracking", event.target.value)}
                />
              </label>
              <label className="form-field">
                Empresa ou entregador
                <input
                  value={filters.company}
                  onChange={(event) => updateFilter("company", event.target.value)}
                />
              </label>
              <label className="form-field">
                Porteiro
                <input
                  value={filters.porter}
                  onChange={(event) => updateFilter("porter", event.target.value)}
                />
              </label>
              <label className="form-field">
                Situação
                <select
                  value={filters.status}
                  onChange={(event) => updateFilter("status", event.target.value)}
                >
                  <option value="">Todas</option>
                  <option value="received">Aguardando retirada</option>
                  <option value="collected">Retirada confirmada</option>
                </select>
              </label>
            </div>
            {filters.selectedDate && (
              <p className="field-hint">
                Dia selecionado: {new Date(`${filters.selectedDate}T12:00:00`).toLocaleDateString("pt-BR")}
              </p>
            )}
          </section>

          <section className="admin-section ledger-drawers-section">
            <div className="section-heading">
              <div>
                <h2>Gavetas de apartamentos</h2>
                <p>
                  {drawerTotal.toLocaleString("pt-BR")} apartamento(s) com
                  registros no recorte. Abra uma gaveta para ver os recebimentos
                  do mais recente ao mais antigo.
                </p>
              </div>
            </div>

            <div className="ledger-drawer-layout">
              <div className="ledger-drawer-column">
                {drawersLoading ? (
                  <p className="empty-state">Carregando gavetas...</p>
                ) : drawers.length === 0 ? (
                  <p className="empty-state">Nenhuma gaveta corresponde aos filtros.</p>
                ) : (
                  <ul className="drawer-grid">
                    {drawers.map((drawer) => (
                      <li key={`${drawer.unit_id ?? "sem-id"}-${drawer.unit_number}`}>
                        <button
                          type="button"
                          className={[
                            "drawer-card",
                            activeDrawer?.unit_id === drawer.unit_id &&
                            activeDrawer?.unit_number === drawer.unit_number
                              ? "drawer-card-active"
                              : "",
                          ].filter(Boolean).join(" ")}
                          onClick={() => openDrawer(drawer)}
                        >
                          <strong>{drawerLabel(drawer)}</strong>
                          <span>
                            {drawer.package_count.toLocaleString("pt-BR")}{" "}
                            {drawer.package_count === 1 ? "recebimento" : "recebimentos"}
                          </span>
                          <small>Último em {formatDate(drawer.last_received_at)}</small>
                          {drawer.pending_count > 0 && (
                            <small className="drawer-pending">
                              {drawer.pending_count} aguardando retirada
                            </small>
                          )}
                          <ChevronRight size={18} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <Pagination
                  page={drawerPage}
                  total={drawerTotal}
                  pageSize={DRAWER_PAGE_SIZE}
                  onChange={setDrawerPage}
                  label="Páginas de gavetas"
                  disabled={drawersLoading}
                />
              </div>

              <div className="ledger-drawer-column ledger-drawer-records">
                {!activeDrawer ? (
                  <p className="empty-state">Selecione uma gaveta para consultar os recebimentos.</p>
                ) : (
                  <>
                    <div className="drawer-detail-heading">
                      <div>
                        <h3>{drawerLabel(activeDrawer)}</h3>
                        <p>{recordTotal.toLocaleString("pt-BR")} recebimento(s) no recorte</p>
                      </div>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          setActiveDrawer(null);
                          setSelectedRecordId("");
                        }}
                      >
                        Fechar gaveta
                      </button>
                    </div>
                    <label className="form-field drawer-sort">
                      Ordenar por
                      <select
                        value={recordSort}
                        onChange={(event) => {
                          setRecordSort(event.target.value as PackageSort);
                          setRecordPage(1);
                          setSelectedRecordId("");
                        }}
                      >
                        <option value="recent">Mais recente (dia)</option>
                        <option value="tracking">Rastreio / entregador / loja</option>
                        <option value="sender">Entregador ou loja</option>
                      </select>
                    </label>

                    {recordsLoading ? (
                      <p className="empty-state">Carregando recebimentos...</p>
                    ) : records.length === 0 ? (
                      <p className="empty-state">Nenhum recebimento nesta gaveta.</p>
                    ) : (
                      <ul className="drawer-record-list">
                        {records.map((record) => (
                          <li key={record.id}>
                            <button
                              type="button"
                              className={[
                                "drawer-record-row",
                                selectedRecordId === record.id ? "drawer-record-selected" : "",
                              ].filter(Boolean).join(" ")}
                              aria-expanded={selectedRecordId === record.id}
                              onClick={() => selectRecord(record)}
                            >
                              <span className="drawer-record-day">
                                {new Date(record.received_at).toLocaleDateString("pt-BR")}
                              </span>
                              <strong>
                                {record.tracking_code ||
                                  record.sender ||
                                  record.delivery_person ||
                                  "Sem identificação"}
                              </strong>
                              <span className={
                                record.status === "collected"
                                  ? "ledger-status-done"
                                  : "ledger-status-pending"
                              }>
                                {record.status === "collected" ? "Retirado" : "Na portaria"}
                              </span>
                              {record.is_damaged && (
                                <span className="ledger-status-pending">Avariado</span>
                              )}
                              <ChevronRight size={16} aria-hidden="true" />
                            </button>

                            {selectedRecordId === record.id && selectedRecord && (
                              <div className="drawer-record-detail">
                                <dl>
                                  <div><dt>Destinatário</dt><dd>{selectedRecord.resident_name || "Não identificado"}</dd></div>
                                  <div><dt>Morador do apartamento</dt><dd>{selectedRecord.recipient_is_resident ? "Confirmado" : "Não confirmado"}</dd></div>
                                  <div><dt>Recebida</dt><dd>{formatDate(selectedRecord.received_at)}</dd></div>
                                  <div><dt>Porteiro</dt><dd>{porterNames.get(selectedRecord.received_by) || "Não identificado"}</dd></div>
                                  <div><dt>Entregador</dt><dd>{selectedRecord.delivery_person || "—"}</dd></div>
                                  <div><dt>Empresa</dt><dd>{selectedRecord.sender || "—"}</dd></div>
                                  <div><dt>Estado na chegada</dt><dd>{selectedRecord.is_damaged ? "Avariado" : "Sem avaria"}</dd></div>
                                  <div><dt>Rastreio</dt><dd>{selectedRecord.tracking_code || "Não informado"}</dd></div>
                                  <div><dt>Retirada</dt><dd>{formatDate(selectedRecord.collected_at)}</dd></div>
                                  <div><dt>Retirado por</dt><dd>{selectedRecord.collected_by_name || "—"}</dd></div>
                                  <div><dt>Confirmado pelo porteiro</dt><dd>{selectedRecord.collected_confirmed_by ? porterNames.get(selectedRecord.collected_confirmed_by) || "Porteiro" : "—"}</dd></div>
                                  <div><dt>Aviso ao morador</dt><dd>{selectedRecord.last_notified_at ? formatDate(selectedRecord.last_notified_at) : "Não avisado"}</dd></div>
                                </dl>
                                <PackageReceipt
                                  path={selectedRecord.receipt_path}
                                  deletedAt={selectedRecord.photo_deleted_at}
                                  isDamaged={selectedRecord.is_damaged}
                                />
                                {selectedRecord.status === "collected" && (
                                  <div className="ledger-signature">
                                    {Object.prototype.hasOwnProperty.call(
                                      signatureCache,
                                      selectedRecord.id,
                                    ) ? (
                                      signatureCache[selectedRecord.id] ? (
                                        <>
                                          <span>Assinatura do morador</span>
                                          <img
                                            src={signatureCache[selectedRecord.id] as string}
                                            alt={`Assinatura de ${selectedRecord.collected_by_name || "quem retirou a encomenda"}`}
                                          />
                                        </>
                                      ) : (
                                        <span>Assinatura não disponível.</span>
                                      )
                                    ) : (
                                      <button
                                        className="text-button"
                                        type="button"
                                        disabled={signatureLoadingId === selectedRecord.id}
                                        onClick={() => void loadSignature(selectedRecord.id)}
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
                      onChange={setRecordPage}
                      label="Páginas de recebimentos da gaveta"
                      disabled={recordsLoading}
                    />
                  </>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
