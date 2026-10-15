import { useMemo, useState } from 'react';
import { Droplets } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Field, Panel, Seg, Stat } from './shared';

const DROP_FACTORS = [
  { value: 10, label: '10 gtt/mL — blood set' },
  { value: 15, label: '15 gtt/mL — standard adult' },
  { value: 20, label: '20 gtt/mL — standard adult' },
  { value: 60, label: '60 gtt/mL — microdrip / paediatric' },
];

const MODES = [
  { value: 'drip', label: 'Drops per minute' },
  { value: 'time', label: 'Time to finish' },
  { value: 'dose', label: 'Weight-based dose' },
  { value: 'rate', label: 'mcg/kg/min infusion' },
];

export default function IVDripRate() {
  const [mode, setMode] = useState('drip');
  const [inputs, setInputs] = useState({
    volume: 500,
    hours: 8,
    dropFactor: 20,
    rate: 60,
    weight: 70,
    dosePerKg: 15,
    frequency: 3,
    concentration: 1,
    mcgPerKgMin: 5,
    bagMg: 50,
    bagMl: 50,
  });

  const set = (key, value) => setInputs((current) => ({ ...current, [key]: value }));
  const num = (key) => Number(inputs[key]) || 0;

  const result = useMemo(() => {
    const dropFactor = Number(inputs.dropFactor) || 20;
    if (mode === 'drip') {
      const volume = num('volume');
      const hours = num('hours');
      const mlPerHour = hours > 0 ? volume / hours : 0;
      const dropsPerMinute = hours > 0 ? (volume * dropFactor) / (hours * 60) : 0;
      const minutes = hours * 60;
      return {
        hero: { value: dropsPerMinute.toFixed(1), unit: 'gtt/min', label: 'Drops per minute', sub: mlPerHour.toFixed(1) + ' mL/h' },
        rows: [
          { label: 'Rate', value: mlPerHour.toFixed(1) + ' mL/h' },
          { label: 'Drops per minute', value: dropsPerMinute.toFixed(1) + ' gtt/min' },
          { label: 'Rounded for counting', value: Math.round(dropsPerMinute) + ' gtt/min' },
          { label: 'Infusion time', value: Math.floor(minutes / 60) + ' h ' + Math.round(minutes % 60) + ' min' },
          { label: 'Seconds per drop', value: dropsPerMinute > 0 ? (60 / dropsPerMinute).toFixed(2) + ' s' : '—' },
        ],
        notes: [
          dropsPerMinute > 60 ? 'Over 60 drops a minute is hard to count reliably in a gravity set — this belongs on a pump.' : 'Countable by hand: ' + Math.round(dropsPerMinute) + ' drops in fifteen seconds is ' + Math.round(dropsPerMinute / 4) + ' drops.',
          mlPerHour > 999 ? 'Rates above 999 mL/h exceed most pump limits and need a rapid-infusion device.' : 'Most volumetric pumps top out well above this rate, so a pump is an option if one is free.',
          'Gravity sets drift as the bag empties and the patient moves. Recheck the rate every hour, and set it with the line below the bag and the clamp fully open.',
        ],
      };
    }

    if (mode === 'time') {
      const volume = num('volume');
      const rate = num('rate');
      const hours = rate > 0 ? volume / rate : 0;
      const dropsPerMinute = (rate * dropFactor) / 60;
      return {
        hero: { value: hours.toFixed(2), unit: 'hours', label: 'Time to finish', sub: Math.floor(hours) + ' h ' + Math.round((hours % 1) * 60) + ' min at ' + rate + ' mL/h' },
        rows: [
          { label: 'Volume', value: volume + ' mL' },
          { label: 'Rate', value: rate + ' mL/h' },
          { label: 'Drops per minute', value: dropsPerMinute.toFixed(1) + ' gtt/min' },
          { label: 'Finish time', value: (() => { const end = new Date(Date.now() + hours * 3600000); return end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); })() },
          { label: 'Minutes per mL', value: rate > 0 ? (60 / rate).toFixed(1) + ' min' : '—' },
        ],
        notes: [
          'Start time is now — the finish time shown is a straight rate calculation with no interruptions.',
          dropsPerMinute > 60 ? 'At this rate the set needs a pump, or a microdrip at 60 gtt/mL which makes drops and millilitres the same number.' : 'Drops per minute stay countable, so a gravity set remains practical.',
          'Charts, flushes and pauses all reset the clock. Recalculate rather than assuming the original time still holds.',
        ],
      };
    }

    if (mode === 'dose') {
      const weight = num('weight');
      const dosePerKg = num('dosePerKg');
      const frequency = num('frequency');
      const concentration = num('concentration');
      const perDoseMg = weight * dosePerKg;
      const perDoseMl = concentration > 0 ? perDoseMg / concentration : 0;
      const dailyMg = perDoseMg * frequency;
      return {
        hero: { value: perDoseMl.toFixed(2), unit: 'mL', label: 'Volume per dose', sub: perDoseMg.toFixed(1) + ' mg per dose at ' + concentration + ' mg/mL' },
        rows: [
          { label: 'Dose', value: perDoseMg.toFixed(1) + ' mg' },
          { label: 'Volume', value: perDoseMl.toFixed(2) + ' mL' },
          { label: 'Doses per day', value: String(frequency) },
          { label: 'Daily total', value: dailyMg.toFixed(1) + ' mg (' + (perDoseMl * frequency).toFixed(2) + ' mL)' },
          { label: 'Dose per kg', value: dosePerKg + ' mg/kg' },
        ],
        notes: [
          perDoseMl > 5 ? 'More than 5 mL of a single dose is a high volume for an intramuscular injection; check the route and the maximum volume for the site.' : 'Volume per dose is modest, which suits most routes.',
          'Round to what the syringe can actually measure. With a 1 mL syringe that means hundredths, not thousandths.',
          'Any paediatric or high-risk dose needs an independent double check — weight, dose, concentration and volume, by a second person.',
        ],
      };
    }

    const mcgPerKgMin = num('mcgPerKgMin');
    const weight = num('weight');
    const bagMg = num('bagMg');
    const bagMl = num('bagMl');
    const concentrationMgMl = bagMl > 0 ? bagMg / bagMl : 0;
    const mcgPerMin = mcgPerKgMin * weight;
    const mlPerHour = concentrationMgMl > 0 ? (mcgPerMin * 60) / (concentrationMgMl * 1000) : 0;
    const mgPerHour = (mcgPerMin * 60) / 1000;
    const hours = mlPerHour > 0 ? bagMl / mlPerHour : 0;
    return {
      hero: { value: mlPerHour.toFixed(2), unit: 'mL/h', label: 'Pump rate', sub: mcgPerMin.toFixed(1) + ' mcg/min · ' + mgPerHour.toFixed(2) + ' mg/h' },
      rows: [
        { label: 'Ordered rate', value: mcgPerKgMin + ' mcg/kg/min' },
        { label: 'Concentration', value: concentrationMgMl.toFixed(3) + ' mg/mL (' + (concentrationMgMl * 1000).toFixed(0) + ' mcg/mL)' },
        { label: 'Delivered per minute', value: mcgPerMin.toFixed(1) + ' mcg/min' },
        { label: 'Delivered per hour', value: mgPerHour.toFixed(2) + ' mg/h' },
        { label: 'Bag lasts', value: hours > 0 ? Math.floor(hours) + ' h ' + Math.round((hours % 1) * 60) + ' min' : '—' },
      ],
      notes: [
        'Concentration is the whole calculation. Write it on the bag label and check that it matches the syringe, or the rate will be wrong by exactly that ratio.',
        'Titrated infusions change the ordered rate. Recalculate on every change rather than scaling the old number in your head.',
        'A second check of concentration, weight and pump programming is standard practice for these drugs.',
      ],
    };
  }, [mode, inputs]);

  const report = [
    'IV calculation — ' + (MODES.find((entry) => entry.value === mode) || {}).label,
    '',
    result.hero.label + ': ' + result.hero.value + ' ' + result.hero.unit,
    result.hero.sub,
    '',
    ...result.rows.map((row) => row.label.padEnd(24) + row.value),
    '',
    ...result.notes.map((note) => '· ' + note),
  ].join('\n');

  return (
    <ToolShell
      toolId="iv-drip"
      icon={Droplets}
      title="IV Drip Rate & Dose Calculator"
      desc="Drops per minute from volume and a drop factor, the time a bag will last at a set rate, weight-based doses, and the pump rate for a mcg/kg/min infusion — with the numbers rounded the way a real syringe and set behave."
      state={{ mode, inputs }}
      onRestore={(restored) => {
        if (typeof restored.mode === 'string') setMode(restored.mode);
        if (restored.inputs && typeof restored.inputs === 'object') setInputs({ ...inputs, ...restored.inputs });
      }}
      exportText={report}
      exportName="iv-calculation.txt"
    >
      <Seg value={mode} onChange={setMode} options={MODES} size="sm" />

      <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
        <Panel className="!p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {(mode === 'drip' || mode === 'time') && (
              <>
                <Field label="Volume (mL)"><Input type="number" value={inputs.volume} onChange={(event) => set('volume', event.target.value)} /></Field>
                {mode === 'drip'
                  ? <Field label="Over how many hours"><Input type="number" step="0.5" value={inputs.hours} onChange={(event) => set('hours', event.target.value)} /></Field>
                  : <Field label="Rate (mL/h)"><Input type="number" value={inputs.rate} onChange={(event) => set('rate', event.target.value)} /></Field>}
                <Field label="Giving set">
                  <select value={String(inputs.dropFactor)} onChange={(event) => set('dropFactor', event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                    {DROP_FACTORS.map((factor) => <option key={factor.value} value={factor.value}>{factor.label}</option>)}
                  </select>
                </Field>
              </>
            )}

            {mode === 'dose' && (
              <>
                <Field label="Patient weight (kg)"><Input type="number" step="0.1" value={inputs.weight} onChange={(event) => set('weight', event.target.value)} /></Field>
                <Field label="Dose (mg per kg)"><Input type="number" step="0.1" value={inputs.dosePerKg} onChange={(event) => set('dosePerKg', event.target.value)} /></Field>
                <Field label="Doses per day"><Input type="number" value={inputs.frequency} onChange={(event) => set('frequency', event.target.value)} /></Field>
                <Field label="Concentration (mg/mL)"><Input type="number" step="0.01" value={inputs.concentration} onChange={(event) => set('concentration', event.target.value)} /></Field>
              </>
            )}

            {mode === 'rate' && (
              <>
                <Field label="Patient weight (kg)"><Input type="number" step="0.1" value={inputs.weight} onChange={(event) => set('weight', event.target.value)} /></Field>
                <Field label="Ordered rate (mcg/kg/min)"><Input type="number" step="0.1" value={inputs.mcgPerKgMin} onChange={(event) => set('mcgPerKgMin', event.target.value)} /></Field>
                <Field label="Drug in the bag (mg)"><Input type="number" step="0.1" value={inputs.bagMg} onChange={(event) => set('bagMg', event.target.value)} /></Field>
                <Field label="Bag volume (mL)"><Input type="number" value={inputs.bagMl} onChange={(event) => set('bagMl', event.target.value)} /></Field>
              </>
            )}
          </div>

          <div className="mt-3 space-y-1.5">
            {result.rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-xs">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-mono-j text-cyan-j">{row.value}</span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-3">
          <Hero tone="cyan" label={result.hero.label} value={result.hero.value} unit={result.hero.unit} sub={result.hero.sub} />

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">What that means at the bedside</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              {result.notes.map((note) => <p key={note}>· {note}</p>)}
            </div>
            <div className="mt-3">
              <Pills
                items={[
                  { label: 'Mode', value: mode },
                  { label: 'Drop factor', value: inputs.dropFactor + ' gtt/mL' },
                ]}
              />
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Worked in" value={mode === 'rate' ? 'mcg/kg/min' : mode === 'dose' ? 'mg/kg' : 'mL, hours'} mono sub="input units" />
        <Stat label="Rounding" value={mode === 'drip' ? 'whole drops' : mode === 'rate' ? 'two decimals' : 'two decimals'} mono sub="as dispensed" />
        <Stat label="Gravity set limit" value="≈ 60 gtt/min" mono sub="countable by hand" />
        <Stat label="Pump limit" value="≈ 999 mL/h" mono sub="typical volumetric pump" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The arithmetic</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Drops per minute = volume × drop factor ÷ minutes. A 500 mL bag over eight hours with a 20 gtt/mL set is 500 × 20 ÷ 480, which is 20.8, rounded to 21.</p>
            <p>· Round drops to the nearest whole number. Rounding up against a maximum dose can deliver slightly more than ordered.</p>
            <p>· Volume per hour is volume ÷ hours, and the time a bag lasts is volume ÷ rate — both straight division, no drop factor involved.</p>
            <p>· Weight-based dose in milligrams is weight × mg/kg, and the volume is that dose divided by the concentration in mg/mL.</p>
            <p>· For a mcg/kg/min infusion the pump rate in mL/h is mcg/kg/min × weight × 60 ÷ (concentration in mcg/mL). Converting the concentration to mcg/mL first avoids most errors.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the errors actually happen</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Mixing up the drop factor. A 15 gtt/mL set on a calculation done for 60 is a fourfold error, and the number alone cannot tell you which set is on the stand.</p>
            <p>· Reading a rate as mL/h when it was written as drops/min. Always carry the unit through the whole calculation.</p>
            <p>· Using measured body weight when ideal or adjusted body weight was specified, or the reverse.</p>
            <p>· Reusing a rate calculated for a different concentration — the number stays the same while the delivered drug doubles.</p>
            <p>· Rounding mid-calculation rather than at the end. Keep full precision and round only the final figure that gets set on the device.</p>
            <p>· Assuming a bag will finish when the arithmetic says so. Flushes, pauses and line changes all shift the real end time.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This is a calculation aid, not clinical advice: it does the arithmetic you would otherwise do by hand, in your units, without a rounding slip. Verify every
          figure against the prescription, the product label and local protocol, and have weight-based and high-risk doses independently checked before administration.
          Maximum doses, compatibilities and infusion limits are outside what a calculator can decide.
        </p>
      </Panel>
    </ToolShell>
  );
}