import { useMemo, useState } from 'react';
import { Utensils } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { Field, Panel, Seg, Stat, ToggleRow } from './shared';

const METHODS = [
  { value: 'wet', label: 'Wet brine' },
  { value: 'dry', label: 'Dry cure' },
  { value: 'equilibrium', label: 'Equilibrium brine' },
  { value: 'ferment', label: 'Ferment / pickle' },
];

const PRESETS = [
  { label: 'Chicken, wet brine', values: { method: 'wet', weight: 1500, water: 3000, saltPct: 5, sugarPct: 2, hours: 6 } },
  { label: 'Steak, dry brine', values: { method: 'dry', weight: 1000, water: 0, saltPct: 1, sugarPct: 0, hours: 24 } },
  { label: 'Turkey, equilibrium', values: { method: 'equilibrium', weight: 5000, water: 5000, saltPct: 2, sugarPct: 1, hours: 24 } },
  { label: 'Sauerkraut, 2%', values: { method: 'ferment', weight: 2000, water: 0, saltPct: 2, sugarPct: 0, hours: 336 } },
  { label: 'Bacon, 2.5% + cure', values: { method: 'dry', weight: 2000, water: 0, saltPct: 2.5, sugarPct: 1, hours: 168, cure: true, ppm: 156 } },
];

const START = { method: 'wet', weight: 1500, water: 3000, saltPct: 5, sugarPct: 2, hours: 6, cure: false, ppm: 156 };

