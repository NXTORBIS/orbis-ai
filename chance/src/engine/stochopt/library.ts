/**
 * A library of two-stage problems with real structure, so the module has
 * content to be exercised on rather than only an abstract interface.
 *
 * The newsvendor is first for a reason: it is the only one of these whose
 * answer is known in closed form (the critical fractile F⁻¹(c_u/(c_u+c_o))),
 * which makes it the validation case for the entire two-stage machinery. If the
 * general extensive form and the L-shaped method cannot reproduce the fractile,
 * nothing they say about the other five problems is worth reading.
 */
import { EngineError, Validator } from '../core/result';
import { stableSum } from '../core/numeric';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import type { LpRow, Scenario, ScenarioRow, TwoStageProblem } from './types';

export interface DiscreteOutcome {
  value: number;
  probability: number;
}

/** Discretise a registry distribution onto a finite scenario set, reporting the mass kept. */
export function discretiseDistribution(
  id: string,
  params: Params,
  count: number,
): { outcomes: DiscreteOutcome[]; massCovered: number } {
  if (!Number.isInteger(count) || count < 2) throw new EngineError('A scenario set needs at least 2 points to represent uncertainty.', 'range');
  const def = getDistribution(id);
  const probs: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    values.push(def.quantile(u, params));
    probs.push(1 / count);
  }
  return { outcomes: values.map((value, i) => ({ value, probability: probs[i] })), massCovered: 1 };
}

function checkOutcomes(outcomes: DiscreteOutcome[], label: string): void {
  const v = new Validator();
  if (outcomes.length === 0) v.add(`${label}: the scenario set is empty.`, 'outcomes', 'empty');
  const sum = stableSum(outcomes.map((o) => o.probability));
  if (outcomes.length > 0 && Math.abs(sum - 1) > 1e-9) {
    v.add(`${label}: the outcome probabilities sum to ${sum.toPrecision(12)}, not 1.`, 'outcomes', 'sum');
  }
  for (const o of outcomes) {
    if (!Number.isFinite(o.value)) v.add(`${label}: an outcome value is ${String(o.value)}.`, 'outcomes', 'finite');
    if (!(o.probability >= 0)) v.add(`${label}: an outcome has probability ${String(o.probability)}.`, 'outcomes', 'range');
  }
  v.throwIfInvalid();
}

/* ------------------------------------------------------- 1. newsvendor */

export interface NewsvendorSpec {
  unitCost: number;
  price: number;
  salvage: number;
  demand: DiscreteOutcome[];
  /** Hard cap on the order, if any. */
  maxOrder?: number;
}

/** The underage / overage costs and the critical fractile they imply. */
export function newsvendorFractile(spec: NewsvendorSpec): { underage: number; overage: number; fractile: number } {
  const underage = spec.price - spec.unitCost;
  const overage = spec.unitCost - spec.salvage;
  if (underage <= 0) {
    throw new EngineError(
      `The selling price ${spec.price} does not exceed the unit cost ${spec.unitCost}, so every unit loses money and the optimal order is 0. There is no newsvendor trade-off to solve.`,
      'range',
    );
  }
  if (overage <= 0) {
    throw new EngineError(
      `The salvage value ${spec.salvage} is not below the unit cost ${spec.unitCost}, so unsold units cost nothing and the optimal order is unbounded above. There is no newsvendor trade-off to solve.`,
      'range',
    );
  }
  return { underage, overage, fractile: underage / (underage + overage) };
}

/**
 * The newsvendor as a two-stage programme. First stage: order x. Second stage,
 * once demand is known: sell what you can, salvage the rest.
 */
export function newsvendorTwoStage(spec: NewsvendorSpec): TwoStageProblem {
  checkOutcomes(spec.demand, 'newsvendor demand');
  newsvendorFractile(spec);
  const maxDemand = Math.max(...spec.demand.map((d) => d.value));
  const cap = spec.maxOrder ?? maxDemand;
  const scenarios: Scenario[] = spec.demand.map((d, i) => ({
    name: `demand ${d.value}`,
    probability: d.probability,
    rows: [
      { T: [0], W: [1, 0], sense: '<=', rhs: d.value, name: `sales cannot exceed demand (${i + 1})` },
      { T: [-1], W: [1, 1], sense: '=', rhs: 0, name: `every unit ordered is sold or salvaged (${i + 1})` },
    ],
  }));
  return {
    name: 'Newsvendor',
    c: [spec.unitCost],
    firstStageNames: ['order quantity'],
    firstStageRows: [],
    lower: [0],
    upper: [cap],
    q: [-spec.price, -spec.salvage],
    secondStageNames: ['units sold', 'units salvaged'],
    scenarios,
  };
}

