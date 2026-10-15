import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { app } from '../state/app';
import { useStore } from '../state/store';
import { activateTab, activePane, activeTab, currentLocation, listingKeyFor, listings, navigate, openTab, parentPath, setSelection, ws } from '../state/workspace';
import { call, newId } from '../api';
import { openFile } from '../actions';
import { rankCandidates, type RankedCandidate, type SwitcherCandidate, type SwitcherSource } from '../../shared/fuzzy';
import { baseName } from '../../shared/pathFormats';
import { FileIcon } from '../ui/components';
import { Icon } from '../ui/Icon';
import { keyLabel } from '../commands';

/**
 * Quick switcher — "Go to file or folder…" (Ctrl+P). Fuzzy search over
 * recent items, pinned and known places, drives, open tabs, the current
 * folder's entries and, when the search index has folders, indexed paths
 * (asked from the main process after a short pause in typing, bounded, and
 * superseded by the next request). Enter opens (folders here, files with
 * their default app), Ctrl+Enter opens in a new tab, Alt+Enter shows the
 * item in its folder. A combobox with a listbox of options, styled like the
 * command palette.
 */

const SOURCE_LABEL: Record<SwitcherSource, string> = { tab: 'Open tab', pin: 'Pinned', known: 'Place', recent: 'Recent', folder: 'This folder', index: 'Index' };
const FOLDER_LIMIT = 20000;
const INDEX_DELAY_MS = 160;

export function QuickSwitcher() {
  const open = useStore(app, (s) => s.switcherOpen);
  if (!open) return null;
  return <SwitcherBody />;
}

interface IndexReply { requestId: string; roots: number; items: Array<{ path: string; name: string; kind: 'file' | 'directory' }>; superseded?: boolean }

function localCandidates(recents: Array<{ path: string; kind: 'file' | 'directory'; lastMs: number; count: number; exists: boolean }>): SwitcherCandidate[] {
  const out: SwitcherCandidate[] = [];
  const s = app.get();
  for (const t of ws.get().tabs) {
    const pane = t.panes[t.activePane] ?? t.panes[0];
    const loc = pane ? currentLocation(pane) : undefined;
    if (loc?.kind === 'fs') out.push({ path: loc.path, name: baseName(loc.path), kind: 'directory', source: 'tab', tabId: t.id });
  }
  for (const p of s.pins) out.push({ path: p.path, name: p.label || baseName(p.path), kind: 'directory', source: 'pin' });
  for (const k of s.known) out.push({ path: k.path, name: k.label, kind: 'directory', source: 'known' });
  for (const v of s.volumes) out.push({ path: v.mountPath, name: v.label, kind: 'directory', source: 'known' });
  for (const r of recents) if (r.exists) out.push({ path: r.path, name: baseName(r.path), kind: r.kind, source: 'recent', recentMs: r.lastMs, recentCount: r.count });
  const pane = activePane();
  const l = listings.get()[listingKeyFor(activeTab().id, pane)];
  if (currentLocation(pane).kind === 'fs' && l) {
    for (const e of l.entries.slice(0, FOLDER_LIMIT)) {
      const dir = e.kind === 'directory' || (e.kind === 'symlink' && e.linkTargetKind === 'directory');
      if (e.kind === 'symlink' && e.linkTargetKind === 'broken') continue;
      out.push({ path: e.path, name: e.name, kind: dir ? 'directory' : 'file', source: 'folder' });
    }
  }
  return out;
}

function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>;
  const set = new Set(positions);
  const parts: React.ReactNode[] = [];
  let run = '';
  let hit = false;
  const flush = (k: number) => {
    if (run) parts.push(hit ? <b key={k} className="qs-hit">{run}</b> : <React.Fragment key={k}>{run}</React.Fragment>);
    run = '';
  };
  [...text].forEach((ch, i) => {
    const h = set.has(i);
    if (h !== hit) {
      flush(i);
      hit = h;
    }
    run += ch;
  });
  flush(text.length);
  return <>{parts}</>;
}

