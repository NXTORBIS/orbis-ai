import React, { useMemo, useState } from 'react';
import { call, errorShape } from '../api';
import { closeDialog, confirm, openDialog, toast, toastError } from '../state/app';
import { useStore } from '../state/store';
import { discardCopy, remote, uploadChanges } from '../state/remote';
import { openRemote } from '../actions';
import { Button, Dialog, EmptyState, IconButton, PasswordField, Pill, Segmented, Select, TextField } from '../ui/components';
import { Icon } from '../ui/Icon';
import { formatDate } from '../ui/format';
import { transportLabel } from './views/RemoteView';
import { defaultPort, isLoopbackHost, RemoteConnectionInputSchema, remoteScheme, type FtpEncoding, type FtpTlsMode, type RemoteCertificateInfo, type RemoteConnectionInfo, type RemoteConnectResult, type RemoteConnectionInput, type RemoteProtocol } from '../../shared/remote';

/* ---------------------------------------------------------------- add / edit a connection */

type Protocol = RemoteProtocol;
type Auth = 'password' | 'key' | 'anonymous';
/** FTP transport as one choice: explicit FTPS, implicit FTPS or plain FTP. */
type FtpTransport = 'explicit' | 'implicit' | 'plain';

/**
 * Add or edit a remote connection. The password (or key passphrase) is
 * write-only: it is sent to be stored encrypted, or kept for this session
 * when "Ask every time" is chosen, and is never shown again.
 */
