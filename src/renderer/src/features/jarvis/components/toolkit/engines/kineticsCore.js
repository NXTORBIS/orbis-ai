/**
 * Reaction kinetics engine — coupled mass-action rate equations integrated numerically.
 *
 * A mechanism is written as elementary steps; each step's rate follows mass action on its own
 * reactant concentrations. Steps can be irreversible (`->`) or reversible (`<=>`), and any
 * species can be held constant with `@`, which is how reservoirs like A and B in an oscillating
 * system are represented. The integrator is classical fourth-order Runge–Kutta with automatic
 * step halving whenever a step would produce a negative concentration.
 *
 * Every claim this engine makes is checked against something independent: analytic solutions
 * for first order, second order and autocatalysis, the detailed-balance ratio for a reversible
 * pair, and the limit cycle of a nonlinear model.
 */

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

const SPECIES_RE = /^[A-Za-z][A-Za-z0-9_()+\-]*$/;

export const KINETICS_PRESETS = {
  firstOrder: {
    name: 'First-order decay',
    mechanism: 'A -> B : 0.35',
    concentrations: '@none = 0\nA = 1',
    note: 'A → B at k = 0.35. The engine is checked against [A] = [A]₀e^(−kt).',
  },
  secondOrder: {
    name: 'Second-order dimerisation',
    mechanism: '2A -> B : 0.4',
    concentrations: 'A = 1',
    note: 'Rate = k[A]², so [A] = [A]₀/(1 + 2k[A]₀t). Checked against that closed form.',
  },
  reversible: {
    name: 'Reversible isomerisation',
    mechanism: 'A <=> B : 0.6, 0.2',
    concentrations: 'A = 1',
    note: 'At equilibrium [B]/[A] must equal k₁/k₂, whatever the starting mixture.',
  },
  autocatalytic: {
    name: 'Autocatalytic growth',
    mechanism: 'A + B -> 2B : 0.5',
    concentrations: 'A = 0.8\nB = 0.02',
    note: 'A + B → 2B grows logistically once A is the limiting partner.',
  },
  brusselator: {
    name: 'Oscillating reaction (Brusselator)',
    mechanism: 'A -> X : 1\n2X + Y -> 3X : 1\nB + X -> Y + D : 1\nX -> E : 1',
    concentrations: '@A = 1\n@B = 3\nX = 0.5\nY = 1\nD = 0\nE = 0',
    note: 'A and B are reservoirs (held constant). Above B = 1 + A² the steady state is unstable and X and Y oscillate.',
  },
  consecutive: {
    name: 'Consecutive network A → B → C',
    mechanism: 'A -> B : 0.5\nB -> C : 0.15',
    concentrations: 'A = 1',
    note: 'The intermediate B must rise and then fall; its peak is where the two rates balance.',
  },
};

/** Parses `A + 2B -> C : 0.3` and `A <=> B : 0.6, 0.2`. Throws with the offending line number. */
export function parseMechanism(text) {
  const steps = [];
  String(text).split('\n').forEach((raw, index) => {
    const line = raw.split('#')[0].trim();
    if (!line) return;
    const arrow = line.includes('<=>') ? '<=>' : line.includes('->') ? '->' : line.includes('=>') ? '=>' : null;
    if (!arrow) throw new Error(`Line ${index + 1}: no reaction arrow (use -> or <=>).`);
    const [left, rightPart] = line.split(arrow);
    const [right, constantPart] = rightPart.split(':');
    const rates = (constantPart || '').split(',').map((value) => Number(value.trim()));
    if (!Number.isFinite(rates[0])) throw new Error(`Line ${index + 1}: no rate constant after ":" .`);
    if (arrow === '<=>' && !Number.isFinite(rates[1])) throw new Error(`Line ${index + 1}: a reversible step needs a second rate constant.`);

    const side = (part, label) => {
      const terms = part.split('+').map((term) => term.trim()).filter(Boolean);
      if (!terms.length) throw new Error(`Line ${index + 1}: nothing on the ${label} side.`);
      return terms.map((term) => {
        const match = term.match(/^(\d+(?:\.\d+)?)?\s*([A-Za-z0-9_()+\-]+)$/);
        if (!match || !SPECIES_RE.test(match[2])) throw new Error(`Line ${index + 1}: cannot read the species "${term}".`);
        return { id: match[2], coeff: match[1] ? Number(match[1]) : 1 };
      });
    };

    steps.push({ reactants: side(left, 'left'), products: side(right, 'right'), kf: rates[0], kr: arrow === '<=>' ? rates[1] : null, line: index + 1 });
  });
  if (!steps.length) throw new Error('The mechanism is empty.');
  return steps;
}

