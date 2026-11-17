import { useEffect, useMemo, useState } from "react";
import { LogOut, Search, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { PackageReceipt } from "../components/PackageReceipt";
import { supabase } from "../lib/supabase";

type Condominium = {
  id: string;
  name: string;
};

type PackageRecord = {
  id: string;
  condominium_id: string;
  unit_number: string;
  block_name: string | null;
  resident_name: string | null;
  recipient_is_resident: boolean;
  sender: string | null;
  delivery_person: string | null;
  tracking_code: string | null;
  received_by: string;
  received_at: string;
  status: "received" | "collected";
  collected_at: string | null;
  collected_by_name: string | null;
  collected_confirmed_by: string | null;
  receipt_path: string | null;
  photo_expires_at: string;
  photo_deleted_at: string | null;
  last_notified_at: string | null;
};

type Unit = {
  unit_number: string;
  block_id: string | null;
};

type Block = {
  id: string;
  name: string;
};

const currentYear = new Date().getFullYear();

function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("pt-BR");
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

export function ManagerLedger() {
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [condominiumId, setCondominiumId] = useState("");
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [porterNames, setPorterNames] = useState<Map<string, string>>(new Map());
  const [selectedDate, setSelectedDate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [trackingFilter, setTrackingFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [porterFilter, setPorterFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pageError, setPageError] = useState("");
  // A assinatura é base64 de imagem: baixar a do ano inteiro travava o
  // caderno. Cada id é buscado uma vez, só quando o síndico pede.
  const [signatureCache, setSignatureCache] = useState<
    Record<string, string | null>
  >({});
  const [signatureLoadingId, setSignatureLoadingId] = useState("");
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
        if (error) {
          setPageError(error.message);
        } else {
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
          if (error) {
            setPageError(error.message);
          } else {
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

  useEffect(() => {
    let active = true;

    async function loadLedger() {
      if (!condominiumId) {
        setPackages([]);
        setBlocks([]);
        setUnits([]);
        setPorterNames(new Map());
        return;
      }

      setLoading(true);
      setPageError("");
      const yearStart = new Date(currentYear, 0, 1).toISOString();
      const nextYearStart = new Date(currentYear + 1, 0, 1).toISOString();
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

      const initialError =
        blocksResult.error ?? unitsResult.error ?? porterResult.error;
      if (initialError) {
        setPageError(`Não foi possível carregar o caderno. ${initialError.message}`);
        setLoading(false);
        return;
      }

      const allPackages: PackageRecord[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("packages")
          .select(
            "id, condominium_id, unit_number, block_name, resident_name, recipient_is_resident, sender, delivery_person, tracking_code, received_by, received_at, status, collected_at, collected_by_name, collected_confirmed_by, receipt_path, photo_expires_at, photo_deleted_at, last_notified_at",
          )
          .eq("condominium_id", condominiumId)
          .gte("received_at", yearStart)
          .lt("received_at", nextYearStart)
          .order("received_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (!active) return;
        if (error) {
          setPageError(`Não foi possível carregar o caderno. ${error.message}`);
          setLoading(false);
          return;
        }
        allPackages.push(...(data ?? []));
        if ((data ?? []).length < pageSize) break;
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
      setPackages(allPackages);
      setLoading(false);
    }

    void loadLedger().catch((error: unknown) => {
      if (!active) return;
      setPageError(error instanceof Error ? error.message : "Falha inesperada.");
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId]);

  const countsByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of packages) {
      const key = dateKey(item.received_at);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [packages]);

  const filteredPackages = useMemo(() => {
    const unitQuery = normalized(unitFilter);
    const trackingQuery = normalized(trackingFilter);
    const companyQuery = normalized(companyFilter);
    const porterQuery = normalized(porterFilter);

    return packages.filter((item) => {
      const day = dateKey(item.received_at);
      if (selectedDate && day !== selectedDate) return false;
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (
        unitQuery &&
        !normalized(item.unit_number).includes(unitQuery) &&
        !normalized(item.block_name).includes(unitQuery)
      ) {
        return false;
      }
      if (trackingQuery && !normalized(item.tracking_code).includes(trackingQuery)) {
        return false;
      }
      if (
        companyQuery &&
        !normalized(item.sender).includes(companyQuery) &&
        !normalized(item.delivery_person).includes(companyQuery)
      ) {
        return false;
      }
      if (
        porterQuery &&
        !normalized(porterNames.get(item.received_by)).includes(porterQuery)
      ) {
        return false;
      }
      if (statusFilter && item.status !== statusFilter) return false;
      return true;
    });
  }, [
    companyFilter,
    dateFrom,
    dateTo,
    packages,
    porterFilter,
    porterNames,
    selectedDate,
    statusFilter,
    trackingFilter,
    unitFilter,
  ]);

  const pendingCount = packages.filter((item) => item.status === "received").length;
  const collectedCount = packages.filter((item) => item.status === "collected").length;

  function clearFilters() {
    setSelectedDate("");
    setDateFrom("");
    setDateTo("");
    setUnitFilter("");
    setTrackingFilter("");
    setCompanyFilter("");
    setPorterFilter("");
    setStatusFilter("");
  }

  async function handleSignOut() {
    try {
      await signOut();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Não foi possível sair.");
    }
  }

  async function loadSignature(packageId: string) {
    if (Object.prototype.hasOwnProperty.call(signatureCache, packageId)) return;

    setSignatureLoadingId(packageId);
    setSignatureError("");
    try {
      const { data, error } = await supabase
        .from("packages")
        .select("collected_signature")
        .eq("id", packageId)
        .maybeSingle();
      if (error) {
        setSignatureError(`Não foi possível carregar a assinatura. ${error.message}`);
        return;
      }
      setSignatureCache((current) => ({
        ...current,
        [packageId]: data?.collected_signature ?? null,
      }));
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
              <span><strong>{packages.length}</strong> registros em {currentYear}</span>
              <span><strong>{pendingCount}</strong> aguardando retirada</span>
              <span><strong>{collectedCount}</strong> retirados</span>
            </div>
          </section>

          <section className="admin-section ledger-calendar-section">
            <div className="section-heading">
              <div>
                <h2>Calendário de {currentYear}</h2>
                <p>Toque em um dia para ver os recebimentos daquela data.</p>
              </div>
              {selectedDate && (
                <button className="text-button" onClick={() => setSelectedDate("")}>
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
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
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
                <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </label>
              <label className="form-field">
                Data final
                <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </label>
              <label className="form-field">
                Apartamento
                <input
                  list="ledger-units"
                  placeholder="Ex.: 901"
                  value={unitFilter}
                  onChange={(event) => setUnitFilter(event.target.value)}
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
                  value={trackingFilter}
                  onChange={(event) => setTrackingFilter(event.target.value)}
                />
              </label>
              <label className="form-field">
                Empresa ou entregador
                <input
                  value={companyFilter}
                  onChange={(event) => setCompanyFilter(event.target.value)}
                />
              </label>
              <label className="form-field">
                Porteiro
                <input
                  value={porterFilter}
                  onChange={(event) => setPorterFilter(event.target.value)}
                />
              </label>
              <label className="form-field">
                Situação
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">Todas</option>
                  <option value="received">Aguardando retirada</option>
                  <option value="collected">Retirada confirmada</option>
                </select>
              </label>
            </div>
            {selectedDate && (
              <p className="field-hint">
                Dia selecionado: {new Date(`${selectedDate}T12:00:00`).toLocaleDateString("pt-BR")}
              </p>
            )}
          </section>

          <section className="admin-section">
            <div className="section-heading">
              <div>
                <h2>Registros</h2>
                <p>{filteredPackages.length} resultado(s)</p>
              </div>
            </div>
            {loading ? (
              <p className="empty-state">Carregando registros...</p>
            ) : filteredPackages.length === 0 ? (
              <p className="empty-state">Nenhum registro corresponde aos filtros.</p>
            ) : (
              <div className="ledger-record-list">
                {filteredPackages.map((item) => (
                  <article className="ledger-record" key={item.id}>
                    <div className="ledger-record-title">
                      <strong>
                        {item.block_name ? `${item.block_name} · ` : ""}
                        {item.unit_number}
                      </strong>
                      <span className={item.status === "collected" ? "ledger-status-done" : "ledger-status-pending"}>
                        {item.status === "collected" ? "Retirada confirmada" : "Aguardando retirada"}
                      </span>
                    </div>
                    <dl>
                      <div><dt>Destinatário</dt><dd>{item.resident_name || "Não identificado"}</dd></div>
                      <div><dt>Morador do apartamento</dt><dd>{item.recipient_is_resident ? "Confirmado" : "Não confirmado"}</dd></div>
                      <div><dt>Recebida</dt><dd>{formatDate(item.received_at)}</dd></div>
                      <div><dt>Porteiro</dt><dd>{porterNames.get(item.received_by) || "Não identificado"}</dd></div>
                      <div><dt>Entregador</dt><dd>{item.delivery_person || "—"}</dd></div>
                      <div><dt>Empresa</dt><dd>{item.sender || "—"}</dd></div>
                      <div><dt>Rastreio</dt><dd>{item.tracking_code || "Não informado"}</dd></div>
                      <div><dt>Retirada</dt><dd>{formatDate(item.collected_at)}</dd></div>
                      <div><dt>Retirado por</dt><dd>{item.collected_by_name || "—"}</dd></div>
                      <div><dt>Confirmado pelo porteiro</dt><dd>{item.collected_confirmed_by ? porterNames.get(item.collected_confirmed_by) || "Porteiro" : "—"}</dd></div>
                      <div><dt>Aviso ao morador</dt><dd>{item.last_notified_at ? formatDate(item.last_notified_at) : "Não avisado"}</dd></div>
                    </dl>
                    <PackageReceipt
                      path={item.receipt_path}
                      deletedAt={item.photo_deleted_at}
                    />
                    {item.status === "collected" && (
                      <div className="ledger-signature">
                        {Object.prototype.hasOwnProperty.call(
                          signatureCache,
                          item.id,
                        ) ? (
                          signatureCache[item.id] ? (
                            <>
                              <span>Assinatura do morador</span>
                              <img
                                src={signatureCache[item.id] as string}
                                alt={`Assinatura de ${item.collected_by_name || "quem retirou a encomenda"}`}
                              />
                            </>
                          ) : (
                            <span>Assinatura não disponível.</span>
                          )
                        ) : (
                          <button
                            className="text-button"
                            type="button"
                            disabled={signatureLoadingId === item.id}
                            onClick={() => void loadSignature(item.id)}
                          >
                            {signatureLoadingId === item.id
                              ? "Carregando assinatura..."
                              : "Ver assinatura"}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