export default function BrineCalculator() {
  const [v, setV] = useState(START);
  const set = (key, value) => setV((current) => ({ ...current, [key]: value }));

  const result = useMemo(() => {
    const weight = Number(v.weight) || 0;
    const water = Number(v.water) || 0;
    const saltPct = Number(v.saltPct) || 0;
    const sugarPct = Number(v.sugarPct) || 0;
    const hours = Number(v.hours) || 0;

    let salt = 0;
    let sugar = 0;
    let solution = 0;
    let salinity = 0;
    let internal = 0;

    if (v.method === 'wet') {
      salt = (water * saltPct) / 100;
      sugar = (water * sugarPct) / 100;
      solution = water + salt + sugar;
      salinity = solution > 0 ? (salt / solution) * 100 : 0;
      internal = salinity * (weight + solution > 0 ? weight / (weight + solution) : 0) * 1.6;
    } else if (v.method === 'dry') {
      salt = (weight * saltPct) / 100;
      sugar = (weight * sugarPct) / 100;
      solution = 0;
      salinity = saltPct;
      internal = saltPct * 0.75;
    } else if (v.method === 'equilibrium') {
      const total = weight + water;
      salt = (total * saltPct) / 100;
      sugar = (total * sugarPct) / 100;
      solution = water + salt + sugar;
      salinity = total > 0 ? (salt / total) * 100 : 0;
      internal = salinity * 0.9;
    } else {
      salt = (weight * saltPct) / 100;
      sugar = (weight * sugarPct) / 100;
      const released = (weight * 0.6) / 1000;
      solution = released + salt;
      salinity = solution > 0 ? (salt / solution) * 100 : 0;
      internal = saltPct;
    }

    const cureGrams = v.cure && v.method !== 'ferment' ? (weight * (Number(v.ppm) || 156)) / 1e6 / 0.0625 : 0;
    const actualPpm = weight > 0 ? ((cureGrams * 0.0625) / weight) * 1e6 : 0;

    const waterLoss = v.method === 'dry' ? weight * 0.03 : 0;
    const finalWeight = weight - waterLoss;

    const timeGuide = v.method === 'ferment'
      ? { label: 'Ferment', detail: '1–4 weeks at 18–22 °C, tasting from day 5. Below 1.5% salt it spoils; above 3% it stalls.' }
      : v.method === 'dry'
        ? { label: 'Cure', detail: hours >= 20 ? 'A day or more is right — the salt needs time to diffuse to the centre.' : 'Under 20 hours only seasons the surface; go longer for anything thick.' }
        : { label: 'Soak', detail: hours >= 12 ? 'A long soak at this strength suits large cuts; reduce the salt if shorter.' : 'Short soaks need a stronger brine. At this strength give it more time, or the centre stays bland.' };

    const safety = [];
    if (v.method === 'ferment' && saltPct < 1.8) safety.push('Under about 1.8% salt by total weight a ferment is not safe — the wrong bacteria win. Use 2% as the standard.');
    if (v.method === 'wet' && salinity > 12) safety.push('A brine above 12% salt tastes harsh and firms the outside before the centre is ready. 5–8% is the useful band for poultry and pork.');
    if (v.cure && actualPpm > 200) safety.push('At ' + actualPpm.toFixed(0) + ' ppm nitrite this exceeds the usual 200 ppm limit for cured meat.');
    if (v.cure && actualPpm < 100 && actualPpm > 0) safety.push('At ' + actualPpm.toFixed(0) + ' ppm the nitrite is below the 120 ppm floor that makes curing effective against botulinum.');
    if (v.method !== 'ferment' && hours > 96) safety.push('Soaks beyond four days in a wet brine turn the texture mushy. Rinse and cook, or freeze.');
    if (!safety.length) safety.push('No arithmetic warnings at these figures — taste, texture and fridge temperature are the remaining variables.');

    return { salt, sugar, solution, salinity, internal, cureGrams, actualPpm, timeGuide, safety, finalWeight, waterLoss, weight, water };
  }, [v]);

  const report = [
    'Brine plan — ' + (METHODS.find((entry) => entry.value === v.method) || {}).label,
    '',
    'Meat or vegetable ' + v.weight + ' g' + (result.water ? ' · water ' + result.water + ' g' : ''),
    'Salt ' + v.saltPct + '% → ' + result.salt.toFixed(1) + ' g',
    'Sugar ' + v.sugarPct + '% → ' + result.sugar.toFixed(1) + ' g',
    result.cureGrams > 0 ? 'Cure #1 ' + result.cureGrams.toFixed(2) + ' g (' + result.actualPpm.toFixed(0) + ' ppm nitrite)' : '',
    'Solution salinity ' + result.salinity.toFixed(2) + '% · estimated internal ' + result.internal.toFixed(2) + '%',
    result.timeGuide.label + ': ' + result.timeGuide.detail,
  ].filter(Boolean).join('\n');

  return (
    <ToolShell
      toolId="brine"
      icon={Utensils}
      title="Brine & Cure Calculator"
      desc="Salt and sugar weights for wet brines, dry cures, equilibrium brines and fermented pickles — with the actual salinity of the solution, an estimate of what the centre of the meat ends up at, and the nitrite maths when curing is involved."
      state={v}
      onRestore={(restored) => setV({ ...START, ...restored })}
      exportText={report}
      exportName="brine-plan.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setV({ ...START, ...preset.values })}
            className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <Seg value={v.method} onChange={(value) => set('method', value)} options={METHODS} />

      <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
        <Panel className="!p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={v.method === 'ferment' ? 'Vegetable weight (g)' : 'Meat weight (g)'}>
              <Input type="number" value={v.weight} onChange={(event) => set('weight', event.target.value)} />
            </Field>
            {v.method !== 'dry' && v.method !== 'ferment' && (
              <Field label="Water (g)" hint="1 g of water is 1 mL.">
                <Input type="number" value={v.water} onChange={(event) => set('water', event.target.value)} />
              </Field>
            )}
            <Field label={v.method === 'wet' ? 'Salt % of water' : 'Salt % of weight'}>
              <Input type="number" step="0.1" value={v.saltPct} onChange={(event) => set('saltPct', event.target.value)} />
            </Field>
            <Field label={v.method === 'wet' ? 'Sugar % of water' : 'Sugar % of weight'}>
              <Input type="number" step="0.1" value={v.sugarPct} onChange={(event) => set('sugarPct', event.target.value)} />
            </Field>
            {v.method !== 'ferment' && (
              <Field label="Time (hours)"><Input type="number" value={v.hours} onChange={(event) => set('hours', event.target.value)} /></Field>
            )}
            {v.cure && v.method !== 'ferment' && (
              <Field label="Target nitrite (ppm)" hint="120–200 ppm is the normal band.">
                <Input type="number" value={v.ppm} onChange={(event) => set('ppm', event.target.value)} />
              </Field>
            )}
          </div>
          {v.method !== 'ferment' && (
            <div className="mt-2">
              <ToggleRow label="Using cure #1" hint="6.25% sodium nitrite" checked={v.cure} onChange={(value) => set('cure', value)} />
            </div>
          )}
        </Panel>

        <div className="space-y-3">
          <Hero
            tone={result.safety.length && result.safety[0].startsWith('No arithmetic') ? 'emerald' : 'amber'}
            label="Salt to weigh out"
            value={result.salt.toFixed(1)}
            unit="g"
            sub={'plus ' + result.sugar.toFixed(1) + ' g sugar' + (result.cureGrams > 0 ? ' and ' + result.cureGrams.toFixed(2) + ' g cure #1' : '')}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Stat label="Solution salinity" value={result.salinity.toFixed(2) + '%'} mono sub={v.method === 'wet' ? 'salt ÷ total solution' : 'as a share of the weight'} />
            <Stat label="Estimated in the centre" value={result.internal.toFixed(2) + '%'} mono sub="after a full soak" />
            <Stat label="Total mass" value={Math.round(result.weight + result.solution).toLocaleString() + ' g'} mono sub="meat plus brine" />
            <Stat label="Nitrite" value={result.cureGrams > 0 ? result.actualPpm.toFixed(0) + ' ppm' : 'none'} mono sub={result.cureGrams > 0 ? 'from cure #1' : 'no curing salt'} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Salt, sugar and water in proportion</div>
          <Bars
            data={[
              { label: 'Water', value: result.water || result.weight * 0.6 },
              { label: 'Salt', value: result.salt },
              { label: 'Sugar', value: result.sugar },
              ...(result.cureGrams > 0 ? [{ label: 'Cure', value: result.cureGrams }] : []),
            ]}
            format={(value) => String(Math.round(value))}
            suffix=" g"
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {v.method === 'wet'
              ? 'Salinity is salt as a share of the finished solution, not of the water alone. A 5% brine by water is about 4.8% of the solution once the salt is in, and that small difference is why the percentages on old recipes do not always line up.'
              : v.method === 'dry'
                ? 'A dry cure uses salt as a share of the meat. Around 2–2.5% is the equilibrium point for whole cuts; the meat loses roughly ' + result.waterLoss.toFixed(0) + ' g of water and ends up near ' + result.finalWeight.toFixed(0) + ' g.'
                : v.method === 'equilibrium'
                  ? 'Equilibrium brining sets the final salinity directly: salt as a share of everything in the bag, so the meat and the liquid finish at the same concentration and it cannot oversalt however long it stays in.'
                  : 'Fermented vegetables are salted by total weight — 2% is the standard, and the salt pulls water out of the vegetable to make its own brine within a few hours.'}
          </p>
        </Panel>

        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Timing</div>
          <div className="rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="text-cyan-j">{result.timeGuide.label}</span> — {result.timeGuide.detail}
          </div>
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            <p>· Salt moves into meat by diffusion, roughly 5–7 mm per day from each surface. A 4 cm thick chop needs about three days; a 10 cm turkey breast needs a week.</p>
            <p>· Thinner pieces reach equilibrium faster, and they oversalt sooner — that is the single biggest reason a brine tastes too salty.</p>
            <p>· Keep everything below 5 °C. Room-temperature brining is the source of most home curing problems.</p>
            <p>· Rinse and dry before cooking. A wet surface steams instead of browning, and surface salt concentrates as the water evaporates.</p>
            {v.method === 'ferment' && <p>· Keep the vegetables submerged. Anything above the brine grows mould, and a weight or a zip-lock of brine is what keeps it under.</p>}
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Method', value: v.method },
                { label: 'Salt', value: result.salt.toFixed(0) + ' g' },
                { label: 'Salinity', value: result.salinity.toFixed(1) + '%' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Safety checks</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {result.safety.map((note) => <p key={note}>· {note}</p>)}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Salt percentages that work</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Wet brine for poultry: 5–8% salt by water, 2–12 hours. The lower end needs the longer soak.</p>
            <p>· Wet brine for pork: 5–7%, 12–24 hours. Add sugar at a third to a half of the salt for browning.</p>
            <p>· Dry cure for whole cuts: 2–2.5% salt by meat weight, 1–7 days depending on thickness.</p>
            <p>· Equilibrium brine: 1.5–2% of the total weight of meat plus water, and time stops mattering.</p>
            <p>· Fermented vegetables: 2% by vegetable weight, 1.5% absolute minimum, 2.5–3% for warm weather or longer storage.</p>
            <p>· Fish and seafood: 5–10% for a short brine, minutes rather than hours, or you change the texture completely.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Curing salts, plainly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Cure #1 is 6.25% sodium nitrite and 93.75% table salt. Prague powder and Instacure #1 are the same product.</p>
            <p>· The band that works is about 120–200 ppm nitrite in the finished meat. Below it, protection against botulinum is unreliable; above it, you are beyond the usual legal limit.</p>
            <p>· Never substitute cure #2 for cure #1 or the reverse. Cure #2 also contains nitrate and is only for long, slow-cured products.</p>
            <p>· Nitrite is not a seasoning — weigh it. Guessing has caused real poisonings, and the margin is small.</p>
            <p>· Keep cures labelled separately from ordinary salt. Most accidents at home involve a jar nobody labelled.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Weights come from the percentage you enter — salt as a share of water, of the meat, or of everything in the bag, depending on the method — and the internal
          salinity is an estimate from diffusion behaviour, not a measurement. Nitrite figures are the standard cure #1 arithmetic. Chilling, hygiene and the actual
          temperature of your fridge matter more than any number here, and local rules on curing salts differ.
        </p>
      </Panel>
    </ToolShell>
  );
}