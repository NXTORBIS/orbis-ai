import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../api';
import { toast, toastError } from '../state/app';
import { navigate, parentPath } from '../state/workspace';
import { Icon } from '../ui/Icon';

/* -------------------------------------------------------------------------- */
/*  Enhanced Breadcrumb Navigation                                            */
/*  Clickable path segments with sibling dropdown, type-ahead filter,         */
/*  drag-to-move onto segments, copy path, and edit-as-text mode.             */
/* -------------------------------------------------------------------------- */

export interface BreadcrumbNavProps {
  path: string;
  paneId: string;
  onNavigate?: (path: string) => void;
}

interface SiblingEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

const SEP = '/';

function splitPath(p: string): string[] {
  const parts = p.split(SEP).filter(Boolean);
  // On Unix the root is "/"; on Windows it might be "C:\"
  if (p.startsWith(SEP)) return ['/', ...parts];
  return parts;
}

function buildPath(segments: string[], upTo: number): string {
  if (segments[0] === '/') {
    if (upTo === 0) return '/';
    return '/' + segments.slice(1, upTo + 1).join(SEP);
  }
  return segments.slice(0, upTo + 1).join(SEP);
}

export function BreadcrumbNav({ path: currentPath, paneId, onNavigate }: BreadcrumbNavProps) {
  const segments = useMemo(() => splitPath(currentPath), [currentPath]);
  const [dropdownIndex, setDropdownIndex] = useState<number | null>(null);
  const [siblings, setSiblings] = useState<SiblingEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentPath);
  const [loadingSiblings, setLoadingSiblings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const goTo = useCallback(
    (p: string) => {
      if (onNavigate) onNavigate(p);
      else navigate(paneId, { kind: 'fs', path: p });
    },
    [paneId, onNavigate],
  );

  // Close dropdown on outside click
  useEffect(() => {
    if (dropdownIndex === null) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownIndex(null);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownIndex]);

  // Focus filter input when dropdown opens
  useEffect(() => {
    if (dropdownIndex !== null) filterRef.current?.focus();
  }, [dropdownIndex]);

  // Load siblings when dropdown opens
  const openDropdown = useCallback(
    async (index: number) => {
      if (dropdownIndex === index) {
        setDropdownIndex(null);
        setFilter('');
        return;
      }
      setDropdownIndex(index);
      setFilter('');
      setLoadingSiblings(true);
      const parentDir = index === 0 && segments[0] === '/' ? '/' : buildPath(segments, Math.max(0, index - 1));
      try {
        const listingId = `breadcrumb-${Date.now()}`;
        const entries: SiblingEntry[] = [];
        const done = new Promise<void>((resolve, reject) => {
          const off = window.orbis.on('fs:listBatch', (payload: unknown) => {
            const p = payload as { listingId: string; entries: Array<{ name: string; path: string; kind: string }>; done: boolean };
            if (p.listingId !== listingId) return;
            for (const e of p.entries) {
              entries.push({ name: e.name, path: e.path, kind: e.kind === 'directory' ? 'directory' : 'file' });
            }
            if (p.done) {
              off();
              resolve();
            }
          });
          call('fs:listStart', { path: parentDir, showHidden: false, listingId }).catch((err) => {
            off();
            reject(err);
          });
        });
        await done;
        // Sort: directories first, then alphabetically
        entries.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        setSiblings(entries);
      } catch {
        setSiblings([]);
      } finally {
        setLoadingSiblings(false);
      }
    },
    [dropdownIndex, segments],
  );

  const filteredSiblings = useMemo(() => {
    if (!filter) return siblings;
    const lc = filter.toLowerCase();
    return siblings.filter((s) => s.name.toLowerCase().includes(lc));
  }, [siblings, filter]);

  const copyPath = useCallback(() => {
    void call('fs:copyText', { text: currentPath });
    toast({ level: 'info', title: 'Path copied to clipboard' });
  }, [currentPath]);

  const startEditing = useCallback(() => {
    setEditing(true);
    setEditValue(currentPath);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [currentPath]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== currentPath) {
      void call<{ path: string; exists: boolean; kind?: string }>('fs:resolve', { input: trimmed }).then((r) => {
        if (r.exists && r.kind === 'directory') goTo(r.path);
        else if (r.exists) goTo(parentPath(r.path) ?? r.path);
        else toastError('Path not found');
      });
    }
  }, [editValue, currentPath, goTo]);

  // Handle drag over breadcrumb segments for move
  const handleDragOver = useCallback((e: React.DragEvent, _segIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, segIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      const dest = buildPath(segments, segIndex);
      const files = Array.from(e.dataTransfer.files);
      const paths = files.map((f) => window.orbis.getPathForFile?.(f)).filter(Boolean) as string[];
      if (paths.length) {
        void call('ops:start', { type: 'move', sources: paths, destination: dest }).then(() => {
          toast({ level: 'info', title: `Moved ${paths.length} item${paths.length > 1 ? 's' : ''}` });
        }).catch(toastError);
      }
    },
    [segments],
  );

  if (editing) {
    return (
      <div className="breadcrumb-nav breadcrumb-editing">
        <input
          ref={inputRef}
          className="breadcrumb-edit-input input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <nav className="breadcrumb-nav" aria-label="Breadcrumb navigation">
      <div className="breadcrumb-segments">
        {segments.map((seg, i) => {
          const segPath = buildPath(segments, i);
          const isLast = i === segments.length - 1;
          return (
            <React.Fragment key={segPath}>
              {i > 0 && <span className="breadcrumb-sep"><Icon name="chevron-right" size={12} /></span>}
              <span className="breadcrumb-segment-wrap" ref={i === dropdownIndex ? dropdownRef : undefined}>
                <button
                  className={`breadcrumb-segment ${isLast ? 'is-current' : ''}`}
                  onClick={() => {
                    if (!isLast) goTo(segPath);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    void openDropdown(i);
                  }}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={(e) => handleDrop(e, i)}
                  title={segPath}
                >
                  {seg === '/' ? <Icon name="hard-drive" size={14} /> : seg}
                </button>
                <button
                  className="breadcrumb-chevron"
                  onClick={() => void openDropdown(i)}
                  aria-label={`Show siblings of ${seg}`}
                >
                  <Icon name="chevron-down" size={10} />
                </button>
                {dropdownIndex === i && (
                  <div className="breadcrumb-dropdown">
                    <input
                      ref={filterRef}
                      className="breadcrumb-filter input"
                      placeholder="Type to filter..."
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setDropdownIndex(null);
                          setFilter('');
                        }
                      }}
                    />
                    <div className="breadcrumb-dropdown-list">
                      {loadingSiblings && <div className="breadcrumb-loading">Loading...</div>}
                      {!loadingSiblings && filteredSiblings.length === 0 && (
                        <div className="breadcrumb-empty">No items</div>
                      )}
                      {!loadingSiblings &&
                        filteredSiblings.map((s) => (
                          <button
                            key={s.path}
                            className={`breadcrumb-sibling ${s.path === segPath || s.path === currentPath ? 'is-current' : ''}`}
                            onClick={() => {
                              goTo(s.path);
                              setDropdownIndex(null);
                              setFilter('');
                            }}
                          >
                            <Icon name={s.kind === 'directory' ? 'folder' : 'file'} size={14} />
                            <span className="ellipsis">{s.name}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </span>
            </React.Fragment>
          );
        })}
      </div>
      <div className="breadcrumb-actions">
        <button className="icon-btn" onClick={copyPath} aria-label="Copy path" data-tip="Copy path">
          <Icon name="copy" size={14} />
        </button>
        <button className="icon-btn" onClick={startEditing} aria-label="Edit path" data-tip="Edit path">
          <Icon name="edit-2" size={14} />
        </button>
      </div>
    </nav>
  );
}
