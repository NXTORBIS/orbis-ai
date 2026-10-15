import React, { useEffect, useMemo, useState } from 'react';
import { call, newId, on, startListing } from '../../api';
import { app, confirm, openDialog, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { activePane, navigate, parentPath } from '../../state/workspace';
import { Button, Dialog, EmptyState, ErrorState, Loading, Pill, Segmented, TextField, Toggle, useMenu, type MenuItem } from '../../ui/components';
import { formatBytes, formatDate, urlHost } from '../../ui/format';
import { openFile, watchOperation } from '../../actions';
import { arrange, GridView } from '../FileViews';
import { FolderPicker } from './common';
import { MediaViewer } from '../Preview';
import type { FileEntry } from '../../../shared/model';
import type { MediaSummary } from '../../../shared/media';
import { automation } from '../../state/automation';
import { AutomationDialog, AutomationPanel } from './RuleAutomation';

/* ---------------------------------------------------------------- rules */

export interface Rule {
  id: string; name: string; enabled: boolean; priority: number; scope: string; recursive: boolean; condition: string; exclusion: string;
  action: { type: 'move' | 'copy'; toDir: string } | { type: 'tag'; tag: string } | { type: 'collect'; collectionId: string };
  automatic?: { enabled: boolean; folders: string[] };
  /** This exact definition was applied by hand at least once. */
  approved?: boolean;
  /** Why the rule cannot run automatically (with its folders, or its own folder). */
  automationProblem?: string;
}
interface DryItem { path: string; name: string; destination?: string; status: 'ready' | 'conflict' | 'already-there' | 'excluded'; reason?: string }

export function RulesView() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [dry, setDry] = useState<{ rule: Rule; items: DryItem[]; notes: string[] } | null>(null);
  const [history, setHistory] = useState<Rule | null>(null);
  const [auto, setAuto] = useState<Rule | null>(null);
  const status = useStore(automation, (s) => s.status);
  const load = () => void call<Rule[]>('rules:list').then(setRules, toastError);
  useEffect(load, []);

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Organising rules</h1>
        <p className="muted">A rule finds items in a folder using the search language and proposes one action. Preview the matches, choose what to apply, then confirm. After you have applied a rule by hand, you can let it run automatically on new files.</p>
      </header>
      <div className="tool-controls">
        <Button variant="primary" icon="plus" onClick={() => setEditing({ name: 'New rule', enabled: true, priority: 100, scope: app.get().known.find((k) => k.id === 'downloads')?.path ?? '', recursive: false, condition: 'type:pdf', exclusion: '', action: { type: 'move', toDir: app.get().known.find((k) => k.id === 'documents')?.path ?? '' } })}>New rule</Button>
      </div>
      {!rules ? <Loading label="Loading rules…" /> : !rules.length ? <EmptyState icon="rules" title="No rules yet" body="Example: in Downloads, move type:pdf to Documents." /> : (
        <div className="rule-list">
          {rules.map((r) => {
            const live = status?.rules.find((x) => x.id === r.id);
            return (
              <div key={r.id} className={`rule ${r.enabled ? '' : 'is-disabled'}`}>
                <div className="rule-main">
                  <strong className="rule-name">
                    {r.name}{!r.enabled && <span className="muted"> (disabled)</span>}
                    {r.automatic?.enabled && (live?.active
                      ? <Pill tone="accent" title={`Runs on new files in ${r.automatic.folders.join(', ')}`}>Automatic</Pill>
                      : <Pill tone="warning" title={live?.problem ?? (status?.paused ? 'Automation is paused.' : undefined)}>{status?.paused ? 'Automatic · paused' : 'Automatic · waiting'}</Pill>)}
                  </strong>
                  <span className="muted small">Priority {r.priority}</span>
                  <span className="muted">
                    In <span className="mono">{r.scope}</span>{r.recursive ? ' (and subfolders)' : ''}, items matching <code>{r.condition}</code>
                    {r.exclusion && <> except <code>{r.exclusion}</code></>} → {r.action.type === 'tag' ? `tag “${r.action.tag}”` : r.action.type === 'collect' ? `add to collection` : <>{r.action.type} to <span className="mono">{r.action.toDir}</span></>}
                  </span>
                  {r.automatic?.enabled && live?.problem && <span className="warning-text small">Not running automatically: {live.problem}</span>}
                  {r.automatic?.enabled && !!live?.unavailable.length && <span className="warning-text small">Not available: {live.unavailable.join(', ')}</span>}
                </div>
                <div className="row-actions">
                  <Button size="sm" disabled={!r.enabled} title={r.enabled ? undefined : 'Enable the rule to preview and apply it.'} onClick={() => void call<{ items: DryItem[]; notes: string[] }>('rules:dryRun', { id: r.id }).then((d) => setDry({ rule: r, ...d }), toastError)}>Preview</Button>
                  <Button size="sm" variant="ghost" icon="automation" onClick={() => setAuto(r)}>Automatic…</Button>
                  <Button size="sm" variant="ghost" onClick={() => setHistory(r)}>History</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (await confirm({ title: `Delete rule “${r.name}”?`, body: 'Only the rule is deleted. No files are affected.', confirmLabel: 'Delete rule' })) await call('rules:delete', { id: r.id }).then(load, toastError);
                  }}>Delete</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <AutomationPanel onChanged={load} />
      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} onSaved={(saved) => {
        if (editing.automatic?.enabled && !saved.automatic?.enabled) toast({ level: 'warning', title: 'Automation turned off for this rule', detail: 'What the rule matches or does changed. Preview and apply it by hand once, then turn automation on again.' });
        setEditing(null);
        load();
      }} />}
      {dry && <DryRunDialog {...dry} onClose={() => { setDry(null); load(); }} />}
      {history && <RuleHistoryDialog rule={history} onClose={() => setHistory(null)} />}
      {auto && <AutomationDialog rule={auto} onClose={() => setAuto(null)} onSaved={() => { setAuto(null); load(); }} />}
    </div>
  );
}

function RuleEditor({ rule, onClose, onSaved }: { rule: Partial<Rule>; onClose: () => void; onSaved: (saved: Rule) => void }) {
  const [r, setR] = useState<Partial<Rule>>(rule);
  const [error, setError] = useState<string | null>(null);
  const [condHint, setCondHint] = useState<string | undefined>();
  const collections = useStore(app, (s) => s.collections);
  useEffect(() => {
    const t = setTimeout(() => void call<{ ok: boolean; message?: string }>('search:parse', { query: r.condition ?? '' }).then((x) => setCondHint(x.ok ? undefined : x.message)), 200);
    return () => clearTimeout(t);
  }, [r.condition]);
  const action = r.action ?? { type: 'move', toDir: '' };
  return (
    <Dialog title={rule.id ? 'Edit rule' : 'New rule'} onClose={onClose} width={620} footer={
      <>
        {error && <span className="field-error grow">{error}</span>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!!condHint} onClick={() => {
          // Only the rule's own fields go to the main process (status fields are computed there).
          const { approved: _a, automationProblem: _p, ...def } = r;
          void call<Rule>('rules:save', { rule: def }).then(onSaved, (e) => setError((e as Error).message));
        }}>Save rule</Button>
      </>
    }>
      <div className="form">
        <TextField label="Name" value={r.name ?? ''} onChange={(e) => setR({ ...r, name: e.target.value })} />
        <FolderPicker label="Folder to look in" value={r.scope ?? ''} onChange={(scope) => setR({ ...r, scope })} />
        <label className="check"><input type="checkbox" checked={!!r.recursive} onChange={(e) => setR({ ...r, recursive: e.target.checked })} /> Include subfolders</label>
        <TextField label="Match items (search syntax)" mono value={r.condition ?? ''} error={condHint} hint="e.g. type:pdf, ext:zip modified:>2024-01-01, size:>500MB" onChange={(e) => setR({ ...r, condition: e.target.value })} />
        <TextField label="Except items matching (optional)" mono value={r.exclusion ?? ''} onChange={(e) => setR({ ...r, exclusion: e.target.value })} />
        <Segmented<'move' | 'copy' | 'tag' | 'collect'> label="Action" value={action.type} onChange={(type) => setR({ ...r, action: type === 'tag' ? { type, tag: '' } : type === 'collect' ? { type, collectionId: collections[0]?.id ?? '' } : { type, toDir: 'toDir' in action ? action.toDir : '' } })}
          options={[{ value: 'move', label: 'Move' }, { value: 'copy', label: 'Copy' }, { value: 'tag', label: 'Tag' }, { value: 'collect', label: 'Add to collection' }]} />
        {(action.type === 'move' || action.type === 'copy') && <FolderPicker label="Destination folder" value={action.toDir} onChange={(toDir) => setR({ ...r, action: { type: action.type, toDir } })} />}
        {action.type === 'tag' && <TextField label="Tag" value={action.tag} onChange={(e) => setR({ ...r, action: { type: 'tag', tag: e.target.value } })} />}
        {action.type === 'collect' && (
          collections.length ? (
            <label className="field"><span className="field-label">Collection</span>
              <select className="input" value={action.collectionId} onChange={(e) => setR({ ...r, action: { type: 'collect', collectionId: e.target.value } })}>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ) : <p className="muted">Create a collection in the sidebar first.</p>
        )}
        <label className="field" htmlFor="rule-priority">
          <span className="field-label">Priority</span>
          <input id="rule-priority" type="number" className="input narrow" min={0} max={1000} value={r.priority ?? 100} aria-describedby="rule-priority-hint" onChange={(e) => setR({ ...r, priority: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })} />
          <span id="rule-priority-hint" className="field-hint">Lower numbers are listed and previewed first.</span>
        </label>
        <Toggle id="rule-enabled" label="Enabled" checked={r.enabled ?? true} onChange={(enabled) => setR({ ...r, enabled })} />
      </div>
    </Dialog>
  );
}

function DryRunDialog({ rule, items, notes, onClose }: { rule: Rule; items: DryItem[]; notes: string[]; onClose: () => void }) {
  const ready = items.filter((i) => i.status === 'ready' || i.status === 'conflict');
  const [chosen, setChosen] = useState<Set<string>>(new Set(items.filter((i) => i.status === 'ready').map((i) => i.path)));
  const apply = async () => {
    const res = await call<{ applied: number; failed: string[]; operationId?: string }>('rules:run', { id: rule.id, paths: [...chosen] }).catch((e) => {
      toastError(e);
      return null;
    });
    if (!res) return;
    if (res.operationId) watchOperation(res.operationId);
    if (!res.operationId) toast({ level: res.failed.length ? 'warning' : 'success', title: `Applied to ${res.applied} item${res.applied === 1 ? '' : 's'}${res.failed.length ? `; ${res.failed.length} failed` : ''}` });
    onClose();
  };
  return (
    <Dialog title={`Preview: ${rule.name}`} onClose={onClose} width={820} footer={
      <>
        <span className="muted grow">{chosen.size} of {items.length} selected. {rule.action.type === 'move' ? 'Moved items can be moved back from the operation history.' : ''}</span>
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" disabled={!chosen.size} onClick={() => void apply()}>Apply to {chosen.size} item{chosen.size === 1 ? '' : 's'}</Button>
      </>
    }>
      {notes.map((n) => <p key={n} className="warning-text">{n}</p>)}
      {!items.length ? <EmptyState icon="check" title="Nothing matches this rule right now" /> : (
        <table className="table">
          <thead><tr><th style={{ width: 28 }}><input type="checkbox" aria-label="Select all" checked={chosen.size === ready.length && ready.length > 0} onChange={(e) => setChosen(new Set(e.target.checked ? ready.map((i) => i.path) : []))} /></th><th>Item</th><th>Proposed change</th><th>Status</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.path} className={i.status === 'excluded' ? 'is-missing' : ''}>
                <td><input type="checkbox" aria-label={`Select ${i.name}`} disabled={i.status === 'excluded'} checked={chosen.has(i.path)} onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(i.path); else n.delete(i.path); setChosen(n); }} /></td>
                <td>{i.name}<div className="mono muted small">{i.path}</div></td>
                <td className="mono small">{i.destination ?? (rule.action.type === 'tag' ? `tag “${rule.action.tag}”` : 'add to collection')}</td>
                <td>{i.status === 'ready' ? <Pill tone="success">ready</Pill> : i.status === 'conflict' ? <Pill tone="warning">name exists — you’ll be asked</Pill> : <Pill>{i.status}</Pill>}{i.reason && i.status !== 'conflict' && <div className="muted small">{i.reason}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

interface RuleRun { id: string; ranMs: number; result: { applied: number; failed: string[]; paths?: string[]; operationId?: string; rolledBackMs?: number; rollback?: { undone: number; notes: string[] } } }

function RuleHistoryDialog({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const [runs, setRuns] = useState<RuleRun[] | null>(null);
  const load = () => void call<RuleRun[]>('rules:runs', { id: rule.id }).then(setRuns, toastError);
  useEffect(load, [rule.id]);
  const undo = async (run: RuleRun) => {
    const what = rule.action.type === 'move' ? 'move the items back to where they were' : rule.action.type === 'copy' ? 'move the copies it made to the Trash' : rule.action.type === 'tag' ? `remove the tag “${rule.action.tag}” from those items` : 'remove those items from the collection';
    if (!(await confirm({ title: 'Undo this run?', body: `This will ${what}. Items changed since then are reported and left alone; existing files are never overwritten without asking.`, confirmLabel: 'Undo run' }))) return;
    const r = await call<{ operations: string[]; undone: number; notes: string[] }>('rules:rollback', { ruleId: rule.id, runId: run.id }).catch((e) => {
      toastError(e);
      return null;
    });
    if (!r) return;
    r.operations.forEach(watchOperation);
    toast({ level: r.notes.length ? 'warning' : 'success', title: r.operations.length ? `Undoing ${r.undone} item${r.undone === 1 ? '' : 's'}…` : `Undid ${r.undone} item${r.undone === 1 ? '' : 's'}`, detail: r.notes.slice(0, 3).join(' ') || undefined });
    load();
  };
  return (
    <Dialog title={`History: ${rule.name}`} onClose={onClose} width={720}>
      {!runs ? <Loading label="Loading…" /> : !runs.length ? <EmptyState icon="history" title="This rule has not been applied yet" /> : (
        <table className="table">
          <thead><tr><th>When</th><th>Result</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td className="tabular">{formatDate(run.ranMs)}</td>
                <td>
                  Applied to {run.result.applied} item{run.result.applied === 1 ? '' : 's'}{run.result.failed?.length ? `, ${run.result.failed.length} failed` : ''}
                  {run.result.rolledBackMs && <div className="muted small">Undone {formatDate(run.result.rolledBackMs)}{run.result.rollback?.notes?.length ? ` — ${run.result.rollback.notes.slice(0, 2).join(' ')}` : ''}</div>}
                </td>
                <td className="row-actions">{run.result.rolledBackMs ? <Pill>undone</Pill> : <Button size="sm" variant="ghost" icon="undo" onClick={() => void undo(run)}>Undo…</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- downloads */

interface DownloadEntry { id: string; path: string; url: string | null; referrer: string | null; mime: string | null; state: string; browser: string; startedMs: number | null; finishedMs: number | null; source: string; exists?: boolean; size?: number; modifiedMs?: number }

export function DownloadsView() {
  const downloadsDir = useStore(app, (s) => s.known.find((k) => k.id === 'downloads')?.path);
  const [registered, setRegistered] = useState<DownloadEntry[] | null>(null);
  const [folder, setFolder] = useState<FileEntry[] | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const load = () => void call<DownloadEntry[]>('cat:downloads').then(setRegistered, toastError);
  useEffect(load, []);
  useEffect(() => {
    if (!downloadsDir) return;
    void (async () => {
      try {
        const r = await startListing(downloadsDir, false).done;
        if (r.error) setFolderError(r.error.message);
        else setFolder(r.entries.sort((a, c) => (c.modifiedMs ?? 0) - (a.modifiedMs ?? 0)));
      } catch (err) {
        setFolderError((err as Error).message);
      }
    })();
  }, [downloadsDir]);
  const registeredPaths = useMemo(() => new Set((registered ?? []).map((d) => d.path)), [registered]);

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Downloads</h1>
        <p className="muted">Downloads registered by the Orbis browser show their source and status. Other files in your Downloads folder are listed from disk; for those, the source website and browser are not known.</p>
      </header>
      <section className="home-section">
        <div className="section-head"><h2>From the Orbis browser</h2></div>
        {!registered ? <Loading label="Loading…" /> : !registered.length ? (
          <p className="muted">No downloads have been registered. When the Orbis browser is connected, it registers each download here with its source address. Orbis Files does not read other browsers’ private download history.</p>
        ) : (
          <table className="table">
            <thead><tr><th>File</th><th>Source</th><th>Status</th><th className="num">Size</th><th className="wide-only">Finished</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {registered.map((d) => (
                <tr key={d.id} className={d.exists ? '' : 'is-missing'}>
                  <td>{d.path.split(/[\\/]/).pop()}<div className="mono muted small">{d.path}</div></td>
                  <td className="small">{d.url ? <span className="mono" title={d.url}>{urlHost(d.url)}</span> : <span className="muted">unknown</span>}<div className="muted">{d.browser}</div></td>
                  <td><Pill tone={d.state === 'completed' ? 'success' : d.state === 'failed' || d.state === 'interrupted' ? 'error' : 'neutral'}>{d.state}</Pill>{!d.exists && <div className="warning-text small">File not found on disk</div>}</td>
                  <td className="tabular num">{formatBytes(d.size)}</td>
                  <td className="tabular wide-only">{formatDate(d.finishedMs ?? undefined)}</td>
                  <td className="row-actions">
                    {d.exists && <Button size="sm" variant="ghost" onClick={() => void openFile(d.path)}>Open</Button>}
                    {d.exists && <Button size="sm" variant="ghost" onClick={() => void navigate(activePane().id, { kind: 'fs', path: parentPath(d.path)! }, { select: d.path })}>Show</Button>}
                    <Button size="sm" variant="ghost" title="Removes this entry only; the file stays on disk." onClick={() => void call('cat:removeDownloadEntry', { id: d.id }).then(load, toastError)}>Remove entry</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="home-section">
        <div className="section-head"><h2>Downloads folder</h2>{downloadsDir && <span className="mono muted">{downloadsDir}</span>}<span className="spacer" />{downloadsDir && <button type="button" className="link-btn" onClick={() => void navigate(activePane().id, { kind: 'fs', path: downloadsDir })}>Open folder</button>}</div>
        {!downloadsDir ? <p className="muted">No Downloads folder was found on this system.</p> : folderError ? <ErrorState title="The Downloads folder could not be read" body={folderError} /> : !folder ? <Loading label="Reading folder…" /> : !folder.length ? <p className="muted">The folder is empty.</p> : (
          <table className="table">
            <thead><tr><th>File</th><th className="num">Size</th><th>Modified</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {folder.slice(0, 300).map((e) => (
                <tr key={e.path} className="clickable" onDoubleClick={() => void openFile(e.path)}>
                  <td>{e.name}{registeredPaths.has(e.path) && <Pill tone="accent">Orbis</Pill>}</td>
                  <td className="tabular num">{e.kind === 'directory' ? '—' : formatBytes(e.size)}</td>
                  <td className="tabular">{formatDate(e.modifiedMs)}</td>
                  <td className="row-actions"><Button size="sm" variant="ghost" onClick={() => void navigate(activePane().id, { kind: 'fs', path: downloadsDir }, { select: e.path })}>Show</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {folder && folder.length > 300 && <p className="muted small">Showing the 300 most recent of {folder.length}. Open the folder to see all.</p>}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- media */

export function MediaView() {
  const pictures = useStore(app, (s) => s.known.find((k) => k.id === 'pictures')?.path ?? s.known.find((k) => k.id === 'home')?.path ?? '/');
  const tags = useStore(app, (s) => s.tags);
  const [root, setRoot] = useState(pictures);
  const [kind, setKind] = useState<'image' | 'video' | 'audio'>('image');
  const [tag, setTag] = useState('');
  const [sortKey, setSortKey] = useState<'modified' | 'taken' | 'name' | 'size' | 'duration'>('modified');
  const [items, setItems] = useState<FileEntry[]>([]);
  const [meta, setMeta] = useState<Record<string, MediaSummary>>({});
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<{ complete: boolean; scanned: number } | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const menu = useMenu();

  useEffect(() => {
    const searchId = newId('media');
    const collected: FileEntry[] = [];
    setItems([]);
    setMeta({});
    setReport(null);
    setRunning(true);
    const offR = on<{ searchId: string; entries: FileEntry[] }>('search:results', (e) => {
      if (e.searchId !== searchId) return;
      collected.push(...e.entries);
      setItems(collected.slice());
    });
    const offD = on<{ searchId: string; report?: { complete: boolean; scanned: number } }>('search:done', (e) => {
      if (e.searchId !== searchId) return;
      setRunning(false);
      setReport(e.report ?? null);
    });
    const tagName = tags.find((t) => t.id === tag)?.name;
    void call('search:start', { query: `type:${kind}${tagName ? ` tag:"${tagName}"` : ''}`, scope: [root], searchId, useIndex: true, showHidden: false }).catch((err) => {
      setRunning(false);
      toastError(err);
    });
    return () => {
      offR();
      offD();
      void call('search:cancel', { searchId }).catch(() => undefined);
    };
  }, [root, kind, tag, tags]);

  // Date taken and duration are read from the files only when sorting needs them.
  useEffect(() => {
    if ((sortKey !== 'taken' && sortKey !== 'duration') || running || !items.length) return;
    let cancelled = false;
    void (async () => {
      const acc: Record<string, MediaSummary> = {};
      const paths = items.slice(0, 5000).map((e) => e.path);
      for (let i = 0; i < paths.length && !cancelled; i += 500) {
        Object.assign(acc, await call<Record<string, MediaSummary>>('meta:summaries', { paths: paths.slice(i, i + 500) }).catch(() => ({})));
        if (!cancelled) setMeta({ ...acc });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sortKey, running, items]);

  const sort = useMemo(() => ({ key: sortKey, dir: sortKey === 'name' ? 'asc' : 'desc', foldersFirst: false }) as const, [sortKey]);
  const rows = useMemo(() => arrange(items, sort as never, sortKey === 'modified' ? 'modified' : 'none', '', { meta }), [items, sort, sortKey, meta]);
  const ordered = useMemo(() => rows.flatMap((r) => (r.type === 'item' ? [r.entry] : [])), [rows]);

  const onContext = (e: React.MouseEvent, entry?: FileEntry) => {
    if (!entry) return;
    const sel = selection.includes(entry.path) ? selection : [entry.path];
    if (!selection.includes(entry.path)) setSelection([entry.path]);
    const selected = ordered.filter((x) => sel.includes(x.path));
    const items: MenuItem[] = [
      { label: 'Open', icon: 'open', run: () => void openFile(entry.path) },
      { label: 'View', icon: 'fullscreen', run: () => setViewing(ordered.findIndex((x) => x.path === entry.path)) },
      { label: 'Open with…', icon: 'openWith', run: () => openDialog('openWith', { path: entry.path }) },
      { label: 'Show in folder', icon: 'folderOpen', run: () => void navigate(activePane().id, { kind: 'fs', path: parentPath(entry.path)! }, { select: entry.path }) },
      { label: '', separator: true },
      ...(selected.length === 2 && kind === 'image' ? [{ label: 'Compare images', icon: 'compareImages', run: () => openDialog('imageCompare', { left: selected[0]!.path, right: selected[1]!.path }) }] : []),
      { label: 'Convert…', icon: 'convert', run: () => openDialog('convert', { paths: selected.map((x) => x.path), dir: parentPath(entry.path)! }) },
      { label: 'Tags…', icon: 'tag', run: () => openDialog('tag', { paths: selected.map((x) => x.path) }) },
      { label: 'Add to collection…', icon: 'collection', run: () => openDialog('collect', { paths: selected.map((x) => x.path) }) },
    ];
    menu.open(items, e.clientX, e.clientY);
  };

  return (
    <div className="tool-view media-view">
      <header className="view-header compact">
        <div>
          <h1>Media library</h1>
          <p className="muted">Browses media where it already is. Nothing is imported or copied.</p>
        </div>
      </header>
      <div className="tool-controls">
        <FolderPicker value={root} onChange={setRoot} label="Folder" />
        <Segmented<'image' | 'video' | 'audio'> label="Media type" value={kind} onChange={setKind} options={[{ value: 'image', label: 'Images' }, { value: 'video', label: 'Videos' }, { value: 'audio', label: 'Audio' }]} />
        <label className="field narrow" htmlFor="media-sort"><span className="field-label">Sort</span>
          <select id="media-sort" className="input" value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)}>
            <option value="modified">Newest first</option>
            {kind === 'image' && <option value="taken">Date taken (from the photo)</option>}
            {kind !== 'image' && <option value="duration">Longest first</option>}
            <option value="name">Name</option>
            <option value="size">Largest first</option>
          </select>
        </label>
        <label className="field narrow" htmlFor="media-tag"><span className="field-label">Tag</span>
          <select id="media-tag" className="input" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Any</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <span className="muted tabular">{items.length.toLocaleString()} found{running ? ' · searching…' : report && !report.complete ? ' · partial' : ''}</span>
      </div>
      <div className="media-grid fill">
        {!items.length && !running ? <EmptyState icon="media" title={`No ${kind} files ${tag ? 'with this tag ' : ''}in this folder`} /> : (
          <GridView
            rows={rows}
            selection={selection}
            focus={selection[0]}
            view="gallery"
            sort={sort as never}
            active
            onSort={() => undefined}
            onSelect={(p) => setSelection(p)}
            onOpen={(e) => setViewing(ordered.findIndex((x) => x.path === e.path))}
            onContext={onContext}
            onScroll={() => undefined}
            onActivate={() => undefined}
          />
        )}
      </div>
      {viewing !== null && ordered[viewing] && <MediaViewer entries={ordered} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
      {menu.node}
    </div>
  );
}
