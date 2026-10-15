import { samples } from '@jarvis/components/toolkit/science50/model';

/** Which input the plot sweeps, its bounds, scale and whether we draw the model's own curve. */
export function normaliseView(spec, input = {}) {
  const numeric = spec.fields.filter((field) => !field.options);
  const fallback = numeric.some((field) => field.key === spec.sweep) ? spec.sweep : numeric[0].key;
  const variable = numeric.some((field) => field.key === input?.variable) ? input.variable : fallback;
  return {
    variable,
    low: typeof input?.low === 'number' && Number.isFinite(input.low) ? input.low : null,
    high: typeof input?.high === 'number' && Number.isFinite(input.high) ? input.high : null,
    scale: input?.scale === 'log' ? 'log' : 'linear',
    mode: spec.curve ? (input?.mode === 'sweep' ? 'sweep' : 'native') : 'sweep',
  };
}

const point = (spec, params, baseline, key, x) => {
  const result = spec.evaluate({ ...params, [key]: x });
  const compare = baseline ? spec.evaluate({ ...baseline, [key]: x }) : null;
  return { x, y: result.primary?.value ?? null, comparison: compare?.primary?.value ?? null };
};

/** Everything the plot needs: points, axis labels, units and whether a point can be dragged back into the inputs. */
export function buildSeries(spec, params, view, baseline) {
  if (view.mode === 'native' && spec.curve) {
    const curve = spec.curve(params);
    const other = baseline ? spec.curve(baseline) : null;
    return {
      points: curve.x.map((x, index) => ({ x, y: curve.y[index], comparison: other?.y?.[index] ?? null })),
      xLabel: curve.xLabel,
      yLabel: curve.yLabel,
      unit: curve.unit ?? '',
      scale: curve.scale ?? 'linear',
      pickable: false,
      variable: null,
      error: null,
    };
  }

  const field = spec.fields.find((item) => item.key === view.variable) ?? spec.fields.find((item) => !item.options);
  const value = params[field.key];
  const half = Math.abs(value) * 0.75 || (field.max - field.min) * 0.05;
  const low = view.low ?? Math.max(field.min, value - half);
  const high = view.high ?? Math.min(field.max, value + half);
  const base = { variable: field.key, variableLabel: field.label, low, high };
  if (!(low >= field.min && high <= field.max && low < high)) return { ...base, points: [], error: `Choose an increasing range between ${field.min} and ${field.max}.` };
  if (view.scale === 'log' && low <= 0) return { ...base, points: [], error: 'A logarithmic sweep needs a positive lower bound.' };

  const grid = view.scale === 'log' ? samples(Math.log(low), Math.log(high), 121).map(Math.exp) : samples(low, high, 121);
  const points = grid
    .map((raw) => point(spec, params, baseline, field.key, field.integer ? Math.max(field.min, Math.min(field.max, Math.round(raw))) : raw))
    .filter((item, index, list) => !index || item.x !== list[index - 1].x);

  const sample = spec.evaluate(params);
  return {
    points,
    xLabel: field.label,
    yLabel: sample.primary?.label ?? 'Result',
    unit: sample.primary?.unit ?? '',
    scale: view.scale,
    pickable: true,
    error: null,
    ...base,
  };
}

/** A readable slice of the curve for the table view. */
export function tabulate(series, rows = 12) {
  const valid = series.points.filter((item) => item.y !== null);
  if (!valid.length) return [];
  const step = Math.max(1, Math.floor(valid.length / rows));
  return valid.filter((_, index) => index % step === 0).slice(0, rows);
}

export const toCSV = (rows) => rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');