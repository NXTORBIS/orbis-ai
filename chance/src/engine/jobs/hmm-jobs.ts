/** Engine jobs for hidden Markov models. */
import { EngineError } from '../core/result';
import { baumWelchSteps, type BaumWelchOptions, type BaumWelchResult } from '../hmm/learn';
import type { EmissionModel } from '../hmm/types';
import { requireObject, type EngineJobDef } from './types';

export interface BaumWelchJobPayload {
  sequences: number[][];
  states: number;
  template: EmissionModel;
  options?: BaumWelchOptions;
}

/**
 * Baum–Welch (EM) with random restarts. Every iteration is a full
 * forward–backward pass, so a fit with several restarts takes seconds; the
 * generator yields after each iteration.
 */
export const baumWelchJob: EngineJobDef<BaumWelchJobPayload, BaumWelchResult> = {
  id: 'hmm.baum-welch',
  label: 'Baum–Welch fit',
  parse(payload) {
    const o = requireObject(payload, 'Baum–Welch fit');
    if (!Array.isArray(o.sequences) || o.sequences.length === 0 || o.sequences.some((s) => !Array.isArray(s))) {
      throw new EngineError('The Baum–Welch job needs at least one observation sequence, as an array of arrays of symbol indices.', 'payload');
    }
    if (typeof o.states !== 'number' || !Number.isInteger(o.states) || o.states < 1) {
      throw new EngineError('The Baum–Welch job needs the number of hidden states as a whole number of 1 or more.', 'payload');
    }
    if (o.template === null || typeof o.template !== 'object') {
      throw new EngineError('The Baum–Welch job needs an emission template, which fixes the emission family and alphabet.', 'payload');
    }
    return {
      sequences: o.sequences as number[][],
      states: o.states,
      template: o.template as EmissionModel,
      options: (o.options as BaumWelchOptions | undefined) ?? {},
    };
  },
  run(payload) {
    return baumWelchSteps(payload.sequences, payload.states, payload.template, payload.options ?? {});
  },
};
