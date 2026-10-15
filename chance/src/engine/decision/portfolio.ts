/**
 * Repeated and portfolio decisions: Kelly bet sizing, the newsvendor order
 * quantity, and real options on a binomial lattice.
 *
 * Kelly
 * -----
 * For a repeated bet with win probability p, net odds b (win b per unit staked)
 * and loss fraction a (lose a per unit staked), the fraction of wealth that
 * maximises the long-run exponential growth rate of wealth is
 *
 *     f* = (p·b − (1 − p)·a) / (a·b)
 *
 * which for the even-money case a = b = 1 collapses to f* = 2p − 1. The
 * objective maximised is E[log wealth], so Kelly is exactly the logarithmic
 * utility applied to a repeated bet.
 *
 * Kelly is *not* a recommendation. Full Kelly maximises the growth rate and in
 * exchange accepts brutal drawdowns: the probability of the bankroll at some
 * point falling to a fraction x of its starting value is x under full Kelly, so
 * a 50% drawdown is a coin flip and a 90% drawdown happens one time in ten.
 * The growth-rate curve is also asymmetric — half Kelly gives up only a
 * quarter of the growth rate for far less volatility, while double Kelly gives
 * up all of it and more — for an even-money bet at p = 0.6 the growth rate at
 * 2f* is already negative, so double Kelly loses money in the long run while
 * half Kelly still gains. Every result here reports that asymmetry.
 *
 * A bet with no edge has no Kelly fraction. Rather than return a negative
 * number (which would read as "bet against it", a different bet with different
 * odds) or 0 (which would read as a computed optimum), a non-positive edge is
 * refused with an explanation.
 */
import { EngineError, Validator } from '../core/result';
import { stableSum } from '../core/numeric';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import type { Provenance } from './types';

export interface KellyInput {
  /** Probability of winning. */
  winProbability: number;
  /** Net odds: win this multiple of the stake on a win. Even money is 1. */
  netOdds?: number;
  /** Fraction of the stake lost on a loss. Usually 1. */
  lossFraction?: number;
}

export interface KellyFractionResult {
  /** Optimal fraction of wealth to stake. */
  kellyFraction: number;
  /** Expected profit per unit staked: p·b − (1 − p)·a. */
  edge: number;
  winProbability: number;
  netOdds: number;
  lossFraction: number;
  /** Long-run growth rate of log wealth per bet at various fractions. */
  growthRates: { label: string; fraction: number; growthRate: number }[];
  growthRateAtKelly: number;
  growthRateAtHalfKelly: number;
  growthRateAtDoubleKelly: number;
  /** Probability of the bankroll ever touching this fraction of its start. */
  drawdownRisk: { fractionOfWealth: number; probabilityOfEverTouching: number }[];
  provenance: Provenance;
  warnings: string[];
  notes: string[];
}

/** Long-run growth rate of log wealth per bet at stake fraction f. */
export function kellyGrowthRate(f: number, input: KellyInput): number {
  const p = input.winProbability;
  const b = input.netOdds ?? 1;
  const a = input.lossFraction ?? 1;
  const v = new Validator();
  v.probability(p, 'winProbability', 'Win probability');
  v.positive(b, 'netOdds', 'Net odds b');
  v.positive(a, 'lossFraction', 'Loss fraction a');
  v.finite(f, 'f', 'Stake fraction');
  v.throwIfInvalid();
  if (f < 0) {
    throw new EngineError('A negative stake fraction is a different bet, not a smaller one; the growth rate is not defined for it here.', 'range');
  }
  if (1 - a * f <= 0) {
    throw new EngineError(
      `A stake fraction of ${f} loses the entire bankroll (or more) on a single loss, so the long-run growth rate is −∞. ` +
        'No finite growth rate is reported.',
      'range',
    );
  }
  const win = p === 0 ? 0 : p * Math.log(1 + b * f);
  const lose = p === 1 ? 0 : (1 - p) * Math.log(1 - a * f);
  return win + lose;
}