function SwitcherBody() {
  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const [idx, setIdx] = useState(0);
  const [recents, setRecents] = useState(() => app.get().recents);
  const [index, setIndex] = useState<{ query: string; items: SwitcherCandidate[]; roots?: number; searching: boolean }>({ query: '', items: [], searching: false });
  const latest = useRef<string>('');
  const prevFocus = useRef<Element | null>(document.activeElement);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void call<typeof recents>('cat:recents', { limit: 500 }).then(setRecents, () => undefined);
    void call<{ roots: Array<unknown> }>('index:status').then((st) => setIndex((x) => ({ ...x, roots: st.roots.length })), () => undefined);
    const restore = prevFocus.current as HTMLElement | null;
    return () => {
      // Supersede any index lookup still checking hits on disk.
      void call('index:quickFind', { query: '', requestId: newId('qf') }).catch(() => undefined);
      restore?.focus?.();
    };
  }, []);

  // Indexed paths: asked after a short pause in typing; a newer request supersedes the older one.
  useEffect(() => {
    const text = q.trim();
    if (!text || text.length < 2 || index.roots === 0) {
      setIndex((x) => ({ ...x, query: text, items: [], searching: false }));
      return;
    }
    setIndex((x) => ({ ...x, searching: true }));
    const t = setTimeout(() => {
      const requestId = newId('qf');
      latest.current = requestId;
      void call<IndexReply>('index:quickFind', { query: text, requestId, limit: 30 }).then((r) => {
        if (latest.current !== requestId || r.superseded) return;
        setIndex({ query: text, roots: r.roots, searching: false, items: r.items.map((i) => ({ path: i.path, name: i.name, kind: i.kind, source: 'index' as const })) });
      }, () => {
        if (latest.current === requestId) setIndex((x) => ({ ...x, searching: false }));
      });
    }, INDEX_DELAY_MS);
    return () => clearTimeout(t);
  }, [q, index.roots]);

  const local = useMemo(() => localCandidates(recents), [recents]);
  const results: RankedCandidate[] = useMemo(() => {
    const extra = index.query === query.trim() ? index.items : [];
    return rankCandidates(query, [...local, ...extra], { limit: 50 });
  }, [query, local, index]);
  useEffect(() => setIdx(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  const close = () => app.set({ switcherOpen: false });
  const go = (r: RankedCandidate | undefined, mode: 'here' | 'tab' | 'reveal') => {
    if (!r) return;
    close();
    const pane = activePane();
    const parent = parentPath(r.path);
    if (mode === 'reveal') {
      if (parent) void navigate(pane.id, { kind: 'fs', path: parent }, { select: r.path });
      return;
    }
    if (r.source === 'tab' && r.tabId && mode === 'here' && ws.get().tabs.some((t) => t.id === r.tabId)) {
      activateTab(r.tabId);
      return;
    }
    if (r.kind === 'directory') {
      if (mode === 'tab') openTab({ kind: 'fs', path: r.path });
      else void navigate(pane.id, { kind: 'fs', path: r.path });
      return;
    }
    if (mode === 'tab') {
      if (!parent) return;
      const tab = openTab({ kind: 'fs', path: parent });
      setSelection(tab.panes[0]!.id, [r.path], r.path, r.path);
      return;
    }
    void openFile(r.path);
  };

  const active = results[idx];
  const status = !q.trim()
    ? 'Recent items, open tabs, pinned places and drives. Type to search these, this folder and indexed folders.'
    : index.roots === 0
      ? 'The search index has no folders, so only recent, pinned, open and current-folder items are searched.'
      : index.searching
        ? 'Searching indexed folders…'
        : index.roots
          ? `Also searched ${index.roots} indexed folder${index.roots === 1 ? '' : 's'}.`
          : '';
  return (
    <div className="scrim palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette quick-switcher" role="dialog" aria-modal="true" aria-label="Go to file or folder">
        <div className="palette-input">
          <Icon name="search" size={15} />
          <input
            autoFocus
            value={q}
            placeholder="Go to file or folder…"
            role="combobox"
            aria-label="Go to file or folder"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="qs-list"
            aria-describedby="qs-help"
            aria-activedescendant={active ? `qs-${idx}` : undefined}
            spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); close(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(Math.min(results.length - 1, idx + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(Math.max(0, idx - 1)); }
              else if (e.key === 'PageDown') { e.preventDefault(); setIdx(Math.min(results.length - 1, idx + 8)); }
              else if (e.key === 'PageUp') { e.preventDefault(); setIdx(Math.max(0, idx - 8)); }
              else if (e.key === 'Tab') e.preventDefault();
              else if (e.key === 'Enter') {
                e.preventDefault();
                go(active, e.altKey ? 'reveal' : e.ctrlKey || e.metaKey ? 'tab' : 'here');
              }
            }}
          />
        </div>
        <div className="palette-list" id="qs-list" role="listbox" aria-label="Matching files and folders" ref={listRef}>
          {results.map((r, i) => (
            <div
              key={`${r.source}:${r.tabId ?? ''}:${r.path}`}
              id={`qs-${i}`}
              role="option"
              aria-selected={i === idx}
              className={`palette-item qs-item ${i === idx ? 'is-active' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => go(r, e.altKey ? 'reveal' : e.ctrlKey || e.metaKey ? 'tab' : 'here')}
            >
              <span className="menu-icon"><FileIcon entry={{ kind: r.kind, ext: r.kind === 'file' && r.name.includes('.') ? r.name.split('.').pop()!.toLowerCase() : '' }} size={15} /></span>
              <span className="palette-cat">{SOURCE_LABEL[r.source]}</span>
              <span className="palette-title qs-name"><Highlighted text={r.name} positions={r.positions} /></span>
              <span className="palette-reason qs-path mono" title={r.path}>{parentPath(r.path) ?? r.path}</span>
            </div>
          ))}
          {!results.length && <div className="muted pad">{q.trim() ? 'Nothing matches.' : 'No recent items, tabs or pinned places yet.'}</div>}
        </div>
        <div className="qs-foot" id="qs-help">
          <span><kbd className="kbd">Enter</kbd> open</span>
          <span><kbd className="kbd">{keyLabel('Mod+Enter')}</kbd> new tab</span>
          <span><kbd className="kbd">{keyLabel('Alt+Enter')}</kbd> show in folder</span>
          <span className="qs-note">{status}</span>
        </div>
        <div className="sr-only" role="status" aria-live="polite">{q.trim() ? `${results.length} result${results.length === 1 ? '' : 's'}` : ''}</div>
      </div>
    </div>
  );
}
