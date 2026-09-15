import { useState, useEffect, useRef } from 'react';
import { X, Database, Play, Square, Check, AlertTriangle, Loader2, Download } from 'lucide-react';
import { api } from '../api';
import type { MeasurementDetail, MigrationStatusResponse } from '../types';

interface MigrationModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

type Step = 'connect' | 'select' | 'progress';

export function MigrationModal({ open, onClose, onComplete }: MigrationModalProps) {
  const [step, setStep] = useState<Step>('connect');
  const [influxUrl, setInfluxUrl] = useState(() => localStorage.getItem('vmetrics-influx-url') || 'http://a0d7b954-influxdb:8086');
  const [influxUser, setInfluxUser] = useState(() => localStorage.getItem('vmetrics-influx-user') || '');
  const [influxPass, setInfluxPass] = useState(() => localStorage.getItem('vmetrics-influx-pass') || '');
  const [rememberDetails, setRememberDetails] = useState(() => localStorage.getItem('vmetrics-influx-remember') === 'true');
  const [connecting, setConnecting] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDbs, setSelectedDbs] = useState<Set<string>>(new Set());
  const [haDbs, setHaDbs] = useState<Set<string>>(new Set(['homeassistant']));
  const [measurements, setMeasurements] = useState<MeasurementDetail[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [status, setStatus] = useState<MigrationStatusResponse | null>(null);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep('connect');
      setDatabases([]);
      setSelectedDbs(new Set());
      setMeasurements([]);
      setStatus(null);
      setError('');
      setConnecting(false);
      setInspecting(false);
    }
  }, [open]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [status?.log]);

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      const res = await api.influxConnect(influxUrl, influxUser, influxPass);
      if (res.connected) {
        // Save credentials if remember is checked
        if (rememberDetails) {
          localStorage.setItem('vmetrics-influx-url', influxUrl);
          localStorage.setItem('vmetrics-influx-user', influxUser);
          localStorage.setItem('vmetrics-influx-pass', influxPass);
          localStorage.setItem('vmetrics-influx-remember', 'true');
        } else {
          localStorage.removeItem('vmetrics-influx-url');
          localStorage.removeItem('vmetrics-influx-user');
          localStorage.removeItem('vmetrics-influx-pass');
          localStorage.removeItem('vmetrics-influx-remember');
        }
        setDatabases(res.databases);
        const initial = new Set(res.databases);
        setSelectedDbs(initial);
        setStep('select');
      } else {
        setError('Could not connect to InfluxDB. Check URL and credentials.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleInspect = async () => {
    setInspecting(true);
    setError('');
    try {
      const res = await api.influxInspect(
        influxUrl,
        influxUser,
        influxPass,
        [...selectedDbs],
      );
      setMeasurements(res.measurements);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Inspection failed');
    } finally {
      setInspecting(false);
    }
  };

  const handleStart = async () => {
    setError('');
    try {
      await api.migrationStart(
        influxUrl,
        influxUser,
        influxPass,
        [...selectedDbs],
        [...haDbs],
        5000,
      );
      setStep('progress');
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start migration');
    }
  };

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.migrationStatus();
        setStatus(s);
        if (s.state === 'completed' || s.state === 'cancelled' || s.state === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (s.state === 'completed') onComplete();
        }
      } catch {
        // ignore polling errors
      }
    }, 1000);
  };

  const handleCancel = async () => {
    try {
      await api.migrationCancel();
    } catch {
      // ignore
    }
  };

  const handleClose = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="mx-4 rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Download size={16} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Import from InfluxDB
            </h2>
            {step === 'select' && (
              <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                Step 2 of 3
              </span>
            )}
            {step === 'progress' && (
              <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                Step 3 of 3
              </span>
            )}
          </div>
          <button onClick={handleClose} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Step 1: Connect */}
          {step === 'connect' && (
            <div className="space-y-4">
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Connect to your InfluxDB v1 instance to import historical data into VictoriaMetrics.
              </p>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>InfluxDB URL</label>
                <input
                  type="text"
                  value={influxUrl}
                  onChange={(e) => setInfluxUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm border rounded"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                  placeholder="http://a0d7b954-influxdb:8086"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Username</label>
                  <input
                    type="text"
                    value={influxUser}
                    onChange={(e) => setInfluxUser(e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-primary)',
                    }}
                    placeholder="(optional)"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Password</label>
                  <input
                    type="password"
                    value={influxPass}
                    onChange={(e) => setInfluxPass(e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-primary)',
                    }}
                    placeholder="(optional)"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={rememberDetails}
                  onChange={(e) => setRememberDetails(e.target.checked)}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: 'var(--accent)' }}
                />
                Remember connection details
              </label>
              {error && (
                <div className="flex items-center gap-2 p-2 rounded text-xs" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                  <AlertTriangle size={14} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Select databases */}
          {step === 'select' && (
            <div className="space-y-4">
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Select which databases to import. Mark databases containing Home Assistant data as "HA mode" to map measurements to the `$_value` format.
              </p>

              <div className="space-y-2">
                {databases.map((db) => (
                  <div key={db} className="flex items-center gap-3 p-2 rounded" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                    <input
                      type="checkbox"
                      checked={selectedDbs.has(db)}
                      onChange={(e) => {
                        const next = new Set(selectedDbs);
                        if (e.target.checked) next.add(db);
                        else next.delete(db);
                        setSelectedDbs(next);
                      }}
                      className="rounded"
                    />
                    <Database size={14} style={{ color: 'var(--text-muted)' }} />
                    <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{db}</span>
                    {selectedDbs.has(db) && (
                      <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                        <input
                          type="checkbox"
                          checked={haDbs.has(db)}
                          onChange={(e) => {
                            const next = new Set(haDbs);
                            if (e.target.checked) next.add(db);
                            else next.delete(db);
                            setHaDbs(next);
                          }}
                          className="rounded"
                        />
                        HA mode
                      </label>
                    )}
                  </div>
                ))}
              </div>

              {selectedDbs.size > 0 && (
                <div>
                  <button
                    onClick={handleInspect}
                    disabled={inspecting}
                    className="px-3 py-1.5 text-xs rounded border disabled:opacity-50"
                    style={{
                      borderColor: 'var(--border)',
                      color: 'var(--text-secondary)',
                      backgroundColor: 'var(--bg-elevated)',
                    }}
                  >
                    {inspecting ? 'Scanning...' : 'Scan measurements'}
                  </button>
                  {measurements.length > 0 && (
                    <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Found {measurements.length} measurements with numeric fields
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-2 rounded text-xs" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                  <AlertTriangle size={14} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Progress */}
          {step === 'progress' && status && (
            <div className="space-y-4">
              {/* Status header */}
              <div className="flex items-center gap-2">
                {status.state === 'running' && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />}
                {status.state === 'completed' && <Check size={14} style={{ color: '#22c55e' }} />}
                {status.state === 'cancelled' && <AlertTriangle size={14} style={{ color: '#eab308' }} />}
                {status.state === 'error' && <AlertTriangle size={14} style={{ color: '#dc2626' }} />}
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  {status.message}
                </span>
              </div>

              {/* Progress */}
              <div>
                <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                  <span>{status.migrated_points.toLocaleString()} points migrated</span>
                  {status.total_points > 0 && (
                    <span>{Math.round((status.migrated_points / status.total_points) * 100)}%</span>
                  )}
                </div>
                {status.total_points > 0 && (
                  <div className="w-full h-2 rounded-full" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${(status.migrated_points / status.total_points) * 100}%`,
                        backgroundColor: status.state === 'completed' ? '#22c55e' : 'var(--accent)',
                      }}
                    />
                  </div>
                )}
                {status.total_points === 0 && status.state === 'running' && (
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                    <div
                      className="h-full rounded-full animate-pulse"
                      style={{ width: '100%', backgroundColor: 'var(--accent)', opacity: 0.4 }}
                    />
                  </div>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 rounded text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Speed</div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {Math.round(status.speed).toLocaleString()} pts/s
                  </div>
                </div>
                <div className="p-2 rounded text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Elapsed</div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {Math.round(status.elapsed)}s
                  </div>
                </div>
                <div className="p-2 rounded text-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>DB</div>
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {status.current_db}
                  </div>
                </div>
              </div>

              {/* Source tag */}
              {status.source_tag && (
                <div className="p-2 rounded text-xs" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                  Source tag: <code className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-body)', color: 'var(--text-secondary)' }}>{status.source_tag}</code>
                </div>
              )}

              {/* Log */}
              <div
                ref={logRef}
                className="p-2 rounded text-xs font-mono overflow-y-auto max-h-40"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
              >
                {status.log.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap">{line}</div>
                ))}
              </div>

              {/* Errors */}
              {status.errors.length > 0 && (
                <div className="p-2 rounded text-xs" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                  <strong>Errors ({status.errors.length}):</strong>
                  {status.errors.map((e, i) => (
                    <div key={i} className="mt-1">{e}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-xs rounded"
            style={{
              color: (status?.state === 'completed' || status?.state === 'cancelled' || status?.state === 'error') ? 'white' : 'var(--text-secondary)',
              backgroundColor: (status?.state === 'completed' || status?.state === 'cancelled' || status?.state === 'error') ? 'var(--accent)' : 'var(--bg-elevated)',
            }}
          >
            {step === 'progress' && status?.state === 'running' ? 'Close (runs in background)' : step === 'progress' ? 'Close' : 'Cancel'}
          </button>

          {step === 'connect' && (
            <button
              onClick={handleConnect}
              disabled={connecting || !influxUrl}
              className="px-3 py-1.5 text-xs rounded text-white flex items-center gap-1 disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {connecting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Connect
            </button>
          )}

          {step === 'select' && (
            <button
              onClick={handleStart}
              disabled={selectedDbs.size === 0}
              className="px-3 py-1.5 text-xs rounded text-white flex items-center gap-1 disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Play size={12} />
              Start Migration
            </button>
          )}

          {step === 'progress' && status?.state === 'running' && (
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-xs rounded text-white flex items-center gap-1"
              style={{ backgroundColor: '#dc2626' }}
            >
              <Square size={12} />
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
