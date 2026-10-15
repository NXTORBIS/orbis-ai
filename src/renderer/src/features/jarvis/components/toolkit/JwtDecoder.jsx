import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { ToolHeader, CopyBtn, Stat } from './shared';

function b64urlDecode(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }

export default function JwtDecoder() {
  const [token, setToken] = useState('');
  const [parts, setParts] = useState(null);
  const [err, setErr] = useState(null);

  const decode = () => {
    setErr(null); setParts(null);
    const seg = token.trim().split('.');
    if (seg.length < 2) { setErr('Not a valid JWT (expected 3 segments)'); return; }
    try {
      const header = JSON.parse(b64urlDecode(seg[0]));
      const payload = JSON.parse(b64urlDecode(seg[1]));
      const fmt = (o) => JSON.stringify(o, null, 2);
      setParts({ header: fmt(header), payload: fmt(payload), sig: seg[2] || '', iat: payload.iat, exp: payload.exp, nbf: payload.nbf });
    } catch (e) { setErr('Failed to decode: ' + e.message); }
  };
  const ts = (n) => n ? new Date(n * 1000).toLocaleString() : null;

  return (
    <div className="space-y-4">
      <ToolHeader icon={KeyRound} title="JWT Decoder" desc="Decode a JSON Web Token's header and payload. This decodes only — it does NOT verify the signature." />
      <textarea value={token} onChange={(e) => setToken(e.target.value)} placeholder="paste JWT…" className="h-24 w-full rounded-md border border-input bg-transparent p-3 font-mono-j text-xs break-all" />
      <button onClick={decode} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">Decode</button>
      {err && <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">{err}</div>}
      {parts && (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">⚠ Decoding is not verification. Anyone can decode a JWT — only the server with the secret key can verify it.</div>
          <div><div className="mb-1 flex justify-between"><span className="text-xs font-bold text-cyan-j">Header</span><CopyBtn value={parts.header} label="" /></div><pre className="overflow-auto rounded-md border border-border/70 bg-card/60 p-3 font-mono-j text-xs">{parts.header}</pre></div>
          <div><div className="mb-1 flex justify-between"><span className="text-xs font-bold text-cyan-j">Payload</span><CopyBtn value={parts.payload} label="" /></div><pre className="overflow-auto rounded-md border border-border/70 bg-card/60 p-3 font-mono-j text-xs">{parts.payload}</pre></div>
          <div className="grid grid-cols-3 gap-2">
            {parts.iat && <Stat label="Issued at" value={ts(parts.iat)} />}
            {parts.exp && <Stat label="Expires" value={ts(parts.exp)} />}
            {parts.nbf && <Stat label="Not before" value={ts(parts.nbf)} />}
          </div>
          <div><div className="text-xs text-muted-foreground">Signature (hex preview)</div><div className="break-all rounded-md border border-border/70 bg-card/60 p-2 font-mono-j text-xs">{parts.sig.slice(0, 40)}…</div></div>
        </div>
      )}
    </div>
  );
}