/* ----------------------------------------------- 2. capacity expansion */

export interface CapacitySpec {
  technologies: { name: string; capitalCost: number; operatingCost: number; maxCapacity?: number }[];
  /** Penalty per unit of demand not served. */
  shortagePenalty: number;
  demand: DiscreteOutcome[];
}

export function capacityExpansion(spec: CapacitySpec): TwoStageProblem {
  checkOutcomes(spec.demand, 'capacity demand');
  const n = spec.technologies.length;
  if (n === 0) throw new EngineError('Capacity expansion needs at least one technology to build.', 'empty');
  const scenarios: Scenario[] = spec.demand.map((d) => {
    const rows: ScenarioRow[] = [];
    for (let i = 0; i < n; i++) {
      const T = new Array<number>(n).fill(0);
      const W = new Array<number>(n + 1).fill(0);
      T[i] = -1;
      W[i] = 1;
      rows.push({ T, W, sense: '<=', rhs: 0, name: `${spec.technologies[i].name} output within built capacity` });
    }
    const W = new Array<number>(n + 1).fill(1);
    rows.push({ T: new Array<number>(n).fill(0), W, sense: '>=', rhs: d.value, name: 'demand served or recorded as shortage' });
    return { name: `demand ${d.value}`, probability: d.probability, rows };
  });
  return {
    name: 'Capacity expansion under uncertain demand',
    c: spec.technologies.map((t) => t.capitalCost),
    firstStageNames: spec.technologies.map((t) => `${t.name} capacity`),
    firstStageRows: [],
    lower: new Array<number>(n).fill(0),
    upper: spec.technologies.map((t) => t.maxCapacity ?? Infinity),
    q: [...spec.technologies.map((t) => t.operatingCost), spec.shortagePenalty],
    secondStageNames: [...spec.technologies.map((t) => `${t.name} output`), 'unserved demand'],
    scenarios,
  };
}

/* -------------------------------------------------- 3. production mix */

export interface ProductionMixSpec {
  /** One entry per product: what it costs to plant/charge an input unit, and what it sells for. */
  products: { name: string; inputCost: number; price: number; buyInPrice: number; requirement: number }[];
  /** Total input resource available in the first stage. */
  resource: number;
  /** Yield multiplier per product, per scenario. */
  yields: { name: string; probability: number; factors: number[] }[];
}

/**
 * Plant now, harvest later: the first stage allocates a scarce input across
 * products, the realised yield is uncertain, and any shortfall against a firm
 * requirement must be bought in at a premium. The classic farmer's problem.
 */
export function productionMix(spec: ProductionMixSpec): TwoStageProblem {
  const n = spec.products.length;
  if (n === 0) throw new EngineError('A production-mix problem needs at least one product.', 'empty');
  if (!(spec.resource > 0)) throw new EngineError(`The input resource is ${spec.resource}; it must be positive or there is nothing to allocate.`, 'range');
  checkOutcomes(spec.yields.map((y) => ({ value: y.probability, probability: y.probability })), 'production yields');
  for (const y of spec.yields) {
    if (y.factors.length !== n) throw new EngineError(`Yield scenario "${y.name}" gives ${y.factors.length} factors but there are ${n} products.`, 'shape');
    for (const f of y.factors) if (!(f >= 0)) throw new EngineError(`Yield scenario "${y.name}" contains a negative yield factor ${f}.`, 'range');
  }
  // Second-stage variables: sold_j (n) then boughtIn_j (n).
  const scenarios: Scenario[] = spec.yields.map((y) => {
    const rows: ScenarioRow[] = [];
    for (let j = 0; j < n; j++) {
      const T = new Array<number>(n).fill(0);
      const W = new Array<number>(2 * n).fill(0);
      T[j] = -y.factors[j];
      W[j] = 1;
      rows.push({ T, W, sense: '<=', rhs: 0, name: `${spec.products[j].name}: cannot sell more than harvested` });
    }
    for (let j = 0; j < n; j++) {
      const W = new Array<number>(2 * n).fill(0);
      W[j] = 1;
      W[n + j] = 1;
      rows.push({ T: new Array<number>(n).fill(0), W, sense: '>=', rhs: spec.products[j].requirement, name: `${spec.products[j].name}: requirement met from harvest or purchase` });
    }
    return { name: y.name, probability: y.probability, rows };
  });
  const firstStageRows: LpRow[] = [
    { coef: new Array<number>(n).fill(1), sense: '<=', rhs: spec.resource, name: 'input resource' },
  ];
  return {
    name: 'Production mix with uncertain yields',
    c: spec.products.map((p) => p.inputCost),
    firstStageNames: spec.products.map((p) => `${p.name} input`),
    firstStageRows,
    q: [...spec.products.map((p) => -p.price), ...spec.products.map((p) => p.buyInPrice)],
    secondStageNames: [...spec.products.map((p) => `${p.name} sold`), ...spec.products.map((p) => `${p.name} bought in`)],
    scenarios,
  };
}

