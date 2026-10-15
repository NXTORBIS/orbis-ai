import { useState } from 'react';
import { useStore } from '../../state/store';
import { applyCustom, custom, previewChange } from '../../state/custom';
import { confirm, prompt, toast } from '../../state/app';
import { call } from '../../api';
import { Button, Pill } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { WORKSPACE_TEMPLATES } from '../../../shared/customization/presets';
import { DEFAULT_WORKSPACE_ID, type LayerValues } from '../../../shared/customization/schema';
import { describeOverrides } from '../Dialogs';
import { MoveButtons, useDragList } from './controls';
import { studio } from './studioState';

const SECTION_LABEL: Record<string, string> = { appearance: 'Appearance', layout: 'Layout', view: 'File views', accessibility: 'Accessibility', navigation: 'Navigation', toolbar: 'Toolbar' };

/**
 * Named workspaces: each stores its own layout, panels, view mode, columns,
 * sorting, grouping, saved filters, preview behaviour, toolbar, navigation,
 * density and appearance overrides — everything else is inherited from your
 * general settings and the preset. Switching or deleting a workspace never
 * touches files.
 */
export function WorkspacesSection() {
  const cfg = useStore(custom, (s) => s.server.config);
  const [template, setTemplate] = useState(WORKSPACE_TEMPLATES[1]!.id);
  const drag = useDragList((from, to) => void applyCustom({ op: 'moveWorkspace', id: cfg.workspaces[from]!.id, toIndex: to }, { quiet: true }), 'workspace');
  const active = cfg.workspaces.find((w) => w.id === cfg.activeWorkspaceId);

  const exportWs = (id: string) => void call<{ path: string } | null>('custom:export', { kind: 'workspace', id, systemDark: custom.get().system.dark }).then((r) => r && toast({ level: 'success', title: 'Workspace exported', detail: r.path }), (e) => toast({ level: 'error', title: 'Export failed', detail: (e as Error).message }));

  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-workspaceList">
        <div className="studio-card-head">
          <h2>Your workspaces</h2>
          <div className="chip-row">
            <Button size="sm" icon="plus" onClick={async () => {
              const name = await prompt({ title: 'New workspace from the current setup', label: 'Name', initial: 'My workspace', confirmLabel: 'Create' });
              if (name) await applyCustom({ op: 'createWorkspace', name, fromCurrent: true });
            }}>New from current</Button>
            <Button size="sm" icon="importFile" onClick={() => studio.set({ category: 'portability' })}>Import…</Button>
            <Button size="sm" variant="ghost" onClick={async () => {
              if (await confirm({ title: 'Restore the default workspace?', body: 'The “Everyday” workspace loses its own layout, view, toolbar and navigation settings (its saved filters are kept) and becomes active. Other workspaces are not changed. No files are affected.', confirmLabel: 'Restore' })) await applyCustom({ op: 'restoreDefaultWorkspace' });
            }}>Restore default workspace</Button>
          </div>
        </div>
        <p className="muted small">Switching workspace changes only the interface. Open folders stay open; files are never moved, copied or changed. Drag to reorder, or use the arrows.</p>
        <ul className="studio-list">
          {cfg.workspaces.map((w, i) => (
            <li key={w.id} className={`studio-list-row ${w.id === cfg.activeWorkspaceId ? 'is-active' : ''} ${drag.over === i ? 'is-drop' : ''}`} {...drag.props(i)}>
              <Icon name="grip" size={13} className="muted" />
              <Icon name="workspace" size={15} />
              <span className="grow">
                <strong>{w.name}</strong> {w.id === cfg.activeWorkspaceId && <Pill tone="accent">Active</Pill>}
                <span className="muted small"> {describeOverrides(w.overrides as Record<string, unknown>)}{w.savedFilters.length ? ` · ${w.savedFilters.length} saved filter${w.savedFilters.length === 1 ? '' : 's'}` : ''}</span>
              </span>
              {w.id !== cfg.activeWorkspaceId && <Button size="sm" variant="primary" onClick={() => void applyCustom({ op: 'activateWorkspace', id: w.id })}>Switch</Button>}
              {w.id !== cfg.activeWorkspaceId && <Button size="sm" data-focus-key={`workspace-preview-${w.id}`} onClick={() => previewChange({ op: 'activateWorkspace', id: w.id }, `workspace “${w.name}”`)}>Preview</Button>}
              <Button size="sm" variant="ghost" onClick={async () => {
                const name = await prompt({ title: 'Rename workspace', label: 'Name', initial: w.name, confirmLabel: 'Rename' });
                if (name) await applyCustom({ op: 'renameWorkspace', id: w.id, name });
              }}>Rename</Button>
              <Button size="sm" variant="ghost" onClick={() => void applyCustom({ op: 'duplicateWorkspace', id: w.id })}>Duplicate</Button>
              <Button size="sm" variant="ghost" icon="exportFile" onClick={() => exportWs(w.id)}>Export</Button>
              <Button size="sm" variant="ghost" disabled={cfg.workspaces.length === 1} title={cfg.workspaces.length === 1 ? 'The last workspace cannot be deleted; restore it instead.' : undefined} onClick={async () => {
                if (await confirm({ title: `Delete workspace “${w.name}”?`, body: 'Only this workspace’s interface settings are deleted. No files, folders, tags or collections are touched. A backup is kept in Reset & recovery.', confirmLabel: 'Delete workspace', destructive: true })) await applyCustom({ op: 'deleteWorkspace', id: w.id });
              }}>Delete</Button>
              <MoveButtons label={w.name} index={i} count={cfg.workspaces.length} onMove={(to) => void applyCustom({ op: 'moveWorkspace', id: w.id, toIndex: to }, { quiet: true })} />
            </li>
          ))}
        </ul>
      </section>

      <section className="studio-card">
        <h2>New workspace from a template</h2>
        <p className="muted small">Templates are starting points made of ordinary settings; change anything afterwards.</p>
        <div className="preset-grid" role="radiogroup" aria-label="Workspace templates">
          {WORKSPACE_TEMPLATES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={template === t.id} className={`preset-card ${template === t.id ? 'is-active' : ''}`} onClick={() => setTemplate(t.id)}>
              <strong>{t.name}</strong>
              <span className="muted small">{t.description}</span>
            </button>
          ))}
        </div>
        <div className="chip-row">
          <Button variant="primary" icon="plus" onClick={async () => {
            const t = WORKSPACE_TEMPLATES.find((x) => x.id === template)!;
            const name = await prompt({ title: `New workspace (${t.name})`, label: 'Name', initial: t.name, confirmLabel: 'Create' });
            if (name) await applyCustom({ op: 'createWorkspace', name, template: t.id });
          }}>Create from template</Button>
        </div>
      </section>

      {active && (
        <section className="studio-card" id="setting-workspaceFilters">
          <h2>What “{active.name}” sets itself</h2>
          <OverrideList overrides={active.overrides} />
          <h3>Saved filters</h3>
          {!active.savedFilters.length && <p className="muted small">None. Type in a folder’s filter box and choose “Save this filter”.</p>}
          <ul className="studio-list">
            {active.savedFilters.map((f) => (
              <li key={f.id} className="studio-list-row">
                <Icon name="search" size={14} />
                <span className="grow"><strong>{f.name}</strong> <code className="muted small">{f.filter}</code></span>
                <Button size="sm" variant="ghost" onClick={() => void applyCustom({ op: 'removeSavedFilter', id: f.id })}>Remove</Button>
              </li>
            ))}
          </ul>
          {active.id === DEFAULT_WORKSPACE_ID && <p className="muted small">This is the default workspace.</p>}
        </section>
      )}
    </div>
  );
}

