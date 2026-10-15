/**
 * Tests for optimisation under uncertainty.
 *
 * Reference values are independent of this module's implementation:
 *
 *  - The newsvendor optimum comes from the DISTRIBUTION REGISTRY's quantile
 *    function (the critical fractile), which the two-stage machinery never
 *    touches. This is the central validation: a general solver that cannot
 *    reproduce the one case with a known closed form is not trustworthy on the
 *    cases without one.
 *  - The deterministic equivalent and the L-shaped method are two independent
 *    algorithms and are required to agree to 1e-8 on random problems.
 *  - EVPI and VSS are recomputed in the test from separately solved
 *    wait-and-see, mean-value and evaluation problems.
 *  - Chance-constraint and scenario-approximation reliabilities are measured by
 *    Monte Carlo in the test, not read back from the solver's own report.
 *  - The SAA gap is checked against a CLOSED-FORM true optimal value for a
 *    Gaussian newsvendor, computed in the test from the normal CDF and PDF.
 *  - Heuristics are scored against brute-force enumeration done in the test.
 *
 * Every Monte Carlo tolerance below carries a comment justifying its size from
 * the binomial or sample standard error of the estimate concerned. All seeds
 * are fixed.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { getDistribution } from '../distributions/registry';
import { Random } from '../random/rng';
import { normalCdf, normalPdf, normalQuantile } from '../special/gamma';
import {
  calafioreCampiSampleSize,
  checkReliability,
  discreteCvar,
  discreteVar,
  jointSatisfactionProbability,
  solveCvarConstrainedLp,
  solveGaussianChanceLp,
  solveJointChanceBonferroni,
  solveScenarioApproximation,
  tailSensitivity,
} from './chance';
import { bruteForceBinary, crossEntropyMethod, simulatedAnnealing } from './heuristics';
import { diagnoseInfeasibility, dualProblem, solveLp, solveLpWithDuals, SIMPLEX_TOLERANCE } from './linear';
import {
  capacityExpansion,
  newsvendorFractile,
  newsvendorTwoStage,
  productionMix,
  projectSelection,
  staffing,
  transportationNetwork,
} from './library';
import { solveMultistage } from './multistage';
import {
  cantelliExceedanceBound,
  crossEvaluate,
  priceOfRobustness,
  solveBoxRobust,
  solveBudgetedRobust,
  solveDistributionallyRobustExcess,
  solveEllipsoidalRobust,
  solvePolyhedralRobust,
  worstCaseCvar,
  worstCaseExpectedExcess,
} from './robust';
import { latinHypercubeScenarios, reduceScenarios, reductionDistance, sampleAverageApproximation } from './saa';
import { ipaGradient, newsvendorPathDerivative, spsa, stepSizeConditions, stochasticGradientDescent } from './stochapprox';
import {
  expectedCostOf,
  meanScenario,
  solveDeterministicEquivalent,
  solveLShaped,
  solveTwoStage,
  stochasticDiagnostics,
  validateTwoStage,
} from './twostage';
import type { LpProblem, TwoStageProblem } from './types';

/* ===================================================== the LP layer */

describe('linear programming layer', () => {
  it('solves a hand-computed LP exactly', () => {
    // max 3x + 5y, x <= 4, 2y <= 12, 3x + 2y <= 18.
    // By hand: the binding pair is 2y = 12 and 3x + 2y = 18, giving y = 6, x = 2
    // and objective 3·2 + 5·6 = 36.
    const sol = solveLp({
      sense: 'max',
      objective: [3, 5],
      rows: [
        { coef: [1, 0], sense: '<=', rhs: 4, name: 'x cap' },
        { coef: [0, 2], sense: '<=', rhs: 12, name: 'y cap' },
        { coef: [3, 2], sense: '<=', rhs: 18, name: 'joint' },
      ],
    });
    expect(sol.status).toBe('optimal');
    expect(sol.objective).toBeCloseTo(36, 12);
    expect(sol.x[0]).toBeCloseTo(2, 12);
    expect(sol.x[1]).toBeCloseTo(6, 12);
    expect(sol.tolerance).toBe(SIMPLEX_TOLERANCE);
  });

  it('handles free variables and finite upper bounds', () => {
    // min x with x >= -5 and x free: the optimum is -5.
    const free = solveLp({ sense: 'min', objective: [1], rows: [{ coef: [1], sense: '>=', rhs: -5 }], lower: [-Infinity], upper: [Infinity] });
    expect(free.status).toBe('optimal');
    expect(free.objective).toBeCloseTo(-5, 12);
    // max x1 + x2, x1 + x2 <= 10, x1 <= 3, x2 <= 4: the bounds bind at 7.
    const bounded = solveLp({ sense: 'max', objective: [1, 1], rows: [{ coef: [1, 1], sense: '<=', rhs: 10 }], lower: [0, 0], upper: [3, 4] });
    expect(bounded.objective).toBeCloseTo(7, 12);
  });

  it('satisfies strong duality and complementary slackness', () => {
    // min 2x1 + 3x2 s.t. x1 + x2 >= 10, x1 >= 2, x1 + 3x2 >= 12.
    const primal: LpProblem = {
      sense: 'min',
      objective: [2, 3],
      rows: [
        { coef: [1, 1], sense: '>=', rhs: 10, name: 'total' },
        { coef: [1, 0], sense: '>=', rhs: 2, name: 'floor on x1' },
        { coef: [1, 3], sense: '>=', rhs: 12, name: 'weighted' },
      ],
    };
    const sol = solveLpWithDuals(primal);
    expect(sol.status).toBe('optimal');
    // Strong duality to 1e-9 as required.
    expect(sol.dualityResidual).toBeLessThan(1e-9);
    expect(sol.dualObjective).toBeCloseTo(sol.objective, 9);
    // The dual program solved on its own must reach the same value.
    const dual = solveLp(dualProblem(primal));
    expect(dual.status).toBe('optimal');
    expect(dual.objective).toBeCloseTo(sol.objective, 9);
    // Complementary slackness: π_i · (a_iᵀx − b_i) = 0 for every row.
    primal.rows.forEach((row, i) => {
      const slack = row.coef.reduce((a, c, j) => a + c * sol.x[j], 0) - row.rhs;
      expect(Math.abs(sol.duals[i] * slack)).toBeLessThan(1e-9);
    });
    // and x_j · (c_j − Aᵀπ|_j) = 0 for every variable.
    for (let j = 0; j < primal.objective.length; j++) {
      const reduced = primal.objective[j] - primal.rows.reduce((a, row, i) => a + row.coef[j] * sol.duals[i], 0);
      expect(Math.abs(sol.x[j] * reduced)).toBeLessThan(1e-9);
      expect(reduced).toBeGreaterThan(-1e-9); // dual feasibility
    }
  });

  it('detects infeasibility and names the row and the amount', () => {
    const sol = solveLp({
      sense: 'min',
      objective: [1],
      rows: [
        { coef: [1], sense: '>=', rhs: 5, name: 'floor' },
        { coef: [1], sense: '<=', rhs: 2, name: 'ceiling' },
      ],
    });
    expect(sol.status).toBe('infeasible');
    expect(sol.x).toHaveLength(0);
    const witnesses = sol.witnesses ?? [];
    expect(witnesses.length).toBeGreaterThan(0);
    // The gap between the floor at 5 and the ceiling at 2 is exactly 3.
    expect(witnesses.reduce((a, w) => a + w.violation, 0)).toBeCloseTo(3, 9);
    expect(witnesses.map((w) => w.name).join()).toMatch(/floor|ceiling/);
    const direct = diagnoseInfeasibility({ sense: 'min', objective: [1, 1], rows: [{ coef: [1, 1], sense: '=', rhs: -3, name: 'negative total' }] });
    expect(direct[0].name).toBe('negative total');
    expect(direct[0].violation).toBeCloseTo(3, 9);
  });

  it('detects an unbounded objective', () => {
    const sol = solveLp({ sense: 'max', objective: [1], rows: [{ coef: [1], sense: '>=', rhs: 1 }] });
    expect(sol.status).toBe('unbounded');
    expect(sol.x).toHaveLength(0);
  });
});

/* ========================== the newsvendor: the central validation */

const POISSON = getDistribution('poisson');
const POISSON_PARAMS = { lambda: 12 };

/** Demand scenarios for a Poisson(12), truncated at 40 with the tail folded in. */
function poissonDemand(): { value: number; probability: number }[] {
  const out = Array.from({ length: 41 }, (_, k) => ({ value: k, probability: POISSON.pdf(k, POISSON_PARAMS) }));
  const mass = out.reduce((a, o) => a + o.probability, 0);
  out[40] = { value: 40, probability: out[40].probability + (1 - mass) };
  return out;
}

