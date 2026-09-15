import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart, Line,
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine,
} from 'recharts';
import { RotateCcw, TrendingUp, BarChart3, AreaChart as AreaIcon } from 'lucide-react';
import type { TableDataResponse } from '../types';

interface ChartViewProps {
  data: TableDataResponse | null;
  chartType: 'line' | 'area' | 'bar';
  onChartTypeChange: (t: 'line' | 'area' | 'bar') => void;
  yAxisAuto: boolean;
  onYAxisAutoChange: (v: boolean) => void;
}

function formatMs(ts: unknown): string {
  if (typeof ts === 'number') {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toLocaleString();
  }
  return String(ts);
}

const CHART_TYPES = [
  { type: 'line' as const, icon: TrendingUp, label: 'Line' },
  { type: 'area' as const, icon: AreaIcon, label: 'Area' },
  { type: 'bar' as const, icon: BarChart3, label: 'Bar' },
];

function getThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue('--accent').trim() || '#3b82f6';
  const theme = document.documentElement.getAttribute('data-theme') || '';
  const palette = THEME_PALETTES[theme] || THEME_PALETTES[''];
  return {
    border: cs.getPropertyValue('--border').trim() || '#334155',
    textMuted: cs.getPropertyValue('--text-muted').trim() || '#64748b',
    bgElevated: cs.getPropertyValue('--bg-elevated').trim() || '#1e293b',
    accent,
    chartColors: palette,
  };
}

const THEME_PALETTES: Record<string, string[]> = {
  '': [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
  ],
  slate: [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
  ],
  ocean: [
    '#06b6d4', '#f472b6', '#34d399', '#fbbf24', '#a78bfa',
    '#3b82f6', '#fb7185', '#4ade80', '#facc15', '#c084fc',
  ],
  forest: [
    '#22c55e', '#f97316', '#06b6d4', '#ec4899', '#84cc16',
    '#eab308', '#14b8a6', '#f43f5e', '#8b5cf6', '#10b981',
  ],
  sunset: [
    '#f97316', '#ef4444', '#f59e0b', '#ec4899', '#a855f7',
    '#eab308', '#fb923c', '#f43f5e', '#d946ef', '#fbbf24',
  ],
  light: [
    '#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea',
    '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
  ],
};

