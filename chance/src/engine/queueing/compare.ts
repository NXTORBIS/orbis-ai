/**
 * Theory against simulation.
 *
 * The app already simulates an M/M/1 queue (`queue` model). The exact theory
 * in this module is the natural check on it, in both directions: a simulation
 * that disagrees with the closed form is a bug in the simulation, and a closed
 * form that disagrees with a long simulation is a bug in the formula.
 *
 * One real effect has to be stated rather than hidden: the simulation starts
 * from an EMPTY system and averages a finite number of customers, so its mean
 * wait is biased BELOW the steady-state value. The bias shrinks with more
 * customers per trial and grows sharply as ρ → 1. It is reported, not
 * silently absorbed into a tolerance.
 */
import { EngineError } from '../core/result';
import { runSimulation } from '../simulation/runner';
import type { Interval } from '../stats/descriptive';
import { analyseMm1 } from './models';

export interface SimulationComparisonConfig {
  arrivalRate: number;
  serviceRate: number;
  /** Customers simulated per trial. */
  customers?: number;
  trials?: number;
  seed?: string;
}

export interface SimulationComparison {
  /** Exact M/M/1 mean wait before service. */
  exactWq: number;
  /** Simulated mean wait before service. */
  simulatedWq: number;
  /** Monte Carlo confidence interval for the simulated mean. */
  interval: Interval;
  absoluteDifference: number;
  relativeDifference: number;
  /** Whether the exact value lies inside the simulation's interval. */
  exactWithinInterval: boolean;
  trials: number;
  customers: number;
  seed: string;
  utilisation: number;
  verdict: string;
  caveats: string[];
}

/**
 * Run the app's simulated M/M/1 queue and compare it with the exact result.
 */
export function compareWithSimulation(config: SimulationComparisonConfig): SimulationComparison {
  const exact = analyseMm1({ arrivalRate: config.arrivalRate, serviceRate: config.serviceRate });
  const customers = config.customers ?? 2000;
  const trials = config.trials ?? 400;
  const seed = config.seed ?? 'queueing-cross-check';
  if (!Number.isInteger(customers) || customers < 1) {
    throw new EngineError([{ code: 'range', field: 'customers', message: 'Customers per trial must be a whole number, at least 1.' }]);
  }
  if (!Number.isInteger(trials) || trials < 1) {
    throw new EngineError([{ code: 'range', field: 'trials', message: 'Trials must be a whole number, at least 1.' }]);
  }
  const result = runSimulation({
    modelId: 'queue',
    config: { arrivalRate: config.arrivalRate, serviceRate: config.serviceRate, customers },
    trials,
    seed,
  });
  const output = result.outputs.find((o) => o.spec.key === 'meanWait');
  if (!output) {
    throw new EngineError(
      'The simulated queue model did not report a mean wait, so there is nothing to compare. The simulation model has changed shape.',
      'unsupported',
    );
  }
  const simulatedWq = output.summary.mean;
  if (!Number.isFinite(simulatedWq)) {
    throw new EngineError('The simulation produced no finite mean wait, so no comparison is reported.', 'numerical');
  }
  const exactWq = exact.metrics.Wq;
  const absoluteDifference = Math.abs(simulatedWq - exactWq);
  const relativeDifference = exactWq > 0 ? absoluteDifference / exactWq : NaN;
  const interval = output.estimateInterval;
  const exactWithinInterval = exactWq >= interval.low && exactWq <= interval.high;
  const rho = exact.metrics.utilisation;
  return {
    exactWq,
    simulatedWq,
    interval,
    absoluteDifference,
    relativeDifference,
    exactWithinInterval,
    trials,
    customers,
    seed,
    utilisation: rho,
    verdict: exactWithinInterval
      ? `The exact M/M/1 wait (${exactWq.toPrecision(6)}) lies inside the simulation's ${(interval.level * 100).toFixed(0)}% interval [${interval.low.toPrecision(
          6,
        )}, ${interval.high.toPrecision(6)}]: theory and simulation agree.`
      : `The exact M/M/1 wait (${exactWq.toPrecision(6)}) lies outside the simulation's ${(interval.level * 100).toFixed(0)}% interval [${interval.low.toPrecision(
          6,
        )}, ${interval.high.toPrecision(6)}]. At ρ = ${rho.toPrecision(
          4,
        )} with ${customers} customers per trial this is most likely the simulation's warm-up bias (it starts empty, so it under-reports), not a disagreement about the formula. Raise the customers per trial and re-check before suspecting either side.`,
    caveats: [
      `Each trial starts from an empty system and averages ${customers} customers, so the simulated mean is biased below the steady-state value. The bias falls as customers per trial rises and grows sharply as ρ → 1 (here ρ = ${rho.toPrecision(
        4,
      )}).`,
      'The interval is a Monte Carlo interval for the simulated mean. It quantifies sampling error only — it does not cover the warm-up bias, which is systematic.',
      'Successive customers’ waits within a trial are strongly correlated, so the per-trial mean is the unit of replication here, not the individual wait.',
      'The exact value is the steady-state average; the simulation estimates a finite-horizon average. They are different quantities that converge as the horizon grows.',
    ],
  };
}
