import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { ToolHeader, Area, Field, Seg, Out, CopyBtn, Panel, Stat, Unsupported } from './shared';
import ToolShell from './kit/ToolShell';

const ALGOS = [['SHA-256', 'SHA-256'], ['SHA-1', 'SHA-1'], ['SHA-512', 'SHA-512'], ['SHA-384', 'SHA-384']];

const toHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

export default function HmacGenerator() {
  const [message, setMessage] = useState('{"event":"order.created","id":1042}');
  const [key, setKey] = useState('whsec_example_key');
  const [algo, setAlgo] = useState('SHA-256');
  const [encoding, setEncoding] = useState('hex');
  const [expected, setExpected] = useState('');
  const [signature, setSignature] = useState('');
  const [error, setError] = useState(null);

  const supported = typeof crypto !== 'undefined' && !!crypto.subtle;

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const encoder = new TextEncoder();
        const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: algo }, false, ['sign']);
        const buffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
        if (cancelled) return;
        const bytes = new Uint8Array(buffer);
        setSignature(encoding === 'hex' ? toHex(bytes) : toBase64(bytes));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e.message || 'That key or algorithm could not be used.');
      }
    })();
    return () => { cancelled = true; };
  }, [message, key, algo, encoding, supported]);

  const matches = expected.trim()
    ? expected.trim().toLowerCase() === signature.toLowerCase()
    : null;

  return (
    <ToolShell
      toolId="hmac"
      icon={KeyRound}
      title="HMAC Signature Generator"
      desc="Sign a payload with a shared secret — the same way webhooks prove they really came from the sender."
      state={{ message, key, algo, encoding, expected }}
      onRestore={(saved) => { setMessage(saved.message); setKey(saved.key); setAlgo(saved.algo); setEncoding(saved.encoding); setExpected(saved.expected); }}
      exportText={signature}
      exportName="signature.txt"
    >
      {!supported && <Unsupported msg="Web Crypto is unavailable here, so signatures cannot be computed. Open the app over https:// in a modern browser." />}
      {supported && (
        <>
          <Field label="Payload to sign"><Area value={message} onChange={setMessage} rows={5} mono placeholder="The raw request body, exactly as sent" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Secret key" hint="Stays on your device — nothing is uploaded">
              <input value={key} onChange={(e) => setKey(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            </Field>
            <Field label="Output encoding">
              <Seg value={encoding} onChange={setEncoding} options={[{ value: 'hex', label: 'Hex' }, { value: 'base64', label: 'Base64' }]} />
            </Field>
          </div>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Hash algorithm</span>
            <Seg value={algo} onChange={setAlgo} options={ALGOS.map(([value, label]) => ({ value, label }))} />
          </div>
          <Out label={`HMAC-${algo} (${encoding})`} value={signature}>
            <pre className="break-all font-mono-j text-xs text-cyan-j">{signature || '—'}</pre>
          </Out>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Signature length" value={`${signature.length} chars`} />
            <Stat label="Payload bytes" value={String(new TextEncoder().encode(message).length)} />
            <Stat label="Key bytes" value={String(new TextEncoder().encode(key).length)} />
          </div>
          <Field label="Verify against a received signature" hint="Paste the signature from the header and it will be compared here">
            <input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="e.g. 6f9a2c…" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </Field>
          {matches !== null && (
            <div className={`rounded-lg border px-4 py-3 text-sm ${matches ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400' : 'border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400'}`}>
              {matches ? 'The signatures match — the payload is authentic and unmodified.' : 'They differ. Either the secret is wrong, the payload was altered, or the signature was truncated.'}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <CopyBtn value={signature} label="Copy signature" />
            <CopyBtn value={`${key}:${signature}`} label="Copy key:signature" />
          </div>
          {error && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{error}</div>}
          <Panel>
            <div className="text-[11px] leading-relaxed text-muted-foreground">
              HMAC mixes the secret into the hash itself, so an attacker cannot forge a signature without the key. Verify on the server using the raw request body — re-serialising JSON changes the bytes and the signature will no longer match.
            </div>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}