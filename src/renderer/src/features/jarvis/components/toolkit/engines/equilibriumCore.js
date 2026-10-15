/**
 * Chemical equilibrium engine — multi-equilibrium speciation from mass balances.
 *
 * Every species is written as a formation reaction from the components of the system, with a
 * cumulative constant: a species with composition {H: 1, Ac: 1} and logK 4.76 is HAc formed
 * from H⁺ and Ac⁻. Negative stoichiometry covers water, where OH⁻ is {H: −1} with logK −14.
 *
 * The unknowns are the logarithms of the free component concentrations, which is what makes the
 * system well conditioned: one mass balance for each component, and — in place of a mass balance
 * for H⁺, which is not knowable — the charge balance, Σ zᵢ cᵢ = 0. That is the standard
 * formulation, solved by damped Newton with a numerical Jacobian and, if Newton stalls, a coarse
 * pH scan to place the first guess before refining.
 */

export const KW = 1e-14;

/** logK is relative to the component master species, so acids use their pKa directly. */
export const SYSTEMS = {
  water: {
    name: 'Pure water',
    components: [{ id: 'H', label: 'H⁺', master: 'H+', charge: 1 }],
    species: [
      { id: 'H+', label: 'H⁺', comp: { H: 1 }, charge: 1, logK: 0 },
      { id: 'OH-', label: 'OH⁻', comp: { H: -1 }, charge: -1, logK: -14 },
    ],
    totals: {},
  },
  strongAcid: {
    name: 'Strong acid (HCl)',
    components: [{ id: 'H', label: 'H⁺', master: 'H+', charge: 1 }, { id: 'Cl', label: 'Cl⁻', master: 'Cl-', charge: -1 }],
    species: [
      { id: 'H+', label: 'H⁺', comp: { H: 1 }, charge: 1, logK: 0 },
      { id: 'OH-', label: 'OH⁻', comp: { H: -1 }, charge: -1, logK: -14 },
      { id: 'Cl-', label: 'Cl⁻', comp: { Cl: 1 }, charge: -1, logK: 0 },
      { id: 'HCl', label: 'HCl', comp: { H: 1, Cl: 1 }, charge: 0, logK: -6 },
    ],
    totals: { Cl: 0.01 },
  },
  acetic: {
    name: 'Acetic acid',
    components: [{ id: 'H', label: 'H⁺', master: 'H+', charge: 1 }, { id: 'Ac', label: 'Acetate', master: 'Ac-', charge: -1 }],
    species: [
      { id: 'H+', label: 'H⁺', comp: { H: 1 }, charge: 1, logK: 0 },
      { id: 'OH-', label: 'OH⁻', comp: { H: -1 }, charge: -1, logK: -14 },
      { id: 'Ac-', label: 'Ac⁻', comp: { Ac: 1 }, charge: -1, logK: 0 },
      { id: 'HAc', label: 'HAc', comp: { H: 1, Ac: 1 }, charge: 0, logK: 4.76 },
    ],
    totals: { Ac: 0.1 },
  },
  carbonate: {
    name: 'Carbonate system',
    components: [{ id: 'H', label: 'H⁺', master: 'H+', charge: 1 }, { id: 'C', label: 'Carbonate', master: 'CO3--', charge: -2 }],
    species: [
      { id: 'H+', label: 'H⁺', comp: { H: 1 }, charge: 1, logK: 0 },
      { id: 'OH-', label: 'OH⁻', comp: { H: -1 }, charge: -1, logK: -14 },
      { id: 'CO3--', label: 'CO₃²⁻', comp: { C: 1 }, charge: -2, logK: 0 },
      { id: 'HCO3-', label: 'HCO₃⁻', comp: { H: 1, C: 1 }, charge: -1, logK: 10.33 },
      { id: 'H2CO3', label: 'H₂CO₃', comp: { H: 2, C: 1 }, charge: 0, logK: 16.68 },
    ],
    totals: { C: 0.1 },
  },
  phosphate: {
    name: 'Phosphate system',
    components: [{ id: 'H', label: 'H⁺', master: 'H+', charge: 1 }, { id: 'P', label: 'Phosphate', master: 'PO4---', charge: -3 }],
    species: [
      { id: 'H+', label: 'H⁺', comp: { H: 1 }, charge: 1, logK: 0 },
      { id: 'OH-', label: 'OH⁻', comp: { H: -1 }, charge: -1, logK: -14 },
      { id: 'PO4---', label: 'PO₄³⁻', comp: { P: 1 }, charge: -3, logK: 0 },
      { id: 'HPO4--', label: 'HPO₄²⁻', comp: { H: 1, P: 1 }, charge: -2, logK: 12.35 },
      { id: 'H2PO4-', label: 'H₂PO₄⁻', comp: { H: 2, P: 1 }, charge: -1, logK: 19.55 },
      { id: 'H3PO4', label: 'H₃PO₄', comp: { H: 3, P: 1 }, charge: 0, logK: 21.7 },
    ],
    totals: { P: 0.05 },
  },
  ammonia: {
    name: 'Ammonia buffer',
    components: [{ id: 'H', label: 'H⁺', master: 'H+', charge: 1 }, { id: 'N', label: 'Ammonia', master: 'NH3', charge: 0 }],
    species: [
      { id: 'H+', label: 'H⁺', comp: { H: 1 }, charge: 1, logK: 0 },
      { id: 'OH-', label: 'OH⁻', comp: { H: -1 }, charge: -1, logK: -14 },
      { id: 'NH3', label: 'NH₃', comp: { N: 1 }, charge: 0, logK: 0 },
      { id: 'NH4+', label: 'NH₄⁺', comp: { H: 1, N: 1 }, charge: 1, logK: 9.25 },
    ],
    totals: { N: 0.1 },
  },
  copperAmmine: {
    name: 'Copper(II) ammine complexes',
    components: [
      { id: 'H', label: 'H⁺', master: 'H+', charge: 1 },
      { id: 'Cu', label: 'Copper(II)', master: 'Cu++', charge: 2 },
      { id: 'N', label: 'Ammonia', master: 'NH3', charge: 0 },
    ],
    species: [
      { id: 'H+', label: 'H⁺', comp: { H: 1 }, charge: 1, logK: 0 },
      { id: 'OH-', label: 'OH⁻', comp: { H: -1 }, charge: -1, logK: -14 },
      { id: 'Cu++', label: 'Cu²⁺', comp: { Cu: 1 }, charge: 2, logK: 0 },
      { id: 'NH3', label: 'NH₃', comp: { N: 1 }, charge: 0, logK: 0 },
      { id: 'NH4+', label: 'NH₄⁺', comp: { H: 1, N: 1 }, charge: 1, logK: 9.25 },
      { id: 'CuNH3', label: '[Cu(NH₃)]²⁺', comp: { Cu: 1, N: 1 }, charge: 2, logK: 4.13 },
      { id: 'CuNH32', label: '[Cu(NH₃)₂]²⁺', comp: { Cu: 1, N: 2 }, charge: 2, logK: 7.61 },
      { id: 'CuNH33', label: '[Cu(NH₃)₃]²⁺', comp: { Cu: 1, N: 3 }, charge: 2, logK: 10.48 },
      { id: 'CuNH34', label: '[Cu(NH₃)₄]²⁺', comp: { Cu: 1, N: 4 }, charge: 2, logK: 12.59 },
    ],
    totals: { Cu: 0.01, N: 0.2 },
  },
};

