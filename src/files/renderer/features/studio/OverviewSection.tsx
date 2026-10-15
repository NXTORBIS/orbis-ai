
import { useStore } from '../../state/store';
import { applyCustom, custom, useCustom } from '../../state/custom';
import { Button, Pill } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { LAYER_LABEL } from '../../../shared/customization/resolve';
import { STUDIO_CATEGORIES } from '../../../shared/customization/settingsIndex';
import { studio } from './studioState';

/** What is in effect, where it comes from, and the safeguards that changed anything. */
export function OverviewSection() {
  const r = useCustom((x) => ({ preset: x.preset, workspace: x.workspace, mode: x.mode, setting: x.appearance.mode, hc: x.highContrast, rm: x.reducedMotion, adjustments: x.adjustments, sources: x.sources, layout: x.layout.panes.arrangement }));
  const server = useStore(custom, (s) => ({ host: s.server.hostTokens, hostReserved: s.server.hostReserved.length, undo: s.server.undoLabel, backups: s.server.backups.length, system: s.system }));
  const counts: Record<string, number> = {};
  for (const v of Object.values(r.sources)) counts[v] = (counts[v] ?? 0) + 1;
  return (
    <div className="studio-sections">
      <section className="studio-card">
        <h2>In effect now</h2>
        <dl className="props">
          <dt>Preset</dt><dd>{r.preset ? <>{r.preset.name} {r.preset.builtIn ? <Pill>built in</Pill> : <Pill tone="accent">yours</Pill>}</> : 'None'}</dd>
          <dt>Workspace</dt><dd>{r.workspace.name}</dd>
          <dt>Mode</dt><dd>{r.mode === 'dark' ? 'Dark' : 'Light'}{r.setting === 'system' ? ` (following the system, which reports ${server.system.dark ? 'dark' : 'light'})` : ''}</dd>
          <dt>Panes</dt><dd>{{ single: 'One pane', dual: 'Two side by side', 'dual-stacked': 'Two stacked', triple: 'Three', quad: 'Four' }[r.layout]}</dd>
          <dt>High contrast</dt><dd>{r.hc ? 'On' : 'Off'}{server.system.highContrast ? ' (the system asks for more contrast)' : ''}</dd>
          <dt>Reduced motion</dt><dd>{r.rm ? 'On' : 'Off'}{server.system.reducedMotion ? ' (the system asks for reduced motion)' : ''}</dd>
          <dt>Colours from the Orbis app</dt><dd>{server.host ? `In use (design-token contract ${server.host.contract})` : 'Not connected — Orbis Files’ own colours are used'}</dd>
        </dl>
        <p className="muted small">Values are resolved in this order, later ones winning: application defaults → colours from the Orbis app (when connected) → your settings → preset → workspace → each pane’s own view; safeguards always apply last.</p>
        <div className="chip-row">
          {Object.entries(counts).map(([layer, n]) => <span key={layer} className={`source-badge src-${layer}`}>{LAYER_LABEL[layer as keyof typeof LAYER_LABEL]}: {n}</span>)}
        </div>
      </section>

      <section className="studio-card">
        <h2>Safeguards</h2>
        {r.adjustments.length === 0 ? (
          <p className="muted"><Icon name="shield" size={14} /> Nothing needed adjusting: every colour is readable and every control reachable.</p>
        ) : (
          <ul className="adjustments">
            {r.adjustments.map((a) => (
              <li key={a.path}><Icon name="shield" size={14} /> <span>{a.reason}</span>{a.from && a.to && <span className="muted mono small"> {a.from} → {a.to}</span>}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="studio-card">
        <h2>Quick actions</h2>
        <div className="chip-row">
          <Button size="sm" icon="theme" onClick={() => void applyCustom({ op: 'set', section: 'appearance', path: ['mode'], value: r.mode === 'dark' ? 'light' : 'dark', label: 'Switched light/dark' })}>Switch to {r.mode === 'dark' ? 'light' : 'dark'}</Button>
          <Button size="sm" icon="presets" onClick={() => studio.set({ category: 'presets' })}>Choose a preset</Button>
          <Button size="sm" icon="layout" onClick={() => studio.set({ category: 'layout' })}>Edit the layout</Button>
          <Button size="sm" icon="workspace" onClick={() => studio.set({ category: 'workspaces' })}>Workspaces</Button>
          <Button size="sm" icon="exportFile" onClick={() => studio.set({ category: 'portability' })}>Export or import</Button>
        </div>
        {server.undo && <p className="muted small">Last change: {server.undo}. {server.backups} backup{server.backups === 1 ? '' : 's'} kept.</p>}
      </section>

      <section className="studio-card">
        <h2>All categories</h2>
        <div className="studio-cat-grid">
          {STUDIO_CATEGORIES.filter((c) => c.id !== 'overview').map((c) => (
            <button key={c.id} type="button" className="studio-cat-card" onClick={() => studio.set({ category: c.id })}>
              <Icon name={c.icon} size={18} />
              <strong>{c.label}</strong>
              <span className="muted small">{c.description}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