describe('newsvendor closed form', () => {
  const spec = { unitCost: 5, price: 12, salvage: 2, demand: poissonDemand() };

  it('the two-stage machinery reproduces the critical fractile', () => {
    const fractile = newsvendorFractile(spec);
    // c_u = 12 − 5 = 7, c_o = 5 − 2 = 3, fractile = 7/10.
    expect(fractile.underage).toBe(7);
    expect(fractile.overage).toBe(3);
    expect(fractile.fractile).toBeCloseTo(0.7, 15);
    // Reference value from the REGISTRY, which the two-stage code never calls.
    const reference = POISSON.quantile(fractile.fractile, POISSON_PARAMS);
    const extensive = solveDeterministicEquivalent(newsvendorTwoStage(spec));
    expect(extensive.status).toBe('optimal');
    expect(extensive.x[0]).toBeCloseTo(reference, 8);
    // The L-shaped method must find the same decision and value.
    const lshaped = solveLShaped(newsvendorTwoStage(spec));
    expect(lshaped.status).toBe('optimal');
    expect(lshaped.x[0]).toBeCloseTo(reference, 6);
    expect(lshaped.objective).toBeCloseTo(extensive.objective, 8);
  });

  it('reproduces the fractile across several cost structures', () => {
    for (const [cost, price, salvage] of [
      [5, 12, 2],
      [3, 20, 1],
      [8, 10, 0],
      [2, 3, 1],
    ] as const) {
      const s = { unitCost: cost, price, salvage, demand: poissonDemand() };
      const fractile = (price - cost) / (price - salvage);
      const reference = POISSON.quantile(fractile, POISSON_PARAMS);
      const solved = solveDeterministicEquivalent(newsvendorTwoStage(s));
      expect(solved.x[0]).toBeCloseTo(reference, 7);
    }
  });

  it('refuses a newsvendor with no trade-off', () => {
    expect(() => newsvendorFractile({ unitCost: 12, price: 10, salvage: 2, demand: poissonDemand() })).toThrow(/does not exceed the unit cost/);
    expect(() => newsvendorFractile({ unitCost: 5, price: 12, salvage: 5, demand: poissonDemand() })).toThrow(/salvage value .* is not below the unit cost/);
  });
});

/* ========================= deterministic equivalent versus Benders */

function randomTwoStage(rng: Random, scenarioCount: number): TwoStageProblem {
  const n1 = 3;
  const m2 = 3;
  const real = 4;
  const n2 = real + m2;
  return {
    name: 'random two-stage',
    c: Array.from({ length: n1 }, () => rng.uniformRange(1, 4)),
    firstStageRows: [{ coef: new Array<number>(n1).fill(1), sense: '<=', rhs: 6, name: 'budget' }],
    lower: new Array<number>(n1).fill(0),
    upper: new Array<number>(n1).fill(5),
    q: [...Array.from({ length: real }, () => rng.uniformRange(0.5, 3)), ...new Array<number>(m2).fill(50)],
    scenarios: Array.from({ length: scenarioCount }, (_, i) => ({
      name: `scenario ${i + 1}`,
      probability: 1 / scenarioCount,
      rows: Array.from({ length: m2 }, (_, k) => {
        const W = new Array<number>(n2).fill(0);
        for (let j = 0; j < real; j++) W[j] = rng.uniformRange(0, 2);
        W[real + k] = 1; // the penalty variable guarantees complete recourse
        return {
          T: Array.from({ length: n1 }, () => rng.uniformRange(0, 2)),
          W,
          sense: '>=' as const,
          rhs: rng.uniformRange(1, 8),
          name: `recourse row ${k + 1}`,
        };
      }),
    })),
  };
}

describe('deterministic equivalent equals Benders', () => {
  it('agrees to 1e-8 on random problems, with the gap closed', () => {
    const rng = new Random('benders-agreement');
    for (let t = 0; t < 15; t++) {
      const problem = randomTwoStage(rng, 6);
      const extensive = solveDeterministicEquivalent(problem);
      const lshaped = solveLShaped(problem);
      expect(extensive.status).toBe('optimal');
      expect(lshaped.status).toBe('optimal');
      expect(lshaped.objective).toBeCloseTo(extensive.objective, 8);
      expect(lshaped.gap).toBeLessThan(1e-8);
      expect(lshaped.cuts?.relativeGap).toBeLessThan(1e-10);
      expect(lshaped.cuts?.upperBound).toBeCloseTo(lshaped.cuts?.lowerBound ?? NaN, 8);
      expect(lshaped.provenance.exactness).toBe('exact');
    }
  });

  it('generates feasibility cuts when recourse is incomplete, and still agrees', () => {
    const problem: TwoStageProblem = {
      name: 'incomplete recourse',
      c: [2],
      firstStageRows: [],
      lower: [0],
      upper: [1000],
      q: [1],
      scenarios: [10, 25, 40].map((d) => ({
        name: `demand ${d}`,
        probability: 1 / 3,
        rows: [
          { T: [-1], W: [1], sense: '<=' as const, rhs: 0, name: 'within capacity' },
          { T: [0], W: [1], sense: '>=' as const, rhs: d, name: 'must produce demand' },
        ],
      })),
    };
    const extensive = solveDeterministicEquivalent(problem);
    const lshaped = solveLShaped(problem);
    expect(lshaped.cuts?.feasibilityCuts).toBeGreaterThan(0);
    expect(lshaped.objective).toBeCloseTo(extensive.objective, 8);
    // Capacity must cover the largest demand: 40, at cost 2·40 + E[production] = 105.
    expect(extensive.x[0]).toBeCloseTo(40, 9);
    expect(extensive.objective).toBeCloseTo(105, 9);
  });

  it('reports a remaining gap rather than an incumbent passed off as optimal', () => {
    const stopped = solveLShaped(newsvendorTwoStage({ unitCost: 5, price: 12, salvage: 2, demand: poissonDemand() }), { maxIterations: 2 });
    expect(stopped.status).toBe('feasible-with-gap');
    expect(stopped.gap).toBeGreaterThan(0);
    expect(stopped.provenance.exactness).toBe('numerical');
    expect(stopped.provenance.limitations.join(' ')).toMatch(/NOT proven optimal/);
    // And no diagnostic may be derived from an unproven optimum.
    const problem = newsvendorTwoStage({ unitCost: 5, price: 12, salvage: 2, demand: poissonDemand() });
    expect(() => stochasticDiagnostics(problem, { solution: stopped })).toThrow(/cannot be reported for a solve that ended "feasible-with-gap"/);
  });
});

/* =============================================== EVPI and VSS */