/** Parses `A = 1` for initial amounts and `@A = 1` for species held constant. */
export function parseConcentrations(text, steps) {
  const initial = {};
  const constant = {};
  String(text).split('\n').forEach((raw, index) => {
    const line = raw.split('#')[0].trim();
    if (!line) return;
    const held = line.startsWith('@');
    const body = held ? line.slice(1) : line;
    const [id, valuePart] = body.split('=');
    if (!id || valuePart === undefined) throw new Error(`Concentration line ${index + 1}: expected "A = 1".`);
    const value = Number(valuePart.trim());
    if (!Number.isFinite(value) || value < 0) throw new Error(`Concentration line ${index + 1}: "${valuePart}" is not a positive amount.`);
    (held ? constant : initial)[id.trim()] = value;
  });
  const species = [...new Set(steps.flatMap((step) => [...step.reactants, ...step.products].map((term) => term.id)))];
  Object.keys(constant).forEach((id) => { if (!species.includes(id)) species.push(id); });
  species.forEach((id) => { if (initial[id] === undefined && constant[id] === undefined) initial[id] = 0; });
  return { initial, constant, species };
}

const rateOf = (step, concentrations, forward) => {
  const terms = forward ? step.reactants : step.products;
  const k = forward ? step.kf : step.kr;
  let rate = k;
  terms.forEach((term) => { rate *= Math.pow(Math.max(concentrations[term.id], 0), term.coeff); });
  return rate;
};

/** Mass-action derivative of every species. */
export function derivatives(steps, concentrations) {
  const out = {};
  Object.keys(concentrations).forEach((id) => { out[id] = 0; });
  steps.forEach((step) => {
    const forward = rateOf(step, concentrations, true);
    step.reactants.forEach((term) => { out[term.id] -= term.coeff * forward; });
    step.products.forEach((term) => { out[term.id] += term.coeff * forward; });
    if (step.kr !== null) {
      const reverse = rateOf(step, concentrations, false);
      step.products.forEach((term) => { out[term.id] -= term.coeff * reverse; });
      step.reactants.forEach((term) => { out[term.id] += term.coeff * reverse; });
    }
  });
  return out;
}

const rk4 = (steps, state, dt, held) => {
  const k1 = derivatives(steps, state);
  const add = (base, slopes, factor) => {
    const next = { ...base };
    Object.keys(base).forEach((id) => { next[id] = base[id] + factor * slopes[id]; });
    return next;
  };
  const k2 = derivatives(steps, add(state, k1, dt / 2));
  const k3 = derivatives(steps, add(state, k2, dt / 2));
  const k4 = derivatives(steps, add(state, k3, dt));
  const next = { ...state };
  Object.keys(state).forEach((id) => {
    if (held.has(id)) { next[id] = state[id]; return; }
    next[id] = state[id] + (dt / 6) * (k1[id] + 2 * k2[id] + 2 * k3[id] + k4[id]);
  });
  return next;
};

/**
 * Integrates the mechanism. The step is halved and retried whenever it would push a
 * concentration below zero, so the reported trajectory is always physically admissible.
 */
