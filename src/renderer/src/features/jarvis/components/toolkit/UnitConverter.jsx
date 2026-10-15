import { useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, CopyBtn, Panel, Stat } from './shared';

const CATEGORIES = {
  length: { label: 'Length', units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 } },
  mass: { label: 'Mass', units: { mg: 1e-6, g: 0.001, kg: 1, tonne: 1000, oz: 0.028349523125, lb: 0.45359237, stone: 6.35029318 } },
  area: { label: 'Area', units: { 'mm²': 1e-6, 'cm²': 1e-4, 'm²': 1, hectare: 10000, 'km²': 1e6, 'in²': 0.00064516, 'ft²': 0.09290304, 'yd²': 0.83612736, acre: 4046.8564224, 'mi²': 2589988.110336 } },
  volume: { label: 'Volume', units: { ml: 0.001, litre: 1, 'm³': 1000, tsp: 0.0049289216, tbsp: 0.0147867648, cup: 0.2365882365, pint: 0.473176473, quart: 0.946352946, gallon: 3.785411784, 'fl oz': 0.0295735296 } },
  speed: { label: 'Speed', units: { 'm/s': 1, 'km/h': 0.2777777778, mph: 0.44704, knot: 0.5144444444, 'ft/s': 0.3048, mach: 343 } },
  time: { label: 'Time', units: { ms: 0.001, s: 1, min: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 } },
  data: { label: 'Data', units: { bit: 0.125, B: 1, KB: 1000, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776 } },
  temperature: { label: 'Temp', units: {}, temp: true },
};

const TEMPS = ['°C', '°F', 'K', '°R'];
const toC = (v, u) => (u === '°C' ? v : u === '°F' ? (v - 32) / 1.8 : u === 'K' ? v - 273.15 : (v - 491.67) / 1.8);
const fromC = (v, u) => (u === '°C' ? v : u === '°F' ? v * 1.8 + 32 : u === 'K' ? v + 273.15 : (v + 273.15) * 1.8);

const show = (n) => {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-9) return n.toExponential(6);
  return Number(n.toPrecision(10)).toLocaleString('en-US', { maximumSignificantDigits: 10 });
};

export default function UnitConverter() {
  const [cat, setCat] = useState('length');
  const [from, setFrom] = useState('m');
  const [to, setTo] = useState('ft');
  const [value, setValue] = useState('1');

  const spec = CATEGORIES[cat];
  const list = spec.temp ? TEMPS : Object.keys(spec.units);

  const rows = useMemo(() => {
    const v = Number(String(value).replace(/[,\s]/g, ''));
    if (!Number.isFinite(v)) return [];
    if (!spec.temp && (!spec.units[from] || !spec.units[to])) return [];
    const base = spec.temp ? toC(v, from) : v * spec.units[from];
    return list.map((unit) => {
      const result = spec.temp ? fromC(base, unit) : base / spec.units[unit];
      return { unit, text: show(result) };
    });
  }, [value, from, to, spec, list]);

  const primary = rows.find((r) => r.unit === to);

  const pickCat = (id) => {
    const next = CATEGORIES[id];
    const keys = next.temp ? TEMPS : Object.keys(next.units);
    setCat(id);
    setFrom(keys[0]);
    setTo(keys[1] || keys[0]);
  };

  return (
    <ToolShell
      toolId="units"
      icon={ArrowLeftRight}
      title="Unit Converter"
      desc="Length, mass, area, volume, speed, time, data and temperature — every equivalent on one screen."
      state={{ cat, from, to, value }}
      onRestore={(saved) => { setCat(saved.cat); setFrom(saved.from); setTo(saved.to); setValue(saved.value); }}
      exportText={rows.map((r) => `${r.text} ${r.unit}`).join('\n')}
      exportName="conversion.txt"
    >
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {Object.entries(CATEGORIES).map(([id, c]) => (
          <button
            key={id}
            type="button"
            onClick={() => pickCat(id)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs transition ${cat === id ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Panel className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <Field label="From">
          <div className="flex gap-2">
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-xs">
              {list.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </Field>
        <button type="button" onClick={() => { setFrom(to); setTo(from); }} className="justify-self-center rounded-lg border border-border/70 p-2 text-cyan-j transition hover:border-cyan-j/50" title="Swap units">
          <ArrowLeftRight className="h-4 w-4" />
        </button>
        <Field label="To">
          <div className="flex h-9 items-center gap-2 rounded-md border border-input px-3">
            <span className="min-w-0 flex-1 truncate font-mono-j text-sm">{primary ? primary.text : '—'}</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="h-7 rounded-md border border-input bg-transparent px-1 text-xs">
              {list.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </Field>
      </Panel>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Input" value={`${value || '0'} ${from}`} mono />
        <Stat label="Converted" value={primary ? `${primary.text} ${to}` : '—'} mono />
      </div>

      <Panel>
        <div className="mb-2 text-xs font-medium">Every {spec.label.toLowerCase()} equivalent</div>
        <div className="max-h-72 space-y-1 overflow-auto scrollbar-thin">
          {rows.map((r) => (
            <div key={r.unit} className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5">
              <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{r.unit}</span>
              <span className="min-w-0 flex-1 truncate font-mono-j text-xs">{r.text}</span>
              <CopyBtn value={`${r.text} ${r.unit}`} />
            </div>
          ))}
          {!rows.length && <p className="py-4 text-center text-[11px] text-muted-foreground">Enter a number to convert.</p>}
        </div>
      </Panel>
    </ToolShell>
  );
}