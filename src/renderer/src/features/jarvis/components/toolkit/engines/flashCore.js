/**
 * Multicomponent flash separation engine.
 *
 * Vapour pressures come from Antoine equations and the liquid-phase non-ideality from ideal
 * mixing, a two-parameter Margules expansion or the van Laar model, so the K-values are
 * modified Raoult's law: K_i = γ_i P_i^sat(T)/P. Given temperature, pressure and an overall
 * composition the engine solves the Rachford–Rice equation for the vapour fraction, iterating
 * the activity coefficients to self-consistency, and separately finds bubble and dew points,
 * builds T–x–y and P–x–y diagrams and locates binary azeotropes.
 *
 * The engine is deliberately explicit about what it is: an engineering-grade ideal-plus-activity
 * model in the local browser, checked against the closed forms that exist for Raoult's law and
 * against the reported ethanol–water azeotrope. It is not a rigorous equation-of-state package,
 * and the notes in the interface say so.
 */

import { bisect, bracket, solveMonotone } from './numerics.js';

const ATM = 101.325;

/** Antoine constants in kPa and °C: log₁₀ P = A − B/(C + T). */
export const COMPONENTS = {
  water: { label: 'Water', antoine: [7.19621, 1730.63, 233.426], boiling: 100 },
  benzene: { label: 'Benzene', antoine: [6.01905, 1204.637, 220.088], boiling: 80.1 },
  toluene: { label: 'Toluene', antoine: [6.08436, 1347.62, 219.345], boiling: 110.6 },
  ethanol: { label: 'Ethanol', antoine: [7.2371, 1592.864, 226.184], boiling: 78.3 },
  methanol: { label: 'Methanol', antoine: [7.20587, 1582.271, 239.726], boiling: 64.7 },
  acetone: { label: 'Acetone', antoine: [6.242, 1210.595, 229.664], boiling: 56.1 },
  chloroform: { label: 'Chloroform', antoine: [6.0282, 1163.03, 227.4], boiling: 61.2 },
  hexane: { label: 'n-Hexane', antoine: [6.00266, 1171.53, 224.366], boiling: 68.7 },
  heptane: { label: 'n-Heptane', antoine: [6.02167, 1264.9, 216.632], boiling: 98.4 },
  isopropanol: { label: 'Isopropanol', antoine: [7.2431, 1580.92, 219.61], boiling: 82.3 },
  ethylAcetate: { label: 'Ethyl acetate', antoine: [6.21215, 1244.951, 218.86], boiling: 77.1 },
};

export const PAIRS = {
  'benzene-toluene': { label: 'Benzene / Toluene — ideal', components: ['benzene', 'toluene'], model: { kind: 'ideal' } },
  'hexane-heptane': { label: 'n-Hexane / n-Heptane — ideal', components: ['hexane', 'heptane'], model: { kind: 'ideal' } },
  'ethanol-water': {
    label: 'Ethanol / Water — minimum-boiling azeotrope',
    components: ['ethanol', 'water'],
    // Fitted so the binary recovers the reported azeotrope — x(EtOH) = 0.894 at 78.2 °C, 1 atm.
    // Finding it is then a test of the solver rather than of the numbers put in.
    model: { kind: 'margules', a12: 1.604, a21: 0.896 },
  },
  'acetone-chloroform': {
    label: 'Acetone / Chloroform — maximum-boiling azeotrope',
    components: ['acetone', 'chloroform'],
    model: { kind: 'margules', a12: -0.92, a21: -0.78 },
  },
  'methanol-water': {
    label: 'Methanol / Water — van Laar',
    components: ['methanol', 'water'],
    model: { kind: 'vanLaar', a12: 0.86, a21: 0.58 },
  },
  'isopropanol-water': {
    label: 'Isopropanol / Water — van Laar',
    components: ['isopropanol', 'water'],
    model: { kind: 'vanLaar', a12: 1.65, a21: 0.83 },
  },
};