/** Kelly-optimal stake fraction, with the full/half/double comparison. */
export function kellyFraction(input: KellyInput): KellyFractionResult {
  const p = input.winProbability;
  const b = input.netOdds ?? 1;
  const a = input.lossFraction ?? 1;
  const v = new Validator();
  v.probability(p, 'winProbability', 'Win probability');
  v.positive(b, 'netOdds', 'Net odds b');
  v.positive(a, 'lossFraction', 'Loss fraction a');
  v.throwIfInvalid();
  const edge = p * b - (1 - p) * a;
  if (!(edge > 0)) {
    throw new EngineError(
      `This bet has no edge: the expected profit per unit staked is ${edge} (win probability ${p}, net odds ${b}, ` +
        `loss fraction ${a}). The Kelly fraction is only defined for a bet with a positive edge — the growth-maximising ` +
        'stake on a bet with no edge is to not bet, which is a conclusion, not an optimum. ' +
        `A positive edge here needs a win probability above ${a / (a + b)}.`,
      'range',
    );
  }
  const f = edge / (a * b);
  if (!(f > 0) || !Number.isFinite(f)) {
    throw new EngineError(`The Kelly fraction came out as ${f}, which is not usable.`, 'numerical');
  }
  const capped = Math.min(f, 1 / a - 1e-12);
  const growthRateAtKelly = kellyGrowthRate(Math.min(f, capped), input);
  const half = f / 2;
  const double = Math.min(2 * f, 1 / a - 1e-12);
  const growthRateAtHalfKelly = kellyGrowthRate(half, input);
  const growthRateAtDoubleKelly = kellyGrowthRate(double, input);
  const fractions = [
    { label: 'Quarter Kelly', fraction: f / 4 },
    { label: 'Half Kelly', fraction: half },
    { label: 'Full Kelly', fraction: Math.min(f, capped) },
    { label: 'Double Kelly', fraction: double },
  ];
  return {
    kellyFraction: f,
    edge,
    winProbability: p,
    netOdds: b,
    lossFraction: a,
    growthRates: fractions.map((x) => ({ ...x, growthRate: kellyGrowthRate(x.fraction, input) })),
    growthRateAtKelly,
    growthRateAtHalfKelly,
    growthRateAtDoubleKelly,
    drawdownRisk: [0.5, 0.25, 0.1].map((x) => ({ fractionOfWealth: x, probabilityOfEverTouching: x })),
    provenance: {
      exactness: 'exact',
      assumedInputs: [
        'The win probability is a user assumption. Kelly is extremely sensitive to it: an overstated edge leads directly to over-betting.',
        'The odds and loss fraction are taken as exact terms of the bet.',
      ],
      regime: 'probabilities-given',
    },
    warnings: [
      'FULL KELLY MAXIMISES THE LONG-RUN GROWTH RATE OF LOG WEALTH AND NOTHING ELSE. It accepts drawdowns most people cannot tolerate: under full Kelly the bankroll touches half its starting value with probability about 1/2, and a tenth of it with probability about 1/10, before growing.',
      'The growth-rate curve is asymmetric around the optimum. Half Kelly keeps about three quarters of the growth rate with roughly half the volatility; double Kelly keeps none of it and can be outright negative, so over-betting is far more costly than under-betting.',
      'Kelly assumes the edge is known, the bet is repeated indefinitely, stakes are infinitely divisible and there is no ruin threshold other than zero. Break any of those and the optimum moves down, never up.',
      'If the win probability is uncertain, the Kelly fraction computed from a point estimate over-bets on average. Size from the pessimistic end of the estimate.',
    ],
    notes: [
      'f* = (p·b − (1 − p)·a) / (a·b); for even money (a = b = 1) this is exactly 2p − 1.',
      'Kelly maximises E[log wealth], so it is the logarithmic utility applied to a repeated bet rather than a separate theory.',
    ],
  };
}

/* --------------------------------------------------------------- newsvendor */

export interface NewsvendorInput {
  /** Distribution id from the engine registry, e.g. "poisson", "normal". */
  demandDistributionId: string;
  demandParams: Params;
  /** Cost of being one unit short (lost margin). */
  underageCost: number;
  /** Cost of one unit left over. */
  overageCost: number;
  /** Revenue per unit sold, for reporting expected profit; optional. */
  unitRevenue?: number;
  unitCost?: number;
}

