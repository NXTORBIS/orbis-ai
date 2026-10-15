import { useMemo, useState } from 'react';
import { Type } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Panel, Stat } from './shared';

const LIMITS = [
  { id: 'x', label: 'X / Twitter post', limit: 280, note: 'Links count as 23 characters' },
  { id: 'linkedin', label: 'LinkedIn post', limit: 3000, note: 'Only the first 210 characters show before “see more”' },
  { id: 'linkedin-headline', label: 'LinkedIn headline', limit: 220 },
  { id: 'instagram', label: 'Instagram caption', limit: 2200, note: 'First 125 characters show in the feed' },
  { id: 'instagram-bio', label: 'Instagram bio', limit: 150 },
  { id: 'youtube-title', label: 'YouTube title', limit: 100, note: 'Around 60 characters before truncation' },
  { id: 'youtube-desc', label: 'YouTube description', limit: 5000 },
  { id: 'seo-title', label: 'SEO page title', limit: 60 },
  { id: 'meta', label: 'Meta description', limit: 155 },
  { id: 'email-subject', label: 'Email subject', limit: 78, note: 'Under 50 reads best on a phone' },
  { id: 'tiktok', label: 'TikTok caption', limit: 2200 },
  { id: 'pinterest', label: 'Pinterest description', limit: 500 },
  { id: 'facebook', label: 'Facebook post', limit: 5000 },
  { id: 'whatsapp', label: 'WhatsApp status', limit: 700 },
];

const SAMPLE = 'We just shipped the new toolkit: 220+ utilities that run entirely in your browser — no upload, no sign-in, no tracking. Which one would you use first?';

export default function SocialLimits() {
  const [text, setText] = useState(SAMPLE);
  const [selected, setSelected] = useState(['x', 'linkedin', 'seo-title', 'meta']);

  const counts = useMemo(() => {
    const urlCount = (text.match(/https?:\/\/\S+/g) || []).length;
    const xLength = text.replace(/https?:\/\/\S+/g, '_______________________').length;
    const smsSegments = Math.max(1, Math.ceil(text.length / 160));
    return { characters: text.length, charactersNoSpaces: text.replace(/\s/g, '').length, words: (text.trim().match(/\S+/g) || []).length, lines: text ? text.split('\n').length : 0, urlCount, xLength, smsSegments };
  }, [text]);

  const rows = LIMITS.map((limit) => {
    const used = limit.id === 'x' ? counts.xLength : text.length;
    return { ...limit, used, remaining: limit.limit - used, percent: Math.min(100, (used / limit.limit) * 100) };
  });

  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const report = rows.map((row) => `${row.label}: ${row.used} / ${row.limit} ${row.remaining >= 0 ? `(${row.remaining} left)` : `(over by ${-row.remaining})`}`).join('\n');

  return (
    <ToolShell
      toolId="social-limits"
      icon={Type}
      title="Post Length Checker"
      desc="Write once and see how it fits every platform at once — with the truncation points that actually matter called out."
    >
      <Field label="Your text">
        <Area value={text} onChange={setText} rows={7} placeholder="Paste a post, a title or a meta description…" />
      </Field>

      <div className="grid grid-cols-4 gap-2">
        <Stat label="Characters" value={String(counts.characters)} mono />
        <Stat label="Words" value={String(counts.words)} mono />
        <Stat label="Lines" value={String(counts.lines)} mono />
        <Stat label="SMS segments" value={String(counts.smsSegments)} mono sub={counts.smsSegments > 1 ? `${counts.smsSegments} texts` : 'one text'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Highlighted platforms</div>
        <div className="flex flex-wrap gap-1.5">
          {LIMITS.map((limit) => (
            <button
              key={limit.id}
              type="button"
              onClick={() => toggle(limit.id)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${selected.includes(limit.id) ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'}`}
            >
              {limit.label}
            </button>
          ))}
        </div>
      </Panel>

      <div className="space-y-2">
        {rows.filter((row) => selected.includes(row.id)).map((row) => {
          const over = row.remaining < 0;
          const tight = !over && row.percent > 85;
          return (
            <div key={row.id} className={`tk-card tk-depth rounded-xl border p-3 ${over ? 'border-red-500/50' : tight ? 'border-amber-500/40' : 'border-border/70'} bg-gradient-to-b from-card/75 to-card/40`}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium">{row.label}</span>
                <span className={`font-mono-j text-xs ${over ? 'text-red-400' : tight ? 'text-amber-400' : 'text-cyan-j'}`}>
                  {row.used} / {row.limit}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card/70">
                <div className={`h-full rounded-full ${over ? 'bg-red-500' : tight ? 'bg-amber-400' : 'bg-cyan-j'}`} style={{ width: `${row.percent}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{over ? `Over by ${-row.remaining} characters` : `${row.remaining} characters left`}</span>
                {row.note && <span>{row.note}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={report} label="Copy all counts" />
        <CopyBtn value={text.slice(0, 280)} label="Copy first 280" />
        <span className="text-[11px] text-muted-foreground">{counts.urlCount ? `${counts.urlCount} link${counts.urlCount === 1 ? '' : 's'} counted as 23 characters on X` : 'No links detected'}</span>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Limits move over time, and platforms trim text at different points than their maximum — the note on each row is the number that decides
          whether your hook survives the feed. Emoji count as more than one character on some platforms, so leave a little headroom when you use them.
        </p>
      </Panel>
    </ToolShell>
  );
}