// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDataTable } from './useDataTable.js';

const sampleData = [
  { name: 'Alpha', price: '฿100.00', items: [{ sku: 'A-1' }] },
  { name: 'Beta', price: '฿1,000.00', items: [{ sku: 'B-2' }] },
  { name: 'Gamma', price: '฿50.00', items: [{ sku: 'C-3' }] },
];

describe('useDataTable', () => {
  it('returns all rows on the first page by default', () => {
    const { result } = renderHook(() => useDataTable(sampleData));

    expect(result.current.rows).toHaveLength(3);
    expect(result.current.totalRows).toBe(3);
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(1);
  });

  it('filters rows by search, including nested items arrays', () => {
    const { result } = renderHook(() => useDataTable(sampleData));

    act(() => result.current.setSearch('B-2'));

    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].name).toBe('Beta');
    expect(result.current.page).toBe(1);
  });

  it('resets to page 1 when the search term changes', () => {
    const { result } = renderHook(() => useDataTable(sampleData, { defaultPageSize: 1 }));

    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);

    act(() => result.current.setSearch('Gamma'));
    expect(result.current.page).toBe(1);
    expect(result.current.rows).toHaveLength(1);
  });

  it('sorts numerically for price-like columns', () => {
    const { result } = renderHook(() => useDataTable(sampleData));

    act(() => result.current.toggleSort('price'));

    expect(result.current.sortKey).toBe('price');
    expect(result.current.sortDir).toBe('asc');
    expect(result.current.rows.map((r) => r.name)).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('flips sort direction on a second toggle of the same key', () => {
    const { result } = renderHook(() => useDataTable(sampleData));

    act(() => result.current.toggleSort('name'));
    expect(result.current.sortDir).toBe('asc');

    act(() => result.current.toggleSort('name'));
    expect(result.current.sortDir).toBe('desc');
    expect(result.current.rows.map((r) => r.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('resets sort direction to asc when switching sort keys', () => {
    const { result } = renderHook(() => useDataTable(sampleData));

    act(() => result.current.toggleSort('name'));
    act(() => result.current.toggleSort('name'));
    expect(result.current.sortDir).toBe('desc');

    act(() => result.current.toggleSort('price'));
    expect(result.current.sortKey).toBe('price');
    expect(result.current.sortDir).toBe('asc');
  });

  it('paginates rows according to pageSize and recalculates totalPages', () => {
    const { result } = renderHook(() => useDataTable(sampleData, { defaultPageSize: 2 }));

    expect(result.current.rows).toHaveLength(2);
    expect(result.current.totalPages).toBe(2);

    act(() => result.current.setPage(2));
    expect(result.current.rows).toHaveLength(1);
  });

  it('resets to page 1 when page size changes', () => {
    const { result } = renderHook(() => useDataTable(sampleData, { defaultPageSize: 1 }));

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    act(() => result.current.setPageSize(2));
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(2);
  });
});
