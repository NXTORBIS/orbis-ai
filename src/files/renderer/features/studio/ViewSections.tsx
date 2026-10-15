
import { useStore } from '../../state/store';
import { app, confirm, prompt, toast } from '../../state/app';
import { call } from '../../api';
import { applyCustom, custom, useCustom } from '../../state/custom';
import { activePane, applyViewDefaultsToPanes } from '../../state/workspace';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { DEFAULT_COLUMNS, GROUP_KEYS, SORT_KEYS, VIEW_MODES, type ColumnConfig, type ViewSettings } from '../../../shared/customization/schema';
import { allColumns, COLUMN_LABEL, META_COLUMNS } from '../FileViews';
import { applySavedView, saveCurrentView } from '../SavedViews';
import { MoveButtons, SettingRow, setValue, useDragList, moveItem } from './controls';

const VIEW_LABEL: Record<(typeof VIEW_MODES)[number], string> = { details: 'Details', list: 'List', compact: 'Compact list', grid: 'Icon grid', thumbnails: 'Large thumbnails', gallery: 'Gallery', columns: 'Columns', tree: 'Tree' };
const SORT_LABEL: Record<(typeof SORT_KEYS)[number], string> = { name: 'Name', size: 'Size', modified: 'Date modified', created: 'Date created', accessed: 'Date accessed', type: 'Type', ext: 'Extension', tags: 'Tags', dimensions: 'Dimensions', duration: 'Duration', taken: 'Date taken' };
const GROUP_LABEL: Record<(typeof GROUP_KEYS)[number], string> = { none: 'None', type: 'Type', modified: 'Date modified', created: 'Date created', size: 'Size', kind: 'Category', tags: 'Tags' };
const V = (...path: string[]) => ({ section: 'view' as const, path });