/** Sodium is a spectator: it carries charge into the balance and nothing else. */
export const SPECTATOR = { id: 'Na', label: 'Na⁺ (added base)', master: 'Na+', charge: 1 };

const withSpectator = (system) => {
  const components = [...system.components, SPECTATOR];
  const species = [...system.species, { id: 'Na+', label: 'Na⁺', comp: { Na: 1 }, charge: 1, logK: 0 }];
  return { ...system, components, species };
};

const concentrationOf = (species, x) => {
  let log = species.logK;
  Object.entries(species.comp).forEach(([component, coefficient]) => { log += coefficient * (x[component] ?? 0); });
  return Math.pow(10, log);
};

const concentrationsAt = (system, x) => {
  const out = {};
  system.species.forEach((species) => { out[species.id] = concentrationOf(species, x); });
  return out;
};

const scaleOf = (system, totals) => Math.max(...system.components.map((component) => totals[component.id] ?? 0), 1e-7);

const residualsAt = (system, x, totals) => {
  const concentrations = concentrationsAt(system, x);
  const scale = scaleOf(system, totals);
  const charge = system.species.reduce((sum, species) => sum + species.charge * concentrations[species.id], 0) / scale;
  const balances = system.components
    .filter((component) => component.id !== 'H')
    .map((component) => {
      const total = system.species.reduce((sum, species) => sum + (species.comp[component.id] ?? 0) * concentrations[species.id], 0);
      const target = totals[component.id] ?? 0;
      return target > 0 ? (total - target) / target : total;
    });
  return [charge, ...balances];
};

