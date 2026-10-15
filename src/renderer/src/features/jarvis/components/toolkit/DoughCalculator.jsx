import { useMemo, useState } from 'react';
import { Utensils } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const STYLES = [
  { id: 'sandwich', label: 'Sandwich loaf', hydration: 62, salt: 2, yeast: 1, sugar: 3, fat: 4, note: 'Soft crumb, needs a full knead and a warm rise.' },
  { id: 'neapolitan', label: 'Neapolitan pizza', hydration: 62, salt: 2.8, yeast: 0.3, sugar: 0, fat: 0, note: 'Long room-temperature ferment, very few additives.' },
  { id: 'ciabatta', label: 'Ciabatta', hydration: 78, salt: 2, yeast: 0.5, sugar: 0, fat: 2, note: 'Wet dough, open crumb, handle it with wet hands and folds not kneading.' },
  { id: 'brioche', label: 'Brioche', hydration: 50, salt: 1.8, yeast: 1.6, sugar: 20, fat: 50, note: 'Enriched dough. Fat and sugar slow the rise, so expect a long ferment.' },
  { id: 'sourdough', label: 'Sourdough', hydration: 75, salt: 2, yeast: 0, sugar: 0, fat: 0, note: 'The starter replaces the yeast. Times are set by the starter strength, not the clock.' },
  { id: 'focaccia', label: 'Focaccia', hydration: 80, salt: 2, yeast: 0.6, sugar: 0, fat: 6, note: 'Very wet dough, baked flat in oil with a dimpled top.' },
  { id: 'bagel', label: 'Bagels', hydration: 55, salt: 2, yeast: 0.8, sugar: 4, fat: 1, note: 'Stiff dough, shaped and boiled before baking for the chew.' },
  { id: 'custom', label: 'Your own', hydration: 68, salt: 2, yeast: 1, sugar: 0, fat: 0, note: 'Set the percentages yourself.' },
];

const round = (value) => (Math.round(value * 10) / 10).toFixed(1);
const grams = (value) => (Math.round(value * 10) / 10).toLocaleString();

