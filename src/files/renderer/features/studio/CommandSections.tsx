import { useState } from 'react';
import { useStore } from '../../state/store';
import { applyCustom, custom, useCustom } from '../../state/custom';
import { Button, Pill } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { TOOLBAR_DEFAULTS, type ContextMenuConfig, type Toolbar, type ToolbarItem } from '../../../shared/customization/schema';
import { arrangement, BACKGROUND_MENU_DEFAULT, ENTRY_MENU_DEFAULT, menuItemLabel, MENU_SEPARATOR, toolbarCatalog, TOOLBAR_SPECIAL_LABEL } from '../../menus';
import { commandById } from '../../commands';
import { moveItem, MoveButtons, SettingRow, useDragList } from './controls';

/**
 * Toolbar editor: the items before the address bar and after the search box,
 * their order, grouping (separators), pinning (pinned items never move into
 * “More”) and icon/text presentation. Each item runs its registered command.
 */
export function ToolbarSection() {
  const tb = useCustom((r) => r.toolbar);
  const wsHas = useStore(custom, (s) => !!s.server.config.workspaces.find((w) => w.id === s.server.config.activeWorkspaceId)?.overrides.toolbar);
  const wsName = useCustom((r) => r.workspace.name);
  const [adding, setAdding] = useState('');
  const catalog = toolbarCatalog();
  const used = new Set([...tb.start, ...tb.end].filter((i): i is { id: string; pinned: boolean } => 'id' in i).map((i) => i.id));
  const save = (next: Toolbar, target: 'baseline' | 'workspace' = wsHas ? 'workspace' : 'baseline') => void applyCustom({ op: 'replace', key: 'toolbar', value: next, target }, { quiet: true });
  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-toolbarEditor">
        <div className="studio-card-head">
          <h2>Toolbar</h2>
          <div className="chip-row">
            <label className="check" title="Give this workspace its own toolbar instead of the general one">
              <input type="checkbox" checked={wsHas} onChange={(e) => (e.target.checked ? save(tb, 'workspace') : void applyCustom({ op: 'resetCategory', category: 'toolbar', target: 'workspace' }))} /> Separate toolbar for “{wsName}”
            </label>
            <Button size="sm" onClick={() => save(TOOLBAR_DEFAULTS)}>Restore default toolbar</Button>
          </div>
        </div>
        <p className="muted small">When the pane is narrow, unpinned items move into the More menu, starting from the end. Nothing becomes unreachable: More is always on the toolbar.</p>
        <div className="tb-editor">
          <ToolbarGroup tb={tb} save={save} where="start" title="Before the address bar" />
          <ToolbarGroup tb={tb} save={save} where="end" title="After the search box" />
        </div>
        <div className="chip-row">
          <select className="input" value={adding} aria-label="Command to add" onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a command…</option>
            {catalog.filter((c) => !used.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <Button size="sm" disabled={!adding} onClick={() => { save({ ...tb, start: [...tb.start, { id: adding, pinned: false }] }); setAdding(''); }}>Add to left group</Button>
          <Button size="sm" disabled={!adding} onClick={() => { const more = tb.end.findIndex((i) => 'id' in i && i.id === 'menu:more'); const end = [...tb.end]; end.splice(more < 0 ? end.length : more, 0, { id: adding, pinned: false }); save({ ...tb, end }); setAdding(''); }}>Add to right group</Button>
        </div>
      </section>
      <section className="studio-card">
        <SettingRow id="presentation" label="Show toolbar items as">
          <div className="segmented" role="radiogroup" aria-labelledby="label-presentation">
            {(['icon', 'text', 'both'] as const).map((p) => <button key={p} type="button" role="radio" aria-checked={tb.presentation === p} className={tb.presentation === p ? 'on' : ''} onClick={() => save({ ...tb, presentation: p })}>{p === 'icon' ? 'Icons' : p === 'text' ? 'Text' : 'Icons and text'}</button>)}
          </div>
        </SettingRow>
        <p className="muted small">Icon-only buttons always have an accessible name and a tooltip with their shortcut.</p>
      </section>
    </div>
  );
}


function itemLabel(it: ToolbarItem): string {
  return 'separator' in it ? 'Separator' : TOOLBAR_SPECIAL_LABEL[it.id] ?? commandById(it.id)?.title ?? `${it.id} (not available in this version)`;
}

function ToolbarGroup({ tb, save, where, title }: { tb: Toolbar; save: (t: Toolbar) => void; where: 'start' | 'end'; title: string }) {
  const catalog = toolbarCatalog();
  const icon = (it: ToolbarItem) => ('separator' in it ? 'minus' : catalog.find((c) => c.id === it.id)?.icon ?? 'command');
  const label = itemLabel;
  const items = tb[where];
  const set = (list: ToolbarItem[]) => save({ ...tb, [where]: list });
  const drag = useDragList((from, to) => set(moveItem(items, from, to)), `tb-${where}`);
  return (
    <div className="tb-editor-group">
      <h3>{title}</h3>
      <ul className="studio-list">
        {items.map((it, i) => (
          <li key={`${'id' in it ? it.id : 'sep'}-${i}`} className={`studio-list-row ${drag.over === i ? 'is-drop' : ''}`} {...drag.props(i)}>
            <Icon name="grip" size={13} className="muted" />
            <Icon name={icon(it)} size={15} />
            <span className="grow">{label(it)}{'id' in it && it.id === 'menu:more' && <Pill>always kept</Pill>}</span>
            {'id' in it && <label className="check" title="Pinned items stay visible in narrow windows"><input type="checkbox" checked={it.pinned || it.id === 'menu:more'} disabled={it.id === 'menu:more'} onChange={(e) => set(items.map((x, j) => (j === i ? { ...(x as { id: string }), pinned: e.target.checked } : x)))} /> Pinned</label>}
            <Button size="sm" variant="ghost" onClick={() => save({ ...tb, [where]: items.filter((_, j) => j !== i), [where === 'start' ? 'end' : 'start']: [...tb[where === 'start' ? 'end' : 'start'], it] } as Toolbar)}>Move to {where === 'start' ? 'right' : 'left'} group</Button>
            <MoveButtons label={label(it)} index={i} count={items.length} onMove={(to) => set(moveItem(items, i, to))} />
            {!('id' in it && it.id === 'menu:more') && <button type="button" className="icon-btn" aria-label={`Remove ${label(it)}`} data-tip="Remove" onClick={() => set(items.filter((_, j) => j !== i))}><Icon name="close" size={13} /></button>}
          </li>
        ))}
        {!items.length && <li className="muted small pad">Empty.</li>}
      </ul>
      <Button size="sm" variant="ghost" icon="minus" onClick={() => set([...items, { separator: true }])}>Add separator</Button>
    </div>
  );
}

/**
 * Context-menu editor: order, separators and visibility of the actions in the
 * item menu and the folder-background menu. Only actions relevant to what was
 * clicked appear in a menu. Confirmations for destructive actions are part of
 * the actions themselves and cannot be removed here.
 */
export function MenusSection() {
  const cm = useCustom((r) => r.contextMenu);
  const save = (next: ContextMenuConfig, label?: string) => void applyCustom({ op: 'replace', key: 'contextMenu', value: next }, { quiet: !label });

  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-menuOptions">
        <h2>Menu options</h2>
        <SettingRow id="menuUnavailable" label="Actions that cannot be used right now">
          <div className="segmented" role="radiogroup" aria-labelledby="label-menuUnavailable">
            {(['disable', 'hide'] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={cm.unavailable === v} className={cm.unavailable === v ? 'on' : ''} onClick={() => save({ ...cm, unavailable: v })}>{v === 'disable' ? 'Show disabled, with the reason' : 'Hide them'}</button>)}
          </div>
        </SettingRow>
        <SettingRow id="menuIcons" label="Show icons"><button type="button" role="switch" aria-checked={cm.showIcons} aria-labelledby="label-menuIcons" className={`switch ${cm.showIcons ? 'on' : ''}`} onClick={() => save({ ...cm, showIcons: !cm.showIcons })}><span /></button></SettingRow>
        <SettingRow id="menuShortcuts" label="Show shortcuts"><button type="button" role="switch" aria-checked={cm.showShortcuts} aria-labelledby="label-menuShortcuts" className={`switch ${cm.showShortcuts ? 'on' : ''}`} onClick={() => save({ ...cm, showShortcuts: !cm.showShortcuts })}><span /></button></SettingRow>
      </section>
      <MenuList cm={cm} save={save} which="item" defaults={ENTRY_MENU_DEFAULT} title="Menu for files and folders" id="itemMenu" />
      <MenuList cm={cm} save={save} which="background" defaults={BACKGROUND_MENU_DEFAULT} title="Menu for the empty area of a folder" id="backgroundMenu" />
    </div>
  );
}

