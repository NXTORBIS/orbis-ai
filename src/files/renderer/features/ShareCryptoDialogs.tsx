import React, { useEffect, useRef, useState } from 'react';
import { call, errorShape } from '../api';
import { app, closeDialog } from '../state/app';
import { useStore } from '../state/store';
import { parentPath } from '../state/workspace';
import { showSharesPanel } from '../state/shares';
import { Button, Dialog, PasswordField, Pill, ProgressBar, Segmented, Select, Toggle } from '../ui/components';
import { Icon } from '../ui/Icon';
import { startOperation } from '../actions';
import { FolderPicker } from './views/common';
import { ENCRYPT_PASSWORD_MIN, ORBISENC_EXT, passwordStrength } from '../../shared/crypto';
import { ARCHIVE_PASSWORD_MAX } from '../../shared/ipc';
import type { ShareExpiry, ShareInterface, ShareInterfaces, ShareSnapshot } from '../../shared/share';

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** "report.pdf", "report.pdf and notes.txt", "report.pdf and 4 more". */
function namesSummary(paths: string[]): string {
  if (paths.length === 1) return `“${baseName(paths[0]!)}”`;
  if (paths.length === 2) return `“${baseName(paths[0]!)}” and “${baseName(paths[1]!)}”`;
  return `“${baseName(paths[0]!)}” and ${paths.length - 1} more`;
}

/** The folder all paths are in, when they share one (outputs go next to each item). */
function commonParent(paths: string[]): string | undefined {
  const parents = new Set(paths.map((p) => parentPath(p)));
  return parents.size === 1 ? [...parents][0] : undefined;
}

/* ---------------------------------------------------------------- share on local network */

const EXPIRY: Array<{ value: ShareExpiry; label: string }> = [
  { value: '10m', label: '10 minutes' },
  { value: '1h', label: '1 hour' },
  { value: 'never', label: 'Until stopped' },
];
const UPLOAD_LIMITS = [
  { value: '100', label: '100 MB' },
  { value: '1024', label: '1 GB' },
  { value: '4096', label: '4 GB' },
  { value: '10240', label: '10 GB' },
];

function interfaceLabel(i: ShareInterface): React.ReactNode {
  return <><span>{i.internal ? 'This computer only' : i.name}</span> <span className="mono">{i.address}</span></>;
}

/**
 * "Share on local network…": choose the network(s), how long, hidden items and
 * (off by default) uploads into one folder, then start a temporary server.
 */