export default function DoughCalculator() {
  const [style, setStyle] = useState('sandwich');
  const [mode, setMode] = useState('flour');
  const [flour, setFlour] = useState('1000');
  const [hydration, setHydration] = useState('62');
  const [salt, setSalt] = useState('2');
  const [yeast, setYeast] = useState('1');
  const [sugar, setSugar] = useState('3');
  const [fat, setFat] = useState('4');
  const [extra, setExtra] = useState('0');
  const [targetWeight, setTargetWeight] = useState('900');
  const [pieces, setPieces] = useState('1');
  const [pieceWeight, setPieceWeight] = useState('900');
  const [temp, setTemp] = useState('24');

  const applyStyle = (id) => {
    const entry = STYLES.find((option) => option.id === id) || STYLES[0];
    setStyle(id);
    setHydration(String(entry.hydration));
    setSalt(String(entry.salt));
    setYeast(String(entry.yeast));
    setSugar(String(entry.sugar));
    setFat(String(entry.fat));
  };

  const result = useMemo(() => {
    const hydrationPercent = Math.max(30, Math.min(120, Number(hydration) || 60));
    const saltPercent = Math.max(0, Number(salt) || 0);
    const yeastPercent = Math.max(0, Number(yeast) || 0);
    const sugarPercent = Math.max(0, Number(sugar) || 0);
    const fatPercent = Math.max(0, Number(fat) || 0);
    const extraPercent = Math.max(0, Number(extra) || 0);

    const sumPercent = 100 + hydrationPercent + saltPercent + yeastPercent + sugarPercent + fatPercent + extraPercent;

    let flourWeight = 0;
    if (mode === 'flour') flourWeight = Math.max(1, Number(flour) || 0);
    else if (mode === 'weight') flourWeight = ((Math.max(1, Number(targetWeight) || 0)) / sumPercent) * 100;
    else flourWeight = ((Math.max(1, Number(pieces) || 1) * Math.max(1, Number(pieceWeight) || 0)) / sumPercent) * 100;

    const water = (flourWeight * hydrationPercent) / 100;
    const saltWeight = (flourWeight * saltPercent) / 100;
    const yeastWeight = (flourWeight * yeastPercent) / 100;
    const sugarWeight = (flourWeight * sugarPercent) / 100;
    const fatWeight = (flourWeight * fatPercent) / 100;
    const extraWeight = (flourWeight * extraPercent) / 100;
    const total = flourWeight + water + saltWeight + yeastWeight + sugarWeight + fatWeight + extraWeight;
    const doughPerPiece = total / Math.max(1, Number(pieces) || 1);
    const bakerTotal = sumPercent;

    const hydrationBand = hydrationPercent < 60 ? 'stiff, best for bagels and dense loaves'
      : hydrationPercent < 68 ? 'standard bread dough, easy to handle'
      : hydrationPercent < 74 ? 'soft and slack, needs folds rather than kneading'
      : hydrationPercent < 82 ? 'high hydration, open crumb, sticky to work with'
      : 'very wet, closer to batter — bake it flat';

    // Rough rise guidance from the yeast percentage and dough temperature.
    const tempFactor = Math.pow(0.9, (Number(temp) || 24) - 24);
    const bulkHours = yeastPercent > 0 ? (12 / Math.max(0.05, yeastPercent)) * tempFactor : 0;
    const fridgeHours = yeastPercent > 0 ? 18 + 60 / Math.max(0.1, yeastPercent) : 0;

    const ingredients = [
      { label: 'Flour', value: Number(flourWeight.toFixed(0)), percent: 100, colour: '#e5e7eb' },
      { label: 'Water', value: Number(water.toFixed(0)), percent: hydrationPercent, colour: '#38bdf8' },
      { label: 'Salt', value: Number(saltWeight.toFixed(1)), percent: saltPercent, colour: '#94a3b8' },
      { label: 'Yeast', value: Number(yeastWeight.toFixed(1)), percent: yeastPercent, colour: '#facc15' },
      { label: 'Sugar', value: Number(sugarWeight.toFixed(1)), percent: sugarPercent, colour: '#fb923c' },
      { label: 'Fat', value: Number(fatWeight.toFixed(1)), percent: fatPercent, colour: '#f59e0b' },
      { label: 'Extra', value: Number(extraWeight.toFixed(1)), percent: extraPercent, colour: '#a78bfa' },
    ].filter((entry) => entry.percent > 0);

    const recipe = [
      'Baker percentages: flour 100%, water ' + hydrationPercent + '%, salt ' + saltPercent + '%, yeast ' + yeastPercent + '%' +
        (sugarPercent ? ', sugar ' + sugarPercent + '%' : '') + (fatPercent ? ', fat ' + fatPercent + '%' : '') + (extraPercent ? ', extra ' + extraPercent + '%' : ''),
      'Total ' + round(total) + ' g of dough' + (Number(pieces) > 1 ? ' in ' + pieces + ' pieces of ' + round(doughPerPiece) + ' g' : ''),
      '',
      ...ingredients.map((entry) => entry.label.padEnd(8, ' ') + grams(entry.value) + ' g   (' + entry.percent + '%)'),
      '',
      'Water temperature for a ' + temp + ' °C dough: about ' + round(Math.max(1, (Number(temp) || 24) * 3 - 70)) + ' °C tap water for a 30 minute mix in a room at 20 °C.',
    ].join('\n');

    return {
      flourWeight, water, saltWeight, yeastWeight, sugarWeight, fatWeight, extraWeight, total, doughPerPiece, bakerTotal,
      hydrationPercent, saltPercent, yeastPercent, sugarPercent, fatPercent, extraPercent, hydrationBand, bulkHours, fridgeHours,
      ingredients, recipe, note: (STYLES.find((entry) => entry.id === style) || STYLES[0]).note,
      styleLabel: (STYLES.find((entry) => entry.id === style) || STYLES[0]).label,
      saltWarning: saltPercent > 0 && (saltPercent < 1.5 || saltPercent > 2.5),
      yeastWarning: yeastPercent === 0 ? 'No yeast set. For sourdough use roughly 20% starter and let the timings be governed by the starter.' : '',
    };
  }, [mode, flour, hydration, salt, yeast, sugar, fat, extra, targetWeight, pieces, pieceWeight, temp, style]);

  return (
    <ToolShell
      toolId="dough-calculator"
      icon={Utensils}
      title="Bread & Dough Calculator"
      desc="Baker percentages into exact ingredient weights for any batch size — with hydration, salt and yeast tuning, rise timing from dough temperature, and a recipe card you can copy."
      state={{ style, mode, flour, hydration, salt, yeast, sugar, fat, extra, targetWeight, pieces, pieceWeight, temp }}
      onRestore={(restored) => {
        if (restored.style) setStyle(restored.style);
        if (restored.mode) setMode(restored.mode);
        ['flour', 'hydration', 'salt', 'yeast', 'sugar', 'fat', 'extra', 'targetWeight', 'pieces', 'pieceWeight', 'temp'].forEach((key) => {
          if (restored[key] !== undefined) {
            if (key === 'flour') setFlour(String(restored[key]));
            if (key === 'hydration') setHydration(String(restored[key]));
            if (key === 'salt') setSalt(String(restored[key]));
            if (key === 'yeast') setYeast(String(restored[key]));
            if (key === 'sugar') setSugar(String(restored[key]));
            if (key === 'fat') setFat(String(restored[key]));
            if (key === 'extra') setExtra(String(restored[key]));
            if (key === 'targetWeight') setTargetWeight(String(restored[key]));
            if (key === 'pieces') setPieces(String(restored[key]));
            if (key === 'pieceWeight') setPieceWeight(String(restored[key]));
            if (key === 'temp') setTemp(String(restored[key]));
          }
        });
      }}
      exportText={result.recipe}
      exportName="recipe.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {STYLES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => applyStyle(entry.id)}
            className={entry.id === style
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{result.note}</p>

      <Seg
        value={mode}
        onChange={setMode}
        options={[{ value: 'flour', label: 'From flour weight' }, { value: 'weight', label: 'From total dough weight' }, { value: 'pieces', label: 'From number of pieces' }]}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {mode === 'flour' && (
          <Field label="Flour weight, g"><input value={flour} onChange={(e) => setFlour(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        )}
        {mode === 'weight' && (
          <Field label="Total dough wanted, g"><input value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        )}
        {mode === 'pieces' && (
          <>
            <Field label="Number of pieces"><input value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Weight per piece, g"><input value={pieceWeight} onChange={(e) => setPieceWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </>
        )}
        <Field label="Hydration, %"><input value={hydration} onChange={(e) => setHydration(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Salt, %"><input value={salt} onChange={(e) => setSalt(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Yeast, %"><input value={yeast} onChange={(e) => setYeast(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Sugar, %"><input value={sugar} onChange={(e) => setSugar(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Fat, %"><input value={fat} onChange={(e) => setFat(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Extra, %"><input value={extra} onChange={(e) => setExtra(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Dough temperature target, °C"><input value={temp} onChange={(e) => setTemp(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={mode === 'weight' ? 'Flour needed' : 'Total dough'}
          value={grams(mode === 'weight' ? result.flourWeight : result.total)}
          unit="g"
          sub={(mode === 'weight' ? 'to make ' + grams(Number(targetWeight) || 0) + ' g of finished dough' : grams(result.flourWeight) + ' g of flour becomes ' + grams(result.total) + ' g of dough') + ' at ' + result.hydrationPercent + '% hydration, which is ' + result.hydrationBand + (Number(pieces) > 1 ? '. Divided into ' + pieces + ' pieces of ' + grams(result.doughPerPiece) + ' g each.' : '.')}
        />
        <Ring
          value={result.hydrationPercent}
          max={100}
          label="Hydration"
          sub={result.hydrationBand}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Ingredient weights</span>
            <CopyBtn value={result.recipe} label="Copy the recipe" />
          </div>
          <div className="space-y-1.5">
            {result.ingredients.map((entry) => (
              <div key={entry.label} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.colour }} />
                <span className="w-16">{entry.label}</span>
                <span className="font-mono-j text-cyan-j">{grams(entry.value)} g</span>
                <span className="ml-auto font-mono-j text-muted-foreground">{entry.percent}%</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5 font-mono-j text-[11px]">
              <span>Total dough</span>
              <span className="text-cyan-j">{grams(result.total)} g</span>
            </div>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Proportions by weight</div>
          <Bars
            data={result.ingredients.map((entry) => ({ label: entry.label, value: entry.value }))}
            format={(value) => grams(value)}
            suffix="g"
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Flour and water together are almost the entire dough. Every other ingredient is measured against the flour, which is what makes baker percentages portable across
            batch sizes.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Flour" value={grams(result.flourWeight) + ' g'} mono sub="100%" />
        <Stat label="Water" value={grams(result.water) + ' g'} mono sub={result.hydrationPercent + '%'} />
        <Stat label="Salt" value={grams(result.saltWeight) + ' g'} mono sub={result.saltPercent + '%'} />
        <Stat label="Yeast" value={grams(result.yeastWeight) + ' g'} mono sub={result.yeastPercent + '%'} />
      </div>

      {(result.saltWarning || result.yeastWarning) && (
        <Panel className="!p-3 !border-amber-400/50">
          <div className="space-y-1 text-[11px] text-amber-200">
            {result.saltWarning && <p>· Salt at {result.saltPercent}% is outside the usual 1.8 to 2.2% range. Too little leaves the dough slack and bland; too much slows the yeast and tightens the crumb.</p>}
            {result.yeastWarning && <p>· {result.yeastWarning}</p>}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Timing from the yeast percentage</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Room temperature bulk ferment</span><span>{result.bulkHours ? 'about ' + result.bulkHours.toFixed(1) + ' hours' : 'set by the starter, not the clock'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Overnight cold ferment</span><span>{result.fridgeHours ? 'about ' + result.fridgeHours.toFixed(0) + ' hours at 4 °C' : '—'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Flavour trade</span><span>{result.yeastPercent <= 0.5 ? 'slow, more flavour' : result.yeastPercent <= 1.5 ? 'balanced' : 'fast, less flavour'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Dough temperature target</span><span>{temp} °C</span></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Less yeast means a longer ferment, and a longer ferment means more flavour and a more digestible crumb. Doubling the yeast halves the time but does not simply
            double the quality.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Water temperature for the dough you want</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Aim for a finished dough temperature of about 24 to 26 °C for a normal bread. Warmer ferments faster; colder gives more flavour and less control.</p>
            <p>· The water temperature needed is roughly three times the target dough temperature minus the flour and room temperature, minus an allowance for the heat kneading adds.</p>
            <p>· For this mix at a {temp} °C target in a 20 °C kitchen, start with water at about {Math.max(1, Math.round((Number(temp) || 24) * 3 - 70))} °C.</p>
            <p>· Friction matters most in a machine. A stand mixer on medium for ten minutes adds several degrees that hand kneading does not.</p>
            <p>· In summer, use cold water from the fridge to keep the dough from running hot and fermenting faster than planned.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Baker percentages, plainly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Everything is a percentage of the flour weight. Flour is always 100%, and nothing else is measured against the total.</p>
            <p>· Hydration is water divided by flour. At 65% for every 1000 g of flour you add 650 g of water, and the total dough comes to roughly 1700 g once salt and yeast are added.</p>
            <p>· Salt at 2% of flour weight is the standard. Below 1.5% the dough is slack and tastes flat; above 2.5% the yeast slows noticeably.</p>
            <p>· Instant dried yeast is typically 0.5 to 2%, fresh yeast about three times that, and active dried yeast about 1.25 times it.</p>
            <p>· Fat and sugar both soften the crumb and both slow the rise. Enriched doughs need more yeast or a longer ferment, not a warmer room.</p>
            <p>· Write your own percentages down once you settle on them. That note is the recipe, and it scales to any batch size without arithmetic.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Technique that changes the outcome</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Weigh everything, including water. A cup of flour varies by twenty per cent between one scoop and the next, which is the difference between a good loaf and a brick.</p>
            <p>· Autolyse: mix flour and water alone and rest for 30 minutes before adding salt and yeast. The dough hydrates properly and needs less kneading.</p>
            <p>· At high hydration, use folds instead of kneading. Stretch, fold, rest, repeat — this builds strength without fighting a wet dough on the bench.</p>
            <p>· Judge the rise by volume and feel, not by the clock. Timings assume a specific temperature and a specific yeast, and both vary.</p>
            <p>· Shape with tension. A tight outer skin is what holds the gas in and gives the loaf its oven spring.</p>
            <p>· Cool completely before slicing. Cutting hot bread lets steam escape and stales the crumb.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Style', value: result.styleLabel },
                { label: 'Hydration', value: result.hydrationPercent + '%' },
                { label: 'Dough', value: grams(result.total) + ' g' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>baker total = 100 + hydration + salt + yeast + sugar + fat + extra</p>
          <p>flour = target dough weight × 100 ÷ baker total</p>
          <p>each ingredient = flour × its percentage ÷ 100</p>
          <p>piece weight = total dough ÷ number of pieces</p>
          <p className="text-cyan-j">Check: {grams(result.flourWeight)} g flour × {result.hydrationPercent}% = {grams(result.water)} g of water.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Ingredient weights here are exact. The ferment timings are a starting estimate that depends on your room, your flour and how lively your yeast is, so treat the first bake
          of any recipe as a measurement rather than a result.
        </p>
      </Panel>
    </ToolShell>
  );
}