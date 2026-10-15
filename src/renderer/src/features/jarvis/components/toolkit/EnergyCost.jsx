import { useMemo, useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const PRESETS = {
  'Air conditioner': 1500,
  'Fridge': 150,
  'Space heater': 2000,
  'Washing machine': 500,
  'Laptop': 65,
  'LED bulb': 9,
  'Fan': 70,
  'Microwave': 1000,
  'TV': 120,
  'Water heater': 3000,
};

const money = (value) => (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);

export default function EnergyCost() {
  const [rows, setRows] = useState([
    { id: uid(), name: 'Air conditioner', watts: '1500', hours: '6', days: '30', qty: '1' },
    { id: uid(), name: 'Fridge', watts: '150', hours: '24', days: '30', qty: '1' },
    { id: uid(), name: 'Laptop', watts: '65', hours: '8', days: '26', qty: '2' },
  ]);
  const [rate, setRate] = useState('0.28');
  const [standing, setStanding] = useState('0');
  const [currency, setCurrency] = useState('$');

  const result = useMemo(() => {
    const cleaned = rows.map((row) => {
      const watts = Number(row.watts) || 0;
      const hours = Number(row.hours) || 0;
      const days = Number(row.days) || 0;
      const qty = Number(row.qty) || 1;
      const kwh = (watts * hours * days * qty) / 1000;
      return { ...row, kwh, cost: kwh * (Number(rate) || 0) };
    });
    const totalKwh = cleaned.reduce((sum, row) => sum + row.kwh, 0);
    const totalCost = cleaned.reduce((sum, row) => sum + row.cost, 0) + (Number(standing) || 0);
    const sorted = [...cleaned].sort((a, b) => b.cost - a.cost);
    return {
      cleaned: sorted,
      totalKwh,
      totalCost,
      monthly: totalCost,
      yearly: totalCost * 12,
      dailyKwh: totalKwh / 30,
      biggest: sorted[0],
      avgRate: totalKwh ? totalCost / totalKwh : 0,
    };
  }, [rows, rate, standing]);

  const setRow = (id, patch) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const report = [
    `Energy use: ${result.totalKwh.toFixed(1)} kWh a month · ${result.dailyKwh.toFixed(2)} kWh a day`,
    `Cost: ${currency}${money(result.totalCost)} a month, ${currency}${money(result.yearly)} a year at ${currency}${rate}/kWh`,
    '',
    ...result.cleaned.map((row) => `${row.name || 'Appliance'}: ${row.kwh.toFixed(1)} kWh · ${currency}${money(row.cost)} (${result.totalCost ? ((row.cost / result.totalCost) * 100).toFixed(0) : 0}%)`),
  ].join('\n');

  return (
    <ToolShell
      toolId="energy-cost"
      icon={Zap}
      title="Appliance Energy Cost"
      desc="Turn watts and hours into real money — see which appliance is actually driving the bill, month by month and year by year."
      state={{ rows, rate, standing, currency }}
      onRestore={(restored) => {
        if (Array.isArray(restored.rows) && restored.rows.length) setRows(restored.rows);
        if (restored.rate !== undefined) setRate(String(restored.rate));
        if (restored.standing !== undefined) setStanding(String(restored.standing));
        if (restored.currency) setCurrency(restored.currency);
      }}
      exportText={report}
      exportName="energy-cost.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={currency} onChange={setCurrency} options={[{ value: '$', label: '$' }, { value: '€', label: '€' }, { value: '£', label: '£' }, { value: '₹', label: '₹' }]} />
        <CopyBtn value={report} label="Copy breakdown" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Your tariff · ${currency}${rate} per kWh`} hint="Find it on the bill — it is the unit rate, not the standing charge">
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Standing charge per month" hint="Leave zero if you only want usage">
          <input value={standing} onChange={(e) => setStanding(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="hidden grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.6fr_auto] gap-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
          <span>Appliance</span><span>Watts</span><span>Hours/day</span><span>Days</span><span>Qty</span><span />
        </div>
        {rows.map((row) => (
          <div key={row.id} className="tk-card tk-depth grid grid-cols-[1.4fr_1fr_auto] gap-2 rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5 sm:grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.6fr_auto] sm:items-center">
            <input value={row.name} onChange={(e) => setRow(row.id, { name: e.target.value })} placeholder="Appliance" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
            <input value={row.watts} onChange={(e) => setRow(row.id, { watts: e.target.value })} inputMode="decimal" placeholder="Watts" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
            <input value={row.hours} onChange={(e) => setRow(row.id, { hours: e.target.value })} inputMode="decimal" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
            <input value={row.days} onChange={(e) => setRow(row.id, { days: e.target.value })} inputMode="decimal" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
            <input value={row.qty} onChange={(e) => setRow(row.id, { qty: e.target.value })} inputMode="decimal" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
            <button type="button" onClick={() => setRows(rows.filter((r) => r.id !== row.id))} disabled={rows.length <= 1} className="justify-self-end text-muted-foreground transition hover:text-red-500 disabled:opacity-30">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRows((current) => [...current, { id: uid(), name: '', watts: '', hours: '1', days: '30', qty: '1' }].slice(0, 14))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add an appliance
        </button>
        <select
          onChange={(e) => {
            const name = e.target.value;
            if (!name) return;
            setRows((current) => [...current, { id: uid(), name, watts: String(PRESETS[name]), hours: '4', days: '30', qty: '1' }]);
            e.target.value = '';
          }}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-xs"
        >
          <option value="">Quick add a typical appliance…</option>
          {Object.entries(PRESETS).map(([name, watts]) => (
            <option key={name} value={name}>{name} — {watts} W</option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero label="Electricity cost a month" value={`${currency}${money(result.monthly)}`} sub={`${result.totalKwh.toFixed(1)} kWh · ${currency}${money(result.yearly)} a year`} />
        <Ring
          value={result.biggest ? result.biggest.cost : 0}
          max={result.totalCost || 1}
          tone="amber"
          label={result.biggest ? `Biggest: ${result.biggest.name || 'top row'}` : 'Add an appliance'}
          sub={result.biggest ? `${currency}${money(result.biggest.cost)} of the bill` : ''}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Monthly kWh" value={result.totalKwh.toFixed(1)} mono />
        <Stat label="Daily kWh" value={result.dailyKwh.toFixed(2)} mono />
        <Stat label="Yearly cost" value={`${currency}${money(result.yearly)}`} mono />
        <Stat label="Effective rate" value={`${currency}${result.avgRate.toFixed(3)}`} mono sub="per kWh incl. standing" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Where the money goes</div>
        <Bars
          data={result.cleaned.map((row, index) => ({ label: (row.name || '—').slice(0, 8), value: row.cost, tone: index === 0 ? undefined : undefined }))}
          format={(v) => money(v)}
        />
        <div className="mt-3 space-y-1">
          {result.cleaned.map((row) => (
            <div key={row.id} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="flex-1 truncate">{row.name || 'Untitled'}</span>
              <span className="font-mono-j text-muted-foreground">{row.kwh.toFixed(1)} kWh</span>
              <span className="font-mono-j text-muted-foreground">{result.totalKwh ? ((row.kwh / result.totalKwh) * 100).toFixed(0) : 0}%</span>
              <span className="font-mono-j text-cyan-j">{currency}{money(row.cost)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Ways to cut it</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Heating and cooling usually account for the largest share — a two-degree change in the thermostat is worth more than switching every bulb in the house.</p>
          <p>· Anything that runs 24 hours (fridges, routers, standby boxes) adds up quietly: check the hours column, since a 150 W fridge costs more over a month than a 2000 W heater run for an hour a day.</p>
          <p>· Standby loads are typically 3–10% of a household bill; a switched extension strip handles several at once.</p>
          <p>· Your own meter reading is the arbiter: if this total is far from the bill, the hours or wattage figures are the first place to correct.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Wattage on a label is the maximum draw, not what the appliance uses continuously — a fridge compressor cycles, a laptop charges and then
          idles, and an inverter air conditioner ramps down. Treat this as a good approximation, and use a plug-in energy monitor for the two or three
          appliances you actually want to nail down.
        </p>
      </Panel>
    </ToolShell>
  );
}