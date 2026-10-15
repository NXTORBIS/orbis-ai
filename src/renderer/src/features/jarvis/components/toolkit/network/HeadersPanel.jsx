import { useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Hero, Pills } from '../kit/premium';
import { base44 } from '@jarvis/api/base44Client';
import { Field, Panel, Stat } from '../shared';
import { urlOf } from './netUtils';

const CHECKS = [
  {
    label: 'Content-Security-Policy',
    weight: 25,
    note: 'The one control that stops an injected script running.',
    test: (h) => (h['content-security-policy'] ? 'pass' : 'fail'),
    value: (h) => h['content-security-policy'] || '',
  },
  {
    label: 'Strict-Transport-Security',
    weight: 20,
    note: 'Forces HTTPS on every return visit rather than trusting a redirect.',
    test: (h) => (h['strict-transport-security'] ? (/preload/i.test(h['strict-transport-security']) ? 'pass' : 'partial') : 'fail'),
    value: (h) => h['strict-transport-security'] || '',
  },
  {
    label: 'Clickjacking protection',
    weight: 15,
    note: 'X-Frame-Options, or frame-ancestors inside a CSP — either works.',
    test: (h) => (h['x-frame-options'] || /frame-ancestors/i.test(h['content-security-policy'] || '') ? 'pass' : 'fail'),
    value: (h) => h['x-frame-options'] || (h['content-security-policy'] || '').match(/frame-ancestors[^;]*/i)?.[0] || '',
  },
  {
    label: 'X-Content-Type-Options',
    weight: 10,
    note: 'Stops the browser guessing a file is a script when it is not.',
    test: (h) => (/nosniff/i.test(h['x-content-type-options'] || '') ? 'pass' : 'fail'),
    value: (h) => h['x-content-type-options'] || '',
  },
  {
    label: 'Referrer-Policy',
    weight: 10,
    note: 'Controls how much of your URL leaks to the next site.',
    test: (h) => (h['referrer-policy'] ? (/unsafe-url/i.test(h['referrer-policy']) ? 'partial' : 'pass') : 'fail'),
    value: (h) => h['referrer-policy'] || '',
  },
  {
    label: 'Permissions-Policy',
    weight: 10,
    note: 'Which browser features the page is allowed to ask for.',
    test: (h) => (h['permissions-policy'] ? 'pass' : 'fail'),
    value: (h) => h['permissions-policy'] || '',
  },
  {
    label: 'COOP / COEP isolation',
    weight: 10,
    note: 'Cross-origin isolation; needed for high-resolution timers and shared memory.',
    test: (h) => (h['cross-origin-opener-policy'] || h['cross-origin-embedder-policy'] ? 'pass' : 'fail'),
    value: (h) => [h['cross-origin-opener-policy'], h['cross-origin-embedder-policy']].filter(Boolean).join(' · '),
  },
];

const gradeOf = (score) => (score >= 90 ? { grade: 'A', tone: 'emerald' } : score >= 75 ? { grade: 'B', tone: 'cyan' } : score >= 60 ? { grade: 'C', tone: 'amber' } : score >= 45 ? { grade: 'D', tone: 'rose' } : { grade: 'F', tone: 'rose' });

const TONE_TEXT = { pass: 'text-emerald-400', partial: 'text-amber-400', fail: 'text-rose-400' };

