import { useEffect, useState } from 'react';
import { call } from '../api';
import { closeDialog, toastError } from '../state/app';
import { diffWithDisk, nameOf, runConflictChoice, saveAll, saveAsTo, uiOf, type ConflictChoice, type EditorUi } from '../state/editor';
import { Button, Dialog, Loading, Segmented, Select, TextField } from '../ui/components';
import { Icon } from '../ui/Icon';
import { formatBytes } from '../ui/format';
import { TextDiffBody, type TextDiff } from './views/DuplicatesCompare';
import { ENCODING_SHORT, encodingLabel } from './EditorPane';
import type { EditorSaveResult, EditorStamp, EolKind } from '../../shared/editor';
import type { TextEncodingName } from '../../shared/docTools';

/** Save / Don't save / Cancel before unsaved editor changes would be lost. */
export function EditorUnsavedDialog({ paneIds, action, resolve }: { paneIds: string[]; action: string; resolve: (ok: boolean) => void }) {
  const names = paneIds.map(nameOf);
  const finish = (ok: boolean) => {
    closeDialog();
    resolve(ok);
  };
  const saveThem = async () => {
    closeDialog();
    resolve(await saveAll(paneIds));
  };
  return (
    <Dialog title={names.length === 1 ? `Save changes to “${names[0]}”?` : `Save changes to ${names.length} files?`} onClose={() => finish(false)} className="editor-unsaved-dialog" footer={
      <>
        <Button onClick={() => finish(false)}>Cancel</Button>
        <Button variant="danger" onClick={() => finish(true)}>Don't save</Button>
        <Button variant="primary" icon="save" onClick={() => void saveThem()} data-autofocus>Save</Button>
      </>
    }>
      <p>You are about to {action}. {names.length === 1 ? 'Your changes are lost if you do not save them.' : 'Changes in these files are lost if you do not save them:'}</p>
      {names.length > 1 && <ul className="confirm-detail mono">{names.map((n, i) => <li key={`${n}-${i}`}>{n}</li>)}</ul>}
    </Dialog>
  );
}

/** The file changed on disk since it was opened (or vanished): what to keep. Nothing has been written when this shows. */
export function EditorConflictDialog({ paneId, current, resolve }: { paneId: string; current: EditorStamp | null; resolve: (ok: boolean) => void }) {
  const ui = uiOf(paneId);
  const name = nameOf(paneId);
  const [diff, setDiff] = useState<(TextDiff & { missing: boolean }) | 'loading' | null>(null);
  const [error, setError] = useState<string>();
  const run = async (choice: ConflictChoice) => {
    closeDialog();
    resolve(choice === 'cancel' ? false : await runConflictChoice(paneId, choice, current));
  };
  const showDiff = async () => {
    setDiff('loading');
    try {
      setDiff(await diffWithDisk(paneId));
    } catch (err) {
      setDiff(null);
      setError((err as Error).message);
    }
  };
  const loaded = ui?.meta?.stamp;
  return (
    <Dialog title={current ? `“${name}” was changed by another program` : `“${name}” is no longer there`} width={640} onClose={() => void run('cancel')} className="editor-conflict-dialog" footer={
      <>
        <Button onClick={() => void run('cancel')}>Cancel</Button>
        <Button onClick={() => void run('reload')} disabled={!current}>Reload theirs</Button>
        <Button onClick={() => void run('copy')} data-autofocus>Save as copy</Button>
        <Button variant="danger" onClick={() => void run('overwrite')}>{current ? 'Overwrite' : 'Create it again'}</Button>
      </>
    }>
      <p>
        {current
          ? 'The file on disk is not the version you opened, so nothing was saved yet. Choose which version to keep:'
          : 'The file was deleted, renamed or moved after you opened it, so nothing was saved yet.'}
      </p>
      <ul className="editor-conflict-options">
        {current && <li><strong>Reload theirs</strong> discards your changes and shows the file as it is now.</li>}
        <li><strong>Save as copy</strong> keeps both: your version is saved as “{copyLabel(name)}” beside it and you continue editing that copy.</li>
        <li><strong>{current ? 'Overwrite' : 'Create it again'}</strong> {current ? 'replaces their version with yours (theirs is kept as a snapshot in Properties → Snapshots).' : 'writes your version under the original name.'}</li>
      </ul>
      {current && loaded && (
        <p className="muted small tabular">When opened: {formatBytes(loaded.size)}, modified {new Date(loaded.mtimeMs).toLocaleString()} · Now: {formatBytes(current.size)}, modified {new Date(current.mtimeMs).toLocaleString()}</p>
      )}
      {current && !diff && <Button size="sm" icon="diff" onClick={() => void showDiff()}>Show differences</Button>}
      {error && <p className="field-error">{error}</p>}
      {diff === 'loading' && <Loading label="Comparing…" />}
      {diff && diff !== 'loading' && (
        <div className="editor-diff">
          <p className="muted small">Left: the file on disk. Right: your version. {diff.identical ? 'The text is the same (only the encoding or line endings differ).' : `${diff.added} line${diff.added === 1 ? '' : 's'} only in yours, ${diff.removed} only on disk.`}</p>
          {!diff.identical && <TextDiffBody text={diff} layout="unified" />}
        </div>
      )}
    </Dialog>
  );
}

