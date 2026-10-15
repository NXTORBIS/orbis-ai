import { useMemo, useState } from 'react';
import { Eraser } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Panel, Seg, Stat, ToggleRow } from './shared';

const SAMPLE = `Ticket 48213 — customer reports the invoice never arrived.
Contact: priya.nair@example.com, backup desk +1 (415) 555-0182.
Card on file 4111 1111 1111 1111, IBAN GB29 NWBK 6016 1331 9268 19.
Server 10.14.22.7 responded slowly; callback https://api.example.com/hooks/invoice?id=48213
Session token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0ODIxMyJ9.7cQ0mQ1sT4hZ9pLb
Access key AKIAIOSFODNN7EXAMPLE was rotated this morning.`;

const RULES = [
  { id: 'email', label: 'Email addresses', tag: 'EMAIL', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: 'phone', label: 'Phone numbers', tag: 'PHONE', pattern: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g },
  { id: 'card', label: 'Card numbers', tag: 'CARD', pattern: /\b(?:\d{4}[ -]?){3}\d{2,4}\b/g, keepLast: 4 },
  { id: 'iban', label: 'IBAN and account numbers', tag: 'IBAN', pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g },
  { id: 'ip', label: 'IP addresses', tag: 'IP', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { id: 'url', label: 'URLs', tag: 'URL', pattern: /https?:\/\/[^\s"')]+/g },
  { id: 'uuid', label: 'UUIDs', tag: 'UUID', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { id: 'token', label: 'JWT and long tokens', tag: 'TOKEN', pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]{6,})?\b|\b[A-Za-z0-9_-]{32,}\b/g },
  { id: 'key', label: 'Cloud keys', tag: 'KEY', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{8,}\b|\bsk-[A-Za-z0-9]{12,}\b|\bghp_[A-Za-z0-9]{20,}\b/g },
];

const shortHash = (value) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8);
};

