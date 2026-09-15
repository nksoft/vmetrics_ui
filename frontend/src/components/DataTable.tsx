import { useMemo, useState } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, EyeOff } from 'lucide-react';
import type { TableDataResponse } from '../types';

interface DataTableProps {
  data: TableDataResponse | null;
  loading: boolean;
  onToggleHidden: (key: string) => void;
}

interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}

function formatTimestamp(val: unknown): string {
  if (typeof val === 'number') {
    const ms = val > 1e12 ? val : val * 1000;
    return new Date(ms).toLocaleString();
  }
  return String(val);
}

function formatValue(val: unknown): string {
  if (typeof val === 'number') {
    return val % 1 === 0 ? val.toLocaleString() : val.toFixed(4);
  }
  return String(val);
}

function cellValue(col: string, val: unknown): string {
  if (col === 'timestamp') return formatTimestamp(val);
  if (col === 'value') return formatValue(val);
  return String(val ?? '');
}

export function DataTable({ data, loading, onToggleHidden }: DataTableProps) {
  const [sorting, setSorting] = useState<SortState>({ column: 'timestamp', direction: 'desc' });
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    if (!sorting) return data.rows;
    return [...data.rows].sort((a, b) => {
      const av = a[sorting.column];
      const bv = b[sorting.column];
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return sorting.direction === 'desc' ? -cmp : cmp;
    });
  }, [data, sorting]);

  const toggleSort = (col: string) => {
    setSorting((prev) => {
      if (prev?.column === col) {
        return { column: col, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { column: col, direction: 'asc' };
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-secondary)' }}>
        <div className="animate-spin rounded-full h-6 w-6 border-2 mr-3" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
        Loading data...
      </div>
    );
  }

  if (!data || rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-muted)' }}>
        No data to display. Select an entity from the sidebar.
      </div>
    );
  }

  const columns = data.columns;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-3 py-1.5 text-xs border-b shrink-0" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
        {rows.length} rows &middot; {columns.length} columns
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider border-b cursor-pointer select-none whitespace-nowrap"
                  style={{
                    borderColor: 'var(--border)',
                    color: 'var(--text-muted)',
                  }}
                >
                  <div className="flex items-center gap-1">
                    {col}
                    {sorting?.column === col ? (
                      sorting.direction === 'asc' ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      )
                    ) : (
                      <ArrowUpDown size={12} className="opacity-30" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b"
                style={{ borderColor: 'var(--border)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {columns.map((col) => {
                  const cellKey = String(row[col]);
                  const isHovered = hoveredCell === `${col}:${i}:${cellKey}`;
                  const canHide = col === 'value';
                  return (
                    <td
                      key={col}
                      className="px-3 py-1.5 font-mono text-xs whitespace-nowrap relative group"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={() => canHide && setHoveredCell(`${col}:${i}:${cellKey}`)}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      {cellValue(col, row[col])}
                      {canHide && isHovered && (
                        <button
                          onClick={() => onToggleHidden(cellKey)}
                          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded"
                          style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-muted)' }}
                          title={`Hide value ${row[col]}`}
                        >
                          <EyeOff size={12} />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
