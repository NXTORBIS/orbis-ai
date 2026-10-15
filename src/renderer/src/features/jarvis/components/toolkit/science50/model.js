export const G = 9.80665, R = 8.31446261815324, NA = 6.02214076e23, KB = 1.380649e-23;
export const numberField = (key, label, value, min = 0.001, max = 1e6, step = 'any') => ({ key, label, value, min, max, step, integer: step === 1 });
export const choiceField = (key, label, value, choices) => ({ key, label, value, options: choices.map(([id, text]) => ({ value: id, label: text })) });
export const metric = (label, value, unit = '') => ({ label, value, unit });
export const samples = (a, b, count = 81) => Array.from({ length: count }, (_, i) => a + (b - a) * i / (count - 1));
export const formatNumber = (value) => typeof value !== 'number' ? String(value ?? '—') : !Number.isFinite(value) ? '—' : value === 0 ? '0' : Math.abs(value) >= 1e6 || Math.abs(value) < 0.001 ? value.toExponential(4) : Number(value.toPrecision(6)).toLocaleString('en-US', { maximumSignificantDigits: 6 });
export function normaliseInput(spec, input) {
  const p = {};
  for (const f of spec.fields) {
    const v = input?.[f.key];
    p[f.key] = f.options ? f.options.some(o => o.value === v) ? v : f.value : typeof v === 'number' && Number.isFinite(v) ? Math.max(f.min, Math.min(f.max, f.integer ? Math.round(v) : v)) : f.value;
  }
  p._sweep = spec.fields.some(f => !f.options && f.key === input?._sweep) ? input._sweep : spec.sweep;
  return p;
}
export function defineTool(spec) {
  spec.params = normaliseInput(spec, {});
  spec.evaluate = (p) => {
    const error = spec.validate?.(p);
    if (error) return { error };
    const result = spec.calculate(p);
    if (result.error) return result;
    const values = [result.primary.value, ...(result.metrics ?? []).map(m => m.value)].filter(v => typeof v === 'number');
    if (values.some(v => !Number.isFinite(v))) return { error: 'These inputs are outside the finite range of this model. Adjust them to calculate a valid result.' };
    return result;
  };
  spec.verify = () => ({ checks: spec.references.map(ref => {
    const result = spec.evaluate(normaliseInput(spec, { ...spec.params, ...ref.input }));
    const actual = result.primary?.value, tolerance = ref.tolerance ?? 1e-7;
    return { label: ref.label, ok: typeof actual === 'number' && Math.abs(actual - ref.expected) <= tolerance * Math.max(Math.abs(ref.expected), 1e-12), detail: `${formatNumber(actual)} vs ${formatNumber(ref.expected)} ${result.primary?.unit ?? ''}` };
  }) });
  return spec;
}
export function sweepResult(spec, params) {
  const field = spec.fields.find(f => f.key === params._sweep && !f.options), value = params[field.key];
  const half = Math.abs(value) * 0.75 || (field.max - field.min) * 0.05;
  const lo = Math.max(field.min, value - half), hi = Math.min(field.max, value + half);
  const points = samples(lo, hi).map(x => { const input = field.integer ? Math.round(x) : x, result = spec.evaluate({ ...params, [field.key]: input }); return { x: input, y: result.primary?.value ?? null, error: result.error }; });
  return { points: points.filter((point, index) => !index || point.x !== points[index - 1].x), label: field.label, key: field.key };
}