import { useEffect, useState } from 'react';
import { Field } from '@jarvis/components/toolkit/shared';

export default function CalculatorControls({ params, fields, onChange }) {
  const [drafts, setDrafts] = useState({});
  useEffect(() => {
    setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([key, raw]) => raw !== '' && Number(raw) === params[key])));
  }, [params]);
  const commit = (field, raw) => {
    const number = Number(raw);
    if (raw !== '' && Number.isFinite(number)) onChange({ ...params, [field.key]: Math.max(field.min, Math.min(field.max, field.integer ? Math.round(number) : number)) });
    setDrafts(previous => { const next = { ...previous }; delete next[field.key]; return next; });
  };
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {fields.map(field => <Field key={field.key} label={field.label} hint={field.hint}>
      {field.options ? <select aria-label={field.label} value={params[field.key]} onChange={event => onChange({ ...params, [field.key]: event.target.value })} className="w-full rounded-lg border border-input bg-card p-2 text-sm">{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input aria-label={field.label} type="number" min={field.min} max={field.max} step={field.step ?? 'any'} value={drafts[field.key] ?? params[field.key]} className="w-full rounded-lg border border-input bg-card p-2 font-mono text-sm" onChange={event => {
        const raw = event.target.value, number = Number(raw); setDrafts(previous => ({ ...previous, [field.key]: raw }));
        if (raw !== '' && Number.isFinite(number) && number >= field.min && number <= field.max && (!field.integer || Number.isInteger(number))) onChange({ ...params, [field.key]: number });
      }} onBlur={event => commit(field, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />}
    </Field>)}
  </div>;
}