/**
 * Transform and asymptotic methods.
 *
 * The distribution of a sum can be obtained by simulating it, but simulation
 * is wasteful when an exact answer exists and useless in the far tail, where it
 * has no samples. This module provides the classical alternative: generating
 * functions, exact and FFT convolution, characteristic-function inversion,
 * saddlepoint and Edgeworth approximations, Panjer recursion for compound
 * distributions, and the alpha-stable family.
 *
 * Every result reports the numerical route it took (direct, FFT, saddlepoint,
 * COS, Panjer) and the truncation or term count that route used, because the
 * accuracy of a transform-based answer is a property of those choices and not
 * of the mathematics. Every approximation carries its error bound or its
 * validity domain and refuses to answer outside it.
 */
export * from './complex';
export * from './generating';
export * from './convolution';
export * from './inversion';
export * from './saddlepoint';
export * from './expansions';
export * from './compound';
