import { useEffect, useState } from 'react';
import { call } from '../../api';
import { confirm, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { automation, setAutomationPaused } from '../../state/automation';
import { Button, Dialog, Loading, Pill, Toggle } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { formatDate } from '../../ui/format';
import { watchOperation } from '../../actions';
import { FolderPicker } from './common';
import type { Rule } from './LibraryTools';

/**
 * Rule automation in the Organising rules view: the global switch and status,
 * per-rule opt-in (folders to watch), and the activity log of automatic runs
 * with undo (the same undo as a manual run).
 */

interface AutoRun {
  id: string;
  ruleId: string;
  ruleName: string;
  ranMs: number;
  result: {
    applied: number;
    failed: string[];
    paths?: string[];
    action?: Rule['action'];
    operationId?: string;
    outcome?: { state: string; done: number; skipped: number; failed: number; finishedMs: number };
    rolledBackMs?: number;
    rollback?: { undone: number; notes: string[] };
  };
}

const VERB: Record<string, string> = { move: 'Moved', copy: 'Copied', tag: 'Tagged', collect: 'Added to collection' };
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function AutomationPanel({ onChanged }: { onChanged: () => void }) {
  const st = useStore(automation, (s) => s.status);
  const seq = useStore(automation, (s) => s.activitySeq);
  const [runs, setRuns] = useState<AutoRun[] | null>(null);
  const load = () => void call<AutoRun[]>('automation:activity', { limit: 100 }).then(setRuns, toastError);
  useEffect(load, [seq]);
  const undo = async (run: AutoRun) => {
    const action = run.result.action?.type;
    const what = action === 'move' ? 'move the files back to where they were' : action === 'copy' ? 'move the copies it made to the Trash' : action === 'tag' ? 'remove the tag from those files' : 'remove those files from the collection';
    if (!(await confirm({ title: 'Undo this automatic run?', body: `This will ${what}. Files restored this way are not processed again automatically. Items changed since are reported and left alone.`, confirmLabel: 'Undo run' }))) return;
    const r = await call<{ operations: string[]; undone: number; notes: string[] }>('rules:rollback', { ruleId: run.ruleId, runId: run.id }).catch((e) => {
      toastError(e);
      return null;
    });
    if (!r) return;
    r.operations.forEach(watchOperation);
    toast({ level: r.notes.length ? 'warning' : 'success', title: r.operations.length ? `Undoing ${r.undone} item${r.undone === 1 ? '' : 's'}…` : `Undid ${r.undone} item${r.undone === 1 ? '' : 's'}`, detail: r.notes.slice(0, 3).join(' ') || undefined });
    load();
    onChanged();
  };
  const count = st?.rules.length ?? 0;
  const active = st?.rules.filter((r) => r.active).length ?? 0;
  return (
    <section className="automation-panel" aria-labelledby="automation-head">
      <div className="automation-card">
        <div className="automation-card-head">
          <span className={`automation-glyph ${st?.paused ? 'is-paused' : active ? 'is-on' : ''}`}><Icon name={st?.paused ? 'automationOff' : 'automation'} size={18} /></span>
          <div className="automation-card-text">
            <h2 id="automation-head">Automation</h2>
            <p className="muted small">
              {!st ? 'Loading…'
                : st.paused ? 'Paused. Rules do not run on new files until you resume.'
                  : !count ? 'No rule runs automatically. Apply a rule by hand once, then choose “Automatic…”.'
                    : active ? `On · ${active} rule${active === 1 ? '' : 's'} watching ${st.watching.length} folder${st.watching.length === 1 ? '' : 's'}${st.pending ? ` · ${st.pending} new file${st.pending === 1 ? '' : 's'} settling` : ''}`
                      : 'Rules set to run automatically cannot run yet (see the rules above).'}
            </p>
          </div>
          {st && (st.paused || count > 0) && (
            <Button size="sm" icon={st.paused ? 'play' : 'pause'} onClick={() => void setAutomationPaused(!st.paused)}>{st.paused ? 'Resume automation' : 'Pause automation'}</Button>
          )}
        </div>
        <ul className="automation-facts small muted">
          <li>Runs only while Orbis Files is open. Files that arrive while it is closed or paused are not processed later — preview the rule to handle them.</li>
          <li>Acts on a new file once it has kept the same size for {Math.round((st?.limits.stableMs ?? 4000) / 1000)} seconds; partial downloads (.crdownload, .part, .!qB…) and hidden files are ignored.</li>
          <li>Only moves, copies, tags and collection entries — never deletes or replaces. Name conflicts are skipped. At most {st?.limits.maxActionsPerMinute ?? 30} files per minute.</li>
        </ul>
      </div>
      <h2 className="automation-log-head">Automatic activity</h2>
      {!runs ? <Loading label="Loading activity…" /> : !runs.length ? <p className="muted small">Nothing has run automatically yet.</p> : (
        <ul className="automation-log" aria-label="Automatic runs, newest first">
          {runs.map((run) => {
            const o = run.result.outcome;
            const n = o?.done ?? run.result.applied;
            const action = run.result.action?.type ?? 'move';
            const files = run.result.paths ?? [];
            return (
              <li key={run.id} className="automation-log-row">
                <span className="tabular muted small automation-log-when">{formatDate(run.ranMs)}</span>
                <span className="automation-log-what">
                  <strong>{VERB[action] ?? action} {n} file{n === 1 ? '' : 's'}</strong>
                  <span className="muted small"> · {run.ruleName}</span>
                  <span className="automation-log-files mono small" title={files.join('\n')}>{files.slice(0, 3).map(base).join(', ')}{files.length > 3 ? ` +${files.length - 3}` : ''}</span>
                </span>
                <span className="automation-log-state">
                  {run.result.rolledBackMs ? <Pill>undone</Pill>
                    : run.result.operationId && !o ? <Pill tone="accent">running</Pill>
                      : o && (o.failed || o.state === 'failed') ? <Pill tone="error">{o.failed} failed</Pill>
                        : o?.skipped ? <Pill tone="warning">{o.skipped} skipped</Pill>
                          : run.result.failed.length ? <Pill tone="warning">{run.result.failed.length} failed</Pill>
                            : <Pill tone="success">done</Pill>}
                  {!run.result.rolledBackMs && (!run.result.operationId || o) && <Button size="sm" variant="ghost" icon="undo" aria-label={`Undo automatic run of ${run.ruleName} at ${formatDate(run.ranMs)}`} onClick={() => void undo(run)}>Undo…</Button>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Opt one rule in to (or out of) running automatically on new files in chosen folders. */
export function AutomationDialog({ rule, onClose, onSaved }: { rule: Rule; onClose: () => void; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(!!rule.automatic?.enabled);
  const [folders, setFolders] = useState<string[]>(rule.automatic?.folders.length ? rule.automatic.folders : [rule.scope]);
  const [adding, setAdding] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const keepsFiles = ['move', 'copy', 'tag', 'collect'].includes(rule.action.type);
  const blocked = !keepsFiles ? 'This rule’s action cannot run automatically.' : !rule.enabled ? 'Enable the rule first.' : !rule.approved ? 'Preview and apply this rule by hand at least once (and again after any change to it). Then it can run automatically.' : undefined;
  const save = () => {
    setError(null);
    void call<Rule>('rules:setAutomatic', { id: rule.id, enabled, folders }).then(() => {
      toast({ level: 'success', title: enabled ? `“${rule.name}” runs automatically` : `“${rule.name}” no longer runs automatically`, detail: enabled ? `New files in ${folders.map(base).join(', ')} are handled while Orbis Files is open.` : undefined });
      onSaved();
    }, (e) => setError((e as Error).message));
  };
  return (
    <Dialog title={`Automatic: ${rule.name}`} onClose={onClose} width={600} footer={
      <>
        {error && <span className="field-error grow">{error}</span>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={(enabled && (!!blocked || !folders.length))} onClick={save}>Save</Button>
      </>
    }>
      <div className="form">
        <Toggle id="rule-auto-enabled" label="Run automatically on new files" checked={enabled} disabled={!!blocked && !enabled}
          description={blocked && !enabled ? blocked : `When a new file appears in these folders and matches “${rule.condition}”, the rule ${rule.action.type === 'move' ? 'moves it' : rule.action.type === 'copy' ? 'copies it' : rule.action.type === 'tag' ? 'tags it' : 'adds it to the collection'} without asking. Every run is listed under Automatic activity and can be undone.`}
          onChange={setEnabled} />
        <fieldset className="auto-folders">
          <legend className="field-label">Watch these folders for new files</legend>
          <ul className="auto-folder-list">
            {folders.map((f) => (
              <li key={f}>
                <Icon name="folder" size={14} />
                <span className="mono small grow">{f}</span>
                <Button size="sm" variant="ghost" aria-label={`Stop watching ${f}`} disabled={folders.length === 1} onClick={() => setFolders(folders.filter((x) => x !== f))}>Remove</Button>
              </li>
            ))}
          </ul>
          <FolderPicker key={adding} label="Add a folder" id="rule-auto-add" value="" onChange={(p) => {
            setAdding(adding + 1);
            if (!folders.includes(p)) setFolders([...folders, p].slice(0, 16));
          }} />
          <p className="muted small">{rule.recursive ? 'Subfolders are watched too (the rule includes subfolders).' : 'Only files directly in these folders (the rule does not include subfolders).'}</p>
        </fieldset>
        <p className="muted small">Runs only while Orbis Files is open; nothing happens while it is closed or automation is paused, and files that arrived meanwhile are not processed later.</p>
      </div>
    </Dialog>
  );
}
