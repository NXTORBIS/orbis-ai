import { useState } from 'react';
import { Zap } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Field, Stat } from './shared';

export default function OhmsLaw() {
  const [vals, setVals] = useState({ V: '', I: '', R: '', P: '' });
  const set = (k, val) => setVals((p) => ({ ...p, [k]: val }));

  const solve = () => {
    const { V, I, R, P } = vals;
    const has = (k) => vals[k] !== '' && !isNaN(parseFloat(vals[k]));
    const filled = ['V', 'I', 'R', 'P'].filter(has);
    if (filled.length < 2) return vals;
    const g = (k) => parseFloat(vals[k]);
    let v = g('V'), i = g('I'), r = g('R'), p = g('P');
    const out = { ...vals };
    if (has('V') && has('I')) { r = v / i; p = v * i; }
    else if (has('V') && has('R')) { i = v / r; p = v * i; }
    else if (has('V') && has('P')) { i = p / v; r = v / i; }
    else if (has('I') && has('R')) { v = i * r; p = v * i; }
    else if (has('I') && has('P')) { v = p / i; r = v / i; }
    else if (has('R') && has('P')) { i = Math.sqrt(p / r); v = i * r; }
    out.V = isFinite(v) ? v.toFixed(4) : ''; out.I = isFinite(i) ? i.toFixed(4) : ''; out.R = isFinite(r) ? r.toFixed(4) : ''; out.P = isFinite(p) ? p.toFixed(4) : '';
    return out;
  };
  const res = solve();

  return (
    <div className="space-y-4">
      <ToolHeader icon={Zap} title="Ohm's Law Calculator" desc="Enter any two values of voltage, current, resistance or power — the rest are computed." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Voltage (V)"><Input value={vals.V} onChange={(e) => set('V', e.target.value)} placeholder="volts" /></Field>
        <Field label="Current (I)"><Input value={vals.I} onChange={(e) => set('I', e.target.value)} placeholder="amps" /></Field>
        <Field label="Resistance (R)"><Input value={vals.R} onChange={(e) => set('R', e.target.value)} placeholder="ohms" /></Field>
        <Field label="Power (P)"><Input value={vals.P} onChange={(e) => set('P', e.target.value)} placeholder="watts" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Voltage" value={res.V ? `${res.V} V` : '—'} mono />
        <Stat label="Current" value={res.I ? `${res.I} A` : '—'} mono />
        <Stat label="Resistance" value={res.R ? `${res.R} Ω` : '—'} mono />
        <Stat label="Power" value={res.P ? `${res.P} W` : '—'} mono />
      </div>
      <p className="text-[11px] text-muted-foreground">Formulas: V = IR · P = VI = I²R = V²/R</p>
    </div>
  );
}