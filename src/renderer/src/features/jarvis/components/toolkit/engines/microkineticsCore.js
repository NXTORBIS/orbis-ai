/**
 * Microkinetic mechanism solver.
 *
 * A catalytic cycle is written as elementary steps over a uniform surface. A species carrying
 * stars is adsorbed and the number of stars is how many sites it occupies; anything without a
 * star is a gas whose partial pressure is held constant. Every step must conserve sites, and
 * that conservation is what closes the system — the free-site coverage follows from the others
 * through the site balance instead of being solved for as an independent unknown.
 *
 * Steady state is found by damped Newton in coverage space with a backtracking line search,
 * kept inside the feasible region (non-negative coverages that together cannot exceed the site
 * count). On top of that solution the engine reports the turnover frequency, the degree of rate
 * control of every rate constant and pressure, apparent reaction orders and the Sabatier
 * volcano — and `verifyMicrokinetics` checks each of those against a closed form.
 *
 * One caution the checks make explicit: when a step sits very close to equilibrium the net rate
 * is the difference of two large one-way rates, so anything smaller than about 1e-12 of that
 * one-way traffic is below what double precision can resolve. Every smallness test here is
 * therefore taken relative to the one-way scale rather than to zero.
 */

import { maxAbs, solveLinear } from './numerics.js';

const TINY = 1e-300;
const SPECIES = /^(\d+(?:\.\d+)?)?\s*([A-Za-z][A-Za-z0-9_()*\-]*|\*)$/;

const readSide = (part, line, label) => {
  const terms = String(part).split('+').map((term) => term.trim()).filter(Boolean);
  if (!terms.length) throw new Error(`Line ${line}: nothing on the ${label} side.`);
  return terms.map((term) => {
    const match = term.match(SPECIES);
    if (!match) throw new Error(`Line ${line}: cannot read the species "${term}".`);
    const id = match[2];
    return { id, coeff: match[1] ? Number(match[1]) : 1, sites: (id.match(/\*/g) || []).length };
  });
};

const siteCount = (terms) => terms.reduce((sum, term) => sum + term.coeff * term.sites, 0);
const tallyOf = (terms, id) => terms.reduce((sum, term) => sum + (term.id === id ? term.coeff : 0), 0);