export const MODELS = {
  ideal: 'Ideal mixing (Raoult’s law)',
  margules: 'Two-parameter Margules',
  vanLaar: 'van Laar',
};

export const satPressure = (id, tC) => {
  const component = COMPONENTS[id];
  if (!component) throw new Error(`"${id}" is not in the component library.`);
  return Math.pow(10, component.antoine[0] - component.antoine[1] / (component.antoine[2] + tC));
};

export const activityCoefficients = (model, x) => {
  const [x1 = 1, x2 = 0] = x;
  if (!model || model.kind === 'ideal') return [1, 1];
  const { a12, a21 } = model;
  if (model.kind === 'margules') {
    return [
      Math.exp(x2 * x2 * (a12 + 2 * (a21 - a12) * x1)),
      Math.exp(x1 * x1 * (a21 + 2 * (a12 - a21) * x2)),
    ];
  }
  const denominator = a12 * x1 + a21 * x2;
  if (!denominator) return [1, 1];
  return [
    Math.exp(a12 * Math.pow((a21 * x2) / denominator, 2)),
    Math.exp(a21 * Math.pow((a12 * x1) / denominator, 2)),
  ];
};

const psatOf = (components, tC) => components.map((id) => satPressure(id, tC));

const kValuesAt = (components, model, tC, P, x) => {
  const gamma = activityCoefficients(model, x);
  const psat = psatOf(components, tC);
  return gamma.map((value, index) => (value * psat[index]) / P);
};

/** The Rachford–Rice function whose root is the vapour fraction. */
export const rachfordRiceValue = (K, z, beta) => K.reduce((sum, value, index) => sum + (z[index] * (value - 1)) / (1 + beta * (value - 1)), 0);

/** Bubble pressure at a fixed temperature and liquid composition — exact, no root finding needed. */
export function bubblePressure({ components, model }, tC, x) {
  const gamma = activityCoefficients(model, x);
  const psat = psatOf(components, tC);
  return gamma.reduce((sum, value, index) => sum + value * x[index] * psat[index], 0);
}

/** Vapour composition in equilibrium with a given liquid at a fixed T and P. */
export function equilibriumVapour({ components, model }, tC, P, x) {
  const K = kValuesAt(components, model, tC, P, x);
  const y = x.map((value, index) => value * K[index]);
  return { K, y };
}

/** Dew point state at a fixed temperature: pressure, liquid composition and coefficients. */
export function dewState({ components, model }, tC, y, guess) {
  const psat = psatOf(components, tC);
  let pressure = guess ?? y.reduce((sum, value, index) => sum + value * psat[index], 0);
  let x = [...y];
  let gamma = activityCoefficients(model, x);
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const denominator = y.reduce((sum, value, index) => sum + value / (gamma[index] * psat[index]), 0);
    const nextPressure = 1 / denominator;
    const nextX = y.map((value, index) => (value * nextPressure) / (gamma[index] * psat[index]));
    const nextGamma = activityCoefficients(model, nextX);
    const shift = Math.max(
      ...nextX.map((value, index) => Math.abs(value - x[index])),
      Math.abs(Math.log(nextPressure / pressure)),
    );
    pressure = nextPressure;
    x = nextX;
    gamma = nextGamma;
    if (shift < 1e-15) break;
  }
  return { pressure, x, gamma };
}

export function dewPressure(system, tC, y) {
  return dewState(system, tC, y).pressure;
}

const guessTemperature = (components, weights) => components.reduce((sum, id, index) => sum + (weights[index] ?? 0) * COMPONENTS[id].boiling, 0);

/** Bubble temperature at a fixed pressure: the temperature where Σ K x = 1. */
export function bubbleTemperature(system, P, x, options = {}) {
  const gap = (tC) => bubblePressure(system, tC, x) - P;
  const tC = solveMonotone(gap, guessTemperature(system.components, x), { lower: -120, upper: 400, ...options });
  if (tC === null) return null;
  const K = kValuesAt(system.components, system.model, tC, P, x);
  return { tC, K, residual: Math.abs(K.reduce((sum, value, index) => sum + value * x[index], 0) - 1) };
}

