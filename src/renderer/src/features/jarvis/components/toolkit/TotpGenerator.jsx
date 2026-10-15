import { useEffect, useMemo, useState } from 'react';
import { KeyRound } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Decode = (input) => {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
};

const hmac = async (keyBytes, message, hash) => {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
};

const counterBytes = (counter) => {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter % 2 ** 32);
  return new Uint8Array(buffer);
};

export default function TotpGenerator() {
  const [secret, setSecret] = useState('JBSWY3DPEHPK3PXP');
  const [label, setLabel] = useState('you@example.com');
  const [issuer, setIssuer] = useState('Mark32');
  const [digits, setDigits] = useState(6);
  const [period, setPeriod] = useState(30);
  const [algorithm, setAlgorithm] = useState('SHA-1');
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [codes, setCodes] = useState({ current: '', next: '', previous: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const generate = async () => {
      const keyBytes = base32Decode(secret);
      if (keyBytes.length < 4) {
        setError('That secret is not valid base32 — it should be letters A–Z and digits 2–7, at least 8 characters.');
        setCodes({ current: '', next: '', previous: '' });
        return;
      }
      setError('');
      const counter = Math.floor((now / 1000 + offset) / period);
      const build = async (value) => {
        const digest = await hmac(keyBytes, counterBytes(value), algorithm);
        const index = digest[digest.length - 1] & 0x0f;
        const binary = ((digest[index] & 0x7f) << 24) | (digest[index + 1] << 16) | (digest[index + 2] << 8) | digest[index + 3];
        return String(binary % 10 ** digits).padStart(digits, '0');
      };
      const [current, next, previous] = await Promise.all([build(counter), build(counter + 1), build(counter - 1)]);
      if (!cancelled) setCodes({ current, next, previous });
    };
    generate();
    return () => { cancelled = true; };
  }, [secret, digits, period, algorithm, offset, now]);

  const secondsLeft = period - (Math.floor(now / 1000) % period);
  const progress = (secondsLeft / period) * 100;

  const uri = useMemo(() => {
    const params = new URLSearchParams({
      secret: secret.replace(/\s/g, '').toUpperCase(),
      issuer,
      digits: String(digits),
      period: String(period),
      algorithm: algorithm.replace('-', ''),
    });
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
  }, [secret, issuer, label, digits, period, algorithm]);

  const otpauthCurl = `# Verify with oathtool:\noathtool --totp -b ${secret.replace(/\s/g, '').toUpperCase()}\n\n# Or with python:\npython -c "import pyotp;print(pyotp.TOTP('${secret.replace(/\s/g, '').toUpperCase()}').now())"`;

  return (
    <ToolShell
      toolId="totp"
      icon={KeyRound}
      title="TOTP Code Generator"
      desc="Turn a 2FA secret into live codes — the same RFC 6238 maths every authenticator app runs, handy for testing your own login flow."
      state={{ secret, label, issuer, digits, period, algorithm, offset }}
      onRestore={(restored) => {
        if (typeof restored.secret === 'string') setSecret(restored.secret);
        if (typeof restored.label === 'string') setLabel(restored.label);
        if (typeof restored.issuer === 'string') setIssuer(restored.issuer);
        if (restored.digits) setDigits(Number(restored.digits));
        if (restored.period) setPeriod(Number(restored.period));
        if (restored.algorithm) setAlgorithm(restored.algorithm);
        if (restored.offset) setOffset(Number(restored.offset));
      }}
      exportText={`${issuer} · ${label}\n${codes.current}  (next ${codes.next} in ${secondsLeft}s)\nSecret: ${secret}\n${uri}`}
      exportName="totp.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={codes.current} label="Copy current code" />
        <CopyBtn value={uri} label="Copy otpauth URI" />
      </div>

      <div className="tk-card tk-glow-ring relative overflow-hidden rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-5 text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Current code</div>
        <div className="tk-title-glow mt-1 font-mono-j text-5xl font-bold tracking-[0.25em] text-cyan-j">
          {codes.current ? `${codes.current.slice(0, Math.ceil(digits / 2))} ${codes.current.slice(Math.ceil(digits / 2))}` : '— — —'}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full border border-border/70 bg-card/60">
          <div className={`h-full rounded-full ${secondsLeft <= 5 ? 'bg-amber-400' : 'bg-cyan-j'} transition-[width]`} style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">valid for {secondsLeft}s · next code {codes.next || '—'}</div>
      </div>

      {error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>}

      <Field label="Shared secret (base32, exactly as the service gave it)">
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          spellCheck={false}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm tracking-wider"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Account label">
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label="Issuer">
          <input value={issuer} onChange={(e) => setIssuer(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label={`Period · ${period}s`}>
          <input type="range" min={15} max={90} step={15} value={period} onChange={(e) => setPeriod(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Digits">
          <div className="flex gap-1.5">
            {[6, 8].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDigits(value)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${digits === value ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
              >
                {value}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Algorithm">
          <div className="flex gap-1.5">
            {['SHA-1', 'SHA-256'].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setAlgorithm(value)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${algorithm === value ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
              >
                {value}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Preview at time offset" hint="Check that a past code was accepted">
          <div className="flex gap-1.5">
            {[-60, -30, 0, 30].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setOffset(value)}
                className={`rounded-lg border px-2 py-1 font-mono-j text-[10px] transition ${offset === value ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
              >
                {value === 0 ? 'now' : `${value > 0 ? '+' : ''}${value}s`}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Previous" value={codes.previous || '—'} mono />
        <Stat label="Current" value={codes.current || '—'} mono />
        <Stat label="Next" value={codes.next || '—'} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">otpauth:// URI</span>
          <CopyBtn value={uri} label="Copy" />
        </div>
        <div className="break-all font-mono-j text-[10px] text-cyan-j">{uri}</div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Cross-check in a terminal</span>
          <CopyBtn value={otpauthCurl} label="Copy" />
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono-j text-[10px] text-cyan-j">{otpauthCurl}</pre>
      </Panel>

      <Panel className="border-amber-500/30">
        <p className="text-[11px] text-amber-500">
          A TOTP secret is as powerful as the password it protects — anyone with it can generate valid codes forever. Use this for testing your own
          integration, never to store someone else's secret, and never paste a production secret into a shared machine.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The code is an HMAC of the current 30-second counter, which is why it changes on its own and why clock drift matters: if the phone and the
          server disagree by more than one period, valid codes get rejected. Servers usually accept the previous counter too, which is what the offset
          buttons above let you simulate.
        </p>
      </Panel>
    </ToolShell>
  );
}