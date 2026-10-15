import { useMemo, useState } from 'react';
import { Filter, Hash } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Panel, Stat, ToggleRow, downloadBlob } from './shared';

const PATTERNS = [
  { id: 'email', label: 'Emails', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { id: 'url', label: 'Links', regex: /(?:https?:\/\/|www\.)[^\s<>"')]+/gi },
  { id: 'phone', label: 'Phone numbers', regex: /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{3,5}(?:[\s-]?\d{1,5})?/g },
  { id: 'hashtag', label: 'Hashtags', regex: /#[\p{L}\p{N}_]{2,}/gu },
  { id: 'mention', label: '@Mentions', regex: /@[\p{L}\p{N}_.]{2,}/gu },
  { id: 'number', label: 'Numbers', regex: /-?\d+(?:[.,]\d+)?/g },
  { id: 'money', label: 'Amounts', regex: /(?:[$€£₹¥]|USD|EUR|GBP|INR|Rs\.?)\s?\d[\d,]*(?:\.\d{1,2})?/gi },
  { id: 'ip', label: 'IP addresses', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { id: 'date', label: 'Dates', regex: /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi },
  { id: 'uuid', label: 'IDs & UUIDs', regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[A-Z]{2,}-\d{3,}\b/gi },
];

const SAMPLE = `Order #INV-2041 placed 12/03/2026 by priya.sharma@example.com for ₹24,500.99 — tracking 8a14c2b0-3f6d-4a11-9e2c-77a1b6c5d4e8.
Follow up with +91 98200 11223 or visit www.example.com/orders?ref=email before 2026-04-02. Ask about #bulkorders and @accounts.
Server 192.168.1.24 reported latency of 480 ms on 5 attempts.`;

const UNIQUE = (list) => [...new Set(list.map((v) => (v.length > 1 ? v.trim() : v)))].filter(Boolean);

export default function DataExtractor() {
  const [text, setText] = useState(SAMPLE);
  const [type, setType] = useState('email');
  const [custom, setCustom] = useState('');
  const [unique, setUnique] = useState(true);
  const [caseSensitive, setCaseSensitive] = useState(false);

  const active = PATTERNS.find((p) => p.id === type);

  const found = useMemo(() => {
    let regex = active?.regex ?? null;
    if (type === 'custom') {
      if (!custom.trim()) return { list: [], error: '' };
      try {
        regex = new RegExp(custom, caseSensitive ? 'g' : 'gi');
      } catch (e) {
        return { list: [], error: e.message };
      }
    }
    if (!regex) return { list: [], error: '' };
    const matches = text.match(regex) || [];
    return { list: unique ? UNIQUE(matches) : matches, error: '' };
  }, [text, type, custom, unique, caseSensitive, active]);

  const allCounts = useMemo(() => {
    const counts = PATTERNS.map((p) => ({ id: p.id, label: p.label, count: UNIQUE(text.match(p.regex) || []).length }));
    return { counts, total: counts.reduce((sum, c) => sum + c.count, 0) };
  }, [text]);

  const list = found.list;
  const csv = `value\n${list.map((v) => `"${String(v).replace(/"/g, '""')}"`).join('\n')}`;

  return (
    <ToolShell
      toolId="extract-data"
      icon={Filter}
      title="Data Extractor"
      desc="Pull every email, link, number, date, amount or ID out of a wall of text — deduplicated, counted and ready to export."
      state={{ text, type, custom, unique, caseSensitive }}
      onRestore={(restored) => {
        if (typeof restored.text === 'string') setText(restored.text);
        if (restored.type) setType(restored.type);
        if (typeof restored.custom === 'string') setCustom(restored.custom);
        if (typeof restored.unique === 'boolean') setUnique(restored.unique);
        if (typeof restored.caseSensitive === 'boolean') setCaseSensitive(restored.caseSensitive);
      }}
      exportText={csv}
      exportName={`${type}-extract.csv`}
    >
      <Field label="Paste anything" hint="Emails from a thread, a log file, a list of orders, a scraped page">
        <Area value={text} onChange={setText} rows={7} />
      </Field>

      <Field label="What to pull out">
        <div className="flex flex-wrap gap-1.5">
          {PATTERNS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setType(p.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                type === p.id ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setType('custom')}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              type === 'custom' ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'
            }`}
          >
            Custom pattern
          </button>
        </div>
      </Field>

      {type === 'custom' && (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Your regular expression" hint="Flags are applied for you — add groups for capture">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. [A-Z]{2}-\\d{4}"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm"
            />
          </Field>
          <ToggleRow label="Case sensitive" checked={caseSensitive} onChange={setCaseSensitive} />
        </div>
      )}
      {found.error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">That pattern is not valid: {found.error}</Panel>}

      <ToggleRow label="Remove duplicates" checked={unique} onChange={setUnique} hint="keeps the first of each" />

      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={list.join('\n')} label="Copy list" />
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([csv], { type: 'text/csv' }), `${type}-extract.csv`)}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
        >
          Download CSV
        </button>
        <span className="text-[11px] text-muted-foreground">
          {list.length} match{list.length === 1 ? '' : 'es'}
        </span>
      </div>

      <div className="tk-card tk-depth max-h-72 overflow-auto rounded-xl border border-border/70 bg-card/50 p-3">
        {list.length ? (
          <ol className="space-y-1">
            {list.map((value, index) => (
              <li key={`${value}-${index}`} className="flex items-start gap-2 text-[12px]">
                <span className="w-7 shrink-0 text-right font-mono-j text-[10px] text-muted-foreground">{index + 1}</span>
                <span className="break-all font-mono-j">{value}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[11px] text-muted-foreground">Nothing of this kind was found in the text yet.</p>
        )}
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
          <Hash className="h-3.5 w-3.5 text-cyan-j" /> Everything found in one pass
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allCounts.counts.filter((c) => c.count > 0).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setType(c.id)}
              className="rounded-lg border border-border/60 px-2 py-1 text-[11px] transition hover:border-cyan-j/50"
            >
              {c.label} <span className="font-mono-j text-muted-foreground">· {c.count}</span>
            </button>
          ))}
          {!allCounts.total && <span className="text-[11px] text-muted-foreground">Paste some text to scan it.</span>}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Showing" value={String(list.length)} mono />
        <Stat label="Total distinct" value={String(allCounts.total)} mono />
        <Stat label="Characters scanned" value={text.length.toLocaleString()} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Everything runs locally — the text never leaves this page, which matters when you are pulling emails or order numbers out of something
          private. Handy follow-ups: paste a log file to collect trace IDs, or a spreadsheet column to dedupe it.
        </p>
      </Panel>
    </ToolShell>
  );
}