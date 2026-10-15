import { useMemo, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const formatTime = (seconds) => {
  const value = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return minutes + ':' + String(remainder).padStart(2, '0');
};

const FITNESS = [
  { max: 30, label: 'Below average', note: 'Any regular aerobic activity will move this quickly at first.' },
  { max: 38, label: 'Average', note: 'A reasonable base. Structured intervals are the next step.' },
  { max: 45, label: 'Above average', note: 'Comfortably fit. Two hard sessions a week will keep improving this.' },
  { max: 52, label: 'Good', note: 'Strong aerobic fitness for a recreational athlete.' },
  { max: 60, label: 'Excellent', note: 'Competitive club level. Gains now need real structure and volume.' },
  { max: 200, label: 'Elite', note: 'At this level, performance is limited by training specifics, not general fitness.' },
];

export default function Vo2MaxEstimator() {
  const [method, setMethod] = useState('resting');
  const [age, setAge] = useState('34');
  const [restingHr, setRestingHr] = useState('52');
  const [maxHr, setMaxHr] = useState('');
  const [sex, setSex] = useState('unspecified');
  const [testMinutes, setTestMinutes] = useState('11');
  const [testSeconds, setTestSeconds] = useState('30');
  const [testDistance, setTestDistance] = useState('2400');
  const [weight, setWeight] = useState('72');
  const [walkMinutes, setWalkMinutes] = useState('13');
  const [walkSeconds, setWalkSeconds] = useState('40');

  const result = useMemo(() => {
    const ageValue = Math.max(10, Math.min(90, Number(age) || 34));
    const estimatedMaxHr = 208 - 0.7 * ageValue;
    const hrMax = Math.max(120, Number(maxHr) || estimatedMaxHr);
    const hrRest = Math.max(30, Math.min(100, Number(restingHr) || 52));
    const kg = Math.max(30, Number(weight) || 72);

    const methods = {
      resting: {
        label: 'Resting heart rate ratio',
        vo2: 15.3 * (hrMax / hrRest),
        note: 'Uses the ratio of maximum to resting heart rate. Convenient but the roughest of the three.',
      },
      cooper: {
        label: '12 minute run',
        vo2: (Math.max(800, Number(testDistance) || 2400) - 504.9) / 44.73,
        note: 'The classic Cooper test: how far you cover in exactly twelve minutes, at a genuinely hard effort.',
      },
      rockport: {
        label: 'One mile walk',
        vo2: 132.853 - (0.0769 * kg / 2.20462) - (0.3877 * ageValue) + (6.315 * (sex === 'male' ? 1 : 0)) - (3.2649 * (Number(walkMinutes) || 13)) - (0.1565 * (Number(walkSeconds) || 40)),
        note: 'The Rockport one-mile walk. Walk as fast as you can without jogging, and time it precisely.',
      },
      race: {
        label: 'Recent race time',
        vo2: (() => {
          const minutes = Math.max(8, Number(testMinutes) || 11) + (Number(testSeconds) || 0) / 60;
          const velocity = 5000 / minutes;
          const cost = -4.6 + 0.182258 * velocity + 0.000104 * velocity * velocity;
          const percentMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);
          return cost / percentMax;
        })(),
        note: 'From a 5 km race time, using the Daniels and Gilbert oxygen-cost equations. The most accurate of the four when the race was maximal.',
      },
    };

    const active = methods[method] || methods.resting;
    const vo2 = Math.max(15, Math.min(90, active.vo2));

    const fitness = FITNESS.find((entry) => vo2 <= entry.max) || FITNESS[FITNESS.length - 1];

    const reserve = hrMax - hrRest;
    const zones = [
      { label: 'Zone 1 recovery', low: 0.5, high: 0.6, note: 'very light, warm-ups and cool-downs' },
      { label: 'Zone 2 aerobic', low: 0.6, high: 0.7, note: 'most of your weekly volume' },
      { label: 'Zone 3 tempo', low: 0.7, high: 0.8, note: 'steady and controlled' },
      { label: 'Zone 4 threshold', low: 0.8, high: 0.9, note: 'comfortably hard, twenty to forty minutes' },
      { label: 'Zone 5 maximum', low: 0.9, high: 1, note: 'short intervals only' },
    ].map((zone) => ({
      ...zone,
      lowBpm: Math.round(hrRest + zone.low * reserve),
      highBpm: Math.round(hrRest + zone.high * reserve),
      percentLow: Math.round(zone.low * 100),
      percentHigh: Math.round(zone.high * 100),
    }));

    const raceTimeForVo2 = (targetVo2) => {
      for (let minutes = 10; minutes <= 300; minutes += 0.05) {
        const distance = minutes === 10 ? 5000 : 5000;
        const velocity = distance / minutes;
        const cost = -4.6 + 0.182258 * velocity + 0.000104 * velocity * velocity;
        const percentMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);
        if (cost / percentMax <= targetVo2) return minutes * 60;
      }
      return 0;
    };

    const predicted5k = raceTimeForVo2(vo2);
    const paces = [
      { label: 'Easy', fraction: 0.65 },
      { label: 'Steady', fraction: 0.79 },
      { label: 'Threshold', fraction: 0.88 },
      { label: 'Interval', fraction: 0.98 },
    ].map((entry) => {
      const target = entry.fraction * vo2;
      const a = 0.000104;
      const b = 0.182258;
      const c = -(4.6 + target);
      const velocity = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
      const secondsPerKm = velocity > 0 ? (1000 / velocity) * 60 : 0;
      return { label: entry.label, value: Number((secondsPerKm * 1.60934).toFixed(0)), secondsPerKm };
    });

    const met = vo2 / 3.5;
    const weeklyMinutes = (() => {
      if (vo2 < 35) return 150;
      if (vo2 < 45) return 180;
      if (vo2 < 55) return 240;
      return 300;
    })();

    const report = [
      'Estimated VO2 max ' + vo2.toFixed(1) + ' ml/kg/min — ' + fitness.label,
      'Method: ' + active.label + '. ' + active.note,
      '',
      'Maximum heart rate ' + Math.round(hrMax) + ' bpm' + (maxHr ? ' (entered)' : ' (estimated from age as 208 − 0.7 × age)'),
      'Resting heart rate ' + hrRest + ' bpm · heart rate reserve ' + reserve + ' bpm',
      'That is ' + met.toFixed(1) + ' metabolic equivalents at maximum.',
      '',
      'Training zones from the Karvonen method:',
      ...zones.map((zone) => '  ' + zone.label.padEnd(20, ' ') + zone.lowBpm + ' to ' + zone.highBpm + ' bpm (' + zone.percentLow + ' to ' + zone.percentHigh + '% of reserve)'),
      '',
      'Equivalent 5 km: ' + formatTime(predicted5k),
      'Training paces, seconds per mile: ' + paces.map((entry) => entry.label + ' ' + entry.value).join(' · '),
      '',
      'A useful weekly volume at this level is around ' + weeklyMinutes + ' minutes of aerobic work, most of it easy.',
    ].join('\n');

    return {
      methods, active, vo2, fitness, zones, predicted5k, paces, met, weeklyMinutes, hrMax, hrRest, reserve, weight: kg, report,
      methodChart: Object.entries(methods).map(([key, value]) => ({ label: key, value: Number(Math.max(15, Math.min(90, value.vo2)).toFixed(1)) })),
      zoneChart: zones.map((zone) => ({ label: zone.label.split(' ')[1], value: zone.highBpm })),
    };
  }, [method, age, restingHr, maxHr, sex, testMinutes, testSeconds, testDistance, weight, walkMinutes, walkSeconds]);

  return (
    <ToolShell
      toolId="vo2max"
      icon={HeartPulse}
      title="VO2 Max & Training Zones"
      desc="Four validated field methods — resting heart rate, the Cooper twelve minute run, the Rockport walk and a recent 5 km — into an aerobic capacity estimate, training zones and equivalent paces."
      state={{ method, age, restingHr, maxHr, sex, testMinutes, testSeconds, testDistance, weight, walkMinutes, walkSeconds }}
      onRestore={(restored) => {
        if (restored.method) setMethod(restored.method);
        if (restored.age !== undefined) setAge(String(restored.age));
        if (restored.restingHr !== undefined) setRestingHr(String(restored.restingHr));
        if (restored.maxHr !== undefined) setMaxHr(String(restored.maxHr));
        if (restored.sex) setSex(restored.sex);
        if (restored.testMinutes !== undefined) setTestMinutes(String(restored.testMinutes));
        if (restored.testSeconds !== undefined) setTestSeconds(String(restored.testSeconds));
        if (restored.testDistance !== undefined) setTestDistance(String(restored.testDistance));
        if (restored.weight !== undefined) setWeight(String(restored.weight));
        if (restored.walkMinutes !== undefined) setWalkMinutes(String(restored.walkMinutes));
        if (restored.walkSeconds !== undefined) setWalkSeconds(String(restored.walkSeconds));
      }}
      exportText={result.report}
      exportName="vo2max.txt"
    >
      <Seg
        value={method}
        onChange={setMethod}
        options={[
          { value: 'resting', label: 'Resting heart rate' },
          { value: 'cooper', label: '12 minute run' },
          { value: 'rockport', label: 'One mile walk' },
          { value: 'race', label: 'Recent 5 km' },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Age"><input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Resting heart rate, bpm"><input value={restingHr} onChange={(e) => setRestingHr(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Maximum heart rate, bpm"><input value={maxHr} onChange={(e) => setMaxHr(e.target.value)} inputMode="numeric" placeholder="estimated if blank" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Body mass, kg"><input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      {method === 'cooper' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Distance covered in 12 minutes, m"><input value={testDistance} onChange={(e) => setTestDistance(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <div className="sm:col-span-2 flex items-end">
            <p className="text-[11px] text-muted-foreground">Track or flat measured route, all-out effort, and record the distance to the nearest 10 metres. A treadmill set to a fixed speed makes this easier to repeat.</p>
          </div>
        </div>
      )}

      {method === 'race' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="5 km time, minutes"><input value={testMinutes} onChange={(e) => setTestMinutes(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Seconds"><input value={testSeconds} onChange={(e) => setTestSeconds(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <div className="flex items-end">
            <p className="text-[11px] text-muted-foreground">Use a race or a time trial, not a training run, and not a hilly course.</p>
          </div>
        </div>
      )}

      {method === 'rockport' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Walk time, minutes"><input value={walkMinutes} onChange={(e) => setWalkMinutes(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Seconds"><input value={walkSeconds} onChange={(e) => setWalkSeconds(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Biological sex for the equation">
            <Seg value={sex} onChange={setSex} options={[{ value: 'unspecified', label: 'Not given' }, { value: 'male', label: 'Male' }]} />
          </Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Estimated VO2 max"
          value={result.vo2.toFixed(1)}
          unit="ml/kg/min"
          sub={result.fitness.label + ' — ' + result.fitness.note + ' From the ' + result.active.label.toLowerCase() + ' method. That is ' + result.met.toFixed(1) + ' metabolic equivalents, and a typical weekly aerobic volume at this level is around ' + result.weeklyMinutes + ' minutes.'}
        />
        <Ring
          value={result.vo2}
          max={75}
          tone={result.vo2 > 50 ? 'emerald' : result.vo2 > 40 ? 'cyan' : 'amber'}
          label="Aerobic capacity"
          sub={'The same estimate from every method is shown below, which is the quickest way to see how noisy these field tests really are'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The same inputs through every method</div>
          <Bars data={result.methodChart} format={(value) => value.toFixed(1)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Where the bars disagree, trust the test that actually measured performance. The resting heart rate method is convenient but swings widely with caffeine, sleep and
            stress.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Training zones, heart rate reserve</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1">
            {result.zones.map((zone) => (
              <div key={zone.label} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{zone.label}</span>
                  <span className="ml-auto font-mono-j text-cyan-j">{zone.lowBpm}–{zone.highBpm} bpm</span>
                </div>
                <div className="text-[10px] text-muted-foreground">{zone.percentLow}–{zone.percentHigh}% of reserve · {zone.note}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Zone ceilings</div>
          <Bars data={result.zoneChart} format={(value) => value + ' bpm'} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Zones from heart rate reserve, the Karvonen method, which uses your resting rate as well as your maximum. That makes them personal rather than a percentage of a
            theoretical maximum.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Equivalent training paces</div>
          <div className="space-y-1">
            {result.paces.map((entry) => (
              <div key={entry.label} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span>{entry.label}</span>
                <span className="font-mono-j text-cyan-j">{entry.value} s/mi · {formatTime(entry.secondsPerKm)} /km</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            These paces come from the same oxygen-cost equations used in the 5 km method, so they are consistent with a recent race rather than a guess.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="VO2 max" value={result.vo2.toFixed(1)} mono sub={result.fitness.label} />
        <Stat label="Equivalent 5 km" value={formatTime(result.predicted5k)} mono sub="at this capacity" />
        <Stat label="Maximum HR" value={Math.round(result.hrMax) + ' bpm'} mono sub={maxHr ? 'as entered' : 'estimated from age'} />
        <Stat label="Heart rate reserve" value={result.reserve + ' bpm'} mono sub={result.hrRest + ' resting'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Testing honestly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Measure resting heart rate properly: first thing after waking, before getting up, and take the lowest of three days rather than a single reading.</p>
            <p>· Use your true maximum, not 220 minus age. The age formula has a spread of about ten beats either way, and it is the denominator in every zone you use.</p>
            <p>· Repeat the same test the same way. A field test is only useful for tracking change if the conditions and effort are comparable.</p>
            <p>· Test when fresh. A hard session the day before will lower the result and tell you nothing about your fitness.</p>
            <p>· A lab test with gas analysis remains the only true measurement. Everything here is an estimate from performance or heart rate.</p>
            <p>· {result.vo2 > 50 ? 'At ' + result.vo2.toFixed(1) + ', further gains need structured training rather than more general activity.' : 'At ' + result.vo2.toFixed(1) + ', consistent aerobic work at zone 2 will move this number reasonably quickly.'}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What VO2 max does and does not tell you</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· It is the ceiling on aerobic performance, not the performance itself. Efficiency, threshold and pacing decide race results within that ceiling.</p>
            <p>· It is highly trainable early. Beginners often gain 15 to 20% in a few months of consistent work, then progress slows to a few percent a year.</p>
            <p>· It declines with age, roughly 1% a year after thirty in untrained people, and considerably less in those who keep training.</p>
            <p>· Muscle mass flatters it. Very muscular athletes score lower per kilogram even when their absolute capacity is high, which is why rowers and cyclists look different on paper.</p>
            <p>· Weight loss raises the per-kilogram figure without changing the engine at all. Useful for running, less so for the underlying fitness.</p>
            <p>· A high score with a poor threshold still loses races. The number is a starting point for training zones, not a ranking.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Method', value: result.active.label },
                { label: 'VO2 max', value: result.vo2.toFixed(1) },
                { label: 'Level', value: result.fitness.label },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>resting ratio: VO2 max = 15.3 × maximum heart rate ÷ resting heart rate</p>
          <p>Cooper 12 minute: VO2 max = (distance in metres − 504.9) ÷ 44.73</p>
          <p>Rockport mile: 132.853 − 0.0769 × weight in pounds − 0.3877 × age + 6.315 for male − 3.2649 × minutes − 0.1565 × seconds</p>
          <p>Daniels oxygen cost: VO2 = −4.6 + 0.182258 v + 0.000104 v², with v in metres per minute</p>
          <p>sustainable fraction: 0.8 + 0.1894393 e^(−0.012778 t) + 0.2989558 e^(−0.1932605 t), with t in minutes</p>
          <p>maximum heart rate estimate: 208 − 0.7 × age</p>
          <p>Karvonen zone: heart rate = resting + fraction × (maximum − resting)</p>
          <p className="text-cyan-j">Check: {Math.round(result.hrMax)} bpm maximum and {result.hrRest} bpm resting gives a reserve of {result.reserve} bpm.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Field estimates of aerobic capacity carry an error of roughly ten percent either way, and more for very fit or very untrained people. They are excellent for tracking
          your own change over time and poor for comparing yourself with anybody else.
        </p>
      </Panel>
    </ToolShell>
  );
}