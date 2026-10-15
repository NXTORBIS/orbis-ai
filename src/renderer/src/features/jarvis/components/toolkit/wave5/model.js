import { defineTool, metric } from '@jarvis/components/toolkit/science50/model';
import definitions from '@jarvis/components/toolkit/wave5/definitions';
export { numberField as F, metric as M, G, R, KB, NA } from '@jarvis/components/toolkit/science50/model';
export const RAD = Math.PI / 180, LIGHT = 299792458, GRAV = 6.67430e-11;
export const O = (label, value, unit, metrics, extra = {}) => ({ primary: metric(label, value, unit), metrics, ...extra });
export const T = (label, input, expected, tolerance = 1e-7) => ({ label, input, expected, tolerance });
const meta = new Map(definitions.flatMap(group => group.tools).map(([id,title,desc]) => [id,{title,desc}]));
export function D(spec) {
  const standard = Object.fromEntries(spec.fields.map(field => [field.key, field.value]));
  return defineTool({ tone: 'cyan', ...meta.get(spec.id), ...spec, scenarios: [{ label: 'Standard setup', input: standard }, ...spec.references.map(ref => ({ label: ref.label, input: ref.input }))] });
}