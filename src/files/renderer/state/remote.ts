import { createStore } from './store';
import { call, on, runJob, UiError } from '../api';
import { confirm, openDialog, toast, toastError } from './app';
import { isRemoteRef, parseRemoteRef, remoteDisplayUrl, type RemoteConnectionInfo, type RemoteConnectResult, type RemoteOpenedCopy, type SecureStorageState } from '../../shared/remote';
import type { FileEntry } from '../../shared/model';

/**
 * Remote connections as the window sees them (never with secrets), the
 * local copies of opened remote files, and the interactive connect flow:
 * password or passphrase prompts and host-key decisions are answered here,
 * one dialog at a time, and the main process re-checks every answer.
 */

export interface RemoteState {
  loaded: boolean;
  connections: RemoteConnectionInfo[];
  storage: SecureStorageState;
  opened: RemoteOpenedCopy[];
  /** The remote file the details panel previews (set by "Preview remote file"). */
  previewRef?: string;
}

export const remote = createStore<RemoteState>({ loaded: false, connections: [], storage: { available: false }, opened: [] });

let started = false;
export function startRemote(): void {
  if (started) return;
  started = true;
  void call<{ connections: RemoteConnectionInfo[]; storage: SecureStorageState; opened: RemoteOpenedCopy[] }>('remote:list').then(
    (r) => remote.set({ loaded: true, connections: r.connections, storage: r.storage, opened: r.opened }),
    () => remote.set({ loaded: true }),
  );
  on<{ connections: RemoteConnectionInfo[]; storage: SecureStorageState }>('remote:changed', (r) => remote.set({ connections: r.connections, storage: r.storage }));
  let announced = new Set<string>();
  on<RemoteOpenedCopy[]>('remote:opened', (list) => {
    remote.set({ opened: list });
    // A copy that was just edited: offer to upload it (once per change).
    for (const c of list) {
      if (c.changed && !announced.has(c.localPath)) {
        announced.add(c.localPath);
        toast({
          level: 'info',
          sticky: true,
          title: `“${c.name}” was changed`,
          detail: `This is a copy of a file on ${c.connectionName}. Upload it to replace the version on the server (only if nobody changed that version meanwhile).`,
          actions: [{ label: 'Upload changes', run: () => void uploadChanges(c) }, { label: 'Remote files…', run: () => openDialog('remoteConnections') }],
        });
      }
    }
    announced = new Set([...announced].filter((p) => list.some((c) => c.localPath === p && c.changed)));
  });
}

export function connectionOf(id: string): RemoteConnectionInfo | undefined {
  return remote.get().connections.find((c) => c.id === id);
}

/** "Server name:/path" for a remote reference; local paths unchanged. */
export function displayPath(p: string): string {
  if (!isRemoteRef(p)) return p;
  const r = parseRemoteRef(p);
  if (!r) return p;
  return `${connectionOf(r.connectionId)?.name ?? 'Remote'}:${r.path}`;
}

/** The address of a remote item for other programs (sftp://user@host/path), never with a password. */
export function remoteAddress(ref: string): string | undefined {
  const r = parseRemoteRef(ref);
  const c = r ? connectionOf(r.connectionId) : undefined;
  return r && c ? remoteDisplayUrl(c, r.path) : undefined;
}

/**
 * Connect, asking for what the server needs. Resolves true once connected,
 * false when the user cancelled or the host key was refused.
 */
export async function ensureConnected(id: string): Promise<boolean> {
  const conn = connectionOf(id);
  let secret: string | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    let r: RemoteConnectResult;
    try {
      r = await call<RemoteConnectResult>('remote:connect', { id, secret });
    } catch (err) {
      toastError(err, `Could not connect to ${conn?.name ?? 'the server'}`);
      return false;
    }
    if (r.status === 'connected') return true;
    if (r.status === 'needsSecret') {
      const typed = await askSecret(conn, r.kind, !!r.wrong);
      if (typed === null) return false;
      secret = typed;
      continue;
    }
    if (r.status === 'hostKeyUnknown') {
      const ok = await new Promise<boolean>((resolve) => openDialog('remoteHostKey', { connection: conn, info: r, resolve }));
      if (!ok) return false;
      try {
        await call('remote:trustHostKey', { id, fingerprint: r.fingerprint });
      } catch (err) {
        toastError(err, 'The host key was not trusted');
        return false;
      }
      continue;
    }
    // The host key changed: refused. The dialog explains; nothing is connected.
    await new Promise<boolean>((resolve) => openDialog('remoteHostKey', { connection: conn, info: r, resolve }));
    return false;
  }
  return false;
}

