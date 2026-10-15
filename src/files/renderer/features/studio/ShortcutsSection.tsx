import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { applyCustom, custom } from '../../state/custom';
import { confirm, toast } from '../../state/app';
import { call } from '../../api';
import { Button, Pill } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { passesThroughCapture } from '../../ui/keyboard';
import { bindingsFor, COMMANDS, defaultBindings, describeCommands, keyLabel } from '../../commands';
import { checkAssignment, effectiveBindings, findConflicts, normalizeShortcut } from '../../../shared/customization/shortcuts';
import { studio } from './studioState';

const PERMISSION_LABEL = { read: 'Reads only', navigate: 'Navigates', settings: 'Changes the interface', modify: 'Changes files (through the operation queue)', destructive: 'Deletes or trashes (always with its safety checks)' } as const;

/** Turn a key event into the canonical shortcut text, or undefined for a lone modifier. */
function shortcutFromEvent(e: React.KeyboardEvent, mac: boolean): string | undefined {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return undefined;
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (mac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const code = e.code;
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (code === 'Backslash') key = '\\';
  else if (code === 'BracketLeft') key = '[';
  else if (code === 'BracketRight') key = ']';
  else if (code === 'Comma') key = ',';
  else if (code === 'Period') key = '.';
  else if (code === 'Slash') key = '/';
  else if (code === 'Semicolon') key = ';';
  else if (code === 'Quote') key = "'";
  else if (code === 'Backquote') key = '`';
  else if (code === 'Equal') key = '=';
  else if (code === 'Minus') key = '-';
  else if (key === ' ') key = 'Space';
  parts.push(key);
  const n = normalizeShortcut(parts.join('+'));
  return n.ok ? n.value : parts.join('+');
}

/**
 * Shortcut editor for Files commands: search, view, assign (by pressing the
 * keys), replace, remove, restore defaults, conflicts and reserved keys.
 * Conflicts are resolved the same way every time: the newest assignment
 * wins, and the command that had the key loses it (shown before you assign).
 * Keys that type text, and keys the system or the Orbis app reserves, are
 * refused. Only registered commands can be bound.
 */
export function ShortcutsSection() {
  const st = useStore(custom, (s) => ({ overrides: s.resolved.shortcuts.bindings, os: s.server.osReserved, host: s.server.hostReserved }));
  const mac = window.orbis.platform === 'darwin';
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  // Re-read the registry whenever the bindings change (describeCommands reads the effective keymap).
  const descriptors = useMemo(() => (st.overrides ? describeCommands() : []), [st.overrides]);
  const effective = useMemo(() => effectiveBindings(defaultBindings(), st.overrides), [st.overrides]);
  const conflicts = findConflicts(effective.bindings);
  const reserved = useMemo(() => new Map<string, string>([...st.os.map((r) => [r.key, r.reason] as [string, string]), ...st.host.map((r) => [r.key, r.reason] as [string, string])]), [st.os, st.host]);
  const addButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const captureRef = useRef<HTMLDivElement>(null);
  // Focus the capture field once when it opens (not on every re-render, so Tab can move on to Add).
  useEffect(() => {
    if (editing) captureRef.current?.focus();
  }, [editing]);
  /** Close the capture field and give focus back to the command's Add button. */
  const stopEditing = () => {
    const id = editing;
    setEditing(null);
    setCaptured(null);
    if (id) requestAnimationFrame(() => addButtons.current.get(id)?.focus());
  };
  const list = descriptors.filter((d) => {
    const t = q.trim().toLowerCase();
    // The command being edited stays listed while the search changes.
    if (!t || d.id === editing) return true;
    return `${d.title} ${d.id} ${d.category} ${d.description} ${bindingsFor(d.id).map(keyLabel).join(' ')}`.toLowerCase().includes(t);
  });
  const check = editing && captured ? checkAssignment(editing, captured, effective.bindings, reserved, { mandatory: new Set(['app.palette', 'app.customize']) }) : null;

  const assign = async (id: string, key: string, replace: boolean) => {
    const keys = replace ? [key] : [...bindingsFor(id).filter((k) => k !== key), key].slice(-4);
    if (await applyCustom({ op: 'setShortcut', command: id, keys })) {
      stopEditing();
      toast({ level: 'success', title: `${keyLabel(key)} now runs “${COMMANDS.find((c) => c.id === id)?.title ?? id}”` });
    }
  };

  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-shortcutEditor">
        <div className="studio-card-head">
          <h2>Commands and shortcuts</h2>
          <div className="chip-row">
            <Button size="sm" icon="exportFile" onClick={() => void call<{ path: string } | null>('custom:export', { kind: 'shortcuts', systemDark: custom.get().system.dark }).then((r) => r && toast({ level: 'success', title: 'Shortcut profile exported', detail: r.path }))}>Export</Button>
            <Button size="sm" icon="importFile" onClick={() => studio.set({ category: 'portability' })}>Import…</Button>
            <Button size="sm" onClick={async () => {
              if (await confirm({ title: 'Restore all default shortcuts?', body: 'Every shortcut you changed goes back to its default. A backup is kept.', confirmLabel: 'Restore defaults' })) await applyCustom({ op: 'resetAllShortcuts' });
            }}>Restore all defaults</Button>
          </div>
        </div>
        <div className="searchbox studio-filter">
          <Icon name="search" size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search commands or keys" aria-label="Search commands or keys" />
        </div>
        <p className="muted small">Shortcuts never fire while you type in a text field (except a few navigation keys with Ctrl/Alt), so renaming and path editing keep working. {list.length} of {descriptors.length} commands.</p>
        <table className="shortcut-table stack-table" role="table">
          <thead role="rowgroup"><tr role="row"><th role="columnheader">Command</th><th role="columnheader">Shortcut</th><th role="columnheader">What it may do</th><th role="columnheader"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody role="rowgroup">
            {list.map((d) => {
              const keys = bindingsFor(d.id);
              const changed = d.id in st.overrides;
              const displaced = effective.displaced.filter((x) => x.from === d.id);
              return (
                <React.Fragment key={d.id}>
                <tr role="row" className={editing === d.id ? 'is-editing' : ''}>
                  <td role="cell" className="st-main">
                    <strong>{d.title}</strong> <span className="muted small">{d.category}</span>
                    <div className="muted small">{d.description}</div>
                    <code className="muted small">{d.id}</code>
                  </td>
                  <td role="cell" className="sc-keys">
                    {keys.length ? keys.map((k) => (
                      <span key={k} className="key-chip">
                        <kbd className="kbd">{keyLabel(k)}</kbd>
                        <button type="button" className="icon-btn" aria-label={`Remove ${keyLabel(k)} from ${d.title}`} onClick={() => void applyCustom({ op: 'setShortcut', command: d.id, keys: keys.filter((x) => x !== k) })}><Icon name="close" size={11} /></button>
                      </span>
                    )) : <span className="muted small">None</span>}
                    {changed && <Pill tone="accent">changed</Pill>}
                    {displaced.length > 0 && <div className="warning-text small">Lost {displaced.map((x) => keyLabel(x.key)).join(', ')} to {displaced.map((x) => x.to).join(', ')}</div>}
                    {d.defaultKeys.length > 0 && changed && <div className="muted small">Default: {d.defaultKeys.map(keyLabel).join(', ')}</div>}
                  </td>
                  <td role="cell" className="small" data-label="What it may do">{PERMISSION_LABEL[d.permission]}<div className="muted">{d.contexts.join(', ')}</div></td>
                  <td role="cell" className="nowrap st-side">
                    <button type="button" className="btn btn-default btn-sm" ref={(el) => { addButtons.current.set(d.id, el); }} aria-label={`Add a shortcut for ${d.title}`} aria-expanded={editing === d.id} onClick={() => { setEditing(d.id); setCaptured(null); }}>Add…</button>
                    {changed && <Button size="sm" variant="ghost" onClick={() => void applyCustom({ op: 'resetShortcut', command: d.id })}>Default</Button>}
                  </td>
                </tr>
                {editing === d.id && (
                  <tr role="row" className="capture-row">
                    <td role="cell" colSpan={4}>
                      <div className="capture-card" aria-live="polite">
                        <h3>New shortcut for “{d.title}”</h3>
                        <div className="key-capture" tabIndex={0} data-capture-keys data-autofocus role="textbox" aria-label={`Press the keys for the new shortcut for ${d.title}`} ref={captureRef}
                          onKeyDown={(e) => {
                            if (passesThroughCapture(e)) return;
                            e.preventDefault();
                            e.stopPropagation();
                            if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
                              stopEditing();
                              return;
                            }
                            const k = shortcutFromEvent(e, mac);
                            if (k) setCaptured(k);
                          }}>
                          {captured ? <kbd className="kbd big">{keyLabel(captured)}</kbd> : <span className="muted">Press the keys… (Tab moves on, Escape cancels)</span>}
                        </div>
                        {check && !check.ok && <p className="field-error" role="alert">{check.reason}</p>}
                        {check?.ok && check.warning && <p className="warning-text small">{check.warning}</p>}
                        <div className="chip-row">
                          <Button variant="primary" disabled={!check?.ok} onClick={() => void assign(d.id, check!.value!, false)}>Add</Button>
                          <Button disabled={!check?.ok} onClick={() => void assign(d.id, check!.value!, true)}>Replace existing</Button>
                          <Button variant="ghost" onClick={stopEditing}>Cancel</Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="studio-card">
        <h2>Conflicts</h2>
        {conflicts.length ? (
          <ul className="adjustments">{conflicts.map((c) => <li key={c.key}><kbd className="kbd">{keyLabel(c.key)}</kbd> {c.commands.join(', ')}</li>)}</ul>
        ) : <p className="muted small">No key runs more than one command.</p>}
      </section>

      <section className="studio-card" id="setting-reserved">
        <h2>Reserved shortcuts</h2>
        <p className="muted small">These keys are used by your operating system{st.host.length ? ' or by the Orbis app' : ''} and cannot be assigned. When Orbis Files runs inside the Orbis app, the app can add its own reserved keys here; it has not done so{st.host.length ? ' — except those listed' : ''}.</p>
        <ul className="reserved-list">
          {[...st.os, ...st.host].map((r) => <li key={r.key}><kbd className="kbd">{keyLabel(r.key)}</kbd> <span className="muted small">{r.reason}</span></li>)}
        </ul>
      </section>
    </div>
  );
}