export interface NewsvendorResult {
  /** The critical fractile c_u / (c_u + c_o). */
  criticalFractile: number;
  /** Optimal order quantity F⁻¹(critical fractile). */
  optimalQuantity: number;
  distributionId: string;
  isDiscrete: boolean;
  expectedShortage: number;
  expectedLeftover: number;
  /** Expected mismatch cost at the optimum. */
  expectedCost: number;
  /** Expected cost one unit either side, for a discrete demand. */
  neighbourCosts: { quantity: number; expectedCost: number }[] | null;
  expectedProfit: number | null;
  provenance: Provenance;
  notes: string[];
}

function expectedLeftoverAndShortage(
  id: string,
  params: Params,
  q: number,
): { leftover: number; shortage: number; exact: boolean } {
  const def = getDistribution(id);
  const mean = def.mean(params);
  if (!mean.defined) {
    throw new EngineError(
      `The demand distribution "${id}" has no finite mean with these parameters (${mean.reason}), so the expected ` +
        'leftover and shortage are undefined and no order quantity is reported.',
      'undefined',
    );
  }
  if (def.kind === 'discrete') {
    // E[(q − D)+] = Σ_{d < q} (q − d)·P(D = d), summed over the support below q.
    const support = def.support(params);
    const lo = Math.max(support.min, 0);
    const hi = Math.min(Math.floor(q), Number.isFinite(support.max) ? support.max : Math.floor(q));
    const terms: number[] = [];
    for (let d = lo; d <= hi; d++) terms.push((q - d) * def.pdf(d, params));
    const leftover = stableSum(terms);
    // E[(D − q)+] = E[D] − q + E[(q − D)+]
    return { leftover, shortage: mean.value - q + leftover, exact: true };
  }
  // Continuous: E[(q − D)+] = ∫_{-∞}^{q} F(x) dx, by Simpson's rule over the
  // bounded part of the support.
  const support = def.support(params);
  const lower = Number.isFinite(support.min) ? support.min : def.quantile(1e-12, params);
  if (!(q > lower)) return { leftover: 0, shortage: mean.value - q, exact: false };
  const n = 2000;
  const h = (q - lower) / n;
  let acc = def.cdf(lower, params) + def.cdf(q, params);
  for (let i = 1; i < n; i++) acc += (i % 2 === 1 ? 4 : 2) * def.cdf(lower + i * h, params);
  const leftover = (h / 3) * acc;
  return { leftover, shortage: mean.value - q + leftover, exact: false };
}

/**
 * Newsvendor optimal order quantity: the critical fractile.
 *
 * Ordering one more unit is worthwhile while P(D ≥ q) · c_u ≥ P(D < q) · c_o,
 * which gives F(q*) = c_u / (c_u + c_o). The quantity is read off the demand
 * distribution's own quantile function, so it is exact wherever that quantile
 * is closed form, and for a discrete demand it is the smallest q with
 * F(q) ≥ the fractile — the correct generalised inverse, not a rounded
 * continuous answer.
 */
