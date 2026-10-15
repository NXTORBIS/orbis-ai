import { useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const PRESETS = [
  { label: 'Email newsletter', source: 'newsletter', medium: 'email' },
  { label: 'Instagram bio', source: 'instagram', medium: 'social' },
  { label: 'Instagram story', source: 'instagram', medium: 'story' },
  { label: 'X / Twitter post', source: 'twitter', medium: 'social' },
  { label: 'LinkedIn post', source: 'linkedin', medium: 'social' },
  { label: 'Google Ads', source: 'google', medium: 'cpc' },
  { label: 'Meta Ads', source: 'meta', medium: 'paid_social' },
  { label: 'QR code on a poster', source: 'poster', medium: 'qr' },
  { label: 'Slack message', source: 'slack', medium: 'community' },
];

const slugify = (value) => String(value).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, '');

export default function UtmBuilder() {
  const [base, setBase] = useState('https://mark37.base44.app');
  const [source, setSource] = useState('newsletter');
  const [medium, setMedium] = useState('email');
  const [campaign, setCampaign] = useState('launch-week');
  const [term, setTerm] = useState('');
  const [content, setContent] = useState('header-button');
  const [extra, setExtra] = useState('');
  const [mode, setMode] = useState('single');

  const params = useMemo(() => {
    const built = new URLSearchParams();
    if (source) built.set('utm_source', slugify(source));
    if (medium) built.set('utm_medium', slugify(medium));
    if (campaign) built.set('utm_campaign', slugify(campaign));
    if (term) built.set('utm_term', slugify(term));
    if (content) built.set('utm_content', slugify(content));
    String(extra).split('\n').map((line) => line.trim()).filter(Boolean).forEach((line) => {
      const index = line.indexOf('=');
      if (index > 0) built.set(line.slice(0, index).trim(), slugify(line.slice(index + 1)));
    });
    return built;
  }, [source, medium, campaign, term, content, extra]);

  const clean = base.trim().replace(/[?&]+$/, '');
  const separator = clean.includes('?') ? '&' : '?';
  const url = clean && params.toString() ? `${clean}${separator}${params.toString()}` : clean;

  const allVariants = useMemo(() => PRESETS.map((preset) => {
    const variant = new URLSearchParams(params.toString());
    variant.set('utm_source', preset.source);
    variant.set('utm_medium', preset.medium);
    return { ...preset, url: clean ? `${clean}${clean.includes('?') ? '&' : '?'}${variant.toString()}` : '' };
  }), [params, clean]);

  const checks = [
    { label: 'Source', ok: Boolean(source), hint: 'Where the click came from — newsletter, instagram, google.' },
    { label: 'Medium', ok: Boolean(medium), hint: 'The channel type — email, cpc, social, qr.' },
    { label: 'Campaign', ok: Boolean(campaign), hint: 'The one campaign name, used everywhere for this push.' },
    { label: 'No spaces or capitals', ok: [source, medium, campaign, term, content].every((v) => v === slugify(v)), hint: 'Analytics tools treat “Email” and “email” as two channels.' },
    { label: 'Consistent casing', ok: true, hint: 'Lowercase snake_case is the safest common convention.' },
  ];

  const report = mode === 'single'
    ? url
    : allVariants.map((variant) => `${variant.label}\t${variant.url}`).join('\n');

  return (
    <ToolShell
      toolId="utm"
      icon={Link2}
      title="Campaign Link Builder"
      desc="Build tagged links that survive in analytics — one campaign name, correct source and medium, and every channel's variant in one click."
      state={{ base, source, medium, campaign, term, content, extra, mode }}
      onRestore={(restored) => {
        if (typeof restored.base === 'string') setBase(restored.base);
        if (typeof restored.source === 'string') setSource(restored.source);
        if (typeof restored.medium === 'string') setMedium(restored.medium);
        if (typeof restored.campaign === 'string') setCampaign(restored.campaign);
        if (typeof restored.term === 'string') setTerm(restored.term);
        if (typeof restored.content === 'string') setContent(restored.content);
        if (typeof restored.extra === 'string') setExtra(restored.extra);
        if (restored.mode) setMode(restored.mode);
      }}
      exportText={report}
      exportName="campaign-links.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={setMode} options={[{ value: 'single', label: 'One link' }, { value: 'variants', label: 'All channels' }]} />
        <CopyBtn value={mode === 'single' ? url : report} label={mode === 'single' ? 'Copy link' : 'Copy all'} />
        <a
          href={url || '#'}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
        >
          Test the link
        </a>
      </div>

      <Field label="Destination URL" hint="No existing query string? This adds one cleanly either way">
        <input value={base} onChange={(e) => setBase(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="utm_source" hint="newsletter, instagram, google">
          <input value={source} onChange={(e) => setSource(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="utm_medium" hint="email, social, cpc, qr">
          <input value={medium} onChange={(e) => setMedium(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="utm_campaign" hint="launch-week, black-friday">
          <input value={campaign} onChange={(e) => setCampaign(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="utm_content" hint="Which link or button was clicked">
          <input value={content} onChange={(e) => setContent(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="utm_term" hint="Paid keywords — leave blank for organic">
          <input value={term} onChange={(e) => setTerm(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Extra parameters" hint="One key=value per line">
          <textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={2}
            placeholder="ref=partner\nutm_id=42"
            className="w-full resize-y rounded-md border border-input bg-transparent p-2.5 font-mono-j text-xs"
          />
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Your tagged link</span>
          <CopyBtn value={url} label="Copy" />
        </div>
        <div className="break-all font-mono-j text-[11px] text-cyan-j">{url}</div>
      </Panel>

      {mode === 'variants' && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The same campaign, every channel</div>
          <div className="space-y-1.5">
            {allVariants.map((variant) => (
              <div key={variant.label} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium">{variant.label}</span>
                  <span className="font-mono-j text-[10px] text-muted-foreground">{variant.source} / {variant.medium}</span>
                  <CopyBtn value={variant.url} label="Copy" />
                </div>
                <div className="mt-1 break-all font-mono-j text-[10px] text-cyan-j">{variant.url}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Before you send it</div>
        <div className="space-y-1">
          {checks.map((check) => (
            <div key={check.label} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${check.ok ? 'border-cyan-j/40 bg-cyan-j/5 text-cyan-j' : 'border-amber-500/40 bg-amber-500/5 text-amber-500'}`}>
              <span className="font-mono-j">{check.ok ? 'ok' : 'check'}</span>
              <span className="flex-1">{check.label}</span>
              <span className="hidden text-muted-foreground sm:block">{check.hint}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Parameters" value={String([...params.keys()].length)} mono />
        <Stat label="Link length" value={`${url.length} chars`} mono />
        <Stat label="Variants ready" value={String(allVariants.length)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Analytics tools split a report every time the same channel is spelled two ways, so decide the vocabulary once — lowercase, underscores
          between words, and one campaign name used across every channel. Keep utm_term for paid search keywords and use utm_content to tell two
          links in the same email apart.
        </p>
      </Panel>
    </ToolShell>
  );
}