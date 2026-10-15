import { useState } from 'react';
import { Field } from '@jarvis/components/toolkit/shared';

export default function LabControls({ params, fields, onChange }) {
  const [drafts, setDrafts] = useState({});
  const commit = (field, raw) => {
    const number = Number(raw);
    if (raw !== '' && Number.isFinite(number)) onChange({ ...params, [field.key]: Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, field.integer ? Math.round(number) : number)) });
    setDrafts((current) => { const next = { ...current }; delete next[field.key]; return next; });
  };
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {fields.filter((field) => !field.when || Object.entries(field.when).every(([key, values]) => values.includes(params[key]))).map((field) => <Field key={field.key} label={field.label} hint={field.hint}>
      {field.options ? <select aria-label={field.label} value={params[field.key]} onChange={(e) => onChange({ ...params, [field.key]: e.target.value })} className="w-full rounded-lg border border-input bg-card p-2 text-sm">
        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select> : <div className="space-y-2">
        <input aria-label={field.label} type="number" min={field.min} max={field.max} step={field.step ?? 1} value={drafts[field.key] ?? params[field.key]} className="w-full rounded-lg border border-input bg-card p-2 text-sm" onChange={(e) => {
          const raw = e.target.value; setDrafts((current) => ({ ...current, [field.key]: raw }));
          const number = Number(raw);
          if (raw !== '' && Number.isFinite(number) && number >= field.min && number <= field.max && (!field.integer || Number.isInteger(number))) onChange({ ...params, [field.key]: number });
        }} onBlur={(e) => commit(field, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        {field.slider && <input aria-label={`${field.label} slider`} type="range" min={field.min} max={field.max} step={field.step ?? 1} value={params[field.key]} className="w-full accent-cyan-j" onChange={(e) => commit(field, e.target.value)} />}
      </div>}
    </Field>)}
  </div>;
}