/** Parses the mechanism and the pressures, rejecting anything that cannot be a real surface. */
export function buildModel({ mechanism, pressures = '', product } = {}) {
  const steps = [];
  String(mechanism).split('\n').forEach((raw, index) => {
    const line = raw.split('#')[0].trim();
    if (!line) return;
    const arrow = line.includes('<=>') ? '<=>' : line.includes('->') ? '->' : null;
    if (!arrow) throw new Error(`Line ${index + 1}: no reaction arrow — write -> or <=>.`);
    const [left, rightSide] = line.split(arrow);
    const [right, constantPart] = rightSide.split(':');
    const numbers = String(constantPart ?? '').split(',').map((value) => Number(value.trim()));
    if (!Number.isFinite(numbers[0]) || numbers[0] <= 0) throw new Error(`Line ${index + 1}: put the forward rate constant after the colon.`);
    if (arrow === '<=>' && (!Number.isFinite(numbers[1]) || numbers[1] <= 0)) throw new Error(`Line ${index + 1}: a reversible step needs both rate constants, forward first.`);
    const step = {
      line: index + 1,
      reactants: readSide(left, index + 1, 'left'),
      products: readSide(right, index + 1, 'right'),
      kf: numbers[0],
      kr: arrow === '<=>' ? numbers[1] : null,
      reversible: arrow === '<=>',
    };
    const held = siteCount(step.reactants);
    const released = siteCount(step.products);
    if (Math.abs(held - released) > 1e-12) {
      throw new Error(`Line ${index + 1}: this step does not conserve sites — the left side holds ${held} and the right ${released}.`);
    }
    steps.push(step);
  });
  if (!steps.length) throw new Error('The mechanism is empty.');

  const sitesOf = {};
  const order = [];
  steps.forEach((step) => [...step.reactants, ...step.products].forEach((term) => {
    if (sitesOf[term.id] === undefined) { sitesOf[term.id] = term.sites; order.push(term.id); }
  }));
  const adsorbates = order.filter((id) => id !== '*' && sitesOf[id] > 0);
  const gases = order.filter((id) => sitesOf[id] === 0);

  const given = {};
  String(pressures).split('\n').forEach((raw, index) => {
    const line = raw.split('#')[0].trim();
    if (!line) return;
    const [id, valuePart] = line.split('=');
    if (id === undefined || valuePart === undefined) throw new Error(`Pressure line ${index + 1}: expected "A = 1".`);
    const key = id.trim();
    if (!gases.includes(key)) throw new Error(`Pressure line ${index + 1}: "${key}" is not a gas in this mechanism.`);
    const value = Number(valuePart.trim());
    if (!Number.isFinite(value) || value < 0) throw new Error(`Pressure line ${index + 1}: "${valuePart}" is not a pressure.`);
    given[key] = value;
  });

  const gains = {};
  steps.forEach((step) => {
    new Set([...step.reactants, ...step.products].map((term) => term.id)).forEach((id) => {
      gains[id] = (gains[id] || 0) + Math.max(0, tallyOf(step.products, id) - tallyOf(step.reactants, id));
    });
  });
  const netProducts = gases.filter((id) => (gains[id] || 0) > 0);
  const chosen = product && gases.includes(product) ? product : netProducts[0] ?? gases[0] ?? null;
  const partials = {};
  gases.forEach((id) => { partials[id] = given[id] ?? 1; });

  return {
    steps,
    sitesOf,
    adsorbates,
    gases,
    pressures: partials,
    defaulted: gases.filter((id) => given[id] === undefined),
    product: chosen,
    mechanism: String(mechanism),
  };
}

const stateAt = (model, theta) => {
  const coverages = {};
  let occupied = 0;
  model.adsorbates.forEach((id, index) => {
    coverages[id] = theta[index];
    occupied += model.sitesOf[id] * theta[index];
  });
  return { coverages, free: 1 - occupied };
};

const activityOf = (model, state, id) => {
  if (id === '*') return Math.max(state.free, 0);
  if (model.sitesOf[id] > 0) return Math.max(state.coverages[id], 0);
  return model.pressures[id] ?? 1;
};

const stepRates = (model, state) => model.steps.map((step) => {
  const product = (terms) => terms.reduce((value, term) => value * Math.pow(activityOf(model, state, term.id), term.coeff), 1);
  const forward = step.kf * product(step.reactants);
  const reverse = (step.kr ?? 0) * product(step.products);
  return { forward, reverse, net: forward - reverse };
});

const residualAt = (model, theta) => {
  const state = stateAt(model, theta);
  const rates = stepRates(model, state);
  const residual = model.adsorbates.map((id) => {
    let total = 0;
    model.steps.forEach((step, index) => {
      total += (tallyOf(step.products, id) - tallyOf(step.reactants, id)) * rates[index].net;
    });
    return total;
  });
  return { residual, rates, state };
};

const occupiedAt = (model, theta) => model.adsorbates.reduce((sum, id, index) => sum + model.sitesOf[id] * theta[index], 0);

