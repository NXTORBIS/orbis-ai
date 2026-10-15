import { useState } from 'react';
import { Users, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Seg, Area, CopyBtn, Stat } from './shared';

const COLORS = ['text-cyan-j', 'text-violet-400', 'text-amber-400', 'text-emerald-400', 'text-pink-400', 'text-sky-400'];
const BORDERS = ['border-cyan-j/40', 'border-violet-400/40', 'border-amber-400/40', 'border-emerald-400/40', 'border-pink-400/40', 'border-sky-400/40'];

export default function TeamSplitter() {
  const [text, setText] = useState('Aarav\nMeera\nRohan\nPriya\nKabir\nAnanya\nDev\nIsha');
  const [mode, setMode] = useState('count');
  const [value, setValue] = useState(2);
  const [teams, setTeams] = useState([]);

  const names = text.split('\n').map((n) => n.trim()).filter(Boolean);

  const split = () => {
    const n = Math.max(1, Math.min(20, Number(value) || 1));
    const shuffled = names.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    const buckets = mode === 'count' ? n : Math.max(1, Math.ceil(shuffled.length / n));
    const out = Array.from({ length: Math.min(buckets, shuffled.length || 1) }, () => []);
    shuffled.forEach((name, i) => out[i % out.length].push(name));
    setTeams(out);
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Users} title="Team Splitter" desc="Randomly divide a list into balanced teams or groups — perfect for games and standups." />
      <Area value={text} onChange={setText} rows={8} placeholder="One name per line…" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Divide by">
          <Seg value={mode} onChange={setMode} options={[{ value: 'count', label: 'Number of teams' }, { value: 'size', label: 'Size of each team' }]} />
        </Field>
        <Field label={mode === 'count' ? 'Teams' : 'People per team'}>
          <input type="number" min={1} max={20} value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={split} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Split into teams</Button>
        {teams.length > 0 && <CopyBtn value={teams.map((t, i) => `Team ${i + 1}: ${t.join(', ')}`).join('\n')} label="Copy teams" />}
      </div>
      {teams.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {teams.map((team, i) => (
              <div key={i} className={`rounded-xl border bg-card/50 p-4 ${BORDERS[i % BORDERS.length]}`}>
                <div className={`mb-2 font-display text-sm font-bold ${COLORS[i % COLORS.length]}`}>TEAM {i + 1}</div>
                <ul className="space-y-1 text-sm">
                  {team.map((name, j) => <li key={`${name}-${j}`} className="flex items-center gap-2"><span className="text-muted-foreground">•</span>{name}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="People" value={String(names.length)} />
            <Stat label="Teams" value={String(teams.length)} />
            <Stat label="Largest team" value={String(Math.max(...teams.map((t) => t.length)))} />
          </div>
        </>
      )}
    </div>
  );
}