/** Dew temperature at a fixed pressure: the temperature where Σ y / K = 1. */
export function dewTemperature(system, P, y, options = {}) {
  const gap = (tC) => {
    const state = dewState(system, tC, y);
    return state.pressure / P - 1;
  };
  const tC = solveMonotone(gap, guessTemperature(system.components, y), { lower: -120, upper: 400, ...options });
  if (tC === null) return null;
  const state = dewState(system, tC, y);
  const K = state.x.map((value, index) => (state.gamma[index] * satPressure(system.components[index], tC)) / P);
  const residual = Math.abs(y.reduce((sum, value, index) => sum + value / K[index], 0) - 1);
  return { tC, K, x: state.x, residual };
}

/**
 * Isothermal flash at a given temperature, pressure and overall composition. The activity
 * coefficients are iterated to self-consistency around the Rachford–Rice split, and the final
 * liquid composition is rebuilt from the converged K-values so the material balance holds
 * exactly rather than to the tolerance of the outer loop.
 */
export function flash(system, { tC, P, z }, { maxIterations = 80 } = {}) {
  const { components, model } = system;
  if (components.length !== z.length) throw new Error('The composition must have one mole fraction per component.');
  if (Math.abs(z.reduce((a, b) => a + b, 0) - 1) > 1e-6) throw new Error('The overall composition must sum to one.');
  const psat = psatOf(components, tC);
  let x = [...z];
  let K = kValuesAt(components, model, tC, P, x);
  const totalK = K.reduce((sum, value, index) => sum + z[index] * value, 0);
  const totalInverse = K.reduce((sum, value, index) => sum + z[index] / value, 0);

  if (totalK <= 1) {
    const scale = K.reduce((sum, value, index) => sum + z[index] * value, 0);
    return {
      phase: 'liquid',
      beta: 0,
      K,
      x: [...z],
      y: K.map((value, index) => (z[index] * value) / scale),
      T: tC,
      P,
      z: [...z],
      converged: true,
      iterations: 0,
    };
  }
  if (totalInverse <= 1) {
    const scale = K.reduce((sum, value, index) => sum + z[index] / value, 0);
    return {
      phase: 'vapour',
      beta: 1,
      K,
      x: K.map((value, index) => (z[index] / value) / scale),
      y: [...z],
      T: tC,
      P,
      z: [...z],
      converged: true,
      iterations: 0,
    };
  }

  let beta = 0.5;
  let iterations = 0;
  let converged = false;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    iterations = iteration;
    const root = bisect((fraction) => rachfordRiceValue(K, z, fraction), 0, 1, { tolerance: 1e-15 });
    if (root === null) break;
    beta = Math.min(1, Math.max(0, root));
    const nextX = z.map((value, index) => value / (1 + beta * (K[index] - 1)));
    const gamma = activityCoefficients(model, nextX);
    const nextK = gamma.map((value, index) => (value * psat[index]) / P);
    const shift = Math.max(...nextK.map((value, index) => Math.abs(Math.log(value / K[index]))));
    x = nextX;
    K = nextK;
    if (shift < 1e-14) { converged = true; break; }
  }

  const xOut = z.map((value, index) => value / (1 + beta * (K[index] - 1)));
  const yOut = xOut.map((value, index) => value * K[index]);
  const gammaOut = activityCoefficients(model, xOut);
  const rrResidual = Math.abs(rachfordRiceValue(K, z, beta));
  const balance = Math.max(...z.map((value, index) => Math.abs(value - (beta * yOut[index] + (1 - beta) * xOut[index]))));
  const coefficientResidual = Math.max(...K.map((value, index) => Math.abs(Math.log(value / ((gammaOut[index] * psat[index]) / P)))));
  const relativeVolatility = components.length === 2
    ? K[1] / K[0]
    : null;

  return {
    phase: 'two-phase',
    beta,
    K,
    x: xOut,
    y: yOut,
    gamma: gammaOut,
    T: tC,
    P,
    z: [...z],
    rrResidual,
    balance,
    sumX: xOut.reduce((a, b) => a + b, 0) - 1,
    sumY: yOut.reduce((a, b) => a + b, 0) - 1,
    coefficientResidual,
    relativeVolatility,
    converged: converged && iterations > 0,
    iterations,
  };
}