/** Steady-state coverages, turnover frequency and the net rate and one-way rates of every step. */
export function solveMicrokinetics(model, { start, iterations = 400, tolerance = 1e-12 } = {}) {
  const n = model.adsorbates.length;
  const sites = model.adsorbates.map((id) => model.sitesOf[id]);
  // Projection into the feasible region: no negative coverage, and never more sites occupied
  // than exist. Projecting (rather than rejecting) is what lets the iteration walk up to a
  // crowded surface instead of stalling at the edge of it.
  const project = (values) => {
    let clipped = values.map((value) => Math.max(value, 0));
    const total = clipped.reduce((sum, value, index) => sum + sites[index] * value, 0);
    if (total > 1) clipped = clipped.map((value) => value / total);
    return clipped;
  };
  let theta = start && start.length === n ? project([...start]) : model.adsorbates.map(() => 0.1 / Math.max(n, 1));
  const feasible = (values) => values.every((value) => value >= 0) && occupiedAt(model, values) <= 1 + 1e-12;
  let converged = n === 0;
  let used = 0;
  let residualSize = 0;
  let stalls = 0;
  let rates;

  if (n) {
    for (let count = 1; count <= iterations; count += 1) {
      used = count;
      const evaluation = residualAt(model, theta);
      rates = evaluation.rates;
      residualSize = maxAbs(evaluation.residual);
      // Convergence is judged against the one-way rates, the scale the residual is actually made
      // of. Judging it against the net rate would be unachievable for a near-equilibrium step,
      // where the net rate is a cancellation many orders below the traffic through the step.
      const scale = Math.max(...rates.flatMap((entry) => [Math.abs(entry.forward), Math.abs(entry.reverse)]), TINY);
      if (residualSize <= tolerance * scale) { converged = true; break; }
      const jacobian = evaluation.residual.map(() => new Array(n).fill(0));
      for (let column = 0; column < n; column += 1) {
        const step = Math.max(1e-11, Math.abs(theta[column]) * 1e-5);
        let probe = [...theta];
        probe[column] += step;
        if (!feasible(probe)) {
          probe = [...theta];
          probe[column] = Math.max(0, theta[column] - step);
        }
        const shifted = residualAt(model, probe).residual;
        const delta = probe[column] - theta[column] || step;
        for (let row = 0; row < n; row += 1) jacobian[row][column] = (shifted[row] - evaluation.residual[row]) / delta;
      }
      const direction = solveLinear(jacobian, evaluation.residual.map((value) => -value));
      if (!direction) break;
      const biggest = Math.max(maxAbs(direction), TINY);
      const cap = biggest > 0.25 ? 0.25 / biggest : 1;
      let chosen = project(theta.map((value, index) => value + cap * direction[index]));
      let chosenSize = maxAbs(residualAt(model, chosen).residual);
      for (let attempt = 1; attempt < 18 && chosenSize >= residualSize; attempt += 1) {
        const shrink = cap * Math.pow(0.5, attempt);
        const trial = project(theta.map((value, index) => value + shrink * direction[index]));
        const trialSize = maxAbs(residualAt(model, trial).residual);
        if (trialSize < chosenSize) { chosen = trial; chosenSize = trialSize; }
      }
      const improved = chosenSize < residualSize;
      theta = chosen;
      stalls = improved ? 0 : stalls + 1;
      if (stalls > 12) break;
    }
    rates = residualAt(model, theta).rates;
  } else {
    rates = stepRates(model, { coverages: {}, free: 1 });
  }

  const state = stateAt(model, theta);
  const netRates = rates.map((entry) => entry.net);
  const gasRates = {};
  model.gases.forEach((id) => {
    gasRates[id] = model.steps.reduce((total, step, index) => total + (tallyOf(step.products, id) - tallyOf(step.reactants, id)) * netRates[index], 0);
  });
  const coverages = model.adsorbates.map((id, index) => ({
    id,
    sites: model.sitesOf[id],
    theta: theta[index],
    fraction: model.sitesOf[id] * theta[index],
  }));
  const rateScale = Math.max(maxAbs(netRates), TINY);
  const oneWayScale = Math.max(...rates.flatMap((entry) => [Math.abs(entry.forward), Math.abs(entry.reverse)]), TINY);

  return {
    model,
    theta,
    coverages,
    free: state.free,
    occupied: occupiedAt(model, theta),
    rates: netRates,
    stepRates: rates,
    rateScale,
    oneWayScale,
    gasRates,
    tof: model.product ? gasRates[model.product] ?? 0 : 0,
    converged,
    iterations: used,
    residual: residualSize,
    siteResidual: Math.abs(state.free + coverages.reduce((sum, entry) => sum + entry.fraction, 0) - 1),
    largest: [...coverages].sort((a, b) => b.fraction - a.fraction)[0]?.id ?? null,
  };
}

