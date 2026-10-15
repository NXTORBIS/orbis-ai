import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { ToolHeader, Field, Area, Out, Seg, ToggleRow } from './shared';

const ACCENTS = /[\u0300-\u036f]/g;

export default function SlugGenerator() {
  const [text, setText] = useState('Mark32 — Unify Notes, Tasks & Files!');
  const [sep, setSep] = useState('-');
  const [lower, setLower] = useState(true);
  const [stripAccents, setStripAccents] = useState(true);
  const [maxLen, setMaxLen] = useState(60);

  let s = text.trim();
  if (stripAccents) s = s.normalize('NFKD').replace(ACCENTS, '');
  s = s.replace(/[^\w\s-]/g, ' ').replace(/[\s_-]+/g, sep).replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');
  const slug = (lower ? s.toLowerCase() : s).slice(0, Number(maxLen) || 60).replace(new RegExp(`${sep}+$`), '');

  return (
    <div className="space-y-4">
      <ToolHeader icon={Link2} title="Slug Generator" desc="Turn any headline into a clean, URL-safe slug." />
      <Area value={text} onChange={setText} rows={3} placeholder="Title or sentence…" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Separator">
          <Seg value={sep} onChange={setSep} options={[{ value: '-', label: 'hyphen -' }, { value: '_', label: 'underscore _' }]} />
        </Field>
        <Field label="Max length">
          <input type="number" min={10} max={120} value={maxLen} onChange={(e) => setMaxLen(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Lowercase" checked={lower} onChange={setLower} />
        <ToggleRow label="Strip accents" checked={stripAccents} onChange={setStripAccents} />
      </div>
      <Out label="Slug" value={slug}>
        <span className="font-mono-j text-sm text-cyan-j">{slug || '—'}</span>
      </Out>
    </div>
  );
}