export function ChartView({ data, chartType, onChartTypeChange, yAxisAuto, onYAxisAutoChange }: ChartViewProps) {
  const [domain, setDomain] = useState<[number | string, number | string] | null>(null);
  const refAreaLeft = useRef<string>('');
  const refAreaRight = useRef<string>('');
  const [selecting, setSelecting] = useState(false);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => obs.disconnect();
  }, []);

  const colors = useMemo(() => getThemeColors(), [themeTick]);

  const { chartData, valueColumns, unit } = useMemo(() => {
    if (!data?.rows?.length) return { chartData: [], valueColumns: [], unit: '' };

    const firstRow = data.rows[0];
    const unitVal = (firstRow?.unit_of_measurement as string) || '';
    const hasEntityId = data.columns.includes('entity_id');

    // Multi-entity: pivot data so each entity_id becomes a separate line
    if (hasEntityId) {
      const uniqueEntities = new Set(data.rows.map((r) => r.entity_id).filter(Boolean));
      if (uniqueEntities.size > 1) {
        // Group by timestamp
        const tsMap = new Map<string, Record<string, unknown>>();
        for (const row of data.rows) {
          const ts = formatMs(row.timestamp);
          const rawTs = typeof row.timestamp === 'number' ? row.timestamp : 0;
          if (!tsMap.has(ts)) {
            tsMap.set(ts, { timestamp: ts, _rawTs: rawTs });
          }
          const entry = tsMap.get(ts)!;
          const eid = String(row.entity_id || 'unknown');
          entry[eid] = typeof row.value === 'number' ? row.value : null;
        }
        const parsed = Array.from(tsMap.values());
        parsed.sort((a, b) => (a._rawTs as number) - (b._rawTs as number));
        const entityCols = [...uniqueEntities].map(String);
        return { chartData: parsed, valueColumns: entityCols, unit: unitVal };
      }
    }

    // Single entity: use numeric columns as before
    const numericCols = data.columns.filter(
      (c) => c !== 'timestamp' && data.rows.some((r) => typeof r[c] === 'number'),
    );

    const parsed = data.rows.map((row) => {
      const entry: Record<string, unknown> = {
        timestamp: formatMs(row.timestamp),
        _rawTs: typeof row.timestamp === 'number' ? row.timestamp : 0,
      };
      for (const col of numericCols) {
        entry[col] = typeof row[col] === 'number' ? row[col] : null;
      }
      return entry;
    });

    parsed.sort((a, b) => (a._rawTs as number) - (b._rawTs as number));

    return { chartData: parsed, valueColumns: numericCols, unit: unitVal };
  }, [data]);

  const handleMouseDown = useCallback((e: unknown) => {
    const label = (e as { activeLabel?: string | number })?.activeLabel;
    if (label != null) {
      refAreaLeft.current = String(label);
      setSelecting(true);
    }
  }, []);

  const handleMouseUp = useCallback((e: unknown) => {
    const label = (e as { activeLabel?: string | number })?.activeLabel;
    if (selecting && label != null && refAreaLeft.current && refAreaLeft.current !== String(label)) {
      refAreaRight.current = String(label);
      const leftIdx = chartData.findIndex((d) => d.timestamp === refAreaLeft.current);
      const rightIdx = chartData.findIndex((d) => d.timestamp === String(label));
      if (leftIdx !== -1 && rightIdx !== -1) {
        const [lo, hi] = leftIdx < rightIdx ? [leftIdx, rightIdx] : [rightIdx, leftIdx];
        const loTs = chartData[lo].timestamp;
        const hiTs = chartData[hi].timestamp;
        if (typeof loTs === 'string' || typeof loTs === 'number') {
          setDomain([loTs, hiTs as string | number]);
        }
      }
    }
    setSelecting(false);
    refAreaLeft.current = '';
    refAreaRight.current = '';
  }, [selecting, chartData]);

  const resetZoom = () => setDomain(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && e.deltaMode === 0) return;
    e.preventDefault();
    if (chartData.length < 2) return;

    const allIndices = chartData.map((_, i) => i);
    const currentLo = domain
      ? allIndices.find((i) => String(chartData[i].timestamp) === String(domain[0])) ?? 0
      : 0;
    const currentHi = domain
      ? allIndices.find((i) => String(chartData[i].timestamp) === String(domain[1])) ?? chartData.length - 1
      : chartData.length - 1;

    const range = currentHi - currentLo;
    if (range < 2) return;

    const factor = e.deltaY > 0 ? 0.2 : -0.2;
    const shrink = Math.round(range * factor);
    const newLo = currentLo + shrink;
    const newHi = currentHi - shrink;

    if (newHi - newLo < 2) return;

    const loTs = chartData[Math.max(0, newLo)].timestamp;
    const hiTs = chartData[Math.min(chartData.length - 1, newHi)].timestamp;
    if (typeof loTs === 'string' || typeof loTs === 'number') {
      setDomain([loTs, hiTs as string | number]);
    }
  }, [chartData, domain]);

  if (!data?.rows?.length) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-muted)' }}>
        No data to chart. Select an entity from the sidebar.
      </div>
    );
  }

  const grid = <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />;
  const xAxis = (
    <XAxis
      dataKey="timestamp"
      tick={{ fontSize: 10, fill: colors.textMuted }}
      angle={-30}
      textAnchor="end"
      height={50}
      domain={domain || undefined}
      allowDataOverflow
    />
  );
  const yAxis = <YAxis tick={{ fontSize: 10, fill: colors.textMuted }} domain={yAxisAuto ? ['auto', 'auto'] : [0, 'auto']} />;
  const tooltip = (
    <Tooltip
      contentStyle={{
        backgroundColor: colors.bgElevated,
        border: `1px solid ${colors.border}`,
        borderRadius: '6px',
        fontSize: '12px',
        color: 'var(--text-primary)',
      }}
      content={({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        const sorted = [...payload].sort((a, b) => {
          const aVal = typeof a.value === 'number' ? a.value : 0;
          const bVal = typeof b.value === 'number' ? b.value : 0;
          return bVal - aVal;
        });
        return (
          <div style={{
            backgroundColor: colors.bgElevated,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            padding: '8px',
            fontSize: '12px',
            color: 'var(--text-primary)',
          }}>
            <div style={{ marginBottom: 4, color: colors.textMuted }}>{label}</div>
            {sorted.map((entry, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: entry.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{entry.name}</span>
                <span style={{ fontWeight: 500 }}>
                  {typeof entry.value === 'number' ? entry.value.toLocaleString() : String(entry.value ?? '')}
                  {unit ? unit : ''}
                </span>
              </div>
            ))}
          </div>
        );
      }}
    />
  );
  const legend = (
    <Legend
      wrapperStyle={{ fontSize: 11, color: colors.textMuted }}
    />
  );

  const renderChart = () => {
    const sharedProps = { data: chartData, onMouseDown: handleMouseDown, onMouseUp: handleMouseUp };
    const showLegend = valueColumns.length > 1;

    if (chartType === 'area') {
      return (
        <AreaChart {...sharedProps}>
          {grid}{xAxis}{yAxis}{tooltip}{showLegend && legend}
          {valueColumns.map((col, i) => (
            <Area
              key={col}
              type="monotone"
              dataKey={col}
              stroke={colors.chartColors[i % colors.chartColors.length]}
              fill={colors.chartColors[i % colors.chartColors.length]}
              fillOpacity={0.15}
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          ))}
          {selecting && refAreaLeft.current && (
            <ReferenceLine x={refAreaLeft.current} stroke={colors.accent} strokeDasharray="3 3" />
          )}
        </AreaChart>
      );
    }

    if (chartType === 'bar') {
      return (
        <BarChart {...sharedProps} barSize={24} barGap={0} barCategoryGap="5%">
          {grid}{xAxis}{yAxis}{tooltip}{showLegend && legend}
          {valueColumns.map((col, i) => (
            <Bar
              key={col}
              dataKey={col}
              fill={colors.chartColors[i % colors.chartColors.length]}
              fillOpacity={0.85}
            />
          ))}
        </BarChart>
      );
    }

    return (
      <LineChart {...sharedProps}>
        {grid}{xAxis}{yAxis}{tooltip}{showLegend && legend}
        {valueColumns.map((col, i) => (
          <Line
            key={col}
            type="monotone"
            dataKey={col}
            stroke={colors.chartColors[i % colors.chartColors.length]}
            dot={false}
            strokeWidth={1.5}
            connectNulls
          />
        ))}
        {selecting && refAreaLeft.current && (
          <ReferenceLine x={refAreaLeft.current} stroke={colors.accent} strokeDasharray="3 3" />
        )}
      </LineChart>
    );
  };

  const toolbarBtn = (active: boolean) => ({
    backgroundColor: active ? 'var(--accent-bg-strong)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
  });

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Chart:</span>
        {CHART_TYPES.map(({ type, icon: Icon, label }) => (
          <button
            key={type}
            onClick={() => onChartTypeChange(type)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded"
            style={toolbarBtn(chartType === type)}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>|</span>
        <button
          onClick={() => onYAxisAutoChange(!yAxisAuto)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded"
          style={toolbarBtn(yAxisAuto)}
        >
          Y: {yAxisAuto ? 'Auto' : 'From 0'}
        </button>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>|</span>
        {domain && (
          <button
            onClick={resetZoom}
            className="flex items-center gap-1 px-2 py-1 text-xs"
            style={{ color: 'var(--accent)' }}
          >
            <RotateCcw size={12} />
            Reset zoom
          </button>
        )}
        <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
          Drag or Ctrl+Scroll to zoom
        </span>
      </div>
      <div className="flex-1 p-4 min-h-0" onWheel={handleWheel} style={{ touchAction: 'none' }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
