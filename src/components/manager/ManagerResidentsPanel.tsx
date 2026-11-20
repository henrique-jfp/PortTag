import { useEffect, useState } from "react";
import { CondominiumUnitsManager } from "../CondominiumUnitsManager";
import { supabase } from "../../lib/supabase";

/**
 * A página "Moradores" do Síndico usa exatamente o mesmo gerenciador de
 * blocos, unidades e contatos do Super Admin: cadastro avulso, geração em lote,
 * importação CSV/XLSX e contatos por unidade.
 */
export function ManagerResidentsPanel({
  condominiumId,
}: {
  condominiumId: string;
}) {
  const [blockCount, setBlockCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      const { data, error: loadError } = await supabase
        .from("condominiums")
        .select("block_count")
        .eq("id", condominiumId)
        .maybeSingle();

      if (!active) return;
      if (loadError) {
        setError(`Não foi possível carregar os blocos. ${loadError.message}`);
      } else {
        setBlockCount(data?.block_count ?? 0);
        setError("");
      }
      setLoading(false);
    })().catch((cause: unknown) => {
      if (!active) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar os blocos.",
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [condominiumId]);

  return (
    <section className="manager-panel">
      <div className="manager-panel-heading">
        <div>
          <p className="eyebrow">Cadastro</p>
          <h2>Moradores</h2>
          <p>
            Cadastre blocos, apartamentos e moradores por unidade, em lote ou
            importando uma planilha CSV/XLSX — como no painel do Super Admin.
          </p>
        </div>
      </div>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="manager-empty">Carregando unidades...</p>
      ) : (
        <div className="dashboard units-manager">
          <CondominiumUnitsManager
            key={condominiumId}
            condominiumId={condominiumId}
            blockCount={blockCount}
          />
        </div>
      )}
    </section>
  );
}
