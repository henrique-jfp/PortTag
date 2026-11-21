import { useEffect, useState } from "react";
import {
  PackageNotebook,
  type NotebookBuilding,
} from "../components/PackageNotebook";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

type Condominium = {
  id: string;
  name: string;
  city: string;
  state: string;
  block_count: number;
  status: "active" | "inactive";
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

export function AdminNotebook() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [error, setError] = useState("");
  const [buildings, setBuildings] = useState<NotebookBuilding[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [blockOptions, setBlockOptions] = useState<BlockOption[]>([]);

  useEffect(() => {
    let active = true;

    async function load() {
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
        setError(
          `Não foi possível carregar o perfil. (${profileError.message})`,
        );
        setLoading(false);
        return;
      }

      if (!profile?.is_super_admin) {
        setLoading(false);
        return;
      }

      setIsSuperAdmin(true);

      const { data: condominiumData, error: condominiumError } = await supabase
        .from("condominiums")
        .select("*")
        .order("created_at", { ascending: false });

      if (!active) return;

      if (condominiumError) {
        setError(condominiumError.message);
        setLoading(false);
        return;
      }

      const condominiums = (condominiumData ?? []) as Condominium[];
      setBuildings(
        condominiums.map((condominium): NotebookBuilding => ({
          id: condominium.id,
          name: condominium.name,
          meta: `${condominium.city}, ${condominium.state} · ${condominium.block_count} bloco(s)${condominium.status === "inactive" ? " · inativo" : ""}`,
        })),
      );

      const ids = condominiums.map((condominium) => condominium.id);
      if (!ids.length) {
        setNotebooks([]);
        setBlockOptions([]);
        setLoading(false);
        return;
      }

      const [blocksResult, portariasResult] = await Promise.all([
        supabase
          .from("blocks")
          .select("id, condominium_id, name")
          .in("condominium_id", ids)
          .order("name"),
        supabase
          .from("portarias")
          .select("id, name, block_id, active")
          .in("condominium_id", ids)
          .eq("active", true)
          .order("name"),
      ]);

      if (!active) return;

      const blocks = (blocksResult.data ?? []) as BlockOption[];
      const portarias = (portariasResult.data ?? []) as Portaria[];
      setBlockOptions(blocksResult.error ? [] : blocks);
      setNotebooks(
        buildNotebooks(condominiums, portariasResult.error ? [] : portarias, blocks),
      );
      setLoading(false);
    }

    void load().catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Falha inesperada.");
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

  if (loading) {
    return <div className="loading-screen">Carregando caderno...</div>;
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div className="admin-page-title">
          <p className="eyebrow">Controle de Encomendas</p>
          <h1>Caderno de encomendas</h1>
          <p>Consulte e audite os registros de todos os condomínios.</p>
        </div>
      </header>

      {error ? (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      ) : null}

      {!isSuperAdmin ? (
        <section className="welcome-card">
          <h2>Esta área é exclusiva do Super Admin</h2>
          <p>
            Entre no app Síndico ou na Portaria usando o endereço entregue pelo
            responsável pelo sistema.
          </p>
        </section>
      ) : (
        <PackageNotebook
          forceBuildingList
          buildings={buildings}
          notebooks={notebooks}
          blockOptions={blockOptions.map((block) => ({
            id: block.id,
            name: block.name,
          }))}
        />
      )}
    </main>
  );
}