function OverrideList({ overrides }: { overrides: LayerValues }) {
  const keys = (Object.keys(overrides) as Array<keyof LayerValues>).filter((k) => overrides[k] !== undefined);
  if (!keys.length) return <p className="muted small">Nothing: it uses your general settings and the preset.</p>;
  return (
    <ul className="studio-list">
      {keys.map((k) => (
        <li key={k} className="studio-list-row">
          <span className="grow"><strong>{SECTION_LABEL[k] ?? k}</strong> <span className="muted small">{summarize(overrides[k])}</span></span>
          <Button size="sm" variant="ghost" onClick={() => void (k === 'toolbar'
            ? applyCustom({ op: 'resetCategory', category: 'toolbar', target: 'workspace' })
            : applyCustom({ op: 'resetCategory', category: k === 'view' ? 'view' : k, target: 'workspace' }))}>Use general settings</Button>
        </li>
      ))}
    </ul>
  );
}

function summarize(v: unknown): string {
  const leaves: string[] = [];
  const walk = (x: unknown, p: string) => {
    if (x && typeof x === 'object' && !Array.isArray(x)) for (const [k, y] of Object.entries(x)) walk(y, p ? `${p}.${k}` : k);
    else leaves.push(p);
  };
  walk(v, '');
  return leaves.slice(0, 6).join(', ') + (leaves.length > 6 ? ` and ${leaves.length - 6} more` : '');
}
