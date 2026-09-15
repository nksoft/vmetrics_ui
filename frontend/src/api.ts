import type {
  TableInfo,
  ImportedTableInfo,
  TableSchema,
  TableDataResponse,
  QueryResponse,
  StatusResponse,
  InfluxConnectResponse,
  InfluxInspectResponse,
  MigrationStatusResponse,
} from './types';

function getUrl(path: string): string {
  const base = import.meta.env.BASE_URL || './';
  return `${base}${path.replace(/^\//, '')}`;
}

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(getUrl(path));
  if (!resp.ok) throw new Error(`GET ${path} failed: ${resp.statusText}`);
  return resp.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(getUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const err = await resp.json();
      detail = err.detail || detail;
    } catch {}
    throw new Error(`${detail}`);
  }
  return resp.json();
}

export const api = {
  getStatus: () => get<StatusResponse>('/api/status'),
  getTables: (lookback?: string) =>
    get<TableInfo[]>(`/api/tables${lookback ? `?lookback=${lookback}` : ''}`),
  getImportedTables: (lookback?: string) =>
    get<ImportedTableInfo[]>(`/api/imported-tables${lookback ? `?lookback=${lookback}` : ''}`),
  getTableSchema: (domain: string, entityId: string) =>
    post<TableSchema>('/api/schema', { metric: domain, entity_id: entityId }),
  getTableData: (
    domain: string,
    entityIds: string[],
    start: string,
    end: string,
    limit: number,
    page: number,
    hideZeroes: boolean,
    hiddenValues: string[],
    sourceFilter?: string,
    db?: string,
  ) => {
    let sf: string | undefined;
    if (sourceFilter === '__ha__') sf = '';
    else if (sourceFilter) sf = sourceFilter;
    else sf = undefined;
    return post<TableDataResponse>(
      '/api/data',
      { metric: domain, entity_ids: entityIds, start, end, limit, page, hide_zeroes: hideZeroes, hidden_values: hiddenValues, source_filter: sf, db: db || undefined },
    );
  },
  runQuery: (query: string, start: string, end: string, step?: string) =>
    post<QueryResponse>('/api/query', { query, start, end, step }),
  getExportUrl: (domain: string, entityId: string, start: string, end: string, format: string) =>
    getUrl(`/api/export?metric=${encodeURIComponent(domain)}&entity_id=${encodeURIComponent(entityId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=5000&format=${format}`),
  deleteSeries: (match: string) =>
    post<{ status: string; match: string }>('/api/delete', { match }),

  // Migration endpoints
  influxConnect: (url: string, username: string, password: string) =>
    post<InfluxConnectResponse>('/api/migration/connect', { url, username, password }),
  influxInspect: (url: string, username: string, password: string, databases: string[]) =>
    post<InfluxInspectResponse>('/api/migration/inspect', { url, username, password, databases }),
  migrationStart: (
    url: string,
    username: string,
    password: string,
    databases: string[],
    haDatabases: string[],
    batchSize: number,
  ) =>
    post<{ status: string }>('/api/migration/start', {
      url, username, password, databases, ha_databases: haDatabases, batch_size: batchSize,
    }),
  migrationStatus: () => get<MigrationStatusResponse>('/api/migration/status'),
  migrationCancel: () => post<{ status: string }>('/api/migration/cancel', {}),
};
