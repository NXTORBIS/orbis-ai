import { useMemo, useState } from 'react';
import { Waves } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { Field, Panel, Seg, Stat } from './shared';

const START = {
  length: 90,
  width: 45,
  height: 50,
  substrate: 5,
  decor: 10,
  water: 'fresh',
  roomTemp: 18,
  tankTemp: 26,
  fishLength: 3,
};

export default function AquariumCalculator() {
  const [v, setV] = useState(START);
  const set = (key, value) => setV((current) => ({ ...current, [key]: value }));

  const result = useMemo(() => {
    const length = Number(v.length) || 0;
    const width = Number(v.width) || 0;
    const height = Number(v.height) || 0;
    const substrate = Number(v.substrate) || 0;
    const decor = Number(v.decor) || 0;
    const salt = v.water === 'salt';

    const grossLitres = (length * width * height) / 1000;
    const substrateLitres = (length * width * substrate) / 1000;
    const decorLitres = (grossLitres * decor) / 100;
    const displaced = substrateLitres + decorLitres;
    const waterLitres = Math.max(0, grossLitres - displaced);
    const usableLitres = Math.max(0, grossLitres - substrateLitres);

    const density = salt ? 1.025 : 1.0;
    const waterWeight = waterLitres * density;
    const substrateWeight = substrateLitres * 1.5;
    const glassWeight = ((length + width) * 2 * height * 0.6) / 1000;
    const totalWeight = waterWeight + substrateWeight + glassWeight;

    const delta = Math.max(0, Number(v.tankTemp) - Number(v.roomTemp));
    const heaterWatts = waterLitres * delta * 0.2;

    const turnoverFresh = { low: waterLitres * 4, high: waterLitres * 6 };
    const turnoverMarine = { low: waterLitres * 8, high: waterLitres * 12 };
    const turnover = salt ? turnoverMarine : turnoverFresh;

    const fishLength = Number(v.fishLength) || 1;
    const stockingLitres = salt ? waterLitres / 4 : waterLitres / 1.5;
    const fishCount = Math.floor((salt ? waterLitres / (fishLength * 2.5) : waterLitres / (fishLength * 1.5)));
    const stockingPct = Math.min(200, (Number(v.fishLength) * 30 * 1.5 * 100) / Math.max(1, waterLitres));

    const weeklyChange = waterLitres * (salt ? 0.1 : 0.2);
    const evaporation = waterLitres * (delta > 6 ? 0.03 : 0.015);
    const saltGrams = salt ? waterLitres * 35 : 0;

    return {
      grossLitres, waterLitres, displaced, substrateLitres, decorLitres, waterWeight, substrateWeight,
      glassWeight, totalWeight, heaterWatts, turnover, saltGrams, usableLitres,
      fishLength, fishCount, stockingLitres, stockingPct, weeklyChange, evaporation, salt, delta,
      dimensions: { length, width, height, substrate },
    };
  }, [v]);

  const report = [
    'Aquarium plan',
    '',
    'Tank ' + v.length + ' × ' + v.width + ' × ' + v.height + ' cm · ' + (result.salt ? 'marine' : 'freshwater'),
    'Gross volume ' + result.grossLitres.toFixed(1) + ' L',
    'Displacement — substrate ' + result.substrateLitres.toFixed(1) + ' L, decor ' + result.decorLitres.toFixed(1) + ' L',
    'Actual water ' + result.waterLitres.toFixed(1) + ' L',
    'Water weight ' + result.waterWeight.toFixed(1) + ' kg · substrate ' + result.substrateWeight.toFixed(1) + ' kg · glass ' + result.glassWeight.toFixed(1) + ' kg',
    'Loaded weight ' + result.totalWeight.toFixed(1) + ' kg',
    'Heater ' + Math.ceil(result.heaterWatts / 25) * 25 + ' W for a ' + result.delta.toFixed(0) + ' °C rise · consider two smaller units',
    'Filter ' + Math.round(result.turnover.low) + '–' + Math.round(result.turnover.high) + ' L/h',
    'Weekly water change ' + (result.weeklyChange).toFixed(1) + ' L',
    result.salt ? 'Salt to mix at 35 g/L: ' + Math.round(result.saltGrams) + ' g' : '',
  ].filter(Boolean).join('\n');

  return (
    <ToolShell
      toolId="aquarium"
      icon={Waves}
      title="Aquarium Volume & Setup"
      desc="Real water volume once substrate and decor take their share, the loaded weight of the whole tank, the heater and filter you actually need, and how much stock the water will carry."
      state={v}
      onRestore={(restored) => setV({ ...START, ...restored })}
      exportText={report}
      exportName="aquarium-plan.txt"
    >
      <Seg
        value={v.water}
        onChange={(value) => set('water', value)}
        options={[{ value: 'fresh', label: 'Freshwater' }, { value: 'salt', label: 'Marine' }]}
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
        <Panel className="!p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Tank length (cm)"><Input type="number" value={v.length} onChange={(event) => set('length', event.target.value)} /></Field>
            <Field label="Tank width (cm)"><Input type="number" value={v.width} onChange={(event) => set('width', event.target.value)} /></Field>
            <Field label="Tank height (cm)"><Input type="number" value={v.height} onChange={(event) => set('height', event.target.value)} /></Field>
            <Field label="Substrate depth (cm)"><Input type="number" step="0.5" value={v.substrate} onChange={(event) => set('substrate', event.target.value)} /></Field>
            <Field label="Rock and decor (% of volume)"><Input type="number" value={v.decor} onChange={(event) => set('decor', event.target.value)} /></Field>
            <Field label="Room temperature (°C)"><Input type="number" value={v.roomTemp} onChange={(event) => set('roomTemp', event.target.value)} /></Field>
            <Field label="Tank temperature (°C)"><Input type="number" value={v.tankTemp} onChange={(event) => set('tankTemp', event.target.value)} /></Field>
            <Field label="Typical adult fish length (cm)"><Input type="number" step="0.5" value={v.fishLength} onChange={(event) => set('fishLength', event.target.value)} /></Field>
          </div>
        </Panel>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Hero
              tone="cyan"
              label="Water actually held"
              value={result.waterLitres.toFixed(0)}
              unit="L"
              sub={'of ' + result.grossLitres.toFixed(0) + ' L gross — ' + ((result.displaced / (result.grossLitres || 1)) * 100).toFixed(0) + '% is displaced by what you put in it'}
            />
            <Hero
              tone={result.totalWeight > 250 ? 'rose' : result.totalWeight > 150 ? 'amber' : 'emerald'}
              label="Loaded weight"
              value={result.totalWeight.toFixed(0)}
              unit="kg"
              sub="water, substrate and glass — before the stand"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Stat label="Substrate" value={result.substrateWeight.toFixed(1) + ' kg'} mono sub={result.substrateLitres.toFixed(1) + ' L of space'} />
            <Stat label="Heater" value={Math.ceil(result.heaterWatts / 25) * 25 + ' W'} mono sub={result.delta.toFixed(0) + ' °C above room'} />
            <Stat label="Filter" value={Math.round(result.turnover.low) + '–' + Math.round(result.turnover.high) + ' L/h'} mono sub={(result.salt ? '8–12×' : '4–6×') + ' the water per hour'} />
            <Stat label="Weekly change" value={result.weeklyChange.toFixed(0) + ' L'} mono sub={result.salt ? '10% marine' : '20% freshwater'} />
          </div>
        </div>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What is taking up the space</div>
        <Bars
          data={[
            { label: 'Water', value: result.waterLitres },
            { label: 'Substrate', value: result.substrateLitres },
            { label: 'Decor', value: result.decorLitres },
          ]}
          format={(value) => value.toFixed(0)}
          suffix=" L"
          highlightLast={false}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Most treatments and stocking rules are written against real water volume, not the number printed on the box. A {v.length} × {v.width} × {v.height} cm tank is
          sold as {result.grossLitres.toFixed(0)} L but holds around {result.waterLitres.toFixed(0)} L once you have a sensible substrate bed and rock — which is why
          dosing at the nominal volume quietly over-medicates a tank.
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Stock estimate" value={result.fishCount + ' fish'} mono sub={'at ' + v.fishLength + ' cm adult size'} />
        <Stat label="Stocking allowance" value={result.stockingLitres.toFixed(0) + ' L'} mono sub="of fish, adult length" />
        <Stat label="Evaporation" value={result.evaporation.toFixed(1) + ' L'} mono sub="a week, top up with fresh water" />
        {result.salt ? (
          <Stat label="Salt to mix" value={Math.round(result.saltGrams) + ' g'} mono sub="at 35 g per litre" />
        ) : (
          <Stat label="Turnover" value={Math.round(result.turnover.high) + ' L/h'} mono sub="upper target" />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Equipment sizing</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Heater: allow roughly 0.2 W per litre per degree above room temperature, so a {result.waterLitres.toFixed(0)} L tank held {result.delta.toFixed(0)} °C above the room needs about {Math.ceil(result.heaterWatts / 25) * 25} W. Round up, not down.</p>
            <p>· Two smaller heaters beat one big one — if a single unit sticks on it cooks the tank; if one fails in a pair the other holds the temperature.</p>
            <p>· Filter turnover of four to six times the water volume per hour suits freshwater; marine wants eight to twelve times, because the biological load is higher.</p>
            <p>· Rated filter flow is measured empty. With media, height and pipework, expect the real figure to be 30–50% lower, so size for the higher end of the range.</p>
            <p>· Choose a filter by the media volume it holds, not by the litres per hour on the box. Bacteria live in the media, and that is what keeps the water safe.</p>
            <p>· A tank this size weighs {result.totalWeight.toFixed(0)} kg loaded. A flat-pack cabinet is not a stand — check the rated load before filling.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Stocking and maintenance</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A conventional freshwater guide allows about 1.5 L of water for each centimetre of adult fish. Marine tanks want far more room per centimetre, and marine fish grow larger than people expect.</p>
            <p>· Work from adult size, never from the size in the shop. A 3 cm juvenile can double or triple, and the tank that looked roomy becomes the problem.</p>
            <p>· Surface area limits oxygen exchange as much as volume does. Tall, narrow tanks hold fish worse than long, shallow ones of the same volume.</p>
            <p>· Change {result.weeklyChange.toFixed(0)} L a week rather than 50% monthly. Small and often keeps parameters stable, which matters more than the total volume replaced.</p>
            <p>· Top up evaporation with fresh water{result.salt ? ', never salt water — the salt stays behind when water evaporates and only fresh water restores the level.' : '.'}</p>
            <p>· Cycle the tank before any livestock goes in. A new filter has no bacteria, and ammonia will kill fish long before the readings look alarming.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Water', value: result.waterLitres.toFixed(0) + ' L' },
                { label: 'Heater', value: Math.ceil(result.heaterWatts / 25) * 25 + ' W' },
                { label: 'Filter', value: Math.round(result.turnover.high) + ' L/h' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Volume is length × width × height minus the substrate slab and your decor allowance, all in litres. Weight assumes water at 1.0 kg/L, sea water at 1.025, gravel at
          about 1.5 kg/L and 6 mm glass. Heater sizing is the common 0.2 W per litre per degree rule of thumb, and turnover targets are the usual freshwater and marine
          ranges. Fish stocking is the crudest part of any aquarium calculation — behaviour, territory and filtration matter more than litres per centimetre, so treat the
          number as a starting point and watch the water.
        </p>
      </Panel>
    </ToolShell>
  );
}