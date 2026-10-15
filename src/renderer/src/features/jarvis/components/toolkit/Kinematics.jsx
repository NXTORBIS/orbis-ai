import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Field, Stat } from './shared';

export default function Kinematics() {
  const [v, setV] = useState({ u: '', a: '', t: '', s: '', v: '' });
  const set = (k, val) => setV((p) => ({ ...p, [k]: val }));
  const has = (k) => v[k] !== '' && !isNaN(parseFloat(v[k]));
  const g = (k) => parseFloat(v[k]);

  const res = (() => {
    let u = has('u') ? g('u') : null, a = has('a') ? g('a') : null, t = has('t') ? g('t') : null, s = has('s') ? g('s') : null, vf = has('v') ? g('v') : null;
    const known = [u, a, t, s, vf].filter((x) => x !== null).length;
    if (known < 3) return null;
    // v = u + at ; s = ut + ½at² ; v² = u² + 2as ; s = ½(u+v)t
    for (let iter = 0; iter < 5; iter++) {
      if (vf === null && u !== null && a !== null && t !== null) vf = u + a * t;
      if (vf === null && u !== null && a !== null && s !== null) vf = Math.sqrt(u * u + 2 * a * s);
      if (vf === null && u !== null && s !== null && t !== null) vf = (2 * s) / t - u;
      if (u === null && vf !== null && a !== null && t !== null) u = vf - a * t;
      if (u === null && vf !== null && a !== null && s !== null) u = Math.sqrt(vf * vf - 2 * a * s);
      if (u === null && vf !== null && s !== null && t !== null) u = (2 * s) / t - vf;
      if (a === null && u !== null && vf !== null && t !== null) a = (vf - u) / t;
      if (a === null && u !== null && vf !== null && s !== null) a = (vf * vf - u * u) / (2 * s);
      if (a === null && u !== null && s !== null && t !== null) a = (2 * (s - u * t)) / (t * t);
      if (t === null && u !== null && vf !== null && a !== null && a !== 0) t = (vf - u) / a;
      if (t === null && u !== null && a !== null && s !== null) { const q = u * u + 2 * a * s; if (q >= 0) t = (-u + Math.sqrt(q)) / a; }
      if (t === null && u !== null && vf !== null && s !== null) t = (2 * s) / (u + vf);
      if (s === null && u !== null && a !== null && t !== null) s = u * t + 0.5 * a * t * t;
      if (s === null && u !== null && vf !== null && t !== null) s = 0.5 * (u + vf) * t;
      if (s === null && u !== null && vf !== null && a !== null) s = (vf * vf - u * u) / (2 * a);
    }
    const f = (x) => (x !== null && isFinite(x)) ? x.toFixed(4) : '—';
    return { u: f(u), a: f(a), t: f(t), s: f(s), v: f(vf) };
  })();

  return (
    <div className="space-y-4">
      <ToolHeader icon={Gauge} title="Kinematics Calculator" desc="Constant-acceleration equations. Enter any three of u, a, t, s, v — the rest are solved." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field label="u (initial)"><Input value={v.u} onChange={(e) => set('u', e.target.value)} placeholder="m/s" /></Field>
        <Field label="a (accel)"><Input value={v.a} onChange={(e) => set('a', e.target.value)} placeholder="m/s²" /></Field>
        <Field label="t (time)"><Input value={v.t} onChange={(e) => set('t', e.target.value)} placeholder="s" /></Field>
        <Field label="s (disp)"><Input value={v.s} onChange={(e) => set('s', e.target.value)} placeholder="m" /></Field>
        <Field label="v (final)"><Input value={v.v} onChange={(e) => set('v', e.target.value)} placeholder="m/s" /></Field>
      </div>
      {res ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="u" value={res.u} mono /><Stat label="a" value={res.a} mono /><Stat label="t" value={res.t} mono /><Stat label="s" value={res.s} mono /><Stat label="v" value={res.v} mono />
        </div>
      ) : <p className="text-sm text-muted-foreground">Enter at least three values to solve.</p>}
      <p className="text-[11px] text-muted-foreground">Uses v = u + at, s = ut + ½at², v² = u² + 2as, s = ½(u+v)t.</p>
    </div>
  );
}