/** Default view for new tabs (and for open panes on request), and saved views. */
export function ViewsSection() {
  const v = useCustom((r) => r.view);
  const saved = useStore(custom, (s) => s.server.config.savedViews);
  const setThen = (thenBy: ViewSettings['thenBy']) => setValue(V('thenBy'), thenBy, { label: 'Further sort keys' });
  const drag = useDragList((from, to) => void applyCustom({ op: 'moveView', id: saved[from]!.id, toIndex: to }, { quiet: true }), 'view');
  return (
    <div className="studio-sections">
      <section className="studio-card">
        <h2>Defaults for new tabs</h2>
        <p className="muted small">Each pane keeps its own view, sorting and grouping; these are what a new tab starts with. Every mode shows the real folder contents.</p>
        <SettingRow id="defaultView" label="View mode" path={V('view')}>
          <select className="input" aria-labelledby="label-defaultView" value={v.view} onChange={(e) => setValue(V('view'), e.target.value)}>
            {VIEW_MODES.map((m) => <option key={m} value={m}>{VIEW_LABEL[m]}</option>)}
          </select>
        </SettingRow>
        <SettingRow id="defaultSort" label="Sort by" path={V('sort', 'key')}>
          <select className="input" aria-labelledby="label-defaultSort" value={v.sort.key} onChange={(e) => setValue(V('sort'), { ...v.sort, key: e.target.value }, { label: 'Default sorting' })}>
            {SORT_KEYS.map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </select>
          <div className="segmented" role="radiogroup" aria-label="Direction">
            {(['asc', 'desc'] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={v.sort.dir === d} className={v.sort.dir === d ? 'on' : ''} onClick={() => setValue(V('sort'), { ...v.sort, dir: d })}>{d === 'asc' ? 'Ascending' : 'Descending'}</button>)}
          </div>
          <label className="check"><input type="checkbox" checked={v.sort.foldersFirst} onChange={(e) => setValue(V('sort'), { ...v.sort, foldersFirst: e.target.checked })} /> Folders first</label>
        </SettingRow>
        <SettingRow id="thenBy" label="Then by" description="Used, in this order, when the earlier keys are equal; the name breaks any remaining tie." path={V('thenBy')}>
          <div className="then-list">
            {v.thenBy.map((t, i) => (
              <span key={t.key} className="then-item">
                <span className="muted">{i + 2}.</span>
                <select className="input" aria-label={`Sort key ${i + 2}`} value={t.key} onChange={(e) => setThen(v.thenBy.map((x, j) => (j === i ? { ...x, key: e.target.value as typeof x.key } : x)))}>
                  {SORT_KEYS.filter((k) => k === t.key || (k !== v.sort.key && !v.thenBy.some((x) => x.key === k))).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setThen(v.thenBy.map((x, j) => (j === i ? { ...x, dir: x.dir === 'asc' ? 'desc' : 'asc' } : x)))}>{t.dir === 'asc' ? 'Ascending' : 'Descending'}</button>
                <MoveButtons label={SORT_LABEL[t.key]} index={i} count={v.thenBy.length} onMove={(to) => setThen(moveItem(v.thenBy, i, to))} />
                <button type="button" className="icon-btn" aria-label={`Remove ${SORT_LABEL[t.key]}`} onClick={() => setThen(v.thenBy.filter((_, j) => j !== i))}><Icon name="close" size={13} /></button>
              </span>
            ))}
            {v.thenBy.length < 3 && (
              <Button size="sm" icon="plus" onClick={() => {
                const next = SORT_KEYS.find((k) => k !== v.sort.key && !v.thenBy.some((x) => x.key === k));
                if (next) setThen([...v.thenBy, { key: next, dir: 'asc' }]);
              }}>Add sort key</Button>
            )}
          </div>
        </SettingRow>
        <SettingRow id="groupBy" label="Group by" path={V('groupBy')}>
          <select className="input" aria-labelledby="label-groupBy" value={v.groupBy} onChange={(e) => setValue(V('groupBy'), e.target.value)}>
            {GROUP_KEYS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
          </select>
        </SettingRow>
        <div className="chip-row">
          <Button size="sm" onClick={() => { applyViewDefaultsToPanes(); toast({ level: 'info', title: 'Open panes now use these defaults', detail: 'Their folders and selections were kept.' }); }}>Apply to open panes</Button>
        </div>
      </section>

      <section className="studio-card" id="setting-savedViews">
        <div className="studio-card-head">
          <h2>Saved views</h2>
          <Button size="sm" icon="save" onClick={() => void saveCurrentView(activePane())}>Save the current pane’s view…</Button>
        </div>
        <p className="muted small">A view stores the view mode, columns, sorting, grouping, sizes, density, preview visibility and filter. Applying one never changes files.</p>
        {!saved.length && <p className="muted">No saved views yet.</p>}
        <ul className="studio-list">
          {saved.map((s, i) => (
            <li key={s.id} className={`studio-list-row ${drag.over === i ? 'is-drop' : ''}`} {...drag.props(i)}>
              <Icon name="grip" size={13} className="muted" />
              <span className="grow"><strong>{s.name}</strong> <span className="muted small">{VIEW_LABEL[s.view]} · by {SORT_LABEL[s.sort.key]}{s.thenBy.length ? ` then ${s.thenBy.map((t) => SORT_LABEL[t.key]).join(', ')}` : ''}{s.groupBy !== 'none' ? ` · grouped by ${GROUP_LABEL[s.groupBy]}` : ''}{s.filter ? ` · filter “${s.filter}”` : ''}</span></span>
              <Button size="sm" variant="primary" onClick={() => void applySavedView(activePane(), s.id)}>Apply to current pane</Button>
              <Button size="sm" variant="ghost" title="Replace with the current pane’s view" onClick={async () => {
                const p = activePane();
                const r = custom.get().resolved;
                await applyCustom({ op: 'updateView', id: s.id, view: { name: s.name, view: p.view, columns: r.view.columns, sort: p.sort, thenBy: p.thenBy, groupBy: p.groupBy, iconSize: r.appearance.iconSize, thumbnailSize: r.appearance.thumbnailSize, density: r.appearance.density, previewVisible: r.layout.details.visible, filter: p.filter } });
              }}>Update</Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                const name = await prompt({ title: 'Rename view', label: 'Name', initial: s.name, confirmLabel: 'Rename' });
                if (name) await applyCustom({ op: 'renameView', id: s.id, name });
              }}>Rename</Button>
              <Button size="sm" variant="ghost" icon="exportFile" onClick={() => void call<{ path: string } | null>('custom:export', { kind: 'view', id: s.id, systemDark: custom.get().system.dark }).then((r) => r && toast({ level: 'success', title: 'View exported', detail: r.path }))}>Export</Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                if (await confirm({ title: `Delete view “${s.name}”?`, body: 'Only the saved view is removed.', confirmLabel: 'Delete view' })) await applyCustom({ op: 'deleteView', id: s.id });
              }}>Delete</Button>
              <MoveButtons label={s.name} index={i} count={saved.length} onMove={(to) => void applyCustom({ op: 'moveView', id: s.id, toIndex: to }, { quiet: true })} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const COLUMN_NOTE: Record<string, string> = {
  dimensions: 'Read from inside image, video and PDF files when shown.',
  duration: 'Read from inside audio and video files when shown.',
  taken: 'Read from photo metadata (EXIF) when shown.',
  checksum: 'Only checksums you calculated (right-click → Calculate checksum), kept across restarts while the file is unchanged; otherwise “Not calculated”.',
  volume: 'From the drives the system reports.',
  owner: 'Owner names where the system provides them.',
  attributes: 'Permissions (POSIX) or read-only state.',
  tags: 'Tags you added in Orbis Files.',
};

/** Columns: visibility, order, width and pinning, with reusable column sets. */
export function ColumnsSection() {
  const cols = useCustom((r) => r.view.columns);
  const sets = useStore(custom, (s) => s.server.config.columnSets);
  useStore(app, (s) => s.volumes);
  const full = allColumns(cols);
  const save = (next: ColumnConfig[], label: string) => setValue(V('columns'), next, { label });
  const drag = useDragList((from, to) => save(moveItem(full, from, to), 'Reordered columns'), 'column');
  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-columnEditor">
        <div className="studio-card-head">
          <h2>Columns (Details view)</h2>
          <Button size="sm" onClick={() => save(DEFAULT_COLUMNS, 'Default columns')}>Restore default columns</Button>
        </div>
        <p className="muted small">Pinned columns stay in view when the list scrolls sideways. Columns without data for an item show it honestly as empty or “Not calculated”. Saved to the active workspace when it has its own columns.</p>
        <ul className="studio-list">
          {full.map((c, i) => (
            <li key={c.id} className={`studio-list-row ${drag.over === i ? 'is-drop' : ''}`} {...drag.props(i)}>
              <Icon name="grip" size={13} className="muted" />
              <label className="check grow">
                <input type="checkbox" checked={c.visible} disabled={c.id === 'name'} onChange={(e) => save(full.map((x) => (x.id === c.id ? { ...x, visible: e.target.checked } : x)), `${e.target.checked ? 'Showed' : 'Hid'} the ${COLUMN_LABEL(c.id)} column`)} />
                <span><strong>{COLUMN_LABEL(c.id)}</strong>{c.id === 'name' && <span className="muted small"> (always shown)</span>}{(COLUMN_NOTE[c.id] || META_COLUMNS.has(c.id)) && <span className="muted small"> — {COLUMN_NOTE[c.id]}</span>}</span>
              </label>
              <label className="check"><input type="checkbox" checked={c.pinned} onChange={(e) => save(full.map((x) => (x.id === c.id ? { ...x, pinned: e.target.checked } : x)), `${e.target.checked ? 'Pinned' : 'Unpinned'} the ${COLUMN_LABEL(c.id)} column`)} /> Pinned</label>
              <label className="check">Width <input type="number" className="input narrow" min={48} max={1200} value={c.width} onChange={(e) => {
                const w = Math.max(48, Math.min(1200, Number(e.target.value) || 48));
                setValue(V('columns'), full.map((x) => (x.id === c.id ? { ...x, width: w } : x)), { live: true, label: `Resized the ${COLUMN_LABEL(c.id)} column` });
              }} /> px</label>
              <MoveButtons label={COLUMN_LABEL(c.id)} index={i} count={full.length} onMove={(to) => save(moveItem(full, i, to), `Moved the ${COLUMN_LABEL(c.id)} column`)} />
            </li>
          ))}
        </ul>
      </section>
      <section className="studio-card" id="setting-columnSets">
        <div className="studio-card-head">
          <h2>Column sets</h2>
          <Button size="sm" icon="save" onClick={async () => {
            const name = await prompt({ title: 'Save column set', label: 'Name', initial: 'My columns', confirmLabel: 'Save' });
            if (name) await applyCustom({ op: 'saveColumns', name });
          }}>Save current columns…</Button>
        </div>
        {!sets.length && <p className="muted">No column sets yet.</p>}
        <ul className="studio-list">
          {sets.map((s) => (
            <li key={s.id} className="studio-list-row">
              <span className="grow"><strong>{s.name}</strong> <span className="muted small">{s.columns.filter((c) => c.visible).map((c) => COLUMN_LABEL(c.id)).join(', ')}</span></span>
              <Button size="sm" variant="primary" onClick={() => void applyCustom({ op: 'applyColumns', id: s.id })}>Use</Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                const name = await prompt({ title: 'Rename column set', label: 'Name', initial: s.name, confirmLabel: 'Rename' });
                if (name) await applyCustom({ op: 'renameColumns', id: s.id, name });
              }}>Rename</Button>
              <Button size="sm" variant="ghost" onClick={() => void applyCustom({ op: 'deleteColumns', id: s.id })}>Delete</Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
