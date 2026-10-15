// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { useState, useCallback, useEffect, useRef } from 'react';
import { Icon } from '../../ui/Icon';

// Types
interface UniverseEntry {
  path: string;
  name: string;
  kind: string;
  size: number;
  depth: number;
  category: string;
  ext: string;
  mtime_ms?: number;
}

interface ScanProgress {
  scanId: string;
  scanned: number;
  totalBytes: number;
  currentPath: string;
  state: string;
}

interface CategoryStat {
  category: string;
  count: number;
  totalSize: number;
}

type Lens = 'structure' | 'space' | 'type' | 'time' | 'connection' | 'change';
type Layout = 'treemap' | 'sunburst' | 'force' | 'grid';

const LENS_INFO: Record<Lens, { label: string; icon: string; description: string }> = {
  structure: { label: 'Structure', icon: 'folder', description: 'Directory hierarchy' },
  space: { label: 'Space', icon: 'storage', description: 'Size distribution' },
  type: { label: 'Type', icon: 'tag', description: 'File type grouping' },
  time: { label: 'Time', icon: 'clock', description: 'Modification timeline' },
  connection: { label: 'Connection', icon: 'link', description: 'File relationships' },
  change: { label: 'Change', icon: 'activity', description: 'Recent modifications' },
};

