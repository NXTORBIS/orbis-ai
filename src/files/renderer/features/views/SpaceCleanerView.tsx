import { useState, useMemo, useCallback } from 'react';
import { Icon } from '../../ui/Icon';

type TabId = 'large' | 'old' | 'temp' | 'empty' | 'duplicates';

interface CleanItem { id: string; path: string; size: number }

const TABS: { id: TabId; label: string; icon: string; hint: string }[] = [
  { id: 'large', label: 'Large Files', icon: 'file', hint: 'Files above the minimum size threshold' },
  { id: 'old', label: 'Old Files', icon: 'clock', hint: 'Files not modified within the age threshold' },
  { id: 'temp', label: 'Temp Files', icon: 'trash', hint: 'Temporary and cache files' },
  { id: 'empty', label: 'Empty Folders', icon: 'folder', hint: 'Folders that contain no files' },
  { id: 'duplicates', label: 'Duplicates', icon: 'file', hint: 'Files with identical content' },
];

const SIZE_OPTIONS = ['1MB', '10MB', '100MB', '1GB'];
const AGE_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
];

export function SpaceCleanerView() {
  const [path, setPath] = useState('');
  const [tab, setTab] = useState<TabId>('large');
  const [minSize, setMinSize] = useState('100MB');
  const [age, setAge] = useState('90');
  // No scan backend exists yet, so results are always empty until one is wired in.
  const [results] = useState<Record<TabId, CleanItem[]>>({ large: [], old: [], temp: [], empty: [], duplicates: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const trimmed = path.trim();
  const items = results[tab];
  const activeTab = TABS.find((t) => t.id === tab)!;
  const hasResults = useMemo(() => Object.values(results).some((l) => l.length > 0), [results]);
  const allItems = useMemo(() => Object.values(results).flat(), [results]);

  const selectAll = useCallback(() => setSelected(new Set(items.map((i) => i.id))), [items]);
  const deselectAll = useCallback(() => setSelected(new Set()), []);
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const scanReady = trimmed.length > 0;
  const selectedCount = allItems.filter((i) => selected.has(i.id)).length;

  return (
    <div className="tool-view scroll-y space-cleaner">
      <header className="view-header">
        <h1><Icon name="cleanup" /> Space Cleaner</h1>
      </header>

      <section className="space-cleaner-summary" aria-label="Summary">
        {['Total scanned', 'Cleanable space', 'Files found'].map((label) => (
          <div key={label} className="space-cleaner-card">
            <span className="space-cleaner-card-label">{label}</span>
            <span className="space-cleaner-card-value">--</span>
          </div>
        ))}
      </section>

      <section className="space-cleaner-scan">
        <label className="space-cleaner-label" htmlFor="space-cleaner-path">Folder to scan</label>
        <div className="space-cleaner-scan-row">
          <input
            id="space-cleaner-path"
            className="space-cleaner-input"
            type="text"
            value={path}
            placeholder="e.g. C:\Users\you\Downloads or /home/you"
            onChange={(e) => setPath(e.target.value)}
            spellCheck={false}
          />
          <button
            type="button"
            className="space-cleaner-scan-btn"
            disabled={!scanReady}
            title={scanReady ? 'Scanning is not available yet' : 'Enter a directory path first'}
          >
            <Icon name="search" /> Scan
          </button>
        </div>
      </section>

      <section className="space-cleaner-settings">
        <div className="space-cleaner-field">
          <label className="space-cleaner-label" htmlFor="space-cleaner-size">Minimum file size</label>
          <select id="space-cleaner-size" className="space-cleaner-select" value={minSize} onChange={(e) => setMinSize(e.target.value)}>
            {SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-cleaner-field">
          <label className="space-cleaner-label" htmlFor="space-cleaner-age">Old file age</label>
          <select id="space-cleaner-age" className="space-cleaner-select" value={age} onChange={(e) => setAge(e.target.value)}>
            {AGE_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
      </section>

      <div className="space-cleaner-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`space-cleaner-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} /> {t.label}
          </button>
        ))}
      </div>

      <div className="space-cleaner-toolbar">
        <button type="button" className="space-cleaner-btn" onClick={selectAll} disabled={items.length === 0}>
          <Icon name="check" /> Select All
        </button>
        <button type="button" className="space-cleaner-btn" onClick={deselectAll} disabled={selected.size === 0}>
          <Icon name="x" /> Deselect All
        </button>
        <span className="space-cleaner-count">{hasResults ? `${selectedCount} selected` : ''}</span>
        <button type="button" className="space-cleaner-btn space-cleaner-clean-btn" disabled={selectedCount === 0}>
          <Icon name="trash" /> Clean Selected
        </button>
      </div>

      <div className="space-cleaner-list" role="tabpanel" aria-label={activeTab.label}>
        {items.length === 0 ? (
          <div className="space-cleaner-empty">
            <Icon name={scanReady ? 'warning' : 'drive'} />
            <p className="space-cleaner-empty-title">
              {scanReady ? 'Scan required' : 'Enter a directory path and click Scan to analyze'}
            </p>
            <p className="space-cleaner-empty-hint">
              {activeTab.hint}. {scanReady ? 'Scanning is not available yet, so no results can be shown.' : 'Results will appear here after a scan.'}
            </p>
          </div>
        ) : (
          <ul className="space-cleaner-items">
            {items.map((i) => (
              <li key={i.id} className="space-cleaner-item">
                <label>
                  <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                  <span className="space-cleaner-item-path">{i.path}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
