import React, { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { applyCustom, cancelPreview, custom, previewChange, useCustom } from '../../state/custom';
import { confirm, prompt, toast } from '../../state/app';
import { call } from '../../api';
import { Button, Pill } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { LAYOUT_DEFAULTS, PANE_ARRANGEMENTS, type Layout, type PaneArrangement } from '../../../shared/customization/schema';
import { LAYOUT_PRESETS } from '../../../shared/customization/presets';
import { normalizeRatios } from '../../../shared/customization/resolve';
import { fitLayout, requiredSize } from '../../../shared/customization/layout';
import { MoveButtons, SettingRow } from './controls';

const ARR_LABEL: Record<PaneArrangement, string> = { single: 'One pane', dual: 'Two side by side', 'dual-stacked': 'Two stacked', triple: 'Three side by side', quad: 'Four (2 × 2)' };

function mergeLayout(base: Layout, over: unknown): Layout {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries((over ?? {}) as Record<string, unknown>)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(out[k] as object), ...(v as object) } : v;
  }
  return out as unknown as Layout;
}

/**
 * The editor's state survives a remount: previewing or applying a different pane arrangement
 * rebuilds the panes, and with them the Studio shown in one of them. Without this, the remount
 * cancelled the preview it had just started and lost the draft.
 */
interface EditorState { draft: Layout; past: Layout[]; future: Layout[]; dirty: boolean }
let kept: EditorState | null = null;
let mountedEditors = 0;

/**
 * Layout editor. It edits a draft of the real layout model; Preview shows the
 * draft on the actual interface (with Apply/Cancel and an automatic end), and
 * Apply stores it as one undoable change in the active workspace. Panels can
 * be dragged to valid places on the map, or placed with the controls below.
 */
