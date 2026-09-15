export interface TableInfo {
  name: string;
  prefix: string;
  series_count: number;
  label_keys: string[];
  earliest?: string;
  latest?: string;
  unit?: string;
  db?: string;
}

export interface ImportedTableInfo {
  name: string;
  prefix: string;
  source_tag: string;
  series_count: number;
  db: string;
}

export interface TableSchema {
  name: string;
  columns: string[];
}

export interface TableDataResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  available_sources?: string[];
}

export interface QueryResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
}

export interface HealthResponse {
  status: string;
  vm_url: string;
  series_count?: number;
}

export interface StatusResponse {
  connected: boolean;
  vm_url: string;
  total_metrics: number;
  total_series?: number;
}

export type ViewMode = 'table' | 'chart' | 'query';

export interface TimeRange {
  start: string;
  end: string;
  label: string;
}

export const TIME_RANGES: TimeRange[] = [
  { start: 'now-15m', end: 'now', label: 'Last 15m' },
  { start: 'now-30m', end: 'now', label: 'Last 30m' },
  { start: 'now-1h', end: 'now', label: 'Last 1h' },
  { start: 'now-2h', end: 'now', label: 'Last 2h' },
  { start: 'now-6h', end: 'now', label: 'Last 6h' },
  { start: 'now-12h', end: 'now', label: 'Last 12h' },
  { start: 'now-24h', end: 'now', label: 'Last 1d' },
  { start: 'now-7d', end: 'now', label: 'Last 7d' },
  { start: 'now-30d', end: 'now', label: 'Last 30d' },
  { start: 'now-90d', end: 'now', label: 'Last 90d' },
  { start: 'now-180d', end: 'now', label: 'Last 180d' },
  { start: 'now-365d', end: 'now', label: 'Last 1y' },
  { start: 'now-730d', end: 'now', label: 'Last 2y' },
  { start: 'now-1825d', end: 'now', label: 'Last 5y' },
];

export interface InfluxConnectResponse {
  connected: boolean;
  databases: string[];
}

export interface MeasurementDetail {
  db: string;
  name: string;
  numeric_fields: string[];
  tag_keys: string[];
}

export interface InfluxInspectResponse {
  measurements: MeasurementDetail[];
}

export interface MigrationStatusResponse {
  state: string;
  message: string;
  total_points: number;
  migrated_points: number;
  current_db: string;
  current_measurement: string;
  current_db_index: number;
  total_dbs: number;
  current_measurement_index: number;
  total_measurements: number;
  speed: number;
  elapsed: number;
  errors: string[];
  log: string[];
  source_tag: string;
}