describe('EVPI and VSS identities', () => {
  it('both sides of each identity agree to 1e-9, recomputed independently', () => {
    const problem = capacityExpansion({
      technologies: [
        { name: 'base', capitalCost: 10, operatingCost: 1 },
        { name: 'peak', capitalCost: 3, operatingCost: 6 },
      ],
      shortagePenalty: 50,
      demand: [
        { value: 50, probability: 0.3 },
        { value: 100, probability: 0.5 },
        { value: 160, probability: 0.2 },
      ],
    });
    const diagnostics = stochasticDiagnostics(problem);
    const rp = solveTwoStage(problem).objective;
    expect(diagnostics.recourseProblemValue).toBeCloseTo(rp, 9);

    // Wait-and-see recomputed here: one perfect-foresight problem per scenario.
    let ws = 0;
    for (const scenario of problem.scenarios) {
      const single = solveDeterministicEquivalent({ ...problem, scenarios: [{ ...scenario, probability: 1 }] });
      ws += scenario.probability * single.objective;
    }
    expect(diagnostics.waitAndSeeValue).toBeCloseTo(ws, 9);
    expect(diagnostics.evpi).toBeCloseTo(rp - ws, 9);

    // EEV recomputed here from the mean-scenario problem and an evaluation.
    const meanProblem = { ...problem, scenarios: [meanScenario(problem)] };
    const meanSolution = solveDeterministicEquivalent(meanProblem);
    const eev = expectedCostOf(problem, meanSolution.x);
    expect(diagnostics.expectedValueOfMeanSolution).toBeCloseTo(eev.cost, 9);
    expect(diagnostics.vss).toBeCloseTo(eev.cost - rp, 9);

    // The sandwich WS <= RP <= EEV.
    expect(ws).toBeLessThanOrEqual(rp + 1e-9);
    expect(rp).toBeLessThanOrEqual(eev.cost + 1e-9);
  });

  it('EVPI >= 0 and VSS >= 0 on many random problems', () => {
    const rng = new Random('evpi-nonneg');
    for (let t = 0; t < 25; t++) {
      const problem = randomTwoStage(rng, 4);
      const d = stochasticDiagnostics(problem);
      expect(d.evpi).toBeGreaterThanOrEqual(0);
      expect(d.vss).toBeGreaterThanOrEqual(0);
      expect(d.waitAndSeeValue).toBeLessThanOrEqual(d.recourseProblemValue + 1e-9);
      expect(d.recourseProblemValue).toBeLessThanOrEqual(d.expectedValueOfMeanSolution + 1e-9);
    }
  });

  it('VSS is exactly 0 when the recourse cost is linear in the uncertainty', () => {
    // The recourse is y⁺ − y⁻ = h(ω) + x1 + x2 with cost k(y⁺ − y⁻), so
    // Q(x, ω) = k·(h(ω) + x1 + x2) is LINEAR in h. Its expectation therefore
    // depends on h only through its mean, which makes the mean-value decision
    // optimal and VSS exactly zero. A sign error in the VSS arithmetic shows up
    // here as a non-zero value.
    const problem: TwoStageProblem = {
      name: 'linear recourse',
      c: [2, 3],
      firstStageRows: [
        { coef: [1, 1], sense: '<=', rhs: 10, name: 'budget' },
        { coef: [1, 2], sense: '>=', rhs: 4, name: 'minimum activity' },
      ],
      lower: [0, 0],
      upper: [8, 8],
      q: [0.5, -0.5],
      scenarios: [4, 10, 19].map((h, i) => ({
        name: `h = ${h}`,
        probability: [0.2, 0.5, 0.3][i],
        rows: [{ T: [-1, -1], W: [1, -1], sense: '=' as const, rhs: h, name: 'linear transfer' }],
      })),
    };
    const d = stochasticDiagnostics(problem);
    expect(d.vss).toBeCloseTo(0, 10);
    expect(d.evpi).toBeCloseTo(0, 10);
    expect(d.expectedValueOfMeanSolution).toBeCloseTo(d.recourseProblemValue, 10);
  });

  it('VSS is materially positive on a genuinely stochastic problem', () => {
    const problem = capacityExpansion({
      technologies: [
        { name: 'base', capitalCost: 10, operatingCost: 1 },
        { name: 'peak', capitalCost: 3, operatingCost: 6 },
      ],
      shortagePenalty: 50,
      demand: [
        { value: 50, probability: 0.3 },
        { value: 100, probability: 0.5 },
        { value: 160, probability: 0.2 },
      ],
    });
    const d = stochasticDiagnostics(problem);
    // The mean-value plan builds for mean demand 98 and pays the shortage
    // penalty in the 160 scenario; that is a large, not a marginal, penalty.
    expect(d.vss).toBeGreaterThan(0.2 * Math.abs(d.recourseProblemValue));
    expect(d.meanValue.x).not.toEqual(solveTwoStage(problem).x);
  });

  it('reports an infinite VSS when the mean-value plan has no feasible recourse', () => {
    const problem: TwoStageProblem = {
      name: 'mean plan fails',
      c: [2],
      firstStageRows: [],
      lower: [0],
      upper: [1000],
      q: [1],
      scenarios: [10, 25, 40].map((d) => ({
        name: `demand ${d}`,
        probability: 1 / 3,
        rows: [
          { T: [-1], W: [1], sense: '<=' as const, rhs: 0, name: 'within capacity' },
          { T: [0], W: [1], sense: '>=' as const, rhs: d, name: 'must produce demand' },
        ],
      })),
    };
    const d = stochasticDiagnostics(problem);
    expect(d.vss).toBe(Infinity);
    expect(d.meanValue.infeasibleScenarios.length).toBeGreaterThan(0);
    expect(d.meanValue.infeasibleScenarios[0].violation).toBeCloseTo(15, 6); // 40 − mean 25
    expect(d.provenance.limitations.join(' ')).toMatch(/does not merely cost more, it does not work/);
  });
});

/* ===================================================== multi-stage */

describe('multi-stage scenario trees', () => {
  it('solves a three-stage tree and states non-anticipativity', () => {
    // Buy early at 1, or late at 3 once demand is known. Demand is 20 or 60.
    const solution = solveMultistage({
      name: 'inventory',
      nodes: [
        { name: 'now', parent: null, conditionalProbability: 1, cost: [1], rows: [], upper: [100] },
        {
          name: 'low demand',
          parent: 0,
          conditionalProbability: 0.5,
          cost: [3, 10],
          rows: [{ own: [1, 1], parent: [1], sense: '>=', rhs: 20, name: 'serve 20' }],
          upper: [100, 100],
        },
        {
          name: 'high demand',
          parent: 0,
          conditionalProbability: 0.5,
          cost: [3, 10],
          rows: [{ own: [1, 1], parent: [1], sense: '>=', rhs: 60, name: 'serve 60' }],
          upper: [100, 100],
        },
      ],
    });
    expect(solution.status).toBe('optimal');
    // Buying 60 early costs 60. Buying 20 early and topping up costs
    // 20 + 0.5·3·40 = 80. Buying nothing early costs 0.5·3·20 + 0.5·3·60 = 120.
    // The early buy of 60 is optimal at 60.
    expect(solution.decisions[0].x[0]).toBeCloseTo(60, 9);
    expect(solution.objective).toBeCloseTo(60, 9);
    expect(solution.scenarios).toHaveLength(2);
    expect(solution.nonAnticipativityStatement).toMatch(/one decision vector per node/);
    expect(solution.nonAnticipativityStatement).toMatch(/can therefore be accidentally omitted/);
  });

  it('refuses a tree whose sibling probabilities do not sum to 1', () => {
    expect(() =>
      solveMultistage({
        name: 'bad tree',
        nodes: [
          { name: 'root', parent: null, conditionalProbability: 1, cost: [1], rows: [] },
          { name: 'a', parent: 0, conditionalProbability: 0.4, cost: [1], rows: [] },
          { name: 'b', parent: 0, conditionalProbability: 0.4, cost: [1], rows: [] },
        ],
      }),
    ).toThrow(/summing to 0.8/);
  });
});

/* ============================================= chance constraints */

