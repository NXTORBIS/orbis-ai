import { useMemo, useState } from 'react';
import { Fuel, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const blank = () => ({ id: Math.random().toString(36).slice(2), odometer: '', volume: '', price: '1.60' });

const CONVERSIONS = {
  'km-L': { distance: 'km', volume: 'L', distanceFactor: 1, volumeFactor: 1, efficiencyLabel: 'L per 100 km' },
  'mi-gal': { distance: 'mi', volume: 'gal', distanceFactor: 1, volumeFactor: 1, efficiencyLabel: 'mpg' },
};

export default function FuelLog() {
  const [system, setSystem] = useState('km-L');
  const [currency, setCurrency] = useState('£');
  const [rows, setRows] = useState([
    { id: 'a', odometer: '41250', volume: '42.5', price: '1.62' },
    { id: 'b', odometer: '41780', volume: '44.1', price: '1.59' },
    { id: 'c', odometer: '42310', volume: '41.8', price: '1.66' },
    { id: 'd', odometer: '42845', volume: '46.3', price: '1.71' },
    { id: 'e', odometer: '43360', volume: '43.2', price: '1.64' },
  ]);

  const set = (id, key, value) => setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const config = CONVERSIONS[system] || CONVERSIONS['km-L'];
    const parsed = rows
      .map((row) => ({
        id: row.id,
        odometer: Number(row.odometer) || 0,
        volume: Number(row.volume) || 0,
        price: Number(row.price) || 0,
      }))
      .filter((row) => row.odometer > 0 && row.volume > 0)
      .sort((a, b) => a.odometer - b.odometer);

    const fills = parsed.map((row, index) => {
      const previous = index > 0 ? parsed[index - 1] : null;
      const distance = previous ? row.odometer - previous.odometer : 0;
      const cost = row.volume * row.price;
      const litresPer100 = distance ? (row.volume / distance) * 100 : 0;
      const mpg = distance ? distance / (row.volume * 0.264172) : 0;
      return {
        ...row, distance, cost, litresPer100, mpg,
        efficiency: system === 'km-L' ? litresPer100 : mpg,
        costPerDistance: distance ? cost / distance : 0,
        label: String(index + 1),
      };
    });

    const measured = fills.filter((row) => row.distance > 0);
    const totalDistance = measured.reduce((sum, row) => sum + row.distance, 0);
    const totalVolume = measured.reduce((sum, row) => sum + row.volume, 0);
    const totalCost = measured.reduce((sum, row) => sum + row.cost, 0);
    const averageLitresPer100 = totalDistance ? (totalVolume / totalDistance) * 100 : 0;
    const averageMpg = totalDistance ? totalDistance / (totalVolume * 0.264172) : 0;
    const averageEfficiency = system === 'km-L' ? averageLitresPer100 : averageMpg;
    const costPerDistance = totalDistance ? totalCost / totalDistance : 0;
    const costPerHundred = costPerDistance * 100;
    const averagePrice = totalVolume ? totalCost / totalVolume : 0;

    const efficiencies = measured.map((row) => row.efficiency);
    const best = efficiencies.length ? Math.min(...efficiencies) : 0;
    const worst = efficiencies.length ? Math.max(...efficiencies) : 0;
    const half = Math.floor(measured.length / 2);
    const firstHalf = half ? measured.slice(0, half).reduce((sum, row) => sum + row.efficiency, 0) / half : 0;
    const secondHalf = half ? measured.slice(measured.length - half).reduce((sum, row) => sum + row.efficiency, 0) / half : 0;
    const trend = secondHalf - firstHalf;

    const annualDistance = 12000;
    const projected = costPerDistance * annualDistance;

    return {
      config, fills, measured, totalDistance, totalVolume, totalCost, averageEfficiency, averageLitresPer100, averageMpg,
      costPerDistance, costPerHundred, averagePrice, best, worst, trend, projected, annualDistance,
      chart: measured.map((row) => ({ label: row.label, value: Number(row.efficiency.toFixed(2)) })),
      efficiencyUnit: system === 'km-L' ? 'L/100 km' : 'mpg',
    };
  }, [rows, system]);

  const report = useMemo(() => [
    'Fuel log: ' + result.measured.length + ' measured fills',
    'Distance ' + Math.round(result.totalDistance).toLocaleString() + ' ' + result.config.distance + ' using ' + result.totalVolume.toFixed(1) + ' ' + result.config.volume,
    'Average ' + (system === 'km-L' ? result.averageLitresPer100.toFixed(2) + ' L per 100 km' : result.averageMpg.toFixed(1) + ' mpg'),
    'Total spend ' + currency + result.totalCost.toFixed(2) + ' · ' + currency + result.costPerHundred.toFixed(2) + ' per 100 ' + result.config.distance,
    'Best ' + result.best.toFixed(2) + ' · worst ' + result.worst.toFixed(2) + ' ' + result.efficiencyUnit,
    'Trend across the log: ' + (result.trend > 0 ? 'worsening by ' : 'improving by ') + Math.abs(result.trend).toFixed(2) + ' ' + result.efficiencyUnit,
    'At ' + result.annualDistance.toLocaleString() + ' ' + result.config.distance + ' a year, fuel costs about ' + currency + result.projected.toFixed(0),
  ].join('\n'), [result, system, currency]);

  return (
    <ToolShell
      toolId="fuel-log"
      icon={Fuel}
      title="Fuel & Mileage Log"
      desc="Log each fill and see real consumption, cost per distance, the trend across tanks and what a year of driving costs — the only way to catch a car that has started drinking fuel."
      state={{ system, currency, rows }}
      onRestore={(restored) => {
        if (restored.system) setSystem(restored.system);
        if (typeof restored.currency === 'string') setCurrency(restored.currency);
        if (Array.isArray(restored.rows) && restored.rows.length) setRows(restored.rows);
      }}
      exportText={report}
      exportName="fuel-log.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={system} onChange={setSystem} options={[{ value: 'km-L', label: 'km and litres' }, { value: 'mi-gal', label: 'miles and gallons' }]} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Fills, oldest first</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.measured.length} usable fills</span>
        </div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-4">
              <Field label={'Odometer, ' + result.config.distance}><input value={row.odometer} onChange={(e) => set(row.id, 'odometer', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label={'Volume, ' + result.config.volume}><input value={row.volume} onChange={(e) => set(row.id, 'volume', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Price per unit"><input value={row.price} onChange={(e) => set(row.id, 'price', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <div className="flex items-end">
                <button type="button" onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setRows((current) => [...current, blank()])} className="inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
            <Plus className="h-3.5 w-3.5" /> Add a fill
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Currency</span>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-8 w-16 rounded-md border border-input bg-transparent px-2 font-mono-j text-xs" />
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={system === 'km-L' ? 'Average consumption' : 'Average economy'}
          value={(system === 'km-L' ? result.averageLitresPer100.toFixed(2) : result.averageMpg.toFixed(1))}
          unit={result.efficiencyUnit}
          sub={'Across ' + Math.round(result.totalDistance).toLocaleString() + ' ' + result.config.distance + ' and ' + result.measured.length + ' fills, at ' + currency + result.costPerHundred.toFixed(2) + ' per 100 ' + result.config.distance + '. That projects to about ' + currency + result.projected.toFixed(0) + ' a year at ' + result.annualDistance.toLocaleString() + ' ' + result.config.distance + ' driven.'}
        />
        <Ring
          value={result.costPerHundred}
          max={Math.max(20, Math.ceil(result.costPerHundred * 1.5))}
          label={'Cost per 100 ' + result.config.distance}
          sub={'Average price paid ' + currency + result.averagePrice.toFixed(3) + ' per ' + result.config.volume}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Consumption tank by tank</div>
          {result.chart.length > 0 ? (
            <Bars data={result.chart} format={(value) => value.toFixed(1)} suffix="" highlightLast={false} />
          ) : (
            <p className="text-[11px] text-muted-foreground">Add at least two fills to compare consumption between tanks.</p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            {result.trend > 0.3 ? 'Consumption is worsening across the log by ' + result.trend.toFixed(2) + ' ' + result.efficiencyUnit + '. A steady drift in one direction is what a failing thermostat, a dragging brake or a dropping tyre pressure looks like in data.' : result.trend < -0.3 ? 'Consumption is improving across the log, which is what better fuel and warmer weather look like.' : 'Consumption is holding roughly steady, which is what a healthy car doing similar journeys looks like.'}
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Every fill</span>
            <CopyBtn value={report} label="Copy the log" />
          </div>
          <div className="max-h-64 space-y-1 overflow-auto">
            {result.fills.map((row) => (
              <div key={row.id} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-mono-j text-muted-foreground">{Math.round(row.odometer).toLocaleString()} {result.config.distance}</span>
                  <span className="font-mono-j text-cyan-j">{row.distance > 0 ? row.efficiency.toFixed(2) + ' ' + result.efficiencyUnit : 'baseline'}</span>
                </div>
                <div className="mt-0.5 font-mono-j text-[10px] text-muted-foreground">
                  {row.volume.toFixed(1)} {result.config.volume} at {currency}{row.price.toFixed(3)} · {currency}{row.cost.toFixed(2)}
                  {row.distance > 0 ? ' · ' + Math.round(row.distance) + ' ' + result.config.distance + ' driven' : ''}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Average" value={(system === 'km-L' ? result.averageLitresPer100.toFixed(2) : result.averageMpg.toFixed(1)) + ' ' + result.efficiencyUnit} mono />
        <Stat label="Total spend" value={currency + result.totalCost.toFixed(2)} mono sub={result.totalVolume.toFixed(1) + ' ' + result.config.volume} />
        <Stat label="Best tank" value={result.best ? result.best.toFixed(2) : '—'} mono sub={result.worst ? 'worst ' + result.worst.toFixed(2) : ''} />
        <Stat label="Cost per year" value={currency + result.projected.toFixed(0)} mono sub={'at ' + result.annualDistance.toLocaleString() + ' ' + result.config.distance} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Measuring consumption the honest way</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Fill to full, note the odometer, drive, fill to full again. The volume added divided by the distance is the real figure; the trip computer is an estimate.</p>
            <p>· Skip the first entry in any comparison, because there is no previous fill to measure from. That is why the first row shows baseline rather than a number.</p>
            <p>· One tank proves nothing. Fill-ups vary by pump cut-off, temperature and journey mix, so judge from three or four tanks at least.</p>
            <p>· Keep the receipts or the log. A sudden change is diagnostic: consumption that jumps 15% without a change in driving is a mechanical problem to investigate.</p>
            <p>· {system === 'km-L' ? 'Lower L per 100 km is better, so the smallest number in the chart is the best tank.' : 'Higher mpg is better, so the tallest bar in the chart is the best tank.'}</p>
            <p>· Price per unit and consumption are separate levers. Cheaper fuel at worse consumption is a false economy, and the cost per 100 figure catches it immediately.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What actually moves the number</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Tyre pressure is the cheapest win. Under-inflated tyres can cost several per cent, and they wear out faster at the same time.</p>
            <p>· Driving style dominates everything else. Smooth acceleration and reading the road ahead beats any additive or gadget.</p>
            <p>· Every 10 km/h above about 100 km/h costs noticeably more, because drag rises with the square of speed.</p>
            <p>· Short cold trips are the worst case: the engine runs rich while warming up, so a car used only for short journeys will always look thirsty.</p>
            <p>· Roof racks and open windows at speed add drag; air conditioning adds load. Both are real, and neither is as large as driving style.</p>
            <p>· Cold weather raises consumption through denser air and longer warm-up, so winter figures a little worse than summer ones for the same driving.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Average', value: (system === 'km-L' ? result.averageLitresPer100.toFixed(2) : result.averageMpg.toFixed(1)) + ' ' + result.efficiencyUnit },
                { label: 'Per 100', value: currency + result.costPerHundred.toFixed(2) },
                { label: 'Trend', value: (result.trend > 0 ? '+' : '') + result.trend.toFixed(2) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>distance since last fill = odometer reading minus the previous reading</p>
          <p>L per 100 km = volume added ÷ distance × 100</p>
          <p>mpg = distance in miles ÷ (volume in US gallons)</p>
          <p>cost per distance = cost of the fill ÷ distance driven</p>
          <p>average = total volume ÷ total distance, which weights correctly for unequal fills</p>
          <p className="text-cyan-j">Check: {result.totalVolume.toFixed(1)} {result.config.volume} over {Math.round(result.totalDistance).toLocaleString()} {result.config.distance} gives {result.averageLitresPer100.toFixed(2)} L per 100 km.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The average is volume-weighted rather than an average of per-tank figures, because a short tank and a long one do not deserve equal weight. US gallons are used for the mpg
          calculation; an imperial gallon is about 20% larger.
        </p>
      </Panel>
    </ToolShell>
  );
}