/** T–x–y diagram at a fixed pressure: where each liquid boils and what it gives off. */
export function diagram({ components, model }, { P = ATM, points = 40 } = {}) {
  const system = { components, model };
  if (components.length !== 2) throw new Error('A diagram needs exactly two components.');
  const curve = [];
  for (let index = 0; index <= points; index += 1) {
    const x1 = index / points;
    const x = [x1, 1 - x1];
    const bubble = bubbleTemperature(system, P, x);
    const dew = dewTemperature(system, P, x);
    curve.push({
      x1,
      bubbleT: bubble?.tC ?? NaN,
      dewT: dew?.tC ?? NaN,
      bubbleY1: bubble ? (bubble.K[0] * x1) : NaN,
      dewX1: dew ? dew.x[0] : NaN,
    });
  }
  return curve;
}

/**
 * Binary azeotrope at a given pressure: the composition where the two K-values are equal and
 * the temperature where that common value is one. Found by two nested roots rather than by
 * reading a diagram, so the answer comes with its own residuals.
 */
export function azeotrope({ components, model }, { P = ATM, from = -100, to = 400 } = {}) {
  if (components.length !== 2) throw new Error('Azeotrope search is a binary calculation.');
  const logRatio = (tC, x1) => {
    const psat = psatOf(components, tC);
    const gamma = activityCoefficients(model, [x1, 1 - x1]);
    return Math.log((gamma[0] * psat[0]) / (gamma[1] * psat[1]));
  };
  const compositionAt = (tC) => bisect((x1) => logRatio(tC, x1), 1e-9, 1 - 1e-9);
  const gap = (tC) => {
    const x1 = compositionAt(tC);
    if (x1 === null) return NaN;
    const psat = psatOf(components, tC);
    const gamma = activityCoefficients(model, [x1, 1 - x1]);
    return gamma[0] * psat[0] - P;
  };
  const interval = bracket(gap, components.reduce((sum, id, index) => sum + COMPONENTS[id].boiling, 0) / 2, { lower: from, upper: to, span: 25 });
  if (!interval) return null;
  const tC = bisect(gap, interval[0], interval[1]);
  if (tC === null) return null;
  const x1 = compositionAt(tC);
  if (x1 === null) return null;
  const x = [x1, 1 - x1];
  const psat = psatOf(components, tC);
  const gamma = activityCoefficients(model, x);
  const K = gamma.map((value, index) => (value * psat[index]) / P);
  return {
    tC,
    x,
    y: [...x],
    K,
    pressure: gamma[0] * psat[0],
    spread: Math.abs(Math.log(K[0] / K[1])),
    compositionResidual: Math.abs(logRatio(tC, x1)),
    // Classified by temperature against the pure boiling points, not by a K that is one by
    // definition at an azeotrope and so is decided by rounding noise.
    kind: tC < Math.min(...components.map((id) => COMPONENTS[id].boiling)) ? 'minimum-boiling' : 'maximum-boiling',
  };
}