const solveLinear = (matrix, vector) => {
  const size = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-300) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = column + 1; row < size; row += 1) {
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= size; k += 1) a[row][k] -= factor * a[column][k];
    }
  }
  const solution = new Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = a[row][size];
    for (let k = row + 1; k < size; k += 1) sum -= a[row][k] * solution[k];
    solution[row] = sum / a[row][row];
  }
  return solution;
};

const maxAbs = (values) => values.reduce((worst, value) => Math.max(worst, Math.abs(value)), 0);

/** Newton in log-concentration space, with a pH scan used to place the first guess when it stalls. */
export function solveSpeciation(baseSystem, { totals = {}, addedBase = 0, iterations = 200 } = {}) {
  const system = withSpectator(baseSystem);
  const targetTotals = { ...baseSystem.totals, ...totals, Na: addedBase };
  const guessFor = (pH) => {
    const x = { H: -pH };
    system.components.forEach((component) => {
      if (component.id === 'H') return;
      const total = targetTotals[component.id] ?? baseSystem.totals[component.id] ?? 1e-3;
      x[component.id] = total > 0 ? Math.log10(total) : -30;
    });
    return x;
  };

  const newton = (startX) => {
    let x = { ...startX };
    let residual = residualsAt(system, x, targetTotals);
    for (let count = 1; count <= iterations; count += 1) {
      if (maxAbs(residual) < 1e-13) return { x, residual, iterations: count, converged: true };
      const keys = Object.keys(x);
      const jacobian = residual.map(() => new Array(keys.length).fill(0));
      keys.forEach((key, column) => {
        const probe = { ...x, [key]: x[key] + 1e-4 };
        const shifted = residualsAt(system, probe, targetTotals);
        residual.forEach((value, row) => { jacobian[row][column] = (shifted[row] - value) / 1e-4; });
      });
      const step = solveLinear(jacobian, residual.map((value) => -value));
      if (!step) return { x, residual, iterations: count, converged: false };
      const damping = Math.max(...step.map((value) => Math.abs(value))) > 1.5 ? 1.5 / Math.max(...step.map((value) => Math.abs(value))) : 1;
      keys.forEach((key) => { x[key] += damping * step[keys.indexOf(key)]; });
      residual = residualsAt(system, x, targetTotals);
    }
    return { x, residual, iterations, converged: maxAbs(residual) < 1e-13 };
  };

  let result = newton(guessFor(7));
  let scanUsed = false;
  if (!result.converged) {
    scanUsed = true;
    let best = null;
    for (let pH = 0; pH <= 14.001; pH += 0.05) {
      const score = residualsAt(system, guessFor(pH), targetTotals).reduce((sum, value) => sum + value * value, 0);
      if (!best || score < best.score) best = { score, pH };
    }
    result = newton(guessFor(best.pH));
  }

  const concentrations = concentrationsAt(system, result.x);
  const scale = scaleOf(system, targetTotals);
  const chargeResidual = system.species.reduce((sum, species) => sum + species.charge * concentrations[species.id], 0) / scale;
  const balances = {};
  baseSystem.components.filter((component) => component.id !== 'H').forEach((component) => {
    const total = system.species.reduce((sum, species) => sum + (species.comp[component.id] ?? 0) * concentrations[species.id], 0);
    const target = targetTotals[component.id] ?? 0;
    balances[component.id] = { total, target, relative: target > 0 ? Math.abs(total - target) / target : Math.abs(total) };
  });

  return {
    system,
    pH: -result.x.H,
    pOH: 14 + result.x.H,
    x: result.x,
    concentrations,
    chargeResidual,
    balances,
    iterations: result.iterations,
    converged: result.converged,
    scanUsed,
    totals: targetTotals,
  };
}

/** Solves the same chemistry at a sequence of added-base values — a titration curve. */
export function titration(baseSystem, { from = 0, to = 0.1, points = 60, totals = {} } = {}) {
  const curve = [];
  for (let index = 0; index <= points; index += 1) {
    const addedBase = from + ((to - from) * index) / points;
    const solution = solveSpeciation(baseSystem, { totals, addedBase });
    curve.push({ addedBase, pH: solution.pH, converged: solution.converged });
  }
  return curve;
}

const quadraticPH = (ka, total) => -Math.log10(((-ka + Math.sqrt(ka * ka + 4 * ka * total)) / 2));

