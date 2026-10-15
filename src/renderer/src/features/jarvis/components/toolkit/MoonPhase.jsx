import { useMemo, useState } from 'react';
import { Moon } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Panel, Stat, CopyBtn } from './shared';
import ToolShell from './kit/ToolShell';

const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const NAMES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
const EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

const toInput = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function phaseFor(date) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const fraction = age / SYNODIC;
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  const index = Math.floor(((fraction + 1 / 16) % 1) * 8);
  const nextNew = new Date(date.getTime() + (SYNODIC - age) * 86400000);
  const nextFull = new Date(date.getTime() + ((((0.5 - fraction) % 1) + 1) % 1) * SYNODIC * 86400000);
  const nextQuarter = new Date(date.getTime() + ((((0.25 - fraction) % 1) + 1) % 1) * SYNODIC * 86400000);
  return { age, fraction, illumination, name: NAMES[index], emoji: EMOJI[index], waxing: fraction < 0.5, nextNew, nextFull, nextQuarter };
}

export default function MoonPhase() {
  const [value, setValue] = useState(toInput(new Date()));

  const date = useMemo(() => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [value]);

  const phase = useMemo(() => phaseFor(date), [date]);

  const strip = useMemo(() => {
    const out = [];
    for (let i = -15; i <= 15; i++) {
      const d = new Date(date.getTime() + i * 86400000);
      const p = phaseFor(d);
      out.push({ date: d, ...p, offset: i });
    }
    return out;
  }, [date]);

  const fmt = (d) => d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <ToolShell
      toolId="moon-phase"
      icon={Moon}
      title="Moon Phase Calculator"
      desc="The moon's phase for any date, with illumination and the next key moments."
      state={{ value }}
      onRestore={(saved) => { if (saved.value !== undefined) setValue(saved.value); }}
      exportText={phase ? JSON.stringify(phase, null, 2) : ''}
      exportName="moon-phase.json"
      exportMime="application/json"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Date and time">
          <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" />
        </Field>
        <div className="flex items-end">
          <Button size="sm" variant="outline" onClick={() => setValue(toInput(new Date()))}>Now</Button>
        </div>
      </div>
      <Panel className="text-center">
        <div className="text-6xl leading-none">{phase.emoji}</div>
        <div className="mt-2 font-display text-xl font-bold">{phase.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{phase.waxing ? 'Waxing — growing towards full' : 'Waning — shrinking towards new'}</div>
        <div className="mx-auto mt-4 max-w-sm">
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-gradient-to-r from-slate-500 to-cyan-j transition-all" style={{ width: `${(phase.illumination * 100).toFixed(0)}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{(phase.illumination * 100).toFixed(1)}% illuminated</div>
        </div>
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Moon age" value={`${phase.age.toFixed(1)} days`} />
        <Stat label="Cycle position" value={`${(phase.fraction * 100).toFixed(0)}%`} />
        <Stat label="Synodic month" value={`${SYNODIC.toFixed(2)} days`} />
        <Stat label="Light" value={`${(phase.illumination * 100).toFixed(0)}%`} />
      </div>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Coming up</div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Next new moon</span><span className="font-mono-j text-xs">{fmt(phase.nextNew)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Next first quarter</span><span className="font-mono-j text-xs">{fmt(phase.nextQuarter)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Next full moon</span><span className="font-mono-j text-xs">{fmt(phase.nextFull)}</span></div>
        </div>
      </Panel>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Phases across the month</div>
        <div className="flex items-end gap-0.5 overflow-x-auto pb-1 scrollbar-thin">
          {strip.map((s) => (
            <div key={s.offset} className="flex min-w-[26px] flex-col items-center gap-1">
              <span className="text-[11px] text-muted-foreground">{s.date.getDate()}</span>
              <span className={`text-lg ${s.offset === 0 ? '' : 'opacity-70'}`}>{s.emoji}</span>
            </div>
          ))}
        </div>
        <div className="mt-1 text-center text-[11px] text-cyan-j">today is highlighted · {fmt(date)}</div>
      </Panel>
      <CopyBtn value={`${phase.name} · ${(phase.illumination * 100).toFixed(0)}% lit · moon age ${phase.age.toFixed(1)} days · ${fmt(date)}`} label="Copy summary" />
      <p className="text-[11px] text-muted-foreground">Calculated from the mean synodic cycle, so dates can be up to a few hours out from almanac values near a phase boundary.</p>
    </ToolShell>
  );
}