import { useState } from "react";
import { supabase } from "../lib/supabase";

type PackageReceiptProps = {
  path: string | null;
  deletedAt: string | null;
  isDamaged?: boolean;
};

const receiptBucket = "package-receipts";
const signedUrlLifetimeSeconds = 120;

/**
 * Mostra a foto da avaria sob demanda. O bucket é privado, então a URL é
 * assinada e vale por poucos minutos. A foto da etiqueta não é armazenada.
 */
export function PackageReceipt({
  path,
  deletedAt,
  isDamaged = false,
}: PackageReceiptProps) {
  const label = isDamaged ? "Foto da avaria" : "Foto do recebimento";
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
        <span>{label}</span>
        <p className="field-hint">
          A foto foi removida após o prazo de retenção de 20 dias.
        </p>
      </div>
    );
  }

  return (
    <div className="ledger-receipt">
      <span>{label}</span>
      {signedUrl ? (
        <a href={signedUrl} target="_blank" rel="noreferrer">
          <img src={signedUrl} alt={label} />
        </a>
      ) : (
        <button
          className="text-button"
          type="button"
          onClick={() => void handleOpen()}
          disabled={loading}
        >
          {loading ? "Abrindo..." : `Ver ${label.toLowerCase()}`}
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
