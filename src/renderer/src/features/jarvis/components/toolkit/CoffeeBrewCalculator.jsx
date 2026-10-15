import { useMemo, useState } from 'react';
import { Coffee } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const METHODS = {
  v60: { label: 'V60 pour over', ratio: 16, dose: 15, temp: 94, grind: 'medium fine, like table salt', time: '2:30 to 3:00', caffeinePerGram: 11, tds: 1.3, pours: 'bloom with twice the dose, then three pours' },
  chemex: { label: 'Chemex', ratio: 16, dose: 30, temp: 95, grind: 'medium coarse, like coarse sand', time: '3:30 to 4:30', caffeinePerGram: 11, tds: 1.28, pours: 'one long pour with a gentle spiral' },
  aeropress: { label: 'AeroPress', ratio: 12, dose: 16, temp: 85, grind: 'medium fine', time: '1:00 to 2:00', caffeinePerGram: 12, tds: 1.5, pours: 'stir ten seconds, steep, then press slowly' },
  french: { label: 'French press', ratio: 15, dose: 30, temp: 94, grind: 'coarse, like sea salt', time: '4:00', caffeinePerGram: 10, tds: 1.35, pours: 'break the crust at four minutes and skim' },
  moka: { label: 'Moka pot', ratio: 10, dose: 18, temp: 96, grind: 'fine, slightly coarser than espresso', time: '4:00 on the hob', caffeinePerGram: 13, tds: 2.2, pours: 'preheated water, low flame, off the heat at the first sputter' },
  espresso: { label: 'Espresso', ratio: 2, dose: 18, temp: 93, grind: 'fine, like powdered sugar', time: '25 to 30 seconds', caffeinePerGram: 14, tds: 9, pours: 'one continuous shot, 1:2 in the cup' },
  cold: { label: 'Cold brew', ratio: 8, dose: 100, temp: 20, grind: 'coarse', time: '12 to 18 hours', caffeinePerGram: 10, tds: 1.8, pours: 'steep in the fridge, then filter' },
};

const CUP_SIZES = [150, 200, 250, 350];

