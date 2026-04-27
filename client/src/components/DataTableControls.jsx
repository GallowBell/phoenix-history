export default function DataTableControls({
  search, onSearch,
  totalRows, page, totalPages, pageSize, onPage, onPageSize,
}) {
  const PAGE_SIZES = [10, 20, 50, 100];

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
