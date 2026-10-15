import { defineTool, metric } from '@jarvis/components/toolkit/science50/model';
import definitions from '@jarvis/components/toolkit/wave20/definitions';

export { numberField as F, metric as M, G, R } from '@jarvis/components/toolkit/science50/model';

// Choice fields keep a value plus the option list, so the workbench can render a picker
// and the normaliser can reject anything that is not one of the offered values.
export const C = (key, label, value, choices) => ({ key, label, value, options: choices.map(([id, text]) => ({ value: id, label: text })) });

export const D = (spec) => defineTool({ module: 'wave20', group: spec.group ?? groupFor(spec.id), ...spec });
export const O = (label, value, unit, metrics, extra = {}) => ({ primary: metric(label, value, unit), metrics, ...extra });
export const T = (label, input, expected, tolerance = 1e-7) => ({ label, input, expected, tolerance });

export const tone = (group) => (definitions.find((entry) => entry.id === group)?.tone ?? 'cyan');

function groupFor(id) {
  const entry = definitions.find((candidate) => candidate.tools.some(([toolId]) => toolId === id));
  return entry?.id ?? 'general';
}