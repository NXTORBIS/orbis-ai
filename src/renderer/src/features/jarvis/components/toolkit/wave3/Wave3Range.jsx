import { RotateCcw } from 'lucide-react';
import { Seg } from '@jarvis/components/toolkit/shared';

const MODES = [{ value: 'native', label: 'Model curve' }, { value: 'sweep', label: 'What-if sweep' }];
const SCALES = [{ value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log' }];

export default function Wave3Range({ spec, view, series, onChange }) {
  const numeric = spec.fields.filter((field) => !field.options);
  const field = numeric.find((item) => item.key === view.variable) ?? numeric[0];
  const update = (patch) => onChange({ ...view, ...patch });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {spec.curve ? <Seg value={view.mode} onChange={(mode) => update({ mode })} options={MODES} /> : <span className="text-xs font-semibold">Interactive what-if explorer</span>}
        {view.mode === 'sweep' && (
          <div className="flex items-center gap-2">
            <Seg value={view.scale} onChange={(scale) => update({ scale })} options={SCALES} />
            <button type="button" onClick={() => update({ low: null, high: null, scale: 'linear' })} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-cyan-j">
              <RotateCcw className="h-3 w-3" />Auto range
            </button>
          </div>
        )}
      </div>

      {view.mode === 'sweep' ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">Vary</span>
            <select aria-label="Variable to sweep" value={view.variable} onChange={(event) => update({ variable: event.target.value, low: null, high: null })} className="w-full rounded-lg border border-input bg-card p-2 text-xs">
              {numeric.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">From</span>
            <input aria-label="Range minimum" type="number" step="any" min={field.min} max={field.max} value={series.low ?? ''} onChange={(event) => update({ low: event.target.value === '' ? null : Number(event.target.value) })} className="w-full rounded-lg border border-input bg-card p-2 font-mono-j text-xs" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">To</span>
            <input aria-label="Range maximum" type="number" step="any" min={field.min} max={field.max} value={series.high ?? ''} onChange={(event) => update({ high: event.target.value === '' ? null : Number(event.target.value) })} className="w-full rounded-lg border border-input bg-card p-2 font-mono-j text-xs" />
          </label>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">The x axis shows {series.xLabel} for this model; switch to a what-if sweep to vary any single input around its current value.</p>
      )}
    </div>
  );
}