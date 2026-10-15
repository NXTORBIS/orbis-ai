import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck, XCircle } from 'lucide-react';
import { base44 } from '@jarvis/api/base44Client';
import ToolShell from './kit/ToolShell';
import { Hero } from './kit/premium';
import { Field, Panel, Seg, Stat } from './shared';

/**
 * Identify an API key from its shape, check that nothing was lost in the copy,
 * and — for the providers below — ask the provider itself whether the key works.
 */

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', pattern: /^sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}$/, min: 40, check: true },
  { id: 'anthropic', label: 'Anthropic', pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/, min: 40, check: true },
  { id: 'openrouter', label: 'OpenRouter', pattern: /^sk-or-v1-[a-f0-9]{40,}$/, min: 55, check: true },
  { id: 'groq', label: 'Groq', pattern: /^gsk_[A-Za-z0-9]{40,}$/, min: 50, check: true },
  { id: 'github', label: 'GitHub', pattern: /^(gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})$/, min: 40, check: true },
  { id: 'gitlab', label: 'GitLab', pattern: /^glpat-[A-Za-z0-9_-]{20,}$/, min: 25, check: true },
  { id: 'stripe-secret', label: 'Stripe secret key', pattern: /^sk_(live|test)_[A-Za-z0-9]{20,}$/, min: 30, check: true, as: 'stripe' },
  { id: 'stripe-publishable', label: 'Stripe publishable key', pattern: /^pk_(live|test)_[A-Za-z0-9]{20,}$/, min: 30, check: false, note: 'Publishable keys are meant to be public and are not checked live.' },
  { id: 'slack', label: 'Slack token', pattern: /^xox[baprs]-[A-Za-z0-9-]{10,}$/, min: 20, check: true },
  { id: 'notion', label: 'Notion', pattern: /^(secret_|ntn_)[A-Za-z0-9]{30,}$/, min: 40, check: true },
  { id: 'sendgrid', label: 'SendGrid', pattern: /^SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/, min: 60, check: true },
  { id: 'npm', label: 'npm', pattern: /^npm_[A-Za-z0-9]{30,}$/, min: 40, check: true },
  { id: 'huggingface', label: 'Hugging Face', pattern: /^hf_[A-Za-z0-9]{30,}$/, min: 35, check: true },
  { id: 'google', label: 'Google API key', pattern: /^AIza[0-9A-Za-z_-]{35}$/, min: 39, check: true },
  { id: 'telegram', label: 'Telegram bot token', pattern: /^\d{8,10}:[A-Za-z0-9_-]{35}$/, min: 45, check: true },
  { id: 'aws', label: 'AWS access key id', pattern: /^(AKIA|ASIA)[0-9A-Z]{16}$/, min: 20, check: false, note: 'AWS keys must be signed with the matching secret, so they cannot be checked from here.' },
  { id: 'jwt', label: 'JSON Web Token', pattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/, min: 40, check: false, note: 'Use the JWT Builder & Verifier tool to sign and verify this locally.' },
];

const PLACEHOLDER = /(your|my|xxx|placeholder|example|sample|changeme|dummy|abc123|test123|todo|secrethere)/i;

const poolSize = (key) => {
  let size = 0;
  if (/[a-z]/.test(key)) size += 26;
  if (/[A-Z]/.test(key)) size += 26;
  if (/\d/.test(key)) size += 10;
  if (/[^A-Za-z0-9]/.test(key)) size += 33;
  return size || 1;
};

const mask = (key) => (key.length <= 10 ? `${key.slice(0, 2)}••••` : `${key.slice(0, 6)}••••••••${key.slice(-4)}`);

const fingerprint = async (key) => {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
};

const TONE = { valid: 'emerald', invalid: 'rose', restricted: 'amber', throttled: 'amber', error: 'rose' };