export function ShareStartDialog({ paths, dir, folders }: { paths: string[]; dir?: string; folders: number }) {
  const [ifaces, setIfaces] = useState<ShareInterfaces | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [expiry, setExpiry] = useState<ShareExpiry>('1h');
  const [hidden, setHidden] = useState(false);
  const [uploads, setUploads] = useState(false);
  const [uploadDir, setUploadDir] = useState(dir ?? commonParent(paths) ?? '');
  const [limit, setLimit] = useState('1024');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    void call<ShareInterfaces>('share:interfaces').then((r) => {
      setIfaces(r);
      setChosen(r.defaultAddress ? [r.defaultAddress] : []);
    }, (e) => setError(errorShape(e).message));
  }, []);
  const external = ifaces?.interfaces.filter((i) => !i.internal) ?? [];
  const ready = (all || chosen.length > 0) && (!uploads || !!uploadDir) && !busy;
  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await call<ShareSnapshot>('share:start', {
        paths,
        addresses: all ? [] : chosen,
        allInterfaces: all,
        expiry,
        includeHidden: hidden,
        upload: uploads ? { folder: uploadDir, maxMB: Number(limit) } : undefined,
      });
      closeDialog();
      showSharesPanel();
    } catch (err) {
      setError(errorShape(err).message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Share ${namesSummary(paths)} on the local network`} className="share-dialog" width={560} onClose={closeDialog} footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="share" disabled={!ready} onClick={() => void start()}>{busy ? 'Starting…' : 'Start sharing'}</Button>
      </>
    }>
      <div className="callout warning" role="note">
        <Icon name="warning" size={16} />
        <span>Other devices on the network open a link (or scan a QR code) to download {paths.length === 1 ? 'this item' : 'these items'}. The connection uses plain HTTP: it is <strong>not encrypted</strong>, so use it only on a network you trust. Anyone who has the link can use it until the share stops.</span>
      </div>
      <fieldset className="share-networks">
        <legend className="field-label">Share on</legend>
        {!ifaces ? <p className="muted small">Reading this computer’s networks…</p> : (
          <>
            {!external.length && <p className="muted small">No network connection was found. You can still share on this computer only (to try it out).</p>}
            {ifaces.interfaces.map((i) => (
              <label key={`${i.name}-${i.address}`} className={`check share-net ${all ? 'is-disabled' : ''}`}>
                <input type="checkbox" disabled={all} checked={!all && chosen.includes(i.address)} onChange={(e) => setChosen(e.target.checked ? [...chosen, i.address] : chosen.filter((a) => a !== i.address))} />
                {interfaceLabel(i)}
                {i.private && !i.internal && <Pill tone="success">Local network</Pill>}
                {!i.private && !i.internal && <Pill tone="warning">Public address</Pill>}
              </label>
            ))}
            <label className="check share-net">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
              <span>All networks (0.0.0.0)</span>
            </label>
            {!all && !chosen.length && <p className="field-hint">Choose at least one network to share on.</p>}
            {all && <p className="warning-text small">Every network this computer is connected to can reach the share, including ones you join later while it runs. Prefer choosing one network.</p>}
            {chosen.some((a) => ifaces.interfaces.find((i) => i.address === a && !i.private && !i.internal)) && !all && <p className="warning-text small">A public address can be reachable from outside your local network.</p>}
          </>
        )}
      </fieldset>
      <div className="field">
        <span className="field-label" aria-hidden="true">Stop sharing after</span>
        <Segmented<ShareExpiry> label="Stop sharing after" value={expiry} onChange={setExpiry} options={EXPIRY} />
        <span className="field-hint">Sharing also stops when you press Stop or quit Orbis Files.</span>
      </div>
      {folders > 0 && <Toggle id="share-hidden" checked={hidden} onChange={setHidden} label="Include hidden items" description="Items whose names start with a dot inside shared folders. Off: they are neither listed nor downloadable." />}
      <Toggle id="share-uploads" checked={uploads} onChange={setUploads} label="Allow uploads" description="Other devices can send files into one folder you choose. Nothing is ever replaced: a number is added when a name exists." />
      {uploads && (
        <div className="share-upload-options">
          <FolderPicker id="share-upload-folder" label="Save received files in" value={uploadDir} onChange={setUploadDir} />
          <Select<string> id="share-upload-limit" label="Largest upload at a time" value={limit} options={UPLOAD_LIMITS} onChange={setLimit} />
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- encrypt */

const STRENGTH_TONE: Record<string, 'error' | 'warning' | 'accent' | 'success'> = { 'too-short': 'error', weak: 'error', fair: 'warning', good: 'accent', strong: 'success' };
const STRENGTH_VALUE: Record<string, number> = { 'too-short': 0.08, weak: 0.25, fair: 0.5, good: 0.75, strong: 1 };

/** "Encrypt…": password with confirmation and an honest strength hint; optional move of the originals to the Trash. */
export function EncryptDialog({ paths, folders }: { paths: string[]; folders: number }) {
  const trash = useStore(app, (s) => !!s.capabilities?.trash);
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(password);
  const confirmError = confirmPw && confirmPw.length >= password.length && confirmPw !== password ? 'The passwords do not match.' : undefined;
  const ready = [...password].length >= ENCRYPT_PASSWORD_MIN && password === confirmPw && !busy;
  const go = async () => {
    if (!ready) return;
    setBusy(true);
    const rec = await startOperation({ type: 'encrypt', sources: paths, destination: commonParent(paths), params: { password, deleteOriginals: remove }, origin: 'encrypt' });
    setBusy(false);
    if (rec) closeDialog();
  };
  return (
    <Dialog title={`Encrypt ${namesSummary(paths)}`} className="crypto-dialog" width={500} onClose={closeDialog} footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="lock" disabled={!ready} onClick={() => void go()}>Encrypt</Button>
      </>
    }>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <p className="small">Each file is saved as an encrypted copy, <span className="mono">name{ORBISENC_EXT}</span>, next to it (AES-256-GCM, key from your password with scrypt). The name and dates are stored inside, encrypted.</p>
        {folders > 0 && <p className="muted small">{folders === 1 ? 'For the folder' : `For the ${folders} folders`}, every file inside is encrypted separately. Folder and file names inside stay visible on disk; to hide names as well, use Compress… with 7Z and “Encrypt file names”.</p>}
        <PasswordField id="enc-password" label="Password" value={password} onChange={setPassword} autoFocus maxLength={ARCHIVE_PASSWORD_MAX} />
        <div className="strength" aria-live="polite">
          <ProgressBar label="Password strength" value={password ? STRENGTH_VALUE[strength.level] : 0} tone={STRENGTH_TONE[strength.level]} />
          <span className={`small ${strength.level === 'weak' || strength.level === 'too-short' ? 'error-text' : 'muted'}`}>{password ? strength.label : `At least ${ENCRYPT_PASSWORD_MIN} characters`}</span>
        </div>
        <p className="muted small">A rough estimate from length and character types only: it cannot tell whether a password is a common word or used elsewhere. A long phrase of unrelated words is a good choice.</p>
        <PasswordField id="enc-password-confirm" label="Confirm password" value={confirmPw} onChange={setConfirmPw} error={confirmError} maxLength={ARCHIVE_PASSWORD_MAX} />
        <Toggle id="enc-remove" checked={remove && trash} disabled={!trash} onChange={setRemove} label="Move the originals to the Trash afterwards" description={trash ? 'Only after each encrypted copy has been read back and checked. Off: the originals stay where they are.' : 'The Trash is not available on this system.'} />
        <p className="warning-text small">Orbis Files does not keep this password. If it is lost, the encrypted files cannot be opened by anyone.</p>
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- decrypt */

/** "Decrypt…": the password is checked against the first file before the operation starts. */
export function DecryptDialog({ paths, wrong }: { paths: string[]; wrong?: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(wrong ? 'Wrong password. Check it and try again.' : undefined);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const firstFile = paths.find((p) => p.toLowerCase().endsWith(ORBISENC_EXT));
  const go = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (firstFile) await call('crypto:checkPassword', { path: firstFile, password });
    } catch (err) {
      const shape = errorShape(err);
      setError(shape.wrongPassword ? 'Wrong password. Check it and try again.' : shape.message);
      setBusy(false);
      requestAnimationFrame(() => input.current?.select());
      return;
    }
    const rec = await startOperation({ type: 'decrypt', sources: paths, destination: commonParent(paths), params: { password }, origin: 'decrypt' });
    setBusy(false);
    if (rec) closeDialog();
  };
  return (
    <Dialog title={`Decrypt ${namesSummary(paths)}`} className="crypto-dialog" width={460} onClose={closeDialog} footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="unlock" disabled={!password || busy} onClick={() => void go()}>{busy ? 'Checking…' : 'Decrypt'}</Button>
      </>
    }>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <p className="small">Decrypted files are saved next to the encrypted ones with their original names and dates. Nothing is replaced: a number is added when a name exists.{paths.length > 1 || !firstFile ? ` Folders: every ${ORBISENC_EXT} file inside is decrypted.` : ''}</p>
        <PasswordField ref={input} id="dec-password" label="Password" value={password} onChange={setPassword} error={error} autoFocus disabled={busy} maxLength={ARCHIVE_PASSWORD_MAX} />
        <p className="muted small">The password is used for this operation only; it is not saved or logged. A file that was damaged or changed after encryption is refused, and nothing is written from it.</p>
      </form>
    </Dialog>
  );
}
