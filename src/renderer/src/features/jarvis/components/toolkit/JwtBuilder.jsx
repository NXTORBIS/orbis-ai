import { useMemo, useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const ENCODER = new TextEncoder();
const ALGS = {
  HS256: { label: 'HS256 · SHA-256', hash: 'SHA-256' },
  HS384: { label: 'HS384 · SHA-384', hash: 'SHA-384' },
  HS512: { label: 'HS512 · SHA-512', hash: 'SHA-512' },
};

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlFromText = (text) => b64url(ENCODER.encode(text));

const fromB64url = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const sign = async (data, secret, hash) => {
  const key = await crypto.subtle.importKey('raw', ENCODER.encode(secret), { name: 'HMAC', hash }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, ENCODER.encode(data));
  return b64url(signature);
};

const START_CLAIMS = [
  { id: uid(), key: 'sub', value: 'user_1234', type: 'string' },
  { id: uid(), key: 'role', value: 'admin', type: 'string' },
];

const PRETTY = (value) => {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};

export default function JwtBuilder() {
  const [tab, setTab] = useState('build');
  const [alg, setAlg] = useState('HS256');
  const [claims, setClaims] = useState(START_CLAIMS);
  const [secret, setSecret] = useState('super-secret-key');
  const [expiryMinutes, setExpiryMinutes] = useState('60');
  const [includeIssuedAt, setIncludeIssuedAt] = useState(true);
  const [includeExpiry, setIncludeExpiry] = useState(true);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [verifyToken, setVerifyToken] = useState('');
  const [verifySecret, setVerifySecret] = useState('super-secret-key');
  const [verification, setVerification] = useState(null);

  const payload = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const body = {};
    if (includeIssuedAt) body.iat = now;
    if (includeExpiry && Number(expiryMinutes) > 0) body.exp = now + Number(expiryMinutes) * 60;
    claims.forEach((claim) => {
      if (!claim.key.trim()) return;
      const raw = claim.value;
      if (claim.type === 'number') body[claim.key] = Number(raw);
      else if (claim.type === 'boolean') body[claim.key] = raw === 'true';
      else if (claim.type === 'json') {
        try {
          body[claim.key] = JSON.parse(raw);
        } catch {
          body[claim.key] = raw;
        }
      } else body[claim.key] = raw;
    });
    return body;
  }, [claims, expiryMinutes, includeIssuedAt, includeExpiry]);

  const header = useMemo(() => ({ alg, typ: 'JWT' }), [alg]);

  const previewToken = useMemo(() => {
    const headerPart = b64urlFromText(JSON.stringify(header));
    const payloadPart = b64urlFromText(JSON.stringify(payload));
    return { headerPart, payloadPart, joined: `${headerPart}.${payloadPart}` };
  }, [header, payload]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const signature = await sign(previewToken.joined, secret, ALGS[alg].hash);
      setToken(`${previewToken.joined}.${signature}`);
    } catch (err) {
      setError(`Could not sign: ${err.message}. Web Crypto needs a secure (https) page, which this is — so check the secret is not empty.`);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError('');
    const parts = verifyToken.trim().split('.');
    if (parts.length !== 3) {
      setVerification({ ok: false, reason: 'A JWT has three parts separated by dots — this one does not.' });
      return;
    }
    try {
      const decodedHeader = JSON.parse(fromB64url(parts[0]));
      const decodedPayload = JSON.parse(fromB64url(parts[1]));
      const expected = await sign(`${parts[0]}.${parts[1]}`, verifySecret, ALGS[decodedHeader.alg]?.hash || 'SHA-256');
      const signatureMatches = expected === parts[2];
      const now = Math.floor(Date.now() / 1000);
      const expired = typeof decodedPayload.exp === 'number' && decodedPayload.exp < now;
      const notYet = typeof decodedPayload.nbf === 'number' && decodedPayload.nbf > now;
      setVerification({
        ok: signatureMatches && !expired && !notYet,
        signatureMatches,
        expired,
        notYet,
        decodedHeader,
        decodedPayload,
        exp: decodedPayload.exp,
        iat: decodedPayload.iat,
        reason: !signatureMatches ? 'Signature does not match this secret — either the wrong secret or the token was altered.'
          : expired ? 'Signature is valid, but the token expired.'
            : notYet ? 'Signature is valid, but the token is not valid yet (nbf is in the future).'
              : 'Signature valid and the token is within its validity window.',
      });
    } catch (err) {
      setVerification({ ok: false, reason: `Could not read that token: ${err.message}` });
    }
  };

  const decodeOnly = useMemo(() => {
    const parts = verifyToken.trim().split('.');
    if (parts.length < 2) return null;
    try {
      return { header: JSON.parse(fromB64url(parts[0])), payload: JSON.parse(fromB64url(parts[1])) };
    } catch {
      return null;
    }
  }, [verifyToken]);

  const report = tab === 'build'
    ? `${alg} token\n\n${token || '(press Sign to create the token)'}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
    : verification
      ? `${verification.ok ? 'VALID' : 'INVALID'} — ${verification.reason}\n\n${JSON.stringify(verification.decodedPayload || {}, null, 2)}`
      : 'Paste a token to verify it.';

  const seconds = Math.round(secondsUntil(payload.exp));

  return (
    <ToolShell
      toolId="jwt-builder"
      icon={KeyRound}
      title="JWT Builder & Verifier"
      desc="Compose a real, correctly signed JWT in the browser, then check any token's signature and expiry — no server and no secret leaving the page."
      state={{ tab, alg, claims, expiryMinutes, includeIssuedAt, includeExpiry, token }}
      onRestore={(restored) => {
        if (restored.tab) setTab(restored.tab);
        if (restored.alg) setAlg(restored.alg);
        if (Array.isArray(restored.claims) && restored.claims.length) setClaims(restored.claims);
        if (restored.expiryMinutes !== undefined) setExpiryMinutes(String(restored.expiryMinutes));
        if (typeof restored.includeIssuedAt === 'boolean') setIncludeIssuedAt(restored.includeIssuedAt);
        if (typeof restored.includeExpiry === 'boolean') setIncludeExpiry(restored.includeExpiry);
        if (typeof restored.token === 'string') setToken(restored.token);
      }}
      exportText={report}
      exportName="jwt.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={tab} onChange={setTab} options={[{ value: 'build', label: 'Build & sign' }, { value: 'verify', label: 'Verify' }]} />
        {tab === 'build' && (
          <button
            type="button"
            onClick={create}
            disabled={busy || !secret}
            className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
          >
            {busy ? 'Signing…' : 'Sign token'}
          </button>
        )}
        {!!token && <CopyBtn value={token} label="Copy token" />}
      </div>

      {error && <Panel className="border-rose-500/40 text-[11px] text-rose-400">{error}</Panel>}

      {tab === 'build' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Algorithm">
              <select value={alg} onChange={(e) => setAlg(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm">
                {Object.entries(ALGS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
              </select>
            </Field>
            <Field label="Secret (never sent anywhere)">
              <input value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            </Field>
            <Field label="Expires in (minutes)">
              <input value={expiryMinutes} onChange={(e) => setExpiryMinutes(e.target.value)} inputMode="numeric" disabled={!includeExpiry} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm disabled:opacity-40" />
            </Field>
          </div>

          <div className="space-y-2">
            {claims.map((claim) => (
              <div key={claim.id} className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-2">
                <input
                  value={claim.key}
                  onChange={(e) => setClaims((current) => current.map((row) => (row.id === claim.id ? { ...row, key: e.target.value } : row)))}
                  placeholder="claim"
                  className="h-9 rounded-md border border-input bg-transparent px-2.5 font-mono-j text-sm"
                />
                <input
                  value={claim.value}
                  onChange={(e) => setClaims((current) => current.map((row) => (row.id === claim.id ? { ...row, value: e.target.value } : row)))}
                  placeholder="value"
                  className="h-9 rounded-md border border-input bg-transparent px-2.5 font-mono-j text-sm"
                />
                <select
                  value={claim.type}
                  onChange={(e) => setClaims((current) => current.map((row) => (row.id === claim.id ? { ...row, type: e.target.value } : row)))}
                  className="h-9 rounded-md border border-input bg-transparent px-1.5 font-mono-j text-[11px]"
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="json">json</option>
                </select>
                <button type="button" onClick={() => setClaims((current) => current.filter((row) => row.id !== claim.id))} className="text-muted-foreground transition hover:text-rose-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setClaims((current) => [...current, { id: uid(), key: '', value: '', type: 'string' }].slice(0, 20))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
            >
              <Plus className="h-3.5 w-3.5" /> Add claim
            </button>
            <button
              type="button"
              onClick={() => setClaims((current) => [...current, { id: uid(), key: 'scope', value: 'read write', type: 'string' }])}
              className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:text-foreground"
            >
              + scope
            </button>
            <button
              type="button"
              onClick={() => setClaims((current) => [...current, { id: uid(), key: 'aud', value: 'mark32-api', type: 'string' }])}
              className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:text-foreground"
            >
              + aud
            </button>
            <ToggleRow label="Include iat" checked={includeIssuedAt} onChange={setIncludeIssuedAt} />
            <ToggleRow label="Include exp" checked={includeExpiry} onChange={setIncludeExpiry} />
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <Panel className="!p-3">
              <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Header and payload</div>
              <pre className="whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">
                {PRETTY(JSON.stringify(header, null, 2))}
                {'\n'}
                {PRETTY(JSON.stringify(payload, null, 2))}
              </pre>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Signed token</div>
              <div className="break-all font-mono-j text-[11px]">
                {token ? (
                  <>
                    <span className="text-rose-400">{token.split('.')[0]}</span>
                    <span className="text-muted-foreground">.</span>
                    <span className="text-cyan-j">{token.split('.')[1]}</span>
                    <span className="text-muted-foreground">.</span>
                    <span className="text-emerald-400">{token.split('.')[2]}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Press “Sign token” to generate it. The three coloured parts are header, payload and signature.</span>
                )}
              </div>
              {!!token && (
                <div className="mt-2 font-mono-j text-[10px] text-muted-foreground">
                  {token.length} characters · signature {token.split('.')[2].length} chars
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Algorithm" value={alg} mono />
            <Stat label="Claims" value={String(Object.keys(payload).length)} mono />
            <Stat label="Valid for" value={includeExpiry ? `${expiryMinutes} min` : 'no expiry'} mono />
            <Stat label="Signature" value={token ? 'signed' : 'pending'} mono />
          </div>
        </>
      ) : (
        <>
          <Area label="Token to verify" value={verifyToken} onChange={setVerifyToken} rows={5} mono placeholder="eyJhbGciOiJIUzI1NiIs…" />
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Secret used to sign it">
              <input value={verifySecret} onChange={(e) => setVerifySecret(e.target.value)} spellCheck={false} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            </Field>
            <button
              type="button"
              onClick={verify}
              disabled={!verifyToken.trim()}
              className="self-end rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-2 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
            >
              Verify signature
            </button>
          </div>

          {verification && (
            <>
              <Hero
                tone={verification.ok ? 'emerald' : 'rose'}
                label={verification.ok ? 'Valid token' : 'Not valid'}
                value={verification.signatureMatches ? 'Signature OK' : 'Signature mismatch'}
                sub={verification.reason}
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <Stat label="Signature" value={verification.signatureMatches ? 'matches' : 'does not match'} mono />
                <Stat label="Expiry" value={verification.expired ? 'expired' : verification.exp ? new Date(verification.exp * 1000).toLocaleString() : 'none'} />
                <Stat
                  label="Issued"
                  value={verification.iat ? new Date(verification.iat * 1000).toLocaleTimeString() : 'not stated'}
                />
              </div>
            </>
          )}

          {decodeOnly && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Panel className="!p-3">
                <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Header</div>
                <pre className="whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{JSON.stringify(decodeOnly.header, null, 2)}</pre>
              </Panel>
              <Panel className="!p-3">
                <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Payload</div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{JSON.stringify(decodeOnly.payload, null, 2)}</pre>
              </Panel>
            </div>
          )}
        </>
      )}

      {tab === 'build' && (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Parts" value="3" mono sub="header.payload.signature" />
          <Stat label="Base64url" value="no padding" mono sub="+ → -, / → _" />
          <Stat label={includeExpiry ? 'Expires' : 'No expiry'} value={includeExpiry ? `${seconds} s` : '—'} mono />
          <Stat label="Header" value={`${alg} / JWT`} mono />
        </div>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What to remember about JWTs</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· The payload is <strong>encoded, not encrypted</strong>. Anyone holding the token can read it — never put secrets in claims.</p>
          <p>· HS256 shares one secret between signer and verifier. If a third party must verify without issuing, use RS256 with a key pair instead.</p>
          <p>· Always validate <span className="font-mono-j">exp</span>, <span className="font-mono-j">aud</span> and <span className="font-mono-j">iss</span> on the server — a valid signature on a token for another audience is still a security hole.</p>
          <p>· Keep access tokens short-lived (5–60 minutes) and put long-lived identity in a refresh token instead.</p>
          <p>· {alg} signatures here use your browser's Web Crypto, so no secret is transmitted anywhere — but a test secret should never be a production one.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Algorithm', value: alg },
              { label: 'Claims', value: Object.keys(payload).length },
              { label: 'Mode', value: tab },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Useful for building a token to paste into an API client, checking why a request is rejected with 401, or confirming that a token you were handed
          really is expired rather than malformed. On the verify tab the signature check is recomputed locally: a match means the payload has not been
          altered since it was signed with that secret.
        </p>
      </Panel>
    </ToolShell>
  );
}

const secondsUntil = (exp) => {
  if (typeof exp !== 'number') return 0;
  return Math.max(0, exp - Math.floor(Date.now() / 1000));
};