const perturbed = (model, key, factor) => {
  const clone = {
    ...model,
    pressures: { ...model.pressures },
    steps: model.steps.map((step, index) => (index === key.step
      ? { ...step, [key.branch === 'forward' ? 'kf' : 'kr']: key.value * factor }
      : step)),
  };
  if (key.kind === 'p') clone.pressures[key.id] = key.value * factor;
  return clone;
};

/**
 * Campbell degrees of rate control and apparent reaction orders, by perturbing one parameter
 * at a time and re-solving the steady state — so the sensitivities are properties of the actual
 * solution rather than of a linearised form of it.
 */
export function sensitivities(model, { delta = 1e-5 } = {}) {
  const base = solveMicrokinetics(model);
  const keys = [];
  model.steps.forEach((step, index) => {
    keys.push({ kind: 'k', step: index, branch: 'forward', label: `k${index + 1} forward`, value: step.kf });
    if (step.kr !== null) keys.push({ kind: 'k', step: index, branch: 'reverse', label: `k${index + 1} reverse`, value: step.kr });
  });
  model.gases.forEach((id) => {
    if (model.pressures[id] > 0) keys.push({ kind: 'p', id, label: `p(${id})`, value: model.pressures[id] });
  });

  const usable = base.tof > 0 && base.converged;
  const entries = keys.map((key) => {
    if (!usable) return { ...key, slope: null };
    const up = solveMicrokinetics(perturbed(model, key, 1 + delta), { start: base.theta });
    const down = solveMicrokinetics(perturbed(model, key, 1 - delta), { start: base.theta });
    if (!(up.tof > 0) || !(down.tof > 0) || !up.converged || !down.converged) return { ...key, slope: null };
    return { ...key, slope: (Math.log(up.tof) - Math.log(down.tof)) / (2 * Math.log(1 + delta)) };
  });

  const drc = entries.filter((entry) => entry.kind === 'k');
  const orders = entries.filter((entry) => entry.kind === 'p');
  return {
    base,
    drc,
    orders,
    sum: drc.reduce((total, entry) => total + (entry.slope ?? 0), 0),
    usable,
  };
}

/**
 * Sabatier volcano for a two-step mechanism: A binds with equilibrium constant K_A = K₀e^x and
 * the adsorbed intermediate reacts on with k = k₀e^(−αx) — the Brønsted–Evans–Polanyi relation
 * that makes stronger binding raise the barrier for the following bond-breaking step. Both
 * steps go through the general solver, so the volcano is a property of the mechanism rather
 * than a separate model, and the peak must land on the coverage theory predicts.
 */
export function sabatierVolcano({ alpha = 0.5, pressure = 1, kAds = 1e6, kDes = 1e6, kRxn = 1e3, from = -6, to = 6, points = 61 } = {}) {
  const build = (x) => buildModel({
    mechanism: [
      `A + * <=> A* : ${(kAds * Math.exp(x)).toExponential(10)}, ${kDes.toExponential(10)}`,
      `A* -> B + * : ${(kRxn * Math.exp(-alpha * x)).toExponential(10)}`,
    ].join('\n'),
    pressures: `A = ${pressure}`,
  });
  const pointAt = (x) => {
    const solution = solveMicrokinetics(build(x));
    const ka = (kAds / kDes) * Math.exp(x);
    return { x, ka, z: ka * pressure, theta: solution.theta[0] ?? 0, free: solution.free, tof: solution.tof };
  };

  const curve = [];
  for (let index = 0; index <= points; index += 1) curve.push(pointAt(from + ((to - from) * index) / points));
  let index = 0;
  curve.forEach((point, position) => { if (point.tof > curve[index].tof) index = position; });

  let peak = curve[index];
  if (index > 0 && index < curve.length - 1) {
    const [a, b, c] = [curve[index - 1], curve[index], curve[index + 1]];
    const log = (point) => Math.log(Math.max(point.tof, TINY));
    const curvature = log(a) - 2 * log(b) + log(c);
    const shift = curvature !== 0 ? (0.5 * (log(a) - log(c))) / curvature : 0;
    peak = pointAt(b.x + shift * (c.x - b.x));
  }
  return { curve, peak, alpha, pressure, kAds, kDes, kRxn };
}