export function verifyFlash() {
  const ideal = { components: PAIRS['benzene-toluene'].components, model: { kind: 'ideal' } };
  const z = [0.5, 0.5];
  const split = flash(ideal, { tC: 95, P: ATM, z });
  const analyticBeta = (1 - (z[0] * split.K[0] + z[1] * split.K[1])) / ((1 - split.K[0]) * (1 - split.K[1]));
  const bubble = bubbleTemperature(ideal, ATM, z);
  const dew = dewTemperature(ideal, ATM, z);
  const bubbleCheck = bubble.K.reduce((sum, value, index) => sum + value * z[index], 0);
  const dewCheck = dew.K.reduce((sum, value, index) => sum + z[index] / value, 0);
  const bubbleAt = bubblePressure(ideal, 95, [0.4, 0.6]);
  const analyticBubble = 0.4 * satPressure('benzene', 95) + 0.6 * satPressure('toluene', 95);
  const dewAt = dewPressure(ideal, 95, [0.6, 0.4]);
  const analyticDew = 1 / (0.6 / satPressure('benzene', 95) + 0.4 / satPressure('toluene', 95));
  const subcooled = flash(ideal, { tC: 60, P: ATM, z });
  const superheated = flash(ideal, { tC: 140, P: ATM, z });
  // Span the whole two-phase window, whose ends the engine found for itself.
  const midSplits = [0, 0.25, 0.5, 0.75, 1].map((fraction) => flash(ideal, {
    tC: bubble.tC + (dew.tC - bubble.tC) * fraction,
    P: ATM,
    z,
  }));
  const monotone = midSplits.every((entry, index) => index === 0 || entry.beta >= midSplits[index - 1].beta - 1e-12);
  const allTwoPhase = midSplits.filter((entry) => entry.phase === 'two-phase');

  const ethanolWater = { components: PAIRS['ethanol-water'].components, model: PAIRS['ethanol-water'].model };
  // Flash in the middle of the two-phase window, found from the two ends rather than assumed.
  const ethanolMix = [0.3, 0.7];
  const ethanolBubble = bubbleTemperature(ethanolWater, ATM, ethanolMix);
  const ethanolDew = dewTemperature(ethanolWater, ATM, ethanolMix);
  const nonIdeal = flash(ethanolWater, { tC: (ethanolBubble.tC + ethanolDew.tC) / 2, P: ATM, z: ethanolMix });
  const ethanolAzeotrope = azeotrope(ethanolWater, { P: ATM });
  const acetoneChloroform = { components: PAIRS['acetone-chloroform'].components, model: PAIRS['acetone-chloroform'].model };
  const acetoneAzeotrope = azeotrope(acetoneChloroform, { P: ATM });
  const boilingGaps = Object.entries(COMPONENTS).map(([id, component]) => ({
    id,
    gap: Math.abs(satPressure(id, component.boiling) - ATM) / ATM,
  }));
  const worstBoiling = boilingGaps.reduce((worst, entry) => (entry.gap > worst.gap ? entry : worst), boilingGaps[0]);

  return {
    split,
    bubble,
    dew,
    nonIdeal,
    ethanolAzeotrope,
    acetoneAzeotrope,
    checks: [
      {
        label: 'The binary flash matches its analytic solution exactly',
        ok: Math.abs(split.beta - analyticBeta) < 1e-12,
        detail: `β = ${split.beta.toFixed(12)} against (1 − ΣzK)/((1 − K₁)(1 − K₂)) = ${analyticBeta.toFixed(12)}`,
      },
      {
        label: 'The Rachford–Rice equation is satisfied at the reported split',
        ok: split.rrResidual < 1e-12,
        detail: `residual ${split.rrResidual.toExponential(2)} in Σ z(K − 1)/(1 + β(K − 1))`,
      },
      {
        label: 'The material balance closes component by component',
        ok: split.balance < 1e-14 && Math.max(Math.abs(split.sumX), Math.abs(split.sumY)) < 1e-14,
        detail: `worst balance error ${split.balance.toExponential(2)}; Σx − 1 = ${split.sumX.toExponential(2)}, Σy − 1 = ${split.sumY.toExponential(2)}`,
      },
      {
        label: 'The bubble point satisfies Σ K x = 1',
        ok: Math.abs(bubbleCheck - 1) < 1e-9,
        detail: `Σ K x = ${bubbleCheck.toFixed(12)} at ${bubble.tC.toFixed(4)} °C`,
      },
      {
        label: 'The dew point satisfies Σ y / K = 1',
        ok: Math.abs(dewCheck - 1) < 1e-9,
        detail: `Σ y / K = ${dewCheck.toFixed(12)} at ${dew.tC.toFixed(4)} °C`,
      },
      {
        label: 'For ideal mixing the bubble pressure is the weighted sum it must be',
        ok: Math.abs(bubbleAt / analyticBubble - 1) < 1e-14,
        detail: `${bubbleAt.toFixed(9)} kPa against Σ xᵢPᵢˢᵃᵗ = ${analyticBubble.toFixed(9)} kPa`,
      },
      {
        label: 'and the dew pressure is the reciprocal sum it must be',
        ok: Math.abs(dewAt / analyticDew - 1) < 1e-14,
        detail: `${dewAt.toFixed(9)} kPa against 1/Σ(yᵢ/Pᵢˢᵃᵗ) = ${analyticDew.toFixed(9)} kPa`,
      },
      {
        label: 'Single-phase states are recognised instead of forced into a split',
        ok: subcooled.phase === 'liquid' && superheated.phase === 'vapour' && split.phase === 'two-phase',
        detail: `liquid at 60 °C, vapour at 140 °C and two-phase at 95 °C, all at 1 atm`,
      },
      {
        label: 'The vapour fraction rises monotonically through the two-phase window',
        ok: monotone && allTwoPhase.length >= 3,
        detail: `${allTwoPhase.length} of 5 temperatures split, β from ${allTwoPhase[0]?.beta.toFixed(4)} to ${allTwoPhase[allTwoPhase.length - 1]?.beta.toFixed(4)}`,
      },
      {
        label: 'A non-ideal split is fully consistent with its own activity coefficients',
        ok: nonIdeal.phase === 'two-phase' && nonIdeal.coefficientResidual < 1e-10,
        detail: `worst |ln K − ln(γPˢᵃᵗ/P)| = ${(nonIdeal.coefficientResidual ?? NaN).toExponential(2)} for ethanol–water at ${nonIdeal.T.toFixed(2)} °C`,
      },
      {
        label: 'The ethanol–water parameters reproduce the reported azeotrope',
        ok: ethanolAzeotrope && Math.abs(ethanolAzeotrope.x[0] - 0.894) < 0.02 && Math.abs(ethanolAzeotrope.tC - 78.2) < 2,
        detail: ethanolAzeotrope
          ? `x(EtOH) = ${ethanolAzeotrope.x[0].toFixed(4)} against the reported 0.894, at ${ethanolAzeotrope.tC.toFixed(2)} °C against 78.2 °C`
          : 'no azeotrope found',
      },
      {
        label: 'At an azeotrope the two K-values are equal, so the phases are identical',
        ok: Boolean(ethanolAzeotrope) && ethanolAzeotrope.spread < 1e-8 && ethanolAzeotrope.K.every((value) => Math.abs(value - 1) < 1e-6),
        detail: `|ln(K₁/K₂)| = ${ethanolAzeotrope ? ethanolAzeotrope.spread.toExponential(2) : '—'}, and both K are 1 where the total pressure is 1 atm`,
      },
      {
        label: 'The engine finds a maximum-boiling azeotrope as well as a minimum-boiling one',
        ok: Boolean(acetoneAzeotrope) && ethanolAzeotrope?.kind === 'minimum-boiling' && acetoneAzeotrope.kind === 'maximum-boiling',
        detail: acetoneAzeotrope
          ? `acetone–chloroform peaks at ${acetoneAzeotrope.tC.toFixed(2)} °C, x(acetone) = ${acetoneAzeotrope.x[0].toFixed(3)} — above both pure boiling points`
          : 'no maximum-boiling azeotrope found',
      },
      {
        label: 'Every component’s vapour pressure reaches 1 atm near its normal boiling point',
        ok: worstBoiling.gap < 0.03,
        detail: `worst case ${COMPONENTS[worstBoiling.id].label}: ${(worstBoiling.gap * 100).toFixed(1)}% from 1 atm at its boiling point`,
      },
    ],
  };
}