function MenuList({ cm, save, which, defaults, title, id }: { cm: ContextMenuConfig; save: (c: ContextMenuConfig) => void; which: 'item' | 'background'; defaults: string[]; title: string; id: string }) {
  const order = arrangement(defaults, cm[which].order);
  const hidden = new Set(cm[which].hidden);
  const setOrder = (o: string[]) => save({ ...cm, [which]: { ...cm[which], order: o } });
  const drag = useDragList((from, to) => setOrder(moveItem(order, from, to)), `menu-${which}`);
  return (
    <section className="studio-card" id={`setting-${id}`}>
      <div className="studio-card-head">
        <h2>{title}</h2>
        <Button size="sm" onClick={() => save({ ...cm, [which]: { order: [], hidden: [] } })}>Restore default</Button>
      </div>
      <ul className="studio-list menu-editor">
        {order.map((mid, i) => (
          <li key={`${mid}-${i}`} className={`studio-list-row ${mid === MENU_SEPARATOR ? 'is-sep' : ''} ${drag.over === i ? 'is-drop' : ''}`} {...drag.props(i)}>
            <Icon name="grip" size={13} className="muted" />
            {mid === MENU_SEPARATOR ? <span className="grow muted">Separator</span> : (
              <label className="check grow"><input type="checkbox" checked={!hidden.has(mid)} onChange={(e) => save({ ...cm, [which]: { ...cm[which], order, hidden: e.target.checked ? cm[which].hidden.filter((x) => x !== mid) : [...cm[which].hidden, mid] } })} /> {menuItemLabel(mid)}{commandById(mid)?.risk === 'destructive' && <span className="muted small"> — keeps its own confirmation and safety checks</span>}</label>
            )}
            <MoveButtons label={menuItemLabel(mid)} index={i} count={order.length} onMove={(to) => setOrder(moveItem(order, i, to))} />
            {mid === MENU_SEPARATOR && <button type="button" className="icon-btn" aria-label="Remove separator" onClick={() => setOrder(order.filter((_, j) => j !== i))}><Icon name="close" size={13} /></button>}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" icon="minus" onClick={() => setOrder([...order, MENU_SEPARATOR])}>Add separator</Button>
    </section>
  );
}