export default function CoffeeBrewCalculator() {
  const [method, setMethod] = useState('v60');
  const [mode, setMode] = useState('dose');
  const [dose, setDose] = useState('');
  const [cups, setCups] = useState('2');
  const [cupSize, setCupSize] = useState('250');
  const [ratioOverride, setRatioOverride] = useState('');
  const [strength, setStrength] = useState('medium');

  const result = useMemo(() => {
    const spec = METHODS[method] || METHODS.v60;
    const strengthFactor = strength === 'strong' ? 0.88 : strength === 'light' ? 1.12 : 1;
    const ratio = Math.max(1.5, (Number(ratioOverride) || spec.ratio) * strengthFactor);

    const cupMl = Math.max(60, Number(cupSize) || 250);
    const cupCount = Math.max(1, Math.min(20, Number(cups) || 1));
    const targetWater = cupMl * cupCount;

    const coffeeGrams = mode === 'volume'
      ? Math.max(3, targetWater / ratio)
      : Math.max(3, Number(dose) || spec.dose);
    const waterGrams = coffeeGrams * ratio;
    const yieldMl = waterGrams;
    const cupsFromDose = Math.floor(yieldMl / cupMl);
    const caffeine = coffeeGrams * spec.caffeinePerGram;
    const caffeinePerCup = caffeine / Math.max(1, mode === 'volume' ? cupCount : cupsFromDose || 1);

    const extractionNormalised = Math.min(30, (spec.tds * ratio));

    const ratioLadder = [12, 14, 15, 16, 17, 18, 20].map((value) => ({
      label: '1:' + value,
      value: Number((coffeeGrams * value).toFixed(0)),
    }));

    const waterSplit = [
      { label: 'Bloom', value: Number((coffeeGrams * 2).toFixed(0)) },
      { label: 'Pour 2', value: Number((coffeeGrams * ratio * 0.4).toFixed(0)) },
      { label: 'Pour 3', value: Number((coffeeGrams * ratio * 0.3).toFixed(0)) },
      { label: 'Final', value: Number((coffeeGrams * ratio * 0.3 - coffeeGrams * 2).toFixed(0)) },
    ];

    const strengthNote = extractionNormalised > 24
      ? 'That ratio is in espresso territory: dense, syrupy and easy to over-extract. Expect bitterness if the grind is fine.'
      : extractionNormalised > 18
        ? 'A strong filter brew. Good for milk drinks and for beans that taste thin at higher ratios.'
        : extractionNormalised > 13
          ? 'A balanced filter ratio, which is where most speciality coffee is designed to sit.'
          : 'A light, tea-like brew. Bright and clear, but weak beans will taste watery.';

    const report = [
      spec.label + ' · ' + coffeeGrams.toFixed(1) + ' g coffee to ' + waterGrams.toFixed(0) + ' g water (1:' + ratio.toFixed(1) + ')',
      'Water temperature ' + spec.temp + ' °C · grind ' + spec.grind + ' · brew time ' + spec.time,
      'Method: ' + spec.pours,
      '',
      mode === 'volume'
        ? 'For ' + cupCount + ' cups of ' + cupMl + ' ml, which is ' + targetWater + ' ml of water.'
        : 'This dose makes about ' + cupsFromDose + ' cups of ' + cupMl + ' ml.',
      'Caffeine roughly ' + caffeine.toFixed(0) + ' mg in total, about ' + caffeinePerCup.toFixed(0) + ' mg per cup.',
      'Typical strength for this method: ' + spec.tds + '% TDS.',
      '',
      'Water in stages: ' + waterSplit.map((entry) => entry.label + ' ' + entry.value + ' g').join(' · '),
    ].join('\n');

    return {
      spec, ratio, coffeeGrams, waterGrams, caffeine, caffeinePerCup, cupsFromDose, cupCount, cupMl, targetWater,
      ratioLadder, waterSplit, strengthNote, extractionNormalised, strengthFactor, report,
      cupsChart: CUP_SIZES.map((size) => ({ label: size + ' ml', value: Number((size / ratio).toFixed(1)) })),
      methodChart: Object.entries(METHODS).map(([key, value]) => ({ label: key, value: value.ratio })),
    };
  }, [method, mode, dose, cups, cupSize, ratioOverride, strength]);

  return (
    <ToolShell
      toolId="coffee-brew"
      icon={Coffee}
      title="Coffee Brew Calculator"
      desc="Dose, water and ratio for any brew method, with water temperature, grind, timing, staged pours, caffeine in milligrams and the strength that ratio will actually give you."
      state={{ method, mode, dose, cups, cupSize, ratioOverride, strength }}
      onRestore={(restored) => {
        if (restored.method) setMethod(restored.method);
        if (restored.mode) setMode(restored.mode);
        if (restored.dose !== undefined) setDose(String(restored.dose));
        if (restored.cups !== undefined) setCups(String(restored.cups));
        if (restored.cupSize !== undefined) setCupSize(String(restored.cupSize));
        if (restored.ratioOverride !== undefined) setRatioOverride(String(restored.ratioOverride));
        if (restored.strength) setStrength(restored.strength);
      }}
      exportText={result.report}
      exportName="coffee-recipe.txt"
    >
      <Field label="Brew method">
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 w-full max-w-md rounded-md border border-input bg-transparent px-2 text-sm">
          {Object.entries(METHODS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </select>
      </Field>

      <Seg value={mode} onChange={setMode} options={[{ value: 'dose', label: 'I have a dose of coffee' }, { value: 'volume', label: 'I need a number of cups' }]} />

      <div className="grid gap-3 sm:grid-cols-4">
        {mode === 'dose' ? (
          <Field label="Coffee dose, grams"><input value={dose} onChange={(e) => setDose(e.target.value)} inputMode="decimal" placeholder={String((METHODS[method] || METHODS.v60).dose)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        ) : (
          <>
            <Field label="Number of cups"><input value={cups} onChange={(e) => setCups(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Cup size, ml"><input value={cupSize} onChange={(e) => setCupSize(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </>
        )}
        <Field label="Ratio override, 1 to"><input value={ratioOverride} onChange={(e) => setRatioOverride(e.target.value)} inputMode="decimal" placeholder={'default ' + (METHODS[method] || METHODS.v60).ratio} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Strength preference">
          <Seg value={strength} onChange={setStrength} options={[{ value: 'light', label: 'Light' }, { value: 'medium', label: 'Balanced' }, { value: 'strong', label: 'Strong' }]} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={mode === 'dose' ? 'Coffee and water' : 'Coffee for ' + result.cupCount + ' cups'}
          value={result.coffeeGrams.toFixed(1) + ' g'}
          sub={'into ' + result.waterGrams.toFixed(0) + ' g of water — a ratio of 1:' + result.ratio.toFixed(1) + '. ' + (mode === 'volume' ? 'That is ' + result.targetWater + ' ml across ' + result.cupCount + ' cups of ' + result.cupMl + ' ml. ' : 'That makes about ' + result.cupsFromDose + ' cups at ' + result.cupMl + ' ml. ') + 'Roughly ' + result.caffeine.toFixed(0) + ' mg of caffeine in the pot, about ' + result.caffeinePerCup.toFixed(0) + ' mg per cup.'}
        />
        <Ring
          value={Math.min(result.caffeine, 400)}
          max={400}
          tone={result.caffeine > 300 ? 'amber' : 'cyan'}
          label="Caffeine in this brew"
          sub={result.caffeine.toFixed(0) + ' mg against a typical 400 mg daily guidance figure'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">{result.spec.label} recipe card</span>
          <CopyBtn value={result.report} label="Copy the recipe" />
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
            <div className="text-[10px] text-muted-foreground">Water temperature</div>
            <div className="font-mono-j text-sm text-cyan-j">{result.spec.temp} °C</div>
          </div>
          <div className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
            <div className="text-[10px] text-muted-foreground">Grind</div>
            <div className="text-[11px]">{result.spec.grind}</div>
          </div>
          <div className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
            <div className="text-[10px] text-muted-foreground">Time</div>
            <div className="font-mono-j text-sm text-cyan-j">{result.spec.time}</div>
          </div>
          <div className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
            <div className="text-[10px] text-muted-foreground">Typical strength</div>
            <div className="font-mono-j text-sm">{result.spec.tds}% TDS</div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{result.spec.pours}.</p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Water at each stage of the pour</div>
          <Bars data={result.waterSplit} format={(value) => String(value)} suffix=" g" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Weighing water rather than measuring volume is more accurate and easier: one millilitre of water is one gram, and a scale tracks the pour as you go.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Water weight at other ratios, same dose</div>
          <Bars data={result.ratioLadder} format={(value) => String(value)} suffix=" g" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            1:12 is strong, 1:15 to 1:17 is the usual filter range and 1:18 or lighter tastes like tea. Dial by ratio first, then by grind.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Coffee" value={result.coffeeGrams.toFixed(1) + ' g'} mono sub={'about ' + Math.round(result.coffeeGrams * 60) + ' beans'} />
        <Stat label="Water" value={result.waterGrams.toFixed(0) + ' g'} mono sub={result.ratio.toFixed(1) + ':1 ratio'} />
        <Stat label="Cups" value={String(mode === 'volume' ? result.cupCount : result.cupsFromDose)} mono sub={result.cupMl + ' ml each'} />
        <Stat label="Caffeine" value={result.caffeine.toFixed(0) + ' mg'} mono sub={result.caffeinePerCup.toFixed(0) + ' mg per cup'} />
      </div>

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· {result.strengthNote}</p>
          <p>· Caffeine per cup varies with the dose, the bean and the extraction. Robustas carry roughly twice the caffeine of arabicas, and a darker roast has slightly less by weight.</p>
          <p>· Espresso is often assumed to be the strongest drink per cup, but a 30 g filter dose delivers more caffeine in total than a single shot — it is just spread across more liquid.</p>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Dialling in a brew</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Change one variable at a time. Grind is the fastest lever, temperature the second, ratio the third.</p>
            <p>· Sour and weak means under-extracted: grind finer or raise the temperature slightly. Bitter and drying means over-extracted: coarser, cooler, or shorter.</p>
            <p>· Weigh everything, including the finished cup. If 250 g of water goes in and 200 g comes out, the bed retained the rest, and that difference changes the strength.</p>
            <p>· Fresh coffee degasses. Beans roasted two days ago behave differently from beans roasted three weeks ago, so expect the recipe to move with the bag.</p>
            <p>· Water matters more than most people expect. Very hard water flattens flavour; very soft water tastes hollow. A simple filter jug helps.</p>
            <p>· Keep the dose you like and write it down. A repeatable recipe is worth more than a perfect one you cannot reproduce.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How each method compares by ratio</div>
          <Bars data={result.methodChart} format={(value) => '1:' + value} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Immersion methods sit around 1:15, pour overs around 1:16, the moka pot near 1:10 and espresso near 1:2. The lower the ratio, the more concentrated the cup and the
            stronger the caffeine per millilitre.
          </p>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Method', value: result.spec.label },
                { label: 'Ratio', value: '1:' + result.ratio.toFixed(1) },
                { label: 'Water', value: result.waterGrams.toFixed(0) + ' g' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>water in grams = coffee in grams × ratio</p>
          <p>strength adjustment: strong uses 88% of the water, light uses 112%</p>
          <p>cups from a dose = total water ÷ cup size</p>
          <p>caffeine ≈ grams of coffee × caffeine per gram for the method ({result.spec.caffeinePerGram} mg/g here)</p>
          <p>typical strength for this method is a brew ratio around {result.spec.tds}% total dissolved solids</p>
          <p className="text-cyan-j">Check: {result.coffeeGrams.toFixed(1)} g × {result.ratio.toFixed(1)} = {result.waterGrams.toFixed(0)} g of water.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The recipes and caffeine figures are sensible starting points from common practice, not lab measurements. Bean variety, roast level, water chemistry and grind
          consistency all shift the result, so taste the cup and adjust one variable at a time.
        </p>
      </Panel>
    </ToolShell>
  );
}