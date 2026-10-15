import { useEffect, useState } from 'react';
import { call } from '../../api';
import { app, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { useCustom } from '../../state/custom';
import { Button, Pill } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { SIDEBAR_SECTIONS, type Navigation } from '../../../shared/customization/schema';
import { Choice, moveItem, MoveButtons, SettingRow, setValue, Slider, useDragList, useValue } from './controls';

const N = (...path: string[]) => ({ section: 'navigation' as const, path });
const SECTION_LABEL: Record<(typeof SIDEBAR_SECTIONS)[number], string> = { quick: 'Quick access', pinned: 'Pinned', drives: 'Drives', remote: 'Remote', library: 'Library', collections: 'Collections', searches: 'Saved searches', tags: 'Tags', tools: 'Tools', universe: 'Universe' };

/** Sidebar sections, the folder tree, the start folder and saved locations. */
export function NavigationSection() {
  const nav = useCustom((r) => r.navigation);
  const sections = (() => {
    const listed = nav.sections.map((s) => s.id);
    return [...nav.sections, ...SIDEBAR_SECTIONS.filter((id) => !listed.includes(id)).map((id) => ({ id, visible: true }))];
  })();
  const saveSections = (next: Navigation['sections'], label: string) => setValue(N('sections'), next, { label });
  const drag = useDragList((from, to) => saveSections(moveItem(sections, from, to), 'Reordered sidebar sections'), 'nav-section');
  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-sections">
        <h2>Sidebar sections</h2>
        <p className="muted small">Drag or use the arrows to reorder. Hidden sections keep their contents; nothing is deleted.</p>
        <ul className="studio-list">
          {sections.map((s, i) => (
            <li key={s.id} className={`studio-list-row ${drag.over === i ? 'is-drop' : ''}`} {...drag.props(i)}>
              <Icon name="grip" size={13} className="muted" />
              <label className="check grow"><input type="checkbox" checked={s.visible} onChange={(e) => saveSections(sections.map((x) => (x.id === s.id ? { ...x, visible: e.target.checked } : x)), `${e.target.checked ? 'Showed' : 'Hid'} ${SECTION_LABEL[s.id]}`)} /> {SECTION_LABEL[s.id]}</label>
              <MoveButtons label={SECTION_LABEL[s.id]} index={i} count={sections.length} onMove={(to) => saveSections(moveItem(sections, i, to), 'Reordered sidebar sections')} />
            </li>
          ))}
        </ul>
        <SettingRow id="indicators" label="Indicators" path={N('indicators', 'driveUsage')}>
          {([['driveUsage', 'Drive usage bars'], ['counts', 'Item counts'], ['treeDetails', 'Sizes and dates in the tree'], ['tagDots', 'Tag dots']] as const).map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={nav.indicators[k]} onChange={(e) => setValue(N('indicators', k), e.target.checked, { label })} /> {label}</label>
          ))}
        </SettingRow>
        <SettingRow id="navDensity" label="Navigation density" path={N('density')}>
          <Choice id="navDensity" path={N('density')} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'spacious', label: 'Spacious' }]} />
        </SettingRow>
        <SettingRow id="folderIcons" label="Folder icons" path={N('folderIcons')}>
          <Choice id="folderIcons" path={N('folderIcons')} options={[{ value: 'colored', label: 'Coloured' }, { value: 'monochrome', label: 'Monochrome' }]} />
        </SettingRow>
      </section>
      <section className="studio-card">
        <h2>Folder tree (Tree view)</h2>
        <SettingRow id="indent" label="Indentation" path={N('indent')}><Slider id="indent" path={N('indent')} min={8} max={32} step={1} format={(v) => `${v}px`} label="Tree indentation" /></SettingRow>
        <SettingRow id="treeExpand" label="When a tree opens" path={N('treeExpand')}>
          <Choice id="treeExpand" path={N('treeExpand')} options={[{ value: 'remember', label: 'Remember what was open' }, { value: 'collapsed', label: 'Start collapsed' }, { value: 'first-level', label: 'Open the first level' }]} />
        </SettingRow>
      </section>
      <StartFolder />
      <SavedLocations />
    </div>
  );
}

