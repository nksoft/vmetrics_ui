import { useState } from 'react';
import { Play } from 'lucide-react';
import type { QueryResponse } from '../types';
import { api } from '../api';

interface QueryConsoleProps {
  timeRange: { start: string; end: string };
}

export function QueryConsole({ timeRange }: QueryConsoleProps) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.runQuery(query.trim(), timeRange.start, timeRange.end);
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>MetricsQL Query</label>
        <div className="flex gap-2">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='e.g. sensor_temperature_celsius{entity_id="sensor.living_room"}'
            rows={3}
            className="flex-1 px-3 py-2 text-sm font-mono border rounded resize-none focus:outline-none"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
            }}
          />
          <button
            onClick={run}
            disabled={loading || !query.trim()}
            className="px-4 py-2 text-white rounded flex items-center gap-1.5 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Play size={14} />
            Run
          </button>
        </div>
        <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
          Ctrl+Enter to run &middot; Uses MetricsQL / PromQL syntax
        </p>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-900/30 border-b border-red-800 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-32" style={{ color: 'var(--text-secondary)' }}>
            <div className="animate-spin rounded-full h-5 w-5 border-2 mr-2" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
            Executing query...
          </div>
        )}

        {!loading && result && (
          <div>
            <div className="px-3 py-1.5 text-xs border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
              {result.total} rows &middot; {result.columns.length} columns
            </div>
            <div className="overflow-auto max-h-[calc(100vh-300px)]">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0" style={{ backgroundColor: 'var(--bg-surface)' }}>
                  <tr>
                    {result.columns.map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2 text-left text-xs font-medium uppercase border-b"
                        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b" style={{ borderColor: 'var(--border)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      {result.columns.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-1.5 font-mono text-xs"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {col === 'timestamp' && typeof row[col] === 'number'
                            ? new Date(
                                (row[col] as number) > 1e12
                                  ? (row[col] as number)
                                  : (row[col] as number) * 1000,
                              ).toLocaleString()
                            : col === 'value' && typeof row[col] === 'number'
                              ? (row[col] as number).toFixed(4)
                              : String(row[col] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && !result && !error && (
          <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-muted)' }}>
            Write a MetricsQL query and click Run to see results
          </div>
        )}
      </div>
    </div>
  );
}