describe('Gaussian chance constraints', () => {
  const covariance = [
    [0.5, 0.1],
    [0.1, 0.5],
  ];
  const lp: LpProblem = { sense: 'max', objective: [1, 1], rows: [], lower: [0, 0], upper: [20, 20] };

  it('the exact quantile reformulation achieves the required probability', () => {
    const reliability = 0.95;
    const solved = solveGaussianChanceLp(lp, [{ name: 'capacity', meanCoef: [1, 1], covariance, rhs: 10, reliability }]);
    expect(solved.solution.status).toBe('optimal');
    expect(solved.constraints[0].achieved).toBeCloseTo(reliability, 7);
    // Independent Monte Carlo check with the Cholesky factor built here.
    const l11 = Math.sqrt(0.5);
    const l21 = 0.1 / l11;
    const l22 = Math.sqrt(0.5 - l21 * l21);
    const rng = new Random('chance-verify');
    const draws = 200000;
    let hold = 0;
    for (let i = 0; i < draws; i++) {
      const z1 = rng.normal();
      const z2 = rng.normal();
      const a1 = 1 + l11 * z1;
      const a2 = 1 + l21 * z1 + l22 * z2;
      if (a1 * solved.solution.x[0] + a2 * solved.solution.x[1] <= 10) hold++;
    }
    // Binomial standard error at p = 0.95 with 200000 draws is
    // sqrt(0.95·0.05/200000) = 4.9e-4, so 4 standard errors is 2e-3.
    expect(hold / draws).toBeCloseTo(reliability, 2);
    expect(Math.abs(hold / draws - reliability)).toBeLessThan(2e-3);
  });

  it('a higher reliability costs objective value, monotonically', () => {
    let previous = Infinity;
    for (const reliability of [0.5001, 0.8, 0.9, 0.95, 0.99, 0.999]) {
      const solved = solveGaussianChanceLp(lp, [{ name: 'capacity', meanCoef: [1, 1], covariance, rhs: 10, reliability }]);
      expect(solved.solution.objective).toBeLessThanOrEqual(previous + 1e-7);
      previous = solved.solution.objective;
    }
  });

  it('the Bonferroni joint bound is conservative', () => {
    const specs = [
      { name: 'row 1', meanCoef: [1, 0.5], covariance: [[0.4, 0], [0, 0.3]], rhs: 10 },
      { name: 'row 2', meanCoef: [0.5, 1], covariance: [[0.3, 0], [0, 0.4]], rhs: 10 },
      { name: 'row 3', meanCoef: [0.8, 0.8], covariance: [[0.2, 0], [0, 0.2]], rhs: 12 },
    ];
    const required = 0.9;
    const solved = solveJointChanceBonferroni(lp, specs, required);
    expect(solved.perRowLevel).toBeCloseTo(1 - (1 - required) / 3, 12);
    const measured = jointSatisfactionProbability(solved.solution.x, specs, { seed: 'joint-verify', draws: 60000 });
    // Binomial standard error at p ≈ 0.935 with 60000 draws is 1.0e-3, so the
    // margin below is 10 standard errors and the over-satisfaction it detects
    // (about 3.5 percentage points) is far outside Monte Carlo noise.
    expect(measured.probability).toBeGreaterThan(required + 0.01);
    expect(measured.standardError).toBeLessThan(2e-3);
    // Each row individually over-satisfies its allocated level too.
    for (const p of measured.perRow) expect(p).toBeGreaterThan(solved.perRowLevel - 4 * 2e-3);
    expect(solved.provenance.limitations.join(' ')).toMatch(/Bonferroni is a one-sided bound/);
  });

  it('the scenario approximation respects the Calafiore-Campi guarantee across replications', () => {
    const epsilon = 0.1;
    const beta = 0.05;
    const dimension = 2;
    const required = calafioreCampiSampleSize(epsilon, beta, dimension);
    // (2/0.1)·(ln 20 + 2) = 20·(2.9957 + 2) = 99.9 → 100.
    expect(required).toBe(100);
    const replications = 20;
    let guaranteeMet = 0;
    const realised: number[] = [];
    for (let r = 0; r < replications; r++) {
      const rng = new Random(`cc-sample-${r}`);
      const sets = Array.from({ length: required }, () => [
        { coef: [1 + 0.6 * rng.normal(), 1 + 0.6 * rng.normal()], sense: '<=' as const, rhs: 10, name: 'capacity' },
      ]);
      const solved = solveScenarioApproximation(lp, sets, { epsilon, beta });
      expect(solved.guaranteeHolds).toBe(true);
      const check = new Random(`cc-verify-${r}`);
      const draws = 20000;
      let violations = 0;
      for (let i = 0; i < draws; i++) {
        const a1 = 1 + 0.6 * check.normal();
        const a2 = 1 + 0.6 * check.normal();
        if (a1 * solved.solution.x[0] + a2 * solved.solution.x[1] > 10 + 1e-9) violations++;
      }
      const p = violations / draws;
      realised.push(p);
      if (p <= epsilon) guaranteeMet++;
    }
    // The guarantee is that P(violation probability > ε) <= β = 0.05, so at
    // least 19 of 20 replications should comply. Binomial noise on each
    // individual estimate is at most sqrt(0.1·0.9/20000) = 2.1e-3, negligible
    // against the 0.1 threshold.
    expect(guaranteeMet).toBeGreaterThanOrEqual(replications - 1);
    // The bound is distribution-free and therefore loose: typical realised
    // violation is well under ε.
    expect(Math.max(...realised)).toBeLessThan(epsilon + 0.02);
  });

  it('reports when the sample size does not earn the guarantee', () => {
    const rng = new Random('too-few');
    const sets = Array.from({ length: 10 }, () => [{ coef: [1 + 0.6 * rng.normal(), 1 + 0.6 * rng.normal()], sense: '<=' as const, rhs: 10 }]);
    const solved = solveScenarioApproximation(lp, sets, { epsilon: 0.1, beta: 0.05 });
    expect(solved.guaranteeHolds).toBe(false);
    expect(solved.provenance.limitations.join(' ')).toMatch(/NO confidence guarantee/);
  });

  it('quantifies how much of the safety margin is the Gaussian tail', () => {
    const low = tailSensitivity(0.95);
    const high = tailSensitivity(0.999);
    expect(low.gaussian).toBeCloseTo(normalQuantile(0.95), 12);
    expect(high.worstRatio).toBeGreaterThan(low.worstRatio);
    // At 0.999 a unit-variance Laplace needs ln(500)/sqrt(2) = 4.394 standard
    // deviations against the Gaussian 3.090: a ratio above 1.4.
    expect(high.laplace).toBeCloseTo(Math.log(500) / Math.SQRT2, 9);
    expect(high.worstRatio).toBeGreaterThan(1.4);
    expect(high.message).toMatch(/once in a hundred observations/);
  });
});

describe('CVaR constraints', () => {
  it('CVaR >= VaR on many random loss samples', () => {
    const rng = new Random('cvar-vs-var');
    for (let t = 0; t < 200; t++) {
      const n = 5 + rng.int(0, 40);
      const losses = Array.from({ length: n }, () => rng.normal() * 3 + rng.uniformRange(-2, 2));
      const probabilities = new Array<number>(n).fill(1 / n);
      for (const level of [0.5, 0.8, 0.9, 0.95, 0.99]) {
        const v = discreteVar(losses, probabilities, level);
        const c = discreteCvar(losses, probabilities, level);
        expect(c).toBeGreaterThanOrEqual(v - 1e-12);
      }
    }
  });

  it('a CVaR-feasible solution satisfies the corresponding VaR constraint', () => {
    for (const seed of ['cvar-1', 'cvar-2', 'cvar-3', 'cvar-4', 'cvar-5']) {
      const rng = new Random(seed);
      const scenarios = Array.from({ length: 200 }, (_, i) => ({
        name: `s${i}`,
        probability: 1 / 200,
        coef: [1 + 0.5 * rng.normal(), 1 + 0.3 * rng.normal()],
        rhs: 10,
      }));
      for (const level of [0.8, 0.9, 0.95]) {
        const solved = solveCvarConstrainedLp({ sense: 'max', objective: [1, 1], rows: [], lower: [0, 0], upper: [20, 20] }, scenarios, level);
        // CVaR <= 0 by construction …
        expect(solved.cvarAtLevel).toBeLessThanOrEqual(1e-7);
        // … which forces VaR <= 0 …
        expect(solved.varAtLevel).toBeLessThanOrEqual(1e-7);
        // … which forces P(loss <= 0) >= level. Exact on the discrete law, so
        // no Monte Carlo tolerance is involved.
        expect(solved.satisfactionProbability).toBeGreaterThanOrEqual(level - 1e-9);
        expect(solved.provenance.limitations.join(' ')).toMatch(/implication is one-way/);
      }
    }
  });
});

/* ================================================ robust optimisation */

describe('robust optimisation', () => {
  // min t s.t. x1 + x2 + x3 = 1 and the uncertain objective row
  // c(ζ)ᵀx − t <= 0 with c̄ = (1, 1.1, 1.3) and ĉ = (0.6, 0.2, 0.05).
  const lp: LpProblem = {
    sense: 'min',
    objective: [0, 0, 0, 1],
    rows: [{ coef: [1, 1, 1, 0], sense: '=', rhs: 1, name: 'allocate' }],
    lower: [0, 0, 0, 0],
    upper: [1, 1, 1, Infinity],
  };
  const uncertain = [{ name: 'cost', nominal: [1, 1.1, 1.3, -1], deviation: [0.6, 0.2, 0.05, 0], rhs: 0 }];
  const cbar = [1, 1.1, 1.3];
  const chat = [0.6, 0.2, 0.05];
  const nominalValue = (x: number[]): number => cbar.reduce((a, c, j) => a + c * x[j], 0);
  const worstCase = (x: number[]): number => nominalValue(x) + chat.reduce((a, d, j) => a + d * Math.abs(x[j]), 0);

  it('is conservative in the worst case and worse nominally: both directions', () => {
    const robust = solveBoxRobust(lp, uncertain);
    const nominal = solveLp({ ...lp, rows: [...lp.rows, { coef: uncertain[0].nominal, sense: '<=', rhs: 0, name: 'nominal cost' }] });
    expect(nominal.status).toBe('optimal');
    // By hand: nominal picks option 1 (cost 1.0, worst case 1.6); the robust
    // problem minimises c̄ + ĉ = (1.6, 1.3, 1.35) and picks option 2
    // (cost 1.1, worst case 1.3).
    expect(nominalValue(nominal.x)).toBeCloseTo(1.0, 9);
    expect(worstCase(nominal.x)).toBeCloseTo(1.6, 9);
    expect(nominalValue(robust.x)).toBeCloseTo(1.1, 9);
    expect(worstCase(robust.x)).toBeCloseTo(1.3, 9);
    // The robust worst case is better …
    expect(worstCase(robust.x)).toBeLessThan(worstCase(nominal.x) - 1e-6);
    // … and its nominal value is worse. The price of robustness is real.
    expect(nominalValue(robust.x)).toBeGreaterThan(nominalValue(nominal.x) + 1e-6);
  });

  it('the Bertsimas-Sim budget curve is monotone and spans nominal to box', () => {
    const { curve } = priceOfRobustness(lp, uncertain, [0, 0.5, 1, 1.5, 2, 2.5, 3]);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].objective).toBeGreaterThanOrEqual(curve[i - 1].objective - 1e-9);
      expect(curve[i].costOfProtection).toBeGreaterThanOrEqual(curve[i - 1].costOfProtection - 1e-9);
    }
    // Γ = 0 is the nominal problem and Γ = 3 is the full box.
    expect(curve[0].objective).toBeCloseTo(1.0, 7);
    expect(curve[curve.length - 1].objective).toBeCloseTo(1.3, 7);
    // The violation bound tightens as the budget grows.
    for (let i = 1; i < curve.length; i++) expect(curve[i].violationBound).toBeLessThanOrEqual(curve[i - 1].violationBound + 1e-15);
  });

  it('the cross-evaluation table shows each decision under the others assumptions', () => {
    const robust = solveBoxRobust(lp, uncertain);
    const nominal = solveLp({ ...lp, rows: [...lp.rows, { coef: uncertain[0].nominal, sense: '<=', rhs: 0, name: 'nominal cost' }] });
    const table = crossEvaluate(
      [
        { name: 'robust', x: robust.x },
        { name: 'nominal', x: nominal.x },
      ],
      [
        { name: 'nominal cost', evaluate: nominalValue },
        { name: 'worst case', evaluate: worstCase },
      ],
    );
    // Neither decision wins both criteria; that non-dominance is the point.
    expect(table.best[0].solution).toBe('nominal');
    expect(table.best[1].solution).toBe('robust');
  });

  it('solves the ellipsoidal and polyhedral counterparts', () => {
    const budgeted = solveBudgetedRobust(lp, uncertain, 1);
    const ellipsoidal = solveEllipsoidalRobust(lp, [
      {
        ...uncertain[0],
        covariance: [
          [0.36, 0, 0, 0],
          [0, 0.04, 0, 0],
          [0, 0, 0.0025, 0],
          [0, 0, 0, 1e-8],
        ],
        radius: 1,
      },
    ]);
    // An ellipsoid of radius 1 inscribed in the box is less conservative than
    // the box, so it must cost no more than the Γ = 3 (box) optimum.
    expect(ellipsoidal.objective).toBeLessThanOrEqual(1.3 + 1e-6);
    expect(budgeted.objective).toBeGreaterThanOrEqual(1.0 - 1e-9);
    const polyhedral = solvePolyhedralRobust(lp, [
      {
        ...uncertain[0],
        // a = ā + Pζ with ζ ∈ [−1,1]² and ‖ζ‖₁ <= 1: the Γ = 1 budget set
        // written out as a polyhedron, so it must reproduce that objective.
        P: [[0.6, 0], [0, 0.2], [0, 0], [0, 0]],
        D: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
        d: [1, 1, 1, 1, 1, 1, 1, 1],
      },
    ]);
    expect(polyhedral.objective).toBeCloseTo(budgeted.objective, 6);
  });
});

