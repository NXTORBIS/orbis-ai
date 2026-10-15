import { useMemo, useState } from 'react';
import { HeartPulse, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const CATEGORIES = [
  { id: 'low', label: 'Low', colour: '#38bdf8', test: (s, d) => s < 90 || d < 60 },
  { id: 'normal', label: 'Normal', colour: '#34d399', test: (s, d) => s < 120 && d < 80 },
  { id: 'elevated', label: 'Elevated', colour: '#facc15', test: (s, d) => s >= 120 && s < 130 && d < 80 },
  { id: 'stage1', label: 'Stage 1', colour: '#fb923c', test: (s, d) => (s >= 130 && s < 140) || (d >= 80 && d < 90) },
  { id: 'stage2', label: 'Stage 2', colour: '#f87171', test: (s, d) => (s >= 140 && s < 181) || (d >= 90 && d < 121) },
  { id: 'crisis', label: 'Crisis', colour: '#e11d48', test: (s, d) => s > 180 || d > 120 },
];

const categorise = (systolic, diastolic) => {
  if (systolic > 180 || diastolic > 120) return CATEGORIES[5];
  if (systolic >= 140 || diastolic >= 90) return CATEGORIES[4];
  if ((systolic >= 130 && systolic < 140) || (diastolic >= 80 && diastolic < 90)) return CATEGORIES[3];
  if (systolic >= 120 && systolic < 130 && diastolic < 80) return CATEGORIES[2];
  if (systolic < 90 || diastolic < 60) return CATEGORIES[0];
  return CATEGORIES[1];
};

const blank = () => ({ id: Math.random().toString(36).slice(2), systolic: '', diastolic: '', pulse: '', when: 'morning' });

export default function BloodPressureTracker() {
  const [readings, setReadings] = useState([
    { id: 'a', systolic: '132', diastolic: '84', pulse: '74', when: 'morning' },
    { id: 'b', systolic: '128', diastolic: '81', pulse: '71', when: 'evening' },
    { id: 'c', systolic: '126', diastolic: '79', pulse: '69', when: 'morning' },
    { id: 'd', systolic: '121', diastolic: '76', pulse: '68', when: 'evening' },
    { id: 'e', systolic: '119', diastolic: '74', pulse: '66', when: 'morning' },
  ]);

  const set = (id, key, value) => setReadings((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const rows = readings
      .map((row) => ({
        ...row,
        systolic: Number(row.systolic) || 0,
        diastolic: Number(row.diastolic) || 0,
        pulse: Number(row.pulse) || 0,
      }))
      .filter((row) => row.systolic > 0 && row.diastolic > 0);

    const count = rows.length;
    const average = (key) => (count ? rows.reduce((sum, row) => sum + row[key], 0) / count : 0);
    const avgSystolic = average('systolic');
    const avgDiastolic = average('diastolic');
    const avgPulse = average('pulse');
    const withCategory = rows.map((row) => ({ ...row, category: categorise(row.systolic, row.diastolic) }));
    const averageCategory = count ? categorise(avgSystolic, avgDiastolic) : CATEGORIES[1];

    const morning = withCategory.filter((row) => row.when === 'morning');
    const evening = withCategory.filter((row) => row.when === 'evening');
    const morningAverage = morning.length ? morning.reduce((sum, row) => sum + row.systolic, 0) / morning.length : 0;
    const eveningAverage = evening.length ? evening.reduce((sum, row) => sum + row.systolic, 0) / evening.length : 0;

    const half = Math.floor(count / 2);
    const firstHalf = half ? rows.slice(0, half).reduce((sum, row) => sum + row.systolic, 0) / half : 0;
    const secondHalf = half ? rows.slice(count - half).reduce((sum, row) => sum + row.systolic, 0) / half : 0;
    const trend = secondHalf - firstHalf;

    const tally = CATEGORIES.map((category) => ({
      ...category,
      count: withCategory.filter((row) => row.category.id === category.id).length,
    }));

    return {
      rows: withCategory, count, avgSystolic, avgDiastolic, avgPulse, averageCategory, tally,
      highest: count ? Math.max(...rows.map((row) => row.systolic)) : 0,
      lowest: count ? Math.min(...rows.map((row) => row.systolic)) : 0,
      pulsePressure: avgSystolic - avgDiastolic,
      map: avgSystolic && avgDiastolic ? (avgSystolic + 2 * avgDiastolic) / 3 : 0,
      morningAverage, eveningAverage, trend, crisis: withCategory.some((row) => row.category.id === 'crisis'),
      inRange: withCategory.filter((row) => row.category.id === 'normal' || row.category.id === 'elevated').length,
      chart: withCategory.map((row, index) => ({ label: String(index + 1), value: row.systolic })),
    };
  }, [readings]);

  const report = useMemo(() => [
    result.count + ' readings · average ' + result.avgSystolic.toFixed(0) + '/' + result.avgDiastolic.toFixed(0) + ' mmHg (' + result.averageCategory.label + ')',
    'Average pulse ' + result.avgPulse.toFixed(0) + ' bpm · pulse pressure ' + result.pulsePressure.toFixed(0) + ' · mean arterial pressure ' + result.map.toFixed(0),
    'Systolic range ' + result.lowest + ' to ' + result.highest + ' mmHg',
    'Trend across the readings: ' + (result.trend >= 0 ? 'up ' : 'down ') + Math.abs(result.trend).toFixed(1) + ' mmHg systolic on average',
    '',
    ...result.rows.map((row, index) => (index + 1) + '. ' + row.systolic + '/' + row.diastolic + ' · pulse ' + (row.pulse || '—') + ' · ' + row.when + ' · ' + row.category.label),
    '',
    'This is a personal log, not a diagnosis. Discuss any pattern with a clinician.',
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="blood-pressure"
      icon={HeartPulse}
      title="Blood Pressure Log & Categories"
      desc="Log readings at home and see them categorised, averaged and tracked over time, with pulse pressure, morning against evening, and the measurement habits that make the numbers trustworthy."
      state={{ readings }}
      onRestore={(restored) => {
        if (Array.isArray(restored.readings) && restored.readings.length) setReadings(restored.readings);
      }}
      exportText={report}
      exportName="blood-pressure.txt"
    >
      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Readings</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.count} logged</span>
        </div>
        <div className="space-y-2">
          {readings.map((row) => {
            const category = categorise(Number(row.systolic) || 0, Number(row.diastolic) || 0);
            return (
              <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-6">
                <Field label="Systolic"><input value={row.systolic} onChange={(e) => set(row.id, 'systolic', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Diastolic"><input value={row.diastolic} onChange={(e) => set(row.id, 'diastolic', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Pulse"><input value={row.pulse} onChange={(e) => set(row.id, 'pulse', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Time">
                  <select value={row.when} onChange={(e) => set(row.id, 'when', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                    <option value="morning">Morning</option>
                    <option value="evening">Evening</option>
                  </select>
                </Field>
                <div className="flex items-end">
                  <span className="rounded-md border px-2 py-1 text-[10px]" style={{ borderColor: category.colour + '80', color: category.colour, backgroundColor: category.colour + '1a' }}>{category.label}</span>
                </div>
                <div className="flex items-end">
                  <button type="button" onClick={() => setReadings((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => setReadings((current) => [...current, blank()])} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Plus className="h-3.5 w-3.5" /> Add a reading
        </button>
      </Panel>

      {result.crisis && (
        <Panel className="!p-3 !border-rose-400/50">
          <p className="text-[11px] text-rose-200">
            One of these readings is in the crisis range of over 180 systolic or over 120 diastolic. A reading that high should be rechecked after a few minutes of rest, and
            if it stays there it is a reason to seek medical advice promptly rather than log it and wait.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.averageCategory.id === 'crisis' || result.averageCategory.id === 'stage2' ? 'rose' : result.averageCategory.id === 'stage1' ? 'amber' : 'emerald'}
          label="Average of your readings"
          value={result.avgSystolic.toFixed(0) + '/' + result.avgDiastolic.toFixed(0)}
          unit="mmHg"
          sub={'Mean arterial pressure ' + result.map.toFixed(0) + ' mmHg and pulse pressure ' + result.pulsePressure.toFixed(0) + '. That average sits in the ' + result.averageCategory.label.toLowerCase() + ' band. ' + result.count + ' readings, ' + (result.trend >= 0 ? 'rising' : 'falling') + ' by ' + Math.abs(result.trend).toFixed(1) + ' mmHg across the log.'}
        />
        <Ring
          value={result.avgSystolic}
          max={200}
          tone={result.avgSystolic >= 140 ? 'rose' : result.avgSystolic >= 130 ? 'amber' : 'emerald'}
          label="Systolic against 140"
          sub={result.avgSystolic >= 140 ? 'Above the usual treatment threshold for repeated home readings' : 'Below 140, which is where most home targets sit'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Systolic across your readings</div>
          <Bars data={result.chart} format={(value) => String(value)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Single readings bounce around by 10 mmHg or more with stress, caffeine, a full bladder or talking during the measurement. The trend across many readings is the
            signal; any one point is mostly noise.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">In each band</span>
            <CopyBtn value={report} label="Copy the log" />
          </div>
          <div className="space-y-1.5">
            {result.tally.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 text-[11px]">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.colour }} />
                <span className="w-20">{entry.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: (result.count ? (entry.count / result.count) * 100 : 0) + '%', backgroundColor: entry.colour }} />
                </div>
                <span className="w-6 text-right font-mono-j">{entry.count}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Morning average systolic</span><span>{result.morningAverage ? result.morningAverage.toFixed(1) : '—'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Evening average systolic</span><span>{result.eveningAverage ? result.eveningAverage.toFixed(1) : '—'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Average pulse</span><span>{result.avgPulse ? result.avgPulse.toFixed(0) + ' bpm' : '—'}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Average" value={result.avgSystolic.toFixed(0) + '/' + result.avgDiastolic.toFixed(0)} mono sub={result.averageCategory.label} />
        <Stat label="Highest systolic" value={String(result.highest)} mono sub={'lowest ' + result.lowest} />
        <Stat label="Pulse pressure" value={result.pulsePressure.toFixed(0)} mono sub="systolic minus diastolic" />
        <Stat label="In normal or elevated" value={result.count ? Math.round((result.inRange / result.count) * 100) + '%' : '—'} mono sub={result.inRange + ' of ' + result.count} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How to measure so the numbers mean something</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Sit quietly for five minutes first, back supported, feet flat, legs uncrossed. Even two minutes of proper rest can move a reading by several points.</p>
            <p>· Arm resting on a table with the cuff at heart level. An arm hanging lower reads higher.</p>
            <p>· No caffeine, smoking or exercise in the previous 30 minutes, and empty your bladder first.</p>
            <p>· Take two readings a minute apart and use the second. Do not talk during the measurement.</p>
            <p>· Use the same arm, the same cuff and roughly the same time each day. Morning and evening readings differ naturally.</p>
            <p>· Log a week rather than a day. Guidelines look at averages across several days precisely because single readings are unreliable.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading the categories honestly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Home readings tend to run a few points lower than clinic readings. Some guidance treats 135/85 at home as the equivalent of 140/90 in a clinic.</p>
            <p>· One high reading is not a diagnosis; sustained elevation across days is what matters, which is exactly what this log shows.</p>
            <p>· The lower number matters as much as the higher one. Stage 2 starts at 90 diastolic even with a perfectly normal systolic.</p>
            <p>· Pulse pressure of about 40 is typical. A very wide gap is worth mentioning to a clinician, especially with age.</p>
            <p>· {result.trend < -2 ? 'The trend here is downwards, which is the direction that matters most in a home log.' : result.trend > 2 ? 'The trend here is upwards across the log — worth discussing rather than waiting for more data.' : 'The trend is flat across the log, which is the steady pattern a clinician would want to see.'}</p>
            <p>· Bring the log to an appointment. A week of home readings is far more useful than a single measurement taken in a consulting room.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Readings', value: String(result.count) },
                { label: 'Average', value: result.avgSystolic.toFixed(0) + '/' + result.avgDiastolic.toFixed(0) },
                { label: 'Band', value: result.averageCategory.label },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The categories used here</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {CATEGORIES.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.colour }} />
              <span className="w-20">{entry.label}</span>
              <span className="font-mono-j text-muted-foreground">
                {entry.id === 'low' && 'under 90 or under 60'}
                {entry.id === 'normal' && 'under 120 and under 80'}
                {entry.id === 'elevated' && '120 to 129 and under 80'}
                {entry.id === 'stage1' && '130 to 139 or 80 to 89'}
                {entry.id === 'stage2' && '140 and above or 90 and above'}
                {entry.id === 'crisis' && 'over 180 or over 120'}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Thresholds follow the widely used American Heart Association bands, applied to readings taken in a seated resting position. Other bodies of guidance use slightly
          different cut-offs, so treat the label as orientation rather than a verdict.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This tool organises and categorises numbers you enter. It does not diagnose anything, it cannot account for medication, pregnancy or other conditions, and it is not
          a substitute for a clinician. If readings are consistently in stage 2 or a crisis reading appears, that is a conversation to have with a doctor rather than a log to
          keep adding to quietly.
        </p>
      </Panel>
    </ToolShell>
  );
}