export default function DataMasker() {
  const [text, setText] = useState(SAMPLE);
  const [active, setActive] = useState({ email: true, phone: true, card: true, iban: true, ip: true, url: false, uuid: true, token: true, key: true });
  const [style, setStyle] = useState('label');

  const result = useMemo(() => {
    const counters = {};
    const mapping = new Map();
    let pseudonymCount = 0;
    let output = text;

    RULES.forEach((rule) => {
      if (!active[rule.id]) return;
      output = output.replace(rule.pattern, (match) => {
        counters[rule.id] = (counters[rule.id] || 0) + 1;
        if (style === 'label') return '[' + rule.tag + ']';
        if (style === 'mask') {
          if (rule.keepLast && match.replace(/\D/g, '').length >= 6) {
            const digits = match.replace(/\D/g, '');
            return '•••• •••• •••• ' + digits.slice(-rule.keepLast);
          }
          return '•'.repeat(Math.max(4, Math.min(match.length, 16)));
        }
        if (style === 'hash') return rule.tag + '_' + shortHash(match);
        if (!mapping.has(match)) {
          pseudonymCount += 1;
          mapping.set(match, rule.tag.slice(0, 3) + '_' + pseudonymCount);
        }
        return mapping.get(match);
      });
    });

    const total = Object.values(counters).reduce((sum, value) => sum + value, 0);
    const rows = RULES.filter((rule) => counters[rule.id]).map((rule) => ({ label: rule.label, count: counters[rule.id], tag: rule.tag }));

    return { output, counters, rows, total, unique: mapping.size };
  }, [text, active, style]);

  const toggle = (id) => setActive((current) => ({ ...current, [id]: !current[id] }));

  const download = () => {
    const blob = new Blob([result.output], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'masked.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <ToolShell
      toolId="data-masker"
      icon={Eraser}
      title="Log & Data Masker"
      desc="Strip emails, phone numbers, cards, IBANs, IPs, URLs, tokens and cloud keys out of text before you paste it into a ticket — with a consistent, repeatable replacement."
      state={{ text, active, style }}
      onRestore={(restored) => {
        if (typeof restored.text === 'string') setText(restored.text);
        if (restored.active && typeof restored.active === 'object') setActive((current) => ({ ...current, ...restored.active }));
        if (restored.style) setStyle(restored.style);
      }}
      exportText={result.output}
      exportName="masked.txt"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Original text</div>
          <Area value={text} onChange={setText} rows={14} mono placeholder="Paste a log, a ticket or an email here" />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Masked output</span>
            <CopyBtn value={result.output} label="Copy" />
          </div>
          <pre className="max-h-72 overflow-auto rounded-md border border-input bg-transparent p-3 font-mono-j text-[11px] leading-relaxed">{result.output}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={download} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
              Download masked text
            </button>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What to look for</div>
          <div className="space-y-1.5">
            {RULES.map((rule) => (
              <ToggleRow
                key={rule.id}
                label={rule.label + (result.counters[rule.id] ? '  ·  ' + result.counters[rule.id] + ' found' : '')}
                checked={!!active[rule.id]}
                onChange={() => toggle(rule.id)}
              />
            ))}
          </div>
        </Panel>
        <div className="space-y-3">
          <Seg
            value={style}
            onChange={setStyle}
            options={[
              { value: 'label', label: 'Placeholder' },
              { value: 'mask', label: 'Blobs' },
              { value: 'hash', label: 'Short hash' },
              { value: 'pseudonym', label: 'Consistent tag' },
            ]}
          />
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Replacement styles</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· <span className="text-foreground">Placeholder</span> swaps each match for a labelled token like [EMAIL] — most readable in a ticket.</p>
              <p>· <span className="text-foreground">Blobs</span> keeps the shape and length so the reader can see how long the value was; card numbers keep their last four digits.</p>
              <p>· <span className="text-foreground">Short hash</span> gives a stable eight-character fingerprint: the same address always becomes the same code, so you can still follow a conversation without exposing anyone.</p>
              <p>· <span className="text-foreground">Consistent tag</span> numbers the first appearance of each value and reuses it everywhere, which is the closest thing to a pseudonym for logs.</p>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={result.total + ' item' + (result.total === 1 ? '' : 's') + ' redacted'}
          value={String(result.total)}
          sub={style === 'pseudonym'
            ? result.unique + ' distinct values mapped to consistent tags, so related lines in the log still point at the same person or account.'
            : 'Everything matched by the enabled patterns is replaced before you copy — the original text is left untouched.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Found, by category</div>
          {result.rows.length ? (
            <div className="space-y-1.5">
              {result.rows.map((row) => (
                <div key={row.label}>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-mono-j">{row.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-cyan-j/70" style={{ width: (result.total ? (row.count / result.total) * 100 : 0) + '%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Nothing matched with the patterns currently switched on.</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where this belongs in your workflow</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Before pasting a log into a ticket or a chat: mask it, then paste. The habit costs five seconds and prevents most accidental disclosures.</p>
            <p>· Before sharing a screenshot's text, a config dump or a stack trace with an external contractor.</p>
            <p>· Before adding real data to a test fixture — mask it first, then commit.</p>
            <p>· When preparing an incident report where the sequence matters but the identities do not.</p>
            <p>· Use the consistent-tag style for support threads: the same customer keeps the same tag across replies.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What this can and cannot do</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· It works on patterns. Names, addresses and free-form identifiers that do not follow a pattern will not be caught.</p>
            <p>· Phone matching is deliberately generous, so a long number that is not a phone may still be caught — check the output before sending.</p>
            <p>· Masking is not encryption. If a value must be usable later, store it properly rather than relying on a redacted copy.</p>
            <p>· Short hashes are fingerprints, not secrets. For a small set of known values they can be brute-forced, so treat them as identifiers rather than protection.</p>
            <p>· Read the result before you send it. A masking tool is a safety net, not a substitute for looking at what you are about to share.</p>
          </div>
          <div className="mt-3">
            <CopyBtn value={result.output} label="Copy the masked text" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Redacted" value={String(result.total)} mono />
        <Stat label="Categories hit" value={String(result.rows.length)} mono />
        <Stat label="Distinct values" value={String(result.unique)} mono sub="for the tag style" />
        <Stat label="Output length" value={String(result.output.length)} mono sub="characters" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Patterns this understands</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>email · local@domain.tld</p>
          <p>phone · international and national formats, with or without separators</p>
          <p>card · four groups of digits, 14 to 19 digits in total</p>
          <p>iban · two letters, two digits, then up to 30 alphanumerics</p>
          <p>ip · dotted quad IPv4 addresses</p>
          <p>url · anything starting http or https</p>
          <p>uuid · standard eight-four-four-four-twelve form</p>
          <p>token · JWT triples and long base64-style strings</p>
          <p>key · AWS access keys, sk- style API keys and GitHub tokens</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Style', value: style },
              { label: 'Rules on', value: String(Object.values(active).filter(Boolean).length) },
              { label: 'Redacted', value: String(result.total) },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Patterns are applied in a fixed order so a replacement can never be re-matched, and every replacement is computed from the original match — which is what
          keeps the consistent tags and short hashes stable across the whole document. Nothing is stored or sent: the text stays in this page.
        </p>
      </Panel>
    </ToolShell>
  );
}