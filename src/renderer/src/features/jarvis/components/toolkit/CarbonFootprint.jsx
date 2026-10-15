import { useMemo, useState } from 'react';
import { Cloud } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const DIETS = [
  { id: 'heavy', label: 'Meat at most meals', tonnes: 2.5 },
  { id: 'medium', label: 'Meat a few times a week', tonnes: 1.9 },
  { id: 'fish', label: 'Fish, little meat', tonnes: 1.6 },
  { id: 'veggie', label: 'Vegetarian', tonnes: 1.4 },
  { id: 'vegan', label: 'Vegan', tonnes: 1.0 },
];

const COMPARISONS = [
  { label: 'A 2-tonne target', tonnes: 2 },
  { label: 'Global average per person', tonnes: 4.7 },
  { label: 'European average', tonnes: 6.8 },
  { label: 'US average', tonnes: 16 },
];

export default function CarbonFootprint() {
  const [carKm, setCarKm] = useState('120');
  const [carType, setCarType] = useState('petrol');
  const [shortFlights, setShortFlights] = useState('2');
  const [longFlights, setLongFlights] = useState('1');
  const [electricity, setElectricity] = useState('280');
  const [gas, setGas] = useState('800');
  const [diet, setDiet] = useState('medium');
  const [stuff, setStuff] = useState('1.2');

  const CAR = {
    petrol: { label: 'Petrol car', factor: 0.192 },
    diesel: { label: 'Diesel car', factor: 0.171 },
    hybrid: { label: 'Hybrid', factor: 0.109 },
    electric: { label: 'Electric car', factor: 0.053 },
    none: { label: 'No car', factor: 0 },
  };

  const foot = useMemo(() => {
    const weeklyKm = Number(carKm) || 0;
    const carFactor = (CAR[carType] || CAR.petrol).factor;
    const carTonnes = (weeklyKm * 52 * carFactor) / 1000;
    const shortTonnes = ((Number(shortFlights) || 0) * 0.25);
    const longTonnes = ((Number(longFlights) || 0) * 1.1);
    const flightTonnes = shortTonnes + longTonnes;
    const electricTonnes = ((Number(electricity) || 0) * 12 * 0.42) / 1000;
    const gasTonnes = ((Number(gas) || 0) * 12 * 0.18) / 1000;
    const homeTonnes = electricTonnes + gasTonnes;
    const dietTonnes = (DIETS.find((entry) => entry.id === diet) || DIETS[1]).tonnes;
    const stuffTonnes = Number(stuff) || 0;

    const sources = [
      { label: 'Flights', value: flightTonnes, colour: '#fb7185' },
      { label: 'Car', value: carTonnes, colour: '#22d3ee' },
      { label: 'Home energy', value: homeTonnes, colour: '#fbbf24' },
      { label: 'Food', value: dietTonnes, colour: '#34d399' },
      { label: 'Goods & services', value: stuffTonnes, colour: '#a78bfa' },
    ].filter((row) => row.value > 0).sort((a, b) => b.value - a.value);

    const total = sources.reduce((sum, row) => sum + row.value, 0);
    const biggest = sources[0] || null;
    const target = 2;
    const over = total - target;
    const trees = total / 0.021;
    const flighthare = total ? (flightTonnes / total) * 100 : 0;
    const carShare = total ? (carTonnes / total) * 100 : 0;
    const homeShare = total ? (homeTonnes / total) * 100 : 0;

    return {
      sources, total, biggest, target, over, trees, flighthare, carShare, homeShare,
      electricTonnes, gasTonnes, carTonnes, flightTonnes, homeTonnes, dietTonnes, stuffTonnes,
      versus: COMPARISONS.map((entry) => ({ ...entry, ratio: entry.tonnes ? total / entry.tonnes : 0 })),
      cutCar: carTonnes * 0.35,
      cutFlights: flightTonnes * 0.5,
      cutHome: homeTonnes * 0.25,
      cutDiet: dietTonnes * 0.3,
    };
  }, [carKm, carType, shortFlights, longFlights, electricity, gas, diet, stuff]);

  const report = useMemo(() => [
    'Estimated footprint ' + foot.total.toFixed(1) + ' tonnes CO₂e a year',
    '',
    ...foot.sources.map((row) => row.label.padEnd(20) + row.value.toFixed(2) + ' t   ' + ((row.value / foot.total) * 100).toFixed(0) + '%'),
    '',
    'Against a 2-tonne target that is ' + (foot.over > 0 ? foot.over.toFixed(1) + ' t over' : Math.abs(foot.over).toFixed(1) + ' t under'),
    'Equivalent to about ' + Math.round(foot.trees) + ' tree-years of sequestration',
    '',
    'Biggest levers:',
    '  halve flights: -' + foot.cutFlights.toFixed(2) + ' t',
    '  cut car mileage 35%: -' + foot.cutCar.toFixed(2) + ' t',
    '  home energy 25%: -' + foot.cutHome.toFixed(2) + ' t',
    '  shift diet one step: -' + foot.cutDiet.toFixed(2) + ' t',
  ].join('\n'), [foot]);

  const dietEntry = DIETS.find((entry) => entry.id === diet) || DIETS[1];
  const totalNote = foot.over > 0
    ? foot.over.toFixed(1) + ' tonnes over the 2-tonne line, which is the level the climate targets imply for each person'
    : Math.abs(foot.over).toFixed(1) + ' tonnes under a 2-tonne line — a genuinely low footprint';

  return (
    <ToolShell
      toolId="carbon-footprint"
      icon={Cloud}
      title="Carbon Footprint Estimator"
      desc="Flights, car, home energy, food and shopping turned into one annual figure — with the levers ranked by what they would actually cut."
      state={{ carKm, carType, shortFlights, longFlights, electricity, gas, diet, stuff }}
      onRestore={(restored) => {
        const keys = ['carKm', 'carType', 'shortFlights', 'longFlights', 'electricity', 'gas', 'diet', 'stuff'];
        keys.forEach((key) => {
          if (restored[key] === undefined) return;
          if (key === 'carType') setCarType(String(restored[key]));
          if (key === 'diet') setDiet(String(restored[key]));
          if (key === 'carKm') setCarKm(String(restored[key]));
          if (key === 'shortFlights') setShortFlights(String(restored[key]));
          if (key === 'longFlights') setLongFlights(String(restored[key]));
          if (key === 'electricity') setElectricity(String(restored[key]));
          if (key === 'gas') setGas(String(restored[key]));
          if (key === 'stuff') setStuff(String(restored[key]));
        });
      }}
      exportText={report}
      exportName="carbon-footprint.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={'Car, km a week · ' + carKm}>
          <input type="range" min={0} max={800} step={10} value={carKm} onChange={(e) => setCarKm(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Vehicle">
          <select value={carType} onChange={(e) => setCarType(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {Object.entries(CAR).map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
          </select>
        </Field>
        <Field label="Short-haul flights a year">
          <input value={shortFlights} onChange={(e) => setShortFlights(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Long-haul flights a year">
          <input value={longFlights} onChange={(e) => setLongFlights(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Electricity, kWh a month">
          <input value={electricity} onChange={(e) => setElectricity(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Gas, kWh a month">
          <input value={gas} onChange={(e) => setGas(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Diet">
          <select value={diet} onChange={(e) => setDiet(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {DIETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </Field>
        <Field label={'Goods and services · ' + stuff + ' t'}>
          <input type="range" min={0} max={5} step={0.1} value={stuff} onChange={(e) => setStuff(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={foot.total > 10 ? 'rose' : foot.total > 4.7 ? 'amber' : 'emerald'}
          label="Estimated annual footprint"
          value={foot.total.toFixed(1)}
          unit="tonnes CO₂e"
          sub={totalNote + '. That is ' + (foot.total / foot.target).toFixed(1) + '× a 2-tonne target and about ' + Math.round(foot.total * 4.7).toLocaleString() + ' km of driving equivalent.'}
        />
        <Ring
          value={Math.min(100, (foot.total / foot.target) * 100)}
          max={100}
          tone={foot.total > 10 ? 'rose' : foot.total > 4.7 ? 'amber' : 'emerald'}
          label="Against the 2-tonne line"
          sub={foot.over > 0 ? foot.over.toFixed(1) + ' t over · offsetting would need ' + Math.round(foot.trees) + ' tree-years' : 'Under the line · ' + Math.round(foot.trees) + ' tree-years would cover it'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Where it comes from</div>
        <Bars
          data={foot.sources.map((row) => ({ label: row.label.split(' ')[0], value: Number(row.value.toFixed(2)), colour: row.colour }))}
          format={(value) => value.toFixed(1)}
          suffix=" t"
          highlightLast={false}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          {foot.biggest ? foot.biggest.label + ' is the largest single source at ' + foot.biggest.value.toFixed(2) + ' tonnes, ' + ((foot.biggest.value / foot.total) * 100).toFixed(0) + '% of the total. ' : ''}
          Flights are {foot.flighthare.toFixed(0)}% of your footprint, the car {foot.carShare.toFixed(0)}% and home energy {foot.homeShare.toFixed(0)}% — in most households the travel lines dominate
          everything domestic.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Levers, biggest first</div>
          <div className="space-y-1.5">
            {[
              { label: 'Halve flights', value: foot.cutFlights },
              { label: 'Cut car mileage 35%', value: foot.cutCar },
              { label: 'Home energy down 25%', value: foot.cutHome },
              { label: 'Shift diet one step', value: foot.cutDiet },
            ].sort((a, b) => b.value - a.value).map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
                <span className="text-[11px]">{row.label}</span>
                <span className="font-mono-j text-[11px] text-cyan-j">−{row.value.toFixed(2)} t</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Taken together these four would remove about {(foot.cutFlights + foot.cutCar + foot.cutHome + foot.cutDiet).toFixed(1)} tonnes — which is why flying less
            outperforms everything you can do at home, and why home changes are worth doing anyway once the flying is settled.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How you compare</div>
          <div className="space-y-1.5">
            {foot.versus.map((row) => (
              <div key={row.label} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span>{row.label}</span>
                  <span className="font-mono-j text-muted-foreground">{row.ratio.toFixed(2)}×</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-j/70" style={{ width: Math.min(100, row.ratio * 50) + '%' }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Figures are per person per year. Being below the global average is not the same as being sustainable — the target that matters is the 2-tonne line,
            which is roughly what the climate goals imply for each person by mid-century.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Total" value={foot.total.toFixed(1) + ' t'} mono sub="CO₂e a year" />
        <Stat label="Flights" value={foot.flightTonnes.toFixed(2) + ' t'} mono sub={foot.flighthare.toFixed(0) + '% of total'} />
        <Stat label="Car" value={foot.carTonnes.toFixed(2) + ' t'} mono sub={(CAR[carType] || CAR.petrol).label} />
        <Stat label="Home" value={foot.homeTonnes.toFixed(2) + ' t'} mono sub={foot.electricTonnes.toFixed(2) + ' t electricity'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Cutting it without going broke</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Flying is the biggest single lever for most people: one long-haul return is over a tonne, and half of it is a choice you make once a year.</p>
          <p>· For the car, the order of impact is miles, then efficiency. An electric car on a dirty grid still beats a petrol one, but driving less beats both.</p>
          <p>· Home energy is mostly heating and hot water: insulation and a lower thermostat hold their saving every year, unlike a gadget.</p>
          <p>· Diet shifts are slow but stick: {dietEntry.label.toLowerCase()} currently accounts for {foot.dietTonnes.toFixed(1)} tonnes, and moving one step is worth about {foot.cutDiet.toFixed(1)} tonnes a year.</p>
          <p>· Offsetting is a last step, not a licence. {Math.round(foot.trees)} tree-years is a lot of land to hold for emissions you could simply not make.</p>
          <p>· Nothing here measures the embodied carbon of what you buy or where your electricity comes from; a clean tariff can change the home figure materially.</p>
        </div>
        <div className="mt-2">
          <CopyBtn value={report} label="Copy the estimate" />
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What the estimate is built on</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Car figures use 192 g per km for petrol, 171 for diesel, 109 for hybrid and 53 for electric — tank-to-wheel for fossil cars, grid-average for electric.</p>
          <p>· Flights are averaged: about 0.25 tonnes for a short-haul return and 1.1 tonnes for a long-haul return, per passenger.</p>
          <p>· Electricity uses 420 g per kWh, a common grid average; gas uses 180 g per kWh, which is the combustion figure for a boiler.</p>
          <p>· Diet ranges from 2.5 tonnes for meat at most meals down to 1.0 for vegan, covering production only.</p>
          <p>· Goods and services is your own estimate for clothes, electronics, deliveries and everything else — it is the vaguest line by nature.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Total', value: foot.total.toFixed(1) + ' t' },
              { label: 'Biggest', value: foot.biggest ? foot.biggest.label : '—' },
              { label: 'Vs target', value: (foot.total / foot.target).toFixed(1) + '×' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This is an estimate built from published average emission factors, not a measurement of your specific energy supply. It is accurate enough to tell you
          whether flying or driving is your dominant source — which is the decision the numbers are there to inform — and it runs entirely in your browser.
        </p>
      </Panel>
    </ToolShell>
  );
}