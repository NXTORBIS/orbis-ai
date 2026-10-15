import React, { useEffect, useRef, useState } from 'react';
import { call, errorShape } from '../api';
import { app, closeDialog, confirm, toast, toastError } from '../state/app';
import { useStore } from '../state/store';
import { Button, Dialog, PasswordField, TextField, Toggle } from '../ui/components';
import { askArchivePassword, isPasswordError, startOperation } from '../actions';
import { ARCHIVE_PASSWORD_MAX } from '../../shared/ipc';
import { permissionString } from '../../shared/permissions';
import type { AudioTags, DocumentProps, ImageText, MediaMeta } from '../../shared/media';
import type { FileEntry } from '../../shared/model';

/* ---------------------------------------------------------------- embedded tags */

const AUDIO_FIELDS: Array<[keyof AudioTags, string]> = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['albumArtist', 'Album artist'], ['year', 'Year'], ['track', 'Track'], ['genre', 'Genre'], ['comment', 'Comment']];
const DOC_FIELDS: Array<[keyof DocumentProps, string]> = [['title', 'Title'], ['subject', 'Subject'], ['creator', 'Author'], ['keywords', 'Keywords'], ['description', 'Description']];
const IMAGE_FIELDS: Array<[keyof ImageText, string]> = [['title', 'Title'], ['author', 'Author'], ['description', 'Description'], ['copyright', 'Copyright'], ['comment', 'Comment'], ['software', 'Software']];

export type EmbeddedEditKind = 'audioTags' | 'documentProps' | 'imageText';

type FieldSource = Record<string, string | number | undefined> | undefined;
const EDIT_KINDS: Record<EmbeddedEditKind, { fields: Array<[string, string]>; title: string; source: (m: MediaMeta | null) => FieldSource; wrap: (diff: Record<string, string>) => Record<string, unknown> }> = {
  // MP3 (ID3) and FLAC (Vorbis comments) share the same fields and rules.
  audioTags: { fields: AUDIO_FIELDS, title: 'Edit audio tags', source: (m) => m?.tags as FieldSource, wrap: (tags) => ({ kind: 'audioTags', tags }) },
  documentProps: { fields: DOC_FIELDS, title: 'Edit document properties', source: (m) => m?.doc as FieldSource, wrap: (props) => ({ kind: 'documentProps', props }) },
  imageText: { fields: IMAGE_FIELDS, title: 'Edit image text', source: (m) => m?.imageText as FieldSource, wrap: (text) => ({ kind: 'imageText', text }) },
};

export function EditEmbeddedDialog({ path, kind }: { path: string; kind: EmbeddedEditKind }) {
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const spec = EDIT_KINDS[kind];
  const fields = spec.fields;
  useEffect(() => {
    void call<MediaMeta>('meta:read', { path }).then((m) => {
      setMeta(m);
      const src = spec.source(m);
      setValues(Object.fromEntries(fields.map(([k]) => [k, src?.[k] !== undefined ? String(src[k]) : ''])));
    }, toastError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, kind]);
  const original = (k: string) => {
    const src = spec.source(meta);
    return src?.[k] !== undefined ? String(src[k]) : '';
  };
  const changed = fields.filter(([k]) => (values[k] ?? '') !== original(k));
  const yearError = kind === 'audioTags' && values.year && !/^\d{4}$/.test(values.year.trim()) ? 'Four digits, e.g. 2024' : undefined;
  const trackError = kind === 'audioTags' && values.track && !/^\d{1,4}(\/\d{1,4})?$/.test(values.track.trim()) ? 'A number, optionally n/total' : undefined;
  const save = async () => {
    setBusy(true);
    const diff = Object.fromEntries(changed.map(([k]) => [k, values[k] ?? '']));
    const rec = await startOperation({ type: 'edit-metadata', sources: [path], origin: 'properties', params: { edit: spec.wrap(diff) } });
    setBusy(false);
    if (rec) closeDialog();
  };
  const where = kind === 'imageText'
    ? ' They are stored as PNG text chunks (Latin-1 text as tEXt, anything else as UTF-8 iTXt); the image data is not touched.'
    : kind === 'audioTags' && meta?.format === 'FLAC' ? ' They are stored as FLAC Vorbis comments; the audio, cover art and other comments are not touched.' : '';
  return (
    <Dialog title={spec.title} onClose={closeDialog} width={520} footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!meta || !changed.length || busy || !!yearError || !!trackError} onClick={() => void save()}>Save to file</Button>
      </>
    }>
      <p className="muted small">These values are written <strong>inside the file</strong>, so other apps will see them.{where} The original file is kept as a restorable snapshot first, and the change is verified before the original is replaced.</p>
      {!meta ? <p className="muted">Reading…</p> : (
        <div className="form-grid">
          {fields.map(([k, label]) => (
            <TextField key={k} id={`meta-${k}`} label={label} value={values[k] ?? ''} error={k === 'year' ? yearError : k === 'track' ? trackError : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
          ))}
        </div>
      )}
      {changed.length > 0 && <p className="muted small">Changing: {changed.map(([, l]) => l).join(', ')}. Clearing a field removes it from the file.</p>}
    </Dialog>
  );
}

