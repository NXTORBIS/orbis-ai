/**
 * Optimisation under uncertainty: deciding now what to do when the data arrives
 * later.
 *
 * Every other optimiser in this engine optimises a fixed objective. The real
 * problem is almost always sequential: commit to something now, observe the
 * uncertainty, then adapt. Optimising against the EXPECTED VALUE of the
 * uncertainty is not the same as optimising against the uncertainty, and the
 * gap between them — the value of the stochastic solution — is usually large
 * and almost always ignored. Quantifying that gap is this module's central
 * contribution, which is why `stochasticDiagnostics` computes both VSS and EVPI
 * on every problem rather than on request.
 *
 * Three regimes, which answer different questions and should not be mixed:
 *
 *  - STOCHASTIC: a distribution over scenarios is available. Minimise expected
 *    cost including the cost of optimal recourse. `twostage`, `multistage`.
 *  - CHANCE-CONSTRAINED: a constraint must hold with a stated probability.
 *    `chance`. The tail of the assumed distribution does most of the work here,
 *    and `tailSensitivity` says how much.
 *  - ROBUST: no distribution, only a set of possible parameter values. `robust`.
 *    Conservative by construction, which is why the price-of-robustness curve
 *    and the cross-evaluation table matter more than the robust optimum itself.
 *
 * Where only moments are known, the answer is a bound and not a value
 * (`worstCaseExpectedExcess`), which is the same rule the rest of the engine
 * follows when a relationship is unknown.
 *
 * Status honesty is enforced throughout. An LP solved to optimality is `exact`
 * with the simplex's pivot tolerance stated; a decomposition that stops with an
 * open gap is `feasible-with-gap` and names the gap; sample-based and heuristic
 * answers are `empirical` and carry their statistical gap or their explicit
 * absence of a guarantee. Returning a feasible point as though it were optimal
 * is the characteristic dishonesty of this field, and no function here can do
 * it.
 */
export * from './types';
export * from './linear';
export * from './twostage';
export * from './multistage';
export * from './chance';
export * from './robust';
export * from './saa';
export * from './stochapprox';
export * from './heuristics';
export * from './library';
