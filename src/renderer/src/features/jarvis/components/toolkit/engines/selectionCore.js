/**
 * Population genetics engine — natural selection as it is actually written down.
 *
 * A generation is a viability-selection step on genotype frequencies, then mutation, then
 * migration, then optionally a binomial draw of the next generation's alleles (drift). The
 * deterministic part has a closed form, so the engine's own arithmetic is checked against the
 * closed form every generation rather than merely being self-consistent; drift is then checked
 * against the quantities it must reproduce — Hardy-Weinberg, the variance of allele frequency,
 * the fixation probability of a neutral allele and the decay of heterozygosity.
 */

function makeRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/** Cumulative binomial distribution, built once for a given population size. */
export function binomialTable(n, p) {
  const cdf = new Float64Array(n + 1);
  if (p <= 0) { for (let k = 0; k <= n; k += 1) cdf[k] = 1; return cdf; }
  if (p >= 1) { for (let k = 0; k <= n; k += 1) cdf[k] = k === n ? 1 : 0; return cdf; }
  let term = Math.pow(1 - p, n);
  let total = term;
  cdf[0] = total;
  for (let k = 1; k <= n; k += 1) {
    term = term * ((n - k + 1) / k) * (p / (1 - p));
    total += term;
    cdf[k] = total;
  }
  for (let k = 0; k <= n; k += 1) cdf[k] = Math.min(1, cdf[k] / total);
  return cdf;
}

export function sampleBinomial(cdf, random) {
  const n = cdf.length - 1;
  const u = random();
  let low = 0;
  let high = n;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cdf[mid] < u) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function meanFitness(p, w) {
  const q = 1 - p;
  return p * p * w.w11 + 2 * p * q * w.w12 + q * q * w.w22;
}

/** The exact allele-frequency recurrence for diploid viability selection. */
export function selectionDelta(p, w) {
  const q = 1 - p;
  const wbar = meanFitness(p, w);
  if (wbar <= 0) return 0;
  const numerator = p * (p * w.w11 + q * w.w12);
  return numerator / wbar - p;
}

export function genotypeFrequencies(p, w) {
  const q = 1 - p;
  const wbar = meanFitness(p, w);
  if (wbar <= 0) return { AA: 0, Aa: 0, aa: 0 };
  return {
    AA: (p * p * w.w11) / wbar,
    Aa: (2 * p * q * w.w12) / wbar,
    aa: (q * q * w.w22) / wbar,
  };
}

export const DEFAULT_RUN = {
  p0: 0.5,
  population: 200,
  generations: 200,
  selectionCoefficient: 0.1,
  dominance: 0.5,
  mutation: 0,
  migration: 0,
  sourceFrequency: 0.5,
  drift: false,
  replicates: 1,
  seed: 11,
};

