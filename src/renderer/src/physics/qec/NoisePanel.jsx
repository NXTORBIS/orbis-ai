import React from 'react';
import { Waves } from 'lucide-react';
import { NOISE_MODELS } from '../lib/qec/noise.js';
import Section from './Section';

export default function NoisePanel({ model, onChange, fault, onFaultChange }) {
  const set = (patch) => onChange({ ...model, ...patch });
  const setFault = (patch) => onFaultChange({ ...fault, ...patch });

  return (
    <Section title="Noise & Fault Model" icon={Waves}>
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Error model</div>
          <select
            value={model.type}
            onChange={(e) => set({ type: e.target.value })}
            className="w-full rounded border border-input bg-transparent px-2 py-1 text-xs"
          >
            {NOISE_MODELS.map((m) => <option key={m.id} value={m.id} className="bg-card">{m.label}</option>)}
          </select>
          <div className="mt-1 font-mono text-[10px] text-cyan-j">{NOISE_MODELS.find((m) => m.id === model.type)?.desc}</div>
        </div>

        {model.type === 'custom' ? (
          <div className="grid grid-cols-3 gap-2">
            {['pX', 'pY', 'pZ'].map((k) => (
              <label key={k} className="text-[11px]">
                <span className="text-muted-foreground">{k.replace('p', 'p_')}</span>
                <input
                  type="number" step="0.001" min="0" max="1"
                  value={model[k]}
                  onChange={(e) => set({ [k]: Math.max(0, Math.min(1, +e.target.value || 0)) })}
                  className="mt-0.5 w-full rounded border border-input bg-transparent px-2 py-1 font-mono text-xs"
                />
              </label>
            ))}
          </div>
        ) : (
          <label className="block text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Physical error rate p</span>
              <span className="font-mono text-cyan-j">{model.p.toExponential(2)}</span>
            </div>
            <input
              type="range" min={0} max={0.5} step={0.001}
              value={model.p}
              onChange={(e) => set({ p: +e.target.value })}
              className="mt-1 w-full accent-cyan-j"
            />
            <input
              type="number" step="0.0001" min="0" max="1"
              value={model.p}
              onChange={(e) => set({ p: Math.max(0, Math.min(1, +e.target.value || 0)) })}
              className="mt-1 w-full rounded border border-input bg-transparent px-2 py-1 font-mono text-xs"
            />
          </label>
        )}

        <div className="rounded-lg border border-border p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Fault model</div>
          <div className="flex gap-1">
            <button onClick={() => setFault({ faulty: false })} className={`flex-1 rounded px-2 py-1 text-[11px] ${!fault.faulty ? 'bg-cyan-j text-white' : 'bg-secondary text-muted-foreground'}`}>Ideal QEC</button>
            <button onClick={() => setFault({ faulty: true })} className={`flex-1 rounded px-2 py-1 text-[11px] ${fault.faulty ? 'bg-cyan-j text-white' : 'bg-secondary text-muted-foreground'}`}>Fault-tolerant</button>
          </div>
          {fault.faulty && (
            <label className="mt-2 block text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Measurement error p_meas</span>
                <span className="font-mono text-cyan-j">{fault.pMeas.toExponential(2)}</span>
              </div>
              <input type="range" min="0" max="0.5" step="0.001" value={fault.pMeas} onChange={(e) => setFault({ pMeas: +e.target.value })} className="mt-1 w-full accent-cyan-j" />
              <label className="mt-1 flex items-center gap-2 text-[11px]">
                <input type="checkbox" checked={fault.uniform} onChange={(e) => setFault({ uniform: e.target.checked, pMeas: e.target.checked ? model.p : fault.pMeas })} />
                <span className="text-muted-foreground">Uniform: p_meas = p</span>
              </label>
            </label>
          )}
        </div>
      </div>
    </Section>
  );
}