const copyLabel = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (copy)${name.slice(dot)}` : `${name} (copy)`;
};

/** Differences between the editor's text and the file on disk. */
export function EditorDiffDialog({ paneId }: { paneId: string }) {
  const [diff, setDiff] = useState<(TextDiff & { missing: boolean }) | null>(null);
  const [error, setError] = useState<string>();
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  useEffect(() => {
    diffWithDisk(paneId).then(setDiff, (err: Error) => setError(err.message));
  }, [paneId]);
  return (
    <Dialog title={`Compare “${nameOf(paneId)}” with the file on disk`} width={760} onClose={closeDialog} className="editor-diff-dialog" footer={<Button variant="primary" onClick={closeDialog}>Close</Button>}>
      {error && <p className="field-error">{error}</p>}
      {!diff && !error && <Loading label="Comparing…" />}
      {diff && (
        <>
          <div className="editor-diff-head">
            <p className="muted small">{diff.missing ? 'The file is not on disk any more; everything is new in your version.' : diff.identical ? 'Your text is the same as the file on disk.' : `Left: on disk · Right: yours — ${diff.added} line${diff.added === 1 ? '' : 's'} added, ${diff.removed} removed.`}</p>
            <Segmented<'unified' | 'split'> label="Layout" value={layout} onChange={setLayout} options={[{ value: 'unified', label: 'Unified' }, { value: 'split', label: 'Side by side' }]} />
          </div>
          {!diff.identical && <TextDiffBody text={diff} layout={layout} />}
        </>
      )}
    </Dialog>
  );
}

type EncChoice = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'windows1252' | 'latin1';
const toChoice = (s: EditorUi['save']): EncChoice => (s.encoding === 'utf8' ? (s.bom ? 'utf8bom' : 'utf8') : s.encoding);
const fromChoice = (c: EncChoice): { encoding: TextEncodingName; bom: boolean } => (c === 'utf8bom' ? { encoding: 'utf8', bom: true } : { encoding: c, bom: c === 'utf16le' || c === 'utf16be' });

/** Save as…: name, folder, encoding and line endings. An existing file is only replaced after a confirmation here. */
export function EditorSaveAsDialog({ paneId, resolve }: { paneId: string; resolve: (ok: boolean) => void }) {
  const ui = uiOf(paneId);
  const meta = ui?.meta;
  const sep = meta?.path.includes('\\') && !meta.path.includes('/') ? '\\' : '/';
  const [dir, setDir] = useState(meta ? meta.path.slice(0, Math.max(1, meta.path.lastIndexOf(sep))) : '');
  const [name, setName] = useState(meta?.name ?? '');
  const [enc, setEnc] = useState<EncChoice>(ui ? toChoice(ui.save) : 'utf8');
  const [eol, setEol] = useState<EolKind>(ui?.save.eol ?? 'lf');
  const [exists, setExists] = useState<{ path: string; current: EditorStamp } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const finish = (ok: boolean) => {
    closeDialog();
    resolve(ok);
  };
  const submit = async (replace?: EditorStamp) => {
    setError(undefined);
    if (!name.trim()) return setError('Enter a file name.');
    setBusy(true);
    try {
      const r: EditorSaveResult | null = await saveAsTo(paneId, dir, name.trim(), { ...fromChoice(enc), eol }, replace);
      if (!r) return setError('The editor is not ready.');
      if (r.status === 'saved') return finish(true);
      if (r.status === 'exists') {
        if (!r.current) return setError('Something with this name is in the way and cannot be replaced. Choose another name.');
        setExists({ path: r.path, current: r.current });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = async () => {
    const d = await call<string | null>('fs:pickDirectory', { title: 'Save in folder' }).catch((err) => {
      toastError(err);
      return null;
    });
    if (d) setDir(d);
  };
  return (
    <Dialog title="Save as" width={520} onClose={() => finish(false)} className="editor-saveas-dialog" footer={exists ? (
      <>
        <Button onClick={() => setExists(null)} data-autofocus>Choose another name</Button>
        <Button variant="danger" disabled={busy} onClick={() => void submit(exists.current)}>Replace</Button>
      </>
    ) : (
      <>
        <Button onClick={() => finish(false)}>Cancel</Button>
        <Button variant="primary" icon="save" disabled={busy || !name.trim() || !dir.trim()} onClick={() => void submit()}>Save</Button>
      </>
    )}>
      {exists ? (
        <div className="callout warning" role="alert">
          <Icon name="warning" size={16} />
          <div>
            <p><strong>“{name}” already exists in this folder.</strong> Replace it with your text?</p>
            <p className="muted small">Its current contents ({formatBytes(exists.current.size)}) are kept as a snapshot (Properties → Snapshots).</p>
          </div>
        </div>
      ) : (
        <form className="editor-saveas" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <TextField id="saveas-name" label="File name" value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} autoFocus />
          <div className="editor-saveas-folder">
            <TextField id="saveas-dir" label="Folder" mono value={dir} spellCheck={false} onChange={(e) => setDir(e.target.value)} />
            <Button onClick={() => void pick()}>Choose…</Button>
          </div>
          <div className="editor-saveas-format">
            <Select<EncChoice> id="saveas-encoding" label="Encoding" value={enc} onChange={setEnc} options={(['utf8', 'utf8bom', 'utf16le', 'utf16be', 'windows1252', 'latin1'] as EncChoice[]).map((c) => ({ value: c, label: c === 'utf8bom' ? 'UTF-8 with BOM' : c === 'utf8' ? 'UTF-8' : ENCODING_SHORT[c] }))} />
            <Select<EolKind> id="saveas-eol" label="Line endings" value={eol} onChange={setEol} options={[{ value: 'lf', label: 'LF (Linux, macOS)' }, { value: 'crlf', label: 'CRLF (Windows)' }, ...(eol === 'cr' ? [{ value: 'cr' as const, label: 'CR (classic Mac OS)' }] : [])]} />
          </div>
          {meta && (fromChoice(enc).encoding !== meta.encoding || eol !== meta.eol) && <p className="muted small">The current file is {encodingLabel(meta.encoding, meta.bom)}, {eol === meta.eol ? 'same line endings' : `${meta.eol.toUpperCase()} line endings`}; the new file is written as chosen here.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}