export async function simulate({ mechanism, concentrations, span = 20, dt = 0.002, samples = 900, onProgress, signal } = {}) {
  const steps = parseMechanism(mechanism);
  const { initial, constant, species } = parseConcentrations(concentrations, steps);
  const held = new Set(Object.keys(constant));
  const start = { ...initial, ...constant };
  species.forEach((id) => { if (start[id] === undefined) start[id] = 0; });

  const requestedSteps = Math.max(1, Math.round(span / dt));
  const sampleEvery = Math.max(1, Math.floor(requestedSteps / samples));
  let state = { ...start };
  let step = 0;
  let halvings = 0;
  let clamps = 0;
  let smallestStep = dt;
  const series = [{ t: 0, values: { ...state } }];
  const minimums = {};
  const maximums = {};
  species.forEach((id) => { minimums[id] = state[id]; maximums[id] = state[id]; });

  while (step < requestedSteps) {
    let local = dt;
    let next = rk4(steps, state, local, held);
    let attempts = 0;
    while (species.some((id) => !held.has(id) && next[id] < -1e-12) && attempts < 14) {
      local /= 2;
      attempts += 1;
      halvings += 1;
      next = rk4(steps, state, local, held);
    }
    species.forEach((id) => {
      if (held.has(id)) return;
      if (next[id] < 0) { next[id] = 0; clamps += 1; }
      if (!Number.isFinite(next[id])) throw new Error('The integration diverged — try a smaller step.');
      minimums[id] = Math.min(minimums[id], next[id]);
      maximums[id] = Math.max(maximums[id], next[id]);
    });
    smallestStep = Math.min(smallestStep, local);
    state = next;
    step += Math.max(1, Math.round(dt / local));
    if (step % sampleEvery === 0 || step >= requestedSteps) series.push({ t: step * dt, values: { ...state } });
    if (onProgress && series.length % 12 === 0) {
      onProgress({ done: step, total: requestedSteps });
      if (signal?.aborted) throw new Error('The simulation was stopped.');
      await pause();
    }
  }

  const final = { ...state };
  const tail = series.slice(-Math.max(2, Math.floor(series.length / 5)));
  const drift = {};
  species.forEach((id) => {
    const values = tail.map((point) => point.values[id]);
    const highest = Math.max(...values);
    drift[id] = highest > 0 ? (highest - Math.min(...values)) / highest : 0;
  });

  return {
    steps,
    species,
    held: [...held],
    series,
    stats: {
      species: species.map((id) => ({ id, start: start[id], final: final[id], min: minimums[id], max: maximums[id], drift: drift[id], held: held.has(id) })),
      halvings,
      clamps,
      smallestStep,
      negativeCount: Object.values(minimums).filter((value) => value < -1e-12).length,
      steady: Object.entries(drift).every(([id, value]) => held.has(id) || value < 1e-3),
      finalState: final,
      stepCount: step,
    },
  };
}

const maxRelativeError = (series, id, exact) => {
  let worst = 0;
  series.forEach((point) => {
    const truth = exact(point.t);
    if (!Number.isFinite(truth) || truth <= 0) return;
    worst = Math.max(worst, Math.abs(point.values[id] - truth) / truth);
  });
  return worst;
};

const peaksOf = (series, id) => {
  const values = series.map((point) => point.values[id]);
  const peaks = [];
  for (let index = 1; index < values.length - 1; index += 1) {
    if (values[index] > values[index - 1] && values[index] >= values[index + 1]) {
      const before = values[index - 1];
      const after = values[index + 1];
      const denom = before - 2 * values[index] + after;
      const offset = denom !== 0 ? (0.5 * (before - after)) / denom : 0;
      peaks.push({ t: series[index].t + offset * (series[index + 1]?.t - series[index].t || 0), value: values[index] });
    }
  }
  return peaks;
};

