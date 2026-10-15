/**
 * Decision analysis under uncertainty.
 *
 * The rest of the engine answers "how likely is this?". This module answers
 * "what should I do about it?", and is careful about the difference between the
 * three regimes that question can be asked in:
 *
 *  1. Probabilities are known (or can honestly be stated) → expected value,
 *     expected utility, decision trees, value of information.
 *  2. Probabilities are not known → the maximin / maximax / Hurwicz / minimax
 *     regret / Laplace family, each labelled with the attitude it encodes, and
 *     with the plain statement that they disagree and that choosing between
 *     them is a value judgement rather than a calculation.
 *  3. Several incommensurable objectives → the Pareto frontier, which needs no
 *     weights, and a weighted value model, which does and says so.
 *
 * Every result carries its provenance: the arithmetic is exact on a discrete
 * tree or matrix, numerical where a root find or a lattice is involved, and the
 * probabilities and payoffs it rests on are user assumptions, which the result
 * names rather than quietly absorbing.
 */
export * from './types';
export * from './utility';
export * from './tree';
export * from './information';
export * from './criteria';
export * from './multicriteria';
export * from './sensitivity';
export * from './portfolio';
export * from './examples';
