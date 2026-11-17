import { useState } from "react";
import { supabase } from "../lib/supabase";

type PackageReceiptProps = {
  path: string | null;
  deletedAt: string | null;
};

const receiptBucket = "package-receipts";
const signedUrlLifetimeSeconds = 120;

/**
 * Mostra a foto da etiqueta sob demanda. O bucket é privado, então a URL é
 * assinada e vale por poucos minutos.
 */
export function PackageReceipt({ path, deletedAt }: PackageReceiptProps) {
  const [signedUrl, setSignedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const receiptPath = path ?? "";

  async function handleOpen() {
    if (!receiptPath) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const { data, error } = await supabase.storage
        .from(receiptBucket)
        .createSignedUrl(receiptPath, signedUrlLifetimeSeconds);
      if (error) {
        setErrorMessage(
          `Não foi possível abrir o comprovante. ${error.message}`,
        );
        return;
      }
      setSignedUrl(data.signedUrl);
    } finally {
      setLoading(false);
    }
  }

  if (!receiptPath) return null;

  if (deletedAt) {
    return (
      <div className="ledger-receipt">
        <span>Comprovante da etiqueta</span>
        <p className="field-hint">
          A foto foi removida após o prazo de retenção de 20 dias.
        </p>
      </div>
    );
  }

  return (
    <div className="ledger-receipt">
      <span>Comprovante da etiqueta</span>
      {signedUrl ? (
        <a href={signedUrl} target="_blank" rel="noreferrer">
          <img src={signedUrl} alt="Foto da etiqueta da encomenda" />
        </a>
      ) : (
        <button
          className="text-button"
          type="button"
          onClick={() => void handleOpen()}
          disabled={loading}
        >
          {loading ? "Abrindo..." : "Ver foto da etiqueta"}
        </button>
      )}
      {errorMessage && (
        <p className="feedback-message feedback-error" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
