import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ToolHeader, Field, Area, Out, Stat, ToggleRow } from './shared';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default function FindReplace() {
  const [text, setText] = useState('The cat sat on the mat.\nThe cat ate the rat.');
  const [find, setFind] = useState('cat');
  const [replace, setReplace] = useState('dog');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  const { out, count, error } = useMemo(() => {
    if (!find) return { out: text, count: 0, error: null };
    const flags = `g${caseSensitive ? '' : 'i'}`;
    const source = regex ? find : escapeRe(find);
    let re;
    try { re = new RegExp(source, flags); } catch (e) { return { out: text, count: 0, error: 'Invalid regular expression' }; }
    const matches = text.match(re);
    return { out: text.replace(re, replace), count: matches ? matches.length : 0, error: null };
  }, [text, find, replace, regex, caseSensitive]);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Search} title="Find & Replace" desc="Preview every replacement before you paste it back — plain text or regex." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Find">
          <input value={find} onChange={(e) => setFind(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Replace with">
          <input value={replace} onChange={(e) => setReplace(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Regular expression" hint="use $1 for groups" checked={regex} onChange={setRegex} />
        <ToggleRow label="Match case" checked={caseSensitive} onChange={setCaseSensitive} />
      </div>
      <Field label="Original text">
        <Area value={text} onChange={setText} rows={6} mono />
      </Field>
      <Out label="Result" value={out}>
        <span className="whitespace-pre-wrap font-mono-j text-xs">{error ? <span className="text-red-500">{error}</span> : out || '—'}</span>
      </Out>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Matches replaced" value={String(count)} />
        <Stat label="Length change" value={`${out.length - text.length >= 0 ? '+' : ''}${out.length - text.length}`} />
      </div>
    </div>
  );
}