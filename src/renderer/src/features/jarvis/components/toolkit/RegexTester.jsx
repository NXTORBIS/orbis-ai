import { useState } from 'react';
import { Regex } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Stat } from './shared';

export default function RegexTester() {
  const [pattern, setPattern] = useState('\\b(\\w+)@(\\w+)\\.(\\w+)\\b');
  const [flags, setFlags] = useState('gi');
  const [test, setTest] = useState('Contact me at hello@example.com or test@site.org');
  let err = null;

  let matches = []; let regex = null;
  try { regex = new RegExp(pattern, flags); } catch (e) { err = e.message; }
  if (regex && test) {
    if (flags.includes('g')) { let m; while ((m = regex.exec(test)) !== null) { matches.push({ match: m[0], index: m.index, groups: m.slice(1) }); if (m.index === regex.lastIndex) regex.lastIndex++; } }
    else { const m = regex.exec(test); if (m) matches.push({ match: m[0], index: m.index, groups: m.slice(1) }); }
  }

  return (
    <div className="space-y-4">
      <ToolHeader icon={Regex} title="Regex Tester" desc="Test regular expressions with live match highlighting, groups and positions." />
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Pattern</span>
          <div className="flex items-center"><span className="rounded-l-md border border-r-0 border-input px-2 py-2 text-muted-foreground">/</span><Input value={pattern} onChange={(e) => setPattern(e.target.value)} className="rounded-l-none" /><span className="rounded-r-md border border-l-0 border-input px-2 py-2 text-muted-foreground">/</span></div>
        </label>
        <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Flags</span><Input value={flags} onChange={(e) => setFlags(e.target.value)} className="w-24" /></label>
      </div>
      <textarea value={test} onChange={(e) => setTest(e.target.value)} className="h-28 w-full rounded-md border border-input bg-transparent p-3 font-mono-j text-sm" />
      {err ? <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">{err}</div> : (
        <>
          <div className="grid grid-cols-2 gap-3"><Stat label="Matches" value={matches.length} mono /><Stat label="Flags" value={flags} mono /></div>
          {matches.length > 0 && (
            <div className="space-y-1">
              {matches.map((m, i) => (
                <div key={i} className="rounded-md border border-border/60 bg-card/40 px-3 py-2 text-xs">
                  <div className="flex justify-between"><span className="font-mono-j text-cyan-j">{m.match}</span><span className="text-muted-foreground">@{m.index}</span></div>
                  {m.groups.length > 0 && <div className="mt-1 font-mono-j text-muted-foreground">groups: {m.groups.map((g, gi) => `$${gi + 1}=${g}`).join('  ')}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}