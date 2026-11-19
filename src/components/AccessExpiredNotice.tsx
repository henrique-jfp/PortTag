import { AlertTriangle } from "lucide-react";

type AccessExpiredNoticeProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Aviso único para síndico e porteiro quando o prazo do condomínio venceu ou o
 * acesso foi suspenso. A interface continua na tela inicial; qualquer ação
 * adicional mostra esta mensagem e o bloqueio real também existe no banco.
 */
export function AccessExpiredNotice({
  open,
  onClose,
}: AccessExpiredNoticeProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop access-block-backdrop">
      <section
        className="confirmation-dialog access-block-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="access-block-title"
        aria-describedby="access-block-description"
      >
        <div className="access-block-icon" aria-hidden="true">
          <AlertTriangle size={28} />
        </div>
        <h2 id="access-block-title">Acesso temporariamente bloqueado</h2>
        <p id="access-block-description">
          O prazo de uso deste condomínio venceu ou o acesso foi suspenso.
          Para voltar a registrar encomendas, consultar dados ou fazer
          cadastros, entre em contato com o suporte técnico.
        </p>
        <p className="access-block-hint">
          Somente a página inicial permanece disponível enquanto o acesso não é
          regularizado.
        </p>
        <div className="form-actions">
          <button className="primary-button" type="button" onClick={onClose}>
            Entendi
          </button>
        </div>
      </section>
    </div>
  );
}