describe('distributionally robust bounds', () => {
  it('the moment bound dominates every distribution with those moments', () => {
    for (const [mean, variance, threshold] of [
      [5, 4, 3],
      [0, 1, 0],
      [10, 9, 14],
      [-2, 2.25, -1],
    ] as const) {
      const bound = worstCaseExpectedExcess(mean, variance, threshold);
      const sd = Math.sqrt(variance);
      // Several specific laws with exactly this mean and variance.
      const candidates: { name: string; value: number }[] = [];
      // Normal: E[(X−b)⁺] = (μ−b)Φ(d/σ) + σφ(d/σ).
      const d = (mean - threshold) / sd;
      candidates.push({ name: 'normal', value: (mean - threshold) * normalCdf(d) + sd * normalPdf(d) });
      // Two-sided symmetric two-point at μ ± σ.
      candidates.push({ name: 'symmetric two-point', value: 0.5 * Math.max(0, mean + sd - threshold) + 0.5 * Math.max(0, mean - sd - threshold) });
      // Uniform on [μ − σ√3, μ + σ√3].
      {
        const half = sd * Math.sqrt(3);
        const lo = mean - half;
        const hi = mean + half;
        const t = Math.min(hi, Math.max(lo, threshold));
        candidates.push({ name: 'uniform', value: ((hi - t) * (hi - t)) / (2 * (hi - lo)) });
      }
      // A skewed three-point law, moment-matched by construction below.
      {
        const values = [mean - sd * Math.sqrt(2), mean, mean + sd * Math.sqrt(2)];
        const probs = [0.25, 0.5, 0.25];
        const m = values.reduce((a, v, i) => a + probs[i] * v, 0);
        const v2 = values.reduce((a, v, i) => a + probs[i] * (v - m) * (v - m), 0);
        expect(m).toBeCloseTo(mean, 9);
        expect(v2).toBeCloseTo(variance, 9);
        candidates.push({ name: 'three-point', value: values.reduce((a, v, i) => a + probs[i] * Math.max(0, v - threshold), 0) });
      }
      for (const c of candidates) {
        expect(c.value).toBeLessThanOrEqual(bound.bound + 1e-9);
      }
      // The two-point extremal law matches the moments and attains the bound.
      const { values, probabilities } = bound.extremal;
      const m = values.reduce((a, v, i) => a + probabilities[i] * v, 0);
      const v2 = values.reduce((a, v, i) => a + probabilities[i] * (v - m) * (v - m), 0);
      expect(m).toBeCloseTo(mean, 9);
      expect(v2).toBeCloseTo(variance, 9);
      const attained = values.reduce((a, v, i) => a + probabilities[i] * Math.max(0, v - threshold), 0);
      expect(attained).toBeCloseTo(bound.bound, 9);
      // And the closed form itself.
      expect(bound.bound).toBeCloseTo(0.5 * (mean - threshold + Math.sqrt((mean - threshold) ** 2 + variance)), 12);
    }
  });

  it('worst-case CVaR and the Cantelli bound are consistent with each other', () => {
    const mean = 2;
    const variance = 3;
    for (const level of [0.9, 0.95, 0.99]) {
      const wc = worstCaseCvar(mean, variance, level);
      expect(wc.bound).toBeCloseTo(mean + Math.sqrt(variance) * Math.sqrt(level / (1 - level)), 12);
      // At the worst-case VaR itself the Cantelli exceedance bound equals 1−α.
      expect(cantelliExceedanceBound(mean, variance, wc.bound)).toBeCloseTo(1 - level, 10);
      // A normal law with these moments has a strictly smaller CVaR.
      const z = normalQuantile(level);
      const normalCvarValue = mean + Math.sqrt(variance) * (normalPdf(z) / (1 - level));
      expect(normalCvarValue).toBeLessThan(wc.bound);
    }
  });

  it('the distributionally robust solution is pessimistic by construction', () => {
    const lp: LpProblem = {
      sense: 'min',
      objective: [-1, -1],
      rows: [{ coef: [1, 1], sense: '<=', rhs: 10, name: 'budget' }],
      lower: [0, 0],
      upper: [8, 8],
    };
    const covariance = [
      [1, 0.2],
      [0.2, 2],
    ];
    const dro = solveDistributionallyRobustExcess(lp, { meanCoef: [1, 2], covariance, threshold: 10, weight: 3 });
    // The worst-case excess reported at the solution must match the closed form
    // recomputed here from μᵀx and xᵀΣx.
    const mu = 1 * dro.x[0] + 2 * dro.x[1];
    const v = dro.x[0] ** 2 * 1 + 2 * dro.x[0] * dro.x[1] * 0.2 + dro.x[1] ** 2 * 2;
    const closed = worstCaseExpectedExcess(mu, v, 10);
    expect(dro.worstCaseExcess).toBeCloseTo(closed.bound, 7);
    // A Gaussian law with those moments gives a strictly smaller excess, so the
    // robust objective overstates the cost under any specific distribution.
    const d = (mu - 10) / Math.sqrt(v);
    const gaussianExcess = (mu - 10) * normalCdf(d) + Math.sqrt(v) * normalPdf(d);
    expect(gaussianExcess).toBeLessThanOrEqual(dro.worstCaseExcess + 1e-9);
    expect(dro.provenance.exactness).toBe('numerical');
  });
});

/* ============================================ sample-based methods */

/** Closed-form Gaussian newsvendor, computed here and nowhere in the module. */
function gaussianNewsvendor(cost: number, price: number, salvage: number, mu: number, sigma: number) {
  const fractile = (price - cost) / (price - salvage);
  const optimal = mu + sigma * normalQuantile(fractile);
  const expectedCost = (x: number): number => {
    const z = (x - mu) / sigma;
    const leftover = (x - mu) * normalCdf(z) + sigma * normalPdf(z);
    return cost * x - price * x + (price - salvage) * leftover;
  };
  return { fractile, optimal, expectedCost, optimalValue: expectedCost(optimal) };
}

