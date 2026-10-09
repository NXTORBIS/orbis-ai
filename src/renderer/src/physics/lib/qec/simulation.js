import { zeroPauli, pauliMul, anticommutes, inSpan, toVector, pauliWeight, pauliToString } from './pauli';
import { sampleDataError, sampleMeasurementError, makeRng } from './noise';
import { syndromeOf, syndromeToKey, getDecoder } from './decoders';

// Classify the residual Pauli (mod stabilizer) into a logical I/X/Y/Z.
export function classifyLogical(residual, code) {
  const lx = anticommutes(residual, code.logicalZPauli) ? 1 : 0; // X-logical component
  const lz = anticommutes(residual, code.logicalXPauli) ? 1 : 0; // Z-logical component
  if (lx && lz) return 'Y';
  if (lx) return 'X';
  if (lz) return 'Z';
  return 'I';
}

// Run one full QEC trial. Returns the complete record for inspection.
export function runTrial(code, model, lookup, rng, opts = {}) {
  const { faulty = false, pMeas = 0 } = opts;
  const error = sampleDataError(code.n, model, rng);
  let syndrome = syndromeOf(error, code.stabilizerPaulis);
  let measFault = null;
  if (faulty) {
    measFault = sampleMeasurementError(syndrome.length, pMeas, rng);
    syndrome = syndrome.map((b, i) => b ^ measFault[i]);
  }
  const key = syndromeToKey(syndrome);
  const entry = lookup.get(key);
  const correction = entry ? entry.correction : zeroPauli(code.n);
  const residual = pauliMul(error, correction);
  const corrected = inSpan(code.stabVectors, toVector(residual));
  const logical = corrected ? 'I' : classifyLogical(residual, code);
  return {
    error,
    errorStr: pauliToString(error),
    errorWeight: pauliWeight(error),
    syndrome: Array.from(syndrome),
    measFault: measFault ? Array.from(measFault) : null,
    correction,
    correctionStr: pauliToString(correction),
    residual,
    residualStr: pauliToString(residual),
    corrected,
    logical,
    logicalFailure: !corrected,
  };
}

// Wilson score interval for a proportion (returns CI for the failure rate p_L).
export function proportionCI(failures, total, z = 1.96) {
  if (total === 0) return { center: 0, lower: 0, upper: 0 };
  const p = failures / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / total + (z * z) / (4 * total * total))) / denom;
  return { center, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

// Monte Carlo with cancel + pause. Returns a controller and a promise of results.
export function runMonteCarlo(code, model, lookup, opts, onProgress) {
  const state = { cancelled: false, paused: false, done: 0, failures: 0, corrected: 0 };
  const logicalCounts = { I: 0, X: 0, Y: 0, Z: 0 };
  const rng = makeRng(opts.seed);
  const batchSize = opts.batchSize || 1000;
  const t0 = performance.now();

  const promise = new Promise((resolve) => {
    function batch() {
      if (state.cancelled) return resolve(finalize());
      if (state.paused) { setTimeout(batch, 80); return; }
      const target = Math.min(state.done + batchSize, opts.trials);
      for (; state.done < target; state.done++) {
        const r = runTrial(code, model, lookup, rng, opts);
        if (r.corrected) state.corrected++; else state.failures++;
        logicalCounts[r.logical]++;
        if (state.cancelled) break;
      }
      if (onProgress) onProgress({ done: state.done, trials: opts.trials, failures: state.failures, corrected: state.corrected });
      if (state.done >= opts.trials || state.cancelled) return resolve(finalize());
      setTimeout(batch, 0);
    }
    function finalize() {
      const elapsed = (performance.now() - t0) / 1000;
      return {
        cancelled: state.cancelled,
        trials: state.done,
        failures: state.failures,
        corrected: state.corrected,
        logicalCounts,
        pL: state.done ? state.failures / state.done : 0,
        ci: proportionCI(state.failures, state.done),
        elapsed,
        tps: elapsed > 0 ? state.done / elapsed : 0,
      };
    }
    batch();
  });

  return {
    promise,
    cancel: () => { state.cancelled = true; },
    pause: () => { state.paused = true; },
    resume: () => { state.paused = false; },
    isPaused: () => state.paused,
  };
}

// Threshold sweep: for each p in ps, run `trialsPerPoint` trials, record p_L.
export function runThresholdSweep(code, model, decoderId, ps, trialsPerPoint, opts, onProgress) {
  const state = { cancelled: false };
  const rng = makeRng(opts.seed);
  const results = [];
  const controller = {
    cancel: () => { state.cancelled = true; },
  };
  const promise = (async () => {
    const lookup = getDecoder(code, decoderId);
    for (let i = 0; i < ps.length; i++) {
      if (state.cancelled) break;
      const p = ps[i];
      const m = { ...model, p, type: model.type === 'custom' ? 'custom' : model.type };
      let failures = 0;
      const batch = 2000;
      for (let done = 0; done < trialsPerPoint; done += batch) {
        if (state.cancelled) break;
        const end = Math.min(done + batch, trialsPerPoint);
        for (let j = done; j < end; j++) {
          const r = runTrial(code, m, lookup, rng, opts);
          if (!r.corrected) failures++;
        }
      }
      const completed = state.cancelled ? 0 : trialsPerPoint;
      results.push({ p, pL: completed ? failures / completed : 0, ci: proportionCI(failures, completed), failures, trials: completed });
      if (onProgress) onProgress({ index: i, total: ps.length, p, results: results.slice() });
      await new Promise((r) => setTimeout(r, 0));
    }
    return { cancelled: state.cancelled, points: results };
  })();
  return { promise, cancel: controller.cancel };
}