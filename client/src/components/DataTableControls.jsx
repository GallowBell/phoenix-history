export default function DataTableControls({
  search, onSearch,
  totalRows, page, totalPages, pageSize, onPage, onPageSize,
  filters = [], toggles = [], onResetFilters,
}) {
  const PAGE_SIZES = [10, 20, 50, 100];
  const anyFilter = filters.some((f) => f.value) || toggles.some((t) => t.checked);

  return (
    <div className="dt-controls">
      <div className="dt-controls-left">
        <input
          className="dt-search"
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />

        {filters.map((f) => (
          <label key={f.name} className="dt-filter">
            <span className="dt-filter-label">{f.label}</span>
            <select
              value={f.value}
              aria-label={f.label}
              onChange={(e) => f.onChange(e.target.value)}
            >
              <option value="">{f.allLabel ?? `All ${f.label.toLowerCase()}`}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} ({o.count})
                </option>
              ))}
            </select>
          </label>
        ))}

        {toggles.map((t) => (
          <label key={t.name} className="dt-toggle">
            <input
              type="checkbox"
              checked={t.checked}
              onChange={(e) => t.onChange(e.target.checked)}
            />
            {t.label}
            {t.count != null && <span className="dt-toggle-count">({t.count})</span>}
          </label>
        ))}

        {anyFilter && (
          <button type="button" className="dt-filter-clear" onClick={onResetFilters}>
            Clear filters
          </button>
        )}

        <span className="dt-count">{totalRows} rows</span>
      </div>

      <div className="dt-controls-right">
        <label className="dt-page-size">
          Show&nbsp;
          <select value={pageSize} onChange={(e) => onPageSize(e.target.value)}>
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <div className="dt-pagination">
          <button onClick={() => onPage(1)} disabled={page === 1}>«</button>
          <button onClick={() => onPage(page - 1)} disabled={page === 1}>‹</button>
          <span>{page} / {totalPages}</span>
          <button onClick={() => onPage(page + 1)} disabled={page === totalPages}>›</button>
          <button onClick={() => onPage(totalPages)} disabled={page === totalPages}>»</button>
        </div>
      </div>
    </div>
  );
}
