import { useState, useMemo } from 'react';

/**
 * Provides search, sort, and pagination for an array of flat objects.
 * Supports nested arrays/objects (e.g. items inside order rows).
 * @param {object[]} data
 * @param {object} opts
 * @param {number} [opts.defaultPageSize=20]
 */

function containsQuery(value, q) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some((v) => containsQuery(v, q));
  if (typeof value === 'object') return Object.values(value).some((v) => containsQuery(v, q));
  return String(value).toLowerCase().includes(q);
}

export function useDataTable(data, { defaultPageSize = 20 } = {}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((row) => Object.values(row).some((v) => containsQuery(v, q)));
  }, [data, search]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      // Numeric sort for price-like values
      const an = parseFloat(String(av).replace(/[฿,]/g, ''));
      const bn = parseFloat(String(bv).replace(/[฿,]/g, ''));
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv), 'th');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  }

  function handleSearch(value) {
    setSearch(value);
    setPage(1);
  }

  function handlePageSize(value) {
    setPageSize(Number(value));
    setPage(1);
  }

  return {
    rows: paged,
    totalRows: filtered.length,
    search,
    setSearch: handleSearch,
    sortKey,
    sortDir,
    toggleSort,
    page: safePage,
    setPage,
    pageSize,
    setPageSize: handlePageSize,
    totalPages,
  };
}
