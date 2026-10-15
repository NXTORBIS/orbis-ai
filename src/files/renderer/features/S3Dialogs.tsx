import { useState } from 'react';
import { call, errorShape } from '../api';
import { closeDialog, toast, toastError, confirm } from '../state/app';
import { useStore } from '../state/store';
import { s3Store } from '../state/s3';
import { Button, Dialog, PasswordField, Select, TextField } from '../ui/components';
import { S3_PROVIDERS, S3_PROVIDER_IDS, resolveEndpoint, type S3ProviderId, type S3ConnectionInfo } from '../../shared/s3';

/* ---------------------------------------------------------------- add / edit S3 connection */

/**
 * Add or edit an S3 connection. The secret access key is write-only: sent to
 * be stored encrypted, or kept for this session when "Ask every time" is chosen,
 * and is never shown again.
 */
export function S3EditDialog({ id, returnTo }: { id?: string; returnTo?: string }) {
  const existing = useStore(s3Store, (s) => s.connections.find((c) => c.id === id));
  const storage = useStore(s3Store, (s) => s.storage);
  const [name, setName] = useState(existing?.name ?? '');
  const [provider, setProvider] = useState<S3ProviderId>(existing?.provider as S3ProviderId ?? 'aws');
  const [region, setRegion] = useState(existing?.region ?? 'us-east-1');
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? '');
  const [accessKeyId, setAccessKeyId] = useState(existing?.accessKeyId ?? '');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [secretMode, setSecretMode] = useState<'stored' | 'ask'>(existing?.secretMode ?? (storage.available ? 'stored' : 'ask'));
  const [secure, setSecure] = useState(existing?.secure ?? true);
  const [bucket, setBucket] = useState(existing?.bucket ?? '');
  const [accountId, setAccountId] = useState(existing?.accountId ?? '');
  const [pathStyle, setPathStyle] = useState(existing?.pathStyle ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const preset = S3_PROVIDERS[provider];
  const needsAccountId = preset?.needsAccountId ?? false;
  const regions = preset?.regions;
  const endpointEditable = !preset?.endpoint;

  // Resolve endpoint from the provider template
  const resolvedEndpoint = endpointEditable ? endpoint : resolveEndpoint(provider, region, accountId);

  const storedAllowed = storage.available;

  const onSubmit = async () => {
    setError(undefined);
    setBusy(true);
    try {
      await call('s3:save', {
        ...(id ? { id } : {}),
        name: name || resolvedEndpoint,
        provider,
        endpoint: resolvedEndpoint,
        region,
        accessKeyId,
        secretAccessKey: secretAccessKey || (existing ? undefined : null),
        secure,
        bucket,
        accountId,
        pathStyle: preset?.pathStyle ?? pathStyle,
        secretMode,
      });
      closeDialog();
      if (returnTo) toast({ level: 'success', title: 'S3 connection saved.' });
    } catch (err) {
      setError(errorShape(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={id ? 'Edit S3 Connection' : 'Add S3 Connection'} width={520} onClose={closeDialog}>
      <div className="dialog-form">
        <TextField id="s3-name" value={name} placeholder={resolvedEndpoint || 'My S3 storage'} onChange={(e) => setName(e.target.value)} autoFocus label="Name" />

        <Select id="s3-provider" value={provider} options={S3_PROVIDER_IDS.map((k) => ({ value: k, label: S3_PROVIDERS[k]!.name }))} onChange={(v) => { setProvider(v as S3ProviderId); setPathStyle(S3_PROVIDERS[v]?.pathStyle ?? false); }} label="Provider" />

        {needsAccountId && (
          <TextField id="s3-account" value={accountId} placeholder="Cloudflare account ID" onChange={(e) => setAccountId(e.target.value)} label="Account ID" />
        )}

        {regions && regions.length > 0 && (
          <Select id="s3-region" value={region} options={regions.map((r) => ({ value: r, label: r }))} onChange={setRegion} label="Region" />
        )}

        {endpointEditable && (
          <TextField id="s3-endpoint" value={endpoint} placeholder={preset?.note ?? 'your-server.example.com'} onChange={(e) => setEndpoint(e.target.value)} label="Endpoint" hint={preset?.note} />
        )}

        {!endpointEditable && resolvedEndpoint && (
          <TextField id="s3-endpoint-resolved" value={resolvedEndpoint} disabled label="Endpoint" />
        )}

        <TextField id="s3-accesskey" value={accessKeyId} placeholder="AKIAIOSFODNN7EXAMPLE" onChange={(e) => setAccessKeyId(e.target.value)} spellCheck={false} label="Access Key ID" />

        <PasswordField id="s3-secret" label={`Secret Access Key${existing?.hasSecret ? ' (saved)' : ''}`} value={secretAccessKey} onChange={setSecretAccessKey} />

        <Select
          id="s3-secretmode"
          value={secretMode}
          options={[
            { value: 'stored' as const, label: 'Remember (encrypted)' },
            { value: 'ask' as const, label: 'Ask every time' },
          ]}
          onChange={(v) => setSecretMode(v as 'stored' | 'ask')}
          label="Secret storage"
        />
        {!storedAllowed && <span className="field-hint">Secure storage is not available on this system.</span>}

        <TextField id="s3-bucket" value={bucket} placeholder="Leave empty to show all buckets" onChange={(e) => setBucket(e.target.value)} label="Default bucket (optional)" />

        <div className="form-row">
          <label className="form-checkbox">
            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
            <span>Use HTTPS</span>
          </label>
          {(endpointEditable || !preset?.pathStyle) && (
            <label className="form-checkbox">
              <input type="checkbox" checked={pathStyle} onChange={(e) => setPathStyle(e.target.checked)} />
              <span>Path-style addressing</span>
            </label>
          )}
        </div>

        {error && <div className="field-error">{error}</div>}
      </div>

      <div className="dialog-footer">
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" onClick={onSubmit} disabled={busy || !resolvedEndpoint || !accessKeyId || (!secretAccessKey && !existing)}>
          {busy ? 'Saving...' : id ? 'Save' : 'Add'}
        </Button>
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- connection list */

export function S3ConnectionsDialog() {
  const connections = useStore(s3Store, (s) => s.connections);
  return (
    <Dialog title="S3 Connections" width={560} onClose={closeDialog}>
      <div className="dialog-body">
        {connections.length === 0 ? (
          <div className="dialog-empty">No S3 connections yet. Add one to browse your cloud storage.</div>
        ) : (
          <div className="remote-list">
            {connections.map((c) => (
              <S3ConnectionRow key={c.id} conn={c} />
            ))}
          </div>
        )}
      </div>
      <div className="dialog-footer">
        <Button onClick={closeDialog}>Close</Button>
        <Button variant="primary" onClick={() => { closeDialog(); import('../state/app').then((m) => m.openDialog('s3Edit')); }}>Add connection</Button>
      </div>
    </Dialog>
  );
}

function S3ConnectionRow({ conn }: { conn: S3ConnectionInfo }) {
  const providerName = S3_PROVIDERS[conn.provider]?.name ?? conn.provider;
  return (
    <div className="remote-row">
      <div className="remote-row-info">
        <span className="remote-row-name">{conn.name}</span>
        <span className="remote-row-detail muted">{providerName} &middot; {conn.endpoint} &middot; {conn.region}</span>
      </div>
      <div className="remote-row-actions">
        {conn.connected ? (
          <span className="status-dot status-connected" title="Connected" />
        ) : (
          <span className="status-dot status-disconnected" title="Disconnected" />
        )}
        <Button size="sm" onClick={() => { closeDialog(); import('../state/app').then((m) => m.openDialog('s3Edit', { id: conn.id })); }}>Edit</Button>
        <Button size="sm" variant="danger" onClick={async () => {
          const ok = await confirm({ title: 'Remove S3 connection?', body: `Remove "${conn.name}"? This cannot be undone.`, confirmLabel: 'Remove', destructive: true });
          if (ok) {
            try { await call('s3:remove', { id: conn.id }); } catch (e) { toastError(e, 'Remove S3 connection'); }
          }
        }}>Remove</Button>
      </div>
    </div>
  );
}
