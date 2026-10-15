import { useMemo, useState } from 'react';
import { Scale, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const DEFAULT = [
  { id: 'a', label: 'Cheap boots', price: '60', lifespan: '2', uses: '80', maintenance: '10', resale: '0' },
  { id: 'b', label: 'Mid-range boots', price: '140', lifespan: '5', uses: '90', maintenance: '25', resale: '20' },
  { id: 'c', label: 'Premium boots', price: '280', lifespan: '10', uses: '100', maintenance: '45', resale: '60' },
];

const blank = () => ({ id: Math.random().toString(36).slice(2), label: 'New option', price: '100', lifespan: '5', uses: '50', maintenance: '0', resale: '0' });

const money = (value, currency) => currency + (value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(2));

export default function CostPerUse() {
  const [options, setOptions] = useState(DEFAULT);
  const [horizon, setHorizon] = useState(5);
  const [currency, setCurrency] = useState('£');

  const set = (id, key, value) => setOptions((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const years = Math.max(1, Math.min(20, Number(horizon) || 1));
    const parsed = options.map((row) => {
      const price = Math.max(0, Number(row.price) || 0);
      const lifespan = Math.max(0.5, Number(row.lifespan) || 1);
      const usesPerYear = Math.max(0, Number(row.uses) || 0);
      const maintenance = Math.max(0, Number(row.maintenance) || 0);
      const resale = Math.max(0, Number(row.resale) || 0);
      const replacements = Math.max(1, Math.ceil(years / lifespan));
      const purchaseTotal = price * replacements;
      const maintenanceTotal = maintenance * years;
      const resaleValue = resale * Math.max(0, 1 - (years % lifespan || lifespan) / lifespan);
      const total = Math.max(0, purchaseTotal + maintenanceTotal - resaleValue);
      const uses = usesPerYear * years;
      const perUse = uses ? total / uses : 0;
      const perYear = total / years;
      return {
        ...row, price, lifespan, usesPerYear, maintenance, resale, replacements, purchaseTotal, maintenanceTotal, resaleValue,
        total, uses, perUse, perYear,
      };
    });

    const ranked = [...parsed].sort((a, b) => a.perUse - b.perUse);
    const best = ranked[0] || null;
    const worst = ranked[ranked.length - 1] || null;

    const costAt = (row, years) => {
      const replacements = Math.max(1, Math.ceil(years / row.lifespan));
      return row.price * replacements + row.maintenance * years - row.resale * Math.max(0, 1 - (years % row.lifespan || row.lifespan) / row.lifespan);
    };

    const breakEven = (() => {
      if (parsed.length < 2) return null;
      const cheaper = [...parsed].sort((a, b) => a.price - b.price)[0];
      const dearer = [...parsed].sort((a, b) => b.price - a.price)[0];
      if (cheaper.id === dearer.id) return null;
      let yearMark = 0;
      for (let year = 1; year <= 40; year += 1) {
        if (costAt(dearer, year) <= costAt(cheaper, year)) {
          yearMark = year;
          break;
        }
      }
      return { cheaper, dearer, years: yearMark };
    })();

    const ladder = [1, 2, 3, 5, 8, 12].map((value) => {
      const entry = parsed[0];
      if (!entry) return { label: String(value), value: 0 };
      const total = costAt(entry, value);
      const uses = entry.usesPerYear * value;
      return { label: value + ' yr', value: Number((uses ? total / uses : 0).toFixed(3)) };
    });

    return { parsed, ranked, best, worst, breakEven, ladder, years, savings: best && worst ? (worst.perUse - best.perUse) * best.uses : 0 };
  }, [options, horizon]);

  const report = useMemo(() => [
    'Cost per use over ' + result.years + ' years',
    '',
    ...result.parsed.map((row) => [
      row.label,
      'cost per use ' + money(row.perUse, currency),
      'total ' + money(row.total, currency),
      row.replacements + ' purchase' + (row.replacements === 1 ? '' : 's'),
      Math.round(row.uses) + ' uses',
      'per year ' + money(row.perYear, currency),
    ].join(' · ')),
    '',
    result.best ? 'Best value: ' + result.best.label + ' at ' + money(result.best.perUse, currency) + ' per use.' : '',
    result.breakEven && result.breakEven.years ? 'The pricier ' + result.breakEven.dearer.label + ' becomes cheaper overall after about ' + result.breakEven.years + ' years.' : '',
    'Choosing the best over the worst saves about ' + money(Math.max(0, result.savings), currency) + ' across the horizon.',
  ].join('\n'), [result, currency]);

  return (
    <ToolShell
      toolId="cost-per-use"
      icon={Scale}
      title="Cost Per Use & Ownership"
      desc="The cheapest sticker price is rarely the cheapest thing to own. Compare up to four options on total cost, cost per use and the year the pricier one overtakes the cheap one."
      state={{ options, horizon, currency }}
      onRestore={(restored) => {
        if (Array.isArray(restored.options) && restored.options.length) setOptions(restored.options);
        if (restored.horizon !== undefined) setHorizon(Number(restored.horizon) || 5);
        if (typeof restored.currency === 'string') setCurrency(restored.currency);
      }}
      exportText={report}
      exportName="cost-per-use.txt"
    >
      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Options</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.parsed.length} compared</span>
        </div>
        <div className="space-y-2">
          {options.map((row) => (
            <div key={row.id} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
              <div className="grid gap-2 sm:grid-cols-7">
                <Field label="Option"><input value={row.label} onChange={(e) => set(row.id, 'label', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
                <Field label="Price"><input value={row.price} onChange={(e) => set(row.id, 'price', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Years it lasts"><input value={row.lifespan} onChange={(e) => set(row.id, 'lifespan', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Uses a year"><input value={row.uses} onChange={(e) => set(row.id, 'uses', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Upkeep a year"><input value={row.maintenance} onChange={(e) => set(row.id, 'maintenance', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Resale value"><input value={row.resale} onChange={(e) => set(row.id, 'resale', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <div className="flex items-end">
                  <button type="button" onClick={() => setOptions((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {options.length < 4 && (
            <button type="button" onClick={() => setOptions((current) => [...current, blank()])} className="inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
              <Plus className="h-3.5 w-3.5" /> Add an option
            </button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Currency</span>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-8 w-16 rounded-md border border-input bg-transparent px-2 font-mono-j text-xs" />
          </div>
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Years you keep it</span>
          <span className="font-mono-j text-[10px] text-cyan-j">{result.years} years</span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={horizon}
          onChange={(e) => setHorizon(Number(e.target.value))}
          className="w-full accent-[hsl(var(--cyan))]"
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Drag the horizon. Cheap items often win over one year and lose badly over ten, because the price of replacing them keeps coming back.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone="emerald"
          label={'Best value at ' + result.years + ' years'}
          value={result.best ? money(result.best.perUse, currency) : '—'}
          unit="per use"
          sub={result.best
            ? result.best.label + ', with a total cost of ' + money(result.best.total, currency) + ' across ' + Math.round(result.best.uses).toLocaleString() + ' uses and ' + result.best.replacements + ' purchase' + (result.best.replacements === 1 ? '' : 's') + '. Choosing it over the worst option here saves about ' + money(Math.max(0, result.savings), currency) + ' over the same horizon.'
            : 'Add an option to compare.'}
        />
        <Ring
          value={result.breakEven ? result.breakEven.years : 0}
          max={Math.max(5, result.breakEven ? result.breakEven.years : 5)}
          tone="amber"
          label="Break-even year"
          sub={result.breakEven && result.breakEven.years
            ? 'The pricier ' + result.breakEven.dearer.label + ' becomes the cheaper choice after about ' + result.breakEven.years + ' years'
            : 'The cheaper option stays cheapest across this horizon'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Cost per use, lowest first</div>
          <Bars
            data={result.ranked.map((row) => ({ label: row.label.slice(0, 12), value: Number(row.perUse.toFixed(3)) }))}
            format={(value) => value.toFixed(2)}
            suffix=""
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Lower is better. The gap between the cheapest and most expensive is what the buying decision is actually about — everything else is preference.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Total cost of ownership</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="max-h-72 space-y-1.5 overflow-auto">
            {result.ranked.map((row, index) => (
              <div key={row.id} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className={index === 0 ? 'font-medium text-cyan-j' : 'font-medium'}>{row.label}</span>
                  <span className="font-mono-j text-cyan-j">{money(row.perUse, currency)} per use</span>
                </div>
                <div className="mt-0.5 font-mono-j text-[10px] text-muted-foreground">
                  total {money(row.total, currency)} · {row.replacements} purchase{row.replacements === 1 ? '' : 's'} · {Math.round(row.uses).toLocaleString()} uses · {money(row.perYear, currency)} a year
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Cost per use for the first option as the horizon grows</div>
          <Bars data={result.ladder} format={(value) => value.toFixed(2)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Cost per use falls steeply at first and then flattens. That shape is the whole argument for buying quality: the expensive part is the purchase, and time spreads it
            thinner with every use.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The breakdown</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            {result.parsed.map((row) => (
              <div key={row.id} className="space-y-1 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">{row.label} — purchases</span><span>{money(row.purchaseTotal, currency)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">upkeep</span><span>{money(row.maintenanceTotal, currency)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">less resale</span><span>{money(row.resaleValue, currency)}</span></div>
                <div className="flex items-center justify-between text-cyan-j"><span>total</span><span>{money(row.total, currency)}</span></div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Best per use" value={result.best ? money(result.best.perUse, currency) : '—'} mono sub={result.best ? result.best.label : ''} />
        <Stat label="Horizon" value={result.years + ' years'} mono sub={'first option lasts ' + (result.parsed[0] ? result.parsed[0].lifespan : 0) + ' each'} />
        <Stat label="Break-even" value={result.breakEven && result.breakEven.years ? 'year ' + result.breakEven.years : 'never'} mono sub={result.breakEven ? result.breakEven.dearer.label : 'not applicable'} />
        <Stat label="Saving from the best choice" value={money(Math.max(0, result.savings), currency)} mono sub="across the horizon" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Buying decisions this settles</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Tools, boots, cookware and anything else used often: cost per use makes the honest case for spending more up front.</p>
            <p>· Anything used twice a year should be rented, borrowed or bought cheap. Cost per use exposes a premium price that will never be earned back.</p>
            <p>· Cars are the classic case. Purchase price, servicing, fuel and resale together decide the real number, and the sticker price decides none of it.</p>
            <p>· Household appliances: an efficient machine that lasts twelve years usually beats a cheap one that lasts four, even ignoring the electricity.</p>
            <p>· Anything consumable should be compared per unit of use rather than per pack, which is where bulk pricing quietly wins.</p>
            <p>· {result.breakEven && result.breakEven.years ? 'Here the crossover is around year ' + result.breakEven.years + '. If you will not keep it that long, buy the cheaper one without guilt.' : 'On these numbers the cheaper option stays cheapest, so paying more would be for reasons other than money.'}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the maths cannot price</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Reliability has a value beyond money. The cheap option that fails mid-job costs time, and time is often the scarcer resource.</p>
            <p>· Resale assumes a market for the item. Niche or unfashionable goods often fetch nothing, so treat that figure as optimistic by default.</p>
            <p>· Upkeep covers servicing and consumables, not the possibility of a large single repair. A wide range of outcomes is normal, not an error in the model.</p>
            <p>· Cost per use assumes you will actually use it. Buying the professional version and using it three times is the most expensive way to own anything.</p>
            <p>· The cheapest per use is not always the right answer. Comfort, safety and repairability are real, and they belong in the decision alongside the arithmetic.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Options', value: String(result.parsed.length) },
                { label: 'Best per use', value: result.best ? money(result.best.perUse, currency) : '—' },
                { label: 'Break-even', value: result.breakEven && result.breakEven.years ? 'year ' + result.breakEven.years : 'never' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>purchases = price × ceil(horizon ÷ lifespan)</p>
          <p>total = purchases + upkeep × horizon − resale value at the end</p>
          <p>uses = uses per year × horizon</p>
          <p>cost per use = total ÷ uses</p>
          <p>break-even = the first year the dearer option total falls below the cheaper option total</p>
          <p className="text-cyan-j">Check: {result.parsed[0] ? money(result.parsed[0].price, currency) + ' × ' + result.parsed[0].replacements + ' purchases = ' + money(result.parsed[0].purchaseTotal, currency) : ''}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Resale is estimated by straight-line depreciation over each lifespan, which is a reasonable placeholder rather than a market valuation. Everything else follows directly
          from your own numbers.
        </p>
      </Panel>
    </ToolShell>
  );
}