export function newsvendorOrderQuantity(input: NewsvendorInput): NewsvendorResult {
  const v = new Validator();
  v.positive(input.underageCost, 'underageCost', 'Underage cost per unit short');
  v.positive(input.overageCost, 'overageCost', 'Overage cost per unit left over');
  v.throwIfInvalid();
  const def = getDistribution(input.demandDistributionId);
  const cu = input.underageCost;
  const co = input.overageCost;
  const fractile = cu / (cu + co);
  const q = def.quantile(fractile, input.demandParams);
  if (!Number.isFinite(q)) {
    throw new EngineError(
      `The critical fractile ${fractile} maps to a non-finite order quantity for the demand distribution ` +
        `"${input.demandDistributionId}". No quantity is reported.`,
      'numerical',
    );
  }
  const costAt = (quantity: number): number => {
    const { leftover, shortage } = expectedLeftoverAndShortage(input.demandDistributionId, input.demandParams, quantity);
    return co * leftover + cu * shortage;
  };
  const { leftover, shortage, exact } = expectedLeftoverAndShortage(
    input.demandDistributionId,
    input.demandParams,
    q,
  );
  const expectedCost = co * leftover + cu * shortage;
  const discrete = def.kind === 'discrete';
  const neighbourCosts = discrete
    ? [q - 1, q + 1].filter((x) => x >= 0).map((x) => ({ quantity: x, expectedCost: costAt(x) }))
    : null;
  let expectedProfit: number | null = null;
  if (input.unitRevenue !== undefined && input.unitCost !== undefined) {
    const mean = def.mean(input.demandParams);
    if (mean.defined) {
      const expectedSales = mean.value - shortage;
      expectedProfit = input.unitRevenue * expectedSales - input.unitCost * q;
    }
  }
  return {
    criticalFractile: fractile,
    optimalQuantity: q,
    distributionId: input.demandDistributionId,
    isDiscrete: discrete,
    expectedShortage: shortage,
    expectedLeftover: leftover,
    expectedCost,
    neighbourCosts,
    expectedProfit,
    provenance: {
      exactness: discrete || (def.closedFormQuantile && exact) ? 'exact' : 'numerical',
      assumedInputs: [
        'The demand distribution and its parameters are a modelling assumption; the newsvendor answer is only as good as that distribution.',
        'The underage and overage costs are user estimates.',
      ],
      regime: 'probabilities-given',
    },
    notes: [
      `Critical fractile c_u / (c_u + c_o) = ${cu} / (${cu} + ${co}) = ${fractile}; order the ${fractile} quantile of demand.`,
      discrete
        ? 'For a discrete demand the optimum is the smallest integer q with F(q) ≥ the fractile, and the expected cost at q* is reported next to q* ± 1 so the optimality is visible.'
        : 'For a continuous demand the expected leftover is obtained by integrating the CDF numerically (Simpson, 2000 panels), so the expected cost carries a small quadrature error; the quantity itself comes from the quantile function.',
      'The critical fractile is a ratio of costs, not a service level chosen for its own sake: a 95% fill rate is only optimal if the cost ratio says so.',
      'This is the single-period model: no carryover of unsold stock, no backorders, demand independent of price.',
    ],
  };
}

/* -------------------------------------------------------------- real options */

export type RealOptionKind = 'defer' | 'expand' | 'abandon';

export interface RealOptionInput {
  kind: RealOptionKind;
  /** Present value of the underlying project today. */
  projectValue: number;
  /** Volatility of the project value, annualised. */
  volatility: number;
  /** Continuously compounded risk-free rate. */
  riskFreeRate: number;
  /** Years to the option's expiry. */
  years: number;
  /** Number of lattice steps. */
  steps?: number;
  /** Investment cost to exercise a defer option. */
  investmentCost?: number;
  /** Multiplier on project value for an expand option, e.g. 1.5 for +50%. */
  expansionFactor?: number;
  /** Cost of exercising the expansion. */
  expansionCost?: number;
  /** Salvage value received on abandonment. */
  salvageValue?: number;
  /** True for an American option (exercisable at any step), false for European. */
  american?: boolean;
}

export interface RealOptionResult {
  kind: RealOptionKind;
  optionValue: number;
  /** Value of the project without the flexibility. */
  staticValue: number;
  /** optionValue − staticValue: what the flexibility is worth. */
  flexibilityValue: number;
  lattice: { up: number; down: number; riskNeutralProbability: number; steps: number; dt: number };
  /** Earliest step at which immediate exercise is optimal somewhere, or null. */
  earliestExerciseStep: number | null
  provenance: Provenance;
  notes: string[];
}

/**
 * Real option value on a Cox–Ross–Rubinstein binomial lattice.
 *
 * u = exp(σ√Δt), d = 1/u, and the risk-neutral probability is
 * q = (exp(rΔt) − d) / (u − d). A q outside (0, 1) means the lattice does not
 * admit an arbitrage-free measure for these inputs — usually too few steps for
 * the volatility and rate given — and is refused rather than producing a
 * number from a negative probability.
 *
 * The backward induction over the lattice is iterative (two flat arrays), so
 * the step count is limited only by memory.
 */
