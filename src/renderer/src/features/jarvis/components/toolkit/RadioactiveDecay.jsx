import { useMemo, useState } from 'react';
import { Atom } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const ISOTOPES = [
  { label: 'Carbon-14', halfLife: 5730, unit: 'years', use: 'archaeological dating' },
  { label: 'Iodine-131', halfLife: 8.02, unit: 'days', use: 'thyroid therapy' },
  { label: 'Technetium-99m', halfLife: 6.01, unit: 'hours', use: 'medical imaging' },
  { label: 'Fluorine-18', halfLife: 109.7, unit: 'minutes', use: 'PET scans' },
  { label: 'Caesium-137', halfLife: 30.17, unit: 'years', use: 'industrial sources' },
  { label: 'Cobalt-60', halfLife: 5.27, unit: 'years', use: 'radiotherapy' },
  { label: 'Radium-226', halfLife: 1600, unit: 'years', use: 'historical luminous paint' },
  { label: 'Strontium-90', halfLife: 28.8, unit: 'years', use: 'fallout, beta sources' },
  { label: 'Uranium-235', halfLife: 703800000, unit: 'years', use: 'reactor fuel' },
  { label: 'Potassium-40', halfLife: 1250000000, unit: 'years', use: 'natural background' },
];

const UNITS = [
  { id: 'minutes', label: 'minutes', seconds: 60 },
  { id: 'hours', label: 'hours', seconds: 3600 },
  { id: 'days', label: 'days', seconds: 86400 },
  { id: 'years', label: 'years', seconds: 31557600 },
];

const ACTIVITY = [
  { id: 'Bq', label: 'Bq', factor: 1 },
  { id: 'kBq', label: 'kBq', factor: 1000 },
  { id: 'MBq', label: 'MBq', factor: 1000000 },
  { id: 'GBq', label: 'GBq', factor: 1000000000 },
  { id: 'mCi', label: 'mCi', factor: 37000000 },
  { id: 'Ci', label: 'Ci', factor: 37000000000 },
];

const unitOf = (id) => UNITS.find((entry) => entry.id === id) || UNITS[3];

const niceNumber = (value) => {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || magnitude < 1e-3) return value.toExponential(3);
  if (magnitude >= 100) return value.toFixed(0);
  if (magnitude >= 1) return value.toFixed(2);
  return value.toFixed(4);
};

