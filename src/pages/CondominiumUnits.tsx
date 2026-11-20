import { useEffect, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { CondominiumOperators } from "./CondominiumOperators";
import { CondominiumUnitsManager } from "../components/CondominiumUnitsManager";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

type Condominium = {
  id: string;
  name: string;
  block_count: number;
};

export function CondominiumUnits() {
  const { condominiumId } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [condominium, setCondominium] = useState<Condominium | null>(null);
  const [loadError, setLoadError] = useState("");
  const [managementTab, setManagementTab] = useState<"units" | "team">("units");

  useEffect(() => {
    let active = true;

    async function loadPage() {
      if (!user || !condominiumId) {
        setLoadError("Condomínio não informado.");
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
        setLoadError(`Não foi possível verificar as permissões. ${profileError.message}`);
        setLoading(false);
        return;
      }

      if (!profile?.is_super_admin) {
        setLoading(false);
        return;
      }

      setIsSuperAdmin(true);

      const { data, error } = await supabase
        .from("condominiums")
        .select("id, name, block_count")
        .eq("id", condominiumId)
        .maybeSingle();

      if (!active) return;
      if (error) {
        setLoadError(`Não foi possível carregar o condomínio. ${error.message}`);
      } else if (!data) {
        setLoadError("Condomínio não encontrado.");
      } else {
        setCondominium(data);
      }
      setLoading(false);
    }

    void loadPage().catch((error: unknown) => {
      if (!active) return;
      const message =
        error instanceof Error ? error.message : "Falha inesperada.";
      setLoadError(`Não foi possível carregar o condomínio. ${message}`);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId, user]);

  function handleTabsKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();

    const next =
      event.key === "ArrowLeft" || event.key === "Home"
        ? "units"
        : "team";
    setManagementTab(next);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next === "units" ? 0 : 1]?.focus();
  }

  if (loading) {
    return <div className="loading-screen">Carregando unidades...</div>;
  }

  if (loadError) {
    return (
      <main className="dashboard">
        <p className="feedback-message feedback-error" role="alert">
          {loadError}
        </p>
        <Link className="text-button" to="/">
          Voltar aos condomínios
        </Link>
      </main>
    );
  }

  if (!isSuperAdmin || !condominium) {
    return (
      <main className="dashboard">
        <section className="welcome-card">
          <h1>Acesso restrito</h1>
          <p>Somente o Super Admin pode gerenciar estas unidades.</p>
          <Link className="text-button" to="/">
            Voltar aos condomínios
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Controle de Encomendas</p>
          <h1>{condominium.name}</h1>
          <p>Gerencie blocos, unidades e moradores deste condomínio.</p>
        </div>
        <Link className="text-button" to="/">
          Voltar aos condomínios
        </Link>
      </header>

      <nav
        className="admin-tabs"
        role="tablist"
        aria-label="Gerenciamento do condomínio"
        onKeyDown={handleTabsKeyDown}
      >
        <button
          className="admin-tab"
          id="admin-tab-units"
          role="tab"
          type="button"
          aria-selected={managementTab === "units"}
          aria-controls="admin-panel-units"
          onClick={() => setManagementTab("units")}
        >
          Blocos e unidades
        </button>
        <button
          className="admin-tab"
          id="admin-tab-team"
          role="tab"
          type="button"
          aria-selected={managementTab === "team"}
          aria-controls="admin-panel-team"
          onClick={() => setManagementTab("team")}
        >
          Equipe
        </button>
      </nav>

      <div
        className="admin-tab-panel"
        id={managementTab === "units" ? "admin-panel-units" : "admin-panel-team"}
        role="tabpanel"
        aria-labelledby={managementTab === "units" ? "admin-tab-units" : "admin-tab-team"}
      >
        {managementTab === "team" ? (
          <CondominiumOperators condominiumId={condominium.id} />
        ) : (
          <CondominiumUnitsManager
            key={condominium.id}
            condominiumId={condominium.id}
            blockCount={condominium.block_count}
          />
        )}
      </div>
    </main>
  );
}
