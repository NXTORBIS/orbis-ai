import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Panel, Seg, Stat, ToggleRow } from './shared';

const DIRECTIVES = [
  { id: 'default-src', label: 'default-src', hint: 'The fallback for every type not listed below', example: "'self'" },
  { id: 'script-src', label: 'script-src', hint: 'Where JavaScript may load from — the directive that stops script injection', example: "'self'" },
  { id: 'style-src', label: 'style-src', hint: 'Stylesheets and inline styles', example: "'self' 'unsafe-inline'" },
  { id: 'img-src', label: 'img-src', hint: 'Images, favicons and CSS backgrounds', example: "'self' data: https:" },
  { id: 'font-src', label: 'font-src', hint: 'Web fonts', example: "'self' https://fonts.gstatic.com" },
  { id: 'connect-src', label: 'connect-src', hint: 'fetch, XHR, WebSocket and EventSource targets', example: "'self'" },
  { id: 'frame-src', label: 'frame-src', hint: 'Where iframes may be embedded from', example: "'self'" },
  { id: 'media-src', label: 'media-src', hint: 'Audio and video sources', example: "'self'" },
  { id: 'worker-src', label: 'worker-src', hint: 'Web workers and service workers', example: "'self' blob:" },
  { id: 'manifest-src', label: 'manifest-src', hint: 'The web app manifest', example: "'self'" },
  { id: 'object-src', label: 'object-src', hint: 'Flash and plugin content — should be none', example: "'none'" },
  { id: 'base-uri', label: 'base-uri', hint: 'Which <base> URLs may be injected', example: "'self'" },
  { id: 'form-action', label: 'form-action', hint: 'Where forms are allowed to submit to', example: "'self'" },
  { id: 'frame-ancestors', label: 'frame-ancestors', hint: 'Who may iframe this page — the modern X-Frame-Options', example: "'none'" },
  { id: 'upgrade-insecure-requests', label: 'upgrade-insecure-requests', hint: 'Rewrites http:// requests to https://', example: '', flag: true },
];

const PRESETS = {
  strict: { label: 'Strict', values: { 'default-src': "'self'", 'script-src': "'self'", 'style-src': "'self'", 'img-src': "'self' data:", 'font-src': "'self'", 'connect-src': "'self'", 'frame-src': "'none'", 'media-src': "'self'", 'worker-src': "'self'", 'manifest-src': "'self'", 'object-src': "'none'", 'base-uri': "'self'", 'form-action': "'self'", 'frame-ancestors': "'none'", 'upgrade-insecure-requests': '' } },
  app: { label: 'Web app', values: { 'default-src': "'self'", 'script-src': "'self'", 'style-src': "'self' 'unsafe-inline'", 'img-src': "'self' data: blob: https:", 'font-src': "'self' https://fonts.gstatic.com", 'connect-src': "'self' https://api.example.com", 'frame-src': "'self'", 'media-src': "'self' blob:", 'worker-src': "'self' blob:", 'manifest-src': "'self'", 'object-src': "'none'", 'base-uri': "'self'", 'form-action': "'self'", 'frame-ancestors': "'none'", 'upgrade-insecure-requests': '' } },
  thirdparty: { label: 'With embeds', values: { 'default-src': "'self'", 'script-src': "'self' https://cdn.jsdelivr.net https://www.youtube.com", 'style-src': "'self' 'unsafe-inline'", 'img-src': "'self' data: https:", 'font-src': "'self' https://fonts.gstatic.com", 'connect-src': "'self' https://api.example.com wss://ws.example.com", 'frame-src': "https://www.youtube.com https://player.vimeo.com", 'media-src': "'self'", 'worker-src': "'self'", 'manifest-src': "'self'", 'object-src': "'none'", 'base-uri': "'self'", 'form-action': "'self'", 'frame-ancestors': "'self'", 'upgrade-insecure-requests': '' } },
  dev: { label: 'Loose (dev)', values: { 'default-src': "'self'", 'script-src': "'self' 'unsafe-inline' 'unsafe-eval'", 'style-src': "'self' 'unsafe-inline'", 'img-src': "'self' data: blob: https:", 'font-src': "'self' data:", 'connect-src': "'self' ws://localhost:* http://localhost:*", 'frame-src': "'self'", 'media-src': "'self' blob:", 'worker-src': "'self' blob:", 'manifest-src': "'self'", 'object-src': "'none'", 'base-uri': "'self'", 'form-action': "'self'", 'frame-ancestors': "'none'", } },
};