export default function RadioactiveDecay() {
  const [isotope, setIsotope] = useState(ISOTOPES[0].label);
  const [halfLife, setHalfLife] = useState('5730');
  const [halfUnit, setHalfUnit] = useState('years');
  const [amount, setAmount] = useState('1000');
  const [activityUnit, setActivityUnit] = useState('MBq');
  const [elapsed, setElapsed] = useState('10000');
  const [elapsedUnit, setElapsedUnit] = useState('years');
  const [target, setTarget] = useState('10');
  const [mode, setMode] = useState('decay');

  const result = useMemo(() => {
    const halfSeconds = (Number(halfLife) || 1) * unitOf(halfUnit).seconds;
    const elapsedSeconds = (Number(elapsed) || 0) * unitOf(elapsedUnit).seconds;
    const lambda = Math.LN2 / halfSeconds;
    const factor = ACTIVITY.find((entry) => entry.id === activityUnit) || ACTIVITY[0];
    const initial = (Number(amount) || 0) * factor.factor;

    const remainingFraction = Math.exp(-lambda * elapsedSeconds);
    const remainingActivity = initial * remainingFraction;
    const halfLives = elapsedSeconds / halfSeconds;
    const meanLife = halfSeconds / Math.LN2;

    const targetFraction = Math.max(0.0001, Math.min(99.999, (Number(target) || 50) / 100));
    const timeToTargetSeconds = -Math.log(targetFraction) / lambda;
    const bestUnit = (seconds) => {
      const candidate = UNITS.slice().reverse().find((unit) => seconds / unit.seconds >= 1);
      return (candidate || UNITS[0]).label;
    };

    const milestones = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => ({
      count,
      percent: Math.pow(0.5, count) * 100,
      activity: initial * Math.pow(0.5, count),
      time: halfSeconds * count,
    }));

    const chart = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((count) => ({
      label: count + '×',
      value: Math.round(Math.pow(0.5, count) * 1000) / 10,
    }));

    return {
      halfSeconds, elapsedSeconds, lambda, initial, remainingFraction, remainingActivity, halfLives, meanLife,
      targetFraction, timeToTargetSeconds, milestones, chart,
      decayConstantPerUnit: lambda * unitOf(halfUnit).seconds,
      timeToTargetLabel: niceNumber(timeToTargetSeconds / unitOf(bestUnit(timeToTargetSeconds)).seconds) + ' ' + bestUnit(timeToTargetSeconds),
      halfLifeLabel: niceNumber(Number(halfLife) || 1) + ' ' + halfUnit,
      activityLabel: (value) => niceNumber(value / factor.factor) + ' ' + activityUnit,
      atoms: remainingActivity / lambda,
    };
  }, [halfLife, halfUnit, amount, activityUnit, elapsed, elapsedUnit, target]);

  const applyIsotope = (entry) => {
    setIsotope(entry.label);
    setHalfLife(String(entry.halfLife));
    setHalfUnit(entry.unit);
  };

  const report = useMemo(() => [
    isotope + ' — half-life ' + result.halfLifeLabel,
    '',
    'Decay constant: ' + result.lambda.toExponential(4) + ' per second (' + result.decayConstantPerUnit.toExponential(4) + ' per ' + halfUnit.replace(/s$/, '') + ')',
    'Mean lifetime: 1.44 × half-life',
    '',
    'After ' + elapsed + ' ' + elapsedUnit + ': ' + (result.remainingFraction * 100).toFixed(4) + '% remains',
    'Activity: ' + result.activityLabel(result.remainingActivity) + ' from ' + amount + ' ' + activityUnit,
    'Half-lives elapsed: ' + result.halfLives.toFixed(3),
    '',
    'Time to fall to ' + target + '%: ' + result.timeToTargetLabel,
    '',
    ...result.milestones.map((row) => row.count + ' half-lives · ' + row.percent.toFixed(3) + '% · ' + result.activityLabel(row.activity)),
  ].join('\n'), [result, isotope, elapsed, elapsedUnit, amount, activityUnit, target, halfUnit]);

  return (
    <ToolShell
      toolId="radioactive-decay"
      icon={Atom}
      title="Radioactive Decay Calculator"
      desc="Half-life into decay constant, remaining activity, elapsed half-lives and the time to reach any remaining fraction — with a live curve and the standard isotope table."
      state={{ isotope, halfLife, halfUnit, amount, activityUnit, elapsed, elapsedUnit, target, mode }}
      onRestore={(restored) => {
        if (typeof restored.isotope === 'string') setIsotope(restored.isotope);
        if (restored.halfLife !== undefined) setHalfLife(String(restored.halfLife));
        if (restored.halfUnit) setHalfUnit(restored.halfUnit);
        if (restored.amount !== undefined) setAmount(String(restored.amount));
        if (restored.activityUnit) setActivityUnit(restored.activityUnit);
        if (restored.elapsed !== undefined) setElapsed(String(restored.elapsed));
        if (restored.elapsedUnit) setElapsedUnit(restored.elapsedUnit);
        if (restored.target !== undefined) setTarget(String(restored.target));
        if (restored.mode) setMode(restored.mode);
      }}
      exportText={report}
      exportName="decay.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {ISOTOPES.map((entry) => (
          <button
            key={entry.label}
            type="button"
            onClick={() => applyIsotope(entry)}
            className={entry.label === isotope
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
            title={entry.use}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <Seg value={mode} onChange={setMode} options={[{ value: 'decay', label: 'How much is left' }, { value: 'time', label: 'How long until it drops' }]} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Half-life">
          <input value={halfLife} onChange={(e) => setHalfLife(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Half-life unit">
          <select value={halfUnit} onChange={(e) => setHalfUnit(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {UNITS.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
          </select>
        </Field>
        <Field label="Starting activity">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Activity unit">
          <select value={activityUnit} onChange={(e) => setActivityUnit(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {ACTIVITY.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
          </select>
        </Field>
      </div>

      {mode === 'decay' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Time elapsed">
            <input value={elapsed} onChange={(e) => setElapsed(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </Field>
          <Field label="Time unit">
            <select value={elapsedUnit} onChange={(e) => setElapsedUnit(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
              {UNITS.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
            </select>
          </Field>
        </div>
      ) : (
        <Field label="Target remaining, % of the original">
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.remainingFraction > 0.5 ? 'emerald' : result.remainingFraction > 0.05 ? 'amber' : 'rose'}
          label={mode === 'decay' ? 'Remaining after ' + elapsed + ' ' + elapsedUnit : 'Time to reach ' + target + '% remaining'}
          value={mode === 'decay' ? (result.remainingFraction * 100).toFixed(3) : result.timeToTargetLabel}
          unit={mode === 'decay' ? '%' : ''}
          sub={mode === 'decay'
            ? 'That is ' + result.activityLabel(result.remainingActivity) + ' left of the original ' + amount + ' ' + activityUnit + ', after ' + result.halfLives.toFixed(3) + ' half-lives.'
            : 'A remaining fraction of ' + target + '% means ' + result.halfLives.toFixed(2) + ' half-lives at this decay constant — the same answer whichever unit you asked in.'}
        />
        <Ring
          value={result.remainingFraction * 100}
          max={100}
          tone={result.remainingFraction > 0.5 ? 'emerald' : 'amber'}
          label="Fraction of the original left"
          sub={result.halfLives.toFixed(2) + ' half-lives have passed at ' + result.halfLifeLabel}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Decay curve, in half-lives</div>
          <Bars data={result.chart} format={(value) => value.toFixed(1)} suffix="%" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The shape is always identical — only the axis changes. This is why half-life, not total life, is the useful number: the decay never finishes, it just
            becomes indistinguishable from background.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Decay constants and lifetimes</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Half-life T½</span><span>{result.halfLifeLabel}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Decay constant λ</span><span>{result.lambda.toExponential(4)} s⁻¹</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Mean lifetime 1/λ</span><span>{niceNumber((result.halfSeconds / Math.LN2) / unitOf(halfUnit).seconds)} {halfUnit}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Fraction remaining</span><span className="text-cyan-j">{(result.remainingFraction * 100).toFixed(4)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Activity remaining</span><span className="text-cyan-j">{result.activityLabel(result.remainingActivity)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Disintegrations per second</span><span>{result.remainingActivity.toExponential(3)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Time to {target}%</span><span>{result.timeToTargetLabel}</span></div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Every half-life, step by step</div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card">
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Half-lives</th>
                <th className="py-1 text-right font-medium">Remaining</th>
                <th className="py-1 text-right font-medium">Activity</th>
                <th className="py-1 text-right font-medium">Elapsed time</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {result.milestones.map((row) => (
                <tr key={row.count} className="border-t border-border/50">
                  <td className="py-1">{row.count}</td>
                  <td className="py-1 text-right text-cyan-j">{row.percent < 1 ? row.percent.toFixed(4) : row.percent.toFixed(2)}%</td>
                  <td className="py-1 text-right">{result.activityLabel(row.activity)}</td>
                  <td className="py-1 text-right text-muted-foreground">
                    {niceNumber(row.time / unitOf(halfUnit).seconds)} {halfUnit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Ten half-lives leaves about a thousandth of the original. Radiation protection treats that as the practical end of a source: the activity is low enough to
          be handled as ordinary waste rather than a controlled one.
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Half-life" value={result.halfLifeLabel} mono />
        <Stat label="λ" value={result.lambda.toExponential(3)} mono sub="per second" />
        <Stat label="Elapsed" value={result.halfLives.toFixed(3)} mono sub="half-lives" />
        <Stat label="Remaining" value={(result.remainingFraction * 100).toFixed(3) + '%'} mono sub={result.activityLabel(result.remainingActivity)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading a half-life correctly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Half-life is the time for half of what is currently there to decay. It describes the sample, not the isotope in the abstract — every gram behaves identically.</p>
            <p>· Decay is exponential, so the sample never reaches zero. After ten half-lives a thousandth remains; after twenty, a millionth. Those last traces are why decommissioning has a timescale rather than a finishing line.</p>
            <p>· The decay constant and the half-life carry the same information. λ = ln2 ÷ T½ is the bridge between the two, and activity always equals λ times the number of atoms.</p>
            <p>· A short half-life means a very intense source. Tc-99m at six hours is why it is prepared on site and used the same day.</p>
            <p>· Carbon-14 in a living thing is replenished, so its clock only starts at death. That is the whole basis of radiocarbon dating.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Units people mix up</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Activity measures decays per second — becquerel, or curie at 3.7 × 10¹⁰ Bq. It says nothing on its own about the dose a person receives.</p>
            <p>· Dose is absorbed energy per kilogram — gray, or sievert once weighted for biological harm. The same activity in different isotopes gives wildly different doses.</p>
            <p>· Half-life, biological half-life and effective half-life differ: the last combines radioactive decay with how quickly the body clears the substance.</p>
            <p>· Mass and activity are linked through λ. For a long half-life, a tiny activity can mean an enormous number of atoms — this is what makes long-lived isotopes persist.</p>
            <p>· Background radiation is always present and is not zero. Comparisons at the thousandth-of-original level are usually against background rather than against nothing.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Isotope', value: isotope },
                { label: 'Decay constant', value: result.lambda.toExponential(2) },
                { label: 'Half-lives', value: result.halfLives.toFixed(2) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>λ = ln2 ÷ T½</p>
          <p>N(t) = N₀ × e^(−λt) · A(t) = A₀ × e^(−λt)</p>
          <p>Half-lives elapsed = t ÷ T½</p>
          <p>t to reach a fraction f = ln(1 ÷ f) ÷ λ</p>
          <p className="text-cyan-j">e^(−λ × t) = {(result.remainingFraction).toExponential(4)} for this input, which is the same as 0.5^{result.halfLives.toFixed(3)}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Everything here follows from one decay constant, so the fraction remaining, the activity and the milestone table can never disagree with each other. The
          isotope buttons only fill in a published half-life — every figure afterwards is computed from it.
        </p>
      </Panel>
    </ToolShell>
  );
}