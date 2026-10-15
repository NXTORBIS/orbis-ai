
import { app, opsActive, setSetting } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane, navigate, openTab } from '../../state/workspace';
import { call } from '../../api';
import { Icon } from '../../ui/Icon';
import { EmptyState, FileIcon, ProgressBar } from '../../ui/components';
import { formatBytes, formatDate } from '../../ui/format';
import { openFile } from '../../actions';
import { runCommand } from '../../commands';
import { HOME_SECTION_KEYS as SECTION_KEYS, HOME_SECTION_LABELS as SECTION_LABELS, homeSectionState } from './homeSections';


const KNOWN_ICON: Record<string, string> = { home: 'home', desktop: 'drive', documents: 'fileText', downloads: 'download', pictures: 'image', videos: 'fileVideo', music: 'music' };

/** A greeting for the local time of day. */
function greeting(d: Date): string {
  const h = d.getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Totals from the drives Orbis Files can see (only drives that report sizes are counted). */
function HeroStats({ volumes, recents, pins }: { volumes: Array<{ totalBytes?: number; freeBytes?: number }>; recents: number; pins: number }) {
  const sized = volumes.filter((v) => v.totalBytes !== undefined && v.freeBytes !== undefined);
  const total = sized.reduce((n, v) => n + (v.totalBytes ?? 0), 0);
  const free = sized.reduce((n, v) => n + (v.freeBytes ?? 0), 0);
  return (
    <dl className="hero-stats">
      <div><dt>Drives</dt><dd className="tabular">{volumes.length}</dd></div>
      {sized.length > 0 && <div><dt>Free space</dt><dd className="tabular">{formatBytes(free)} <span className="muted small">of {formatBytes(total)}</span></dd></div>}
      <div><dt>Recent items</dt><dd className="tabular">{recents}</dd></div>
      <div><dt>Pinned</dt><dd className="tabular">{pins}</dd></div>
    </dl>
  );
}

/** Home: an entry point built only from real local state. Nothing here is sample data. */
export function HomeView({ paneId }: { paneId: string }) {
  const s = useStore(app, (x) => ({ known: x.known, pins: x.pins, recents: x.recents, volumes: x.volumes, sections: x.settings.homeSections, collections: x.collections }));
  const active = useStore(app, (x) => opsActive(x));
  const go = (path: string) => void navigate(paneId, { kind: 'fs', path });
  const hide = (key: keyof typeof s.sections) => void setSetting('homeSections', { ...s.sections, [key]: false });

  const showAll = () => void setSetting('homeSections', { quickAccess: true, recent: true, drives: true, operations: true, collections: true });
  const { shown, hidden } = homeSectionState(s.sections, active.length, s.collections.length);

  const recentFiles = s.recents.filter((r) => r.kind === 'file').slice(0, 12);
  const recentDirs = s.recents.filter((r) => r.kind === 'directory' && r.exists).slice(0, 8);

  return (
    <div className="home scroll-y">
      <header className="view-header home-hero">
        <span className="hero-orb" aria-hidden="true" />
        <p className="hero-kicker">{greeting(new Date())}</p>
        <h1>Home</h1>
        <p className="muted">Your folders, drives and recent activity on this computer.</p>
        <HeroStats volumes={s.volumes} recents={s.recents.length} pins={s.pins.length} />
        <div className="hero-actions">
          <button type="button" className="btn btn-primary" onClick={() => void call('orbis:addFiles').then((r) => { const added = (r as { added: string[] } | null)?.added ?? []; if (added.length) void navigate(activePane().id, { kind: 'fs', path: added[0]!.replace(/[\/][^\/]*$/, '') }); })}><Icon name="plus" size={15} /> Add to Orbis</button>
          <button type="button" className="btn btn-primary" onClick={() => void runCommand('app.palette')}><Icon name="command" size={15} /> Command palette</button>
        </div>
      </header>

      {s.sections.quickAccess && (
        <section className="home-section">
          <SectionHead title="Quick access" onHide={() => hide('quickAccess')} />
          <div className="place-list">
            {[...s.known.map((k) => ({ path: k.path, label: k.label, icon: KNOWN_ICON[k.id] ?? 'folder' })), ...s.pins.map((p) => ({ path: p.path, label: p.label ?? p.path.split(/[\\/]/).filter(Boolean).pop() ?? p.path, icon: 'pin' }))].map((p) => (
              <button key={p.path} type="button" className="place" onClick={() => go(p.path)} onAuxClick={(e) => e.button === 1 && openTab({ kind: 'fs', path: p.path })} title={p.path}>
                <Icon name={p.icon} size={18} />
                <span className="place-label">{p.label}</span>
                <span className="place-path mono">{p.path}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {s.sections.operations && active.length > 0 && (
        <section className="home-section">
          <SectionHead title="Active operations" onHide={() => hide('operations')} />
          <div className="op-mini-list">
            {active.map((o) => (
              <button key={o.id} type="button" className="op-mini" onClick={() => void runCommand('app.operations')}>
                <span className="op-mini-title">{o.type} · {o.progress.currentItem ?? `${o.sources.length} item${o.sources.length === 1 ? '' : 's'}`}</span>
                <ProgressBar label={`${o.type} progress`} value={o.progress.totalBytes ? o.progress.completedBytes / o.progress.totalBytes : o.progress.totalItems ? o.progress.completedItems / o.progress.totalItems : undefined} tone={o.state === 'awaiting_conflict' ? 'warning' : 'accent'} />
              </button>
            ))}
          </div>
        </section>
      )}

      {s.sections.recent && (
        <section className="home-section">
          <SectionHead title="Recent" onHide={() => hide('recent')} action={s.recents.length ? { label: 'Show all', run: () => void navigate(paneId, { kind: 'library', category: 'recent' }) } : undefined} />
          {!recentFiles.length && !recentDirs.length ? (
            <p className="muted">Files and folders you open in Orbis Files appear here. Nothing has been opened yet.</p>
          ) : (
            <div className="recent-grid">
              {recentDirs.map((r) => (
                <button key={r.path} type="button" className="recent-row" onClick={() => go(r.path)} title={r.path}>
                  <FileIcon entry={{ kind: 'directory', ext: '' }} />
                  <span className="name">{r.path.split(/[\\/]/).filter(Boolean).pop() ?? r.path}</span>
                  <span className="muted tabular">{formatDate(r.lastMs)}</span>
                </button>
              ))}
              {recentFiles.map((r) => (
                <button key={r.path} type="button" className={`recent-row ${r.exists ? '' : 'is-missing'}`} disabled={!r.exists} onClick={() => void openFile(r.path)} title={r.exists ? r.path : `${r.path} (no longer exists)`}>
                  <FileIcon entry={{ kind: 'file', ext: r.path.split('.').pop()?.toLowerCase() ?? '' }} />
                  <span className="name">{r.path.split(/[\\/]/).pop()}</span>
                  <span className="muted tabular">{r.exists ? formatDate(r.lastMs) : 'Missing'}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {s.sections.drives && (
        <section className="home-section">
          <SectionHead title="Drives" onHide={() => hide('drives')} />
          {!s.volumes.length ? (
            <EmptyState icon="drive" title="No drive information available" />
          ) : (
            <div className="drive-list">
              {s.volumes.map((v) => {
                const used = v.totalBytes !== undefined && v.freeBytes !== undefined ? v.totalBytes - v.freeBytes : undefined;
                const frac = used !== undefined && v.totalBytes ? used / v.totalBytes : undefined;
                return (
                  <button key={v.id} type="button" className="drive" onClick={() => go(v.mountPath)} title={`${v.mountPath}${v.fsType ? ` · ${v.fsType}` : ''} · source: ${v.source}`}>
                    <Icon name={v.removable ? 'usb' : 'drive'} size={18} />
                    <div className="drive-body">
                      <div className="drive-top">
                        <span className="drive-name">{v.label}</span>
                        <span className="muted mono">{v.mountPath}</span>
                      </div>
                      {frac !== undefined ? (
                        <>
                          <ProgressBar label={`${v.label} usage`} value={frac} tone={frac > 0.92 ? 'error' : frac > 0.8 ? 'warning' : 'accent'} />
                          <span className="muted tabular">{formatBytes(v.freeBytes)} free of {formatBytes(v.totalBytes)}</span>
                        </>
                      ) : (
                        <span className="muted">Capacity not available</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {s.sections.collections && s.collections.length > 0 && (
        <section className="home-section">
          <SectionHead title="Collections" onHide={() => hide('collections')} />
          <div className="chip-row">
            {s.collections.map((c) => (
              <button key={c.id} type="button" className="chip" onClick={() => void navigate(paneId, { kind: 'collection', id: c.id })}>
                <Icon name="collection" size={14} /> {c.name} <span className="muted tabular">{c.count}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!shown && (
        <EmptyState icon="home" title={hidden.length === SECTION_KEYS.length ? 'All Home sections are hidden' : 'Nothing to show on Home'} body={hidden.length ? `Hidden: ${hidden.map((k) => SECTION_LABELS[k]).join(', ')}.` : undefined}>
          <button type="button" className="btn btn-default btn-md" onClick={showAll}>Show all sections</button>
        </EmptyState>
      )}
      {shown && hidden.length > 0 && (
        <p className="home-hidden muted small">
          Hidden from Home: {hidden.map((k) => SECTION_LABELS[k]).join(', ')}. <button type="button" className="link-btn" onClick={showAll}>Show all sections</button>
        </p>
      )}
    </div>
  );
}

function SectionHead({ title, onHide, action }: { title: string; onHide?: () => void; action?: { label: string; run: () => void } }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      <span className="spacer" />
      {action && <button type="button" className="link-btn" onClick={action.run}>{action.label}</button>}
      {onHide && <button type="button" className="link-btn muted" onClick={onHide} title={`Hide ${title} from Home (show it again from the end of Home or in Settings)`} aria-label={`Hide ${title} from Home`}>Hide</button>}
    </div>
  );
}
