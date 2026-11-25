import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  ExternalLink,
  FileText,
  History,
  Layers,
  LayoutDashboard,
  MapPin,
  MessageCircle,
  Package,
  Shield,
  UserCheck,
  Users,
} from "lucide-react";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../contexts/AuthContext";
import { AccessExpiredNotice } from "../components/AccessExpiredNotice";
import { ManagerDashboard, type PackageFilterPreset } from "../components/ManagerDashboard";
import { PackageNotebook, type NotebookBuilding } from "../components/PackageNotebook";
import type { PackageFilters } from "../lib/packageQueries";
import { ManagerCondominiumPanel } from "../components/manager/ManagerCondominiumPanel";
import { ManagerHistoryPanel } from "../components/manager/ManagerHistoryPanel";
import { ManagerPortersPanel } from "../components/manager/ManagerPortersPanel";
import { ManagerReportsPanel } from "../components/manager/ManagerReportsPanel";
import { ManagerResidentsPanel } from "../components/manager/ManagerResidentsPanel";
import { ManagerStructurePanel } from "../components/manager/ManagerStructurePanel";
import { WhatsAppSettings } from "../components/WhatsAppSettings";
import { supabase } from "../lib/supabase";

type Condominium = {
  id: string;
  name: string;
  city: string;
  state: string;
  block_count: number;
  status: "active" | "inactive";
  access_expires_at: string | null;
  operation_mode?: "single" | "central" | "per_block" | null;
};

type Portaria = {
  id: string;
  condominium_id: string;
  name: string;
  block_id: string | null;
  active: boolean;
};

type BlockOption = { id: string; condominium_id: string; name: string };

type Notebook = { id: string; name: string; blockId: string | null };

type LedgerFilters = PackageFilters & { blockId?: string | null };

function buildNotebooks(
  condominiums: Condominium[],
  portarias: Portaria[],
  blocks: BlockOption[],
): Notebook[] {
  return condominiums.flatMap((condominium) => {
    const prefix = condominiums.length > 1 ? `${condominium.name} · ` : "";
    const rows = portarias.filter(
      (portaria) =>
        portaria.condominium_id === condominium.id && portaria.active,
    );
    if (rows.length) {
      if (condominium.operation_mode === "central") {
        return [
          {
            id: rows[0].id,
            name: `${prefix}Portaria Central`,
            blockId: null,
          },
        ];
      }
      return rows.map((portaria) => ({
        id: portaria.id,
        name: `${prefix}${portaria.name}`,
        blockId: portaria.block_id,
      }));
    }
    const condominiumBlocks = blocks.filter(
      (block) => block.condominium_id === condominium.id,
    );
    if (condominium.operation_mode === "central" || !condominiumBlocks.length) {
      return [
        {
          id: condominium.id,
          name: `${prefix}Portaria Central`,
          blockId: null,
        },
      ];
    }
    return condominiumBlocks.map((block) => ({
      id: block.id,
      name: `${prefix}${block.name}`,
      blockId: block.id,
    }));
  });
}

function isCondominiumExpired(condominium: Condominium): boolean {
  if (condominium.status !== "active") return true;
  if (!condominium.access_expires_at) return false;
  return new Date(condominium.access_expires_at).getTime() <= Date.now();
}

type Section =
  | "overview"
  | "notebook"
  | "reports"
  | "residents"
  | "porters"
  | "structure"
  | "whatsapp";

type NotebookTab = "records" | "audit";
type StructureTab = "address" | "units";

