/**
 * Networks: random graphs, percolation and spreading processes.
 *
 * Every other risk module in this engine treats exposures as a list. This one
 * treats them as a network, because that is usually what they are, and because
 * the behaviour of a network is qualitatively different: connectivity has a
 * phase transition, so an intuition calibrated on independent exposures is not
 * merely imprecise near the threshold, it is wrong about the kind of thing that
 * happens.
 *
 * What is here:
 *
 *  - `graph`        — construction and validation (every refusal names the offending edge).
 *  - `measures`     — degrees, assortativity, clustering, components and the giant fraction,
 *                     path lengths and per-component diameters, k-cores. All iterative.
 *  - `centrality`   — degree, betweenness (Brandes), closeness, eigenvector, Katz, PageRank.
 *  - `spectral`     — a Jacobi symmetric eigensolver, adjacency and Laplacian spectra,
 *                     algebraic connectivity, spectral partitioning.
 *  - `models`       — Erdős–Rényi, configuration model (with Erdős–Gallai and Molloy–Reed),
 *                     Barabási–Albert, Watts–Strogatz, stochastic block model, geometric,
 *                     Chung–Lu, square lattice — each with its analytic properties attached.
 *  - `powerlaw`     — Clauset MLE with standard error and KS goodness of fit, plus the
 *                     biased log-log slope kept for comparison.
 *  - `percolation`  — site and bond percolation, the numerically located threshold, critical
 *                     exponents, random versus targeted removal, cascading failure,
 *                     bootstrap percolation, explosive percolation.
 *  - `spreading`    — SIR / SIS / SEIR by exact-rate Gillespie simulation, the mass-action
 *                     ODE for comparison, both reproduction numbers, branching-process
 *                     outbreak probability, and ensembles that keep extinctions and
 *                     takeoffs apart.
 *  - `influence`    — independent cascade, linear threshold, greedy influence maximisation
 *                     with its (1 - 1/e) guarantee, and brute force for checking it.
 *  - `interventions`— random, targeted and acquaintance (friendship-paradox) immunisation.
 *
 * Three rules hold everywhere. Graph measures are `exact` on the graph given;
 * spectra, thresholds and ODEs are `numerical`; simulated spreading is
 * `empirical`. Long runs are generators that yield between chunks, matching
 * `src/engine/simulation/runner.ts`, so a worker can cancel them and return
 * partial results marked partial. And nothing returns a plausible number on
 * failure: every refusal says what is missing or impossible.
 */
export * from './types';
export * from './graph';
export * from './measures';
export * from './spectral';
export * from './centrality';
export * from './models';
export * from './powerlaw';
export * from './percolation';
export * from './spreading';
export * from './influence';
export * from './interventions';