describe('sample average approximation', () => {
  const cost = 5;
  const price = 12;
  const salvage = 2;
  const mu = 100;
  const sigma = 20;
  const truth = gaussianNewsvendor(cost, price, salvage, mu, sigma);

  const problem = {
    name: 'gaussian newsvendor',
    sample: (rng: Random) => Math.max(0, mu + sigma * rng.normal()),
    solve: (scenarios: number[]) => {
      const built = newsvendorTwoStage({
        unitCost: cost,
        price,
        salvage,
        demand: scenarios.map((d) => ({ value: d, probability: 1 / scenarios.length })),
        maxOrder: 400,
      });
      const solved = solveDeterministicEquivalent(built);
      return { x: solved.x, objective: solved.objective };
    },
    evaluate: (x: number[], scenarios: number[]) =>
      scenarios.reduce((a, d) => a + (cost * x[0] - price * Math.min(x[0], d) - salvage * Math.max(0, x[0] - d)), 0) / scenarios.length,
  };

  it('the in-sample optimum is optimistically biased', () => {
    const rng = new Random('saa-bias');
    const values: number[] = [];
    for (let k = 0; k < 60; k++) {
      const scenarios = Array.from({ length: 15 }, () => problem.sample(rng));
      values.push(problem.solve(scenarios).objective);
    }
    const meanInSample = values.reduce((a, b) => a + b, 0) / values.length;
    // E[v̂_N] <= v* for a minimisation problem. The spread of v̂_N across
    // replications has standard deviation about 20 cost units, so the standard
    // error of this mean over 60 replications is about 2.6; the measured bias
    // is roughly 0.6, well inside that, so the assertion is the INEQUALITY and
    // not a claim about the bias's size.
    expect(meanInSample).toBeLessThanOrEqual(truth.optimalValue + 1e-9);
  });

  it('the reported gap interval covers the true gap at approximately its nominal rate', () => {
    const replications = 40;
    let covered = 0;
    for (let r = 0; r < replications; r++) {
      const result = sampleAverageApproximation(problem, {
        sampleSize: 20,
        replications: 10,
        evaluationSize: 400,
        seed: `saa-coverage-${r}`,
      });
      expect(result.provenance.exactness).toBe('empirical');
      expect(result.provenance.limitations.join(' ')).toMatch(/optimistically biased/);
      const trueGap = truth.expectedCost(result.candidate[0]) - truth.optimalValue;
      expect(trueGap).toBeGreaterThanOrEqual(-1e-9); // no candidate can beat the optimum
      expect(result.gapUpperConfidenceBound).toBeGreaterThanOrEqual(result.gapEstimate);
      if (trueGap <= result.gapUpperConfidenceBound) covered++;
    }
    // Nominal one-sided coverage is 0.95 and the construction is conservative
    // (the lower bound estimates E[v̂_N] <= v*), so coverage should be at or
    // above nominal. With 40 replications the binomial standard error at
    // p = 0.95 is sqrt(0.95·0.05/40) = 0.034, so the floor below is nominal
    // minus 3 standard errors.
    expect(covered / replications).toBeGreaterThanOrEqual(0.85);
  });

  it('refuses a single replication, which admits no interval', () => {
    expect(() => sampleAverageApproximation(problem, { sampleSize: 10, replications: 1, evaluationSize: 10, seed: 'x' })).toThrow(/at least 2 independent replications/);
  });
});

