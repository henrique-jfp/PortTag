type PaginationProps = {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  label: string;
  disabled?: boolean;
};

export function Pagination({
  page,
  total,
  pageSize,
  onChange,
  label,
  disabled = false,
}: PaginationProps) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canGoBack = page > 1 && !disabled;
  const canGoForward = page < totalPages && !disabled;

  return (
    <nav className="pagination" aria-label={label}>
      <button
        className="pagination-button"
        type="button"
        disabled={!canGoBack}
        onClick={() => onChange(1)}
        aria-label="Primeira página"
      >
        «
      </button>
      <button
        className="pagination-button"
        type="button"
        disabled={!canGoBack}
        onClick={() => onChange(page - 1)}
        aria-label="Página anterior"
      >
        Anterior
      </button>
      <span className="pagination-status" aria-live="polite">
        Página {page} de {totalPages} · {total.toLocaleString("pt-BR")}{" "}
        {total === 1 ? "registro" : "registros"}
      </span>
      <button
        className="pagination-button"
        type="button"
        disabled={!canGoForward}
        onClick={() => onChange(page + 1)}
        aria-label="Próxima página"
      >
        Próxima
      </button>
      <button
        className="pagination-button"
        type="button"
        disabled={!canGoForward}
        onClick={() => onChange(totalPages)}
        aria-label="Última página"
      >
        »
      </button>
    </nav>
  );
}