function askSecret(conn: RemoteConnectionInfo | undefined, kind: 'password' | 'passphrase', wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => openDialog('remoteSecret', { connection: conn, kind, wrong, resolve }));
}

/** Download a remote file to a private copy and open it with its default app. */
export async function openRemoteFile(entry: FileEntry): Promise<void> {
  const label = `Opening ${entry.name}`;
  try {
    const job = runJob<{ localPath: string; opened: boolean; needsConfirmation?: boolean; reason?: string }>((jobId) => call('remote:open', { ref: entry.path, jobId }), undefined, label);
    const r = await job.promise;
    if (r.cancelled || !r.value) return;
    const v = r.value;
    if (v.needsConfirmation) {
      const ok = await confirm({ title: 'Run this program?', body: `${v.reason} Opening it may run code on your computer. Only continue if you trust where it came from.`, confirmLabel: 'Open anyway', destructive: true, detail: [entry.name] });
      if (!ok) return;
      await call('fs:open', { path: v.localPath, allowExecutable: true });
    }
    toast({ level: 'info', title: `Opened a copy of “${entry.name}”`, detail: 'If you change and save it, Orbis Files offers to upload the changes to the server.' });
  } catch (err) {
    toastError(err, `Could not open “${entry.name}”`);
  }
}

/** A size-limited private copy of a remote file, for the preview. */
export async function previewRemoteFile(ref: string): Promise<FileEntry | undefined> {
  const job = runJob<FileEntry>((jobId) => call('remote:preview', { ref, jobId }));
  const r = await job.promise;
  return r.cancelled ? undefined : r.value;
}

export async function uploadChanges(c: RemoteOpenedCopy): Promise<void> {
  const { startOperation } = await import('../actions');
  await startOperation({ type: 'remote-save', sources: [c.localPath], destination: c.ref, origin: 'remote-open' });
}

export async function discardCopy(c: RemoteOpenedCopy): Promise<void> {
  const ok = !c.changed || (await confirm({ title: `Delete the edited copy of “${c.name}”?`, body: 'Your changes in this copy have not been uploaded. Deleting it loses them.', confirmLabel: 'Delete copy', destructive: true }));
  if (!ok) return;
  await call('remote:discardCopy', { localPath: c.localPath }).catch(toastError);
}

/** Whether an error means "connect first" (a password or host key decision is needed). */
export function needsConnect(err: unknown): boolean {
  return err instanceof UiError && /^(needs_secret|host_key_unknown)/.test(err.shape.cause ?? '');
}

/** Whether an error looks like a dropped or lost connection that a reconnect might fix. */
export function isConnectionError(err: unknown): boolean {
  if (needsConnect(err)) return true;
  if (!(err instanceof UiError)) return false;
  const cause = err.shape.cause ?? '';
  const msg = err.shape.message ?? '';
  return /disconnect|ECONNR|ETIMEDOUT|socket.+closed|connection.+lost|not.connected/i.test(cause + ' ' + msg);
}

export function isRemoteEntry(e: Pick<FileEntry, 'path'>): boolean {
  return isRemoteRef(e.path);
}

export function remoteSelectionOf(entries: FileEntry[]): { connectionId: string; paths: string[] } | undefined {
  const refs = entries.map((e) => parseRemoteRef(e.path));
  if (!refs.length || refs.some((r) => !r)) return undefined;
  return { connectionId: refs[0]!.connectionId, paths: refs.map((r) => r!.path) };
}