export function LayoutSection() {
  const effective = useCustom((r) => r.layout);
  const workspace = useCustom((r) => r.workspace.name);
  const saved = useStore(custom, (s) => s.server.config.savedLayouts);
  const previewing = useStore(custom, (s) => !!s.previewLabel);
  const [draft, setDraftRaw] = useState<Layout>(() => (kept?.dirty ? kept.draft : structuredClone(effective)));
  const [past, setPast] = useState<Layout[]>(() => (kept?.dirty ? kept.past : []));
  const [future, setFuture] = useState<Layout[]>(() => (kept?.dirty ? kept.future : []));
  const [dirty, setDirty] = useState(() => !!kept?.dirty);
  useEffect(() => {
    kept = { draft, past, future, dirty };
  }, [draft, past, future, dirty]);
  const [dragging, setDragging] = useState<'sidebar' | 'details' | null>(null);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // Follow outside changes (undo, workspace switch) while nothing is being edited here.
  useEffect(() => {
    if (!dirty && !previewing) setDraftRaw(structuredClone(effective));
    // Applied from the preview bar (or the same layout stored elsewhere): nothing is left to apply.
    else if (dirty && !previewing && JSON.stringify(draft) === JSON.stringify(effective)) {
      setDirty(false);
      setPast([]);
      setFuture([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective, dirty, previewing]);
  // Leaving the editor ends a preview that was started here (a remount is not leaving).
  useEffect(() => {
    mountedEditors++;
    return () => {
      mountedEditors--;
      setTimeout(() => {
        if (mountedEditors > 0) return;
        kept = null;
        cancelPreview();
      }, 0);
    };
  }, []);

  const setDraft = (next: Layout | ((d: Layout) => Layout)) => {
    let n = typeof next === 'function' ? next(draft) : next;
    // Safeguard: with the sidebar hidden the address bar stays, so another folder is always reachable.
    if (!n.sidebar.visible && !n.addressBar.visible) n = { ...n, addressBar: { visible: true } };
    n = { ...n, panes: { ...n.panes, ratios: normalizeRatios(n.panes.arrangement, n.panes.ratios) } };
    setPast((p) => [...p.slice(-49), draft]);
    setFuture([]);
    setDraftRaw(n);
    setDirty(true);
  };
  const upd = <K extends keyof Layout>(k: K, v: Partial<Layout[K]>) => setDraft((d) => ({ ...d, [k]: { ...(d[k] as object), ...v } }) as Layout);

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setFuture((f) => [draft, ...f]);
    setPast((p) => p.slice(0, -1));
    setDraftRaw(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, draft]);
    setFuture((f) => f.slice(1));
    setDraftRaw(next);
  };
  const apply = async () => {
    cancelPreview();
    // The panes may be rebuilt by this change (and this editor with them): start the next one clean.
    kept = null;
    if (await applyCustom({ op: 'setLayout', layout: draft, label: 'Applied a layout' })) {
      setDirty(false);
      setPast([]);
      setFuture([]);
      toast({ level: 'success', title: `Layout applied to workspace “${workspace}”`, detail: 'Undo with Ctrl+Alt+Z, or from Reset & recovery.' });
    }
  };
  const cancel = () => {
    cancelPreview();
    setDraftRaw(structuredClone(effective));
    setDirty(false);
    setPast([]);
    setFuture([]);
  };
  const fit = fitLayout(draft, win.w, win.h);
  const need = requiredSize(draft);

  const dropTo = (where: 'left' | 'right' | 'bottom') => {
    if (dragging === 'sidebar' && where !== 'bottom') upd('sidebar', { side: where, visible: true });
    if (dragging === 'details') upd('details', { position: where, visible: true });
    setDragging(null);
  };
  const dz = (where: 'left' | 'right' | 'bottom') => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging || (dragging === 'sidebar' && where === 'bottom')) return;
      e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dropTo(where);
    },
  });
  const chip = (r: 'sidebar' | 'details', label: string) => (
    <div className={`lm-panel lm-${r}`} draggable onDragStart={(e) => { setDragging(r); e.dataTransfer.setData('text/plain', r); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragging(null)} title="Drag to another edge">
      <Icon name="grip" size={12} /> {label}
    </div>
  );
  const sideItems = (side: 'left' | 'right') => {
    const items: Array<'sidebar' | 'details'> = [];
    if (draft.sidebar.visible && draft.sidebar.side === side) items.push('sidebar');
    if (draft.details.visible && draft.details.position === side) items.push('details');
    if (items.length === 2) {
      const outerFirst = draft.outermost === 'sidebar' ? ['sidebar', 'details'] : ['details', 'sidebar'];
      return (side === 'left' ? outerFirst : outerFirst.reverse()) as Array<'sidebar' | 'details'>;
    }
    return items;
  };
  const cols = draft.panes.arrangement === 'quad' ? 2 : draft.panes.arrangement === 'triple' ? 3 : draft.panes.arrangement === 'dual' ? 2 : 1;
  const rows = draft.panes.arrangement === 'quad' || draft.panes.arrangement === 'dual-stacked' ? 2 : 1;

  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-layoutEditor">
        <div className="studio-card-head">
          <h2>Layout editor {dirty && <Pill tone="accent">Not applied</Pill>}</h2>
          <div className="chip-row">
            <Button size="sm" icon="undo" disabled={!past.length} onClick={undo}>Undo</Button>
            <Button size="sm" icon="redo" disabled={!future.length} onClick={redo}>Redo</Button>
            <Button size="sm" icon="eye" disabled={!dirty} data-focus-key="layout-preview" onClick={() => previewChange({ op: 'setLayout', layout: draft }, 'layout')}>Preview</Button>
            <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void apply()}>Apply</Button>
            <Button size="sm" disabled={!dirty} onClick={cancel}>Cancel</Button>
            <Button size="sm" icon="save" onClick={async () => {
              const name = await prompt({ title: 'Save layout', label: 'Name', initial: 'My layout', confirmLabel: 'Save' });
              if (name) await applyCustom({ op: 'saveLayout', name, layout: draft });
            }}>Save layout…</Button>
            <Button size="sm" onClick={() => setDraft(structuredClone(LAYOUT_DEFAULTS))}>Restore default</Button>
          </div>
        </div>
        <p className="muted small">Drag the sidebar or details panel to another edge, or use the controls below. The map is drawn from the layout being edited. Preview shows it on the real window; nothing is stored until you apply (to workspace “{workspace}”).</p>
        <div className="layout-map" role="group" aria-label="Layout map">
          {draft.tabs.visible && <div className="lm-strip">Tabs</div>}
          <div className="lm-main">
            <div className={`lm-drop lm-drop-left ${dragging ? 'is-target' : ''}`} {...dz('left')} aria-hidden>{dragging && 'Left edge'}</div>
            {sideItems('left').map((r) => <React.Fragment key={r}>{chip(r, r === 'sidebar' ? 'Sidebar' : 'Details')}</React.Fragment>)}
            <div className="lm-center">
              {(draft.toolbar.visible || draft.addressBar.visible || draft.searchBox.visible) && (
                <div className="lm-strip lm-toolbar">{[draft.toolbar.visible && 'Toolbar', draft.addressBar.visible && 'Address bar', draft.searchBox.visible && 'Search'].filter(Boolean).join(' · ')}</div>
              )}
              <div className="lm-panes" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
                {Array.from({ length: cols * rows }, (_, i) => <div key={i} className="lm-pane">Pane {i + 1}</div>)}
              </div>
              {draft.details.visible && draft.details.position === 'bottom' && chip('details', 'Details (bottom)')}
              {draft.shelf.visible && <div className="lm-strip">Shelf</div>}
              {draft.operations.dock === 'bottom' && <div className="lm-strip">Operations</div>}
              {draft.statusBar.visible && <div className="lm-strip lm-status">Status bar</div>}
              <div className={`lm-drop lm-drop-bottom ${dragging === 'details' ? 'is-target' : ''}`} {...dz('bottom')} aria-hidden>{dragging === 'details' && 'Bottom'}</div>
            </div>
            {sideItems('right').map((r) => <React.Fragment key={r}>{chip(r, r === 'sidebar' ? 'Sidebar' : 'Details')}</React.Fragment>)}
            <div className={`lm-drop lm-drop-right ${dragging ? 'is-target' : ''}`} {...dz('right')} aria-hidden>{dragging && 'Right edge'}</div>
          </div>
        </div>
        <p className={`small ${fit.adjustments.length ? 'warning-text' : 'muted'}`}>
          Needs at least {need.width} × {need.height} px; this window is {win.w} × {win.h}.{fit.adjustments.length ? ` In this window: ${fit.adjustments.join(' ')} (the saved layout stays as you set it).` : ' It fits.'}
        </p>
      </section>

      <section className="studio-card">
        <h2>Panes</h2>
        <SettingRow id="arrangement" label="Panes" description="Each pane has its own folder, history, view and selection. Copying or moving between panes uses the normal operation queue.">
          <div className="segmented" role="radiogroup" aria-labelledby="label-arrangement">
            {PANE_ARRANGEMENTS.map((a) => <button key={a} type="button" role="radio" aria-checked={draft.panes.arrangement === a} className={draft.panes.arrangement === a ? 'on' : ''} onClick={() => upd('panes', { arrangement: a, ratios: normalizeRatios(a, []) })}>{ARR_LABEL[a]}</button>)}
          </div>
        </SettingRow>
        {draft.panes.ratios.map((r, i) => (
          <SettingRow key={i} id={`ratio-${i}`} label={draft.panes.arrangement === 'quad' ? (i === 0 ? 'Column split' : 'Row split') : draft.panes.arrangement === 'dual-stacked' ? 'Split between top and bottom' : `Split ${i + 1}`}>
            <span className="slider"><input type="range" min={0.15} max={0.85} step={0.01} value={r} aria-labelledby={`label-ratio-${i}`} onChange={(e) => upd('panes', { ratios: draft.panes.ratios.map((x, j) => (j === i ? Number(e.target.value) : x)) })} /><output>{Math.round(r * 100)}%</output></span>
          </SettingRow>
        ))}
      </section>

      <section className="studio-card">
        <h2>Panels</h2>
        <SettingRow id="sidebarVisible" label="Sidebar">
          <button type="button" role="switch" aria-checked={draft.sidebar.visible} aria-labelledby="label-sidebarVisible" className={`switch ${draft.sidebar.visible ? 'on' : ''}`} onClick={() => upd('sidebar', { visible: !draft.sidebar.visible })}><span /></button>
        </SettingRow>
        <SettingRow id="sidebarSide" label="Sidebar position">
          <div className="segmented" role="radiogroup" aria-labelledby="label-sidebarSide">
            {(['left', 'right'] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={draft.sidebar.side === v} className={draft.sidebar.side === v ? 'on' : ''} onClick={() => upd('sidebar', { side: v })}>{v === 'left' ? 'Left' : 'Right'}</button>)}
          </div>
        </SettingRow>
        <SettingRow id="sidebarWidth" label="Sidebar width">
          <span className="slider"><input type="range" min={180} max={480} step={10} value={draft.sidebar.width} aria-labelledby="label-sidebarWidth" onChange={(e) => upd('sidebar', { width: Number(e.target.value) })} /><output>{draft.sidebar.width}px</output></span>
        </SettingRow>
        <SettingRow id="detailsVisible" label="Details panel (preview and properties)">
          <button type="button" role="switch" aria-checked={draft.details.visible} aria-labelledby="label-detailsVisible" className={`switch ${draft.details.visible ? 'on' : ''}`} onClick={() => upd('details', { visible: !draft.details.visible })}><span /></button>
        </SettingRow>
        <SettingRow id="detailsPosition" label="Details panel position">
          <div className="segmented" role="radiogroup" aria-labelledby="label-detailsPosition">
            {(['right', 'left', 'bottom'] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={draft.details.position === v} className={draft.details.position === v ? 'on' : ''} onClick={() => upd('details', { position: v })}>{v[0]!.toUpperCase() + v.slice(1)}</button>)}
          </div>
        </SettingRow>
        {draft.details.position === 'bottom' ? (
          <SettingRow id="detailsHeight" label="Details panel height">
            <span className="slider"><input type="range" min={160} max={600} step={10} value={draft.details.height} aria-labelledby="label-detailsHeight" onChange={(e) => upd('details', { height: Number(e.target.value) })} /><output>{draft.details.height}px</output></span>
          </SettingRow>
        ) : (
          <SettingRow id="detailsWidth" label="Preview panel width">
            <span className="slider"><input type="range" min={260} max={640} step={10} value={draft.details.width} aria-labelledby="label-detailsWidth" onChange={(e) => upd('details', { width: Number(e.target.value) })} /><output>{draft.details.width}px</output></span>
          </SettingRow>
        )}
        <SettingRow id="detailsContent" label="Details panel shows">
          <label className="check"><input type="checkbox" checked={draft.details.showPreview} onChange={(e) => upd('details', { showPreview: e.target.checked || !draft.details.showProperties })} /> Preview</label>
          <label className="check"><input type="checkbox" checked={draft.details.showProperties} onChange={(e) => upd('details', { showProperties: e.target.checked || !draft.details.showPreview })} /> Properties</label>
        </SettingRow>
        {draft.sidebar.visible && draft.details.visible && draft.sidebar.side === draft.details.position && (
          <SettingRow id="outermost" label="Order on the shared edge" description="Both panels are on the same edge; choose which is outermost.">
            <div className="segmented" role="radiogroup" aria-labelledby="label-outermost">
              {(['sidebar', 'details'] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={draft.outermost === v} className={draft.outermost === v ? 'on' : ''} onClick={() => setDraft((d) => ({ ...d, outermost: v }))}>{v === 'sidebar' ? 'Sidebar outermost' : 'Details outermost'}</button>)}
            </div>
          </SettingRow>
        )}
      </section>

      <section className="studio-card">
        <h2>Bars and areas</h2>
        <SettingRow id="regions" label="Show" description="With the sidebar hidden, the address bar always stays so you can reach any folder.">
          {([['toolbar', 'Toolbar buttons'], ['addressBar', 'Address bar (breadcrumbs)'], ['searchBox', 'Search box'], ['tabs', 'Tab strip'], ['statusBar', 'Status bar'], ['shelf', 'Shelf (drop stack)']] as const).map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={draft[k].visible} disabled={k === 'addressBar' && !draft.sidebar.visible} onChange={(e) => upd(k, { visible: e.target.checked })} /> {label}</label>
          ))}
        </SettingRow>
        <SettingRow id="operations" label="Operations area" description="Copy, move and other operations: a floating panel opened from the status bar or Ctrl+J, or docked under the files.">
          <div className="segmented" role="radiogroup" aria-labelledby="label-operations">
            {(['overlay', 'bottom'] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={draft.operations.dock === v} className={draft.operations.dock === v ? 'on' : ''} onClick={() => upd('operations', { dock: v })}>{v === 'overlay' ? 'Floating panel' : 'Docked at the bottom'}</button>)}
          </div>
          {draft.operations.dock === 'bottom' && <span className="slider"><input type="range" min={140} max={480} step={10} value={draft.operations.height} aria-label="Operations area height" onChange={(e) => upd('operations', { height: Number(e.target.value) })} /><output>{draft.operations.height}px</output></span>}
        </SettingRow>
      </section>

      <section className="studio-card" id="setting-layoutPresets">
        <h2>Layout presets</h2>
        <p className="muted small">Loads a preset into the editor (keeping your widths where the preset does not set them). Preview or apply it from there.</p>
        <div className="preset-grid">
          {LAYOUT_PRESETS.map((p) => (
            <button key={p.id} type="button" className="preset-card" onClick={() => setDraft((d) => mergeLayout(d, p.layout))}>
              <strong>{p.name}</strong>
              <span className="muted small">{p.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="studio-card" id="setting-savedLayouts">
        <h2>Saved layouts</h2>
        {!saved.length && <p className="muted">No saved layouts yet. Use “Save layout…” above.</p>}
        <ul className="studio-list">
          {saved.map((l, i) => (
            <li key={l.id} className="studio-list-row">
              <Icon name="layout" size={15} />
              <span className="grow"><strong>{l.name}</strong> <span className="muted small">{ARR_LABEL[l.layout.panes.arrangement]}</span></span>
              <Button size="sm" onClick={() => setDraft(structuredClone(l.layout))}>Edit</Button>
              <Button size="sm" onClick={() => previewChange({ op: 'applyLayout', id: l.id }, `layout “${l.name}”`)}>Preview</Button>
              <Button size="sm" variant="primary" onClick={() => void applyCustom({ op: 'applyLayout', id: l.id })}>Apply</Button>
              <Button size="sm" variant="ghost" title="Store the layout being edited under this name" disabled={!dirty} onClick={() => void applyCustom({ op: 'updateLayout', id: l.id, layout: draft })}>Save over</Button>
              <Button size="sm" variant="ghost" onClick={() => void applyCustom({ op: 'duplicateLayout', id: l.id })}>Duplicate</Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                const name = await prompt({ title: 'Rename layout', label: 'Name', initial: l.name, confirmLabel: 'Rename' });
                if (name) await applyCustom({ op: 'renameLayout', id: l.id, name });
              }}>Rename</Button>
              <Button size="sm" variant="ghost" icon="exportFile" onClick={() => void call('custom:export', { kind: 'layout', id: l.id, systemDark: custom.get().system.dark }).then((r) => r && toast({ level: 'success', title: 'Layout exported', detail: (r as { path: string }).path }))}>Export</Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                if (await confirm({ title: `Delete layout “${l.name}”?`, body: 'Only this saved layout is removed. The layout in use stays as it is.', confirmLabel: 'Delete layout' })) await applyCustom({ op: 'deleteLayout', id: l.id });
              }}>Delete</Button>
              <MoveButtons label={l.name} index={i} count={saved.length} onMove={(to) => void applyCustom({ op: 'moveLayout', id: l.id, toIndex: to }, { quiet: true })} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