const CATEGORY_COLORS: Record<string, string> = {
  document: '#4a90d9', image: '#e57373', video: '#ff8a65', audio: '#ba68c8',
  code: '#81c784', archive: '#ffb74d', data: '#90a4ae', directory: '#78909c', other: '#a1887f',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function UniverseExplorerView() {
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [lens, setLens] = useState<Lens>('structure');
  const [layout, setLayout] = useState<Layout>('treemap');
  const [entries, setEntries] = useState<UniverseEntry[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [selected, setSelected] = useState<UniverseEntry | null>(null);
  const [currentParent, setCurrentParent] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [portals, setPortals] = useState<any[]>([]);
  const [savedMaps, setSavedMaps] = useState<any[]>([]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [inlineInput, setInlineInput] = useState<{ kind: 'annotation' | 'portal'; path?: string; defaultValue?: string } | null>(null);
  const [inlineInputValue, setInlineInputValue] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const invoke = useCallback(async (channel: string, data: any = {}) => {
    return (window as any).orbis.invoke(channel, data);
  }, []);

  useEffect(() => {
    const handler = (data: ScanProgress) => {
      setProgress(data);
      if (data.state === 'complete' || data.state === 'cancelled' || data.state === 'error') {
        setScanning(false);
        if (data.state === 'complete') {
          loadData(data.scanId);
        }
      }
    };
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = (window as any).orbis.on('universe:scan:progress', handler);
    } catch {}
    return () => {
      try { unsubscribe?.(); } catch {}
    };
  }, []);

  useEffect(() => {
    loadPortals();
    loadSavedMaps();
  }, []);

  const loadPortals = async () => {
    try { setPortals(await invoke('universe:portal:list')); } catch {}
  };

  const loadSavedMaps = async () => {
    try { setSavedMaps(await invoke('universe:map:list')); } catch {}
  };

  const startScan = async () => {
    try {
      const result = await invoke('fs:pickDirectory', {});
      if (!result) return;
      setScanning(true);
      setEntries([]);
      setStats(null);
      setSelected(null);
      setCurrentParent(null);
      setBreadcrumb([]);
      const { scanId: id } = await invoke('universe:scan', { root: result, maxDepth: 20, maxEntries: 500000 });
      setScanId(id);
    } catch (err) {
      setScanning(false);
    }
  };

  const loadData = async (id: string) => {
    setScanId(id);
    try {
      const s = await invoke('universe:stats', { scanId: id });
      setStats(s);
      const q = await invoke('universe:query', { scanId: id, limit: 2000, sortBy: 'size', sortDir: 'desc' });
      setEntries(q);
      const a = await invoke('universe:annotate:list', {});
      setAnnotations(a);
    } catch {}
  };

  const navigateIn = (entry: UniverseEntry) => {
    if (entry.kind !== 'directory') return;
    setCurrentParent(entry.path);
    setBreadcrumb(prev => [...prev, entry.path]);
    if (scanId) {
      invoke('universe:query', { scanId, parent: entry.path, limit: 2000, sortBy: 'size', sortDir: 'desc' })
        .then(setEntries).catch(() => {});
    }
  };

  const navigateUp = () => {
    const newBreadcrumb = breadcrumb.slice(0, -1);
    setBreadcrumb(newBreadcrumb);
    const parent = newBreadcrumb.length ? newBreadcrumb[newBreadcrumb.length - 1] : undefined;
    setCurrentParent(parent || null);
    if (scanId) {
      invoke('universe:query', { scanId, parent, limit: 2000, sortBy: 'size', sortDir: 'desc' })
        .then(setEntries).catch(() => {});
    }
  };

  const saveMap = async () => {
    if (!scanId || !stats) return;
    try {
      await invoke('universe:map:save', {
        name: `Map ${new Date().toLocaleString()}`,
        scanId,
        root: stats.scan?.root || '',
        layout: JSON.stringify({ layout, breadcrumb, currentParent }),
        lens,
      });
      loadSavedMaps();
    } catch {}
  };

  const addAnnotation = (path: string) => {
    setInlineInput({ kind: 'annotation', path });
    setInlineInputValue('');
  };

  const addPortal = () => {
    if (!currentParent && !stats?.scan?.root) return;
    const loc = currentParent || stats.scan.root;
    setInlineInput({ kind: 'portal', path: loc, defaultValue: loc.split('/').pop() || 'Portal' });
    setInlineInputValue(loc.split('/').pop() || 'Portal');
  };

  const submitInlineInput = async () => {
    if (!inlineInput || !inlineInputValue.trim()) return;
    try {
      if (inlineInput.kind === 'annotation' && inlineInput.path) {
        await invoke('universe:annotate', { path: inlineInput.path, note: inlineInputValue.trim() });
        const a = await invoke('universe:annotate:list', {});
        setAnnotations(a);
      } else if (inlineInput.kind === 'portal' && inlineInput.path) {
        await invoke('universe:portal:create', { name: inlineInputValue.trim(), location: inlineInput.path });
        loadPortals();
      }
    } catch {}
    setInlineInput(null);
    setInlineInputValue('');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !entries.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const filtered = currentParent
      ? entries.filter(e => e.path !== currentParent)
      : entries.filter(e => e.depth <= 1);

    if (!filtered.length) return;

    const totalSize = filtered.reduce((s, e) => s + Math.max(e.size, 1), 0);

    if (layout === 'treemap') {
      drawTreemap(ctx, filtered, rect.width, rect.height, totalSize, lens);
    } else if (layout === 'grid') {
      drawGrid(ctx, filtered, rect.width, rect.height, lens);
    } else if (layout === 'sunburst') {
      drawSunburst(ctx, filtered, rect.width, rect.height, totalSize, lens);
    }
  }, [entries, layout, lens, currentParent]);

  return (
    <div className="tool-view universe-explorer">
      <header className="view-header">
        <h1><Icon name="globe" /> Universe Explorer</h1>
        <div className="view-actions">
          <button className="btn btn-primary" onClick={startScan} disabled={scanning}>
            <Icon name="search" /> {scanning ? 'Scanning...' : 'Scan Folder'}
          </button>
          <button className="btn" onClick={saveMap} disabled={!scanId}>
            <Icon name="save" /> Save Map
          </button>
          <button className="btn" onClick={addPortal} disabled={!scanId}>
            <Icon name="bookmark" /> Add Portal
          </button>
          <button className="btn" onClick={() => setShowSidebar(!showSidebar)}>
            <Icon name={showSidebar ? 'panelRightClose' : 'panelRightOpen'} />
          </button>
        </div>
      </header>

      {inlineInput && (
        <div className="universe-inline-input" style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 16px', background: 'var(--bg-secondary, #1e1e2e)' }}>
          <label>{inlineInput.kind === 'annotation' ? `Note for ${inlineInput.path?.split('/').pop()}:` : 'Portal name:'}</label>
          <input
            type="text"
            autoFocus
            value={inlineInputValue}
            onChange={e => setInlineInputValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitInlineInput(); if (e.key === 'Escape') { setInlineInput(null); setInlineInputValue(''); } }}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary btn-sm" onClick={submitInlineInput}>OK</button>
          <button className="btn btn-sm" onClick={() => { setInlineInput(null); setInlineInputValue(''); }}>Cancel</button>
        </div>
      )}

      <div className="universe-toolbar">
        <div className="universe-lens-bar">
          {(Object.keys(LENS_INFO) as Lens[]).map(l => (
            <button
              key={l}
              className={`btn btn-sm ${lens === l ? 'btn-primary' : ''}`}
              onClick={() => setLens(l)}
              title={LENS_INFO[l].description}
            >
              <Icon name={LENS_INFO[l].icon} /> {LENS_INFO[l].label}
            </button>
          ))}
        </div>
        <div className="universe-layout-bar">
          {(['treemap', 'sunburst', 'grid', 'force'] as Layout[]).map(l => (
            <button
              key={l}
              className={`btn btn-sm ${layout === l ? 'btn-primary' : ''}`}
              onClick={() => setLayout(l)}
            >
              {l.charAt(0).toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {scanning && progress && (
        <div className="universe-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${Math.min((progress.scanned / 500000) * 100, 100)}%` }} />
          </div>
          <span className="progress-text">
            Scanned {progress.scanned.toLocaleString()} items ({formatBytes(progress.totalBytes)})
          </span>
          <button className="btn btn-sm" onClick={() => scanId && invoke('universe:cancelScan', { scanId })}>Cancel</button>
        </div>
      )}

      {breadcrumb.length > 0 && (
        <div className="universe-breadcrumb">
          <button className="btn btn-sm" onClick={navigateUp}><Icon name="arrowLeft" /> Back</button>
          {breadcrumb.map((p, i) => (
            <span key={i} className="breadcrumb-item">
              <Icon name="chevronRight" />
              <span>{p.split('/').pop()}</span>
            </span>
          ))}
        </div>
      )}

      <div className="universe-content">
        <div className="universe-canvas-wrap">
          {entries.length > 0 ? (
            <canvas
              ref={canvasRef}
              className="universe-canvas"
              onClick={(e) => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const hit = hitTest(x, y);
                if (hit) setSelected(hit);
              }}
              onDoubleClick={(e) => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const hit = hitTest(x, y);
                if (hit && hit.kind === 'directory') navigateIn(hit);
              }}
            />
          ) : !scanning ? (
            <div className="universe-empty">
              <Icon name="globe" />
              <h2>Universe Explorer</h2>
              <p>Scan a folder to explore its filesystem as an interactive map.</p>
              <button className="btn btn-primary btn-lg" onClick={startScan}>
                <Icon name="search" /> Start Scanning
              </button>
              {savedMaps.length > 0 && (
                <div className="universe-saved-maps">
                  <h3>Saved Maps</h3>
                  {savedMaps.map(m => (
                    <button key={m.id} className="btn" onClick={() => {
                      if (m.scan_id) loadData(m.scan_id);
                    }}>
                      <Icon name="map" /> {m.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {showSidebar && stats && (
          <div className="universe-sidebar">
            <section className="universe-section">
              <h3><Icon name="pieChart" /> Overview</h3>
              <div className="universe-stat-grid">
                <div className="stat-item">
                  <span className="stat-value">{stats.scan?.total_entries?.toLocaleString() || 0}</span>
                  <span className="stat-label">Items</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{formatBytes(stats.scan?.total_bytes || 0)}</span>
                  <span className="stat-label">Total Size</span>
                </div>
              </div>
            </section>

            <section className="universe-section">
              <h3><Icon name="tag" /> Categories</h3>
              <div className="universe-categories">
                {stats.categories?.map((c: CategoryStat) => (
                  <div key={c.category} className="category-row">
                    <div className="category-color" style={{ background: CATEGORY_COLORS[c.category] || '#888' }} />
                    <span className="category-name">{c.category}</span>
                    <span className="category-count">{Number(c.count).toLocaleString()}</span>
                    <span className="category-size">{formatBytes(Number(c.totalSize))}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="universe-section">
              <h3><Icon name="arrowDown" /> Largest Files</h3>
              <div className="universe-largest">
                {stats.largest?.slice(0, 10).map((f: any, i: number) => (
                  <div key={i} className="largest-item" onClick={() => setSelected(f)}>
                    <span className="largest-name" title={f.path}>{f.path.split('/').pop()}</span>
                    <span className="largest-size">{formatBytes(Number(f.size))}</span>
                  </div>
                ))}
              </div>
            </section>

            {portals.length > 0 && (
              <section className="universe-section">
                <h3><Icon name="bookmark" /> Portals</h3>
                {portals.map(p => (
                  <button key={p.id} className="btn btn-sm universe-portal-btn" onClick={() => {
                    setCurrentParent(p.location);
                    setBreadcrumb([p.location]);
                    if (scanId) {
                      invoke('universe:query', { scanId, parent: p.location, limit: 2000, sortBy: 'size', sortDir: 'desc' })
                        .then(setEntries).catch(() => {});
                    }
                  }}>
                    <Icon name="bookmark" /> {p.name}
                  </button>
                ))}
              </section>
            )}

            {selected && (
              <section className="universe-section universe-detail">
                <h3><Icon name="info" /> Selected</h3>
                <div className="detail-field"><strong>Name:</strong> {selected.name || selected.path.split('/').pop()}</div>
                <div className="detail-field"><strong>Path:</strong> <span className="detail-path">{selected.path}</span></div>
                <div className="detail-field"><strong>Size:</strong> {formatBytes(selected.size)}</div>
                <div className="detail-field"><strong>Type:</strong> {selected.category} {selected.ext ? `(.${selected.ext})` : ''}</div>
                {selected.mtime_ms && <div className="detail-field"><strong>Modified:</strong> {new Date(selected.mtime_ms).toLocaleString()}</div>}
                <div className="detail-actions">
                  <button className="btn btn-sm" onClick={() => addAnnotation(selected.path)}>
                    <Icon name="edit" /> Annotate
                  </button>
                  <button className="btn btn-sm" onClick={() => {
                    try { invoke('fs:reveal', { path: selected.path }); } catch {}
                  }}>
                    <Icon name="folder" /> Reveal
                  </button>
                </div>
              </section>
            )}

            {annotations.length > 0 && (
              <section className="universe-section">
                <h3><Icon name="edit" /> Annotations</h3>
                {annotations.slice(0, 20).map(a => (
                  <div key={a.id} className="annotation-item">
                    <div className="annotation-path">{a.path.split('/').pop()}</div>
                    <div className="annotation-note">{a.note}</div>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// -- Canvas drawing functions --

function getColorForEntry(entry: UniverseEntry, lens: Lens): string {
  switch (lens) {
    case 'type':
      return CATEGORY_COLORS[entry.category] || '#888';
    case 'space': {
      const logSize = Math.log10(Math.max(entry.size, 1));
      const t = Math.min(logSize / 10, 1);
      return `hsl(${(1 - t) * 200}, 70%, ${50 + t * 10}%)`;
    }
    case 'time':
      if (!entry.mtime_ms) return '#666';
      {
        const age = Date.now() - entry.mtime_ms;
        const days = age / 86400000;
        if (days < 1) return '#4caf50';
        if (days < 7) return '#8bc34a';
        if (days < 30) return '#ffeb3b';
        if (days < 365) return '#ff9800';
        return '#795548';
      }
    case 'change':
      if (!entry.mtime_ms) return '#444';
      {
        const recentMs = Date.now() - entry.mtime_ms;
        if (recentMs < 3600000) return '#f44336';
        if (recentMs < 86400000) return '#ff9800';
        if (recentMs < 604800000) return '#ffeb3b';
        return '#555';
      }
    default:
      return entry.kind === 'directory' ? '#546e7a' : (CATEGORY_COLORS[entry.category] || '#78909c');
  }
}

interface LayoutRect { x: number; y: number; w: number; h: number; entry: UniverseEntry }
let lastRects: LayoutRect[] = [];

function drawTreemap(ctx: CanvasRenderingContext2D, entries: UniverseEntry[], width: number, height: number, totalSize: number, lens: Lens) {
  lastRects = [];
  const sorted = [...entries].sort((a, b) => b.size - a.size).slice(0, 500);
  const rects = squarify(sorted.map(e => ({ ...e, value: Math.max(e.size, 1) })), 0, 0, width, height);

  for (const r of rects) {
    const color = getColorForEntry(r.entry, lens);
    ctx.fillStyle = color;
    ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);

    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    if (r.w > 40 && r.h > 16) {
      const name = r.entry.name || r.entry.path.split('/').pop() || '';
      ctx.fillStyle = '#fff';
      ctx.font = r.w > 100 ? '12px system-ui' : '10px system-ui';
      ctx.textBaseline = 'top';
      const maxWidth = r.w - 8;
      let label = name;
      if (ctx.measureText(label).width > maxWidth) {
        while (label.length > 3 && ctx.measureText(label + '…').width > maxWidth) label = label.slice(0, -1);
        label += '…';
      }
      ctx.fillText(label, r.x + 4, r.y + 4);

      if (r.h > 30) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '10px system-ui';
        ctx.fillText(formatBytes(r.entry.size), r.x + 4, r.y + 18);
      }
    }

    lastRects.push(r);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, entries: UniverseEntry[], width: number, height: number, lens: Lens) {
  lastRects = [];
  const sorted = [...entries].sort((a, b) => b.size - a.size).slice(0, 500);
  const cols = Math.max(1, Math.floor(Math.sqrt(sorted.length * (width / height))));
  const cellW = width / cols;
  const cellH = cellW;

  sorted.forEach((entry, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cellW;
    const y = row * cellH;
    if (y + cellH > height + cellH) return;

    const color = getColorForEntry(entry, lens);
    const sizeRatio = Math.sqrt(Math.min(entry.size / (sorted[0]?.size || 1), 1));

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + cellW / 2, y + cellH / 2, Math.max(cellW * sizeRatio * 0.4, 3), 0, Math.PI * 2);
    ctx.fill();

    lastRects.push({ x, y, w: cellW, h: cellH, entry });

    if (cellW > 40) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '9px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const name = entry.name || entry.path.split('/').pop() || '';
      ctx.fillText(name.length > 10 ? name.slice(0, 8) + '…' : name, x + cellW / 2, y + cellH / 2 + cellW * sizeRatio * 0.4 + 4);
      ctx.textAlign = 'left';
    }
  });
}

function drawSunburst(ctx: CanvasRenderingContext2D, entries: UniverseEntry[], width: number, height: number, totalSize: number, lens: Lens) {
  lastRects = [];
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(cx, cy) - 20;
  const sorted = [...entries].sort((a, b) => b.size - a.size).slice(0, 200);

  let angle = 0;
  for (const entry of sorted) {
    const slice = (Math.max(entry.size, 1) / totalSize) * Math.PI * 2;
    if (slice < 0.005) continue;

    const color = getColorForEntry(entry, lens);
    const innerR = maxR * 0.2;
    const outerR = maxR * (entry.kind === 'directory' ? 0.6 : 0.9);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, angle, angle + slice);
    ctx.arc(cx, cy, innerR, angle + slice, angle, true);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    if (slice > 0.1 && outerR - innerR > 30) {
      const midAngle = angle + slice / 2;
      const labelR = (innerR + outerR) / 2;
      const lx = cx + Math.cos(midAngle) * labelR;
      const ly = cy + Math.sin(midAngle) * labelR;
      ctx.fillStyle = '#fff';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const name = entry.name || entry.path.split('/').pop() || '';
      ctx.fillText(name.length > 12 ? name.slice(0, 10) + '…' : name, lx, ly);
      ctx.textAlign = 'left';
    }

    const midAngle = angle + slice / 2;
    const midR = (innerR + outerR) / 2;
    lastRects.push({
      x: cx + Math.cos(midAngle) * midR - 15,
      y: cy + Math.sin(midAngle) * midR - 15,
      w: 30, h: 30, entry,
    });

    angle += slice;
  }
}

function hitTest(x: number, y: number): UniverseEntry | null {
  for (const r of lastRects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      return r.entry;
    }
  }
  return null;
}

function squarify(items: (UniverseEntry & { value: number })[], x: number, y: number, w: number, h: number): LayoutRect[] {
  if (!items.length || w <= 0 || h <= 0) return [];
  const total = items.reduce((s, e) => s + e.value, 0);
  if (total <= 0) return [];

  const rects: LayoutRect[] = [];
  let cx = x, cy = y, cw = w, ch = h;
  let remaining = [...items];

  while (remaining.length > 0) {
    const isWide = cw >= ch;
    const side = isWide ? ch : cw;
    const remTotal = remaining.reduce((s, e) => s + e.value, 0);

    let row: typeof remaining = [];
    let rowArea = 0;

    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i]!;
      const test = [...row, item];
      const testArea = rowArea + item.value;
      const testAspect = worstAspect(test, testArea, side, remTotal, isWide ? cw : ch);
      if (row.length > 0) {
        const curAspect = worstAspect(row, rowArea, side, remTotal, isWide ? cw : ch);
        if (testAspect > curAspect) break;
      }
      row.push(item);
      rowArea = testArea;
    }

    const rowFraction = rowArea / remTotal;
    const rowSize = (isWide ? cw : ch) * rowFraction;

    let pos = 0;
    for (const item of row) {
      const frac = item.value / rowArea;
      const size = side * frac;
      if (isWide) {
        rects.push({ x: cx, y: cy + pos, w: rowSize, h: size, entry: item });
      } else {
        rects.push({ x: cx + pos, y: cy, w: size, h: rowSize, entry: item });
      }
      pos += size;
    }

    remaining = remaining.slice(row.length);
    if (isWide) { cx += rowSize; cw -= rowSize; }
    else { cy += rowSize; ch -= rowSize; }
  }

  return rects;
}

function worstAspect(row: any[], rowArea: number, side: number, total: number, otherSide: number): number {
  if (!row.length || rowArea <= 0 || side <= 0) return Infinity;
  const rowSize = otherSide * (rowArea / total);
  if (rowSize <= 0) return Infinity;
  let worst = 0;
  for (const item of row) {
    const frac = item.value / rowArea;
    const size = side * frac;
    const aspect = Math.max(rowSize / size, size / rowSize);
    worst = Math.max(worst, aspect);
  }
  return worst;
}
