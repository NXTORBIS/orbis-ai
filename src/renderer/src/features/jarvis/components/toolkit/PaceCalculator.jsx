import { useMemo, useState } from 'react';
import { Footprints } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const DISTANCES = [
  { label: '5K', value: 5 },
  { label: '10K', value: 10 },
  { label: 'Half marathon', value: 21.0975 },
  { label: 'Marathon', value: 42.195 },
];

const toSeconds = (hours, minutes, seconds) => (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0);

const formatClock = (totalSeconds) => {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

export default function PaceCalculator() {
  const [unit, setUnit] = useState('km');
  const [distance, setDistance] = useState('10');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('50');
  const [seconds, setSeconds] = useState('0');
  const [solve, setSolve] = useState('pace');

  const metres = (Number(String(distance).replace(/,/g, '')) || 0) * 1000;
  const totalSeconds = toSeconds(hours, minutes, seconds);

  const results = useMemo(() => {
    if (!metres || !totalSeconds) return null;
    const secondsPerKm = totalSeconds / (metres / 1000);
    const secondsPerMile = secondsPerKm * 1.609344;
    const speedKmh = (metres / 1000) / (totalSeconds / 3600);
    const speedMph = speedKmh / 1.609344;
    const splits = [];
    const stepMetres = unit === 'km' ? 1000 : 1609.344;
    for (let done = stepMetres; done <= metres + 1; done += stepMetres) {
      const ratio = Math.min(1, done / metres);
      splits.push({ label: unit === 'km' ? `${Math.round(done / 1000)} km` : `${(done / 1609.344).toFixed(done === stepMetres ? 0 : 1)} mi`, time: totalSeconds * ratio });
    }
    return { secondsPerKm, secondsPerMile, speedKmh, speedMph, splits };
  }, [metres, totalSeconds, unit]);

  const projections = results
    ? DISTANCES.map((d) => ({ ...d, time: results.secondsPerKm * d.value }))
    : [];

  const report = results
    ? [
        `Distance: ${distance} km`,
        `Time: ${formatClock(totalSeconds)}`,
        `Pace: ${formatClock(results.secondsPerKm)} /km · ${formatClock(results.secondsPerMile)} /mi`,
        `Speed: ${results.speedKmh.toFixed(2)} km/h · ${results.speedMph.toFixed(2)} mph`,
        '',
        'Splits:',
        ...results.splits.map((s) => `${s.label}\t${formatClock(s.time)}`),
      ].join('\n')
    : '';

  return (
    <ToolShell
      toolId="pace"
      icon={Footprints}
      title="Pace, Speed & Split Calculator"
      desc="Work out your pace from a run, see every split, and project the same effort onto 5K, 10K, half and full distances."
      state={{ unit, distance, hours, minutes, seconds }}
      onRestore={(restored) => {
        if (restored.unit) setUnit(restored.unit);
        if (restored.distance !== undefined) setDistance(String(restored.distance));
        if (restored.hours !== undefined) setHours(String(restored.hours));
        if (restored.minutes !== undefined) setMinutes(String(restored.minutes));
        if (restored.seconds !== undefined) setSeconds(String(restored.seconds));
      }}
      exportText={report}
      exportName="pace.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={unit} onChange={setUnit} options={[{ value: 'km', label: 'Kilometres' }, { value: 'mi', label: 'Miles' }]} />
        <Seg value={solve} onChange={setSolve} options={[{ value: 'pace', label: 'From time' }, { value: 'time', label: 'From pace' }]} />
        <CopyBtn value={report} label="Copy report" />
      </div>

      <Field label="Distance (km)" hint="Type any distance — a 7.4 km loop works just as well as a marathon">
        <input
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          inputMode="decimal"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm"
        />
      </Field>

      <div className="flex flex-wrap gap-1.5">
        {DISTANCES.map((d) => (
          <button
            key={d.label}
            type="button"
            onClick={() => setDistance(String(d.value))}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              String(Number(distance)) === String(d.value) ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <Field label={solve === 'pace' ? 'Finish time' : 'Target pace (h : m : s per km)'}>
        <div className="grid grid-cols-3 gap-2">
          <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" placeholder="h" className="h-9 rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          <input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" placeholder="m" className="h-9 rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          <input value={seconds} onChange={(e) => setSeconds(e.target.value)} inputMode="numeric" placeholder="s" className="h-9 rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </div>
      </Field>

      {results ? (
        <>
          <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{solve === 'pace' ? 'Your pace' : 'Finish time'}</div>
            <div className="tk-title-glow mt-1 font-mono-j text-3xl font-semibold text-cyan-j">
              {solve === 'pace' ? `${formatClock(unit === 'km' ? results.secondsPerKm : results.secondsPerMile)} /${unit}` : formatClock(totalSeconds)}
            </div>
            <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">
              {formatClock(results.secondsPerKm)} /km · {formatClock(results.secondsPerMile)} /mi · {results.speedKmh.toFixed(2)} km/h
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Speed" value={`${results.speedKmh.toFixed(2)} km/h`} mono />
            <Stat label="In mph" value={`${results.speedMph.toFixed(2)} mph`} mono />
            <Stat label="Per mile" value={formatClock(results.secondsPerMile)} mono />
            <Stat label="Splits" value={String(results.splits.length)} mono />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">{unit === 'km' ? 'Kilometre splits' : 'Mile splits'}</div>
              <div className="max-h-56 space-y-1 overflow-auto">
                {results.splits.map((split, index) => {
                  const previous = index === 0 ? 0 : results.splits[index - 1].time;
                  return (
                    <div key={split.label} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                      <span>{split.label}</span>
                      <span className="font-mono-j text-muted-foreground">+{formatClock(split.time - previous)}</span>
                      <span className="font-mono-j">{formatClock(split.time)}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Same pace, other distances</div>
              <div className="space-y-1">
                {projections.map((p) => (
                  <div key={p.label} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                    <span>{p.label}</span>
                    <button type="button" onClick={() => setDistance(String(p.value))} className="rounded-md border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j">
                      use
                    </button>
                    <span className="font-mono-j text-cyan-j">{formatClock(p.time)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      ) : (
        <Panel className="text-[11px] text-muted-foreground">Fill in a distance and a time to see your pace, speed and splits.</Panel>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Projections simply hold your current pace steady — real runners slow slightly over longer distances, so use the longer figures as a
          target rather than a promise. Negative-split runners can flip this around: put in the finish time you want and read the pace you need.
        </p>
      </Panel>
    </ToolShell>
  );
}