const sections: {
  id: Section;
  label: string;
  eyebrow: string;
  title: string;
  icon: typeof LayoutDashboard;
}[] = [
  {
    id: "overview",
    label: "Visão geral",
    eyebrow: "Área do Síndico · Painel",
    title: "Visão geral da portaria",
    icon: LayoutDashboard,
  },
  {
    id: "notebook",
    label: "Encomendas",
    eyebrow: "Área do Síndico · Operação",
    title: "Caderno de encomendas",
    icon: Package,
  },
  {
    id: "reports",
    label: "Relatórios",
    eyebrow: "Área do Síndico · Desempenho",
    title: "Relatórios e rankings",
    icon: BarChart3,
  },
  {
    id: "residents",
    label: "Moradores",
    eyebrow: "Área do Síndico · Cadastros",
    title: "Moradores e unidades",
    icon: Users,
  },
  {
    id: "porters",
    label: "Porteiros",
    eyebrow: "Área do Síndico · Equipe",
    title: "Contas de portaria",
    icon: UserCheck,
  },
  {
    id: "structure",
    label: "Estrutura",
    eyebrow: "Área do Síndico · Condomínio",
    title: "Estrutura e endereço",
    icon: Building2,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    eyebrow: "Área do Síndico · Notificações",
    title: "Integração WhatsApp",
    icon: MessageCircle,
  },
];

/**
 * Casca do app do Síndico. O caderno em si é o mesmo componente usado pelo
 * porteiro e pelo Super Admin; aqui só resolvemos a quem ele pertence.
 */
