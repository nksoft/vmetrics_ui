import { useState, useMemo, useEffect } from 'react';
import { ChevronRight, ChevronDown, RefreshCw, Star, Trash2, Download, Database, X } from 'lucide-react';
import type { TableInfo, ImportedTableInfo } from '../types';
import { api } from '../api';

interface SidebarProps {
  tables: TableInfo[];
  importedTables: ImportedTableInfo[];
  selectedDomain: string | null;
  selectedEntities: Set<string>;
  selectedUnit: string | null;
  onSelect: (domain: string, entityId: string, multi: boolean, db?: string) => void;
  loading: boolean;
  open: boolean;
  onRefresh: () => void;
}

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem('vmetrics-favorites');
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveFavorites(favs: Set<string>) {
  localStorage.setItem('vmetrics-favorites', JSON.stringify([...favs]));
}

interface ConfirmDialog {
  type: 'entity' | 'domain' | 'import-batch';
  domain: string;
  entityId?: string;
  count?: number;
  sourceTag?: string;
}

export function Sidebar({ tables, importedTables, selectedDomain, selectedEntities, selectedUnit, onSelect, loading, open, onRefresh }: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [importedExpanded, setImportedExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [favExpanded, setFavExpanded] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmDialog | null>(null);
  const [deleting, setDeleting] = useState(false);

  const toggleDomain = (domain: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const toggleFavorite = (key: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveFavorites(next);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    try {
      let match: string;
      if (confirm.type === 'entity') {
        match = `{domain="${confirm.domain}", entity_id="${confirm.entityId}"}`;
      } else if (confirm.type === 'import-batch') {
        match = `{source="${confirm.sourceTag}"}`;
      } else {
        match = `{domain="${confirm.domain}"}`;
      }
      await api.deleteSeries(match);
      setConfirm(null);
      onRefresh();
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setDeleting(false);
    }
  };

  const unitMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tables) {
      if (t.unit) map.set(`${t.prefix}/${t.name}`, t.unit);
    }
    return map;
  }, [tables]);

  const grouped = useMemo(() => {
    // Group by db, then by domain
    const dbMap = new Map<string, Map<string, string[]>>();
    for (const t of tables) {
      const db = t.db || '';
      if (!dbMap.has(db)) dbMap.set(db, new Map());
      const domainMap = dbMap.get(db)!;
      if (!domainMap.has(t.prefix)) domainMap.set(t.prefix, []);
      domainMap.get(t.prefix)!.push(t.name);
    }

    const q = search.toLowerCase();
    const result: { db: string; label: string; domains: { domain: string; entities: string[] }[] }[] = [];

    for (const [db, domainMap] of dbMap) {
      const domains: { domain: string; entities: string[] }[] = [];
      for (const [domain, entities] of domainMap) {
        const sorted = entities.sort();
        let filtered = sorted;
        if (q) {
          if (domain.toLowerCase().includes(q)) {
            filtered = sorted;
          } else {
            filtered = sorted.filter((e) => e.toLowerCase().includes(q));
          }
        }
        if (filtered.length > 0) {
          domains.push({ domain, entities: filtered });
        }
      }

      if (domains.length > 0) {
        result.push({
          db,
          label: db || 'Home Assistant',
          domains: domains.sort((a, b) => a.domain.localeCompare(b.domain)),
        });
      }
    }

    // Sort: empty db (HA data) first, then alphabetical
    return result.sort((a, b) => {
      if (!a.db && b.db) return -1;
      if (a.db && !b.db) return 1;
      return a.db.localeCompare(b.db);
    });
  }, [tables, search]);

  // Auto-expand all DB headers when grouped data changes
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const { db } of grouped) {
        next.add(`db:${db}`);
      }
      return next;
    });
  }, [grouped]);

  const importedGrouped = useMemo(() => {
    // Group by source_tag, then by domain
    const batchMap = new Map<string, Map<string, string[]>>();
    for (const t of importedTables) {
      if (!batchMap.has(t.source_tag)) batchMap.set(t.source_tag, new Map());
      const domainMap = batchMap.get(t.source_tag)!;
      if (!domainMap.has(t.prefix)) domainMap.set(t.prefix, []);
      domainMap.get(t.prefix)!.push(t.name);
    }

    const q = search.toLowerCase();
    const result: { sourceTag: string; dateLabel: string; domains: { domain: string; entities: string[] }[] }[] = [];

    for (const [sourceTag, domainMap] of batchMap) {
      // Parse timestamp from tag: influxdb_YYYY_MM_DD_HH_MM_SS
      const parts = sourceTag.replace('influxdb_', '').split('_');
      const dateStr = parts.length >= 3 ? `${parts[0]}-${parts[1]}-${parts[2]}` : '';
      const timeStr = parts.length >= 6 ? `${parts[3]}:${parts[4]}:${parts[5]}` : '';
      const dateLabel = dateStr && timeStr ? `${dateStr} ${timeStr}` : sourceTag;

      const domains: { domain: string; entities: string[] }[] = [];
      for (const [domain, entities] of domainMap) {
        const sorted = entities.sort();
        let filtered = sorted;
        if (q) {
          if (domain.toLowerCase().includes(q)) {
            filtered = sorted;
          } else {
            filtered = sorted.filter((e) => e.toLowerCase().includes(q));
          }
        }
        if (filtered.length > 0) {
          domains.push({ domain, entities: filtered });
        }
      }

      if (domains.length > 0) {
        result.push({ sourceTag, dateLabel, domains: domains.sort((a, b) => a.domain.localeCompare(b.domain)) });
      }
    }

    return result.sort((a, b) => b.dateLabel.localeCompare(a.dateLabel));
  }, [importedTables, search]);

  const favoriteItems = useMemo(() => {
    const items: { key: string; domain: string; entityId: string }[] = [];
    for (const key of favorites) {
      const [domain, ...rest] = key.split('/');
      const entityId = rest.join('/');
      if (domain && entityId) items.push({ key, domain, entityId });
    }
    return items.sort((a, b) => a.entityId.localeCompare(b.entityId));
  }, [favorites]);

  // Helper to check if an entity is selected using composite keys
  const isEntitySelected = (domain: string, entityId: string, db?: string) => {
    if (selectedDomain !== domain) return false;
    const compositeKey = db ? `${db}/${domain}/${entityId}` : entityId;
    return selectedEntities.has(compositeKey);
  };

  if (!open) return null;

  return (
    <aside
      className="w-full sm:w-72 md:w-80 flex-shrink-0 flex flex-col border-r overflow-hidden"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-1 px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <input
          type="text"
          placeholder="Search entities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-2 py-1.5 text-sm border rounded"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border)',
            color: 'var(--text-primary)',
          }}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="p-1.5 rounded"
            style={{ color: 'var(--text-muted)' }}
            title="Clear search"
          >
            <X size={14} />
          </button>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1.5 rounded disabled:opacity-50"
          style={{ color: 'var(--text-secondary)' }}
          title="Refresh metrics list"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && grouped.length === 0 && favoriteItems.length === 0 ? (
          <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading metrics...
          </div>
        ) : grouped.length === 0 && favoriteItems.length === 0 && importedGrouped.length === 0 ? (
          <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {tables.length === 0 ? 'No metrics found' : 'No matches'}
          </div>
        ) : (
          <>
            {/* Favorites Section */}
            {favoriteItems.length > 0 && (
              <div>
                <button
                  onClick={() => setFavExpanded(!favExpanded)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-b hover:opacity-80"
                  style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
                >
                  {favExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Star size={12} fill="var(--accent)" />
                  <span className="font-medium">Favorites</span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{favoriteItems.length}</span>
                </button>
                {favExpanded && (
                  <div>
                    {favoriteItems.map(({ key, domain, entityId }) => {
                      const isSelected = isEntitySelected(domain, entityId);
                      return (
                        <div key={key} className="flex items-center border-b" style={{ borderColor: 'var(--border)', paddingLeft: '1.5rem' }}>
                          <button
                            onClick={(e) => onSelect(domain, entityId, e.ctrlKey || e.metaKey)}
                            className="flex-1 text-left px-2 sm:px-3 py-2 sm:py-2.5 text-xs truncate"
                            style={{
                              backgroundColor: isSelected ? 'var(--accent-bg-strong)' : 'transparent',
                              color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                            }}
                          >
                            {entityId}
                          </button>
                          <button
                            onClick={() => toggleFavorite(key)}
                            className="px-2 py-2 shrink-0"
                            style={{ color: 'var(--accent)' }}
                            title="Remove from favorites"
                          >
                            <Star size={12} fill="var(--accent)" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Domains Section */}
            {grouped.map(({ db, label, domains }) => (
              <div key={db || '__ha__'}>
                {/* DB header */}
                <div className="flex items-center border-b" style={{ borderColor: 'var(--border)' }}>
                  <button
                    onClick={() => toggleDomain(`db:${db}`)}
                    className="flex-1 flex items-center gap-2 px-3 py-2 text-left text-sm hover:opacity-80 font-medium"
                    style={{ color: 'var(--accent)' }}
                  >
                    {expanded.has(`db:${db}`) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <Database size={12} />
                    <span>{label}</span>
                    <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
                      {domains.reduce((sum, d) => sum + d.entities.length, 0)}
                    </span>
                  </button>
                </div>

                {/* Domains under this db */}
                {expanded.has(`db:${db}`) && domains.map(({ domain, entities }) => {
                  const domainKey = `${db}::${domain}`;
                  const isExpanded = expanded.has(domainKey);
                  const domainSelected = selectedDomain === domain && selectedEntities.size > 0;

                  return (
                    <div key={domain}>
                      <div className="flex items-center border-b" style={{ borderColor: 'var(--border)' }}>
                        <button
                          onClick={() => toggleDomain(domainKey)}
                          className="flex-1 flex items-center gap-2 py-2 sm:py-2.5 text-left text-sm hover:opacity-80"
                          style={{
                            paddingLeft: '1.75rem',
                            borderColor: 'var(--border)',
                            color: domainSelected ? 'var(--accent)' : 'var(--text-primary)',
                            backgroundColor: domainSelected ? 'var(--accent-bg)' : 'transparent',
                          }}
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="font-medium truncate">{domain}</span>
                          <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{entities.length}</span>
                        </button>
                        <button
                          onClick={() => setConfirm({ type: 'domain', domain, count: entities.length })}
                          className="px-2 py-2 shrink-0 hover:opacity-70"
                          style={{ color: 'var(--text-muted)' }}
                          title={`Delete all ${entities.length} entities in ${domain}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {isExpanded && (
                        <div>
                          {entities.map((entityId) => {
                            const isSelected = isEntitySelected(domain, entityId, db);
                            const isFav = favorites.has(`${domain}/${entityId}`);

                            return (
                              <div key={entityId} className="flex items-center border-b" style={{ borderColor: 'var(--border)' }}>
                                {(() => {
                                  const entityUnit = unitMap.get(`${domain}/${entityId}`);
                                  const unitMismatch = !!(selectedEntities.size > 0 && selectedUnit && entityUnit && entityUnit !== selectedUnit);
                                  const unitUnknown = !!(selectedEntities.size > 0 && selectedUnit && !entityUnit);
                                  const disabled = unitMismatch || unitUnknown;
                                  return (
                                    <input
                                      type="checkbox"
                                      checked={isSelected && !disabled}
                                      disabled={disabled}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        onSelect(domain, entityId, true, db);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-3.5 h-3.5 shrink-0 rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                                      style={{ accentColor: 'var(--accent)', marginLeft: '2.75rem' }}
                                      title={disabled ? `Unit mismatch: has ${entityUnit || 'none'}, need ${selectedUnit}` : undefined}
                                    />
                                  );
                                })()}
                                <button
                                  onClick={(e) => onSelect(domain, entityId, e.ctrlKey || e.metaKey, db)}
                                  className="flex-1 text-left px-2 sm:px-3 py-2 sm:py-2.5 text-xs truncate"
                                  style={{
                                    backgroundColor: isSelected ? 'var(--accent-bg-strong)' : 'transparent',
                                    color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                                  }}
                                >
                                  {entityId}
                                </button>
                                <button
                                  onClick={() => toggleFavorite(`${domain}/${entityId}`)}
                                  className="px-2 py-2 shrink-0"
                                  style={{ color: isFav ? 'var(--accent)' : 'var(--text-muted)' }}
                                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                                >
                                  <Star size={12} fill={isFav ? 'var(--accent)' : 'none'} />
                                </button>
                                <button
                                  onClick={() => setConfirm({ type: 'entity', domain, entityId })}
                                  className="px-2 py-2 shrink-0 hover:opacity-70"
                                  style={{ color: 'var(--text-muted)' }}
                                  title={`Delete all data for ${entityId}`}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Imported Data Section */}
            {importedGrouped.length > 0 && (
              <div>
                <button
                  onClick={() => setImportedExpanded(!importedExpanded)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-b hover:opacity-80"
                  style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
                >
                  {importedExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Database size={12} />
                  <span className="font-medium">Imported Data</span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
                    {importedGrouped.length} {importedGrouped.length === 1 ? 'batch' : 'batches'}
                  </span>
                </button>
                {importedExpanded && importedGrouped.map(({ sourceTag, dateLabel, domains }) => (
                  <div key={sourceTag}>
                    <div className="flex items-center border-b pl-6" style={{ borderColor: 'var(--border)' }}>
                      <button
                        onClick={() => toggleDomain(sourceTag)}
                        className="flex-1 flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:opacity-80"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {expanded.has(sourceTag) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <Download size={10} />
                        <span>{dateLabel}</span>
                      </button>
                      <button
                        onClick={() => setConfirm({ type: 'import-batch', domain: '', sourceTag })}
                        className="px-2 py-1.5 shrink-0 hover:opacity-70"
                        style={{ color: 'var(--text-muted)' }}
                        title={`Delete import batch ${dateLabel}`}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>

                    {expanded.has(sourceTag) && domains.map(({ domain, entities }) => (
                      <div key={`${sourceTag}-${domain}`}>
                        <div className="flex items-center border-b pl-10" style={{ borderColor: 'var(--border)' }}>
                          <button
                            onClick={() => toggleDomain(`${sourceTag}/${domain}`)}
                            className="flex-1 flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:opacity-80"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {expanded.has(`${sourceTag}/${domain}`) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            <span className="font-medium">{domain}</span>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({entities.length})</span>
                          </button>
                        </div>
                        {expanded.has(`${sourceTag}/${domain}`) && entities.map((entityId) => {
                          const isSelected = isEntitySelected(domain, entityId);
                          return (
                            <div key={entityId} className="flex items-center border-b" style={{ borderColor: 'var(--border)', paddingLeft: '2.5rem' }}>
                              {(() => {
                                const entityUnit = unitMap.get(`${domain}/${entityId}`);
                                const unitMismatch = !!(selectedEntities.size > 0 && selectedUnit && entityUnit && entityUnit !== selectedUnit);
                                const unitUnknown = !!(selectedEntities.size > 0 && selectedUnit && !entityUnit);
                                const disabled = unitMismatch || unitUnknown;
                                return (
                                    <input
                                      type="checkbox"
                                      checked={isSelected && !disabled}
                                      disabled={disabled}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        onSelect(domain, entityId, true);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="ml-8 w-3.5 h-3.5 shrink-0 rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                                      style={{ accentColor: 'var(--accent)' }}
                                      title={disabled ? `Unit mismatch: has ${entityUnit || 'none'}, need ${selectedUnit}` : undefined}
                                    />
                                );
                              })()}
                              <button
                                onClick={(e) => onSelect(domain, entityId, e.ctrlKey || e.metaKey)}
                                className="flex-1 text-left px-2 sm:px-3 py-2 text-xs truncate"
                                style={{
                                  backgroundColor: isSelected ? 'var(--accent-bg-strong)' : 'transparent',
                                  color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                                }}
                              >
                                {entityId}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Confirmation Dialog */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="mx-4 p-4 rounded-lg shadow-lg max-w-sm w-full"
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          >
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              {confirm.type === 'entity' ? 'Delete Entity Data' : confirm.type === 'import-batch' ? 'Delete Import Batch' : 'Delete Domain Data'}
            </h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
              {confirm.type === 'entity' ? (
                <>
                  Delete <strong>ALL data</strong> for <strong>{confirm.entityId}</strong>?
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>This cannot be undone.</span>
                </>
              ) : confirm.type === 'import-batch' ? (
                <>
                  Delete <strong>ALL data</strong> from import batch <strong>{confirm.sourceTag}</strong>?
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>This cannot be undone.</span>
                </>
              ) : (
                <>
                  Delete <strong>ALL data</strong> for <strong>{confirm.count} entities</strong> in <strong>{confirm.domain}</strong>?
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>This cannot be undone.</span>
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="px-3 py-1.5 text-xs rounded"
                style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-elevated)' }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-xs rounded text-white"
                style={{ backgroundColor: '#ef4444' }}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