export type EmbeddedRemoveKind = 'removeLocation' | 'removeExif' | 'removeAudioTags' | 'removeImageText';

const REMOVE_COPY: Record<EmbeddedRemoveKind, { title: string; body: string; confirmLabel: string }> = {
  removeLocation: { title: 'Remove location data from this photo?', body: 'GPS coordinates stored in the photo are erased. Camera details and the image itself are unchanged. A restorable snapshot of the original is kept by Orbis Files.', confirmLabel: 'Remove location' },
  removeExif: { title: 'Remove all EXIF data from this photo?', body: 'Camera details, date taken, orientation and location stored in the photo are erased (embedded XMP too). The image itself is unchanged. A restorable snapshot of the original is kept by Orbis Files.', confirmLabel: 'Remove EXIF' },
  removeAudioTags: { title: 'Remove all tags from this file?', body: 'Every Vorbis comment (title, artist, album and any other tag) is erased. The audio, the encoder’s vendor string and embedded cover art are unchanged. A restorable snapshot of the original is kept by Orbis Files.', confirmLabel: 'Remove tags' },
  removeImageText: { title: 'Remove all text metadata from this image?', body: 'Every PNG text chunk (title, author, description, comments, software, XMP and any other text) is erased. The image itself is unchanged. A restorable snapshot of the original is kept by Orbis Files.', confirmLabel: 'Remove text' },
};

export async function removeEmbedded(path: string, kind: EmbeddedRemoveKind): Promise<void> {
  const copy = REMOVE_COPY[kind];
  const ok = await confirm({ title: copy.title, body: copy.body, confirmLabel: copy.confirmLabel });
  if (ok) await startOperation({ type: 'edit-metadata', sources: [path], origin: 'properties', params: { edit: { kind } } });
}

/* ---------------------------------------------------------------- permissions */

const WHO: Array<[string, number]> = [['Owner', 6], ['Group', 3], ['Others', 0]];
const WHAT: Array<[string, number]> = [['Read', 4], ['Write', 2], ['Execute', 1]];

