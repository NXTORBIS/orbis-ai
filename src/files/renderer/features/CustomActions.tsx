import { useMemo, useState } from 'react';
import { call } from '../api';
import { app, closeDialog, confirm, toast, toastError } from '../state/app';
import { useStore } from '../state/store';
import { customActions } from '../state/customActions';
import { Button, Dialog, Pill, Segmented, TextField, Toggle } from '../ui/components';
import { Icon } from '../ui/Icon';
import { shortcutFor } from '../commands';
import {
  ACTION_DEFAULTS, PLACEHOLDERS, PLACEHOLDER_HELP, actionCommandId, commandProblem, describeRun, planRuns, type CustomAction, type Placeholder,
} from '../../shared/customActions';

/**
 * Settings → Custom actions: define programs to run on selected items. The
 * editor is the only place actions are created or changed (the Orbis app and
 * other hosts cannot add or run them).
 */

type Draft = Omit<CustomAction, 'id' | 'createdMs' | 'updatedMs'> & { id?: string };

const blank = (): Draft => ({ ...structuredClone(ACTION_DEFAULTS), name: '', command: '' });
const platform = () => window.orbis.platform;

export function CustomActionsSection() {
  const list = useStore(customActions, (s) => s.list);
  const [draft, setDraft] = useState<Draft | null>(null);

  const remove = async (a: CustomAction) => {
    if (!(await confirm({ title: `Delete the action “${a.name}”?`, body: 'Only the action is deleted; no files are touched. Toolbar buttons and shortcuts for it stop working.', confirmLabel: 'Delete', destructive: true }))) return;
    await call('actions:delete', { id: a.id }).then(() => toast({ level: 'success', title: `Deleted “${a.name}”` }), toastError);
  };
  const importFile = async () => {
    try {
      const r = await call<{ added: string[]; replaced: string[]; errors: string[] } | null>('actions:import');
      if (!r) return;
      const n = r.added.length + r.replaced.length;
      toast({
        level: r.errors.length ? 'warning' : 'success',
        title: n ? `Imported ${n} action${n === 1 ? '' : 's'}` : 'No actions imported',
        detail: [r.replaced.length ? `Replaced: ${r.replaced.join(', ')}.` : '', n ? 'Each imported action asks before it runs.' : '', r.errors.slice(0, 3).join(' ')].filter(Boolean).join(' '),
        sticky: r.errors.length > 0,
      });
    } catch (err) {
      toastError(err, 'Actions not imported');
    }
  };
  const exportFile = async () => {
    try {
      const r = await call<{ path: string; count: number } | null>('actions:export');
      if (r) toast({ level: 'success', title: `Exported ${r.count} action${r.count === 1 ? '' : 's'}`, detail: r.path });
    } catch (err) {
      toastError(err, 'Actions not exported');
    }
  };

  return (
    <section className="settings-group custom-actions" id="custom-actions" aria-labelledby="actions-heading">
      <div className="section-head">
        <h2 id="actions-heading">Custom actions</h2>
        <span className="spacer" />
        <Button size="sm" icon="plus" onClick={() => setDraft(blank())} disabled={!!draft}>New action…</Button>
        <Button size="sm" variant="ghost" icon="importFile" onClick={() => void importFile()}>Import…</Button>
        <Button size="sm" variant="ghost" icon="exportFile" onClick={() => void exportFile()} disabled={!list.length}>Export…</Button>
      </div>
      <p className="muted">Run a program on the selected items from the context menu (Actions), the command palette or the toolbar. Programs start without a shell: every placeholder becomes part of one argument, so file names can never add arguments or commands. Actions only run when you choose them.</p>
      {list.length === 0 && !draft && <p className="muted small">No actions yet. For example: <span className="mono">code {'{path}'}</span>, <span className="mono">cp {'{path}'} /backup/</span> or <span className="mono">ffmpeg -i {'{path}'} {'{dir}'}/{'{stem}'}.mp3</span>.</p>}
      {list.length > 0 && (
        <ul className="action-list" aria-label="Custom actions">
          {list.map((a) => (
            <li key={a.id} className="action-row">
              <Icon name="action" size={15} />
              <div className="action-row-text">
                <div className="action-row-title">
                  <strong>{a.name}</strong>
                  <Pill>{a.runMode === 'once' ? 'once with all items' : 'once per item'}</Pill>
                  {a.shell && <Pill tone="warning">shell</Pill>}
                  {!a.confirm && <Pill tone="accent">runs without asking</Pill>}
                  {shortcutFor(actionCommandId(a.id)) && <kbd className="kbd">{shortcutFor(actionCommandId(a.id))}</kbd>}
                </div>
                <span className="mono small muted action-row-cmd" title={a.command}>{a.command}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDraft(structuredClone(a))} disabled={!!draft} aria-label={`Edit ${a.name}`}>Edit</Button>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => void remove(a)} aria-label={`Delete ${a.name}`} />
            </li>
          ))}
        </ul>
      )}
      {draft && <ActionEditor key={draft.id ?? 'new'} initial={draft} onDone={() => setDraft(null)} />}
    </section>
  );
}

