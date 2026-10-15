/**
 * Cell cycle engine — a CDK1/APC oscillator with explicit phase, DNA and mass bookkeeping.
 *
 * The oscillator is the Tyson model of the cell cycle: cyclin synthesis and degradation, CDK1
 * activation by cyclin, inactivation by APC, and APC activation by active CDK1. Rather than
 * trusting remembered constants, the engine searches a small grid of the two rates that control
 * the switch and keeps a set that actually produces a stable limit cycle, measured — and the
 * chosen set, its period and how tightly its peaks agree are all reported. On top of that
 * oscillator sit DNA content, cell mass and the G2/M checkpoint, which works here the way it
 * works in a cell: by inhibiting APC.
 */

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

export const CELL_TYPES = {
  mammalian: { id: 'mammalian', name: 'Mammalian cell', periodHours: 22, dnaShare: 0.3 },
  stressed: { id: 'stressed', name: 'Cell with slow replication', periodHours: 22, dnaShare: 0.92 },
  yeast: { id: 'yeast', name: 'Budding yeast', periodHours: 1.6, dnaShare: 0.4 },
};

const BASE = { k1: 0.04, k2: 0.02, k2double: 1, k3: 1.5, k5: 0.6, J3: 0.04, J4: 0.04, J5: 0.04, J6: 0.04 };

const derivative = (K, { c, m, a }) => ({
  c: K.k1 - (K.k2 + K.k2double * a) * c,
  m: (K.k3 * c * (1 - m)) / (K.J3 + 1 - m) - (K.k4 * a * m) / (K.J4 + m),
  a: (K.k5 * m * (1 - a)) / (K.J5 + 1 - a) - (K.k6 * c * a) / (K.J6 + a),
});

/** Integrates a candidate set and returns the times at which active CDK1 peaks. */
function measurePeaks(K, { dt = 0.005, steps = 40000, skip = 6000 } = {}) {
  let state = { c: 0.02, m: 0.02, a: 0.02 };
  const peaks = [];
  let previous = state.m;
  let beforePrevious = previous;
  for (let step = 0; step < steps; step += 1) {
    const d = derivative(K, state);
    state = { c: state.c + d.c * dt, m: state.m + d.m * dt, a: state.a + d.a * dt };
    if (!Number.isFinite(state.m) || !Number.isFinite(state.c) || !Number.isFinite(state.a)) return [];
    if (step > skip && step % 5 === 0) {
      if (beforePrevious < previous && previous >= state.m && previous > 0.5) peaks.push(step * dt);
      beforePrevious = previous;
      previous = state.m;
    }
  }
  return peaks;
}

let cached = null;

/**
 * The two rates that decide whether this system switches or just settles are the inactivation
 * of active CDK1 by APC (k4) and the inactivation of APC by cyclin (k6). A grid over them is
 * searched for a genuine limit cycle: at least four peaks whose intervals agree closely.
 */
export function oscillatingParameters() {
  if (cached) return cached;
  let best = null;
  const report = [];
  for (const k4 of [0.005, 0.01, 0.02, 0.05, 0.1, 0.4]) {
    for (const k6 of [0.05, 0.2, 1, 5, 50, 200]) {
      const candidate = { ...BASE, k4, k6 };
      const peaks = measurePeaks(candidate);
      if (peaks.length < 3) {
        report.push({ k4, k6, peaks: peaks.length, period: null, spread: null });
        continue;
      }
      const intervals = peaks.slice(1).map((peak, index) => peak - peaks[index]).slice(-4);
      const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
      const spread = (Math.max(...intervals) - Math.min(...intervals)) / mean;
      report.push({ k4, k6, peaks: peaks.length, period: mean, spread });
      if (mean > 1.5 && spread < 0.08 && (!best || spread < best.spread)) best = { ...candidate, period: mean, spread, peakCount: peaks.length };
    }
  }
  cached = { parameters: best, search: report };
  return cached;
}

