import { useState, useEffect, useCallback, useMemo } from 'react';
import { Table2, LineChart, Terminal, Download, Wifi, WifiOff, PanelLeftClose, PanelLeft, Palette, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Database } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { DataTable } from './components/DataTable';
import { TimeRangePicker } from './components/TimeRangePicker';
import { ChartView } from './components/ChartView';
import { QueryConsole } from './components/QueryConsole';
import { MigrationModal } from './components/MigrationModal';
import { api } from './api';
import { TIME_RANGES } from './types';
import type {
  TableInfo,
  ImportedTableInfo,
  TableDataResponse,
  ViewMode,
  TimeRange,
} from './types';

const THEMES = [
  { id: 'slate', label: 'Default', color: '#3b82f6' },
  { id: 'light', label: 'Light', color: '#2563eb' },
  { id: 'ocean', label: 'Ocean', color: '#06b6d4' },
  { id: 'forest', label: 'Forest', color: '#22c55e' },
  { id: 'sunset', label: 'Sunset', color: '#f97316' },
] as const;

export default function App() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [importedTables, setImportedTables] = useState<ImportedTableInfo[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set());
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [timeRange, setTimeRange] = useState<TimeRange>(TIME_RANGES[6]);
  const [limit, setLimit] = useState(100);
  const [page, setPage] = useState(0);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [totalMetrics, setTotalMetrics] = useState(0);
  const [totalSeries, setTotalSeries] = useState<number | undefined>(undefined);
  const [dataError, setDataError] = useState<string | null>(null);
  const [hideZeroes, setHideZeroes] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hiddenValues, setHiddenValues] = useState<Set<string>>(new Set());
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar'>('line');
  const [yAxisAuto, setYAxisAuto] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('vmetrics-theme') || 'slate');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('vmetrics-theme', theme);
  }, [theme]);

  const checkHealth = useCallback(async () => {
    try {
      const s = await api.getStatus();
      setConnected(s.connected);
      setTotalMetrics(s.total_metrics);
      setTotalSeries(s.total_series);
    } catch {
      setConnected(false);
    }
  }, []);

  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    try {
      // Backend uses 'all' for DB/domain lookups, user's time range only for entity filtering
      const [t, imported] = await Promise.all([
        api.getTables(timeRange.start),
        api.getImportedTables(timeRange.start),
      ]);
      setTables(t);
      setImportedTables(imported);
    } catch {
      setTables([]);
      setImportedTables([]);
    } finally {
      setLoadingTables(false);
    }
  }, [timeRange]);

  useEffect(() => {
    checkHealth();
    loadTables();
  }, [checkHealth, loadTables]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
    setSourceFilter('');
  }, [selectedDomain, selectedEntities, timeRange, limit, hideZeroes, hiddenValues]);

  // Backend handles filtering + pagination
  const totalPages = tableData ? Math.ceil(tableData.total / limit) || 1 : 1;

  const availableSources: string[] = useMemo(() => {
    return tableData?.available_sources || [];
  }, [tableData]);

  useEffect(() => {
    if (!selectedDomain || selectedEntities.size === 0) return;
    let cancelled = false;
    const load = async () => {
      setLoadingData(true);
      setDataError(null);
      try {
        // Extract entity_ids and determine db from composite keys
        const entityIds: string[] = [];
        let detectedDb: string | null = null;
        for (const key of selectedEntities) {
          if (key.includes('/')) {
            // Composite key: db/domain/entityId
            const parts = key.split('/');
            if (parts.length >= 3) {
              entityIds.push(parts.slice(2).join('/'));
              if (!detectedDb) detectedDb = parts[0];
            }
          } else {
            // HA key: entityId only
            entityIds.push(key);
          }
        }
        const d = await api.getTableData(
          selectedDomain,
          entityIds,
          timeRange.start,
          timeRange.end,
          limit,
          page,
          hideZeroes,
          [...hiddenValues],
          sourceFilter || undefined,
          detectedDb || selectedDb || undefined,
        );
        if (!cancelled) {
          setTableData(d);
          if (d.rows.length > 0) {
            const unit = d.rows[0].unit_of_measurement;
            setSelectedUnit(typeof unit === 'string' && unit ? unit : null);
          } else {
            setSelectedUnit(null);
          }
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setTableData(null);
          setDataError(e instanceof Error ? e.message : 'Failed to load data');
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [selectedDomain, selectedEntities, timeRange, limit, page, hideZeroes, hiddenValues, sourceFilter, selectedDb]);

  const handleSelectMetric = (domain: string, entityId: string, multi: boolean, db?: string) => {
    setSelectedDomain(domain);
    // Use composite key to avoid collisions across DBs
    const compositeKey = db ? `${db}/${domain}/${entityId}` : entityId;
    if (multi) {
      setSelectedEntities((prev) => {
        const next = new Set(prev);
        if (next.has(compositeKey)) next.delete(compositeKey);
        else next.add(compositeKey);
        return next;
      });
    } else {
      setSelectedEntities(new Set([compositeKey]));
      setSelectedDb(db || null);
      setSelectedUnit(null);
    }
    if (window.innerWidth < 640) setSidebarOpen(false);
  };

  const toggleHiddenValue = (key: string) => {
    setHiddenValues((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2 sm:px-4 border-b" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 sm:p-1 rounded"
            style={{ color: 'var(--text-secondary)' }}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
          </button>
          <Table2 size={20} style={{ color: 'var(--accent)' }} />
          <h1 className="text-sm sm:text-base font-semibold">VictoriaMetrics UI</h1>
          <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-muted)' }}>Database Explorer</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {connected !== null && (
            <div className="flex items-center gap-1.5 text-xs">
              {connected ? (
                <>
                  <Wifi size={12} className="text-green-400" />
                  <span className="text-green-400 hidden sm:inline">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff size={12} className="text-red-400" />
                  <span className="text-red-400 hidden sm:inline">Disconnected</span>
                </>
              )}
            </div>
          )}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {totalMetrics} domains &middot; {totalSeries?.toLocaleString() ?? '?'} series
          </span>
          {/* Import Data Button */}
          <button
            onClick={() => setMigrationOpen(true)}
            className="p-1.5 rounded flex items-center gap-1 text-xs"
            style={{ color: 'var(--text-secondary)' }}
            title="Import data from InfluxDB"
          >
            <Database size={14} />
            <span className="hidden sm:inline">Import</span>
          </button>
          <TimeRangePicker
            value={timeRange}
            onChange={setTimeRange}
            limit={limit}
            onLimitChange={setLimit}
          />
          {/* Theme Selector */}
          <div className="relative">
            <button
              onClick={() => setThemeMenuOpen(!themeMenuOpen)}
              className="p-1.5 rounded flex items-center gap-1 text-xs"
              style={{ color: 'var(--text-secondary)' }}
              title="Change theme"
            >
              <Palette size={14} />
              <span className="hidden sm:inline">{THEMES.find(t => t.id === theme)?.label}</span>
            </button>
            {themeMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setThemeMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 rounded-lg shadow-xl border py-1 min-w-[120px]" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setTheme(t.id); setThemeMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left"
                      style={{ color: theme === t.id ? 'var(--accent)' : 'var(--text-secondary)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <span className="w-3 h-3 rounded-full border" style={{ backgroundColor: t.color, borderColor: 'var(--border)' }} />
                      {t.label}
                      {theme === t.id && <span className="ml-auto">&#10003;</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          tables={tables}
          importedTables={importedTables}
          selectedDomain={selectedDomain}
          selectedEntities={selectedEntities}
          selectedUnit={selectedUnit}
          onSelect={handleSelectMetric}
          loading={loadingTables}
          open={sidebarOpen}
          onRefresh={() => {
            checkHealth();
            loadTables();
          }}
        />

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* View Mode Tabs - always visible */}
          <div className="flex items-center gap-1 px-3 py-1 sm:px-4 border-b" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            {[
              { mode: 'table' as ViewMode, icon: Table2, label: 'Table' },
              { mode: 'chart' as ViewMode, icon: LineChart, label: 'Chart' },
              { mode: 'query' as ViewMode, icon: Terminal, label: 'Query' },
            ].map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="flex items-center gap-1 px-3 py-2 sm:py-1 text-xs rounded"
                style={{
                  backgroundColor: viewMode === mode ? 'var(--accent-bg-strong)' : 'transparent',
                  color: viewMode === mode ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>

          {selectedDomain && selectedEntities.size > 0 ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between px-3 py-2 sm:px-4 border-b gap-2 flex-wrap" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-xs px-2 py-0.5 rounded shrink-0" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}>{selectedDomain}</span>
                  {[...selectedEntities].map((eid) => {
                    const parts = eid.split('/');
                    const displayName = parts.length >= 3 ? parts.slice(2).join('/') : eid;
                    return (
                      <span key={eid} className="text-xs px-2 py-0.5 rounded font-mono truncate max-w-[200px]" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--accent)', border: '1px solid var(--border)' }}>
                        {displayName}
                      </span>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  {viewMode === 'table' && selectedEntities.size === 1 && (() => {
                    const rawKey = [...selectedEntities][0];
                    const parts = rawKey.split('/');
                    const entityId = parts.length >= 3 ? parts.slice(2).join('/') : rawKey;
                    return (
                    <a
                      href={api.getExportUrl(
                        selectedDomain,
                        entityId,
                        timeRange.start,
                        timeRange.end,
                        'csv',
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2.5 py-2 sm:py-1.5 text-xs border rounded"
                      style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                    >
                      <Download size={12} />
                      <span className="hidden sm:inline">CSV</span>
                    </a>
                    );
                  })()}
                </div>
              </div>

              {/* Controls bar */}
              <div className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-1.5 border-b flex-wrap" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={hideZeroes}
                    onChange={(e) => setHideZeroes(e.target.checked)}
                    className="w-4 h-4 sm:w-3 sm:h-3 rounded"
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  Hide zeroes
                </label>
                {availableSources.length > 1 && (
                  <>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>|</span>
                    <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Source:
                      <select
                        value={sourceFilter}
                        onChange={(e) => { setSourceFilter(e.target.value); setPage(0); }}
                        className="px-2 py-1 text-xs border rounded"
                        style={{
                          backgroundColor: 'var(--bg-elevated)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <option value="">All sources</option>
                        {availableSources.map((s) => (
                          <option key={s || '__ha__'} value={s || '__ha__'}>{s || 'Home Assistant'}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {hiddenValues.size > 0 && (
                  <>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>|</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Hidden:</span>
                    {[...hiddenValues].map((hv) => (
                      <button
                        key={hv}
                        onClick={() => toggleHiddenValue(hv)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border"
                        style={{ backgroundColor: 'var(--accent-bg)', borderColor: 'var(--border)', color: 'var(--accent)' }}
                      >
                        {hv}
                        <span style={{ color: 'var(--text-muted)' }}>&times;</span>
                      </button>
                    ))}
                    <button
                      onClick={() => setHiddenValues(new Set())}
                      className="px-2 py-0.5 text-xs underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      Reset all
                    </button>
                  </>
                )}
                {tableData && tableData.total > limit && (
                  <>
                    <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>|</span>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => setPage(0)}
                        disabled={page === 0}
                        className="p-1 rounded disabled:opacity-30"
                        style={{ color: 'var(--text-secondary)' }}
                        title="First page"
                      >
                        <ChevronsLeft size={14} />
                      </button>
                      <button
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="p-1 rounded disabled:opacity-30"
                        style={{ color: 'var(--text-secondary)' }}
                        title="Previous page"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span className="text-xs px-1" style={{ color: 'var(--text-secondary)' }}>
                        {page + 1} / {totalPages}
                      </span>
                      <button
                        onClick={() => setPage((p) => p + 1)}
                        disabled={page + 1 >= totalPages}
                        className="p-1 rounded disabled:opacity-30"
                        style={{ color: 'var(--text-secondary)' }}
                        title="Next page"
                      >
                        <ChevronRight size={14} />
                      </button>
                      <button
                        onClick={() => setPage(totalPages - 1)}
                        disabled={page + 1 >= totalPages}
                        className="p-1 rounded disabled:opacity-30"
                        style={{ color: 'var(--text-secondary)' }}
                        title="Last page"
                      >
                        <ChevronsRight size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                {dataError && (
                  <div className="px-4 py-2 bg-red-900/30 border-b border-red-800 text-red-300 text-sm shrink-0">
                    {dataError}
                  </div>
                )}
                {viewMode === 'table' && (
                  <DataTable data={tableData} loading={loadingData} onToggleHidden={toggleHiddenValue} />
                )}
                {viewMode === 'chart' && <ChartView data={tableData} chartType={chartType} onChartTypeChange={setChartType} yAxisAuto={yAxisAuto} onYAxisAutoChange={setYAxisAuto} />}
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {viewMode === 'query' ? (
                <QueryConsole timeRange={{ start: timeRange.start, end: timeRange.end }} />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center" style={{ color: 'var(--text-muted)' }}>
                    <Table2 size={48} className="mx-auto mb-4 opacity-30" />
                    <h2 className="text-lg font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                      VictoriaMetrics Database Explorer
                    </h2>
                    <p className="text-sm">
                      Select entities from the sidebar to view their data, or use the Query tab
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
      <MigrationModal
        open={migrationOpen}
        onClose={() => setMigrationOpen(false)}
        onComplete={() => {
          checkHealth();
          loadTables();
        }}
      />
    </div>
  );
}
