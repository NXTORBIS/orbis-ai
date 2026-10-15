import { useEffect, useMemo, useRef, useState } from 'react';
import { call, runJob } from '../api';
import { closeDialog, toast, toastError } from '../state/app';
import { Button, Dialog, Pill, Segmented, Select, TextField } from '../ui/components';
import { Icon } from '../ui/Icon';
import { startOperation } from '../actions';
import { FolderPicker } from './views/common';
import {
  DATE_SOURCE_LABEL, DEFAULT_ORGANIZE_SPEC, ORGANIZE_TOKENS, patternProblem, renderPattern, TOKEN_HELP,
  type OrganizeItem, type OrganizePlan, type OrganizePreset, type OrganizeSpec,
} from '../../shared/organize';

/**
 * Organize by date: choose a folder pattern, what to include and where the
 * folders go; the preview lists every file with its destination, the date
 * used (taken, recorded or modified) and conflicts before anything changes.
 * The work is one 'organize-date' operation (conflicts asked: keep both or
 * skip) that can be undone from its result.
 */

const sep = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const relTo = (root: string, p: string) => {
  const r = root.replace(/[\\/]+$/, '');
  return p.startsWith(r) ? p.slice(r.length).replace(/^[\\/]+/, '') : p;
};

export function OrganizeByDateDialog({ paths, destination: initialDest, folders }: { paths: string[]; destination: string; folders: number }) {
  const [spec, setSpec] = useState<OrganizeSpec>(DEFAULT_ORGANIZE_SPEC);
  const [destination, setDestination] = useState(initialDest);
  const [presets, setPresets] = useState<OrganizePreset[]>([]);
  const [presetId, setPresetId] = useState('builtin:year-month');
  const [plan, setPlan] = useState<OrganizePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const jobRef = useRef<{ cancel: () => void } | null>(null);
  const problem = patternProblem(spec.pattern);
  const set = (patch: Partial<OrganizeSpec>) => setSpec((s) => ({ ...s, ...patch }));

  useEffect(() => void call<OrganizePreset[]>('organize:presets').then(setPresets, toastError), []);
  // Re-plan (debounced) whenever the settings change; an older plan is cancelled.
  useEffect(() => {
    if (problem) {
      setPlan(null);
      return;
    }
    setProgress('Reading dates…');
    const t = setTimeout(() => {
      jobRef.current?.cancel();
      const job = runJob<OrganizePlan>((jobId) => call('organize:plan', { paths, destination, spec, jobId }), (p) => {
        const o = p as { items?: number; total?: number };
        if (o.total) setProgress(`Reading dates… ${o.items ?? 0} of ${o.total}`);
      });
      jobRef.current = job;
      job.promise.then((r) => {
        if (jobRef.current !== job || r.cancelled) return;
        setPlan(r.value ?? null);
        setPlanError(null);
        setProgress(null);
      }, (e) => {
        if (jobRef.current !== job) return;
        setPlanError((e as Error).message);
        setProgress(null);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [paths, destination, spec, problem]);
  useEffect(() => () => jobRef.current?.cancel(), []);

  const items = plan?.items ?? [];
  const todo = items.filter((i) => i.action !== 'skip');
  const skipped = items.filter((i) => i.action === 'skip');
  const conflicts = todo.filter((i) => i.conflict);
  const bySource = useMemo(() => {
    const n = { exif: 0, video: 0, modified: 0 };
    for (const i of todo) if (i.dateSource) n[i.dateSource]++;
    return n;
  }, [todo]);
  const example = useMemo(() => (problem ? undefined : renderPattern(spec.pattern, { year: 2024, month: 5, day: 17, camera: 'Canon EOS R6', ext: 'jpg' }).join('/')), [spec.pattern, problem]);

  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (p) set({ pattern: p.pattern });
  };
  const [naming, setNaming] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const savePreset = async () => {
    const name = (naming ?? '').trim();
    if (!name) return setNameError('Enter a name.');
    const r = await call<{ preset: OrganizePreset; presets: OrganizePreset[] }>('organize:savePreset', { name, pattern: spec.pattern }).catch((e) => {
      setNameError((e as Error).message);
      return null;
    });
    if (!r) return;
    setPresets(r.presets);
    setPresetId(r.preset.id);
    setNaming(null);
    setNameError(undefined);
    toast({ level: 'success', title: `Saved pattern “${r.preset.name}”` });
  };
  const userPreset = presets.find((p) => p.id === presetId && !p.builtIn);
  const deletePreset = async () => {
    if (!userPreset) return;
    const r = await call<{ presets: OrganizePreset[] }>('organize:deletePreset', { id: userPreset.id }).catch((e) => {
      toastError(e);
      return null;
    });
    if (r) {
      setPresets(r.presets);
      setPresetId('custom');
      toast({ level: 'info', title: `Deleted pattern “${userPreset.name}”`, detail: 'The pattern stays in the dialog.' });
    }
  };
  const insertToken = (t: string) => {
    const input = document.getElementById('org-pattern') as HTMLInputElement | null;
    const at = input?.selectionStart ?? spec.pattern.length;
    const end = input?.selectionEnd ?? at;
    set({ pattern: `${spec.pattern.slice(0, at)}{${t}}${spec.pattern.slice(end)}` });
    setPresetId('custom');
    requestAnimationFrame(() => {
      input?.focus();
      const pos = at + t.length + 2;
      input?.setSelectionRange(pos, pos);
    });
  };

  const go = async () => {
    if (!todo.length || problem) return;
    setStarting(true);
    const rec = await startOperation({ type: 'organize-date', sources: todo.map((i) => i.source), destination, conflictPolicy: 'ask', params: { spec }, origin: 'organize-date' });
    setStarting(false);
    if (rec) closeDialog();
  };

  const verb = spec.mode === 'move' ? 'Move' : 'Copy';
  const summary = !plan ? (progress ?? (problem ? 'Fix the pattern to see the preview.' : 'Reading dates…')) : [
    `${todo.length} to ${spec.mode}`,
    skipped.length ? `${skipped.length} left where they are` : '',
    conflicts.length ? `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} (you will be asked)` : '',
    plan.newFolders.length ? `${plan.newFolders.length} new folder${plan.newFolders.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');
  const title = paths.length === 1 ? base(paths[0]!) : `${paths.length} items`;

  return (
    <Dialog title={`Organize by date · ${title}`} onClose={closeDialog} width={940} className="organize-dialog" footer={
      <>
        <span className="muted small grow" aria-live="polite">{summary}</span>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={starting || !plan || !todo.length || !!problem || !!planError} onClick={() => void go()}>{`${verb} ${todo.length} file${todo.length === 1 ? '' : 's'}`}</Button>
      </>
    }>
      <div className="org">
        <div className="org-settings">
          <div className="imgt-presets">
            <Select<string> id="org-preset" label="Folder pattern preset" value={presetId} onChange={applyPreset}
              options={[...(presets.some((p) => p.id === presetId) ? [] : [{ value: presetId, label: 'Custom pattern' }]), ...presets.map((p) => ({ value: p.id, label: p.builtIn ? `${p.name} — ${p.pattern}` : `${p.name} (saved) — ${p.pattern}` }))]} />
            {naming === null && (
              <div className="imgt-preset-actions">
                <Button size="sm" variant="ghost" icon="save" disabled={!!problem} onClick={() => setNaming('')}>Save pattern…</Button>
                {userPreset && <Button size="sm" variant="ghost" onClick={() => void deletePreset()}>Delete</Button>}
              </div>
            )}
          </div>
          {naming !== null && (
            <div className="imgt-preset-name">
              <TextField id="org-preset-name" label="Name for this pattern" value={naming} error={nameError} autoFocus maxLength={80}
                onChange={(e) => { setNaming(e.target.value); setNameError(undefined); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void savePreset(); }
                  if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); }
                }} />
              <Button size="sm" variant="primary" onClick={() => void savePreset()}>Save</Button>
              <Button size="sm" onClick={() => setNaming(null)}>Cancel</Button>
            </div>
          )}
          <fieldset className="imgt-group">
            <legend>Folders</legend>
            <TextField id="org-pattern" label="Folder pattern" mono value={spec.pattern} maxLength={200} spellCheck={false}
              error={problem} hint={example ? `Example: ${example}/IMG_0042.jpg` : undefined}
              onChange={(e) => { set({ pattern: e.target.value }); setPresetId('custom'); }} />
            <div className="org-tokens" role="group" aria-label="Insert a token">
              {ORGANIZE_TOKENS.map((t) => (
                <button key={t} type="button" className="org-token mono" title={`Insert {${t}}: ${TOKEN_HELP[t]}`} aria-label={`Insert {${t}}, ${TOKEN_HELP[t]}`} onClick={() => insertToken(t)}>{`{${t}}`}</button>
              ))}
            </div>
            <FolderPicker id="org-dest" label="Create the folders in" value={destination} onChange={setDestination} />
          </fieldset>
          <fieldset className="imgt-group">
            <legend>Files</legend>
            <Segmented<OrganizeSpec['mode']> label="Move or copy" value={spec.mode} onChange={(mode) => set({ mode })} options={[{ value: 'move', label: 'Move' }, { value: 'copy', label: 'Copy' }]} />
            <Segmented<OrganizeSpec['include']> label="Which files" value={spec.include} onChange={(include) => set({ include })} options={[{ value: 'media', label: 'Photos and videos' }, { value: 'all', label: 'All files' }]} />
            {folders > 0 && <label className="check"><input type="checkbox" checked={spec.recursive} onChange={(e) => set({ recursive: e.target.checked })} /> Include files in subfolders</label>}
            <div className="org-radio" role="radiogroup" aria-labelledby="org-nodate-label">
              <span id="org-nodate-label" className="field-label">Files without a date taken</span>
              <label className="check"><input type="radio" name="org-nodate" checked={spec.withoutTakenDate === 'modified'} onChange={() => set({ withoutTakenDate: 'modified' })} /> Use the date they were modified</label>
              <label className="check"><input type="radio" name="org-nodate" checked={spec.withoutTakenDate === 'skip'} onChange={() => set({ withoutTakenDate: 'skip' })} /> Leave them where they are</label>
            </div>
            <p className="muted small">Photos use the date taken (EXIF), videos the recording date stored in the file. Nothing is ever replaced: for a name that is taken you choose Keep both or Skip.</p>
          </fieldset>
        </div>
        <div className="org-preview">
          <div className="org-preview-head">
            <h3>Preview</h3>
            {plan && todo.length > 0 && (
              <span className="org-sources small">
                {bySource.exif > 0 && <Pill tone="accent">{bySource.exif} by date taken</Pill>}
                {bySource.video > 0 && <Pill tone="accent">{bySource.video} by recording date</Pill>}
                {bySource.modified > 0 && <Pill>{bySource.modified} by date modified</Pill>}
              </span>
            )}
          </div>
          {planError ? <p className="error-text">{planError}</p> : !plan ? <p className="muted small" role="status">{progress ?? summary}</p> : !items.length ? (
            <p className="muted small">{spec.include === 'media' ? 'No photos or videos found.' : 'No files found.'}{folders > 0 && !spec.recursive ? ' Files in subfolders are included only with “Include files in subfolders”.' : ''}</p>
          ) : (
            <div className="org-table-wrap">
              <table className="table org-table" aria-label="Planned destinations">
                <thead><tr><th scope="col">File</th><th scope="col">Goes to</th><th scope="col">Date</th></tr></thead>
                <tbody>
                  {items.slice(0, 500).map((i) => <PlanRow key={i.source} item={i} root={destination} />)}
                </tbody>
              </table>
              {items.length > 500 && <p className="muted small org-more">The first 500 of {items.length} files are listed; all of them are organized.</p>}
            </div>
          )}
          {plan && (plan.ignored > 0 || plan.truncated) && (
            <p className="muted small">{plan.truncated ? 'Only the first 50,000 files are included. ' : ''}{plan.ignored > 0 ? `${plan.ignored} other item${plan.ignored === 1 ? ' was' : 's were'} not included (links, hidden files${spec.include === 'media' ? ', files that are not photos or videos' : ''}${!spec.recursive && folders ? ', subfolders' : ''}).` : ''}</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function PlanRow({ item: i, root }: { item: OrganizeItem; root: string }) {
  const dir = i.targetDir ? relTo(root, i.targetDir) : '';
  return (
    <tr className={i.action === 'skip' ? 'is-skip' : i.conflict ? 'is-conflict' : ''}>
      <td className="org-file"><span className="ellipsis" title={i.source}>{i.name}</span></td>
      <td>
        {i.action === 'skip' ? <span className="muted">{i.reason ?? 'Left where it is'}</span> : (
          <div className="org-dest">
            <span className="mono small ellipsis" title={i.target}><Icon name="folder" size={12} /> {dir.split(/[\\/]/).join(` ${sep(root)} `) || '.'}</span>
            {i.conflict && <Pill tone="warning" title={i.conflict === 'exists' ? 'A file with this name is already there: you will choose Keep both or Skip.' : 'Another file in this list goes to the same name: you will choose Keep both or Skip.'}>{i.conflict === 'exists' ? 'name taken' : 'same name twice'}</Pill>}
          </div>
        )}
      </td>
      <td className="org-date tabular small">{i.date ? <>{i.date}<span className="muted"> · {i.dateSource ? DATE_SOURCE_LABEL[i.dateSource] : ''}</span></> : <span className="muted">—</span>}</td>
    </tr>
  );
}