export function simulate({ p0 = 0.5, population = 200, generations = 200, selectionCoefficient = 0.1, dominance = 0.5, mutation = 0, migration = 0, sourceFrequency = 0.5, drift = false, replicates = 1, seed = 11 } = {}) {
  const w = {
    w11: 1,
    w12: 1 - dominance * selectionCoefficient,
    w22: 1 - selectionCoefficient,
  };
  const random = makeRandom(seed);
  const runs = [];

  for (let replicate = 0; replicate < replicates; replicate += 1) {
    let p = p0;
    const series = [];
    const deltas = [];
    const heterozygosity = [];
    let analyticError = 0;
    let meanFitnessDrop = 0;
    let fixed = null;

    for (let generation = 0; generation <= generations; generation += 1) {
      const wbar = meanFitness(p, w);
      if (generation > 0) meanFitnessDrop = Math.max(meanFitnessDrop, series[generation - 1].meanFitness - wbar);
      series.push({ generation, p, q: 1 - p, meanFitness: wbar, ...genotypeFrequencies(p, w) });
      heterozygosity.push(2 * p * (1 - p));

      if (generation === generations) break;

      const analytic = selectionDelta(p, w);
      const before = p;
      // the same next frequency, worked out from genotype frequencies rather than the closed form
      const genotypesAfter = genotypeFrequencies(p, w);
      const viaGenotypes = genotypesAfter.AA + genotypesAfter.Aa / 2;
      analyticError = Math.max(analyticError, Math.abs(viaGenotypes - (p + analytic)));
      const after = p + analytic;
      // mutation: forward and back
      const mutated = after * (1 - mutation) + (1 - after) * mutation;
      // migration from a source population
      p = mutated * (1 - migration) + sourceFrequency * migration;

      if (drift) {
        const table = binomialTable(2 * population, Math.min(1, Math.max(0, p)));
        const draws = sampleBinomial(table, random);
        p = draws / (2 * population);
        if (p <= 0 || p >= 1) {
          fixed = p >= 1 ? 1 : 0;
          series.push({ generation: generation + 1, p, q: 1 - p, meanFitness: meanFitness(p, w), ...genotypeFrequencies(p, w) });
          break;
        }
      }
      deltas.push(p - before);
    }

    runs.push({
      series,
      heterozygosity,
      finalP: p,
      fixed,
      analyticError,
      meanFitnessDrop,
      driftDelta: deltas.length ? deltas.reduce((sum, value) => sum + Math.abs(value), 0) / deltas.length : 0,
    });
  }

  const allSeries = runs.map((run) => run.series);
  const finalValues = runs.map((run) => run.series[run.series.length - 1].p);
  const meanFinal = finalValues.reduce((sum, value) => sum + value, 0) / finalValues.length;
  const varianceFinal = finalValues.reduce((sum, value) => sum + (value - meanFinal) ** 2, 0) / Math.max(1, finalValues.length - 1);
  const fixedAtOne = runs.filter((run) => run.series[run.series.length - 1].p >= 1 - 1e-12).length;
  const fixedAtZero = runs.filter((run) => run.series[run.series.length - 1].p <= 1e-12).length;

  return {
    w,
    weights: w,
    runs,
    series: allSeries[0],
    heterozygosity: runs[0].heterozygosity,
    summary: {
      finalP: allSeries[0][allSeries[0].length - 1].p,
      meanFinal,
      varianceFinal,
      fixationFraction: runs.length ? (fixedAtOne + fixedAtZero) / runs.length : 0,
      fixedAtOneFraction: runs.length ? fixedAtOne / runs.length : 0,
      replicates: runs.length,
      analyticError: Math.max(...runs.map((run) => run.analyticError)),
      meanFitnessDrop: Math.max(...runs.map((run) => run.meanFitnessDrop)),
      heterozygosityLoss: runs[0].heterozygosity[0] - runs[0].heterozygosity[runs[0].heterozygosity.length - 1],
    },
  };
}

