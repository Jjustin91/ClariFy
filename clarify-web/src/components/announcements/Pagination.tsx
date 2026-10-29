function pageList(current: number, last: number): (number | '...')[] {
  const set = new Set([1, last, current - 1, current, current + 1].filter((p) => p >= 1 && p <= last));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '...')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('...');
    out.push(p);
  });
  return out;
}

interface PaginationProps {
  currentPage: number;
  lastPage: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, lastPage, onPageChange }: PaginationProps) {
  if (lastPage <= 1) return null;
  const btn = 'rounded px-3 py-1 text-sm font-semibold disabled:opacity-40';
  return (
    <nav className="mt-6 flex items-center justify-center gap-1" aria-label="Pagination">
      <button type="button" className={`${btn} text-ustp-navy`} disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>
        &laquo;
      </button>
      {pageList(currentPage, lastPage).map((p, i) =>
        p === '...' ? (
          <span key={`gap-${i}`} className="px-2 text-ustp-text/60">...</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={`${btn} ${p === currentPage ? 'bg-ustp-navy text-white' : 'text-ustp-navy'}`}
          >
            {p}
          </button>
        )
      )}
      <button type="button" className={`${btn} text-ustp-navy`} disabled={currentPage === lastPage} onClick={() => onPageChange(currentPage + 1)}>
        &raquo;
      </button>
    </nav>
  );
}