/* ------------------------------------------- 4. transportation network */

export interface TransportSpec {
  depots: { name: string; stockingCost: number; capacity?: number }[];
  customers: { name: string; shortagePenalty: number }[];
  /** transportCost[depot][customer]. */
  transportCost: number[][];
  /** One scenario per demand vector over customers. */
  demandScenarios: { name: string; probability: number; demand: number[] }[];
}

export function transportationNetwork(spec: TransportSpec): TwoStageProblem {
  const nd = spec.depots.length;
  const nc = spec.customers.length;
  if (nd === 0 || nc === 0) throw new EngineError('A transportation problem needs at least one depot and one customer.', 'empty');
  if (spec.transportCost.length !== nd) throw new EngineError(`The transport-cost matrix has ${spec.transportCost.length} rows but there are ${nd} depots.`, 'shape');
  for (const row of spec.transportCost) {
    if (row.length !== nc) throw new EngineError(`A transport-cost row has ${row.length} entries but there are ${nc} customers.`, 'shape');
  }
  // Second stage: flows y[d][c] (nd*nc) then unmet[c] (nc).
  const n2 = nd * nc + nc;
  const flow = (d: number, c: number): number => d * nc + c;
  const scenarios: Scenario[] = spec.demandScenarios.map((s) => {
    if (s.demand.length !== nc) throw new EngineError(`Scenario "${s.name}" gives ${s.demand.length} demands but there are ${nc} customers.`, 'shape');
    const rows: ScenarioRow[] = [];
    for (let d = 0; d < nd; d++) {
      const T = new Array<number>(nd).fill(0);
      const W = new Array<number>(n2).fill(0);
      T[d] = -1;
      for (let c = 0; c < nc; c++) W[flow(d, c)] = 1;
      rows.push({ T, W, sense: '<=', rhs: 0, name: `${spec.depots[d].name}: outflow within stock` });
    }
    for (let c = 0; c < nc; c++) {
      const W = new Array<number>(n2).fill(0);
      for (let d = 0; d < nd; d++) W[flow(d, c)] = 1;
      W[nd * nc + c] = 1;
      rows.push({ T: new Array<number>(nd).fill(0), W, sense: '>=', rhs: s.demand[c], name: `${spec.customers[c].name}: demand met or short` });
    }
    return { name: s.name, probability: s.probability, rows };
  });
  const q = new Array<number>(n2).fill(0);
  for (let d = 0; d < nd; d++) for (let c = 0; c < nc; c++) q[flow(d, c)] = spec.transportCost[d][c];
  for (let c = 0; c < nc; c++) q[nd * nc + c] = spec.customers[c].shortagePenalty;
  const names: string[] = [];
  for (let d = 0; d < nd; d++) for (let c = 0; c < nc; c++) names.push(`${spec.depots[d].name}→${spec.customers[c].name}`);
  for (let c = 0; c < nc; c++) names.push(`${spec.customers[c].name} unmet`);
  return {
    name: 'Network flow with uncertain demand',
    c: spec.depots.map((d) => d.stockingCost),
    firstStageNames: spec.depots.map((d) => `${d.name} stock`),
    firstStageRows: [],
    lower: new Array<number>(nd).fill(0),
    upper: spec.depots.map((d) => d.capacity ?? Infinity),
    q,
    secondStageNames: names,
    scenarios,
  };
}

/* ------------------------------------------------ 5. project selection */