export function verifyEquilibrium() {
  const water = solveSpeciation(SYSTEMS.water);
  const strong = solveSpeciation(SYSTEMS.strongAcid);
  const acetic = solveSpeciation(SYSTEMS.acetic);
  const acetateBuffer = solveSpeciation(SYSTEMS.acetic, { addedBase: 0.05 });
  const bicarbonate = solveSpeciation(SYSTEMS.carbonate, { totals: { C: 0.1 }, addedBase: 0.1 });
  const phosphateSalt = solveSpeciation(SYSTEMS.phosphate, { addedBase: 0.05 });
  const ammine = solveSpeciation(SYSTEMS.copperAmmine);
  const curve = titration(SYSTEMS.acetic, { from: 0, to: 0.1, points: 50 });

  const analyticAcetic = quadraticPH(Math.pow(10, -4.76), 0.1);
  const chargeResiduals = [water, strong, acetic, acetateBuffer, bicarbonate, phosphateSalt, ammine].map((solution) => Math.abs(solution.chargeResidual));
  const balanceResiduals = [strong, acetic, acetateBuffer, bicarbonate, phosphateSalt, ammine].flatMap((solution) => Object.values(solution.balances).map((entry) => entry.relative));
  const copperTotal = ammine.balances.Cu.total;
  const copperSpecies = ammine.system.species.filter((species) => (species.comp.Cu ?? 0) > 0);
  const dominant = copperSpecies.reduce((best, species) => (ammine.concentrations[species.id] > ammine.concentrations[best.id] ? species : best), copperSpecies[0]);
  const monotone = curve.every((point, index) => index === 0 || point.pH >= curve[index - 1].pH - 1e-6);
  const allConverged = curve.every((point) => point.converged);

  return {
    water, strong, acetic, acetateBuffer, bicarbonate, phosphateSalt, ammine, curve,
    checks: [
      { label: 'Pure water solves to pH 7 exactly', ok: Math.abs(water.pH - 7) < 1e-6, detail: `pH ${water.pH.toFixed(9)} from K_w = 1×10⁻¹⁴` },
      { label: 'A strong acid gives the pH its concentration demands', ok: Math.abs(strong.pH - 2) < 1e-4, detail: `0.01 M HCl solves to pH ${strong.pH.toFixed(6)}` },
      { label: 'A weak acid matches the independent quadratic solution', ok: Math.abs(acetic.pH - analyticAcetic) < 1e-6, detail: `solver ${acetic.pH.toFixed(6)} against quadratic ${analyticAcetic.toFixed(6)} for 0.1 M acetic acid` },
      { label: 'Half-neutralised acid lands on its pKa', ok: Math.abs(acetateBuffer.pH - 4.76) < 0.01, detail: `pH ${acetateBuffer.pH.toFixed(4)} against pK_a 4.76 — the identity the buffer equation rests on` },
      { label: 'An amphiprotic salt lands between its two pKa values', ok: Math.abs(phosphateSalt.pH - 4.675) < 0.05, detail: `NaH₂PO₄ gives pH ${phosphateSalt.pH.toFixed(4)} against the dilute-limit (pK₁ + pK₂)/2 = 4.675` },
      { label: 'Sodium bicarbonate lands on the carbonate midpoint', ok: Math.abs(bicarbonate.pH - 8.34) < 0.02, detail: `pH ${bicarbonate.pH.toFixed(4)} against (6.35 + 10.33)/2` },
      { label: 'Charge balance closes in every system solved', ok: Math.max(...chargeResiduals) < 1e-10, detail: `worst residual ${Math.max(...chargeResiduals).toExponential(2)} relative to the largest total` },
      { label: 'Mass balance closes for every component', ok: Math.max(...balanceResiduals) < 1e-10, detail: `worst relative residual ${Math.max(...balanceResiduals).toExponential(2)} over mass balances` },
      { label: 'Copper is conserved across all five of its species', ok: Math.abs(copperTotal - 0.01) / 0.01 < 1e-10, detail: `recovered ${copperTotal.toFixed(12)} M of the 0.01 M added` },
      { label: 'With ammonia in excess the tetraammine dominates', ok: dominant.id === 'CuNH34', detail: `${dominant.label} is the largest copper species` },
      { label: 'The titration curve rises monotonically and every point converges', ok: monotone && allConverged, detail: `${curve.length} points from pH ${curve[0].pH.toFixed(2)} to ${curve[curve.length - 1].pH.toFixed(2)}` },
      { label: 'The equivalence point of a weak acid is basic, as it must be', ok: curve[curve.length - 1].pH > 8, detail: `pH ${curve[curve.length - 1].pH.toFixed(2)} at full neutralisation of the acid` },
    ],
  };
}