export default function CspBuilder() {
  const [enabled, setEnabled] = useState(() => Object.fromEntries(DIRECTIVES.map((directive) => [directive.id, PRESETS.app.values[directive.id] !== undefined || directive.id === 'upgrade-insecure-requests'])));
  const [values, setValues] = useState(() => ({ ...PRESETS.app.values }));
  const [reportOnly, setReportOnly] = useState(false);

  const policy = useMemo(() => DIRECTIVES
    .filter((directive) => enabled[directive.id])
    .map((directive) => (directive.flag ? directive.id : `${directive.id} ${values[directive.id] ?? ''}`.trim()))
    .join('; '), [enabled, values]);

  const headerName = reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  const header = policy ? `${headerName}: ${policy}` : '';

  const warnings = useMemo(() => {
    const list = [];
    const script = values['script-src'] || '';
    if (script.includes("'unsafe-inline'")) list.push({ tone: 'rose', text: "script-src allows 'unsafe-inline', which permits injected inline scripts — the exact thing CSP is meant to stop. Use a nonce or hash instead." });
    if (script.includes("'unsafe-eval'")) list.push({ tone: 'amber', text: "script-src allows 'unsafe-eval' — needed by some dev tools and older libraries, but remove it in production." });
    if (values['default-src'] === '*' || Object.values(values).some((value) => value === '*')) list.push({ tone: 'rose', text: 'A wildcard (*) source allows any host. Name the actual origins you use.' });
    if (enabled['script-src'] && !script) list.push({ tone: 'amber', text: 'script-src is enabled but empty — an empty directive blocks everything it covers.' });
    if (!enabled['default-src']) list.push({ tone: 'amber', text: 'No default-src means any resource type you did not list is unrestricted by the fallback.' });
    if (!enabled['object-src']) list.push({ tone: 'amber', text: "Set object-src 'none' — plugins are legacy and are a common bypass." });
    if (!enabled['base-uri'] && !enabled['frame-ancestors']) list.push({ tone: 'amber', text: 'base-uri and frame-ancestors are missing, so injected <base> tags or framing are not restricted.' });
    if (Object.values(values).some((value) => String(value).includes('http://'))) list.push({ tone: 'amber', text: 'An http:// origin appears in the policy — a mixed-content request will be blocked by the browser anyway.' });
    return list;
  }, [values, enabled]);

  const score = useMemo(() => {
    let points = 60;
    if (enabled['default-src']) points += 8;
    if (enabled['script-src'] && !values['script-src'].includes('unsafe-inline')) points += 14;
    if (enabled['object-src']) points += 6;
    if (enabled['base-uri']) points += 5;
    if (enabled['frame-ancestors']) points += 5;
    points -= warnings.filter((warning) => warning.tone === 'rose').length * 10;
    points -= warnings.filter((warning) => warning.tone === 'amber').length * 3;
    return Math.max(0, Math.min(100, points));
  }, [enabled, values, warnings]);

  const applyPreset = (key) => {
    const preset = PRESETS[key];
    setValues(() => {
      const next = {};
      DIRECTIVES.forEach((directive) => { next[directive.id] = preset.values[directive.id] ?? ''; });
      return next;
    });
    setEnabled(Object.fromEntries(DIRECTIVES.map((directive) => [directive.id, preset.values[directive.id] !== undefined])));
  };

  const metaTag = policy ? `<meta http-equiv="${headerName}" content="${policy}" />` : '';

  const report = [header, '', ...warnings.map((warning) => `- ${warning.text}`), '', `Readiness score: ${score}/100`].join('\n');

  return (
    <ToolShell
      toolId="csp"
      icon={ShieldCheck}
      title="Content Security Policy Builder"
      desc="Build a real CSP header directive by directive, with the warnings a security review would give you — then copy the header or the meta tag."
      state={{ enabled, values, reportOnly }}
      onRestore={(restored) => {
        if (restored.enabled && typeof restored.enabled === 'object') setEnabled({ ...enabled, ...restored.enabled });
        if (restored.values && typeof restored.values === 'object') setValues({ ...values, ...restored.values });
        if (typeof restored.reportOnly === 'boolean') setReportOnly(restored.reportOnly);
      }}
      exportText={report}
      exportName="content-security-policy.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value="" onChange={applyPreset} options={Object.entries(PRESETS).map(([key, preset]) => ({ value: key, label: preset.label }))} />
        <ToggleRow label="Report-only" checked={reportOnly} onChange={setReportOnly} hint="Logs violations instead of blocking them" />
        <CopyBtn value={header} label="Copy header" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={score >= 85 ? 'emerald' : score >= 60 ? 'amber' : 'rose'}
          label="Policy strength"
          value={`${score}`}
          unit="/100"
          sub={`${Object.values(enabled).filter(Boolean).length} directives set · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Warnings</div>
          <div className="space-y-1">
            {warnings.map((warning, index) => (
              <div key={index} className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${warning.tone === 'rose' ? 'border-rose-500/40 text-rose-400' : 'border-amber-500/40 text-amber-400'}`}>
                {warning.text}
              </div>
            ))}
            {!warnings.length && <div className="rounded-lg border border-emerald-500/40 px-2.5 py-1.5 text-[11px] text-emerald-400">No warnings — this policy is tight and complete.</div>}
          </div>
        </Panel>
      </div>

      <div className="space-y-2">
        {DIRECTIVES.map((directive) => {
          const isOn = enabled[directive.id];
          return (
            <div key={directive.id} className={`rounded-xl border p-2.5 transition ${isOn ? 'border-cyan-j/40 bg-cyan-j/5' : 'border-border/70 bg-card/40'}`}>
              <div className="grid grid-cols-[auto_1fr] items-center gap-2 sm:grid-cols-[auto_11rem_1fr]">
                <button
                  type="button"
                  onClick={() => setEnabled((current) => ({ ...current, [directive.id]: !current[directive.id] }))}
                  className={`h-5 w-9 rounded-full border transition ${isOn ? 'border-cyan-j bg-cyan-j/30' : 'border-border/70 bg-muted'}`}
                  aria-label={`Toggle ${directive.id}`}
                >
                  <span className={`block h-4 w-4 rounded-full bg-foreground transition ${isOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <span className="font-mono-j text-[11px] text-cyan-j">{directive.label}</span>
                {directive.flag ? (
                  <span className="text-[11px] text-muted-foreground">{directive.hint}</span>
                ) : (
                  <input
                    value={values[directive.id] ?? ''}
                    onChange={(e) => setValues((current) => ({ ...current, [directive.id]: e.target.value }))}
                    placeholder={directive.example}
                    spellCheck={false}
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 font-mono-j text-[11px]"
                  />
                )}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground/80 sm:pl-[12.5rem]">{directive.hint}</p>
            </div>
          );
        })}
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">The header</span>
          <CopyBtn value={header} label="Copy" />
        </div>
        <pre className="whitespace-pre-wrap break-all font-mono-j text-[11px] text-cyan-j">{header || 'Enable at least one directive to build a policy.'}</pre>
        <div className="mt-3 border-t border-border/50 pt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Or as a meta tag</span>
            <CopyBtn value={metaTag} label="Copy" />
          </div>
          <pre className="whitespace-pre-wrap break-all font-mono-j text-[11px] text-muted-foreground">{metaTag || '—'}</pre>
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Directives" value={`${Object.values(enabled).filter(Boolean).length}/${DIRECTIVES.length}`} mono />
        <Stat label="Policy length" value={`${policy.length} chars`} mono />
        <Stat label="Blocking" value={reportOnly ? 'no (report only)' : 'yes'} mono />
        <Stat label="Score" value={`${score}/100`} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Deploying this without breaking the site</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Start in Report-Only, watch the console for a day, then switch to blocking — this is the only reliable way to find every origin you forgot.</p>
          <p>· The header must come from the server (or hosting config). A meta tag works for simple cases but cannot use frame-ancestors or report-uri.</p>
          <p>· 'self' means your own origin including scheme — it does not cover a CDN or a subdomain. List those explicitly.</p>
          <p>· If inline scripts are unavoidable, use a nonce per response and add 'nonce-…' to script-src rather than opening up 'unsafe-inline'.</p>
          <p>· Pair CSP with the other three basics: Strict-Transport-Security, X-Content-Type-Options: nosniff and Referrer-Policy.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Header', value: reportOnly ? 'Report-Only' : 'Blocking' },
              { label: 'Directives', value: Object.values(enabled).filter(Boolean).length },
              { label: 'Warnings', value: warnings.length },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A policy is only as good as its strictest directive, and the two that matter most are script-src and object-src. Everything starts from
          default-src, so a mistake there quietly widens every other type: setting default-src to 'self' and then listing your CDN explicitly gives you a
          policy that still blocks anything you did not plan for.
        </p>
      </Panel>
    </ToolShell>
  );
}