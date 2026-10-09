import React, { useState } from 'react';
import { Atom } from 'lucide-react';
import Section from './Section';

const PRESETS = [
  { id: '0', label: '|0_L⟩', a: '1', b: '0' },
  { id: '1', label: '|1_L⟩', a: '0', b: '1' },
  { id: '+', label: '|+_L⟩', a: '1/√2', b: '1/√2' },
  { id: '-', label: '|−_L⟩', a: '1/√2', b: '−1/√2' },
  { id: 'custom', label: 'Custom', a: '', b: '' },
];

// Evaluate a safe arithmetic expression like "1/sqrt(2)" -> number.
function evalAmp(str) {
  if (!str) return null;
  try {
    const v = str.replace(/√/g, 'Math.sqrt').replace(/−/g, '-').replace(/\s/g, '');
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict"; return (${v});`)();
    if (typeof val !== 'number' || !isFinite(val)) return null;
    return val;
  } catch {
    return null;
  }
}

export default function StateSetup({ value, onChange }) {
  const [preset, setPreset] = useState(value.preset || '0');
  const [a, setA] = useState(value.a ?? '1');
  const [b, setB] = useState(value.b ?? '0');
  const [err, setErr] = useState(null);

  const apply = (presetId, av, bv) => {
    setPreset(presetId);
    if (presetId !== 'custom') {
      const p = PRESETS.find((x) => x.id === presetId);
      setA(p.a); setB(p.b); setErr(null);
      onChange({ preset: presetId, a: p.a, b: p.b, normalized: true });
    } else {
      const na = evalAmp(av); const nb = evalAmp(bv);
      if (na === null || nb === null) { setErr('Cannot parse α or β as a number.'); return; }
      const norm = Math.sqrt(na * na + nb * nb);
      if (norm < 1e-12) { setErr('State cannot be the zero vector.'); return; }
      setErr(null);
      onChange({ preset: 'custom', a: av, b: bv, normalized: false, norm });
    }
  };

  return (
    <Section title="Logical State" icon={Atom}>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => apply(p.id, p.a, p.b)}
            className={`rounded-full px-2.5 py-1 text-xs ${preset === p.id ? 'bg-cyan-j text-white' : 'bg-secondary text-muted-foreground hover:bg-accent'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] text-muted-foreground">|ψ_L⟩ = α|0_L⟩ + β|1_L⟩</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="text-muted-foreground">α</span>
              <input value={a} onChange={(e) => { setA(e.target.value); }} onBlur={() => apply('custom', a, b)} className="mt-0.5 w-full rounded border border-input bg-transparent px-2 py-1 font-mono text-xs" />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">β</span>
              <input value={b} onChange={(e) => { setB(e.target.value); }} onBlur={() => apply('custom', a, b)} className="mt-0.5 w-full rounded border border-input bg-transparent px-2 py-1 font-mono text-xs" />
            </label>
          </div>
          {err && <div className="text-[11px] text-red-500">{err}</div>}
          {!err && <div className="text-[10px] text-muted-foreground">Normalization |α|²+|β|² checked on blur.</div>}
        </div>
      )}
    </Section>
  );
}