export function RemoteEditDialog({ id, returnTo }: { id?: string; returnTo?: string }) {
  const existing = useStore(remote, (s) => s.connections.find((c) => c.id === id));
  const storage = useStore(remote, (s) => s.storage);
  const [name, setName] = useState(existing?.name ?? '');
  const [protocol, setProtocol] = useState<Protocol>(existing?.protocol ?? 'sftp');
  const [host, setHost] = useState(existing?.host ?? '');
  const [secure, setSecure] = useState(existing?.secure ?? true);
  const [ftpTls, setFtpTls] = useState<FtpTlsMode>(existing?.ftpTls ?? 'explicit');
  const [encoding, setEncoding] = useState<FtpEncoding>(existing?.encoding ?? 'utf8');
  const [port, setPort] = useState(String(existing?.port ?? 22));
  const [portEdited, setPortEdited] = useState(!!existing);
  const [username, setUsername] = useState(existing?.auth === 'anonymous' ? '' : (existing?.username ?? ''));
  const [auth, setAuth] = useState<Auth>(existing?.auth ?? 'password');
  const [keyPath, setKeyPath] = useState(existing?.keyPath ?? '');
  const [secretMode, setSecretMode] = useState<'stored' | 'ask'>(existing?.secretMode ?? (storage.available ? 'stored' : 'ask'));
  const [secret, setSecret] = useState('');
  const [allowUnencrypted, setAllowUnencrypted] = useState(existing?.allowUnencrypted ?? false);
  const [startPath, setStartPath] = useState(existing?.startPath ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [touched, setTouched] = useState(false);

  /** Plain HTTP (WebDAV) or plain FTP: nothing is encrypted. */
  const plainText = (protocol === 'webdav' || protocol === 'ftp') && !secure;
  const loopback = isLoopbackHost(host);
  const storedAllowed = storage.available;
  const mode = storedAllowed ? secretMode : 'ask';
  const effAuth: Auth = protocol === 'sftp' ? (auth === 'anonymous' ? 'password' : auth) : protocol === 'ftp' ? (auth === 'key' ? 'password' : auth) : 'password';
  const anonymous = effAuth === 'anonymous';
  const changeProtocol = (p: Protocol) => {
    setProtocol(p);
    if (!portEdited) setPort(String(defaultPort(p, p === 'sftp' ? true : secure, ftpTls)));
  };
  const changeSecure = (v: boolean) => {
    setSecure(v);
    if (!portEdited) setPort(String(defaultPort(protocol, v, ftpTls)));
  };
  const ftpTransport: FtpTransport = secure ? ftpTls : 'plain';
  const changeFtpTransport = (t: FtpTransport) => {
    const nextSecure = t !== 'plain';
    const nextTls: FtpTlsMode = t === 'implicit' ? 'implicit' : 'explicit';
    setSecure(nextSecure);
    setFtpTls(nextTls);
    // The usual ports follow the choice unless the user typed another one (21 ↔ 990).
    const cur = Number(port);
    if (!portEdited || cur === 21 || cur === 990) setPort(String(defaultPort('ftp', nextSecure, nextTls)));
  };

  const input = (): RemoteConnectionInput => ({
    ...(id ? { id } : {}),
    name: name.trim() || host.trim(),
    protocol,
    host: host.trim(),
    port: Number(port),
    username: anonymous ? 'anonymous' : username,
    auth: effAuth,
    keyPath: effAuth === 'key' ? keyPath.trim() : undefined,
    secure: protocol === 'sftp' ? true : secure,
    allowUnencrypted: plainText && !loopback ? allowUnencrypted : false,
    ...(protocol === 'ftp' ? { ftpTls, encoding } : {}),
    startPath: startPath.trim(),
    secretMode: mode,
    // Write-only: only sent when typed (empty keeps a stored secret).
    ...(secret && !anonymous ? (effAuth === 'key' ? { passphrase: secret } : { password: secret }) : {}),
  });
  const issues = useMemo(() => {
    const r = RemoteConnectionInputSchema.safeParse(input());
    const out: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) out[String(i.path[0] ?? 'form')] ??= i.message;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, protocol, host, port, username, auth, keyPath, secure, allowUnencrypted, startPath, mode, secret, ftpTls, encoding]);
  const fieldError = (k: string) => (touched ? issues[k] : undefined);

  const save = async (connect: boolean) => {
    setTouched(true);
    if (Object.keys(issues).length) {
      setError('Check the highlighted fields.');
      // The first field to fix may be scrolled out of view in a long form: bring it there and focus it.
      requestAnimationFrame(() => {
        const bad = document.querySelector<HTMLElement>('.remote-dialog [aria-invalid="true"]');
        bad?.scrollIntoView({ block: 'center' });
        bad?.focus();
      });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      // With "Ask every time", a password typed here is kept in memory for this session only.
      const saved = await call<RemoteConnectionInfo>('remote:save', input());
      setSecret('');
      closeDialog();
      toast({ level: 'success', title: id ? `Saved “${saved.name}”` : `Added “${saved.name}”`, detail: anonymous ? 'Signs in anonymously: no password is used.' : mode === 'stored' && saved.hasSecret ? 'The password is stored encrypted in the system keychain.' : mode === 'ask' ? 'The password is asked when you connect and kept only until you disconnect or quit.' : undefined });
      if (connect) await openRemote(saved.id);
      else if (returnTo) openDialog(returnTo);
    } catch (err) {
      setError(errorShape(err).message);
      setBusy(false);
    }
  };

  const isCert = existing?.protocol === 'ftp';
  const forgetKey = async () => {
    if (!existing) return;
    const ok = await confirm(isCert
      ? { title: 'Forget the pinned certificate?', body: 'Only do this if you know the server’s certificate changed (for example, it was renewed). The next connection shows the new certificate for you to check again.', confirmLabel: 'Forget certificate', destructive: true, detail: existing.hostKey ? [existing.hostKey.fingerprint] : undefined }
      : { title: 'Forget the trusted host key?', body: 'Only do this if you know the server’s key changed (for example, it was reinstalled). The next connection shows the new fingerprint for you to check again.', confirmLabel: 'Forget host key', destructive: true, detail: existing.hostKey ? [existing.hostKey.fingerprint] : undefined });
    if (ok) await call('remote:forgetHostKey', { id: existing.id }).catch(toastError);
    openDialog('remoteEdit', { id: existing.id, returnTo });
  };

  const secretLabel = effAuth === 'key' ? 'Key passphrase' : 'Password';
  const plainWhat = protocol === 'ftp' ? 'plain FTP' : 'plain HTTP';
  return (
    <Dialog title={id ? `Edit “${existing?.name ?? 'connection'}”` : 'Add remote connection'} className="remote-dialog" width={580} onClose={() => (returnTo ? openDialog(returnTo) : closeDialog())} footer={
      <>
        <Button onClick={() => (returnTo ? openDialog(returnTo) : closeDialog())}>Cancel</Button>
        <Button disabled={busy} onClick={() => void save(false)}>Save</Button>
        <Button variant="primary" icon="server" disabled={busy} onClick={() => void save(true)}>{busy ? 'Saving…' : 'Save and connect'}</Button>
      </>
    }>
      <div className="field">
        <span className="field-label" aria-hidden="true">Protocol</span>
        <Segmented<Protocol> label="Protocol" value={protocol} onChange={changeProtocol} options={[{ value: 'sftp', label: 'SFTP (SSH)' }, { value: 'webdav', label: 'WebDAV' }, { value: 'ftp', label: 'FTP / FTPS' }]} />
      </div>
      <div className="remote-grid">
        <TextField id="remote-host" label="Server" value={host} placeholder={protocol === 'sftp' ? 'example.org' : protocol === 'ftp' ? 'ftp.example.org' : 'dav.example.org'} spellCheck={false} autoComplete="off" onChange={(e) => setHost(e.target.value)} error={fieldError('host')} mono />
        <TextField id="remote-port" label="Port" value={port} inputMode="numeric" onChange={(e) => { setPort(e.target.value.replace(/\D/g, '').slice(0, 5)); setPortEdited(true); }} error={fieldError('port')} className="remote-port" />
      </div>
      {protocol !== 'sftp' && (
        <div className="field">
          <span className="field-label" aria-hidden="true">Connection</span>
          {protocol === 'webdav' ? (
            <Segmented<'https' | 'http'> label="Connection" value={secure ? 'https' : 'http'} onChange={(v) => changeSecure(v === 'https')} options={[{ value: 'https', label: 'HTTPS (encrypted)' }, { value: 'http', label: 'HTTP (not encrypted)' }]} />
          ) : (
            <>
              <Segmented<FtpTransport> label="Connection" value={ftpTransport} onChange={changeFtpTransport} options={[{ value: 'explicit', label: 'FTPS (explicit TLS)' }, { value: 'implicit', label: 'FTPS (implicit TLS)' }, { value: 'plain', label: 'FTP (not encrypted)' }]} />
              {secure && <span className="field-hint">{ftpTls === 'explicit' ? 'Switches to TLS right after connecting (AUTH TLS), usually on port 21. Most servers offer this.' : 'TLS from the first byte, usually on port 990 (older servers).'} File transfers are encrypted too; the certificate is checked before your password is sent.</span>}
            </>
          )}
          {plainText && (loopback ? (
            <span className="field-hint">{protocol === 'ftp' ? 'Plain FTP' : 'Plain HTTP'} is used only because the server is on this computer.</span>
          ) : (
            <div className={`callout warning remote-unencrypted ${fieldError('allowUnencrypted') ? 'has-error' : ''}`} role="note">
              <Icon name="warning" size={16} />
              <div>
                <p>With {plainWhat}, your password and every file travel <strong>unencrypted</strong>: anyone on the network path can read or change them. Use {protocol === 'ftp' ? 'FTPS' : 'HTTPS'} whenever the server offers it.</p>
                <label className="check"><input type="checkbox" checked={allowUnencrypted} onChange={(e) => setAllowUnencrypted(e.target.checked)} aria-invalid={!!fieldError('allowUnencrypted')} aria-describedby={fieldError('allowUnencrypted') ? 'remote-unencrypted-msg' : undefined} /> Allow unencrypted connection to {host || 'this server'}</label>
                {fieldError('allowUnencrypted') && <span id="remote-unencrypted-msg" className="field-error remote-unencrypted-msg">Tick this to save, or choose {protocol === 'ftp' ? 'FTPS' : 'HTTPS'}.</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {(protocol === 'sftp' || protocol === 'ftp') && (
        <div className="field">
          <span className="field-label" aria-hidden="true">Sign in with</span>
          {protocol === 'sftp'
            ? <Segmented<Auth> label="Sign in with" value={effAuth} onChange={setAuth} options={[{ value: 'password', label: 'Password' }, { value: 'key', label: 'Private key' }]} />
            : <Segmented<Auth> label="Sign in with" value={effAuth} onChange={setAuth} options={[{ value: 'password', label: 'User name and password' }, { value: 'anonymous', label: 'Anonymous' }]} />}
          {anonymous && <span className="field-hint">Signs in as “anonymous”, as public download servers expect. No password is sent or saved.</span>}
        </div>
      )}
      {!anonymous && <TextField id="remote-user" label="User name" value={username} spellCheck={false} autoComplete="off" onChange={(e) => setUsername(e.target.value)} error={fieldError('username')} />}
      {protocol === 'sftp' && effAuth === 'key' && (
        <div className={`field ${fieldError('keyPath') ? 'has-error' : ''}`}>
          <label className="field-label" htmlFor="remote-key">Private key file</label>
          <div className="input-row">
            <input id="remote-key" className="input mono" value={keyPath} placeholder="/home/me/.ssh/id_ed25519" spellCheck={false} onChange={(e) => setKeyPath(e.target.value)} aria-invalid={!!fieldError('keyPath')} />
            <button type="button" className="btn btn-default btn-md" onClick={async () => {
              const p = await call<string | null>('fs:pickFile', { title: 'Choose your private key (for example ~/.ssh/id_ed25519)' }).catch(() => null);
              if (p) setKeyPath(p);
            }}><Icon name="folderOpen" size={14} /> <span>Browse…</span></button>
          </div>
          <span className={fieldError('keyPath') ? 'field-error' : 'field-hint'}>{fieldError('keyPath') ?? 'The key is read from this file each time you connect; it is not copied.'}</span>
        </div>
      )}
      {!anonymous && (
        <>
          <div className="field">
            <span className="field-label" aria-hidden="true">{secretLabel}</span>
            <Segmented<'stored' | 'ask'> label={`${secretLabel}: save or ask`} value={mode} onChange={(v) => storedAllowed && setSecretMode(v)} options={[{ value: 'stored', label: 'Save securely', disabled: !storedAllowed, reason: storage.reason }, { value: 'ask', label: 'Ask every time' }]} />
            {!storedAllowed && <span className="field-hint remote-storage-note"><Icon name="lock" size={12} /> <span>{storage.reason ?? 'Secure credential storage is not available.'} It will be asked for when you connect.</span></span>}
          </div>
          <PasswordField
            id="remote-secret"
            label={mode === 'stored' ? `${secretLabel} (saved in the system keychain)` : `${secretLabel} (used for this session only)`}
            value={secret}
            onChange={setSecret}
            maxLength={4096}
            hint={existing?.hasSecret && mode === 'stored' ? 'A password is saved. Leave this empty to keep it.' : mode === 'ask' ? (effAuth === 'key' ? 'Leave empty if the key has no passphrase, or to be asked when connecting.' : 'Optional now: you are asked when you connect.') : undefined}
          />
        </>
      )}
      <TextField id="remote-start" label="Start folder (optional)" value={startPath} placeholder={protocol === 'webdav' ? '/' : 'The folder the server opens first'} spellCheck={false} onChange={(e) => setStartPath(e.target.value)} error={fieldError('startPath')} mono />
      {protocol === 'ftp' && (
        <Select<FtpEncoding> id="remote-encoding" label="File name encoding" value={encoding} onChange={setEncoding} options={[{ value: 'utf8', label: 'UTF-8 (recommended)' }, { value: 'latin1', label: 'Latin-1 (older servers with accented names shown wrongly)' }]} />
      )}
      <TextField id="remote-name" label="Name in the sidebar" value={name} placeholder={host || 'My server'} onChange={(e) => setName(e.target.value)} error={fieldError('name')} />
      {existing?.protocol === 'sftp' && protocol === 'sftp' && (
        <div className="remote-hostkey-row">
          <Icon name="fingerprint" size={14} />
          {existing.hostKey ? (
            <span className="grow small">Trusted host key <span className="mono">{existing.hostKey.fingerprint}</span> <span className="muted">({existing.hostKey.algorithm}, since {formatDate(existing.hostKey.addedMs)})</span></span>
          ) : <span className="grow small muted">No host key trusted yet: it is shown for you to check on the first connection.</span>}
          {existing.hostKey && <Button size="sm" variant="ghost" onClick={() => void forgetKey()}>Forget host key…</Button>}
        </div>
      )}
      {existing?.protocol === 'ftp' && protocol === 'ftp' && existing.secure && secure && (
        <div className="remote-hostkey-row">
          <Icon name="fingerprint" size={14} />
          {existing.hostKey ? (
            <span className="grow small">Pinned certificate <span className="mono remote-fp-hex"><HexFingerprint value={existing.hostKey.fingerprint} /></span> <span className="muted">(SHA-256, since {formatDate(existing.hostKey.addedMs)})</span></span>
          ) : <span className="grow small muted">No certificate pinned: one your system trusts is accepted; any other is shown for you to check on the first connection.</span>}
          {existing.hostKey && <Button size="sm" variant="ghost" onClick={() => void forgetKey()}>Forget certificate…</Button>}
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- password / passphrase when connecting */

export function RemoteSecretDialog({ connection, kind, wrong, resolve }: { connection?: RemoteConnectionInfo; kind: 'password' | 'passphrase'; wrong: boolean; resolve: (v: string | null) => void }) {
  const [value, setValue] = useState('');
  const done = (v: string | null) => {
    closeDialog();
    resolve(v);
  };
  const what = kind === 'passphrase' ? 'key passphrase' : 'password';
  return (
    <Dialog title={`Connect to ${connection?.name ?? 'the server'}`} width={440} onClose={() => done(null)} footer={
      <>
        <Button onClick={() => done(null)}>Cancel</Button>
        <Button variant="primary" disabled={!value} onClick={() => done(value)}>Connect</Button>
      </>
    }>
      <p className="muted small">{connection ? `${connection.username}@${connection.host}${connection.port !== defaultPort(connection.protocol, connection.secure, connection.ftpTls) ? `:${connection.port}` : ''}` : ''}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (value) done(value); }}>
        <PasswordField id="remote-connect-secret" label={kind === 'passphrase' ? 'Passphrase of your private key' : 'Password'} value={value} onChange={setValue} autoFocus maxLength={4096} error={wrong ? `The server did not accept this ${what}. Try again.` : undefined}
          hint={connection?.secretMode === 'stored' ? 'It is saved encrypted in the system keychain after a successful connection.' : 'It is kept only until you disconnect or quit Orbis Files.'} />
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- host key decisions */

export function RemoteHostKeyDialog({ connection, info, resolve }: { connection?: RemoteConnectionInfo; info: Extract<RemoteConnectResult, { status: 'hostKeyUnknown' | 'hostKeyChanged' }>; resolve: (ok: boolean) => void }) {
  const done = (ok: boolean) => {
    closeDialog();
    resolve(ok);
  };
  const where = `${info.host}:${info.port}`;
  if (info.certificate) return <RemoteCertificateDialog connection={connection} info={info} certificate={info.certificate} done={done} />;
  if (info.status === 'hostKeyChanged') {
    return (
      <Dialog title="The server’s identity has changed" className="remote-hostkey" width={560} onClose={() => done(false)} footer={<Button variant="primary" data-autofocus onClick={() => done(false)}>Close</Button>}>
        <div className="callout danger" role="alert">
          <Icon name="shieldAlert" size={18} />
          <span>The host key of <strong>{where}</strong> ({connection?.name}) is not the one you trusted before. Someone may be intercepting the connection, or the server was reinstalled. <strong>Orbis Files did not connect</strong> and sent no password.</span>
        </div>
        <dl className="props remote-fingerprints">
          <dt>Trusted before</dt><dd className="mono break">{info.expected}</dd>
          <dt>Presented now</dt><dd className="mono break">{info.fingerprint} <span className="muted remote-algo">({info.algorithm})</span></dd>
        </dl>
        <p className="muted small">If the server’s administrator confirms the new key, open Edit connection → Forget host key, then connect again and check the new fingerprint.</p>
      </Dialog>
    );
  }
  return (
    <Dialog title={`Trust ${connection?.name ?? where}?`} className="remote-hostkey" width={540} onClose={() => done(false)} footer={
      <>
        <Button data-autofocus onClick={() => done(false)}>Cancel</Button>
        <Button variant="primary" icon="fingerprint" onClick={() => done(true)}>Trust and connect</Button>
      </>
    }>
      <p>This is the first connection to <strong className="mono">{where}</strong>. Check that the server’s fingerprint below is the one its administrator gives you (on the server: <code>ssh-keygen -lf</code> on its host key).</p>
      <div className="remote-fingerprint" aria-label="Server fingerprint">
        <span className="muted small">{info.algorithm}</span>
        <span className="mono">{info.fingerprint}</span>
      </div>
      <p className="muted small">The key is remembered for this server. If it ever changes, Orbis Files refuses to connect and warns you.</p>
    </Dialog>
  );
}

/** A certificate fingerprint ("AB:CD:…") that wraps only between byte pairs. */
function HexFingerprint({ value }: { value: string }) {
  const parts = value.split(':');
  return <>{parts.map((p, i) => <React.Fragment key={i}>{p}{i < parts.length - 1 ? <>:<wbr /></> : null}</React.Fragment>)}</>;
}

/** The certificate details to check: subject, issuer and validity (an expired one is flagged), after optional fingerprint rows. */
function CertificateDetails({ cert, before }: { cert: RemoteCertificateInfo; before?: React.ReactNode }) {
  const until = Date.parse(cert.validTo);
  const from = Date.parse(cert.validFrom);
  const expired = Number.isFinite(until) && until < Date.now();
  const early = Number.isFinite(from) && from > Date.now();
  return (
    <dl className="props remote-cert-props">
      {before}
      <dt>Issued to</dt><dd className="remote-cert-name">{cert.subject || '—'}</dd>
      <dt>Issued by</dt><dd className="remote-cert-name">{cert.issuer || '—'}{cert.issuer && cert.issuer === cert.subject ? <span className="muted"> (self-signed)</span> : null}</dd>
      <dt>Valid from</dt><dd className={early ? 'warning-text' : undefined}>{Number.isFinite(from) ? formatDate(from) : '—'}{early ? ' (not valid yet)' : ''}</dd>
      <dt>Valid until</dt><dd className={expired ? 'warning-text' : undefined}>{Number.isFinite(until) ? formatDate(until) : '—'}{expired ? ' (expired)' : ''}</dd>
    </dl>
  );
}

/** FTPS: a certificate the system does not trust (pin on first use), or a pinned certificate that changed (refused). */
function RemoteCertificateDialog({ connection, info, certificate, done }: { connection?: RemoteConnectionInfo; info: Extract<RemoteConnectResult, { status: 'hostKeyUnknown' | 'hostKeyChanged' }>; certificate: RemoteCertificateInfo; done: (ok: boolean) => void }) {
  const where = `${info.host}:${info.port}`;
  if (info.status === 'hostKeyChanged') {
    return (
      <Dialog title="The server’s certificate has changed" className="remote-hostkey" width={580} onClose={() => done(false)} footer={<Button variant="primary" data-autofocus onClick={() => done(false)}>Close</Button>}>
        <div className="callout danger" role="alert">
          <Icon name="shieldAlert" size={18} />
          <span>The TLS certificate of <strong>{where}</strong> ({connection?.name}) is not the one you trusted before. Someone may be intercepting the connection, or the server got a new certificate. <strong>Orbis Files did not connect</strong> and sent no password.</span>
        </div>
        <CertificateDetails cert={certificate} before={
          <>
            <dt>Trusted before</dt><dd className="mono remote-fp-hex"><HexFingerprint value={info.expected} /></dd>
            <dt>Presented now</dt><dd className="mono remote-fp-hex"><HexFingerprint value={info.fingerprint} /></dd>
          </>
        } />
        <p className="muted small">If the server’s administrator confirms the new certificate, open Edit connection → Forget certificate, then connect again and check the new fingerprint.</p>
      </Dialog>
    );
  }
  return (
    <Dialog title={`Trust the certificate of ${connection?.name ?? where}?`} className="remote-hostkey" width={580} onClose={() => done(false)} footer={
      <>
        <Button data-autofocus onClick={() => done(false)}>Cancel</Button>
        <Button variant="primary" icon="fingerprint" onClick={() => done(true)}>Trust and connect</Button>
      </>
    }>
      <div className="callout warning" role="note">
        <Icon name="shieldAlert" size={16} />
        <span><strong>Your system does not trust this certificate.</strong> {certificate.problem ?? ''}</span>
      </div>
      <p>The connection to <strong className="mono">{where}</strong> is encrypted, but only checking the fingerprint proves it is the right server. Compare it with the one the server’s administrator gives you (on the server: <code>openssl x509 -noout -fingerprint -sha256 -in cert.pem</code>).</p>
      <div className="remote-fingerprint" aria-label="Certificate fingerprint">
        <span className="muted small">SHA-256 fingerprint</span>
        <span className="mono remote-fp-hex"><HexFingerprint value={info.fingerprint} /></span>
      </div>
      <CertificateDetails cert={certificate} />
      <p className="muted small">The certificate is pinned for this server: if it ever changes, Orbis Files refuses to connect and warns you. Nothing has been sent yet: your password is sent only after you trust it.</p>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- manager */

export function RemoteConnectionsDialog() {
  const s = useStore(remote, (x) => x);
  const [busy, setBusy] = useState<string | null>(null);
  const connect = async (c: RemoteConnectionInfo) => {
    setBusy(c.id);
    closeDialog();
    await openRemote(c.id);
    setBusy(null);
  };
  const removeConn = async (c: RemoteConnectionInfo) => {
    const ok = await confirm({ title: `Remove “${c.name}”?`, body: 'The connection and its saved password are removed from Orbis Files. Nothing on the server is changed.', confirmLabel: 'Remove connection', destructive: true, detail: [`${c.username}@${c.host}:${c.port}`] });
    if (ok) await call('remote:remove', { id: c.id }).catch(toastError);
    openDialog('remoteConnections');
  };
  return (
    <Dialog title="Remote connections" className="remote-manager" width={640} onClose={closeDialog} footer={
      <>
        <Button onClick={closeDialog}>Close</Button>
        <Button variant="primary" icon="plus" onClick={() => openDialog('remoteEdit', { returnTo: 'remoteConnections' })}>Add connection…</Button>
      </>
    }>
      {!s.connections.length ? (
        <EmptyState icon="server" title="No remote connections yet" body="Add an SFTP (SSH), WebDAV or FTP/FTPS server to browse it like a folder, copy files to and from it, and open its files." />
      ) : (
        <ul className="remote-list" aria-label="Connections">
          {s.connections.map((c) => {
            const t = transportLabel(c);
            return (
              <li key={c.id} className="remote-row">
                <Icon name={c.connected ? 'server' : 'serverOff'} size={18} />
                <div className="remote-row-text">
                  <strong>{c.name}</strong>
                  <span className="mono small muted">{remoteScheme(c)}://{c.username}@{c.host}:{c.port}{c.startPath || ''}</span>
                  <span className="remote-row-pills">
                    <Pill tone={c.connected ? 'success' : 'neutral'}>{c.connected ? 'Connected' : 'Not connected'}</Pill>
                    <Pill tone={t.tone}>{t.text}</Pill>
                    <Pill tone="neutral">{c.auth === 'anonymous' ? 'Anonymous' : c.secretMode === 'stored' ? (c.hasSecret ? 'Password saved' : 'No password saved') : 'Asks for the password'}</Pill>
                  </span>
                </div>
                <div className="remote-row-actions">
                  <Button size="sm" variant="primary" disabled={busy === c.id} onClick={() => void connect(c)}>Open</Button>
                  <IconButton icon="rename" label={`Edit ${c.name}`} onClick={() => openDialog('remoteEdit', { id: c.id, returnTo: 'remoteConnections' })} />
                  {c.connected && <IconButton icon="unplug" label={`Disconnect ${c.name}`} onClick={() => void call('remote:disconnect', { id: c.id, forgetPassword: true }).catch(toastError)} />}
                  <IconButton icon="trash" label={`Remove ${c.name}`} onClick={() => void removeConn(c)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!s.storage.available && <p className="muted small remote-storage-note"><Icon name="lock" size={12} /> {s.storage.reason} Passwords are asked when you connect.</p>}
      {s.opened.length > 0 && (
        <section className="remote-opened" aria-label="Opened remote files">
          <h3>Opened remote files</h3>
          <ul>
            {s.opened.map((o) => (
              <li key={o.localPath} className="remote-row">
                <Icon name="file" size={16} />
                <div className="remote-row-text">
                  <strong>{o.name}</strong>
                  <span className="small muted">from {o.connectionName} · {o.changed ? 'changed, not uploaded' : o.uploadedMs ? `uploaded ${formatDate(o.uploadedMs)}` : 'unchanged'}</span>
                </div>
                <div className="remote-row-actions">
                  <Button size="sm" icon="uploadCloud" disabled={!o.changed} onClick={() => void uploadChanges(o)}>Upload changes</Button>
                  <IconButton icon="trash" label={`Delete the local copy of ${o.name}`} onClick={() => void discardCopy(o)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