export default function HeadersPanel({ target, onReport }) {
  const [url, setUrl] = useState(urlOf(target));
  const [result, setResult] = useState(null);
  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    setChain(null);
    try {
      const [headers, redirects] = await Promise.all([
        base44.functions.invoke('netCheck', { action: 'headers', url: url.trim() }),
        base44.functions.invoke('netCheck', { action: 'redirects', url: url.trim() }),
      ]);
      if (headers.data?.error) throw new Error(headers.data.error);
      setResult(headers.data);
      setChain(redirects.data?.hops || []);
      const checks = CHECKS.map((check) => ({ ...check, state: check.test(headers.data.headers) }));
      const score = checks.reduce((sum, check) => sum + (check.state === 'pass' ? check.weight : check.state === 'partial' ? check.weight / 2 : 0), 0);
      const graded = gradeOf(Math.round(score));
      onReport?.(
        `Security headers ${url}\nGrade ${graded.grade} (${Math.round(score)}/100) · HTTP ${headers.data.status}\n${checks.map((c) => `${c.state === 'pass' ? '✓' : c.state === 'partial' ? '~' : '✗'} ${c.label}${c.state === 'pass' ? '' : ` — missing or weak`}`).join('\n')}\n${(redirects.data?.hops || []).length} hop(s) to the final page`,
      );
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const checks = result ? CHECKS.map((check) => ({ ...check, state: check.test(result.headers) })) : [];
  const score = Math.round(checks.reduce((sum, check) => sum + (check.state === 'pass' ? check.weight : check.state === 'partial' ? check.weight / 2 : 0), 0));
  const graded = gradeOf(score);
  const headerEntries = result ? Object.entries(result.headers).sort((a, b) => a[0].localeCompare(b[0])) : [];

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="URL or host">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            spellCheck={false}
            className="h-9 w-72 rounded-md border border-input bg-transparent px-3 font-mono-j text-xs"
          />
        </Field>
        <button
          type="button"
          onClick={run}
          disabled={loading || !url.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          <ShieldCheck className="h-3.5 w-3.5" /> {loading ? 'Fetching…' : 'Grade this site'}
        </button>
      </div>

      {error && <Panel className="border-amber-500/30 text-[11px] text-amber-500">{error}</Panel>}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr]">
            <Hero tone={graded.tone} label={`Grade ${graded.grade}`} value={score} unit="/100" sub={`HTTP ${result.status} from ${result.finalUrl}`} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Status" value={String(result.status)} mono />
              <Stat label="Fetch time" value={`${result.ms} ms`} mono />
              <Stat label="Header count" value={String(headerEntries.length)} mono />
              <Stat label="Server" value={result.headers['server'] || 'hidden'} />
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Every control, and what is actually sent</div>
            <div className="space-y-1">
              {checks.map((check) => (
                <div key={check.label} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[11px] font-medium ${TONE_TEXT[check.state]}`}>
                      {check.state === 'pass' ? '✓' : check.state === 'partial' ? '~' : '✗'} {check.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{check.weight} pts</span>
                  </div>
                  {check.value(result.headers) && (
                    <div className="mt-1 break-all font-mono-j text-[10px] text-cyan-j">{check.value(result.headers)}</div>
                  )}
                  {check.state !== 'pass' && <div className="mt-1 text-[11px] text-muted-foreground">{check.note}</div>}
                </div>
              ))}
            </div>
          </Panel>

          {!!chain.length && (
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Redirect chain — {chain.length} hop{chain.length > 1 ? 's' : ''} before the page arrives</div>
              <div className="space-y-1">
                {chain.map((hop, index) => (
                  <div key={`${hop.url}-${index}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                    <span className="font-mono-j text-[10px] text-muted-foreground">{index + 1}</span>
                    <span className={`font-mono-j text-[10px] ${hop.status >= 400 ? 'text-rose-400' : hop.status >= 300 ? 'text-amber-400' : 'text-emerald-400'}`}>{hop.status}</span>
                    <span className="min-w-0 flex-1 truncate font-mono-j text-[10px]">{hop.url}</span>
                    <span className="font-mono-j text-[10px] text-muted-foreground">{hop.ms} ms</span>
                    {hop.location && <ArrowRight className="h-3 w-3 text-cyan-j" />}
                  </div>
                ))}
              </div>
              <Pills
                items={[
                  { label: 'total time', value: `${chain.reduce((sum, hop) => sum + hop.ms, 0)} ms` },
                  { label: 'hops', value: chain.length, tone: chain.length > 2 ? 'amber' : undefined },
                ]}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Two or three hops are normal — http to https, apex to www. More than three, or a loop, is something to fix.
              </p>
            </Panel>
          )}

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">All response headers</div>
            <div className="max-h-72 space-y-1 overflow-auto">
              {headerEntries.map(([name, value]) => (
                <div key={name} className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="w-44 shrink-0 truncate font-mono-j text-[10px] text-cyan-j">{name}</span>
                  <span className="min-w-0 flex-1 break-all font-mono-j text-[10px] text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The request is made by our server rather than your browser, which is the only way to read another site's headers at all — cross-origin
          rules hide them from any page. Grading follows the same weighting the public header scanners use: a missing CSP or HSTS costs the most,
          and a header that is present but weak (HSTS without preload, a referrer policy of unsafe-url) only earns half.
        </p>
      </Panel>
    </>
  );
}