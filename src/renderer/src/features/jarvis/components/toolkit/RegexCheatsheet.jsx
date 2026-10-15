import { useMemo, useState } from 'react';
import { Regex } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Area, Panel, Stat, CopyBtn, Seg } from './shared';
import ToolShell from './kit/ToolShell';

const PATTERNS = [
  { group: 'Contact', name: 'Email address', pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', flags: 'g', desc: 'Everyday email match — good enough for forms, not for RFC purity.' },
  { group: 'Contact', name: 'Phone (international)', pattern: '\\+?[0-9]{1,3}[\\s.-]?\\(?[0-9]{2,4}\\)?[\\s.-]?[0-9]{3,4}[\\s.-]?[0-9]{3,4}', flags: 'g', desc: 'Loose international number with optional country code.' },
  { group: 'Web', name: 'URL', pattern: 'https?:\\/\\/[^\\s/$.?#].[^\\s]*', flags: 'gi', desc: 'http or https links, stopping at whitespace.' },
  { group: 'Web', name: 'Domain name', pattern: '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}', flags: 'gi', desc: 'Hostname with valid label rules.' },
  { group: 'Web', name: 'HTML tag', pattern: '<\\/?([a-z][a-z0-9]*)\\b[^>]*>', flags: 'gi', desc: 'Opening or closing tags, with the tag name captured.' },
  { group: 'Web', name: 'Markdown link', pattern: '\\[([^\\]]+)\\]\\(([^)\\s]+)\\)', flags: 'g', desc: 'Captures the label and the target separately.' },
  { group: 'Dates', name: 'Date (YYYY-MM-DD)', pattern: '\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])', flags: 'g', desc: 'ISO date with month and day range checks.' },
  { group: 'Dates', name: 'Time (24 hour)', pattern: '(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?', flags: 'g', desc: 'HH:MM with optional seconds.' },
  { group: 'Dates', name: 'ISO timestamp', pattern: '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})', flags: 'g', desc: 'Matches what an API returns for created_at.' },
  { group: 'Numbers', name: 'Integer', pattern: '(?<!\\d)[+-]?\\d+(?!\\d)', flags: 'g', desc: 'Whole numbers, ignoring the digits that sit inside decimals.' },
  { group: 'Numbers', name: 'Decimal number', pattern: '[+-]?(?:\\d+\\.\\d+|\\d+)', flags: 'g', desc: 'Accepts 12 and 12.75 alike.' },
  { group: 'Numbers', name: 'Thousands separator', pattern: '\\d{1,3}(?:,\\d{3})+', flags: 'g', desc: '1,250 or 24,000,000.' },
  { group: 'Numbers', name: 'Percentage', pattern: '\\d+(?:\\.\\d+)?\\s?%', flags: 'g', desc: 'Number followed by a percent sign.' },
  { group: 'Network', name: 'IPv4 address', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: 'g', desc: 'Fast match — pair it with a range check for strict validation.' },
  { group: 'Network', name: 'MAC address', pattern: '(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}', flags: 'g', desc: 'Colon or dash separated hardware address.' },
  { group: 'Identifiers', name: 'UUID v4', pattern: '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', flags: 'gi', desc: 'Version 4 UUID with the correct variant nibble.' },
  { group: 'Identifiers', name: 'Hex colour', pattern: '#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\\b', flags: 'gi', desc: '3, 6 or 8 digit hex colour.' },
  { group: 'Identifiers', name: 'Base64 blob', pattern: '(?:[A-Za-z0-9+/]{4}){2,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?', flags: 'g', desc: 'At least three quad groups of base64 data.' },
  { group: 'Identifiers', name: 'JWT', pattern: 'eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+', flags: 'g', desc: 'Three base64url segments starting with a JSON header.' },
  { group: 'Identifiers', name: 'Semantic version', pattern: '\\b\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z-.]+)?(?:\\+[0-9A-Za-z-.]+)?\\b', flags: 'g', desc: 'Version with optional pre-release and build metadata.' },
  { group: 'Code', name: 'Slug', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', flags: '', desc: 'Lowercase words joined by single dashes — anchors the whole string.' },
  { group: 'Code', name: 'Trailing whitespace', pattern: '[ \\t]+$', flags: 'gm', desc: 'Spaces and tabs at the end of every line.' },
  { group: 'Code', name: 'Blank lines', pattern: '^\\s*$\\n', flags: 'gm', desc: 'Empty or whitespace-only lines.' },
  { group: 'Code', name: 'Duplicate words', pattern: '\\b(\\w+)\\s+\\1\\b', flags: 'gi', desc: 'Catches "the the" style repeats with a back-reference.' },
  { group: 'Content', name: 'Hashtag', pattern: '#[A-Za-z0-9_]+', flags: 'g', desc: 'Hashtag with letters, digits and underscores.' },
  { group: 'Content', name: 'Mention', pattern: '@[A-Za-z0-9_]{2,}', flags: 'g', desc: 'Social handle mention.' },
  { group: 'Content', name: 'Password rules', pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^\\w\\s]).{12,}$', flags: '', desc: 'Twelve characters with all four character classes — lookaheads check each.' },
];

const SAMPLE_TEXT = 'Contact ada@example.com or +44 20 7946 0958 before 2026-12-31T18:30:00Z. Docs live at https://example.com/guide#setup — the order 1,250 items cost 19.99 (18%) and the id was 8f14e45f-ceea-467a-9b0f-3d3f0b1c2a44. Seen on api.example.com and the the report colour #22d3ee.';

export default function RegexCheatsheet() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [selected, setSelected] = useState(PATTERNS[0]);
  const [sample, setSample] = useState(SAMPLE_TEXT);

  const groups = useMemo(() => ['all', ...new Set(PATTERNS.map((p) => p.group))], []);
  const filtered = useMemo(() => PATTERNS.filter((p) => {
    const matchesGroup = group === 'all' || p.group === group;
    const haystack = `${p.name} ${p.pattern} ${p.desc}`.toLowerCase();
    return matchesGroup && haystack.includes(query.toLowerCase());
  }), [query, group]);

  const matches = useMemo(() => {
    try {
      const re = new RegExp(selected.pattern, selected.flags.includes('g') ? selected.flags : `${selected.flags}g`);
      return [...sample.matchAll(re)].map((m) => m[0]);
    } catch {
      return [];
    }
  }, [selected, sample]);

  const segments = useMemo(() => {
    if (!matches.length) return [{ text: sample, hit: false }];
    const out = [];
    let cursor = 0;
    matches.forEach((hit) => {
      const index = sample.indexOf(hit, cursor);
      if (index === -1) return;
      if (index > cursor) out.push({ text: sample.slice(cursor, index), hit: false });
      out.push({ text: hit, hit: true });
      cursor = index + hit.length;
    });
    if (cursor < sample.length) out.push({ text: sample.slice(cursor), hit: false });
    return out;
  }, [matches, sample]);

  return (
    <ToolShell
      toolId="regex-cheatsheet"
      icon={Regex}
      title="Regex Cheat Sheet"
      desc="Twenty-seven patterns you can copy straight into code, each testable against your own text."
      state={{ query, group, selected, sample }}
      onRestore={(saved) => { setQuery(saved.query); setGroup(saved.group); setSelected(saved.selected || PATTERNS[0]); setSample(saved.sample); }}
      exportText={JSON.stringify(matches, null, 2)}
      exportName="matches.json"
      exportMime="application/json"
    >
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patterns — email, url, uuid…" className="h-9" />
      <Seg value={group} onChange={setGroup} options={groups.map((g) => ({ value: g, label: g }))} />
      <div className="max-h-80 space-y-2 overflow-auto pr-1 scrollbar-thin">
        {filtered.map((p) => {
          const active = p.pattern === selected.pattern;
          return (
            <button
              key={p.name}
              onClick={() => setSelected(p)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${active ? 'border-cyan-j/60 bg-cyan-j/5' : 'border-border/70 hover:border-cyan-j/40'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.group}</span>
              </div>
              <div className="mt-1 break-all font-mono-j text-[11px] text-cyan-j">/{p.pattern}/{p.flags}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{p.desc}</div>
            </button>
          );
        })}
        {!filtered.length && <p className="py-4 text-center text-sm text-muted-foreground">No pattern matches that search.</p>}
      </div>
      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Test “{selected.name}”</span>
          <CopyBtn value={`/${selected.pattern}/${selected.flags}`} label="Copy pattern" />
        </div>
        <Area value={sample} onChange={setSample} rows={4} mono />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat label="Matches" value={String(matches.length)} />
          <Stat label="Flags" value={selected.flags || '(none)'} mono />
          <Stat label="First match" value={matches[0] ? matches[0].slice(0, 24) : '—'} mono />
        </div>
        <div className="mt-3 rounded-lg border border-border/70 bg-background/60 p-3 text-xs leading-relaxed">
          {segments.map((s, i) => (s.hit
            ? <mark key={i} className="rounded bg-cyan-j/25 px-0.5 text-cyan-j">{s.text}</mark>
            : <span key={i}>{s.text}</span>))}
        </div>
      </Panel>
    </ToolShell>
  );
}