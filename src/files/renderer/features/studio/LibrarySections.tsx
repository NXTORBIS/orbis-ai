import React, { useState } from 'react';
import { call } from '../../api';
import { createStore, useStore } from '../../state/store';
import { applyCustom, cancelPreview, custom, previewChange, redoCustom, restoreBackup, revertCustom, undoCustom, useCustom } from '../../state/custom';
import { confirm, prompt, toast, toastError } from '../../state/app';
import { Button, Dialog, Pill } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { BUILT_IN_PRESETS, BUILT_IN_BY_ID } from '../../../shared/customization/presets';
import { baseTokens } from '../../../shared/customization/tokens';
import { EXPORT_KIND_LABEL, EXPORT_KINDS, type ExportKind, type ImportPreview } from '../../../shared/customization/portable';
import type { Preset } from '../../../shared/customization/schema';
import type { BuiltInPreset } from '../../../shared/customization/presets';
import { formatDate } from '../../ui/format';

const exportFile = (kind: ExportKind, id?: string) =>
  void call<{ path: string } | null>('custom:export', { kind, id, systemDark: custom.get().system.dark }).then(
    (r) => r && toast({ level: 'success', title: `${EXPORT_KIND_LABEL[kind]} exported`, detail: r.path }),
    (e) => toastError(e, 'Export failed'),
  );

/** Swatches drawn from the preset's own colours (or the defaults it inherits). */
function Swatches({ p }: { p: BuiltInPreset | Preset }) {
  const mode = p.appearance?.mode === 'light' ? 'light' : 'dark';
  const base = baseTokens(mode);
  const c = { ...base, ...(p.appearance?.colors?.[mode] ?? {}) };
  return (
    <span className="swatches" aria-hidden>
      {(['bgApp', 'bgSurface', 'bgRaised', 'text', 'accent'] as const).map((k) => <i key={k} style={{ background: c[k] }} />)}
    </span>
  );
}

/**
 * Preset library: the twelve built-in presets and your own. Built-ins are
 * read-only and always restorable; duplicate one to change it. Preview shows
 * a preset on the real interface before you apply it.
 */