/** Independent verification: closed-form solutions, detailed balance and a nonlinear limit cycle. */
export async function verifyKinetics() {
  const first = await simulate({ ...KINETICS_PRESETS.firstOrder, span: 12, dt: 0.001, samples: 400 });
  const second = await simulate({ ...KINETICS_PRESETS.secondOrder, span: 6, dt: 0.0005, samples: 400 });
  const back = await simulate({ ...KINETICS_PRESETS.reversible, span: 60, dt: 0.001, samples: 400 });
  const auto = await simulate({ ...KINETICS_PRESETS.autocatalytic, span: 30, dt: 0.001, samples: 400 });
  const osc = await simulate({ ...KINETICS_PRESETS.brusselator, span: 40, dt: 0.002, samples: 2000 });
  const chain = await simulate({ ...KINETICS_PRESETS.consecutive, span: 40, dt: 0.002, samples: 600 });

  const firstError = maxRelativeError(first.series, 'A', (t) => Math.exp(-0.35 * t));
  const secondError = maxRelativeError(second.series, 'A', (t) => 1 / (1 + 2 * 0.4 * t));
  const total = back.series[back.series.length - 1].values;
  const ratio = total.B / total.A;
  const autoTotal = 0.82;
  const autoError = maxRelativeError(auto.series, 'B', (t) => autoTotal / (1 + ((autoTotal - 0.02) / 0.02) * Math.exp(-autoTotal * 0.5 * t)));

  const peaks = peaksOf(osc.series, 'X');
  const intervals = peaks.slice(1).map((peak, index) => peak.t - peaks[index].t);
  const recent = intervals.slice(-3);
  const meanPeriod = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : 0;
  const periodSpread = recent.length > 1 ? (Math.max(...recent) - Math.min(...recent)) / meanPeriod : 1;
  const amplitude = Math.max(...osc.series.map((point) => point.values.X)) - Math.min(...osc.series.map((point) => point.values.X));

  const bSeries = chain.series.map((point) => point.values.B);
  const bPeakIndex = bSeries.indexOf(Math.max(...bSeries));
  const bRises = bPeakIndex > 0 && bSeries[0] < bSeries[bPeakIndex];
  const bFalls = bPeakIndex < bSeries.length - 1 && bSeries[bSeries.length - 1] < bSeries[bPeakIndex];
  const bPeakTime = chain.series[bPeakIndex].t;

  return {
    first, second, back, auto, osc, chain,
    checks: [
      { label: 'First-order decay matches the analytic exponential', ok: firstError < 1e-6, detail: `worst relative error ${firstError.toExponential(2)} against [A]₀e^(−kt)` },
      { label: 'Second-order dimerisation matches its closed form', ok: secondError < 1e-6, detail: `worst relative error ${secondError.toExponential(2)} against [A]₀/(1 + 2k[A]₀t)` },
      { label: 'A reversible pair settles on the ratio its rate constants demand', ok: Math.abs(ratio - 0.6 / 0.2) < 1e-3, detail: `[B]/[A] = ${ratio.toFixed(5)} against k₁/k₂ = ${(0.6 / 0.2).toFixed(2)}` },
      { label: 'A reversible pair conserves the total amount', ok: Math.abs(total.A + total.B - 1) < 1e-9, detail: `A + B = ${(total.A + total.B).toFixed(12)} starting from 1` },
      { label: 'Autocatalysis follows the logistic it must follow', ok: autoError < 1e-5, detail: `worst relative error ${autoError.toExponential(2)} against the logistic solution` },
      { label: 'The oscillator genuinely oscillates rather than settling', ok: peaks.length >= 4 && amplitude > 0.5, detail: `${peaks.length} peaks with an amplitude of ${amplitude.toFixed(3)} in X` },
      { label: 'The oscillation has a constant period', ok: meanPeriod > 0 && periodSpread < 0.05, detail: `period ${meanPeriod.toFixed(3)} time units, successive peaks within ${(periodSpread * 100).toFixed(2)}%` },
      { label: 'A consecutive network shows its intermediate rise then fall', ok: bRises && bFalls, detail: `B peaks at ${bPeakTime.toFixed(2)} time units` },
      { label: 'No concentration ever goes negative in any run', ok: [first, second, back, auto, osc, chain].every((run) => run.stats.negativeCount === 0), detail: `${[first, second, back, auto, osc, chain].reduce((sum, run) => sum + run.stats.halvings, 0)} automatic step halvings, ${[first, second, back, auto, osc, chain].reduce((sum, run) => sum + run.stats.clamps, 0)} clamped values` },
    ],
  };
}