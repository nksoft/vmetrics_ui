import { useState, useRef, useEffect } from 'react';
import { TIME_RANGES, type TimeRange } from '../types';
import { ChevronDown, Calendar } from 'lucide-react';

interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  limit: number;
  onLimitChange: (limit: number) => void;
}

function toLocalDateStr(ts: string): string {
  if (ts === 'now') return new Date().toISOString().slice(0, 10);
  const m = ts.match(/^now-(\d+)([smhdwy])$/);
  if (!m) return new Date().toISOString().slice(0, 10);
  const n = parseInt(m[1]);
  const unit = m[2];
  const d = new Date();
  if (unit === 's') d.setSeconds(d.getSeconds() - n);
  else if (unit === 'm') d.setMinutes(d.getMinutes() - n);
  else if (unit === 'h') d.setHours(d.getHours() - n);
  else if (unit === 'd') d.setDate(d.getDate() - n);
  else if (unit === 'w') d.setDate(d.getDate() - n * 7);
  else if (unit === 'y') d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function toNowTs(dateStr: string): string {
  const d = new Date(dateStr + 'T23:59:59');
  return `now-${Math.round((Date.now() - d.getTime()) / 86400000)}d`;
}

export function TimeRangePicker({
  value,
  onChange,
  limit,
  onLimitChange,
}: TimeRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [startDate, setStartDate] = useState(() => toLocalDateStr(value.start));
  const [endDate, setEndDate] = useState(() => toLocalDateStr(value.end));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const selectPreset = (r: TimeRange) => {
    onChange(r);
    setCustomMode(false);
    setOpen(false);
  };

  const applyCustom = () => {
    const start = toNowTs(startDate);
    onChange({ start, end: 'now', label: `${startDate} to ${endDate}` });
    setOpen(false);
  };

  const btnStyle = {
    backgroundColor: 'var(--bg-elevated)',
    borderColor: 'var(--border)',
    color: 'var(--text-primary)',
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm border rounded"
          style={btnStyle}
        >
          {value.label}
          <ChevronDown size={14} />
        </button>
        {open && (
          <div
            className="absolute top-full right-0 mt-1 z-20 border rounded shadow-lg"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
          >
            {/* Preset options */}
            <div className="py-1">
              {TIME_RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => selectPreset(r)}
                  className="w-full text-left px-3 py-1.5 text-sm"
                  style={{
                    color: value.label === r.label ? 'var(--accent)' : 'var(--text-secondary)',
                    backgroundColor: value.label === r.label ? 'var(--accent-bg)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (value.label !== r.label) e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (value.label !== r.label) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Divider */}
            <div className="border-t" style={{ borderColor: 'var(--border)' }} />

            {/* Custom range */}
            <div className="p-2">
              <button
                onClick={() => setCustomMode(!customMode)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded"
                style={{ color: customMode ? 'var(--accent)' : 'var(--text-secondary)' }}
              >
                <Calendar size={12} />
                Custom range
              </button>
              {customMode && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>From</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-2 py-1 text-xs border rounded"
                        style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>To</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-2 py-1 text-xs border rounded"
                        style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={applyCustom}
                    className="w-full px-2 py-1.5 text-xs rounded text-white"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <select
        value={limit}
        onChange={(e) => onLimitChange(Number(e.target.value))}
        className="px-2 py-2 sm:py-1.5 text-sm border rounded focus:outline-none"
        style={btnStyle}
      >
        <option value={50}>50 rows</option>
        <option value={100}>100 rows</option>
        <option value={500}>500 rows</option>
      </select>
    </div>
  );
}