function ActionEditor({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [extText, setExtText] = useState(initial.appliesTo.extensions.join(', '));
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setAt = (patch: Partial<Draft['appliesTo']>) => setD((x) => ({ ...x, appliesTo: { ...x.appliesTo, ...patch } }));
  const problem = d.command.trim() ? commandProblem(d.command, d.shell, platform()) : undefined;
  const nothing = !d.appliesTo.files && !d.appliesTo.folders && !d.appliesTo.noSelection;
  const customDirBad = d.workingDir === 'custom' && !/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(d.customDir);

  // An example of what would run, with made-up items (so placeholders can be checked before saving).
  const example = useMemo(() => {
    if (!d.command.trim() || problem) return undefined;
    const win = platform() === 'win32';
    const home = win ? 'C:\\Users\\you' : '/home/you';
    const sep = win ? '\\' : '/';
    const folder = `${home}${sep}Documents`;
    const items = d.appliesTo.files || !d.appliesTo.folders
      ? [{ path: `${folder}${sep}report final.${d.appliesTo.extensions[0] ?? 'pdf'}`, kind: 'file' as const }, { path: `${folder}${sep}notes.${d.appliesTo.extensions[0] ?? 'txt'}`, kind: 'file' as const }]
      : [{ path: `${folder}${sep}Photos 2024`, kind: 'directory' as const }];
    try {
      return planRuns({ ...d, customDir: d.customDir || folder }, { items, folder, platform: platform() }).map((r) => ({ cmd: describeRun(r), cwd: r.cwd }));
    } catch {
      return undefined;
    }
  }, [d, problem]);

  const insert = (p: Placeholder) => {
    const el = document.getElementById('action-command') as HTMLInputElement | null;
    const token = `{${p}}`;
    if (!el) return set({ command: `${d.command}${d.command && !d.command.endsWith(' ') ? ' ' : ''}${token}` });
    const start = el.selectionStart ?? d.command.length;
    const end = el.selectionEnd ?? start;
    const next = d.command.slice(0, start) + token + d.command.slice(end);
    set({ command: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const extensions = extText.split(/[\s,;]+/).map((x) => x.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
      const saved = await call<CustomAction>('actions:save', { action: { ...d, appliesTo: { ...d.appliesTo, extensions } } });
      customActions.set((s) => ({ list: s.list.some((a) => a.id === saved.id) ? s.list.map((a) => (a.id === saved.id ? saved : a)) : [...s.list, saved] }));
      toast({ level: 'success', title: `Saved “${saved.name}”`, detail: 'It is in the context menu (Actions), the command palette and the toolbar editor.' });
      onDone();
    } catch (err) {
      toastError(err, 'The action was not saved');
    } finally {
      setSaving(false);
    }
  };

  const canSave = !!d.name.trim() && !!d.command.trim() && !problem && !nothing && !customDirBad && !saving;
  return (
    <div className="action-editor" role="group" aria-labelledby="action-editor-title">
      <h3 id="action-editor-title">{initial.id ? `Edit “${initial.name}”` : 'New action'}</h3>
      <div className="action-grid">
        <TextField id="action-name" label="Name" value={d.name} maxLength={60} placeholder="Open in editor" onChange={(e) => set({ name: e.target.value })} autoFocus />
        <TextField id="action-timeout" label="Time limit (seconds)" type="number" min={1} max={86400} value={d.timeoutSec} onChange={(e) => set({ timeoutSec: Math.max(1, Math.min(86400, Math.round(Number(e.target.value) || 1))) })} />
      </div>
      <TextField
        id="action-command"
        label="Command"
        mono
        value={d.command}
        placeholder={platform() === 'win32' ? 'notepad.exe {path}' : 'cp {path} /backup/'}
        spellCheck={false}
        onChange={(e) => set({ command: e.target.value })}
        error={problem}
        hint={d.shell ? 'Shell mode: the line runs in /bin/sh (cmd.exe on Windows); placeholders are inserted already quoted.' : 'Program first, then its arguments. Quote arguments with spaces ("…" or \'…\'). No shell: |, >, ; and $VAR are passed as plain text.'}
      />
      <div className="placeholder-chips" role="group" aria-label="Insert a placeholder">
        {PLACEHOLDERS.map((p) => (
          <button key={p} type="button" className="chip mono" title={PLACEHOLDER_HELP[p]} onClick={() => insert(p)}>{`{${p}}`}</button>
        ))}
      </div>
      <p className="muted small">{PLACEHOLDERS.map((p) => `{${p}} ${PLACEHOLDER_HELP[p]}`).join(' · ')}. Run once with all items, {'{path}'} and the other single-item placeholders refer to the first item.</p>

      <div className="action-grid">
        <div className="field">
          <span className="field-label">Runs</span>
          <Segmented label="Runs" value={d.runMode} onChange={(v) => set({ runMode: v })} options={[{ value: 'per-item', label: 'Once per item' }, { value: 'once', label: 'Once with all items' }]} />
        </div>
        <label className="field" htmlFor="action-cwd">
          <span className="field-label">Working folder</span>
          <select id="action-cwd" className="input" value={d.workingDir} onChange={(e) => set({ workingDir: e.target.value as Draft['workingDir'] })}>
            <option value="item">Folder that contains the item</option>
            <option value="folder">Folder shown in the pane</option>
            <option value="custom">Always this folder…</option>
          </select>
        </label>
      </div>
      {d.workingDir === 'custom' && <TextField id="action-customdir" label="Folder (absolute path)" mono value={d.customDir} onChange={(e) => set({ customDir: e.target.value })} error={customDirBad && d.customDir ? 'Use an absolute path.' : undefined} />}

      <fieldset className="action-applies">
        <legend className="field-label">Offered for</legend>
        <label className="check"><input type="checkbox" checked={d.appliesTo.files} onChange={(e) => setAt({ files: e.target.checked })} /> Files</label>
        <label className="check"><input type="checkbox" checked={d.appliesTo.folders} onChange={(e) => setAt({ folders: e.target.checked })} /> Folders</label>
        <label className="check"><input type="checkbox" checked={d.appliesTo.noSelection} onChange={(e) => setAt({ noSelection: e.target.checked })} /> Nothing selected (runs on the folder shown)</label>
        {nothing && <span className="field-error">Choose at least one.</span>}
      </fieldset>
      {d.appliesTo.files && <TextField id="action-ext" label="Only files with these extensions" mono value={extText} placeholder="png, jpg (empty: any file)" onChange={(e) => setExtText(e.target.value)} />}

      <Toggle id="action-confirm" label="Ask before running" description="Shows exactly what will run, with every argument, before it starts." checked={d.confirm} onChange={(v) => set({ confirm: v })} />
      <Toggle id="action-output" label="Show the output when it finishes" description="Standard output, errors and the exit code. They are kept in Operations either way." checked={d.showOutput} onChange={(v) => set({ showOutput: v })} />
      <Toggle id="action-shell" label="Run through the shell" description="Allows pipes, redirection and shell syntax. Only use it for commands you trust: the shell interprets the whole line." checked={d.shell} onChange={(v) => set({ shell: v })} />
      {d.shell && <p className="warning-text small" role="note"><Icon name="warning" size={13} /> Shell mode runs the line with {platform() === 'win32' ? 'cmd.exe, which still expands %VARIABLES% inside values' : '/bin/sh'}. Placeholders are quoted for you; do not put quotes around them.</p>}

      {example && (
        <div className="action-example" aria-live="polite">
          <span className="field-label">Example with two items</span>
          {example.map((x, i) => <code key={i} className="mono">{x.cmd}</code>)}
          <span className="muted small">in {example[0]!.cwd}</span>
        </div>
      )}
      <div className="action-editor-foot">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={!canSave}>{saving ? 'Saving…' : 'Save action'}</Button>
      </div>
    </div>
  );
}

/** What a custom action printed: per run, the command, exit code, standard output and standard error. */
export function ActionOutputDialog({ opId }: { opId: string }) {
  const op = useStore(app, (s) => s.ops[opId]);
  const out = op?.output;
  const copy = () => {
    if (!out) return;
    const text = out.runs.map((r) => [`$ ${r.command}`, `(in ${r.cwd})`, r.stdout, r.stderr ? `[stderr]\n${r.stderr}` : '', r.error ?? (r.timedOut ? '[stopped at the time limit]' : r.cancelled ? '[stopped]' : `[exit code ${r.exitCode}]`)].filter(Boolean).join('\n')).join('\n\n');
    void call('fs:copyText', { text }).then(() => toast({ level: 'success', title: 'Output copied' }), toastError);
  };
  const running = op && !['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'].includes(op.state);
  return (
    <Dialog title={out ? `Output of “${out.action}”` : 'Action output'} onClose={closeDialog} width={720} className="action-output-dialog" footer={
      <>
        <Button icon="copy" onClick={copy} disabled={!out?.runs.length}>Copy output</Button>
        <Button variant="primary" onClick={closeDialog}>Close</Button>
      </>
    }>
      {!out ? <p className="muted">This operation is no longer listed.</p> : (
        <>
          {running && <p className="muted">Still running… ({out.runs.length} finished so far)</p>}
          {out.runs.length === 0 && !running && <p className="muted">Nothing ran.</p>}
          {out.runs.map((r, i) => {
            const ok = !r.error && !r.timedOut && !r.cancelled && r.exitCode === 0;
            return (
              <section key={i} className="action-run" aria-label={`Run ${i + 1}: ${r.label}`}>
                <div className="action-run-head">
                  <strong className="ellipsis">{r.label}</strong>
                  <Pill tone={ok ? 'success' : r.cancelled ? 'neutral' : 'error'}>{r.error ? 'Did not start' : r.timedOut ? 'Time limit reached' : r.cancelled ? 'Stopped' : r.signal ? `Signal ${r.signal}` : `Exit code ${r.exitCode}`}</Pill>
                  <span className="muted small tabular">{(r.durationMs / 1000).toFixed(1)} s</span>
                </div>
                <code className="mono action-run-cmd">{r.command}</code>
                <span className="muted small">in {r.cwd}</span>
                {r.error && <p className="error-text">{r.error}</p>}
                {r.stdout && <pre className="action-out" aria-label="Standard output">{r.stdout}</pre>}
                {r.stderr && <pre className="action-out is-err" aria-label="Standard error">{r.stderr}</pre>}
                {!r.stdout && !r.stderr && !r.error && <p className="muted small">No output.</p>}
                {r.truncated && <p className="muted small">Output was longer than 256 KB; only the beginning is kept.</p>}
              </section>
            );
          })}
        </>
      )}
    </Dialog>
  );
}