export function ManagerLedger() {
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [buildings, setBuildings] = useState<NotebookBuilding[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [blockOptions, setBlockOptions] = useState<BlockOption[]>([]);
  const [section, setSection] = useState<Section>("overview");
  const [notebookTab, setNotebookTab] = useState<NotebookTab>("records");
  const [notebookPreset, setNotebookPreset] = useState<PackageFilterPreset | null>(
    null,
  );
  const [structureTab, setStructureTab] = useState<StructureTab>("address");
  const [selectedBuildingId, setSelectedBuildingId] = useState("");
  const [pageError, setPageError] = useState("");
  const [expiredByBuilding, setExpiredByBuilding] = useState<
    Record<string, boolean>
  >({});
  const [supportNoticeOpen, setSupportNoticeOpen] = useState(false);

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

      let condominiums: Condominium[] = [];

      if (superAdmin) {
        const { data, error } = await supabase
          .from("condominiums")
          .select("*")
          .order("name");
        if (!active) return;
        if (error) setPageError(error.message);
        else condominiums = data ?? [];
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

        const ids = (memberships ?? []).map(
          (membership) => membership.condominium_id,
        );
        if (ids.length) {
          const { data, error } = await supabase
            .from("condominiums")
            .select("*")
            .in("id", ids)
            .order("name");
          if (!active) return;
          if (error) setPageError(error.message);
          else condominiums = data ?? [];
        }
      }

      const condominiumIds = condominiums.map((condominium) => condominium.id);
      if (condominiumIds.length) {
        const [blocksResult, portariasResult] = await Promise.all([
          supabase
            .from("blocks")
            .select("id, condominium_id, name")
            .in("condominium_id", condominiumIds)
            .order("name"),
          supabase
            .from("portarias")
            .select("id, name, block_id, active")
            .in("condominium_id", condominiumIds)
            .eq("active", true)
            .order("name"),
        ]);
        if (!active) return;
        const blocks = (blocksResult.data ?? []) as BlockOption[];
        const portarias = (portariasResult.data ?? []) as Portaria[];
        setBlockOptions(blocksResult.error ? [] : blocks);
        setNotebooks(
          buildNotebooks(
            condominiums,
            portariasResult.error ? [] : portarias,
            blocks,
          ),
        );
      } else {
        setBlockOptions([]);
        setNotebooks([]);
      }

      setExpiredByBuilding(
        Object.fromEntries(
          condominiums.map((condominium) => [
            condominium.id,
            isCondominiumExpired(condominium),
          ]),
        ),
      );
      setBuildings(
        condominiums.map((condominium) => ({
          id: condominium.id,
          name: condominium.name,
          meta: `${condominium.city}, ${condominium.state} · ${condominium.block_count} bloco(s)`,
        })),
      );
      setLoading(false);
    }

    void loadAccess().catch((error: unknown) => {
      if (!active) return;
      setPageError(
        error instanceof Error ? error.message : "Falha inesperada.",
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

  async function handleSignOut() {
    try {
      await signOut();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Não foi possível sair.",
      );
    }
  }

  const activeBuilding =
    buildings.find((building) => building.id === selectedBuildingId) ??
    buildings[0];
  const activeBuildingId = activeBuilding?.id ?? "";
  const accessBlocked =
    !isSuperAdmin && Boolean(expiredByBuilding[activeBuildingId]);

  function openSection(id: Section) {
    if (accessBlocked && id !== "overview") {
      setSupportNoticeOpen(true);
      return;
    }
    setSection(id);
    if (id === "notebook") {
      setNotebookPreset(null);
      setNotebookTab("records");
    }
  }

  if (loading) {
    return <div className="loading-screen">Carregando caderno...</div>;
  }

  const managementSection =
    section === "residents" ||
    section === "porters" ||
    section === "reports" ||
    section === "structure" ||
    section === "whatsapp" ||
    (section === "notebook" && notebookTab === "audit");

  const navigation = (
    <>
      <p className="app-shell-nav-label">Área do síndico</p>
      {sections.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? "is-active" : undefined}
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => openSection(item.id)}
          >
            <Icon size={17} />
            {item.label}
          </button>
        );
      })}
    </>
  );

  const footer = (
    <>
      {isSuperAdmin && (
        <a href="/">
          <Shield size={16} /> Super Admin
        </a>
      )}
      <a href="/porter.html">
        <ExternalLink size={16} /> Portaria
      </a>
    </>
  );

  const activeSection =
    sections.find((item) => item.id === section) ?? sections[0];
  const ActiveSectionIcon = activeSection.icon;

  return (
    <AppShell
      product="Síndico"
      navigation={navigation}
      navigationLabel="Seções do síndico"
      footer={footer}
      userEmail={user?.email}
      onSignOut={() => void handleSignOut()}
    >
      <div className="ledger-page manager-ui">
        <header className="ledger-header">
          <div className="manager-page-title">
            <span className="manager-page-icon" aria-hidden="true">
              <ActiveSectionIcon size={22} />
            </span>
            <div>
              <p className="eyebrow">{activeSection.eyebrow}</p>
              <h1>{activeSection.title}</h1>
            </div>
          </div>
          {activeBuilding ? (
            <div className="manager-building-pill" title={activeBuilding.meta}>
              <Building2 size={15} aria-hidden="true" />
              <span>{activeBuilding.name}</span>
            </div>
          ) : null}
        </header>

        {pageError && (
          <p className="feedback-message feedback-error" role="alert">
            {pageError}
          </p>
        )}

        {accessBlocked && (
          <section className="welcome-card access-blocked-card" role="status">
            <h2>Acesso bloqueado</h2>
            <p>
              O prazo de acesso do condomínio venceu ou foi suspenso. Entre em
              contato com o suporte técnico para regularizar. Enquanto isso,
              apenas esta página inicial permanece disponível.
            </p>
          </section>
        )}

        {!buildings.length ? (
          <section className="welcome-card">
            <h2>Sem acesso a um condomínio</h2>
            <p>Peça ao Super Admin para vincular sua conta como síndico.</p>
          </section>
        ) : (
          <>

          {managementSection && (
            <div className="manager-context">
              <label>
                Condomínio
                <select
                  value={activeBuildingId}
                  onChange={(event) => setSelectedBuildingId(event.target.value)}
                >
                  {buildings.map((building) => (
                    <option key={building.id} value={building.id}>
                      {building.name}
                    </option>
                  ))}
                </select>
              </label>
              <span>
                As alterações abaixo valem somente para o condomínio selecionado.
              </span>
            </div>
          )}

          {section === "overview" && !accessBlocked && (
            <ManagerDashboard
              buildings={buildings}
              onOpenPackages={(preset) => {
                if (accessBlocked) {
                  setSupportNoticeOpen(true);
                  return;
                }
                setNotebookPreset(preset);
                setNotebookTab("records");
                setSection("notebook");
              }}
            />
          )}

          {section === "notebook" && (
            <>
              <div className="manager-tabs" role="tablist" aria-label="Encomendas">
                <button
                  type="button"
                  role="tab"
                  aria-selected={notebookTab === "records"}
                  className={notebookTab === "records" ? "is-active" : ""}
                  onClick={() => setNotebookTab("records")}
                >
                  <FileText size={15} aria-hidden="true" />
                  Registros
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={notebookTab === "audit"}
                  className={notebookTab === "audit" ? "is-active" : ""}
                  onClick={() => setNotebookTab("audit")}
                >
                  <History size={15} aria-hidden="true" />
                  Linha do tempo / Auditoria
                </button>
              </div>
              {notebookTab === "records" && (
                <PackageNotebook
                  key={notebookPreset?.label ?? "all-records"}
                  buildings={buildings}
                  notebooks={notebooks}
                  blockOptions={blockOptions.map((block) => ({
                    id: block.id,
                    name: block.name,
                  }))}
                  initialFilters={
                    notebookPreset?.filters as LedgerFilters | undefined
                  }
                  presetLabel={notebookPreset?.label ?? ""}
                  onClearPreset={() => setNotebookPreset(null)}
                  allowReceiptPrint
                  hierarchicalNavigation
                />
              )}
              {notebookTab === "audit" && activeBuildingId && (
                <ManagerHistoryPanel
                  key={`${activeBuildingId}-history`}
                  condominiumId={activeBuildingId}
                />
              )}
            </>
          )}

          {section === "structure" && (
            <>
              <div className="manager-tabs" role="tablist" aria-label="Estrutura">
                <button
                  type="button"
                  role="tab"
                  aria-selected={structureTab === "address"}
                  className={structureTab === "address" ? "is-active" : ""}
                  onClick={() => setStructureTab("address")}
                >
                  <MapPin size={15} aria-hidden="true" />
                  Dados e Endereço
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={structureTab === "units"}
                  className={structureTab === "units" ? "is-active" : ""}
                  onClick={() => setStructureTab("units")}
                >
                  <Layers size={15} aria-hidden="true" />
                  Blocos e Unidades
                </button>
              </div>
              {structureTab === "address" && activeBuildingId && (
                <ManagerCondominiumPanel
                  key={`${activeBuildingId}-address`}
                  condominiumId={activeBuildingId}
                />
              )}
              {structureTab === "units" && activeBuildingId && (
                <ManagerStructurePanel
                  key={`${activeBuildingId}-units`}
                  condominiumId={activeBuildingId}
                />
              )}
            </>
          )}

          {section === "residents" && activeBuildingId && (
            <ManagerResidentsPanel
              key={`${activeBuildingId}-residents`}
              condominiumId={activeBuildingId}
            />
          )}

          {section === "porters" && activeBuildingId && (
            <ManagerPortersPanel
              key={activeBuildingId}
              condominiumId={activeBuildingId}
            />
          )}

          {section === "reports" && activeBuildingId && (
            <ManagerReportsPanel
              key={activeBuildingId}
              condominiumId={activeBuildingId}
              buildingName={activeBuilding?.name ?? ""}
            />
          )}

          {section === "whatsapp" && activeBuildingId && (
            <WhatsAppSettings
              key={`${activeBuildingId}-whatsapp`}
              condominiumId={activeBuildingId}
            />
          )}
          </>
        )}

        <AccessExpiredNotice
          open={supportNoticeOpen}
          onClose={() => setSupportNoticeOpen(false)}
        />
      </div>
    </AppShell>
  );
}