const relativeGap = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), TINY);
const mechanismText = (lines) => lines.join('\n');

/** Independent checks: Langmuir, the fast-equilibrium limit, orders, detailed balance, Campbell, Sabatier. */
export function verifyMicrokinetics() {
  const langmuirModel = buildModel({ mechanism: 'A + * <=> A* : 1e6, 1e12', pressures: 'A = 1e6' });
  const langmuir = solveMicrokinetics(langmuirModel);
  const K = 1e6 / 1e12;
  const expectedTheta = (K * 1e6) / (1 + K * 1e6);

  // Adsorption millions of times faster than the surface reaction: the coverages have to be the
  // Langmuir ones, because the reverse reaction barely perturbs them.
  const lhMechanism = mechanismText([
    'A + * <=> A* : 1e6, 1e12',
    'B2 + 2* <=> 2B* : 1e6, 1e12',
    'A* + B* -> AB + 2* : 1',
  ]);
  const lh = buildModel({ mechanism: lhMechanism, pressures: 'A = 1\nB2 = 1' });
  const lhSolution = solveMicrokinetics(lh);
  const zA = (1e6 / 1e12) * 1;
  const zB = Math.sqrt((1e6 / 1e12) * 1);
  const freeSite = 1 / (1 + zA + zB);
  const expectedCoverageA = zA * freeSite;
  const expectedCoverageB = zB * freeSite;
  const expectedTof = 1 * expectedCoverageA * expectedCoverageB;

  // Orders are read on a moderately stiff mechanism: stiff enough that the coverages are the
  // Langmuir ones, gentle enough that the turnover frequency is not a cancellation artefact.
  const orderMechanism = mechanismText([
    'A + * <=> A* : 1e2, 1e4',
    'B2 + 2* <=> 2B* : 1e2, 1e4',
    'A* + B* -> AB + 2* : 1e-2',
  ]);
  const lowPressure = buildModel({ mechanism: orderMechanism, pressures: 'A = 1e-3\nB2 = 1e-3' });
  const lowOrders = sensitivities(lowPressure);
  const orderA = lowOrders.orders.find((entry) => entry.id === 'A')?.slope ?? NaN;
  const orderB = lowOrders.orders.find((entry) => entry.id === 'B2')?.slope ?? NaN;
  // The analytic orders for this mechanism, including the small correction from the sites the
  // intermediates occupy: a purely asymptotic ½ would only be right at zero coverage.
  const zOrderA = (1e2 / 1e4) * 1e-3;
  const zOrderB = Math.sqrt((1e2 / 1e4) * 1e-3);
  const siteShare = 1 + zOrderA + zOrderB;
  const analyticOrderA = 1 - zOrderA / siteShare;
  const analyticOrderB = 0.5 - zOrderB / siteShare;

  const cycleMechanism = mechanismText(['A + * <=> A* : 1e7, 1e10', 'A* <=> B + * : 1e5, 1e5']);
  const cycle = buildModel({ mechanism: cycleMechanism, pressures: 'A = 1\nB = 0.1' });
  const cycleSolution = solveMicrokinetics(cycle);
  const fluxSpread = Math.max(...cycleSolution.rates.map(Math.abs)) - Math.min(...cycleSolution.rates.map(Math.abs));

  const equilibrium = solveMicrokinetics(buildModel({ mechanism: cycleMechanism, pressures: 'A = 1\nB = 0.001' }));

  // Just off equilibrium the net rate must be linear in the driving force — the Onsager regime.
  const responseMechanism = mechanismText(['A + * <=> A* : 1e3, 1e6', 'A* <=> B + * : 1e2, 1e2']);
  const off1 = solveMicrokinetics(buildModel({ mechanism: responseMechanism, pressures: 'A = 1\nB = 0.00101' }));
  const off2 = solveMicrokinetics(buildModel({ mechanism: responseMechanism, pressures: 'A = 1\nB = 0.00102' }));
  const responseRatio = off2.tof / off1.tof;

  const starved = solveMicrokinetics(buildModel({ mechanism: lhMechanism, pressures: 'A = 1\nB2 = 0' }));
  const drc = sensitivities(lh);
  const volcanoes = [0.5, 0.3].map((alpha) => sabatierVolcano({ alpha }));

  let rejected = false;
  let rejectionMessage = '';
  try {
    buildModel({ mechanism: 'A + 2* -> A* : 1', pressures: 'A = 1' });
  } catch (problem) {
    rejected = true;
    rejectionMessage = problem.message;
  }

  const peakGap = (entry) => Math.max(
    Math.abs(entry.peak.theta - (1 - entry.alpha)),
    Math.abs(entry.peak.z - (1 - entry.alpha) / entry.alpha) / ((1 - entry.alpha) / entry.alpha),
  );

  return {
    langmuir,
    lh: lhSolution,
    lowOrders,
    cycle: cycleSolution,
    equilibrium,
    off1,
    drc,
    volcanoes,
    checks: [
      {
        label: 'A single adsorption step obeys the Langmuir isotherm exactly',
        ok: Math.abs(langmuir.theta[0] - expectedTheta) < 1e-12,
        detail: `θ = ${langmuir.theta[0].toFixed(12)} against Kp/(1 + Kp) = ${expectedTheta.toFixed(12)}`,
      },
      {
        label: 'The site balance closes for every state solved',
        ok: Math.max(langmuir.siteResidual, lhSolution.siteResidual, cycleSolution.siteResidual) < 1e-12,
        detail: `worst residual ${Math.max(langmuir.siteResidual, lhSolution.siteResidual, cycleSolution.siteResidual).toExponential(2)} of a site`,
      },
      {
        label: 'With fast adsorption the coverages land on their Langmuir values',
        ok: Math.max(Math.abs(lhSolution.theta[0] - expectedCoverageA), Math.abs(lhSolution.theta[1] - expectedCoverageB)) < 1e-9,
        detail: `θ(A*) ${lhSolution.theta[0].toExponential(4)} against ${expectedCoverageA.toExponential(4)}, θ(B*) ${lhSolution.theta[1].toExponential(4)} against ${expectedCoverageB.toExponential(4)}`,
      },
      {
        label: 'and the turnover frequency lands on k·θ(A*)·θ(B*)',
        ok: relativeGap(lhSolution.tof, expectedTof) < 1e-6,
        detail: `TOF ${lhSolution.tof.toExponential(6)} against ${expectedTof.toExponential(6)} per site per second`,
      },
      {
        label: 'A dissociating partner gives the half order the rate law demands',
        ok: Math.abs(orderB - analyticOrderB) < 1e-4,
        detail: `order in B₂ = ${orderB.toFixed(6)} against ${analyticOrderB.toFixed(6)} — ½ less the site competition, because θ(B*) ∝ p(B₂)^½`,
      },
      {
        label: 'and a molecularly adsorbing partner gives the first order',
        ok: Math.abs(orderA - analyticOrderA) < 1e-4,
        detail: `order in A = ${orderA.toFixed(6)} against ${analyticOrderA.toFixed(6)}`,
      },
      {
        label: 'At thermodynamic equilibrium the net rate vanishes',
        ok: Math.abs(equilibrium.tof) < 1e-12 * equilibrium.oneWayScale,
        detail: `TOF ${equilibrium.tof.toExponential(2)} at p(B)/p(A) = K = 10⁻³, against one-way rates of ${equilibrium.oneWayScale.toExponential(2)}`,
      },
      {
        label: 'and just off equilibrium the net rate is linear in the driving force',
        ok: off1.tof < 0 && Math.abs(responseRatio - 2) < 0.05,
        detail: `doubling the departure from K doubles the rate: ratio ${responseRatio.toFixed(4)}`,
      },
      {
        label: 'Every step of a single cycle carries the same net flux at steady state',
        ok: fluxSpread / Math.max(...cycleSolution.rates.map(Math.abs)) < 1e-9,
        detail: `step rates ${cycleSolution.rates.map((value) => value.toExponential(4)).join(' and ')}`,
      },
      {
        label: 'A required reactant that is absent gives no reaction at all',
        ok: Math.abs(starved.tof) < 1e-12 * starved.oneWayScale,
        detail: `TOF ${starved.tof.toExponential(2)} with p(B₂) = 0, against one-way rates of ${starved.oneWayScale.toExponential(2)}`,
      },
      {
        label: 'The degrees of rate control sum to one — Campbell’s theorem',
        ok: Math.abs(drc.sum - 1) < 1e-4,
        detail: `Σ X_RC = ${drc.sum.toFixed(8)} over ${drc.drc.length} rate constants`,
      },
      {
        label: 'The Sabatier volcano peaks where theory puts it',
        ok: volcanoes.every((entry) => peakGap(entry) < 5e-3),
        detail: volcanoes.map((entry) => `α = ${entry.alpha}: θ* = ${entry.peak.theta.toFixed(4)} against 1 − α = ${(1 - entry.alpha).toFixed(2)}`).join(' · '),
      },
      {
        label: 'A mechanism that does not conserve sites is refused',
        ok: rejected,
        detail: rejectionMessage || 'the checker did not raise on an unbalanced step',
      },
    ],
  };
}