export async function simulateCycle({ cellType = 'mammalian', checkpoint = true, cycles = 3, dt = 0.002, onProgress, signal } = {}) {
  const type = CELL_TYPES[cellType] ?? CELL_TYPES.mammalian;
  const { parameters, search } = oscillatingParameters();
  if (!parameters) throw new Error('No parameter set on the grid produced a stable limit cycle, so there is nothing to simulate.');

  const secondsPerUnit = (type.periodHours * 3600) / parameters.period;
  const cycleSeconds = type.periodHours * 3600;
  const realStep = dt * secondsPerUnit;
  const steps = Math.ceil((cycleSeconds * cycles) / realStep);
  const sampleEvery = Math.max(1, Math.round(steps / 900));

  let state = { c: 0.02, m: 0.02, a: 0.02 };
  const samples = [];
  const transitions = [];
  const divisions = [];
  let dna = 2;
  let replicating = false;
  let replicated = false;
  let mass = 1;
  let birthMass = 1;
  let phase = 'G1';
  let heldInG2 = 0;
  let checkpointViolations = 0;
  let earliestMitosisDna = null;

  for (let step = 0; step < steps; step += 1) {
    const d = derivative(parameters, state);
    state = { c: state.c + d.c * dt, m: state.m + d.m * dt, a: state.a + d.a * dt };
    const seconds = step * realStep;

    mass *= Math.exp((Math.log(2) / cycleSeconds) * realStep);

    if (phase === 'G1' && state.c > 0.055 && mass >= birthMass * 1.15) {
      replicating = true;
      replicated = false;
    }
    if (replicating) {
      dna = Math.min(4, dna + (2 * realStep) / (type.dnaShare * cycleSeconds));
      if (dna >= 4 - 1e-9) { dna = 4; replicating = false; replicated = true; }
    }

    let nextPhase = state.m > 0.5 ? 'M' : (replicating ? 'S' : (replicated ? 'G2' : 'G1'));
    if (nextPhase === 'M' && !replicated && checkpoint) {
      nextPhase = 'G2';
      state.a = Math.min(state.a, 0.04);   // the checkpoint holds CDK1 high by keeping APC off
      heldInG2 += 1;
    }

    if (nextPhase === 'M' && phase !== 'M') {
      const copied = ((dna - 2) / 2) * 100;
      if (earliestMitosisDna === null || copied < earliestMitosisDna) earliestMitosisDna = copied;
      if (copied < 99.99) checkpointViolations += 1;
    }

    if (nextPhase !== phase) {
      transitions.push({ from: phase, to: nextPhase, seconds, dna, mass });
      phase = nextPhase;
    }

    if (phase === 'M' && state.m < 0.5) {
      divisions.push({ seconds, dnaAtDivision: dna, massAtDivision: mass, massRatio: mass / birthMass });
      dna = 2;
      replicating = false;
      replicated = false;
      birthMass = mass / 2;
      mass = birthMass;
      phase = 'G1';
    }

    if (step % sampleEvery === 0 || step === steps - 1) {
      samples.push({ seconds, m: state.m, c: state.c, a: state.a, dna, mass, phase });
      if (onProgress && samples.length % 40 === 0) {
        onProgress({ phase: 'Integrating the cycle', done: step, total: steps });
        if (signal?.aborted) throw new Error('The simulation was stopped.');
        await pause();
      }
    }
  }

  const order = transitions.map((entry) => `${entry.from}→${entry.to}`);
  const legalOrder = order.every((entry) => ['G1→S', 'S→G2', 'G2→M', 'M→G1'].includes(entry));
  const massRatios = divisions.map((entry) => entry.massRatio);
  const mitosisSamples = samples.filter((sample) => sample.phase === 'M');
  const intervals = divisions.slice(1).map((entry, index) => entry.seconds - divisions[index].seconds);
  const recent = intervals.slice(-3);
  const periodSpread = recent.length > 1 ? (Math.max(...recent) - Math.min(...recent)) / (recent.reduce((sum, value) => sum + value, 0) / recent.length) : 0;
  const dnaValues = samples.map((sample) => sample.dna);

  return {
    cellType: type,
    checkpoint,
    samples,
    transitions,
    divisions,
    parameters,
    search,
    secondsPerUnit,
    stats: {
      divisions: divisions.length,
      dnaAtDivision: divisions.map((entry) => entry.dnaAtDivision),
      dnaComplete: divisions.every((entry) => Math.abs(entry.dnaAtDivision - 4) < 1e-6),
      dnaMin: dnaValues.length ? Math.min(...dnaValues) : 2,
      dnaMax: dnaValues.length ? Math.max(...dnaValues) : 2,
      legalOrder,
      massRatios,
      meanMassRatio: massRatios.length ? massRatios.reduce((sum, value) => sum + value, 0) / massRatios.length : 0,
      cycleSeconds: recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : 0,
      periodSpread,
      heldInG2Hours: (heldInG2 * realStep) / 3600,
      checkpointViolations,
      earliestMitosisDna,
      mpfPeakDuringM: mitosisSamples.length ? Math.max(...mitosisSamples.map((sample) => sample.m)) : 0,
      mpfPeakDuringInterphase: samples.filter((sample) => sample.phase !== 'M').length ? Math.max(...samples.filter((sample) => sample.phase !== 'M').map((sample) => sample.m)) : 0,
      transitionSet: [...new Set(order)],
    },
  };
}

