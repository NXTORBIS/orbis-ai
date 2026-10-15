import { useMemo, useState } from 'react';
import { Flame, Thermometer } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Gauge, Pills } from './kit/premium';
import { Input } from '@jarvis/components/ui/input';
import { Field, Panel, Seg, Stat } from './shared';

const CUTS = [
  {
    id: 'beef', label: 'Beef steak or roast', icon: '🥩',
    targets: [
      { label: 'Rare', c: 49, note: 'Cool red centre, soft and yielding.' },
      { label: 'Medium rare', c: 54, note: 'Warm red centre — the sweet spot for most cuts.' },
      { label: 'Medium', c: 60, note: 'Pink through, firm but still juicy.' },
      { label: 'Medium well', c: 65, note: 'Slight pink, noticeably firmer.' },
      { label: 'Well done', c: 71, note: 'No pink, dense and quick to dry out.' },
    ],
    rest: '5–10 minutes for steaks, 15–25 for a roast',
    minutesPerKg: [35, 50],
    oven: 160, safety: 63,
    safetyNote: 'Whole cuts are considered safe from 63 °C with a three-minute rest, which is why medium rare is acceptable for intact beef and not for minced beef.',
  },
  {
    id: 'lamb', label: 'Lamb', icon: '🍖',
    targets: [
      { label: 'Rare', c: 52, note: 'Deep red, very soft.' },
      { label: 'Medium rare', c: 55, note: 'Red to pink, juicy — the usual restaurant default.' },
      { label: 'Medium', c: 60, note: 'Pink throughout, firmer.' },
      { label: 'Well done', c: 71, note: 'Cooked through, best with a sauce.' },
    ],
    rest: '5–15 minutes, longer for a leg or shoulder',
    minutesPerKg: [45, 60],
    oven: 180, safety: 63,
    safetyNote: 'Whole cuts follow the same 63 °C rule as beef. Minced lamb must reach 71 °C.',
  },
  {
    id: 'pork', label: 'Pork loin or chop', icon: '🐖',
    targets: [
      { label: 'Blushing pink', c: 60, note: 'Juicy and safe — modern pork is not the old 80 °C meat.' },
      { label: 'Just cooked', c: 63, note: 'The USDA minimum, with a three-minute rest.' },
      { label: 'Firm and pale', c: 68, note: 'What happens when the old advice is followed.' },
      { label: 'Dry', c: 74, note: 'Past the point where loin has anything left to give.' },
    ],
    rest: '5–10 minutes, or 15–20 for a roast',
    minutesPerKg: [40, 50],
    oven: 180, safety: 63,
    safetyNote: '63 °C after a three-minute rest is the safe minimum. Above 68 °C the loin dries out decisively — 63 °C is both safe and far better eating.',
  },
  {
    id: 'chicken', label: 'Chicken breast', icon: '🍗',
    targets: [
      { label: 'Safe and moist', c: 71, note: 'The minimum, taken in the thickest part.' },
      { label: 'Ideal eating', c: 74, note: 'Pastry-like texture without being stringy.' },
      { label: 'Slightly dry', c: 77, note: 'Still fine sliced into a sauce.' },
      { label: 'Overcooked', c: 82, note: 'Chalky. No amount of sauce fully hides it.' },
    ],
    rest: '5–10 minutes, covered',
    minutesPerKg: [55, 70],
    oven: 190, safety: 74,
    safetyNote: '74 °C in the thickest part is the standard for poultry. Anything below 71 °C needs a holding time, which is not something to improvise at home.',
  },
  {
    id: 'turkey', label: 'Turkey', icon: '🦃',
    targets: [
      { label: 'Safe, breast only', c: 74, note: 'Take the breast out here even if the leg needs longer.' },
      { label: 'Whole bird done', c: 74, note: 'Check the thickest part of the thigh, not touching bone.' },
      { label: 'Dry', c: 79, note: 'Where whole turkeys end up without a thermometer.' },
    ],
    rest: '20–30 minutes, tented, before carving',
    minutesPerKg: [45, 60],
    oven: 170, safety: 74,
    safetyNote: 'The thigh needs 74 °C while the breast is best at 71 °C. Ice the breast or shield it with foil if the bird is large.',
  },
  {
    id: 'fish', label: 'Fish fillet', icon: '🐟',
    targets: [
      { label: 'Rare, as for tuna', c: 46, note: 'Deep sashimi red — only for fish sold as sashimi grade.' },
      { label: 'Medium', c: 52, note: 'Translucent in the middle, flaking at the edges.' },
      { label: 'Just done', c: 57, note: 'Opaque, flaky and still moist.' },
      { label: 'Overcooked', c: 63, note: 'Dry and chalky; fish has a narrow window.' },
    ],
    rest: '2–5 minutes, uncovered to keep the skin crisp',
    minutesPerKg: [18, 25],
    oven: 180, safety: 63,
    safetyNote: '63 °C is the safe minimum for fin fish. Raw preparations should only use fish handled and graded for it.',
  },
  {
    id: 'salmon', label: 'Salmon', icon: '🍣',
    targets: [
      { label: 'Rare', c: 46, note: 'Almost translucent, very soft — restaurant style.' },
      { label: 'Medium rare', c: 50, note: 'Silky centre, the most forgiving target.' },
      { label: 'Medium', c: 55, note: 'Opaque and flaking, still rich.' },
      { label: 'Well done', c: 63, note: 'Drier; the oiliness is the only thing saving it.' },
    ],
    rest: '3 minutes, on a warm plate',
    minutesPerKg: [15, 20],
    oven: 180, safety: 63,
    safetyNote: 'Farmed salmon is generally lower risk than wild; raw service still depends on grading and handling, not on the species.',
  },
  {
    id: 'shrimp', label: 'Shrimp & prawns', icon: '🦐',
    targets: [
      { label: 'Just opaque', c: 57, note: 'Pearly and curled but not tightly.' },
      { label: 'Firm', c: 63, note: 'Snappy texture, still juicy.' },
      { label: 'Rubbery', c: 70, note: 'The point where they bounce instead of bite.' },
    ],
    rest: '1–2 minutes, off the heat',
    minutesPerKg: [10, 15],
    oven: 190, safety: 63,
    safetyNote: 'Shrimp cook in about 90 seconds per side at high heat. Residual heat carries them the rest of the way.',
  },
  {
    id: 'ground', label: 'Minced meat & burgers', icon: '🍔',
    targets: [
      { label: 'Not acceptable', c: 65, note: 'Pink minced beef is a genuine risk — see the note below.' },
      { label: 'Safe minimum', c: 71, note: 'The rule for all minced meat, including beef.' },
      { label: 'Well done', c: 76, note: 'Firm, no pink, still juicy if the fat ratio is right.' },
    ],
    rest: '3–5 minutes so the juices settle',
    minutesPerKg: [0, 0],
    oven: 0, safety: 71,
    safetyNote: 'Minced meat cannot be cooked pink safely. Grinding distributes surface bacteria through the whole mass, so 71 °C is the minimum even for a burger you would like medium.',
  },
  {
    id: 'sausage', label: 'Sausages & cured pork', icon: '🌭',
    targets: [
      { label: 'Safe minimum', c: 71, note: 'Raw sausages and fresh chorizo.' },
      { label: 'Well done', c: 74, note: 'Where most sausages actually want to be textured.' },
      { label: 'Dried out', c: 80, note: 'The skin splits long before this.' },
    ],
    rest: '2–3 minutes',
    minutesPerKg: [0, 0],
    oven: 0, safety: 71,
    safetyNote: 'Dry-cured products sold ready to eat do not need cooking. Anything labelled raw does.',
  },
];