export interface ProjectSelectionSpec {
  projects: { name: string; cost: number; value: number }[];
  budget: number;
  /** Cost overrun multiplier per scenario, applied to every selected project. */
  overrunScenarios: { name: string; probability: number; multiplier: number }[];
  /** Cost per unit of budget overrun covered after the fact. */
  overrunPenalty: number;
}

/**
 * Project selection under a budget, as the LP relaxation of the knapsack so the
 * two-stage machinery applies. The integral problem is handled by the
 * combinatorial heuristics; the relaxation's value is a valid bound on it, and
 * the relaxation is what is returned here — which is said rather than implied.
 */
export function projectSelection(spec: ProjectSelectionSpec): TwoStageProblem {
  const n = spec.projects.length;
  if (n === 0) throw new EngineError('Project selection needs at least one project.', 'empty');
  if (!(spec.budget > 0)) throw new EngineError(`The budget is ${spec.budget}; it must be positive.`, 'range');
  const scenarios: Scenario[] = spec.overrunScenarios.map((s) => {
    const T = spec.projects.map((p) => s.multiplier * p.cost);
    return {
      name: s.name,
      probability: s.probability,
      rows: [{ T, W: [-1], sense: '<=', rhs: spec.budget, name: 'realised spend within budget plus overrun cover' }],
    };
  });
  return {
    name: 'Project selection under a budget with uncertain costs',
    c: spec.projects.map((p) => -p.value),
    firstStageNames: spec.projects.map((p) => p.name),
    firstStageRows: [{ coef: spec.projects.map((p) => p.cost), sense: '<=', rhs: spec.budget, name: 'nominal budget' }],
    lower: new Array<number>(n).fill(0),
    upper: new Array<number>(n).fill(1),
    q: [spec.overrunPenalty],
    secondStageNames: ['budget overrun covered'],
    scenarios,
  };
}

/* ------------------------------------------------------- 6. staffing */

export interface StaffingSpec {
  periods: { name: string; wage: number; overtimeWage: number; serviceRate: number; overtimeFraction: number }[];
  /** Cost per unit of demand turned away. */
  abandonmentCost: number;
  /** arrivals[scenario][period]. */
  arrivalScenarios: { name: string; probability: number; arrivals: number[] }[];
}

export function staffing(spec: StaffingSpec): TwoStageProblem {
  const T = spec.periods.length;
  if (T === 0) throw new EngineError('A staffing problem needs at least one period.', 'empty');
  for (const p of spec.periods) {
    if (!(p.serviceRate > 0)) throw new EngineError(`Period "${p.name}" has service rate ${p.serviceRate}; each staff member must serve a positive amount.`, 'range');
  }
  // Second stage: overtime_t (T) then unserved_t (T).
  const n2 = 2 * T;
  const scenarios: Scenario[] = spec.arrivalScenarios.map((s) => {
    if (s.arrivals.length !== T) throw new EngineError(`Scenario "${s.name}" gives ${s.arrivals.length} arrival counts but there are ${T} periods.`, 'shape');
    const rows: ScenarioRow[] = [];
    for (let t = 0; t < T; t++) {
      const Tc = new Array<number>(T).fill(0);
      const W = new Array<number>(n2).fill(0);
      Tc[t] = spec.periods[t].serviceRate;
      W[t] = 1;
      W[T + t] = 1;
      rows.push({ T: Tc, W, sense: '>=', rhs: s.arrivals[t], name: `${spec.periods[t].name}: arrivals served, worked overtime, or abandoned` });
    }
    for (let t = 0; t < T; t++) {
      const Tc = new Array<number>(T).fill(0);
      const W = new Array<number>(n2).fill(0);
      Tc[t] = -spec.periods[t].overtimeFraction * spec.periods[t].serviceRate;
      W[t] = 1;
      rows.push({ T: Tc, W, sense: '<=', rhs: 0, name: `${spec.periods[t].name}: overtime capped by roster size` });
    }
    return { name: s.name, probability: s.probability, rows };
  });
  return {
    name: 'Staffing under uncertain arrivals',
    c: spec.periods.map((p) => p.wage),
    firstStageNames: spec.periods.map((p) => `${p.name} roster`),
    firstStageRows: [],
    q: [...spec.periods.map((p) => p.overtimeWage), ...spec.periods.map(() => spec.abandonmentCost)],
    secondStageNames: [...spec.periods.map((p) => `${p.name} overtime`), ...spec.periods.map((p) => `${p.name} abandoned`)],
    scenarios,
  };
}
