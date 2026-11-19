import { useEffect } from "react";

type ConfirmationDialogProps = {
  title: string;
  description: string;
  confirmLabel?: string;
  busyLabel?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmationDialog({
  title,
  description,
  confirmLabel = "Confirmar",
  busyLabel = "Processando...",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-confirmation-title"
        aria-describedby="admin-confirmation-description"
      >
        <h2 id="admin-confirmation-title">{title}</h2>
        <p id="admin-confirmation-description">{description}</p>
        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            autoFocus
            disabled={loading}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={loading}
            onClick={() => void onConfirm()}
          >
            {loading ? busyLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