/** Four runs of one engine: normal and slow replication, each with and without the checkpoint. */
export async function verifyCellCycle({ cellType = 'mammalian', cycles = 2 } = {}) {
  const guarded = await simulateCycle({ cellType, checkpoint: true, cycles });
  const unguarded = await simulateCycle({ cellType, checkpoint: false, cycles });
  const slow = await simulateCycle({ cellType: 'stressed', checkpoint: true, cycles });
  const slowUnguarded = await simulateCycle({ cellType: 'stressed', checkpoint: false, cycles });
  const { parameters, search } = guarded;
  return {
    guarded,
    unguarded,
    slow,
    slowUnguarded,
    checks: [
      { label: 'A parameter set was found that genuinely oscillates, and it was measured', ok: Boolean(parameters) && parameters.peakCount >= 4 && parameters.spread < 0.02, detail: `k4 = ${parameters?.k4}, k6 = ${parameters?.k6}: period ${parameters?.period?.toFixed(2)} time units with successive peaks within ${((parameters?.spread ?? 0) * 100).toFixed(2)}%, out of ${search.length} sets tried` },
      { label: 'Phases occur in the order a cell must pass through them', ok: guarded.stats.legalOrder && slow.stats.legalOrder, detail: guarded.stats.transitionSet.join(', ') || 'no transitions' },
      { label: 'Phases have lengths, not just an order', ok: guarded.stats.cycleSeconds > 0, detail: `cycle length ${(guarded.stats.cycleSeconds / 3600).toFixed(2)} h for a ${guarded.cellType.periodHours} h cell` },
      { label: 'DNA content doubles and stops at exactly 4C', ok: Math.abs(guarded.stats.dnaMax - 4) < 1e-6 && guarded.stats.dnaMin >= 2 - 1e-9, detail: `range ${guarded.stats.dnaMin.toFixed(4)}C – ${guarded.stats.dnaMax.toFixed(4)}C` },
      { label: 'Every division happens at 4C and restores 2C', ok: guarded.stats.dnaComplete && guarded.stats.divisions > 0, detail: guarded.stats.dnaAtDivision.map((value) => `${value.toFixed(2)}C`).join(', ') || 'no division' },
      { label: 'Mass at division is twice the birth mass', ok: Math.abs(guarded.stats.meanMassRatio - 2) < 0.05, detail: `mean ratio ${guarded.stats.meanMassRatio.toFixed(4)} over ${guarded.stats.massRatios.length} divisions` },
      { label: 'Active CDK1 peaks in mitosis, not in interphase', ok: guarded.stats.mpfPeakDuringM > 0.5 && guarded.stats.mpfPeakDuringM > guarded.stats.mpfPeakDuringInterphase, detail: `peak ${guarded.stats.mpfPeakDuringM.toFixed(3)} in M against ${guarded.stats.mpfPeakDuringInterphase.toFixed(3)} elsewhere` },
      { label: 'With the checkpoint on, mitosis is never entered early — even with slow replication', ok: guarded.stats.checkpointViolations === 0 && slow.stats.checkpointViolations === 0, detail: `${guarded.stats.checkpointViolations} and ${slow.stats.checkpointViolations} premature entries` },
      { label: 'The checkpoint holds a slow cell in G2 instead of letting it divide', ok: slow.stats.heldInG2Hours > 0.5, detail: `held for ${slow.stats.heldInG2Hours.toFixed(2)} h while replication finished` },
      { label: 'With the checkpoint removed, mitosis starts with DNA unreplicated', ok: slowUnguarded.stats.checkpointViolations > 0, detail: `${slowUnguarded.stats.checkpointViolations} entry(ies), the first with ${slowUnguarded.stats.earliestMitosisDna === null ? '—' : `${slowUnguarded.stats.earliestMitosisDna.toFixed(1)}%`} of the genome copied` },
    ],
  };
}