export function PermissionsDialog({ entry, onDone }: { entry: FileEntry; onDone?: () => void }) {
  const initial = (entry.mode ?? 0) & 0o7777;
  const [mode, setMode] = useState(initial);
  const [busy, setBusy] = useState(false);
  const isDir = entry.kind === 'directory';
  const windows = entry.uid === undefined;
  const apply = async () => {
    const removingOwnerAccess = (initial & 0o600) !== 0 && (mode & 0o600) === 0;
    if (removingOwnerAccess && !(await confirm({ title: 'Remove your own access?', body: 'Without owner read and write permission you may not be able to open or change this item afterwards.', confirmLabel: 'Apply anyway', destructive: true }))) return;
    setBusy(true);
    await call<FileEntry>('fs:chmod', { path: entry.path, mode }).then(() => {
      toast({ level: 'success', title: `Permissions changed to ${permissionString(mode, entry.kind)}` });
      onDone?.();
      closeDialog();
    }, toastError);
    setBusy(false);
  };
  return (
    <Dialog title={`Permissions — ${entry.name}`} onClose={closeDialog} width={460} footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={busy || mode === initial} onClick={() => void apply()}>Apply</Button>
      </>
    }>
      {windows ? (
        <label className="check">
          <input type="checkbox" checked={(mode & 0o200) === 0} onChange={(e) => setMode(e.target.checked ? mode & ~0o222 : mode | 0o200)} /> Read-only
        </label>
      ) : (
        <>
          <table className="perm-grid">
            <thead><tr><th />{WHAT.map(([l]) => <th key={l}>{l}{isDir && l === 'Execute' ? ' (open)' : ''}</th>)}</tr></thead>
            <tbody>
              {WHO.map(([who, shift]) => (
                <tr key={who}>
                  <th scope="row">{who}</th>
                  {WHAT.map(([what, bit]) => {
                    const b = bit << shift;
                    return <td key={what}><input type="checkbox" aria-label={`${who} ${what}`} checked={(mode & b) !== 0} onChange={(e) => setMode(e.target.checked ? mode | b : mode & ~b)} /></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mono small">{permissionString(mode, entry.kind)} · {mode.toString(8).padStart(3, '0')}</p>
          <p className="muted small">Applies to this {isDir ? 'folder only, not the items inside it' : 'file'}. Links are never changed.</p>
        </>
      )}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- open with */

interface OpenWithInfo { mime?: string; apps: Array<{ id: string; name: string; isDefault: boolean; note?: string }>; note?: string }

export function OpenWithDialog({ path }: { path: string }) {
  const [info, setInfo] = useState<OpenWithInfo | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [choice, setChoice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void call<OpenWithInfo>('fs:openWithApps', { path }).then((r) => {
      setInfo(r);
      setChoice(r.apps[0]?.id);
    }, (e: Error) => setError(e.message));
  }, [path]);
  const launch = async () => {
    if (!choice) return;
    setBusy(true);
    await call<{ app: string }>('fs:openWith', { path, appId: choice }).then((r) => {
      toast({ level: 'success', title: `Started ${r.app}`, detail: 'The application received the file; what it does next is up to that application.' });
      closeDialog();
    }, toastError);
    setBusy(false);
  };
  const name = path.split(/[\\/]/).pop();
  return (
    <Dialog title={`Open “${name}” with`} onClose={closeDialog} width={480} footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!choice || busy} onClick={() => void launch()}>Open</Button>
      </>
    }>
      {error ? <p className="error-text">{error}</p> : !info ? <p className="muted">Looking for installed applications…</p> : (
        <>
          {info.mime && <p className="muted small">File type: <span className="mono">{info.mime}</span></p>}
          {info.apps.length ? (
            <div className="choice-list" role="radiogroup" aria-label="Applications">
              {info.apps.map((a) => (
                <label key={a.id} className={`choice ${choice === a.id ? 'on' : ''}`}>
                  <input type="radio" name="app" checked={choice === a.id} onChange={() => setChoice(a.id)} onDoubleClick={() => void launch()} />
                  <span>{a.name}</span>
                  {a.isDefault && <span className="pill pill-accent">Default</span>}
                  {a.note && <span className="muted small">{a.note}</span>}
                </label>
              ))}
            </div>
          ) : null}
          {info.note && <p className="muted small">{info.note}</p>}
        </>
      )}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- compress */

type CompressFormat = 'zip' | 'tar' | 'tar.gz' | '7z';
const FORMAT_EXT: Record<CompressFormat, string> = { zip: '.zip', tar: '.tar', 'tar.gz': '.tar.gz', '7z': '.7z' };

export function CompressDialog({ paths, dir }: { paths: string[]; dir: string }) {
  const first = paths[0]!.split(/[\\/]/).pop()!;
  const stem = paths.length === 1 ? first : 'Archive';
  const [format, setFormat] = useState<CompressFormat>('zip');
  const [name, setName] = useState(stem);
  const [level, setLevel] = useState<'fast' | 'normal' | 'max' | 'store'>('normal');
  const [error, setError] = useState<string | undefined>();
  // Password protection (ZIP and 7Z, AES-256 through 7-Zip). Kept in this dialog's state only.
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [encryptNames, setEncryptNames] = useState(true);
  const canProtect = format === 'zip' || format === '7z';
  const usePassword = protect && canProtect;
  const pwError = !usePassword ? undefined
    : format === 'zip' && password && !/^[\x20-\x7e]+$/.test(password) ? 'ZIP passwords can only use unaccented letters, digits, spaces and common symbols. Choose 7Z for other characters.'
    : undefined;
  // Reported once the confirmation is as long as the password, not on every keystroke.
  const confirmError = usePassword && confirmPw && confirmPw.length >= password.length && confirmPw !== password ? 'The passwords do not match.' : undefined;
  const passwordReady = !usePassword || (!!password && password === confirmPw && !pwError);
  const full = name.toLowerCase().endsWith(FORMAT_EXT[format]) ? name : `${name}${FORMAT_EXT[format]}`;
  useEffect(() => {
    let live = true;
    void call<{ valid: boolean; reason?: string; exists?: boolean }>('fs:validateName', { parent: dir, name: full }).then((r) => live && setError(r.valid ? undefined : r.exists ? 'An item with this name exists — you will be asked what to do.' : r.reason));
    return () => {
      live = false;
    };
  }, [full, dir]);
  const levelValue = format === 'zip' ? (level === 'store' ? 0 : 6) : format === '7z' ? { store: 0, fast: 1, normal: 5, max: 9 }[level] : format === 'tar.gz' ? { store: 1, fast: 1, normal: 6, max: 9 }[level] : undefined;
  const blocking = !!error && !error.startsWith('An item with this name exists');
  const go = async () => {
    if (!passwordReady) return;
    const params: Record<string, unknown> = { name: full, format, level: levelValue };
    if (usePassword) {
      params.password = password;
      if (format === '7z') params.encryptNames = encryptNames;
    }
    const rec = await startOperation({ type: 'compress', sources: paths, destination: dir, params, conflictPolicy: 'ask', origin: 'ui' });
    if (rec) closeDialog();
  };
  return (
    <Dialog title={`Compress ${paths.length === 1 ? `“${first}”` : `${paths.length} items`}`} onClose={closeDialog} width={500} footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!name.trim() || blocking || !passwordReady} onClick={() => void go()}>Compress</Button>
      </>
    }>
      <div className="form-grid">
        <TextField id="arc-name" label="Archive name" value={name} error={error} onChange={(e) => setName(e.target.value)} />
        <label className="field" htmlFor="arc-format">
          <span className="field-label">Format</span>
          <select id="arc-format" className="input" value={format} onChange={(e) => setFormat(e.target.value as CompressFormat)}>
            <option value="zip">ZIP — opens everywhere</option>
            <option value="7z">7Z — smaller, needs 7-Zip-compatible tools</option>
            <option value="tar.gz">TAR.GZ — common on Linux and macOS</option>
            <option value="tar">TAR — no compression</option>
          </select>
        </label>
        {format !== 'tar' && (
          <label className="field" htmlFor="arc-level">
            <span className="field-label">Compression</span>
            <select id="arc-level" className="input" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
              {format !== 'tar.gz' && <option value="store">None (store only)</option>}
              {format !== 'zip' && <option value="fast">Fast</option>}
              <option value="normal">Normal</option>
              {format !== 'zip' && <option value="max">Maximum (slower)</option>}
            </select>
          </label>
        )}
      </div>
      {canProtect ? (
        <Toggle id="arc-protect" checked={protect} onChange={setProtect} label="Protect with a password" description={format === 'zip' ? 'AES-256 encryption. Opens in 7-Zip, WinRAR, WinZip and Orbis Files; the built-in Windows and macOS ZIP tools cannot open AES-encrypted ZIPs. File names stay visible.' : 'AES-256 encryption with the 7-Zip engine.'} />
      ) : (
        <p className="muted small">TAR archives cannot be password-protected; choose ZIP or 7Z for that.</p>
      )}
      {usePassword && (
        <div className="form-grid">
          <PasswordField id="arc-password" label="Password" value={password} onChange={setPassword} error={pwError} maxLength={ARCHIVE_PASSWORD_MAX} />
          <PasswordField id="arc-password-confirm" label="Confirm password" value={confirmPw} onChange={setConfirmPw} error={confirmError} maxLength={ARCHIVE_PASSWORD_MAX} />
        </div>
      )}
      {usePassword && format === '7z' && <Toggle id="arc-encrypt-names" checked={encryptNames} onChange={setEncryptNames} label="Encrypt file names" description="The list of files can only be seen with the password." />}
      {usePassword && <p className="muted small">Orbis Files does not keep this password. If it is lost, the archive cannot be opened.</p>}
      <p className="muted small">Saved as <span className="mono">{full}</span> in this folder. Links are not added to archives; they are listed as skipped.</p>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- archive integrity */

type IntegrityReport = { ok: boolean; checked: number; failed: Array<{ name: string; message: string }>; method: string };

/** Test an archive; encrypted archives ask for their password (or use `password` from an open archive view). */
export async function testArchiveIntegrity(path: string, password?: string): Promise<void> {
  const { runJob } = await import('../api');
  const name = path.split(/[\\/]/).pop() ?? path;
  toast({ level: 'info', title: `Checking ${name}…` });
  const run = async (pw: string | undefined): Promise<IntegrityReport | undefined> => (await runJob<IntegrityReport>((jobId) => call('tool:archiveTest', { path, jobId, password: pw }), undefined, `Testing ${name}`).promise).value;
  let v: IntegrityReport | undefined;
  try {
    v = await run(password);
  } catch (err) {
    if (!isPasswordError(err)) return toastError(err);
    const r = await askArchivePassword(name, run, { wrong: !!errorShape(err).wrongPassword });
    if (!r) return;
    v = r.value;
  }
  if (!v) return;
  if (v.ok) toast({ level: 'success', title: 'The archive is intact', detail: `${v.method}${v.checked > 1 ? ` · ${v.checked.toLocaleString()} entries checked` : ''}` });
  else toast({ level: 'error', title: 'The archive is damaged', detail: v.failed.slice(0, 3).map((f) => `${f.name}: ${f.message}`).join(' · '), sticky: true });
}

/* ---------------------------------------------------------------- add to project */

export function AddToProjectDialog({ paths }: { paths: string[] }) {
  const projects = useStore(app, (s) => s.projects);
  const [choice, setChoice] = useState(projects[0]?.id ?? '');
  const go = async () => {
    const r = await call<{ added: number; failed: string[] }>('proj:associate', { id: choice, paths }).catch((e) => {
      toastError(e);
      return null;
    });
    if (!r) return;
    toast({ level: r.failed.length ? 'warning' : 'success', title: `Associated ${r.added} item${r.added === 1 ? '' : 's'} with the project`, detail: r.failed.length ? `${r.failed.length} could not be added.` : 'Files were not moved.' });
    closeDialog();
  };
  return (
    <Dialog title="Add to project" onClose={closeDialog} width={460} footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!choice} onClick={() => void go()}>Add</Button>
      </>
    }>
      {!projects.length ? <p className="muted">There are no projects yet. Right-click a project folder → Add as project, or use Library → Projects.</p> : (
        <div className="choice-list" role="radiogroup" aria-label="Projects">
          {projects.map((p) => (
            <label key={p.id} className={`choice ${choice === p.id ? 'on' : ''}`}>
              <input type="radio" name="project" checked={choice === p.id} onChange={() => setChoice(p.id)} />
              <span>{p.name}</span>
              <span className="muted small">{p.kind}</span>
            </label>
          ))}
        </div>
      )}
      <p className="muted small">Associating records a reference only. The {paths.length === 1 ? 'item stays' : `${paths.length} items stay`} where {paths.length === 1 ? 'it is' : 'they are'}.</p>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- archive password */

/**
 * Asks for an archive's password and tries it straight away; a wrong password
 * keeps the dialog open with an honest message. Opened by askArchivePassword().
 */
export function ArchivePasswordDialog({ name, attempt, resolve, wrong }: { name: string; attempt: (password: string) => Promise<unknown>; resolve: (r: { password: string; value: unknown } | null) => void; wrong?: boolean }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>(wrong ? 'Wrong password. Check it and try again.' : undefined);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (r: { password: string; value: unknown } | null) => {
    if (done.current) return;
    done.current = true;
    closeDialog();
    resolve(r);
  };
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await attempt(value);
      finish({ password: value, value: result });
    } catch (err) {
      if (done.current) return;
      const shape = errorShape(err);
      setError(shape.wrongPassword ? 'Wrong password. Check it and try again.' : shape.message);
      setBusy(false);
      requestAnimationFrame(() => input.current?.select());
    }
  };
  return (
    <Dialog title="Password required" onClose={() => finish(null)} width={440} footer={
      <>
        <Button onClick={() => finish(null)}>Cancel</Button>
        <Button variant="primary" disabled={!value || busy} onClick={() => void submit()}>{busy ? 'Checking…' : 'Open'}</Button>
      </>
    }>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <p>“{name}” is password-protected. Enter its password to continue.</p>
        <PasswordField ref={input} id="archive-password" label="Password" value={value} onChange={setValue} error={error} autoFocus disabled={busy} maxLength={ARCHIVE_PASSWORD_MAX} />
        <p className="muted small">The password is kept in memory only while this archive is open. It is not saved or logged.</p>
      </form>
    </Dialog>
  );
}