const fahrenheit = (celsius) => Math.round((celsius * 9) / 5 + 32);

export default function MeatTempGuide() {
  const [cutId, setCutId] = useState('beef');
  const [weight, setWeight] = useState(1.5);
  const [weightUnit, setWeightUnit] = useState('kg');
  const [reading, setReading] = useState(55);

  const cut = CUTS.find((item) => item.id === cutId) || CUTS[0];
  const kg = weightUnit === 'kg' ? Number(weight) || 0 : (Number(weight) || 0) * 0.453592;

  const nearest = useMemo(() => {
    const sorted = [...cut.targets].sort((a, b) => Math.abs(a.c - reading) - Math.abs(b.c - reading));
    return sorted[0];
  }, [cut, reading]);

  const verdict = useMemo(() => {
    const value = Number(reading) || 0;
    if (value + 0.5 < cut.safety) {
      return { tone: 'rose', label: 'Below the safe minimum', note: 'At ' + value + ' °C (' + fahrenheit(value) + ' °F) this is under the ' + cut.safety + ' °C safety line for ' + cut.label.toLowerCase() + '. Keep cooking.' };
    }
    if (value < cut.safety) {
      return { tone: 'amber', label: 'At the safety line', note: 'Right at the minimum. For poultry and minced meat, give it another couple of degrees to leave no doubt.' };
    }
    if (value <= (cut.targets[1]?.c ?? cut.safety) + 3) {
      return { tone: 'emerald', label: 'In the ideal range', note: 'Take it off now and let carry-over finish the job — the centre will rise another 2–5 °C while it rests.' };
    }
    if (value <= cut.targets[cut.targets.length - 1].c + 4) {
      return { tone: 'amber', label: 'Heading past the ideal', note: 'Still perfectly safe, but you are moving into the drier end of the range for this cut.' };
    }
    return { tone: 'rose', label: 'Overcooked', note: 'Well beyond the target for this cut. Safe, but the texture has gone.' };
  }, [reading, cut]);

  const carry = Math.max(0, Math.round((reading + 3 - (cut.targets[1]?.c ?? cut.safety)) * 10) / 10);
  const cookMinutes = cut.minutesPerKg[1] > 0 ? [Math.round(kg * cut.minutesPerKg[0]), Math.round(kg * cut.minutesPerKg[1])] : [0, 0];

  const report = [
    cut.label + ' — temperature guide',
    '',
    ...cut.targets.map((target) => target.label.padEnd(18) + target.c + ' °C / ' + fahrenheit(target.c) + ' °F'),
    '',
    'Safe minimum: ' + cut.safety + ' °C / ' + fahrenheit(cut.safety) + ' °F',
    'Rest: ' + cut.rest,
    cookMinutes[1] ? 'Oven ' + cut.oven + ' °C · roughly ' + cookMinutes[0] + '–' + cookMinutes[1] + ' minutes for ' + kg.toFixed(2) + ' kg' : '',
    '',
    'Your reading: ' + reading + ' °C / ' + fahrenheit(reading) + ' °F — ' + verdict.label,
  ].filter(Boolean).join('\n');

  return (
    <ToolShell
      toolId="meat-temp"
      icon={Flame}
      title="Meat Temperature & Doneness Guide"
      desc="Every cut, every level of doneness, with the safe minimum alongside the temperature that actually eats well. Plus carry-over, rest times and a rough cooking time for the weight in front of you."
      state={{ cutId, weight, weightUnit, reading }}
      onRestore={(restored) => {
        if (typeof restored.cutId === 'string') setCutId(restored.cutId);
        if (restored.weight !== undefined) setWeight(restored.weight);
        if (typeof restored.weightUnit === 'string') setWeightUnit(restored.weightUnit);
        if (restored.reading !== undefined) setReading(restored.reading);
      }}
      exportText={report}
      exportName="meat-temperatures.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {CUTS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCutId(item.id)}
            className={item.id === cutId
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j'
              : 'rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground'}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What you are cooking</div>
          <div className="grid gap-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label="Weight"><Input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
              <div className="pt-5"><Seg value={weightUnit} onChange={setWeightUnit} options={['kg', 'lb']} /></div>
            </div>
            <Field label="Thermometer reading (°C)" hint="Take it in the thickest part, away from bone and fat.">
              <Input type="number" step="0.5" value={reading} onChange={(e) => setReading(e.target.value)} />
            </Field>
            <div className="text-[11px] text-muted-foreground">{fahrenheit(Number(reading) || 0)} °F{kg > 0 ? ' · ' + kg.toFixed(2) + ' kg' : ''}</div>
          </div>
        </Panel>

        <div className="grid gap-3 sm:grid-cols-2">
          <Gauge
            value={Number(reading) || 0}
            min={40}
            max={90}
            unit="°C"
            label={verdict.label}
            bands={[
              { min: 40, max: cut.safety - 0.5, label: 'Below safe', stroke: 'hsl(350 89% 60%)' },
              { min: cut.safety - 0.5, max: (cut.targets[1]?.c ?? cut.safety) + 3, label: 'Ideal range', stroke: 'hsl(160 84% 52%)' },
              { min: (cut.targets[1]?.c ?? cut.safety) + 3, max: 90, label: 'Past the target', stroke: 'hsl(38 92% 55%)' },
            ]}
          />
          <Panel className="!p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
              <Thermometer className="h-3.5 w-3.5 text-cyan-j" /> Reading verdict
            </div>
            <p className={verdict.tone === 'emerald' ? 'text-xs text-emerald-400' : verdict.tone === 'amber' ? 'text-xs text-amber-400' : 'text-xs text-rose-400'}>{verdict.label}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{verdict.note}</p>
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              <p>· Closest match on the chart: <span className="text-cyan-j">{nearest.label}</span> at {nearest.c} °C ({fahrenheit(nearest.c)} °F).</p>
              <p>· Carry-over: expect another 2–5 °C in the centre while it rests{carry > 0 ? ' — you can pull it about ' + carry.toFixed(1) + ' °C early' : ''}.</p>
              <p>· Rest: {cut.rest}.</p>
              {cookMinutes[1] > 0 ? <p>· Oven {cut.oven} °C for roughly {cookMinutes[0]}–{cookMinutes[1]} minutes at {kg.toFixed(2)} kg, then check with the thermometer — weight-based times are a starting point, never the answer.</p> : <p>· This one is cooked to temperature, not to time. Check it early and often.</p>}
            </div>
          </Panel>
        </div>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">{cut.label} — the full ladder</div>
        <div className="space-y-1.5">
          {cut.targets.map((target) => {
            const active = Math.abs(target.c - (Number(reading) || 0)) <= 2.5;
            return (
              <div
                key={target.label}
                className={active
                  ? 'flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-2'
                  : 'flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2'}
              >
                <span className="text-xs font-medium">{target.label}</span>
                <span className="font-mono-j text-xs text-cyan-j">{target.c} °C · {fahrenheit(target.c)} °F</span>
                <span className="w-full text-[11px] text-muted-foreground sm:w-auto">{target.note}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
          Safety: {cut.safety} °C ({fahrenheit(cut.safety)} °F) is the minimum for this category. {cut.safetyNote}
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Safe minimum" value={cut.safety + ' °C'} mono sub={fahrenheit(cut.safety) + ' °F'} />
        <Stat label="Ideal target" value={(cut.targets[1]?.c ?? cut.safety) + ' °C'} mono sub={cut.targets[1]?.label || '—'} />
        <Stat label="Carry-over" value="2–5 °C" mono sub="while resting" />
        <Stat label="Rest time" value={cut.rest.split(',')[0].replace('Rest ', '')} mono sub="tented, off the heat" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Using a thermometer properly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Insert into the thickest part, sideways for thin cuts like chops and breasts, and avoid bone — bone reads hot and fat reads cool.</p>
            <p>· Take several readings. One number from one spot can be ten degrees off in a roast.</p>
            <p>· Leave the probe in for at least five seconds on an instant-read, or use a leave-in probe for roasts and birds.</p>
            <p>· Every thermometer is slightly wrong. Check it in boiling water (100 °C at sea level) and in an ice bath (0 °C) and note the offset.</p>
            <p>· Rest before carving so the juices redistribute. Cutting immediately loses them to the board.</p>
            <p>· Whole cuts and minced meat are different risks. The 63 °C rule applies to intact muscle only — mince and burgers are 71 °C without exception.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Why the older advice was wrong</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Pork was cooked to 80 °C for decades because of trichinosis risk. Trichinella is destroyed at 63 °C instantly, so loin and chops can be safely pink.</p>
            <p>· Chicken at 74 °C is the safe point, but it is also close to the best eating temperature — the disaster zone starts around 80 °C.</p>
            <p>· Carry-over is real and predictable. Pulling a roast at the target means serving it five degrees past it.</p>
            <p>· Cooking times per kilo are a planning aid, not a method. Two pieces of the same weight can differ by 20 minutes on shape and bone.</p>
            <p>· Ground meat has no safe pink because the surface contamination is mixed through it. This is the one piece of old advice that should absolutely be kept.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Safe', value: cut.safety + ' °C' },
                { label: 'Best', value: (cut.targets[1]?.c ?? cut.safety) + ' °C' },
                { label: 'Pull early', value: '2–5 °C' },
              ]}
            />
          </div>
        </Panel>
      </div>
    </ToolShell>
  );
}