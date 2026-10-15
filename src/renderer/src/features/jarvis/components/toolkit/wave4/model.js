import { defineTool, metric } from '@jarvis/components/toolkit/science50/model';
export { numberField as F, metric as M, G } from '@jarvis/components/toolkit/science50/model';
export const LIGHT = 299792458, RAD = Math.PI / 180;
export const O = (label, value, unit, metrics, extra = {}) => ({ primary: metric(label, value, unit), metrics, ...extra });
export function D(spec) {
  return defineTool({ tone: 'cyan', ...spec, scenarios: [{ label: 'Standard setup', input: {} }, ...spec.references.map(ref => ({ label: ref.label, input: ref.input }))] });
}