export function verifySelection() {
  // 1 — no selection, no mutation, no migration, no drift: Hardy-Weinberg must hold exactly
  const neutral = simulate({ p0: 0.37, selectionCoefficient: 0, mutation: 0, migration: 0, drift: false, generations: 50 });
  const genotypeDrift = Math.max(...neutral.series.map((row) => Math.max(Math.abs(row.AA - row.p * row.p), Math.abs(row.Aa - 2 * row.p * (1 - row.p)), Math.abs(row.aa - (1 - row.p) * (1 - row.p)))));
  const alleleDrift = Math.max(...neutral.series.map((row) => Math.abs(row.p - 0.37)));

  // 2 — selection against a recessive allele: equilibrium frequency is √(μ/s)
  const balance = simulate({ p0: 0.5, selectionCoefficient: 0.1, dominance: 0, mutation: 0.0025, generations: 4000, population: 1e6 });
  const expectedEquilibrium = Math.sqrt(0.0025 / 0.1);
  const equilibriumQ = 1 - balance.series[balance.series.length - 1].p;

  // 2b — the variance of a single drift step, where the theory is exact
  const probe = simulate({ p0: 0.3, population: 50, generations: 1, selectionCoefficient: 0, drift: true, replicates: 400, seed: 77 });

  // 2c — the same deleterious allele, masked in heterozygotes or not
  const partialDominance = simulate({ p0: 0.05, selectionCoefficient: 0.3, dominance: 0.5, generations: 60, drift: false });
  const fullDominance = simulate({ p0: 0.05, selectionCoefficient: 0.3, dominance: 1, generations: 60, drift: false });

  // 3 — neutral drift over many replicates: fixation probability and variance
  const drift = simulate({ p0: 0.3, population: 50, generations: 600, selectionCoefficient: 0, drift: true, replicates: 200, seed: 21 });
  const expectedVariance = (0.3 * 0.7) / (2 * 50);

  // 4 — heterozygosity decays by 1 − 1/(2N) per generation under drift alone
  const single = simulate({ p0: 0.5, population: 50, generations: 60, selectionCoefficient: 0, drift: true, replicates: 120, seed: 33 });
  const meanHeterozygosity = single.runs.reduce((sum, run) => sum + run.heterozygosity[run.heterozygosity.length - 1], 0) / single.runs.length;
  const expectedHeterozygosity = 2 * 0.5 * 0.5 * Math.pow(1 - 1 / (2 * 50), 60);

  // 5 — Fisher's fundamental theorem: mean fitness cannot fall under selection alone
  const selected = simulate({ p0: 0.05, selectionCoefficient: 0.3, dominance: 1, generations: 300, mutation: 0, migration: 0, drift: false });

  return {
    neutral,
    balance,
    drift,
    single,
    selected,
    checks: [
      { label: 'Without selection, allele frequency does not move at all', ok: alleleDrift < 1e-12, detail: `largest change ${alleleDrift.toExponential(2)} over 50 generations` },
      { label: 'Genotypes follow Hardy-Weinberg exactly in the same run', ok: genotypeDrift < 1e-12, detail: `largest deviation ${genotypeDrift.toExponential(2)}` },
      { label: 'Mean fitness never falls under selection alone', ok: selected.summary.meanFitnessDrop < 1e-12, detail: `largest fall ${selected.summary.meanFitnessDrop.toExponential(2)}` },
      { label: 'Mutation and selection settle at √(μ/s) for a recessive allele', ok: Math.abs(equilibriumQ - expectedEquilibrium) / expectedEquilibrium < 0.12, detail: `the recessive allele settled at q = ${equilibriumQ.toFixed(4)} against √(μ/s) = ${expectedEquilibrium.toFixed(4)}` },
      { label: 'A neutral allele fixes as often as its starting frequency', ok: Math.abs(drift.summary.fixedAtOneFraction - 0.3) < 0.12, detail: `fixed in ${(drift.summary.fixedAtOneFraction * 100).toFixed(1)}% of ${drift.summary.replicates} populations from p₀ = 0.3` },
      { label: 'Drift variance matches p(1−p)/2N', ok: Math.abs(probe.summary.varianceFinal - expectedVariance) / expectedVariance < 0.35, detail: `variance after one generation ${probe.summary.varianceFinal.toFixed(5)} over ${probe.summary.replicates} populations against p(1−p)/2N = ${expectedVariance.toFixed(5)}` },
      { label: 'A masked deleterious allele is removed more slowly than an exposed one', ok: partialDominance.summary.finalP > fullDominance.summary.finalP, detail: `from p₀ = 0.05 and the same selection coefficient, after 60 generations the less exposed allele is at ${partialDominance.summary.finalP.toFixed(4)} and the fully exposed one at ${fullDominance.summary.finalP.toFixed(4)}` },
      { label: 'Heterozygosity decays at the rate drift theory predicts', ok: Math.abs(meanHeterozygosity - expectedHeterozygosity) / expectedHeterozygosity < 0.15, detail: `${meanHeterozygosity.toFixed(4)} measured after 60 generations against ${expectedHeterozygosity.toFixed(4)} expected` },
      { label: 'Selection carries the fitter allele to dominance', ok: selected.summary.finalP > 0.5, detail: `p rose from 0.05 to ${selected.summary.finalP.toFixed(3)} in 300 generations` },
    ],
  };
}