function StartFolder() {
  const start = useValue<Navigation['start']>(N('start'));
  const [state, setState] = useState<{ ok: boolean; reason?: string } | null>(null);
  useEffect(() => {
    if (start.kind !== 'path' || !start.path) {
      setState(null);
      return;
    }
    void call<Array<{ exists: boolean; kind?: string; reason?: string }>>('fs:checkPaths', { paths: [start.path] }).then((r) => setState(r[0]?.exists && r[0].kind === 'directory' ? { ok: true } : { ok: false, reason: r[0]?.exists ? 'It is not a folder.' : r[0]?.reason === 'permission' ? 'You do not have permission to open it.' : 'It does not exist or its drive is not connected.' }), () => setState(null));
  }, [start.kind, start.path]);
  return (
    <section className="studio-card">
      <SettingRow id="start" label="Start folder" description="Where a new window starts when it does not continue the last session. If the folder is missing at start, Orbis Files opens Home and tells you — it never silently uses another folder." path={N('start', 'kind')}>
        <div className="segmented" role="radiogroup" aria-labelledby="label-start">
          {([['last', 'Last session'], ['home', 'Home'], ['path', 'A folder']] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={start.kind === k} className={start.kind === k ? 'on' : ''} onClick={async () => {
              if (k === 'path' && !start.path) {
                const dir = await call<string | null>('fs:pickDirectory', { title: 'Start folder' });
                if (dir) setValue(N('start'), { kind: 'path', path: dir }, { label: 'Start folder' });
                return;
              }
              setValue(N('start'), { ...start, kind: k }, { label: 'Start folder' });
            }}>{label}</button>
          ))}
        </div>
        {start.kind === 'path' && <Button size="sm" onClick={async () => {
          const dir = await call<string | null>('fs:pickDirectory', { title: 'Start folder' });
          if (dir) setValue(N('start'), { kind: 'path', path: dir }, { label: 'Start folder' });
        }}>Choose…</Button>}
      </SettingRow>
      {start.kind === 'path' && start.path && (
        <p className={`small ${state && !state.ok ? 'warning-text' : 'muted'}`}><span className="mono">{start.path}</span>{state ? (state.ok ? ' — available' : ` — not available: ${state.reason}`) : ''}</p>
      )}
    </section>
  );
}

/** Pinned folders: real paths, checked for availability, with recovery when one disappears. */
function SavedLocations() {
  const pins = useStore(app, (s) => s.pins);
  const volumes = useStore(app, (s) => s.volumes);
  const [states, setStates] = useState<Record<string, { exists: boolean; reason?: string }>>({});
  useEffect(() => {
    if (!pins.length) return;
    void call<Array<{ path: string; exists: boolean; reason?: string }>>('fs:checkPaths', { paths: pins.map((p) => p.path) }).then((r) => setStates(Object.fromEntries(r.map((x) => [x.path, x]))), () => undefined);
  }, [pins, volumes]);
  const reorder = (paths: string[]) => void call('cat:reorderPins', { paths }).catch(toastError);
  const drag = useDragList((from, to) => reorder(moveItem(pins, from, to).map((p) => p.path)), 'pin');
  return (
    <section className="studio-card" id="setting-savedLocations">
      <h2>Saved locations</h2>
      <p className="muted small">Pinned folders appear in the sidebar. Each is checked; a missing one is marked and offers recovery instead of being replaced.</p>
      {!pins.length && <p className="muted">No pinned folders. Right-click a folder → Pin to sidebar.</p>}
      <ul className="studio-list">
        {pins.map((p, i) => {
          const st = states[p.path];
          const missing = st && !st.exists;
          return (
            <li key={p.path} className={`studio-list-row ${drag.over === i ? 'is-drop' : ''}`} {...drag.props(i)}>
              <Icon name="grip" size={13} className="muted" />
              <Icon name={missing ? 'removeLocation' : 'pin'} size={14} />
              <span className="grow"><strong>{p.label ?? p.path.split(/[\\/]/).filter(Boolean).pop() ?? p.path}</strong> <span className="mono muted small">{p.path}</span> {missing && <Pill tone="warning">{st.reason === 'permission' ? 'No permission' : 'Not available'}</Pill>}</span>
              {missing && <Button size="sm" onClick={async () => {
                const dir = await call<string | null>('fs:pickDirectory', { title: 'Where is this folder now?' });
                if (!dir) return;
                await call('cat:pin', { path: dir }).catch(toastError);
                await call('cat:unpin', { path: p.path }).catch(toastError);
                toast({ level: 'success', title: 'Pin updated', detail: dir });
              }}>Locate…</Button>}
              <Button size="sm" variant="ghost" onClick={() => void call('cat:unpin', { path: p.path }).catch(toastError)}>Remove</Button>
              <MoveButtons label={p.label ?? p.path} index={i} count={pins.length} onMove={(to) => reorder(moveItem(pins, i, to).map((x) => x.path))} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
