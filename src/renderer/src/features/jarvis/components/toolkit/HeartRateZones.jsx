import { useMemo, useState } from 'react';
import { HeartPulse, Info } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const ZONES = [
  { id: 'z1', label: 'Z1 · Recovery', from: 0.5, to: 0.6, use: 'Warm-ups, cool-downs and easy spinning that speeds recovery.' },
  { id: 'z2', label: 'Z2 · Aerobic base', from: 0.6, to: 0.7, use: 'The long conversational work that builds your engine.' },
  { id: 'z3', label: 'Z3 · Tempo', from: 0.7, to: 0.8, use: 'Steady hard efforts — comfortably uncomfortable.' },
  { id: 'z4', label: 'Z4 · Threshold', from: 0.8, to: 0.9, use: 'Intervals that raise the ceiling you can hold.' },
  { id: 'z5', label: 'Z5 · VO2 max', from: 0.9, to: 1, use: 'Short, sharp efforts — hard to sustain for long.' },
];

export default function HeartRateZones() {
  const [age, setAge] = useState('30');
  const [resting, setResting] = useState('58');
  const [method, setMethod] = useState('karvonen');
  const [formula, setFormula] = useState('tanaka');

  const computed = useMemo(() => {
    const years = Math.max(10, Math.min(100, Number(age) || 30));
    const rest = Math.max(35, Math.min(110, Number(resting) || 58));
    const maxHr = formula === 'tanaka' ? 208 - 0.7 * years : formula === 'gulati' ? 191.5 - 0.007 * years ** 2 : 220 - years;
    const reserve = maxHr - rest;
    const zones = ZONES.map((zone) => {
      const lower = method === 'karvonen' ? rest + reserve * zone.from : maxHr * zone.from;
      const upper = method === 'karvonen' ? rest + reserve * zone.to : maxHr * zone.to;
      const bpmPercentMax = ((lower + upper) / 2 / maxHr) * 100;
      return { ...zone, lower: Math.round(lower), upper: Math.round(upper), bpmPercentMax };
    });
    return { years, rest, maxHr, reserve, zones };
  }, [age, resting, method, formula]);

  const report = [
    `Max heart rate: ${Math.round(computed.maxHr)} bpm (${formula === 'tanaka' ? 'Tanaka' : formula === 'gulati' ? 'Gulati (female)' : '220 − age'})`,
    `Resting heart rate: ${computed.rest} bpm · heart rate reserve ${Math.round(computed.reserve)} bpm`,
    `Method: ${method === 'karvonen' ? 'Karvonen (reserve based)' : 'Percentage of max'}`,
    '',
    ...computed.zones.map((z) => `${z.label}: ${z.lower}–${z.upper} bpm`),
  ].join('\n');

  return (
    <ToolShell
      toolId="heart-zones"
      icon={HeartPulse}
      title="Heart Rate Zones"
      desc="Turn your age and resting pulse into five training zones you can actually train by, with the purpose of each zone spelled out."
      state={{ age, resting, method, formula }}
      onRestore={(restored) => {
        if (restored.age !== undefined) setAge(String(restored.age));
        if (restored.resting !== undefined) setResting(String(restored.resting));
        if (restored.method) setMethod(restored.method);
        if (restored.formula) setFormula(restored.formula);
      }}
      exportText={report}
      exportName="heart-rate-zones.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={method} onChange={setMethod} options={[{ value: 'karvonen', label: 'Karvonen (reserve)' }, { value: 'max', label: '% of max' }]} />
        <CopyBtn value={report} label="Copy zones" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Age">
          <input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Resting heart rate" hint="measured lying down, before coffee">
          <input value={resting} onChange={(e) => setResting(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Max heart rate formula">
          <select value={formula} onChange={(e) => setFormula(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            <option value="tanaka">Tanaka (most accurate)</option>
            <option value="classic">220 − age (classic)</option>
            <option value="gulati">Gulati (women)</option>
          </select>
        </Field>
      </div>

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Estimated maximum</div>
        <div className="tk-title-glow mt-1 font-mono-j text-4xl font-semibold text-cyan-j">{Math.round(computed.maxHr)}<span className="text-lg"> bpm</span></div>
        <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">reserve {Math.round(computed.reserve)} bpm · resting {computed.rest} bpm</div>
      </div>

      <div className="space-y-2">
        {computed.zones.map((zone, index) => {
          const width = ((zone.upper - zone.lower) / (computed.maxHr - computed.zones[0].lower)) * 100;
          const offset = ((zone.lower - computed.zones[0].lower) / (computed.maxHr - computed.zones[0].lower)) * 100;
          const tone = ['from-cyan-500/70', 'from-emerald-500/70', 'from-amber-500/70', 'from-orange-500/70', 'from-red-500/70'][index];
          return (
            <div key={zone.id} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium">{zone.label}</span>
                <span className="font-mono-j text-xs text-cyan-j">{zone.lower}–{zone.upper} bpm</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-card/70">
                <div className={`h-full rounded-full bg-gradient-to-r ${tone} to-transparent`} style={{ marginLeft: `${Math.max(0, offset)}%`, width: `${Math.max(3, width)}%` }} />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{zone.use}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Max HR" value={`${Math.round(computed.maxHr)} bpm`} mono />
        <Stat label="Easy ceiling" value={`${computed.zones[1].upper} bpm`} sub="stay under on easy days" mono />
        <Stat label="Threshold band" value={`${computed.zones[3].lower}–${computed.zones[3].upper}`} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
          <Info className="h-3.5 w-3.5 text-cyan-j" /> How to actually use this
        </div>
        <p className="text-[11px] text-muted-foreground">
          Roughly 80% of weekly training in Z1–Z2 and 20% in Z3–Z5 builds fitness without burning you out. On easy days, if you can hold a full
          conversation you are in the right place — most people drift into Z3 without noticing and never get the easy days they need.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Age formulas are population averages with a real spread of ±10–12 bpm. Once you have a hard-effort reading from a watch or chest strap,
          enter that as your maximum instead — it beats any formula. Medicines that slow the heart, caffeine and heat all shift these numbers too.
        </p>
      </Panel>
    </ToolShell>
  );
}