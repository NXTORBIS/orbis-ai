/**
 * Single point of contact with sibling engine modules.
 *
 * Everything this module borrows from `src/engine/regression/` and
 * `src/engine/bayesnet/` is funnelled through here, so that if either module
 * is absent or its surface moves, exactly one file needs attention instead of
 * a dozen. Nothing here reaches into `src/ui`, `src/app` or `src/ai`.
 */

export { fitGlm, type GlmFit } from '../regression/glm.ts';
export { tCritical, tTwoSided, chiSquareSf } from '../regression/dist.ts';
export type { Column } from '../regression/types.ts';
export type { DiGraph } from '../bayesnet/graph.ts';