export function PresetsSection() {
  const cfg = useStore(custom, (s) => s.server.config);
  const active = cfg.activePresetId;
  const card = (p: BuiltInPreset | Preset, builtIn: boolean) => (
    <div key={p.id} className={`preset-card static ${active === p.id ? 'is-active' : ''}`}>
      <div className="preset-card-head">
        <Swatches p={p} />
        <strong>{p.name}</strong>
        {active === p.id && <Pill tone="accent">In use</Pill>}
        {!builtIn && <Pill>yours</Pill>}
      </div>
      <span className="muted small">{p.description || (!builtIn && (p as Preset).basedOn ? `Based on ${BUILT_IN_BY_ID[(p as Preset).basedOn!]?.name}` : '')}</span>
      <div className="chip-row">
        {active !== p.id && <Button size="sm" data-focus-key={`preset-preview-${p.id}`} onClick={() => previewChange({ op: 'applyPreset', id: p.id }, `preset “${p.name}”`)}>Preview</Button>}
        {active !== p.id && <Button size="sm" variant="primary" onClick={() => { cancelPreview(); void applyCustom({ op: 'applyPreset', id: p.id }); }}>Apply</Button>}
        <Button size="sm" variant="ghost" onClick={async () => {
          const name = await prompt({ title: `Duplicate “${p.name}”`, label: 'Name of your copy', initial: `${p.name} copy`, confirmLabel: 'Duplicate' });
          if (name) await applyCustom({ op: 'duplicatePreset', id: p.id, name });
        }}>Duplicate</Button>
        {!builtIn && <Button size="sm" variant="ghost" onClick={async () => {
          const name = await prompt({ title: 'Rename preset', label: 'Name', initial: p.name, confirmLabel: 'Rename' });
          if (name) await applyCustom({ op: 'renamePreset', id: p.id, name });
        }}>Rename</Button>}
        {!builtIn && <Button size="sm" variant="ghost" title="Make this preset the place your changes go, then change settings anywhere in the Studio" onClick={async () => {
          if (active !== p.id) await applyCustom({ op: 'applyPreset', id: p.id });
          const { studio } = await import('./studioState');
          studio.set({ target: 'preset', category: 'appearance' });
          toast({ level: 'info', title: `Editing preset “${p.name}”`, detail: 'Changes in the Studio are now saved to this preset (see “Save changes to” at the top).' });
        }}>Modify</Button>}
        {/* Built-in presets are read-only (always original), so only your copies can be restored. */}
        {!builtIn && (p as Preset).basedOn && <Button size="sm" variant="ghost" title="Reset this copy to the built-in preset it came from" onClick={async () => {
          if (await confirm({ title: `Restore “${p.name}”?`, body: `Its settings are replaced with those of the built-in “${BUILT_IN_BY_ID[(p as Preset).basedOn!]?.name}”. A backup is kept.`, confirmLabel: 'Restore' })) await applyCustom({ op: 'restorePreset', id: p.id });
        }}>Restore original</Button>}
        <Button size="sm" variant="ghost" icon="exportFile" onClick={() => exportFile('theme', p.id)}>Export</Button>
        {!builtIn && <Button size="sm" variant="ghost" onClick={async () => {
          if (await confirm({ title: `Delete preset “${p.name}”?`, body: 'Only the preset is deleted. If it is in use, Orbis Native is used instead. A backup is kept.', confirmLabel: 'Delete preset' })) await applyCustom({ op: 'deletePreset', id: p.id });
        }}>Delete</Button>}
      </div>
    </div>
  );
  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-savePreset">
        <div className="studio-card-head">
          <h2>Your presets</h2>
          <div className="chip-row">
            <Button size="sm" icon="save" onClick={async () => {
              const name = await prompt({ title: 'Save current as preset', label: 'Name', initial: 'My preset', confirmLabel: 'Save preset' });
              if (name) await applyCustom({ op: 'savePreset', name });
            }}>Save current as preset…</Button>
            <Button size="sm" icon="importFile" onClick={() => void importFlow()}>Import preset…</Button>
            {active && <Button size="sm" variant="ghost" onClick={() => void applyCustom({ op: 'applyPreset', id: null })}>Use no preset</Button>}
          </div>
        </div>
        {!cfg.presets.length ? <p className="muted">None yet. Save the current look, or duplicate a built-in preset to change it.</p> : <div className="preset-grid">{cfg.presets.map((p) => card(p, false))}</div>}
      </section>
      <section className="studio-card" id="setting-presetLibrary">
        <h2>Built-in presets</h2>
        <div className="preset-grid">{BUILT_IN_PRESETS.map((p) => card(p, true))}</div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ import & export

/** The file whose import preview is open (one at a time, from any Import button). */
export const importState = createStore<{ path: string | null }>({ path: null });

/** Pick a file and show its import preview (shared by every Import button). */
export async function importFlow(): Promise<void> {
  const path = await call<string | null>('custom:pickImport');
  if (path) importState.set({ path });
}

/** Mounted with the Studio so an import preview can open from any category (also for files dropped on the Studio). */
export function ImportHost() {
  const path = useStore(importState, (s) => s.path);
  React.useEffect(() => {
    const on = (e: Event) => {
      const p = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (typeof p === 'string' && p) importState.set({ path: p });
    };
    document.addEventListener('orbis:import-customization', on);
    return () => document.removeEventListener('orbis:import-customization', on);
  }, []);
  return path ? <ImportDialog path={path} onClose={() => importState.set({ path: null })} /> : null;
}

export function PortabilitySection() {
  const cfg = useStore(custom, (s) => s.server.config);
  const [kind, setKind] = useState<ExportKind>('complete');
  const [id, setId] = useState('');
  const choices: Partial<Record<ExportKind, Array<{ id: string; name: string }>>> = {
    theme: [...BUILT_IN_PRESETS, ...cfg.presets].map((p) => ({ id: p.id, name: p.name })),
    workspace: cfg.workspaces.map((w) => ({ id: w.id, name: w.name })),
    view: cfg.savedViews.map((v) => ({ id: v.id, name: v.name })),
    layout: [{ id: '', name: 'The layout in use now' }, ...cfg.savedLayouts.map((l) => ({ id: l.id, name: l.name }))],
  };
  const options = choices[kind];
  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-export">
        <h2>Export</h2>
        <p className="muted small">Exports are plain JSON files in the documented “orbis-files-customization” format (version 1). They contain settings only — never files, paths to your documents (except a chosen background image or start folder), or anything executable.</p>
        <div className="chip-row">
          <select className="input" aria-label="What to export" value={kind} onChange={(e) => { setKind(e.target.value as ExportKind); setId(''); }}>
            {EXPORT_KINDS.map((k) => <option key={k} value={k}>{EXPORT_KIND_LABEL[k]}</option>)}
          </select>
          {options && (
            <select className="input" aria-label="Which one" value={id} onChange={(e) => setId(e.target.value)}>
              {kind !== 'layout' && <option value="">Choose…</option>}
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <Button variant="primary" icon="exportFile" disabled={!!options && kind !== 'layout' && !id} onClick={() => exportFile(kind, id || undefined)}>Export…</Button>
        </div>
      </section>
      <section className="studio-card" id="setting-import">
        <h2>Import</h2>
        <p className="muted small">An import is checked before anything changes: size, JSON syntax, format and version, executable or remote content, value ranges, references, and unknown properties. You see exactly what would change, and it is applied as one undoable step with a backup.</p>
        <Button icon="importFile" onClick={() => void importFlow()}>Choose a file…</Button>
        {cfg.provenance.length > 0 && (
          <>
            <h3>Imported before</h3>
            <ul className="studio-list">{[...cfg.provenance].reverse().slice(0, 8).map((p, i) => <li key={i} className="studio-list-row"><span className="grow">{p.fileName}</span><span className="muted small">{EXPORT_KIND_LABEL[p.kind as ExportKind] ?? p.kind} · {formatDate(p.importedMs)}</span></li>)}</ul>
          </>
        )}
      </section>
    </div>
  );
}

function ImportDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [p, setP] = useState<(ImportPreview & { fileName: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    void call<ImportPreview & { fileName: string }>('custom:previewImport', { path }).then(setP, (e) => setError((e as Error).message));
  }, [path]);
  return (
    <Dialog title="Import customization" width={640} onClose={onClose} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!p?.ok || busy} onClick={async () => {
          setBusy(true);
          try {
            const r = await call<ImportPreview>('custom:applyImport', { path });
            toast({ level: 'success', title: 'Imported', detail: r.summary });
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>Import</Button>
      </>
    }>
      <p className="mono small break">{path}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!p && !error && <p className="muted">Checking the file…</p>}
      {p && (
        <div className="import-preview" aria-live="polite">
          <p><strong>{p.ok ? p.summary : 'This file cannot be imported. Nothing was changed.'}</strong>{p.kind && <span className="muted"> ({EXPORT_KIND_LABEL[p.kind]})</span>}</p>
          {p.errors.length > 0 && <ul className="issue-list error-text">{p.errors.map((e, i) => <li key={i}><code>{e.path}</code> {e.message}</li>)}</ul>}
          {p.warnings.length > 0 && <ul className="issue-list warning-text">{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {p.unsupported.length > 0 && <details><summary>{p.unsupported.length} unsupported propert{p.unsupported.length === 1 ? 'y' : 'ies'} (ignored)</summary><ul className="mono small">{p.unsupported.slice(0, 50).map((u) => <li key={u}>{u}</li>)}</ul></details>}
          {p.ok && (
            <details open={p.changes.length <= 12}>
              <summary>{p.changes.length} change{p.changes.length === 1 ? '' : 's'}{p.changes.length >= 200 ? ' (first 200 shown)' : ''}</summary>
              <table className="change-table"><tbody>{p.changes.map((c) => <tr key={c.path}><td className="mono small">{c.path}</td><td className="mono small muted">{c.before}</td><td>→</td><td className="mono small">{c.after}</td></tr>)}</tbody></table>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ reset & recovery

const CATEGORY_RESETS: Array<{ id: 'appearance' | 'colors' | 'typography' | 'background' | 'layout' | 'view' | 'accessibility' | 'navigation' | 'toolbar' | 'contextMenu' | 'shortcuts'; label: string }> = [
  { id: 'appearance', label: 'Appearance (all)' }, { id: 'colors', label: 'Colours' }, { id: 'typography', label: 'Typography & density' }, { id: 'background', label: 'Background' },
  { id: 'layout', label: 'Layout' }, { id: 'view', label: 'File views and columns' }, { id: 'navigation', label: 'Navigation' }, { id: 'toolbar', label: 'Toolbar' },
  { id: 'contextMenu', label: 'Context menus' }, { id: 'shortcuts', label: 'Keyboard shortcuts' }, { id: 'accessibility', label: 'Accessibility' },
];

export function RecoverySection() {
  const st = useStore(custom, (s) => ({ canUndo: s.server.canUndo, canRedo: s.server.canRedo, undo: s.server.undoLabel, redo: s.server.redoLabel, backups: s.server.backups, lastGood: s.server.lastGoodMs }));
  const wsName = useCustom((r) => r.workspace.name);
  const [cat, setCat] = useState<(typeof CATEGORY_RESETS)[number]['id']>('appearance');
  const [where, setWhere] = useState<'baseline' | 'workspace'>('baseline');
  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-history">
        <h2>Undo and redo</h2>
        <p className="muted small">Customization changes are kept as a history for this session (continuous adjustments count as one step). It never undoes file operations — those are undone from Operations.</p>
        <div className="chip-row">
          <Button icon="undo" disabled={!st.canUndo} onClick={() => void undoCustom()}>{st.undo ? `Undo: ${st.undo}` : 'Nothing to undo'}</Button>
          <Button icon="redo" disabled={!st.canRedo} onClick={() => void redoCustom()}>{st.redo ? `Redo: ${st.redo}` : 'Nothing to redo'}</Button>
          <Button disabled={!st.lastGood} onClick={() => void revertCustom()}>Return to the previous configuration</Button>
        </div>
      </section>
      <section className="studio-card" id="setting-backups">
        <h2>Backups</h2>
        <p className="muted small">A copy of the previous configuration is kept before every major change (presets, imports, resets, deletions); the newest 10 are kept. A configuration that ever fails to load is set aside and the last working one is used.</p>
        {!st.backups.length && <p className="muted">No backups yet.</p>}
        <ul className="studio-list">
          {st.backups.map((b) => (
            <li key={b.slot} className="studio-list-row">
              <Icon name="history" size={14} />
              <span className="grow">{b.label} <span className="muted small">{formatDate(b.savedMs)}</span></span>
              <Button size="sm" onClick={async () => {
                if (await confirm({ title: 'Restore this backup?', body: 'Your current customization is backed up first, so this can be undone.', confirmLabel: 'Restore backup' })) await restoreBackup(b.slot);
              }}>Restore</Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="studio-card" id="setting-resets">
        <h2>Resets</h2>
        <div className="reset-row">
          <span className="grow"><strong>Reset a category</strong><span className="muted small"> — in your general settings, or only the active workspace’s overrides.</span></span>
          <select className="input" aria-label="Category to reset" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)}>{CATEGORY_RESETS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <select className="input" aria-label="Where" value={where} onChange={(e) => setWhere(e.target.value as typeof where)}>
            <option value="baseline">General settings</option>
            <option value="workspace">Workspace “{wsName}”</option>
          </select>
          <Button onClick={() => void applyCustom({ op: 'resetCategory', category: cat, target: where })}>Reset</Button>
        </div>
        <div className="reset-row">
          <span className="grow"><strong>Restore the default Files appearance</strong><span className="muted small"> — Orbis Native, default colours, typography and background; layout and workspaces are kept.</span></span>
          <Button onClick={async () => {
            if (!(await confirm({ title: 'Restore the default appearance?', body: 'Selects the Orbis Native preset and resets appearance and accessibility in your general settings. Workspaces, layouts and shortcuts are kept. A backup is kept.', confirmLabel: 'Restore appearance' }))) return;
            await applyCustom({ op: 'applyPreset', id: 'orbis-native' });
            await applyCustom({ op: 'resetCategory', category: 'appearance', target: 'baseline' });
            await applyCustom({ op: 'resetCategory', category: 'accessibility', target: 'baseline' });
          }}>Restore appearance</Button>
        </div>
        <div className="reset-row">
          <span className="grow"><strong>Restore the default workspace</strong><span className="muted small"> — “Everyday” without its own overrides, and active.</span></span>
          <Button onClick={() => void applyCustom({ op: 'restoreDefaultWorkspace' })}>Restore workspace</Button>
        </div>
        <div className="reset-row danger-zone">
          <span className="grow"><strong>Restore the complete default customization</strong><span className="muted small"> — every customization setting, preset, workspace, saved view, layout, toolbar, menu and shortcut. Files, tags, collections, pins and other app data are not touched.</span></span>
          <Button variant="danger" onClick={() => void fullReset()}>Reset everything…</Button>
        </div>
      </section>
    </div>
  );
}

async function fullReset(): Promise<void> {
  const ok = await confirm({
    title: 'Reset all customization?',
    body: 'This restores the default appearance, layout, workspaces, views, toolbars, context menus, shortcuts, navigation and accessibility settings, and removes your presets, saved views and saved layouts.',
    detail: ['Not affected: your files and folders, tags, collections, pins, saved searches, projects, operations history and other settings.', 'A backup of the current customization is kept; you can restore it from Backups or undo this change.'],
    confirmLabel: 'Reset all customization',
    destructive: true,
  });
  if (!ok) return;
  const typed = await prompt({ title: 'Confirm the reset', label: 'Type RESET to confirm', initial: '', confirmLabel: 'Reset', validate: (v) => (v.trim() === 'RESET' ? undefined : 'Type RESET in capitals.') });
  if (typed?.trim() !== 'RESET') return;
  if (await applyCustom({ op: 'resetAll' })) toast({ level: 'success', title: 'Customization reset to the defaults', detail: 'A backup was kept in Reset & recovery.' });
}
