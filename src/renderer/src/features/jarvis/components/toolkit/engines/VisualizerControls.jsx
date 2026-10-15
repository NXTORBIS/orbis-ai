import { Field } from '@jarvis/components/toolkit/shared';

export default function VisualizerControls({ state, onChange, fields, disabled = false }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {fields.map(field => <Field key={field.key} label={field.label} hint={field.hint}>
      {field.options ? <select disabled={disabled} className="w-full rounded-lg border p-2 text-sm" value={state[field.key]} onChange={e => onChange({ ...state, [field.key]: e.target.value })}>
        {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select> : <input disabled={disabled} aria-label={field.label} type="number" className="w-full rounded-lg border p-2 text-sm" min={field.min} max={field.max} step={field.step || 1} value={state[field.key]} onChange={e => onChange({ ...state, [field.key]: e.target.value === '' ? '' : Number(e.target.value) })} />}
    </Field>)}
  </div>;
}