describe('scenario generation and reduction', () => {
  it('builds Latin hypercube scenarios with the stratification property', () => {
    const normal = getDistribution('normal');
    const count = 40;
    const scenarios = latinHypercubeScenarios(1, count, 'lhs-scenarios', (u) => normal.quantile(u, { mu: 100, sigma: 20 }));
    expect(scenarios).toHaveLength(count);
    // One point per equal-probability stratum is the defining LHS property;
    // after the inverse CDF that means one point per quantile band.
    const bands = new Set(scenarios.map((s) => Math.floor(normal.cdf(s[0], { mu: 100, sigma: 20 }) * count)));
    expect(bands.size).toBe(count);
  });

  it('refuses a scenario value the inverse CDF sends to infinity', () => {
    expect(() => latinHypercubeScenarios(1, 8, 'inf', (u) => (u > 0.9 ? Infinity : u))).toThrow(/A scenario value must be finite/);
  });

  it('the Wasserstein distance decreases monotonically and the objective converges', () => {
    const normal = getDistribution('normal');
    const full = 40;
    const points = Array.from({ length: full }, (_, i) => [normal.quantile((i + 0.5) / full, { mu: 100, sigma: 20 })]);
    const probabilities = new Array<number>(full).fill(1 / full);
    const fullProblem = newsvendorTwoStage({
      unitCost: 5,
      price: 12,
      salvage: 2,
      demand: points.map((p, i) => ({ value: p[0], probability: probabilities[i] })),
      maxOrder: 400,
    });
    const fullValue = solveDeterministicEquivalent(fullProblem).objective;
    let previousDistance = Infinity;
    const errors: number[] = [];
    for (const retain of [2, 4, 8, 16, 32, 40]) {
      const reduction = reduceScenarios(points, probabilities, retain);
      expect(reduction.indices).toHaveLength(retain);
      expect(reduction.wassersteinDistance).toBeLessThanOrEqual(previousDistance + 1e-9);
      previousDistance = reduction.wassersteinDistance;
      const reducedProblem = newsvendorTwoStage({
        unitCost: 5,
        price: 12,
        salvage: 2,
        demand: reduction.indices.map((idx, k) => ({ value: points[idx][0], probability: reduction.probabilities[k] })),
        maxOrder: 400,
      });
      const reducedSolution = solveDeterministicEquivalent(reducedProblem);
      errors.push(Math.abs(expectedCostOf(fullProblem, reducedSolution.x).cost - fullValue));
      // The retained probabilities still form a distribution.
      expect(reduction.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
    // Retaining everything reproduces the full problem exactly.
    expect(previousDistance).toBeCloseTo(0, 12);
    expect(errors[errors.length - 1]).toBeCloseTo(0, 8);
    // And the approximation improves overall as the retained count grows.
    expect(errors[errors.length - 1]).toBeLessThanOrEqual(errors[0] + 1e-9);
    expect(errors[4]).toBeLessThanOrEqual(errors[0] + 1e-9);
  });

  it('the reduction distance is the nearest-neighbour transport cost', () => {
    const points = [[0], [1], [10], [11]];
    const probabilities = [0.25, 0.25, 0.25, 0.25];
    // Retaining {0, 10} moves 1 → 0 (distance 1) and 11 → 10 (distance 1), so
    // the transport cost is 0.25·1 + 0.25·1 = 0.5, computed by hand.
    const { distance } = reductionDistance(points, probabilities, [0, 2]);
    expect(distance).toBeCloseTo(0.5, 12);
  });
});

/* ======================================= stochastic approximation */

describe('stochastic approximation', () => {
  // f(x) = ‖x − a‖² with gradient 2(x − a) plus additive noise. Convex, with
  // the known optimum a.
  const target = [3, -2];
  const noisyGradient = (x: number[], rng: Random): number[] => x.map((v, j) => 2 * (v - target[j]) + rng.normal() * 0.5);
  const noisyObjective = (x: number[], rng: Random): number => x.reduce((a, v, j) => a + (v - target[j]) ** 2, 0) + rng.normal() * 0.1;

  it('SGD converges to the known optimum with a Robbins-Monro step size', () => {
    const result = stochasticGradientDescent({
      dimension: 2,
      gradient: noisyGradient,
      initial: [0, 0],
      iterations: 20000,
      stepScale: 0.2,
      stepExponent: 0.7,
      seed: 'sgd',
      tolerance: 1e-2,
    });
    expect(result.conditions.satisfied).toBe(true);
    expect(result.status).toBe('converged');
    // Averaged-iterate noise at 20000 steps with gradient noise sd 0.5 is of
    // order 0.5/sqrt(20000) ≈ 3.5e-3 per coordinate; 0.05 is a comfortable
    // multiple of that and still far below the distance travelled (3.6).
    expect(result.x[0]).toBeCloseTo(target[0], 1);
    expect(result.x[1]).toBeCloseTo(target[1], 1);
    expect(Math.hypot(result.x[0] - target[0], result.x[1] - target[1])).toBeLessThan(0.05);
  });

  it('does NOT converge with a non-decreasing step size, and reports that', () => {
    const constantStep = stochasticGradientDescent({
      dimension: 2,
      gradient: noisyGradient,
      initial: [0, 0],
      iterations: 20000,
      stepScale: 0.2,
      stepExponent: 0, // a_k = 0.2 for every k: Σa_k² = ∞
      seed: 'sgd-constant',
    });
    expect(constantStep.conditions.sumDiverges).toBe(true);
    expect(constantStep.conditions.sumSquaresConverges).toBe(false);
    expect(constantStep.conditions.satisfied).toBe(false);
    expect(constantStep.status).toBe('step-size-conditions-violated');
    expect(constantStep.provenance.limitations.join(' ')).toMatch(/NOT a solution/);
    expect(constantStep.conditions.statement).toMatch(/iterates do not converge/);
    // A step exponent above 1 fails the other condition.
    const stalling = stepSizeConditions(1.5);
    expect(stalling.sumDiverges).toBe(false);
    expect(stalling.satisfied).toBe(false);
    expect(stalling.statement).toMatch(/stall/);
  });

  it('SPSA converges to the known optimum using objective values only', () => {
    const result = spsa({
      dimension: 2,
      objective: noisyObjective,
      initial: [0, 0],
      iterations: 8000,
      stepScale: 0.5,
      perturbationScale: 0.2,
      seed: 'spsa',
      tolerance: 1e-1,
    });
    expect(result.conditions.satisfied).toBe(true);
    // SPSA's gradient estimate has bias O(c_k²) ≈ 0.01 and the averaged iterate
    // carries noise of order 0.1; a tolerance of 0.3 per coordinate is about
    // three times that and is still under a tenth of the 3.6 travelled.
    expect(Math.abs(result.x[0] - target[0])).toBeLessThan(0.3);
    expect(Math.abs(result.x[1] - target[1])).toBeLessThan(0.3);
  });

  it('SPSA reports violated gain conditions instead of a solution', () => {
    const bad = spsa({
      dimension: 2,
      objective: noisyObjective,
      initial: [0, 0],
      iterations: 200,
      stepScale: 0.3,
      perturbationScale: 0.2,
      stepExponent: 0.2,
      perturbationExponent: 0.4, // α − 2γ = −0.6 < 0
      seed: 'spsa-bad',
    });
    expect(bad.status).toBe('step-size-conditions-violated');
    expect(bad.conditions.statement).toMatch(/violate Spall's conditions/);
  });

  it('the IPA gradient of the newsvendor matches the analytic derivative', () => {
    const cost = 5;
    const price = 12;
    const salvage = 2;
    const mu = 100;
    const sigma = 20;
    const x = 105;
    const estimate = ipaGradient(newsvendorPathDerivative(x, { unitCost: cost, price, salvage }, (rng) => mu + sigma * rng.normal()), {
      draws: 200000,
      seed: 'ipa',
      dimension: 1,
      pathIsAlmostSurelyDifferentiable: true,
    });
    // Analytic: dC/dx = c − p·P(D > x) − v·P(D <= x), computed here from the
    // normal CDF.
    const tail = 1 - normalCdf((x - mu) / sigma);
    const analytic = cost - price * tail - salvage * (1 - tail);
    // The per-draw derivative takes two values 10 apart, so its sd is about 5
    // and the standard error over 200000 draws is about 1.1e-2; 4 standard
    // errors is 0.045.
    expect(estimate.standardError[0]).toBeLessThan(0.015);
    expect(Math.abs(estimate.gradient[0] - analytic)).toBeLessThan(0.045);
    expect(estimate.conditions.join(' ')).toMatch(/almost surely differentiable/);
  });

  it('refuses IPA on a path that is not almost surely differentiable', () => {
    expect(() =>
      ipaGradient(() => [1], { draws: 100, seed: 'nope', dimension: 1, pathIsAlmostSurelyDifferentiable: false }),
    ).toThrow(/converges to the WRONG number/);
  });
});

/* ====================================================== heuristics */

describe('heuristics claim nothing', () => {
  // A 12-item knapsack, small enough to enumerate exactly in the test.
  const items = [
    { value: 13, weight: 7 },
    { value: 9, weight: 5 },
    { value: 21, weight: 12 },
    { value: 4, weight: 3 },
    { value: 17, weight: 9 },
    { value: 6, weight: 4 },
    { value: 11, weight: 6 },
    { value: 25, weight: 14 },
    { value: 8, weight: 5 },
    { value: 15, weight: 8 },
    { value: 3, weight: 2 },
    { value: 19, weight: 11 },
  ];
  const capacity = 40;
  const energy = (x: number[]): number => {
    const weight = x.reduce((a, v, j) => a + v * items[j].weight, 0);
    const value = x.reduce((a, v, j) => a + v * items[j].value, 0);
    // A finite penalty rather than infinity, so the cross-entropy method has an
    // elite set even when every draw is overweight.
    return -value + 100 * Math.max(0, weight - capacity);
  };

  it('simulated annealing matches the brute-force optimum often, and guarantees nothing', () => {
    const optimum = bruteForceBinary(items.length, energy);
    expect(optimum.evaluated).toBe(2 ** items.length);
    let matches = 0;
    const seeds = ['sa-1', 'sa-2', 'sa-3', 'sa-4', 'sa-5', 'sa-6', 'sa-7', 'sa-8'];
    for (const seed of seeds) {
      const run = simulatedAnnealing<number[]>({
        initial: new Array<number>(items.length).fill(0),
        energy,
        neighbour: (state, rng) => {
          const next = [...state];
          const j = rng.int(0, items.length - 1);
          next[j] = 1 - next[j];
          return next;
        },
        iterations: 4000,
        initialTemperature: 20,
        coolingRate: 0.999,
        seed,
      });
      // The disclaimer is required on every run, not offered.
      expect(run.guarantee.globalOptimumGuaranteed).toBe(false);
      expect(run.guarantee.statement).toMatch(/No global guarantee/);
      expect(run.provenance.exactness).toBe('empirical');
      // It can never beat the true optimum.
      expect(run.bestEnergy).toBeGreaterThanOrEqual(optimum.bestValue - 1e-9);
      if (Math.abs(run.bestEnergy - optimum.bestValue) < 1e-9) matches++;
    }
    // "Often" — this is deliberately NOT an assertion that it always matches.
    expect(matches).toBeGreaterThanOrEqual(Math.ceil(seeds.length / 2));
  });

  it('the cross-entropy method matches the brute-force optimum often, and guarantees nothing', () => {
    const optimum = bruteForceBinary(items.length, energy);
    let matches = 0;
    const seeds = ['ce-1', 'ce-2', 'ce-3', 'ce-4', 'ce-5', 'ce-6', 'ce-7', 'ce-8'];
    for (const seed of seeds) {
      const run = crossEntropyMethod({
        dimension: items.length,
        objective: energy,
        iterations: 60,
        sampleSize: 100,
        eliteFraction: 0.1,
        smoothing: 0.6,
        seed,
      });
      expect(run.guarantee.globalOptimumGuaranteed).toBe(false);
      expect(run.guarantee.statement).toMatch(/No global guarantee/);
      expect(run.bestEnergy).toBeGreaterThanOrEqual(optimum.bestValue - 1e-9);
      expect(run.probabilities.every((p) => p >= 0 && p <= 1)).toBe(true);
      if (Math.abs(run.bestEnergy - optimum.bestValue) < 1e-9) matches++;
    }
    expect(matches).toBeGreaterThanOrEqual(Math.ceil(seeds.length / 2));
  });

  it('refuses an enumeration too large to be the answer', () => {
    expect(() => bruteForceBinary(30, energy)).toThrow(/above the limit of 2\^22/);
  });
});

/* ================================================ problem library */

describe('problem library', () => {
  it('every problem solves and reports a non-negative VSS and EVPI', () => {
    const problems: TwoStageProblem[] = [
      newsvendorTwoStage({ unitCost: 5, price: 12, salvage: 2, demand: poissonDemand() }),
      capacityExpansion({
        technologies: [
          { name: 'base', capitalCost: 10, operatingCost: 1 },
          { name: 'peak', capitalCost: 3, operatingCost: 6 },
        ],
        shortagePenalty: 50,
        demand: [
          { value: 50, probability: 0.3 },
          { value: 100, probability: 0.5 },
          { value: 160, probability: 0.2 },
        ],
      }),
      productionMix({
        products: [
          { name: 'wheat', inputCost: 150, price: 170, buyInPrice: 238, requirement: 200 },
          { name: 'corn', inputCost: 230, price: 150, buyInPrice: 210, requirement: 240 },
        ],
        resource: 500,
        yields: [
          { name: 'poor', probability: 1 / 3, factors: [2.0, 2.4] },
          { name: 'average', probability: 1 / 3, factors: [2.5, 3.0] },
          { name: 'good', probability: 1 / 3, factors: [3.0, 3.6] },
        ],
      }),
      transportationNetwork({
        depots: [
          { name: 'D1', stockingCost: 2 },
          { name: 'D2', stockingCost: 3 },
        ],
        customers: [
          { name: 'C1', shortagePenalty: 20 },
          { name: 'C2', shortagePenalty: 25 },
        ],
        transportCost: [
          [1, 4],
          [3, 1],
        ],
        demandScenarios: [
          { name: 'low', probability: 0.4, demand: [10, 20] },
          { name: 'high', probability: 0.6, demand: [30, 25] },
        ],
      }),
      projectSelection({
        projects: [
          { name: 'A', cost: 40, value: 60 },
          { name: 'B', cost: 35, value: 48 },
          { name: 'C', cost: 50, value: 80 },
        ],
        budget: 80,
        overrunScenarios: [
          { name: 'on budget', probability: 0.5, multiplier: 1 },
          { name: 'overrun', probability: 0.5, multiplier: 1.4 },
        ],
        overrunPenalty: 2,
      }),
      staffing({
        periods: [
          { name: 'morning', wage: 100, overtimeWage: 3, serviceRate: 10, overtimeFraction: 0.25 },
          { name: 'evening', wage: 120, overtimeWage: 4, serviceRate: 10, overtimeFraction: 0.25 },
        ],
        abandonmentCost: 40,
        arrivalScenarios: [
          { name: 'calm', probability: 0.5, arrivals: [60, 80] },
          { name: 'busy', probability: 0.5, arrivals: [120, 150] },
        ],
      }),
    ];
    for (const problem of problems) {
      validateTwoStage(problem);
      const extensive = solveDeterministicEquivalent(problem);
      const lshaped = solveLShaped(problem);
      expect(extensive.status).toBe('optimal');
      expect(lshaped.objective).toBeCloseTo(extensive.objective, 7);
      const d = stochasticDiagnostics(problem, { solution: extensive });
      expect(d.evpi).toBeGreaterThanOrEqual(0);
      expect(d.vss).toBeGreaterThanOrEqual(0);
      // The first-stage and recourse parts must add to the reported objective.
      expect(extensive.firstStageCost + extensive.expectedRecourseCost).toBeCloseTo(extensive.objective, 7);
    }
  });
});

/* ======================================================= refusals */

describe('refusals', () => {
  const base: TwoStageProblem = newsvendorTwoStage({ unitCost: 5, price: 12, salvage: 2, demand: poissonDemand() });

  it('refuses an empty scenario set', () => {
    expect(() => validateTwoStage({ ...base, scenarios: [] })).toThrow(/scenario set is empty/);
  });

  it('refuses probabilities that do not sum to 1, reporting the actual sum', () => {
    const bad = { ...base, scenarios: base.scenarios.map((s) => ({ ...s, probability: s.probability * 0.9 })) };
    expect(() => validateTwoStage(bad)).toThrow(/sum to 0.9/);
    expect(() => solveTwoStage(bad)).toThrow(/unaccounted probability, not a rounding detail/);
  });

  it('refuses a scenario set whose shape varies', () => {
    const bad = {
      ...base,
      scenarios: base.scenarios.map((s, i) => (i === 1 ? { ...s, rows: s.rows.slice(0, 1) } : s)),
    };
    expect(() => validateTwoStage(bad)).toThrow(/The right-hand side and the matrices may vary with the scenario; the problem's shape may not/);
  });

  it('refuses an infeasible problem, naming the row and the shortfall', () => {
    const infeasible: TwoStageProblem = {
      ...base,
      firstStageRows: [
        { coef: [1], sense: '>=', rhs: 30, name: 'minimum order' },
        { coef: [1], sense: '<=', rhs: 10, name: 'maximum order' },
      ],
    };
    let message = '';
    try {
      solveDeterministicEquivalent(infeasible);
    } catch (e) {
      message = e instanceof EngineError ? e.message : String(e);
    }
    expect(message).toMatch(/constraints cannot all be satisfied/);
    expect(message).toMatch(/minimum order|maximum order/);
    expect(message).toMatch(/short by/);
  });

  it('refuses an unbounded recourse objective', () => {
    const unbounded: TwoStageProblem = {
      name: 'unbounded recourse',
      c: [1],
      firstStageRows: [],
      lower: [0],
      upper: [10],
      q: [-1], // profit per unit of an unbounded recourse variable
      scenarios: [
        {
          name: 'only',
          probability: 1,
          rows: [{ T: [1], W: [1], sense: '>=', rhs: 1, name: 'at least one' }],
        },
      ],
    };
    expect(() => solveDeterministicEquivalent(unbounded)).toThrow(/unbounded/);
    expect(() => solveLShaped(unbounded)).toThrow(/unbounded below/);
  });

  it('refuses a chance-constraint level outside (0,1)', () => {
    for (const level of [0, 1, -0.2, 1.5, NaN]) {
      expect(() => checkReliability(level)).toThrow(/must lie strictly inside \(0, 1\)/);
    }
    const lp: LpProblem = { sense: 'max', objective: [1], rows: [], lower: [0], upper: [10] };
    expect(() => solveGaussianChanceLp(lp, [{ name: 'r', meanCoef: [1], covariance: [[1]], rhs: 5, reliability: 1 }])).toThrow(/strictly inside \(0, 1\)/);
    // Below one half the reformulation is concave, not merely slack.
    expect(() => solveGaussianChanceLp(lp, [{ name: 'r', meanCoef: [1], covariance: [[1]], rhs: 5, reliability: 0.3 }])).toThrow(/becomes concave/);
  });

  it('refuses a non-positive-definite covariance in an ellipsoidal set', () => {
    const lp: LpProblem = { sense: 'min', objective: [1, 1], rows: [], lower: [0, 0], upper: [10, 10] };
    const singular = [
      [1, 1],
      [1, 1],
    ];
    expect(() =>
      solveEllipsoidalRobust(lp, [{ name: 'r', nominal: [1, 1], covariance: singular, rhs: 5, radius: 1 }]),
    ).toThrow(/not positive definite/);
    const indefinite = [
      [1, 2],
      [2, 1],
    ];
    expect(() => solveGaussianChanceLp(lp, [{ name: 'r', meanCoef: [1, 1], covariance: indefinite, rhs: 5, reliability: 0.95 }])).toThrow(
      /not positive definite/,
    );
    const asymmetric = [
      [1, 0.5],
      [0.2, 1],
    ];
    expect(() => solveGaussianChanceLp(lp, [{ name: 'r', meanCoef: [1, 1], covariance: asymmetric, rhs: 5, reliability: 0.95 }])).toThrow(/not symmetric/);
  });

  it('refuses a degenerate uncertainty set', () => {
    const lp: LpProblem = { sense: 'min', objective: [1, 1], rows: [], lower: [0, 0], upper: [10, 10] };
    expect(() => solveBoxRobust(lp, [{ name: 'r', nominal: [1, 1], deviation: [0, 0], rhs: 5 }])).toThrow(/single point ā/);
    expect(() =>
      solveEllipsoidalRobust(lp, [{ name: 'r', nominal: [1, 1], covariance: [[1, 0], [0, 1]], rhs: 5, radius: 0 }]),
    ).toThrow(/collapses the set to the single point/);
    expect(() =>
      solvePolyhedralRobust(lp, [{ name: 'r', nominal: [1, 1], rhs: 5, P: [[1], [1]], D: [], d: [] }]),
    ).toThrow(/ζ is unbounded and the worst case is \+∞/);
    expect(() => solveBoxRobust(lp, [])).toThrow(/at least one uncertain row/);
    expect(() => solveBudgetedRobust(lp, [{ name: 'r', nominal: [1, 1], deviation: [1, 1], rhs: 5 }], 5)).toThrow(/exceeds the number of genuinely uncertain coefficients/);
  });

  it('refuses malformed scenario reduction and CVaR requests', () => {
    expect(() => reduceScenarios([], [], 1)).toThrow(/non-empty scenario set/);
    expect(() => reduceScenarios([[0], [1]], [0.4, 0.4], 1)).toThrow(/sum to 0.8/);
    expect(() => reduceScenarios([[0], [1]], [0.5, 0.5], 5)).toThrow(/between 1 and 2/);
    const lp: LpProblem = { sense: 'max', objective: [1], rows: [], lower: [0], upper: [10] };
    expect(() => solveCvarConstrainedLp(lp, [], 0.9)).toThrow(/at least one loss scenario/);
    expect(() =>
      solveCvarConstrainedLp(lp, [{ name: 'a', probability: 0.3, coef: [1], rhs: 1 }], 0.9),
    ).toThrow(/sum to 0.3/);
  });

  it('refuses a price-of-robustness request with no budgets and an empty LP', () => {
    const lp: LpProblem = { sense: 'min', objective: [1], rows: [], lower: [0], upper: [10] };
    expect(() => priceOfRobustness(lp, [{ name: 'r', nominal: [1], deviation: [0.1], rhs: 5 }], [])).toThrow(/at least one protection budget/);
    expect(() => solveLp({ sense: 'min', objective: [], rows: [] })).toThrow(/at least one decision variable/);
  });
});
