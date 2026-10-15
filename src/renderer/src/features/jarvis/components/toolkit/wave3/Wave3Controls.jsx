import { Minus, Plus } from 'lucide-react';
import { formatNumber } from '@jarvis/components/toolkit/science50/model';

const stepOf = (field, coarse) => (field.integer ? 1 : (field.max - field.min) / (coarse ? 10 : 200));

export default function Wave3Controls({ fields, params, onChange }) {
  const set = (field, raw) => {
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value)) return;
    onChange({ ...params, [field.key]: Math.max(field.min, Math.min(field.max, field.integer ? Math.round(value) : value)) });
  };
  const nudge = (field, direction) => {
    const step = stepOf(field, true);
    const next = params[field.key] + direction * step;
    set(field, Math.max(field.min, Math.min(field.max, field.integer ? Math.round(next) : Number(next.toFixed(6)))));
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map((field) => (
        <div key={field.key} className="tk-card tk-glass-panel rounded-xl p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">{field.label}</span>
            <span className="font-mono-j text-sm font-semibold text-cyan-j">{field.options ? field.options.find((option) => option.value === params[field.key])?.label : formatNumber(params[field.key])}</span>
          </div>
          {field.options ? (
            <select aria-label={field.label} value={params[field.key]} onChange={(event) => set(field, event.target.value)} className="mt-2 w-full rounded-lg border border-input bg-card p-2 text-sm">
              {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <button type="button" aria-label={`Decrease ${field.label}`} onClick={() => nudge(field, -1)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:text-cyan-j"><Minus className="h-3.5 w-3.5" /></button>
                <input aria-label={field.label} type="number" min={field.min} max={field.max} step={field.step ?? 'any'} value={params[field.key]} onChange={(event) => set(field, event.target.value)} className="min-w-0 flex-1 rounded-md border border-input bg-card/60 px-2 py-1 text-center font-mono-j text-xs" />
                <button type="button" aria-label={`Increase ${field.label}`} onClick={() => nudge(field, 1)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:text-cyan-j"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <input aria-label={`${field.label} slider`} type="range" className="w-full accent-cyan-j" min={field.min} max={field.max} step={field.step === 'any' || field.step === undefined ? stepOf(field, false) : field.step} value={params[field.key]} onChange={(event) => set(field, event.target.value)} />
              <div className="flex justify-between font-mono-j text-[9px] text-muted-foreground/70"><span>{formatNumber(field.min)}</span><span>{formatNumber(field.max)}</span></div>
            </div>
          )}
          {field.hint && <span className="mt-1 block text-[10px] text-muted-foreground/70">{field.hint}</span>}
        </div>
      ))}
    </div>
  );
}