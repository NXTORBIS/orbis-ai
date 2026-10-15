import { defineTool, metric } from '@jarvis/components/toolkit/science50/model';
import definitions from '@jarvis/components/toolkit/wave15/definitions';
export { numberField as F, metric as M, G, R } from '@jarvis/components/toolkit/science50/model';
export const C = (key, label, value, choices) => ({ key, label, value, options: choices.map(([id, text]) => ({ value: id, label: text })) });
export const RAD = Math.PI / 180;
export const O = (label, value, unit, metrics, extra = {}) => ({ primary: metric(label, value, unit), metrics, ...extra });
export const T = (label, input, expected, tolerance = 1e-7) => ({ label, input, expected, tolerance });
const metadata = new Map(definitions.flatMap((group) => group.tools.map(([id, title, desc]) => [id, { title, desc, tone: group.tone }])));
export function D(spec) {
  const defaults = Object.fromEntries(spec.fields.map((field) => [field.key, field.value]));
  return defineTool({ ...metadata.get(spec.id), ...spec, scenarios: [{ label: 'Standard setup', input: defaults }, ...spec.references.map((ref) => ({ label: ref.label, input: ref.input }))] });
}