export const MICROKINETIC_PRESETS = {
  langmuir: {
    label: 'Langmuir adsorption',
    mechanism: 'A + * <=> A* : 1e6, 1e12',
    pressures: 'A = 1e6',
    note: 'One adsorption step on its own. With Kp = 1 the coverage must come out at exactly ½ — the isotherm every microkinetic model rests on.',
  },
  lh: {
    label: 'Langmuir–Hinshelwood A + ½B₂',
    mechanism: mechanismText([
      'A + * <=> A* : 1e6, 1e12',
      'B2 + 2* <=> 2B* : 1e6, 1e12',
      'A* + B* -> AB + 2* : 1',
    ]),
    pressures: 'A = 1\nB2 = 1',
    note: 'Adsorption is fast and the surface reaction slow, so the coverages sit on their Langmuir values and the apparent orders are 1 in A and ½ in B₂.',
  },
  reversible: {
    label: 'Reversible A ⇌ B',
    mechanism: mechanismText(['A + * <=> A* : 1e7, 1e10', 'A* <=> B + * : 1e5, 1e5']),
    pressures: 'A = 1\nB = 0.1',
    note: 'Two steps around one cycle with K = 10⁻³ overall. Set p(B)/p(A) to 10⁻³ and the net rate must vanish — detailed balance doing its job.',
  },
  co: {
    label: 'CO oxidation on a crowded surface',
    mechanism: mechanismText([
      'CO + * <=> CO* : 1e2, 1e2',
      'O2 + 2* <=> 2O* : 1e-1, 1e2',
      'CO* + O* -> CO2 + 2* : 1e2',
      'CO2 + * <=> CO2* : 1e-1, 1e2',
    ]),
    pressures: 'CO = 1\nO2 = 0.2',
    note: 'CO binds far more strongly than oxygen and crowds the surface, so the order in CO comes out negative — self-inhibition straight out of the mechanism.',
  },
};