import { useMemo, useState } from 'react';
import { Footprints } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const DISTANCES = [
  { key: 'mile', label: '1 mile', km: 1.60934 },
  { key: '5k', label: '5 km', km: 5 },
  { key: '10k', label: '10 km', km: 10 },
  { key: '10mile', label: '10 miles', km: 16.0934 },
  { key: 'half', label: 'Half marathon', km: 21.0975 },
  { key: '30k', label: '30 km', km: 30 },
  { key: 'marathon', label: 'Marathon', km: 42.195 },
];

const formatTime = (totalSeconds) => {
  const value = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return (hours ? hours + ':' + String(minutes).padStart(2, '0') : String(minutes)) + ':' + String(seconds).padStart(2, '0');
};

const formatPace = (secondsPerKm) => {
  const perMile = secondsPerKm * 1.60934;
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  const mileMinutes = Math.floor(perMile / 60);
  const mileSeconds = Math.round(perMile % 60);
  return minutes + ':' + String(seconds).padStart(2, '0') + ' /km · ' + mileMinutes + ':' + String(mileSeconds).padStart(2, '0') + ' /mi';
};

export default function RacePredictor() {
  const [distanceKey, setDistanceKey] = useState('10k');
  const [customKm, setCustomKm] = useState('12');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('45');
  const [seconds, setSeconds] = useState('30');
  const [exponent, setExponent] = useState('1.06');
  const [goalKey, setGoalKey] = useState('half');

  const result = useMemo(() => {
    const custom = Math.max(0.5, Number(customKm) || 12);
    const fromKm = distanceKey === 'custom' ? custom : (DISTANCES.find((entry) => entry.key === distanceKey) || DISTANCES[2]).km;
    const time = Math.max(60, (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0));
    const exp = Math.max(1, Math.min(1.2, Number(exponent) || 1.06));

    const predictions = DISTANCES.map((entry) => {
      const predicted = time * Math.pow(entry.km / fromKm, exp);
      const pace = predicted / entry.km;
      return {
        ...entry,
        seconds: predicted,
        time: formatTime(predicted),
        pace: formatPace(pace),
        paceSeconds: pace,
        equivalentKm: entry.km,
      };
    });

    const velocity = fromKm * 1000 / (time / 60);
    const minutesRun = time / 60;
    const vo2AtVelocity = -4.60 + 0.182258 * velocity + 0.000104 * velocity * velocity;
    const percentMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * minutesRun) + 0.2989558 * Math.exp(-0.1932605 * minutesRun);
    const vdot = percentMax > 0 ? vo2AtVelocity / percentMax : vo2AtVelocity;

    const velocityAtFraction = (fraction) => {
      const target = fraction * vdot;
      const a = 0.000104;
      const b = 0.182258;
      const c = -(4.60 + target);
      return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    };

    const trainingPaces = [
      { label: 'Easy and recovery', fraction: 0.65, note: 'conversational, most of your weekly volume' },
      { label: 'Marathon effort', fraction: 0.79, note: 'steady, controlled, sustainable for hours' },
      { label: 'Threshold', fraction: 0.88, note: 'comfortably hard, twenty to forty minutes at a time' },
      { label: 'Interval, VO2 max', fraction: 0.98, note: 'three to five minute repeats with equal recovery' },
      { label: 'Repetition', fraction: 1.08, note: 'short and fast, full recovery, form work' },
    ].map((entry) => {
      const velocityValue = velocityAtFraction(entry.fraction);
      const paceSeconds = velocityValue > 0 ? 1000 / velocityValue * 60 : 0;
      return { ...entry, paceSeconds, pace: formatPace(paceSeconds), perMile: paceSeconds * 1.60934 };
    });

    const goal = DISTANCES.find((entry) => entry.key === goalKey) || DISTANCES[4];
    const goalTime = time * Math.pow(goal.km / fromKm, exp);
    const goalRow = predictions.find((entry) => entry.key === goalKey) || predictions[4];
    const splits = Array.from({ length: 8 }, (unusedValue, index) => {
      const fraction = (index + 1) / 8;
      const cumulative = goalTime * fraction;
      return {
        label: Math.round(fraction * goal.km) + ' km',
        value: Number((cumulative / 60).toFixed(1)),
      };
    });

    const report = [
      'From ' + (distanceKey === 'custom' ? custom + ' km' : (DISTANCES.find((entry) => entry.key === distanceKey) || {}).label) + ' in ' + formatTime(time),
      'Pace ' + formatPace(time / fromKm),
      '',
      'Predictions (Riegel exponent ' + exp + '):',
      ...predictions.map((entry) => '  ' + entry.label.padEnd(16, ' ') + entry.time.padEnd(10, ' ') + entry.pace),
      '',
      'Equivalent VO2 max estimate (Daniels VDOT): ' + vdot.toFixed(1),
      '',
      'Training paces:',
      ...trainingPaces.map((entry) => '  ' + entry.label.padEnd(22, ' ') + entry.perMile.toFixed(0) + ' s per mile · ' + entry.pace),
      '',
      'Goal: ' + goal.label + ' in ' + formatTime(goalTime) + ' at ' + goalRow.pace,
    ].join('\n');

    return {
      predictions, fromKm, time, exp, vdot, trainingPaces, goalTime, goalRow, goal, splits, report,
      predictionChart: predictions.map((entry) => ({ label: entry.label.replace(' marathon', '').replace('Half', 'Half'), value: Number((entry.seconds / 60).toFixed(1)) })),
      paceChart: trainingPaces.map((entry) => ({ label: entry.label.split(' ')[0], value: Number(entry.perMile.toFixed(0)) })),
    };
  }, [distanceKey, customKm, hours, minutes, seconds, exponent, goalKey]);

  return (
    <ToolShell
      toolId="race-predictor"
      icon={Footprints}
      title="Race Time Predictor & Training Paces"
      desc="One honest recent effort into predicted times at every standard distance, your equivalent VO2 max, and the easy, marathon, threshold, interval and repetition paces that follow from it."
      state={{ distanceKey, customKm, hours, minutes, seconds, exponent, goalKey }}
      onRestore={(restored) => {
        if (restored.distanceKey) setDistanceKey(restored.distanceKey);
        if (restored.customKm !== undefined) setCustomKm(String(restored.customKm));
        if (restored.hours !== undefined) setHours(String(restored.hours));
        if (restored.minutes !== undefined) setMinutes(String(restored.minutes));
        if (restored.seconds !== undefined) setSeconds(String(restored.seconds));
        if (restored.exponent !== undefined) setExponent(String(restored.exponent));
        if (restored.goalKey) setGoalKey(restored.goalKey);
      }}
      exportText={result.report}
      exportName="race-predictions.txt"
    >
      <Field label="Distance of your recent effort">
        <select value={distanceKey} onChange={(e) => setDistanceKey(e.target.value)} className="h-9 w-full max-w-md rounded-md border border-input bg-transparent px-2 text-sm">
          {DISTANCES.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          <option value="custom">Custom distance</option>
        </select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-5">
        {distanceKey === 'custom' && (
          <Field label="Distance, km"><input value={customKm} onChange={(e) => setCustomKm(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        )}
        <Field label="Hours"><input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Minutes"><input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Seconds"><input value={seconds} onChange={(e) => setSeconds(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Fatigue exponent"><input value={exponent} onChange={(e) => setExponent(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Equivalent VO2 max"
          value={result.vdot.toFixed(1)}
          unit="ml/kg/min"
          sub={'Estimated from ' + formatTime(result.time) + ' over ' + result.fromKm.toFixed(2) + ' km, which is ' + formatPace(result.time / result.fromKm) + '. The estimate holds only if the effort was genuinely maximal — a comfortable hard run will read low.'}
        />
        <Ring
          value={result.vdot}
          max={80}
          tone={result.vdot > 55 ? 'emerald' : result.vdot > 45 ? 'cyan' : 'amber'}
          label="Fitness estimate"
          sub={result.vdot > 55 ? 'Strong club-level aerobic fitness' : result.vdot > 45 ? 'Solid recreational runner' : result.vdot > 35 ? 'Building a base' : 'A short history of running, or a very recent restart'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Predicted times at every standard distance</span>
          <CopyBtn value={result.report} label="Copy the table" />
        </div>
        <div className="space-y-1.5">
          {result.predictions.map((entry) => (
            <div key={entry.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="w-28 text-[11px]">{entry.label}</span>
              <span className="font-mono-j text-[12px] text-cyan-j">{entry.time}</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">{entry.pace}</span>
              <span className="ml-auto font-mono-j text-[10px] text-muted-foreground">
                {(entry.seconds / 3600).toFixed(2)} h
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The exponent of {result.exp} is Riegel's fatigue factor. Distances near your recent effort are the most reliable; a marathon predicted from a 5 km is optimistic by
          several minutes in practice.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Predicted time by distance</div>
          <Bars data={result.predictionChart} format={(value) => value.toFixed(0) + ' min'} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Prediction grows slightly faster than distance, because longer races slow everyone down. The curve steepening at the marathon is not a bug — it is endurance fatigue.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Training paces from this fitness</div>
          <div className="space-y-1.5">
            {result.trainingPaces.map((entry) => (
              <div key={entry.label} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{entry.label}</span>
                  <span className="ml-auto font-mono-j text-cyan-j">{entry.pace}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">{entry.note}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Training pace comparison, seconds per mile</div>
          <Bars data={result.paceChart} format={(value) => String(value)} suffix=" s" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Most runners run their easy days too fast and their hard days too slow. If these bars look too slow for your easy runs, that is the point of them.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Race plan for your target</div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select value={goalKey} onChange={(e) => setGoalKey(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs">
              {DISTANCES.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
            <span className="font-mono-j text-[11px] text-cyan-j">{formatTime(result.goalTime)}</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{result.goalRow.pace}</span>
          </div>
          <div className="space-y-1">
            {result.splits.map((entry) => (
              <div key={entry.label} className="flex items-center justify-between font-mono-j text-[11px]">
                <span className="text-muted-foreground">{entry.label}</span>
                <span>{entry.value.toFixed(1)} min</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Even splits are the fastest strategy for almost everyone. Going out fast buys seconds early and pays for them with minutes in the last third.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Recent effort" value={formatTime(result.time)} mono sub={result.fromKm.toFixed(2) + ' km'} />
        <Stat label="Equivalent 5 km" value={(result.predictions.find((entry) => entry.key === '5k') || {}).time || '—'} mono sub="predicted" />
        <Stat label="Equivalent marathon" value={(result.predictions.find((entry) => entry.key === 'marathon') || {}).time || '—'} mono sub="optimistic if new to the distance" />
        <Stat label="Easy pace" value={result.trainingPaces[0] ? result.trainingPaces[0].pace : '—'} mono sub="where most volume belongs" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Using the prediction honestly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· It works from one maximal effort. A training run, a hilly course or a hot day all produce a slower time and a lower prediction than you deserve.</p>
            <p>· Short-to-long predictions are more reliable than long-to-short. A marathon time predicts a 5 km badly; a 10 km time predicts a marathon reasonably.</p>
            <p>· Add a few minutes for a course with hills, and more for heat above about 20 °C. Both slow everyone, and neither is a fitness problem.</p>
            <p>· Distances you have never raced are the least reliable, because pacing and fuelling matter as much as fitness beyond the half marathon.</p>
            <p>· Marathon prediction assumes adequate mileage. On 40 km a week, the last 10 km will not go as the arithmetic suggests.</p>
            <p>· Use the prediction as a pacing target, not as a guaranteed result. Starting at the predicted pace and holding it is itself an achievement.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting faster, in order of return</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· More easy volume. Almost every runner who improves does so by running more, mostly slowly. The easy pace above is where that happens.</p>
            <p>· One threshold session a week, twenty to forty minutes of work at the threshold pace above, in blocks.</p>
            <p>· One interval session a week, three to five minute repetitions at the interval pace, with genuine recovery between them.</p>
            <p>· Consistency across months beats intensity across weeks. Three sessions a week for a year outperforms six sessions for two months.</p>
            <p>· Strength work twice a week for the hips and calves, plus strides for neuromuscular sharpness, which is nearly free speed.</p>
            <p>· Re-test with a race or a time trial every six to eight weeks. The paces here should move, and if they do not, the training has not changed enough.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'VDOT', value: result.vdot.toFixed(1) },
                { label: 'Threshold', value: result.trainingPaces[2] ? result.trainingPaces[2].pace.split(' · ')[0] : '—' },
                { label: 'Goal', value: formatTime(result.goalTime) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>Riegel: predicted time = known time × (new distance ÷ known distance) ^ {result.exp}</p>
          <p>velocity in metres per minute = distance in metres ÷ minutes run</p>
          <p>oxygen cost of running: VO2 = −4.60 + 0.182258 v + 0.000104 v²</p>
          <p>fraction of maximum sustainable: 0.8 + 0.1894393 e^(−0.012778 t) + 0.2989558 e^(−0.1932605 t), with t in minutes</p>
          <p>VDOT = VO2 at race pace ÷ fraction of maximum</p>
          <p>training velocity solved from the same quadratic at 65%, 79%, 88%, 98% and 108% of VDOT</p>
          <p className="text-cyan-j">Check: {result.fromKm.toFixed(2)} km in {formatTime(result.time)} gives {result.vdot.toFixed(1)} ml/kg/min.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Riegel's formula and the Daniels VDOT equations are well-established training tools, but both assume a maximal, evenly paced effort on a flat course. Treat the numbers
          as pacing targets rather than as certainties.
        </p>
      </Panel>
    </ToolShell>
  );
}