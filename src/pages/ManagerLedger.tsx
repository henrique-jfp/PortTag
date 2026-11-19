import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  ClipboardList,
  History,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Users,
  Warehouse,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { ManagerDashboard } from "../components/ManagerDashboard";
import { PackageNotebook, type NotebookBuilding } from "../components/PackageNotebook";
import { ManagerCondominiumPanel } from "../components/manager/ManagerCondominiumPanel";
import { ManagerHistoryPanel } from "../components/manager/ManagerHistoryPanel";
import { ManagerPortersPanel } from "../components/manager/ManagerPortersPanel";
import { ManagerReportsPanel } from "../components/manager/ManagerReportsPanel";
import { ManagerStructurePanel } from "../components/manager/ManagerStructurePanel";
import { supabase } from "../lib/supabase";

type Condominium = {
  id: string;
  name: string;
  city: string;
  state: string;
  block_count: number;
};

type Section =
  | "overview"
  | "condominium"
  | "structure"
  | "residents"
  | "porters"
  | "notebook"
  | "history"
  | "reports";

const sections: { id: Section; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "condominium", label: "Condomínio", icon: Building2 },
  { id: "structure", label: "Blocos e unidades", icon: Warehouse },
  { id: "residents", label: "Moradores", icon: Users },
  { id: "porters", label: "Porteiros", icon: ShieldCheck },
  { id: "notebook", label: "Encomendas", icon: ClipboardList },
  { id: "history", label: "Histórico", icon: History },
  { id: "reports", label: "Relatórios", icon: BarChart3 },
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
  const [section, setSection] = useState<Section>("overview");
  const [selectedBuildingId, setSelectedBuildingId] = useState("");
  const [pageError, setPageError] = useState("");

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
          .select("id, name, city, state, block_count")
          .eq("status", "active")
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
            .select("id, name, city, state, block_count")
            .in("id", ids)
            .eq("status", "active")
            .order("name");
          if (!active) return;
          if (error) setPageError(error.message);
          else condominiums = data ?? [];
        }
      }

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

  if (loading) {
    return <div className="loading-screen">Carregando caderno...</div>;
  }

  const activeBuildingId =
    buildings.find((building) => building.id === selectedBuildingId)?.id ??
    buildings[0]?.id ??
    "";
  const managementSection = section !== "overview" && section !== "notebook";

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

      {pageError && (
        <p className="feedback-message feedback-error" role="alert">
          {pageError}
        </p>
      )}

      {!buildings.length ? (
        <section className="welcome-card">
          <h2>Sem acesso a um condomínio</h2>
          <p>Peça ao Super Admin para vincular sua conta como síndico.</p>
        </section>
      ) : (
        <>
          <nav className="manager-navigation" aria-label="Seções do síndico">
            {sections.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={section === item.id ? "is-active" : ""}
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </nav>

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

          {section === "overview" && <ManagerDashboard buildings={buildings} />}
          {section === "notebook" && <PackageNotebook buildings={buildings} />}
          {section === "condominium" && activeBuildingId && (
            <ManagerCondominiumPanel
              key={activeBuildingId}
              condominiumId={activeBuildingId}
            />
          )}
          {section === "structure" && activeBuildingId && (
            <ManagerStructurePanel
              key={`${activeBuildingId}-structure`}
              condominiumId={activeBuildingId}
              initialTab="units"
            />
          )}
          {section === "residents" && activeBuildingId && (
            <ManagerStructurePanel
              key={`${activeBuildingId}-residents`}
              condominiumId={activeBuildingId}
              initialTab="residents"
            />
          )}
          {section === "porters" && activeBuildingId && (
            <ManagerPortersPanel
              key={activeBuildingId}
              condominiumId={activeBuildingId}
            />
          )}
          {section === "history" && activeBuildingId && (
            <ManagerHistoryPanel
              key={activeBuildingId}
              condominiumId={activeBuildingId}
            />
          )}
          {section === "reports" && activeBuildingId && (
            <ManagerReportsPanel
              key={activeBuildingId}
              condominiumId={activeBuildingId}
            />
          )}
        </>
      )}
    </main>
  );
}
