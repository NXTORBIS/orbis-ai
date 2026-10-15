import { useState } from 'react';
import { Moon, Sunrise } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel } from './shared';

const CYCLE = 90;
const FALL_ASLEEP = 15;

const shift = (time, minutes) => {
  const [h, m] = time.split(':').map(Number);
  const total = ((h * 60 + m + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export default function SleepCycle() {
  const [mode, setMode] = useState('wake');
  const [time, setTime] = useState('07:00');

  const rows = Array.from({ length: 6 }, (_, i) => {
    const cycles = 6 - i;
    const minutes = cycles * CYCLE + FALL_ASLEEP;
    return {
      cycles,
      label: mode === 'wake' ? shift(time, -minutes) : shift(time, minutes),
      hours: ((cycles * CYCLE) / 60).toFixed(1),
      recommended: cycles === 5 || cycles === 6,
    };
  });

  return (
    <div className="space-y-4">
      <ToolHeader icon={Moon} title="Sleep Cycle Calculator" desc="Wake up between cycles instead of mid-deep-sleep — bedtime or alarm, your call." />
      <Seg value={mode} onChange={setMode} options={[{ value: 'wake', label: 'I want to wake at' }, { value: 'sleep', label: 'I plan to sleep at' }]} />
      <Field label={mode === 'wake' ? 'Wake-up time' : 'Bedtime'}>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>
      <Panel className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {mode === 'wake' ? <><Moon className="h-3.5 w-3.5" /> Go to bed at</> : <><Sunrise className="h-3.5 w-3.5" /> Set the alarm for</>}
        </div>
        {rows.map((r) => (
          <div key={r.cycles} className={`flex items-center justify-between rounded-lg border px-3 py-2.5 transition ${r.recommended ? 'border-cyan-j/50 bg-cyan-j/5' : 'border-border/60 bg-background/40'}`}>
            <div className="flex items-center gap-3">
              <span className={`font-display text-xl tabular-nums ${r.recommended ? 'text-cyan-j' : 'text-foreground'}`}>{r.label}</span>
              {r.recommended && <span className="rounded-md bg-cyan-j/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-j">RECOMMENDED</span>}
            </div>
            <div className="text-right text-[11px] text-muted-foreground">
              {r.cycles} cycles · {r.hours} h sleep
            </div>
          </div>
        ))}
        <p className="pt-1 text-[11px] text-muted-foreground">Based on 90-minute sleep cycles plus about 15 minutes to fall asleep. Five or six cycles suits most adults.</p>
      </Panel>
      <div className="grid grid-cols-3 gap-2">
        <Stat label={mode === 'wake' ? 'Wake at' : 'Sleep at'} value={time} mono />
        <Stat label="Cycles shown" value="1 – 6" />
        <Stat label="Best options" value={rows.filter((r) => r.recommended).map((r) => r.label).join(' or ')} mono />
      </div>
    </div>
  );
}