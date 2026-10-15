import { useMemo, useState } from 'react';
import { KeyRound } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const randomString = (length) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
};

const base64Url = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export default function PkceGenerator() {
  const [verifierLength, setVerifierLength] = useState(64);
  const [verifier, setVerifier] = useState('');
  const [challenge, setChallenge] = useState('');
  const [state, setState] = useState('');
  const [nonce, setNonce] = useState('');
  const [clientId, setClientId] = useState('');
  const [redirect, setRedirect] = useState('https://your.app/callback');
  const [authorizeUrl, setAuthorizeUrl] = useState('https://accounts.example.com/authorize');
  const [scopes, setScopes] = useState('openid profile email');

  const generate = async () => {
    const fresh = randomString(verifierLength);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fresh));
    setVerifier(fresh);
    setChallenge(base64Url(digest));
    setState(randomString(32));
    setNonce(randomString(32));
  };

  const authorize = useMemo(() => {
    if (!clientId || !redirect) return '';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      scope: scopes,
      state: state || '{{state}}',
      code_challenge: challenge || '{{code_challenge}}',
      code_challenge_method: 'S256',
      ...(nonce ? { nonce } : {}),
    });
    return `${authorizeUrl}?${params.toString()}`;
  }, [clientId, redirect, scopes, state, challenge, nonce, authorizeUrl]);

  const exchange = `curl -X POST https://accounts.example.com/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d grant_type=authorization_code \\
  -d code=AUTHORIZATION_CODE \\
  -d redirect_uri=${redirect || 'https://your.app/callback'} \\
  -d client_id=${clientId || 'YOUR_CLIENT_ID'} \\
  -d code_verifier=${verifier || '{{code_verifier}}'}`;

  const report = [
    `code_verifier: ${verifier}`,
    `code_challenge: ${challenge}`,
    `state: ${state}`,
    `nonce: ${nonce}`,
    '',
    `Authorize URL:\n${authorize}`,
    '',
    `Token exchange:\n${exchange}`,
  ].join('\n');

  return (
    <ToolShell
      toolId="pkce"
      icon={KeyRound}
      title="OAuth PKCE Generator"
      desc="Everything an OAuth 2.1 authorisation-code flow needs — verifier, S256 challenge, state, nonce and a ready-made authorize URL."
      state={{ verifierLength, verifier, challenge, state, nonce, clientId, redirect, authorizeUrl, scopes }}
      onRestore={(restored) => {
        if (restored.verifierLength) setVerifierLength(Number(restored.verifierLength));
        if (typeof restored.verifier === 'string') setVerifier(restored.verifier);
        if (typeof restored.challenge === 'string') setChallenge(restored.challenge);
        if (typeof restored.state === 'string') setState(restored.state);
        if (typeof restored.nonce === 'string') setNonce(restored.nonce);
        if (typeof restored.clientId === 'string') setClientId(restored.clientId);
        if (typeof restored.redirect === 'string') setRedirect(restored.redirect);
        if (typeof restored.authorizeUrl === 'string') setAuthorizeUrl(restored.authorizeUrl);
        if (typeof restored.scopes === 'string') setScopes(restored.scopes);
      }}
      exportText={report}
      exportName="pkce.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generate}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <KeyRound className="h-3.5 w-3.5" /> Generate a fresh set
        </button>
        <CopyBtn value={report} label="Copy everything" />
      </div>

      <Field label={`Verifier length · ${verifierLength} characters`} hint="Spec allows 43–128">
        <input type="range" min={43} max={128} value={verifierLength} onChange={(e) => setVerifierLength(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      {verifier ? (
        <div className="space-y-2">
          {[
            { label: 'code_verifier (keep secret, send at exchange)', value: verifier },
            { label: 'code_challenge (S256, goes in the authorize URL)', value: challenge },
            { label: 'state (compare on callback)', value: state },
            { label: 'nonce (for OpenID Connect)', value: nonce },
          ].map((row) => (
            <div key={row.label} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{row.label}</span>
                <CopyBtn value={row.value} label="Copy" />
              </div>
              <div className="break-all font-mono-j text-[11px] text-cyan-j">{row.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <Panel className="text-[11px] text-muted-foreground">
          Generate a set to start. The verifier and challenge are created with the browser's cryptographic random generator and never leave this page.
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Authorize endpoint">
          <input value={authorizeUrl} onChange={(e) => setAuthorizeUrl(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
        <Field label="Client ID">
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="your-client-id" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
        <Field label="Redirect URI">
          <input value={redirect} onChange={(e) => setRedirect(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
        <Field label="Scopes">
          <input value={scopes} onChange={(e) => setScopes(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Authorize URL</span>
          <CopyBtn value={authorize} label="Copy URL" />
        </div>
        <div className="break-all font-mono-j text-[10px] text-cyan-j">{authorize || 'Add a client ID and redirect URI to build the URL.'}</div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Token exchange</span>
          <CopyBtn value={exchange} label="Copy cURL" />
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[10px] text-cyan-j">{exchange}</pre>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Method" value="S256" mono />
        <Stat label="Verifier" value={`${verifier.length} chars`} mono />
        <Stat label="Challenge" value={`${challenge.length} chars`} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          PKCE exists so a public client — a mobile app, a single-page app — can prove it started the flow without shipping a client secret. Send the
          verifier only to the token endpoint, check the returned state matches, and generate a brand-new verifier for every attempt. Never reuse a
          set you copied from earlier.
        </p>
      </Panel>
    </ToolShell>
  );
}