export function realOptionValue(input: RealOptionInput): RealOptionResult {
  const steps = input.steps ?? 100;
  const v = new Validator();
  v.positive(input.projectValue, 'projectValue', 'Project value today');
  v.positive(input.volatility, 'volatility', 'Volatility σ');
  v.finite(input.riskFreeRate, 'riskFreeRate', 'Risk-free rate');
  v.positive(input.years, 'years', 'Years to expiry');
  v.integer(steps, 'steps', 'Lattice steps', 1, 5000);
  if (input.kind === 'defer') v.positive(input.investmentCost ?? NaN, 'investmentCost', 'Investment cost');
  if (input.kind === 'expand') {
    v.finite(input.expansionFactor ?? NaN, 'expansionFactor', 'Expansion factor');
    v.nonNegative(input.expansionCost ?? NaN, 'expansionCost', 'Expansion cost');
  }
  if (input.kind === 'abandon') v.positive(input.salvageValue ?? NaN, 'salvageValue', 'Salvage value');
  v.throwIfInvalid();
  if (input.kind === 'expand' && (input.expansionFactor ?? 0) <= 1) {
    throw new EngineError(
      `An expansion factor of ${input.expansionFactor} does not expand anything; it must be greater than 1.`,
      'range',
    );
  }

  const dt = input.years / steps;
  const u = Math.exp(input.volatility * Math.sqrt(dt));
  const d = 1 / u;
  const disc = Math.exp(-input.riskFreeRate * dt);
  const q = (Math.exp(input.riskFreeRate * dt) - d) / (u - d);
  if (!(q > 0 && q < 1)) {
    throw new EngineError(
      `The risk-neutral probability on this lattice is ${q}, outside (0, 1): with volatility ${input.volatility}, ` +
        `rate ${input.riskFreeRate} and ${steps} steps over ${input.years} years the lattice admits no arbitrage-free ` +
        'measure. Increase the number of steps or check the inputs; no option value is reported.',
      'range',
    );
  }
  const american = input.american ?? true;

  const payoff = (value: number): number => {
    switch (input.kind) {
      case 'defer':
        return Math.max(0, value - (input.investmentCost as number));
      case 'expand':
        return Math.max(0, (input.expansionFactor as number) * value - (input.expansionCost as number) - value);
      case 'abandon':
        return Math.max(0, (input.salvageValue as number) - value);
    }
  };

  const values = new Array<number>(steps + 1);
  for (let i = 0; i <= steps; i++) {
    values[i] = input.projectValue * Math.pow(u, steps - i) * Math.pow(d, i);
  }
  let option = values.map((x) => payoff(x));
  let earliest: number | null = null;
  for (let step = steps - 1; step >= 0; step--) {
    const next = new Array<number>(step + 1);
    for (let i = 0; i <= step; i++) {
      const hold = disc * (q * option[i] + (1 - q) * option[i + 1]);
      if (american) {
        const nodeValue = input.projectValue * Math.pow(u, step - i) * Math.pow(d, i);
        const exercise = payoff(nodeValue);
        if (exercise > hold + 1e-12) earliest = step;
        next[i] = Math.max(hold, exercise);
      } else {
        next[i] = hold;
      }
    }
    option = next;
  }

  const optionValue = option[0];
  const staticValue =
    input.kind === 'defer'
      ? Math.max(0, input.projectValue - (input.investmentCost as number))
      : input.kind === 'abandon'
        ? 0
        : Math.max(0, (input.expansionFactor as number) * input.projectValue - (input.expansionCost as number) - input.projectValue);

  return {
    kind: input.kind,
    optionValue,
    staticValue,
    flexibilityValue: optionValue - staticValue,
    lattice: { up: u, down: d, riskNeutralProbability: q, steps, dt },
    earliestExerciseStep: earliest,
    provenance: {
      exactness: 'numerical',
      assumedInputs: [
        'The volatility of the project value is an assumption, and it is the input the option value is most sensitive to.',
        'The binomial lattice assumes the project value moves like a traded asset, which a project usually does not.',
      ],
      regime: 'probabilities-given',
    },
    notes: [
      `Cox–Ross–Rubinstein lattice with ${steps} steps: u = ${u}, d = ${d}, risk-neutral probability q = ${q}.`,
      'The lattice value converges to the continuous-time value as the number of steps grows; it is a numerical approximation, not a closed form.',
      'The flexibility value is the part of the option value that the static net present value misses — the reason a project with a negative NPV today can still be worth keeping alive.',
      'Real options borrow the mathematics of traded options. The replication argument behind it does not hold for a project nobody can trade, so treat the number as an upper bound on the value of the flexibility rather than a market price.',
      american ? 'Exercisable at any step (American).' : 'Exercisable only at expiry (European).',
    ],
  };
}