export default function ApiKeyTester() {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [choice, setChoice] = useState('auto');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [id, setId] = useState('');

  const trimmed = key.trim();
  const detected = useMemo(() => PROVIDERS.find((p) => p.pattern.test(trimmed)) || null, [trimmed]);
  const provider = choice === 'auto' ? detected : PROVIDERS.find((p) => p.id === choice) || null;

  useEffect(() => {
    let live = true;
    if (!trimmed) { setId(''); return () => { live = false; }; }
    fingerprint(trimmed).then((value) => { if (live) setId(value); });
    return () => { live = false; };
  }, [trimmed]);

  const checks = useMemo(() => {
    if (!trimmed) return [];
    const bits = Math.round(trimmed.length * Math.log2(poolSize(trimmed)));
    const target = provider;
    return [
      { label: 'No spaces or line breaks', ok: !/\s/.test(key), note: 'A trailing newline is the most common reason a working key fails.' },
      { label: 'No surrounding quotes', ok: !/^["'`]|["'`]$/.test(trimmed), note: 'Remove the quotation marks around the key.' },
      { label: 'No "Bearer" prefix included', ok: !/^bearer\s/i.test(trimmed), note: 'Add Bearer in your code, not to the key itself.' },
      { label: 'Recognised key format', ok: !!target, note: target ? `Looks like a ${target.label} key.` : 'No known pattern matched — either it is from a service not listed here, or part of it was lost in the copy.' },
      { label: 'Not a placeholder', ok: !PLACEHOLDER.test(trimmed), note: 'This reads like the sample value from documentation rather than a real key.' },
      {
        label: 'Length looks complete',
        ok: !target || trimmed.length >= target.min,
        note: target && trimmed.length < target.min
          ? `A ${target.label} key is usually at least ${target.min} characters; this one is ${trimmed.length}.`
          : `${trimmed.length} characters.`,
      },
      { label: 'Enough randomness to be a real secret', ok: bits >= 80, note: `About ${bits} bits of entropy. Below 80 usually means the key was shortened.` },
    ];
  }, [trimmed, key, provider]);

  const failed = checks.filter((c) => !c.ok).length;

  const run = async () => {
    if (!provider?.check) return;
    setChecking(true);
    setError('');
    setResult(null);
    try {
      const response = await base44.functions.invoke('apiKeyCheck', { provider: provider.as || provider.id, key: trimmed });
      setResult(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'The check could not run.');
    } finally {
      setChecking(false);
    }
  };

  const report = [
    'API key check',
    `Detected: ${detected ? detected.label : 'not recognised'}`,
    `Fingerprint: ${id || '—'}`,
    `Looks like: ${mask(trimmed) || '—'}`,
    `Offline checks: ${checks.length ? `${checks.length - failed} of ${checks.length} passed` : 'none'}`,
    ...checks.filter((c) => !c.ok).map((c) => `- ${c.label}: ${c.note}`),
    result ? `Live check (${result.provider}): ${result.verdict} — HTTP ${result.status} in ${result.ms}ms${result.detail ? ` — ${result.detail}` : ''}` : 'Live check: not run',
  ].join('\n');

  return (
    <ToolShell
      toolId="api-key-tester"
      icon={KeyRound}
      title="API Key Tester & Validator"
      desc="Paste a key to see which service issued it, whether the copy is complete, and — for the providers listed — whether it actually works right now."
      state={{ key, choice }}
      onRestore={(restored) => {
        if (typeof restored.key === 'string') setKey(restored.key);
        if (typeof restored.choice === 'string') setChoice(restored.choice);
      }}
      exportText={report}
      exportName="api-key-report.txt"
    >
      <Field
        label="API key"
        hint="Straight from the provider's dashboard. It is used here only to ask that provider about it."
      >
        <div className="flex gap-2">
          <input
            type={show ? 'text' : 'password'}
            value={key}
            onChange={(e) => { setKey(e.target.value); setResult(null); }}
            spellCheck={false}
            autoComplete="off"
            placeholder="sk-… / ghp_… / AIza… / xoxb-…"
            className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 font-mono-j text-xs"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card/60 px-3 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground"
          >
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {show ? 'Hide' : 'Show'}
          </button>
        </div>
      </Field>

      <Field label="Service">
        <Seg
          value={choice}
          onChange={setChoice}
          options={[{ value: 'auto', label: detected ? `Auto — ${detected.label}` : 'Auto-detect' }, ...PROVIDERS.map((p) => ({ value: p.id, label: p.label }))]}
        />
      </Field>

      {!!trimmed && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Hero
              tone={failed === 0 ? 'emerald' : failed === 1 ? 'amber' : 'rose'}
              label={detected ? detected.label : 'Unrecognised'}
              value={`${checks.length - failed}/${checks.length}`}
              sub={failed === 0 ? 'Every offline check passed' : `${failed} thing${failed > 1 ? 's' : ''} to fix before testing`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Length" value={`${trimmed.length} chars`} mono />
              <Stat label="Looks like" value={mask(trimmed)} mono />
              <Stat label="Environment" value={/_live_/.test(trimmed) ? 'live' : /_test_/.test(trimmed) ? 'test / sandbox' : 'not stated'} />
              <Stat label="Fingerprint" value={id || '…'} mono />
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Offline checks — nothing has left your device</div>
            <div className="space-y-1">
              {checks.map((check) => (
                <div key={check.label} className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  {check.ok
                    ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />}
                  <span className="text-[11px] font-medium">{check.label}</span>
                  <span className="min-w-0 flex-1 text-right text-[11px] text-muted-foreground">{check.note}</span>
                </div>
              ))}
            </div>
            {id && <div className="mt-2 text-[10px] text-muted-foreground/70">Fingerprint {id} identifies this exact key later without storing it — compare the first four characters of a SHA-256.</div>}
          </Panel>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={!provider?.check || !trimmed || checking}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          <ShieldCheck className="h-3.5 w-3.5" /> {checking ? 'Asking the provider…' : 'Check it live'}
        </button>
        <span className="text-[11px] text-muted-foreground">
          {provider?.check
            ? `Sent only to ${provider.label}'s own API — 14 providers can be checked.`
            : provider?.note || 'Pick a service to see whether it can be checked live.'}
        </span>
      </div>

      {error && <Panel className="border-rose-500/40 text-[11px] text-rose-400">{error}</Panel>}

      {result && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr]">
            <Hero
              tone={TONE[result.verdict] || 'cyan'}
              label={result.verdict === 'valid' ? 'Key accepted' : result.verdict === 'invalid' ? 'Key rejected' : result.verdict === 'restricted' ? 'Valid but limited' : result.verdict === 'throttled' ? 'Rate limited' : 'No clean answer'}
              value={`HTTP ${result.status}`}
              sub={`${result.provider} · ${result.ms} ms`}
            />
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">What happened</div>
              <p className="text-[11px] text-muted-foreground">{result.hint}</p>
              {result.detail && <p className="mt-2 font-mono-j text-[10px] text-amber-500">{result.detail}</p>}
              <p className="mt-2 font-mono-j text-[10px] text-muted-foreground/70">GET {result.endpoint}</p>
            </Panel>
          </div>
        </div>
      )}

      <Panel>
        <div className="mb-2 text-xs font-medium">Reading the answer</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ['Valid', 'The provider accepted the key and gave a normal answer.'],
            ['Invalid', 'The provider itself rejected it — wrong, revoked, expired or copied short.'],
            ['Restricted', 'The key exists but lacks permission for the endpoint used. Common with restricted Stripe and SendGrid keys.'],
            ['Throttled', 'Rate limited, which usually means the key is real and being accepted.'],
            ['No clean answer', 'A network, DNS or provider outage. The key may still be fine.'],
            ['Not checkable', 'Publishable keys, AWS ids and JWTs cannot be verified without their counterpart — those stay offline checks only.'],
          ].map(([title, text]) => (
            <div key={title} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
              <div className="text-[11px] font-medium text-cyan-j">{title}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{text}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="border-amber-500/30">
        <p className="text-[11px] text-amber-500">
          A live check means a real request to the provider, so it can appear in their logs and, on metered services, count as a call — these checks only
          read metadata and never generate content. Anything you paste stays on this page except for the one request you trigger. Treat any key you have
          pasted on a shared or borrowed computer as exposed and rotate it afterwards.
        </p>
      </Panel>
    </ToolShell>
  );
}