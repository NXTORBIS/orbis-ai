/**
 * Transforms: the FFT and the analysis built on it.
 *
 * Three things live on this screen, and they are all the same mathematics seen
 * from different sides:
 *
 *  - the discrete Fourier transform of a sampled signal, with the amplitude
 *    spectrum on a frequency axis whose units are stated rather than implied,
 *    and Parseval's identity shown as a self-check on the transform;
 *  - the characteristic function of a distribution, its cumulants, and the
 *    density and distribution function recovered from φ by the Fang–Oosterlee
 *    cosine expansion and by FFT inversion;
 *  - the exact distribution of a sum of independent lattice variables by
 *    convolution, which is what a transform buys you over simulation: an
 *    answer in the far tail, where simulation has no samples.
 *
 * Every number comes from `src/engine/transforms/`. Nothing is recomputed
 * here, nothing is substituted when the engine refuses: an `EngineError` is
 * shown as the engine's own message, per section, so one failed computation
 * does not blank the rest of the screen. Where a quantity is read off an
 * engine result (the largest amplitude in the spectrum, say) the interface
 * says so.
 *
 * Performance: the FFT inversion grid and the n-fold convolution are the two
 * computations here that can take long enough to make the page unresponsive,
 * so each is behind its own opt-in switch and button, exactly as the
 * rolling-origin backtest is in the time-series screen. Everything else runs
 * on every render and is measured in single-digit milliseconds for the default
 * configuration.
 */
import { useMemo } from 'react';
import {
  cAbs,
  cf,
  cdfByCos,
  complex,
  convolvePower,
  cosExpansion,
  cumulants,
  densityByCos,
  densityByFft,
  fftComplex,
  latticeFromDiscrete,
  latticeValues,
  nextPowerOfTwo,
  parseval,
  transformFormulas,
  type Complex,
  type CosExpansion,
} from '../../engine/transforms';
import { DISTRIBUTIONS, defaultParams, getDistribution } from '../../engine/distributions/registry';
import { EXACTNESS_LABEL, type Exactness, type Explanation } from '../../engine/core/result';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  SelectField,
  Segmented,
  TextField,
} from '../../ui/primitives';
import { BarChart, LineChart } from '../../ui/charts/charts';
import { formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

export interface TransformsConfig {
  /** Raw pasted samples, one per line; the sampling interval below gives them a time axis. */
  signalText: string;
  /** When true the built-in demonstration signal is transformed instead. */
  useBuiltInSignal: boolean;
  /**
   * Seconds (or whatever `timeUnit` says) between consecutive samples. The
   * frequency axis is meaningless without it, so it is an explicit input and
   * the charts name the unit it produces.
   */
  samplingInterval: number;
  /** Name of one unit of time, used to label the frequency axis. */
  timeUnit: string;
  /** Subtract the sample mean before transforming, so bin 0 does not dominate the chart. */
  removeMean: boolean;
  /** Amplitude |X_k| or power |X_k|², both taken from the same transform. */
  spectrumScale: 'amplitude' | 'power';

  /** Distribution whose characteristic function, cumulants and inversion are shown. */
  distributionId: string;
  params: Record<string, number>;
  /** φ(t) is plotted for t in [−cfMaxT, cfMaxT]. */
  cfMaxT: number;
  cfPoints: number;
  /** Highest cumulant reported (the engine allows 1 to 6). */
  cumulantOrder: number;

  /** Cosine terms N in the Fang–Oosterlee expansion. */
  cosTerms: number;
  /** Multiplier L in the truncation rule [κ₁ ± L√(κ₂ + √κ₄)]. */
  cosL: number;
  /** Points at which the COS density and CDF are evaluated for the chart. */
  cosGridPoints: number;

  /**
   * Whether to run the FFT grid inversion of φ. Off by default: it evaluates
   * the characteristic function at every one of `fftInversionTerms`
   * frequencies, and for a distribution whose φ has no closed form each of
   * those evaluations is itself a quadrature, which at 16384 points blocks the
   * main thread for seconds. It is run only when you ask for it.
   */
  runFftInversion: boolean;
  /** Grid size N; must be a power of two of at least 16. */
  fftInversionTerms: number;
  /** Frequency step du; dx·du = 2π/N fixes the spatial grid. */
  fftFrequencyStep: number;

  /**
   * Whether to run the n-fold convolution. Off by default: the support of the
   * sum grows linearly in n, so the cost of the exact route grows with its
   * square, and a large n on a wide lattice freezes the tab.
   */
  runConvolution: boolean;
  /** Discrete distribution convolved with itself. */
  convolutionId: string;
  convolutionParams: Record<string, number>;
  /** Number of independent copies summed. */
  convolutionN: number;
  /** Force a route instead of letting the engine choose by problem size. */
  convolutionRoute: 'auto' | 'direct' | 'fft';
}

/**
 * Built-in signal: 256 samples at 100 Hz of two sinusoids (8 Hz amplitude 2,
 * 21.5 Hz amplitude 1, the second deliberately off a bin centre so leakage is
 * visible) plus a constant offset and a small deterministic wobble from a
 * fixed linear congruential sequence. It is synthetic demonstration data and
 * the interface says so wherever it is used.
 */
const BUILT_IN_SIGNAL: number[] = (() => {
  let state = 20251012;
  const uniform = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const dt = 0.01;
  const out: number[] = [];
  for (let i = 0; i < 256; i++) {
    const t = i * dt;
    const v = 5 + 2 * Math.sin(2 * Math.PI * 8 * t) + Math.cos(2 * Math.PI * 21.5 * t) + 0.25 * (uniform() - 0.5);
    out.push(Math.round(v * 1e6) / 1e6);
  }
  return out;
})();

export const TRANSFORMS_DEFAULT: TransformsConfig = {
  signalText: '',
  useBuiltInSignal: true,
  samplingInterval: 0.01,
  timeUnit: 'second',
  removeMean: true,
  spectrumScale: 'amplitude',

  distributionId: 'gamma',
  params: defaultParams(getDistribution('gamma')),
  cfMaxT: 10,
  cfPoints: 201,
  cumulantOrder: 4,

  cosTerms: 512,
  cosL: 8,
  cosGridPoints: 201,

  runFftInversion: false,
  fftInversionTerms: 4096,
  fftFrequencyStep: 0.05,

  runConvolution: false,
  convolutionId: 'poisson',
  convolutionParams: defaultParams(getDistribution('poisson')),
  convolutionN: 20,
  convolutionRoute: 'auto',
};

/** Upper bound on pasted samples, so a stray paste cannot lock up the page. */
const MAX_SAMPLES = 8192;

/*
 * The cosine-expansion panel is NOT behind a button: it recomputes on every
 * change. Its cost is one φ evaluation per term plus N products per plotted
 * point, and for a distribution whose φ has no closed form each of those
 * evaluations is itself a numerical integration. Measured in a browser, the
 * previous caps (16,384 terms over 2,001 points) held the main thread for
 * 2.6 s on the default gamma and 4.2 s on Weibull. These caps keep the worst
 * case this panel can be asked for under a second, and the fields say so.
 */
const COS_MAX_TERMS = 4096;
const COS_MAX_GRID_POINTS = 1001;

/*
 * FFT inversion evaluates φ once per grid point. With a closed-form φ that is
 * cheap even at 65,536 points (measured 0.2 s); with a numerically evaluated
 * φ the same grid took 6.4 s. So the cap depends on which route φ took, and
 * the field states which cap is in force.
 */
const FFT_MAX_TERMS_EXACT_CF = 65536;
const FFT_MAX_TERMS_NUMERICAL_CF = 4096;

interface SkippedLine {
  line: number;
  text: string;
  reason: string;
}

interface ParsedSignal {
  values: number[];
  skipped: SkippedLine[];
  truncated: number;
}

/**
 * Parse pasted text into samples. Pasted data is untrusted: every line that
 * cannot be read is reported with its line number and the reason, and nothing
 * is ever dropped silently. The text is only ever rendered as text.
 */
function parseSignal(text: string): ParsedSignal {
  const values: number[] = [];
  const skipped: SkippedLine[] = [];
  let truncated = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue; // blank lines and comments are not data
    if (values.length >= MAX_SAMPLES) {
      truncated++;
      continue;
    }
    const fields = trimmed.split(/[,;\t]/).map((f) => f.trim());
    const valueField = fields[fields.length - 1];
    if (!valueField) {
      skipped.push({ line: i + 1, text: clip(trimmed), reason: 'the value field is empty' });
      continue;
    }
    const n = Number(valueField);
    if (!Number.isFinite(n)) {
      skipped.push({
        line: i + 1,
        text: clip(trimmed),
        reason: `"${clip(valueField, 24)}" is not a finite number${i === 0 ? ' (a header line?)' : ''}`,
      });
      continue;
    }
    values.push(n);
  }
  return { values, skipped, truncated };
}

function clip(s: string, max = 48): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run an engine call, turning an EngineError into its own message. */
function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function TransformsTool({ config }: { config: TransformsConfig }) {
  const app = useApp();
  const set = (patch: Partial<TransformsConfig>) => app.updateConfig({ ...config, ...patch });

  /* ------------------------------------------------------- the signal */

  const parsed = useMemo(() => parseSignal(config.signalText), [config.signalText]);
  const samples = useMemo(
    () => (config.useBuiltInSignal ? BUILT_IN_SIGNAL : parsed.values),
    [config.useBuiltInSignal, parsed.values],
  );

  const spectrum = useMemo(
    () =>
      attempt(() => {
        if (samples.length < 4) {
          throw new Error(
            `A discrete Fourier transform of ${samples.length} sample(s) says nothing about frequency. At least 4 samples are needed; paste more, or use the built-in signal.`,
          );
        }
        if (!(config.samplingInterval > 0) || !Number.isFinite(config.samplingInterval)) {
          throw new Error(
            'The sampling interval must be a finite positive number. Without it the transform has no frequency axis, so no spectrum is reported.',
          );
        }
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
        const offset = config.removeMean ? mean : 0;
        const x: Complex[] = samples.map((v) => complex(v - offset, 0));
        const X = fftComplex(x);
        const check = parseval(x, X);
        const n = x.length;
        const fs = 1 / config.samplingInterval;
        // One-sided: bins 0 … ⌊n/2⌋. Bin k is the frequency k·fs/n.
        const half = Math.floor(n / 2);
        const bins = [];
        for (let k = 0; k <= half; k++) {
          const modulus = cAbs(X[k]);
          bins.push({
            k,
            frequency: (k * fs) / n,
            period: k === 0 ? null : n / (k * fs),
            modulus,
            amplitude: (2 * modulus) / n,
            power: (modulus * modulus) / n,
          });
        }
        // Read off the engine's own spectrum rather than recomputed: the
        // largest-amplitude non-constant bin.
        let peak = bins.length > 1 ? bins[1] : null;
        for (const b of bins) {
          if (b.k === 0) continue;
          if (!peak || b.modulus > peak.modulus) peak = b;
        }
        return { bins, check, n, fs, nyquist: fs / 2, resolution: fs / n, mean, offset, peak };
      }),
    [samples, config.samplingInterval, config.removeMean],
  );

  const spectrumSeries = useMemo(() => {
    if (!spectrum.ok) return [];
    const usePower = config.spectrumScale === 'power';
    return [
      {
        label: usePower ? 'Power |X_k|²/n' : 'Amplitude 2|X_k|/n',
        points: spectrum.value.bins.map((b) => ({ x: b.frequency, y: usePower ? b.power : b.amplitude })),
      },
    ];
  }, [spectrum, config.spectrumScale]);

  const signalPoints = useMemo(
    () => samples.map((y, i) => ({ x: i * config.samplingInterval, y })),
    [samples, config.samplingInterval],
  );

  const spectrumExplanation = useMemo<Explanation>(() => {
    const steps = spectrum.ok
      ? [
          { label: 'Samples transformed', value: `${spectrum.value.n.toLocaleString('en-US')}` },
          {
            label: 'Sampling assumption',
            expression: `Δt = ${config.samplingInterval} ${config.timeUnit}, so f_s = 1/Δt`,
            value: `${formatValue(spectrum.value.fs, 6)} cycles per ${config.timeUnit}`,
          },
          { label: 'Frequency resolution f_s/n', value: `${formatValue(spectrum.value.resolution, 6)} cycles per ${config.timeUnit}` },
          { label: 'Nyquist frequency f_s/2', value: `${formatValue(spectrum.value.nyquist, 6)} cycles per ${config.timeUnit}` },
          {
            label: "Parseval's identity Σ|x_t|² = (1/n)Σ|X_k|²",
            value: spectrum.value.check.holds
              ? `holds to a relative error of ${spectrum.value.check.relativeError.toExponential(3)}`
              : `FAILS: relative error ${spectrum.value.check.relativeError.toExponential(3)} against a tolerance of ${spectrum.value.check.tolerance.toExponential(1)}`,
          },
        ]
      : [];
    return {
      method:
        'Discrete Fourier transform by the engine FFT (radix-2 for a power-of-two length, Bluestein chirp-z otherwise), with Parseval’s identity as a self-check',
      formula: 'X_k = Σ_{t=0}^{n−1} x_t e^{−2πikt/n},  f_k = k·f_s/n',
      steps,
      assumptions: [
        `The samples are equally spaced ${config.samplingInterval} ${config.timeUnit} apart. Every frequency on this screen is derived from that number; if the real spacing differs, every frequency is wrong by the same factor.`,
        config.removeMean
          ? 'The sample mean is subtracted before transforming. That is pre-processing of the input, not a result: it empties bin 0 and leaves every other bin unchanged.'
          : 'The samples are transformed as given, so bin 0 carries n times the sample mean and usually dominates the chart.',
        'The DFT treats the record as one period of a periodic signal. No window is applied, so a component whose frequency falls between two bin centres leaks into its neighbours.',
      ],
      limitations: [
        'Only frequencies up to the Nyquist f_s/2 are shown, and anything in the signal above it is aliased down into the range rather than detected.',
        'The frequency resolution is f_s/n: two components closer together than one bin cannot be separated, however many digits the numbers carry.',
        'This is the transform of the record you supplied, not an estimate of the spectrum of a process. It carries no sampling interval or band of uncertainty.',
      ],
      // The transform of given numbers is exact up to floating point; Parseval
      // is reported above so the rounding is visible rather than claimed away.
      exactness: 'numerical',
    };
  }, [spectrum, config.samplingInterval, config.timeUnit, config.removeMean]);

  /* ------------------------------- characteristic function and cumulants */

  const def = useMemo(() => {
    const found = DISTRIBUTIONS.find((d) => d.id === config.distributionId);
    return found ?? DISTRIBUTIONS[0];
  }, [config.distributionId]);

  const params = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const spec of def.params) {
      const v = config.params[spec.key];
      out[spec.key] = Number.isFinite(v) ? v : spec.defaultValue;
    }
    return out;
  }, [def, config.params]);

  const formulas = useMemo(() => attempt(() => transformFormulas(def.id)), [def.id]);

  const cfGrid = useMemo(
    () =>
      attempt(() => {
        const points = Math.max(3, Math.min(2001, Math.round(config.cfPoints)));
        const tMax = config.cfMaxT;
        if (!(tMax > 0) || !Number.isFinite(tMax)) {
          throw new Error('The characteristic function is plotted on [−t_max, t_max]; t_max must be a finite positive number.');
        }
        const rows = [];
        for (let i = 0; i < points; i++) {
          const t = -tMax + (2 * tMax * i) / (points - 1);
          const v = cf(def.id, params, t);
          rows.push({ t, re: v.value.re, im: v.value.im, modulus: cAbs(v.value), route: v.route, exactness: v.exactness });
        }
        const atZero = cf(def.id, params, 0);
        return { rows, atZero, route: rows[0].route, exactness: rows[0].exactness };
      }),
    [def.id, params, config.cfMaxT, config.cfPoints],
  );

  const cumulantResult = useMemo(
    () => attempt(() => cumulants(def.id, params, Math.max(1, Math.min(6, Math.round(config.cumulantOrder))))),
    [def.id, params, config.cumulantOrder],
  );

  /**
   * Whether the engine had a closed form for φ, which decides how expensive
   * one φ evaluation is and therefore how large an FFT grid stays responsive.
   * When φ could not be built at all the cautious cap is used.
   */
  const cfIsExact = cfGrid.ok && cfGrid.value.exactness === 'exact';
  const fftMaxTerms = cfIsExact ? FFT_MAX_TERMS_EXACT_CF : FFT_MAX_TERMS_NUMERICAL_CF;

  const cfSeries = useMemo(() => {
    if (!cfGrid.ok) return [];
    return [
      { label: 'Re φ(t)', points: cfGrid.value.rows.map((r) => ({ x: r.t, y: r.re })) },
      { label: 'Im φ(t)', points: cfGrid.value.rows.map((r) => ({ x: r.t, y: r.im })), dashed: true },
      { label: '|φ(t)|', points: cfGrid.value.rows.map((r) => ({ x: r.t, y: r.modulus })) },
    ];
  }, [cfGrid]);

  const cfExplanation = useMemo<Explanation>(() => {
    const steps = [];
    if (cfGrid.ok) {
      steps.push({ label: 'Route the engine took for φ', value: cfGrid.value.route });
      steps.push({
        label: 'φ(0), which must be exactly 1',
        value: `${formatValue(cfGrid.value.atZero.value.re, 10)} ${cfGrid.value.atZero.value.im >= 0 ? '+' : '−'} ${formatValue(Math.abs(cfGrid.value.atZero.value.im), 10)}i`,
      });
    }
    if (cumulantResult.ok) {
      steps.push({ label: 'Route the engine took for the cumulants', value: cumulantResult.value.route });
      cumulantResult.value.cumulants.forEach((k, i) => {
        steps.push({ label: `κ${i + 1}`, value: formatValue(k, 8) });
      });
    }
    return {
      method: `Characteristic function and cumulants of the ${def.name} distribution from the engine's transform tables`,
      formula: formulas.ok && formulas.value.cf ? formulas.value.cf : 'φ(t) = E[e^{itX}],  κ_r = K^{(r)}(0) with K(t) = ln E[e^{tX}]',
      steps,
      assumptions: [
        'The parameter values are yours, not results. Everything below them depends on them being right.',
        'φ is the characteristic function of one variable with these parameters. A sum of several would need the product of their φ, which is only valid if they are independent.',
      ],
      limitations: [
        cfGrid.ok && cfGrid.value.exactness === 'exact'
          ? 'φ is evaluated from a closed form, so it is limited only by floating-point rounding.'
          : 'φ has no closed form for this distribution, so the engine integrates it on a truncated range. The engine reports that truncation and the |t| beyond which the quadrature no longer resolves the oscillation; above that the values are unreliable.',
        'Cumulants above the second come from finite differences of the cumulant generating function, so they carry a differentiation error the engine states, and a distribution with no moment generating function has none at all — the engine refuses rather than returning a number.',
      ],
      exactness: cumulantResult.ok ? cumulantResult.value.exactness : cfGrid.ok ? cfGrid.value.exactness : 'numerical',
    };
  }, [cfGrid, cumulantResult, def.name, formulas]);

  /* --------------------------------------------- inversion: COS and FFT */

  const cos = useMemo(
    () =>
      attempt(() => {
        if (!cumulantResult.ok) {
          throw new Error(
            `The cosine expansion needs the truncation interval [κ₁ ± L√(κ₂ + √κ₄)], and the cumulants are not available: ${cumulantResult.error}`,
          );
        }
        const ks = cumulantResult.value.cumulants;
        const expansion: CosExpansion = cosExpansion((t: number) => cf(def.id, params, t).value, {
          terms: Math.max(8, Math.min(COS_MAX_TERMS, Math.round(config.cosTerms))),
          cumulants: { k1: ks[0], k2: ks[1], k4: ks[3] },
          L: config.cosL,
        });
        const points = Math.max(3, Math.min(COS_MAX_GRID_POINTS, Math.round(config.cosGridPoints)));
        // The outer 2% of the interval is where the periodic extension of the
        // series contaminates the value, and the engine withdraws trust there,
        // so the grid stays inside it rather than plotting values the engine
        // has told us not to believe.
        const margin = 0.02 * (expansion.upper - expansion.lower);
        const lo = expansion.lower + margin;
        const hi = expansion.upper - margin;
        const rows = [];
        for (let i = 0; i < points; i++) {
          const x = lo + ((hi - lo) * i) / (points - 1);
          const d = densityByCos(expansion, x);
          const c = cdfByCos(expansion, x);
          rows.push({ x, density: d.value, cdf: c.value, trustworthy: d.diagnostics.trustworthy && c.diagnostics.trustworthy });
        }
        const sampleDensity = densityByCos(expansion, (lo + hi) / 2);
        const sampleCdf = cdfByCos(expansion, (lo + hi) / 2);
        return { expansion, rows, sampleDensity, sampleCdf, lo, hi };
      }),
    [cumulantResult, def.id, params, config.cosTerms, config.cosL, config.cosGridPoints],
  );

  const cosSeries = useMemo(() => {
    if (!cos.ok) return [];
    return [
      { label: 'Density from φ (COS)', points: cos.value.rows.map((r) => ({ x: r.x, y: r.density })), area: true },
      { label: 'True density f(x)', points: cos.value.rows.map((r) => ({ x: r.x, y: def.pdf(r.x, params) })), dashed: true },
    ];
  }, [cos, def, params]);

  const cosCdfSeries = useMemo(() => {
    if (!cos.ok) return [];
    return [
      { label: 'CDF from φ (COS)', points: cos.value.rows.map((r) => ({ x: r.x, y: r.cdf })) },
      { label: 'True CDF F(x)', points: cos.value.rows.map((r) => ({ x: r.x, y: def.cdf(r.x, params) })), dashed: true },
    ];
  }, [cos, def, params]);

  /**
   * Largest absolute difference between the inverted density and the
   * registry's own density on the plotted grid. It is a comparison of two
   * engine results, not an error bound: the engine's own error estimate is
   * shown beside it.
   */
  const cosDiscrepancy = useMemo(() => {
    if (!cos.ok) return null;
    let worst = 0;
    let at = 0;
    for (const r of cos.value.rows) {
      const truth = def.pdf(r.x, params);
      if (!Number.isFinite(truth)) continue;
      const d = Math.abs(truth - r.density);
      if (d > worst) {
        worst = d;
        at = r.x;
      }
    }
    return { worst, at };
  }, [cos, def, params]);

  const fftInversion = useMemo(
    () =>
      config.runFftInversion
        ? attempt(() => {
            const centre = cumulantResult.ok ? cumulantResult.value.cumulants[0] : 0;
            return densityByFft((t: number) => cf(def.id, params, t).value, {
              terms: nextPowerOfTwo(Math.max(16, Math.min(fftMaxTerms, Math.round(config.fftInversionTerms)))),
              frequencyStep: config.fftFrequencyStep,
              centre,
            });
          })
        : null,
    [config.runFftInversion, config.fftInversionTerms, config.fftFrequencyStep, cumulantResult, def.id, params, fftMaxTerms],
  );

  const fftInversionSeries = useMemo(() => {
    if (!fftInversion || !fftInversion.ok) return [];
    const { x, density } = fftInversion.value;
    // The grid spans several standard deviations either side; plotting all of
    // it would hide the body of the density, so the plotted window is the COS
    // interval when there is one.
    const lo = cos.ok ? cos.value.lo : x[0];
    const hi = cos.ok ? cos.value.hi : x[x.length - 1];
    const points = [];
    for (let i = 0; i < x.length; i++) {
      if (x[i] >= lo && x[i] <= hi) points.push({ x: x[i], y: density[i] });
    }
    return [{ label: 'Density from φ (FFT grid)', points }];
  }, [fftInversion, cos]);

  const inversionExplanation = useMemo<Explanation>(() => {
    const steps = [];
    if (cos.ok) {
      const d = cos.value.sampleDensity.diagnostics;
      steps.push({ label: 'Method', value: d.method });
      steps.push({ label: 'Cosine terms N', value: String(d.terms) });
      steps.push({
        label: 'Truncation interval [a, b]',
        expression: 'κ₁ ± L√(κ₂ + √κ₄)',
        value: `[${formatValue(cos.value.expansion.lower, 8)}, ${formatValue(cos.value.expansion.upper, 8)}] at L = ${config.cosL}`,
      });
      steps.push({ label: 'Series-truncation estimate for the density', value: d.errorEstimate.toExponential(3) });
      steps.push({
        label: 'Series-truncation estimate for the CDF',
        value: cos.value.sampleCdf.diagnostics.errorEstimate.toExponential(3),
      });
    }
    if (fftInversion && fftInversion.ok) {
      const d = fftInversion.value.diagnostics;
      steps.push({ label: 'FFT grid points N', value: String(d.terms) });
      steps.push({ label: 'Frequency truncation |u| ≤', value: d.integrationLimit === undefined ? 'not reported' : formatValue(d.integrationLimit, 6) });
      steps.push({ label: 'FFT inversion error estimate', value: d.errorEstimate.toExponential(3) });
    }
    return {
      method:
        'Density and distribution function recovered from the characteristic function: Fang–Oosterlee cosine expansion, and optionally a uniform-grid FFT inversion',
      formula: 'f(x) ≈ Σ_{k=0}^{N−1} A_k cos(kπ(x−a)/(b−a)),  A_k = (2/(b−a))·Re(φ(kπ/(b−a))e^{−ikπa/(b−a)})',
      steps,
      assumptions: [
        'The Fang–Oosterlee interval rule assumes the cumulants locate the distribution well. For a heavy-tailed law it does not, and the interval truncation then dominates the error.',
        'The parameters are yours. The inversion recovers the distribution they define, which is not evidence that they describe anything real.',
      ],
      limitations: [
        'The cosine series is periodic with period 2(b − a), so outside [a, b] it returns a reflected copy of the density — a plausible-looking number that is not the density. The engine refuses those points, and the plotted grid stays inside the interval and clear of the outer 2% the engine does not trust.',
        'Two error sources are separate and only the first is estimated above: the series truncation in N, and the mass of the distribution outside [a, b].',
        'FFT inversion can produce small negative densities from aliasing and rounding. The engine clips them to zero and counts the largest one in its error estimate rather than hiding it.',
      ],
      exactness: 'numerical',
    };
  }, [cos, fftInversion, config.cosL]);

  /* ----------------------------------------------------- convolution */

  const convolutionDef = useMemo(() => {
    const found = DISTRIBUTIONS.find((d) => d.id === config.convolutionId && d.kind === 'discrete');
    return found ?? DISTRIBUTIONS.filter((d) => d.kind === 'discrete')[0];
  }, [config.convolutionId]);

  const convolutionParams = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const spec of convolutionDef.params) {
      const v = config.convolutionParams[spec.key];
      out[spec.key] = Number.isFinite(v) ? v : spec.defaultValue;
    }
    return out;
  }, [convolutionDef, config.convolutionParams]);

  const convolution = useMemo(
    () =>
      config.runConvolution
        ? attempt(() => {
            const base = latticeFromDiscrete(convolutionDef.id, convolutionParams);
            const n = Math.max(1, Math.round(config.convolutionN));
            const result = convolvePower(
              base.lattice,
              n,
              config.convolutionRoute === 'auto' ? {} : { route: config.convolutionRoute },
            );
            const values = latticeValues(result.lattice);
            return { base, result, values };
          })
        : null,
    [config.runConvolution, convolutionDef.id, convolutionParams, config.convolutionN, config.convolutionRoute],
  );

  const convolutionBars = useMemo(() => {
    if (!convolution || !convolution.ok) return [];
    const { values, result } = convolution.value;
    const p = result.lattice.p;
    // A long lattice would be unreadable as bars; the plotted window is the
    // part of the support that carries essentially all of the mass, and the
    // chart note says how much is outside it.
    let lo = 0;
    let hi = p.length - 1;
    while (lo < hi && p[lo] < 1e-9) lo++;
    while (hi > lo && p[hi] < 1e-9) hi--;
    const step = Math.max(1, Math.ceil((hi - lo + 1) / 600));
    const bars = [];
    for (let i = lo; i <= hi; i += step) bars.push({ x: values[i], y: p[i] });
    return bars;
  }, [convolution]);

  const convolutionExplanation = useMemo<Explanation>(() => {
    const steps = [];
    if (convolution && convolution.ok) {
      const { base, result } = convolution.value;
      steps.push({ label: 'Lattice of one component', value: `${base.lattice.p.length.toLocaleString('en-US')} points from ${base.lower} to ${base.upper}, step ${base.lattice.step}` });
      steps.push({ label: 'Mass omitted by truncating that lattice', value: base.omittedMass.toExponential(3) });
      steps.push({ label: 'Route the engine took', value: result.route });
      steps.push({ label: 'Pairwise convolutions performed (binary powering)', value: `${result.convolutions} for n = ${result.exponent}` });
      steps.push({ label: 'Total mass of the result', value: formatValue(result.totalMass, 12) });
      if (result.roundingResidual !== undefined) {
        steps.push({ label: 'Largest negative/imaginary residue the FFT left behind', value: result.roundingResidual.toExponential(3) });
      }
      if (result.fftLength !== undefined) steps.push({ label: 'FFT length used', value: String(result.fftLength) });
    }
    return {
      method: 'Exact distribution of a sum of independent lattice variables by n-fold convolution with binary powering',
      formula: 'p_{S_n}(s) = Σ_j p(j)·p_{S_{n−1}}(s − j),  computed as ⌊log₂ n⌋ squarings plus one product per set bit',
      steps,
      assumptions: [
        'The n copies are independent and identically distributed. Independence is an assumption about the inputs, not a result of the transform: with an unknown dependence the distribution of the sum is not determined by the marginals at all, and only bounds could be reported.',
        'The component lives on the integer lattice, truncated by the engine to the tail mass reported above.',
      ],
      limitations: [
        'The direct route is exact up to floating-point rounding; the FFT route is numerical, and the engine says which one ran and why. A drift of the total mass away from 1 is the signature of the truncation upstream, which is why it is shown.',
        'The far tail of the sum is where this method earns its keep and also where the omitted mass of the component lattice matters most.',
      ],
      exactness: convolution && convolution.ok ? convolution.value.result.exactness : 'exact',
    };
  }, [convolution]);

  /* ---------------------------------------------------------- render */

  const freqUnit = `cycles per ${config.timeUnit}`;
  const discreteOptions = useMemo(
    () => DISTRIBUTIONS.filter((d) => d.kind === 'discrete').map((d) => ({ value: d.id, label: d.name })),
    [],
  );

  return (
    <>
      {/* "transforms" is not yet a member of TOOL_IDS; the coordinator wires it. */}
      <ToolHeader toolId="transforms" />
      <div className="oc-stack">
        {/* ------------------------------------------------- the signal */}
        <Card
          title="The signal"
          hint="One sample per line. Two fields per line are read as a label and a value, so a pasted time column is accepted."
        >
          <Checkbox
            checked={config.useBuiltInSignal}
            onChange={(useBuiltInSignal) => set({ useBuiltInSignal })}
            label="Transform the built-in demonstration signal"
            description="256 synthetic samples at 100 Hz: an 8 Hz sinusoid of amplitude 2, a 21.5 Hz cosine of amplitude 1 placed deliberately between two bin centres, a constant offset of 5 and a small deterministic wobble. Not real data."
          />
          <TextField
            label="Samples, one per line"
            value={config.signalText}
            onChange={(signalText) => set({ signalText })}
            multiline
            rows={8}
            monospace
            disabled={config.useBuiltInSignal}
            placeholder={'0.00, 5.21\n0.01, 6.07\n0.02, 6.44'}
            hint="Blank lines and lines beginning with # are ignored. Every other unreadable line is listed below with its line number."
          />
          <div className="oc-btn-row">
            <Button
              icon="chart"
              onClick={() => set({ signalText: BUILT_IN_SIGNAL.map((v) => v.toFixed(6)).join('\n'), useBuiltInSignal: false })}
            >
              Copy the built-in signal into the box
            </Button>
          </div>
          <NumberField
            label="Sampling interval"
            symbol="Δt"
            value={config.samplingInterval}
            onChange={(samplingInterval) => set({ samplingInterval })}
            min={1e-9}
            step={0.001}
            unit={`${config.timeUnit}s per sample`}
            hint="The samples are assumed equally spaced by this amount. The entire frequency axis is derived from it: a wrong interval scales every frequency by the same wrong factor."
          />
          <TextField
            label="Name of one time unit"
            value={config.timeUnit}
            onChange={(timeUnit) => set({ timeUnit })}
            maxLength={24}
            hint='Used to label the frequency axis, e.g. "second" gives cycles per second (hertz).'
          />
          <Checkbox
            checked={config.removeMean}
            onChange={(removeMean) => set({ removeMean })}
            label="Subtract the sample mean before transforming"
            description="Pre-processing of the input, not a result. It empties bin 0 and leaves every other bin unchanged; without it the constant offset dominates the chart."
          />
          <Segmented
            label="Spectrum scale"
            value={config.spectrumScale}
            onChange={(spectrumScale) => set({ spectrumScale })}
            options={[
              { value: 'amplitude', label: 'Amplitude 2|X_k|/n' },
              { value: 'power', label: 'Power |X_k|²/n' },
            ]}
          />

          {!config.useBuiltInSignal && parsed.skipped.length > 0 && (
            <Notice tone="warning" title={`${parsed.skipped.length} line${parsed.skipped.length === 1 ? '' : 's'} could not be read`}>
              <p style={{ margin: 0 }}>These lines were not used. Nothing was guessed or filled in for them.</p>
              <div style={{ overflowX: 'auto' }}>
                <DataTable
                  caption="Lines that could not be read"
                  maxHeight={200}
                  columns={[
                    { key: 'line', header: 'Line', numeric: true, render: (r: SkippedLine) => r.line },
                    { key: 'text', header: 'Content', render: (r: SkippedLine) => <code>{r.text}</code> },
                    { key: 'why', header: 'Why it was skipped', render: (r: SkippedLine) => r.reason },
                  ]}
                  rows={parsed.skipped}
                />
              </div>
            </Notice>
          )}
          {!config.useBuiltInSignal && parsed.truncated > 0 && (
            <Notice tone="warning">
              {parsed.truncated.toLocaleString('en-US')} further line{parsed.truncated === 1 ? ' was' : 's were'} ignored: this screen transforms at most{' '}
              {MAX_SAMPLES.toLocaleString('en-US')} samples.
            </Notice>
          )}

          {!spectrum.ok ? (
            <Notice tone="error">{spectrum.error}</Notice>
          ) : (
            <>
              <KeyValueList
                items={[
                  { label: 'Samples (n)', value: spectrum.value.n.toLocaleString('en-US') },
                  { label: 'Source', value: config.useBuiltInSignal ? 'Built-in synthetic signal' : 'Pasted text' },
                  { label: 'Sampling rate f_s = 1/Δt', value: `${formatValue(spectrum.value.fs, 6)} ${freqUnit}` },
                  { label: 'Record length n·Δt', value: `${formatValue(spectrum.value.n * config.samplingInterval, 6)} ${config.timeUnit}s` },
                  { label: 'Frequency resolution f_s/n', value: `${formatValue(spectrum.value.resolution, 6)} ${freqUnit}` },
                  { label: 'Nyquist frequency f_s/2', value: `${formatValue(spectrum.value.nyquist, 6)} ${freqUnit}` },
                  { label: 'Sample mean', value: formatValue(spectrum.value.mean, 8) },
                  {
                    label: 'Transform length',
                    value:
                      nextPowerOfTwo(spectrum.value.n) === spectrum.value.n
                        ? `${spectrum.value.n} — a power of two, so the radix-2 kernel ran`
                        : `${spectrum.value.n} — not a power of two, so Bluestein's chirp-z algorithm ran (no zero padding, no change to the frequency axis)`,
                  },
                  {
                    label: 'Exactness',
                    value: <Badge variant="numerical">{EXACTNESS_LABEL.numerical}</Badge>,
                  },
                ]}
              />
              <Notice tone={spectrum.value.check.holds ? 'success' : 'error'} title="Parseval's identity as a self-check on the transform">
                <p style={{ margin: 0 }}>
                  Σ|x_t|² = {formatValue(spectrum.value.check.timeEnergy, 10)} and (1/n)Σ|X_k|² = {formatValue(spectrum.value.check.frequencyEnergy, 10)}, a
                  relative difference of {spectrum.value.check.relativeError.toExponential(3)} against a tolerance of{' '}
                  {spectrum.value.check.tolerance.toExponential(1)}.
                </p>
                <p style={{ margin: 'var(--s2) 0 0' }}>
                  {spectrum.value.check.holds
                    ? 'This is not a proof that the transform is right, but a transform that violated it would certainly be wrong.'
                    : 'The identity does not hold to tolerance. Treat the spectrum below as unreliable rather than reading frequencies off it.'}
                </p>
              </Notice>
              <LineChart
                title="The signal"
                description={`The ${spectrum.value.n} samples against time, at the assumed spacing of ${config.samplingInterval} ${config.timeUnit}s.`}
                series={[{ label: config.useBuiltInSignal ? 'Built-in signal' : 'Pasted signal', points: signalPoints }]}
                xLabel={`Time (${config.timeUnit}s, assuming Δt = ${config.samplingInterval})`}
                yLabel="Sample value"
                note={config.removeMean ? 'The chart shows the samples as supplied; the mean is subtracted only for the transform.' : undefined}
              />
              <LineChart
                title={`One-sided ${config.spectrumScale} spectrum`}
                description={`The ${config.spectrumScale} of each frequency bin of the discrete Fourier transform, from 0 to the Nyquist frequency.`}
                series={spectrumSeries}
                xLabel={`Frequency (${freqUnit})`}
                yLabel={config.spectrumScale === 'power' ? 'Power |X_k|²/n' : 'Amplitude 2|X_k|/n'}
                note={`Bin k sits at k·f_s/n = k × ${formatValue(spectrum.value.resolution, 6)} ${freqUnit}. Bins run to the Nyquist frequency ${formatValue(spectrum.value.nyquist, 6)} ${freqUnit}; anything faster than that in the underlying signal is aliased into this range rather than shown. No window was applied, so a component between two bin centres leaks into its neighbours.`}
              />
              {spectrum.value.peak && (
                <Notice tone="info" title="Largest bin, read off the transform above">
                  <p style={{ margin: 0 }}>
                    Bin {spectrum.value.peak.k} at {formatValue(spectrum.value.peak.frequency, 6)} {freqUnit}
                    {spectrum.value.peak.period !== null ? `, a period of ${formatValue(spectrum.value.peak.period, 6)} ${config.timeUnit}s` : ''}, amplitude{' '}
                    {formatValue(spectrum.value.peak.amplitude, 6)}.
                  </p>
                  <p style={{ margin: 'var(--s2) 0 0' }}>
                    This is the largest bin of this record, selected from the engine&apos;s transform. It is not a test: no significance is claimed for it, and
                    with a resolution of {formatValue(spectrum.value.resolution, 6)} {freqUnit} a true frequency anywhere inside that bin would look the same.
                  </p>
                </Notice>
              )}
              <div style={{ overflowX: 'auto' }}>
                <DataTable
                  caption="The ten largest bins of the one-sided spectrum"
                  columns={[
                    { key: 'k', header: 'Bin k', numeric: true, render: (r: BinRow) => r.k },
                    { key: 'f', header: `Frequency (${freqUnit})`, numeric: true, render: (r: BinRow) => formatValue(r.frequency, 6) },
                    { key: 'p', header: `Period (${config.timeUnit}s)`, numeric: true, render: (r: BinRow) => (r.period === null ? 'constant term' : formatValue(r.period, 6)) },
                    { key: 'a', header: 'Amplitude 2|X_k|/n', numeric: true, render: (r: BinRow) => formatValue(r.amplitude, 6) },
                    { key: 'pw', header: 'Power |X_k|²/n', numeric: true, render: (r: BinRow) => formatValue(r.power, 6) },
                  ]}
                  rows={[...spectrum.value.bins].sort((a, b) => b.modulus - a.modulus).slice(0, 10)}
                />
              </div>
              <ExplanationPanel explanation={spectrumExplanation} />
            </>
          )}
        </Card>

        <AiAssistPanel
          capability="explainResult"
          context="Every number on this screen — the transform, the amplitude of each bin, the characteristic function, the cumulants, the inverted density and the convolved distribution — is computed by the engine, together with the route it took and its error estimate. The assistant can only help read them; it never produces a number."
        />

        {/* ----------------------------- characteristic function, cumulants */}
        <Card
          title="Characteristic function and cumulants"
          hint="φ(t) = E[e^{itX}] exists for every distribution, which is why it, and not the moment generating function, is what the inversion below uses."
        >
          <SelectField
            label="Distribution"
            value={config.distributionId}
            onChange={(distributionId) => {
              const next = getDistribution(distributionId);
              set({ distributionId, params: defaultParams(next) });
            }}
            options={DISTRIBUTIONS.map((d) => ({ value: d.id, label: `${d.name} (${d.kind})` }))}
            hint={def.description}
          />
          {def.params.map((spec) => (
            <NumberField
              key={spec.key}
              label={spec.label}
              symbol={spec.symbol}
              value={params[spec.key]}
              onChange={(v) => set({ params: { ...params, [spec.key]: v } })}
              step={spec.integer ? 1 : 0.1}
              integer={spec.integer}
              hint={spec.description}
            />
          ))}
          <NumberField
            label="Plot φ on [−t_max, t_max]"
            symbol="t_max"
            value={config.cfMaxT}
            onChange={(cfMaxT) => set({ cfMaxT })}
            min={0.1}
            step={1}
            hint="|φ| decays as t grows for a smooth distribution; how fast it decays is what decides whether the FFT inversion below can be truncated."
          />
          <NumberField
            label="Points on the φ grid"
            value={config.cfPoints}
            onChange={(cfPoints) => set({ cfPoints })}
            min={3}
            max={2001}
            integer
          />
          <NumberField
            label="Highest cumulant reported"
            value={config.cumulantOrder}
            onChange={(cumulantOrder) => set({ cumulantOrder })}
            min={1}
            max={6}
            integer
            hint="κ₁ is the mean and κ₂ the variance. Order 3 and above are obtained by finite differences of the cumulant generating function."
          />

          {formulas.ok && (
            <KeyValueList
              items={[
                { label: 'φ(t)', value: formulas.value.cf ?? 'no closed form in the engine; φ is evaluated numerically' },
                { label: 'M(t)', value: formulas.value.mgf ?? 'no closed form in the engine' },
                { label: 'G(z)', value: formulas.value.pgf ?? (def.kind === 'discrete' ? 'no closed form in the engine' : 'not defined for a continuous distribution') },
              ]}
            />
          )}

          {!cfGrid.ok ? (
            <Notice tone="error">{cfGrid.error}</Notice>
          ) : (
            <>
              <KeyValueList
                items={[
                  { label: 'Route', value: cfGrid.value.route },
                  { label: 'Exactness', value: <Badge variant={cfGrid.value.exactness}>{EXACTNESS_LABEL[cfGrid.value.exactness]}</Badge> },
                  {
                    label: 'φ(0)',
                    value: `${formatValue(cfGrid.value.atZero.value.re, 10)} ${cfGrid.value.atZero.value.im >= 0 ? '+' : '−'} ${formatValue(Math.abs(cfGrid.value.atZero.value.im), 10)}i (must be exactly 1)`,
                  },
                ]}
              />
              <LineChart
                title="The characteristic function"
                description="Real part, imaginary part and modulus of φ(t) against t."
                series={cfSeries}
                xLabel="t"
                yLabel="φ(t)"
                note="|φ(0)| = 1 and |φ(t)| ≤ 1 everywhere; a modulus above 1 would mean the evaluation has gone wrong. For a symmetric distribution Im φ is identically zero."
              />
              {cfGrid.value.rows.some((r) => r.modulus > 1 + 1e-9) && (
                <Notice tone="warning">
                  |φ(t)| exceeds 1 somewhere on this grid, which is impossible for a characteristic function. The engine evaluated φ numerically here; treat the
                  values at large |t| as unreliable and reduce t_max.
                </Notice>
              )}
              {cfGrid.value.rows[0].exactness !== 'exact' && (
                <Notice tone="info" title="φ has no closed form for this distribution" items={cf(def.id, params, config.cfMaxT).notes} />
              )}
            </>
          )}

          {!cumulantResult.ok ? (
            <Notice tone="error">{cumulantResult.error}</Notice>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <DataTable
                  caption="Cumulants and the central moments they imply"
                  columns={[
                    { key: 'r', header: 'Order r', numeric: true, render: (r: CumulantRow) => r.order },
                    { key: 'k', header: 'Cumulant κ_r', numeric: true, render: (r: CumulantRow) => formatValue(r.cumulant, 8) },
                    { key: 'm', header: 'Central moment μ_r', numeric: true, render: (r: CumulantRow) => (r.centralMoment === null ? 'not reported' : formatValue(r.centralMoment, 8)) },
                  ]}
                  rows={cumulantResult.value.cumulants.map((k, i) => ({
                    order: i + 1,
                    cumulant: k,
                    centralMoment: i === 0 ? null : (cumulantResult.value.centralMoments[i - 1] ?? null),
                  }))}
                />
              </div>
              <KeyValueList
                items={[
                  { label: 'Skewness γ₁ = κ₃/κ₂^{3/2}', value: formatValue(cumulantResult.value.skewness, 8) },
                  { label: 'Excess kurtosis γ₂ = κ₄/κ₂²', value: formatValue(cumulantResult.value.excessKurtosis, 8) },
                  { label: 'Route', value: cumulantResult.value.route },
                  {
                    label: 'Exactness',
                    value: <Badge variant={cumulantResult.value.exactness}>{EXACTNESS_LABEL[cumulantResult.value.exactness]}</Badge>,
                  },
                ]}
              />
              <WarningList warnings={cumulantResult.value.notes} />
            </>
          )}
          <ExplanationPanel explanation={cfExplanation} />
        </Card>

        {/* ------------------------------------------------- inversion */}
        <Card
          title="Recovering the distribution from φ"
          hint="A characteristic function determines the distribution completely. These are the two numerical routes back."
        >
          <NumberField
            label="Cosine terms"
            symbol="N"
            value={config.cosTerms}
            onChange={(cosTerms) => set({ cosTerms })}
            min={8}
            max={COS_MAX_TERMS}
            integer
            hint={`The series truncation falls exponentially in N for a smooth density, and far more slowly for one with a kink — a density that is zero below its support boundary, like the default gamma at 0, is such a case. 512 terms runs in a few milliseconds. N is capped at ${COS_MAX_TERMS.toLocaleString('en-US')} because this panel is not behind a button: it recomputes on every change, and N × grid points of cosine series — plus one numerical \u03c6 evaluation per term when \u03c6 has no closed form — stopped the page for over three seconds at the old cap of 16,384.`}
          />
          <NumberField
            label="Interval multiplier"
            symbol="L"
            value={config.cosL}
            onChange={(cosL) => set({ cosL })}
            min={1}
            max={40}
            step={1}
            hint="The truncation interval is [κ₁ ± L√(κ₂ + √κ₄)]. A larger L loses less mass outside the interval but spreads the same N terms over a wider range."
          />
          <NumberField
            label="Points on the plotted grid"
            value={config.cosGridPoints}
            onChange={(cosGridPoints) => set({ cosGridPoints })}
            min={3}
            max={COS_MAX_GRID_POINTS}
            integer
            hint={`Plotting resolution only; it does not change the expansion. Capped at ${COS_MAX_GRID_POINTS.toLocaleString('en-US')} so that the worst case this ungated panel can be asked for stays under a second on one thread.`}
          />

          {!cos.ok ? (
            <Notice tone="error">{cos.error}</Notice>
          ) : (
            <>
              <KeyValueList
                items={[
                  { label: 'Truncation interval [a, b]', value: `[${formatValue(cos.value.expansion.lower, 8)}, ${formatValue(cos.value.expansion.upper, 8)}]` },
                  { label: 'Plotted range (outer 2% excluded)', value: `[${formatValue(cos.value.lo, 8)}, ${formatValue(cos.value.hi, 8)}]` },
                  { label: 'Terms N', value: String(cos.value.expansion.terms) },
                  { label: 'Series-tail proxy N·max|A_k|', value: cos.value.expansion.seriesTailEstimate.toExponential(3) },
                  { label: 'Density error estimate at the interval midpoint', value: cos.value.sampleDensity.diagnostics.errorEstimate.toExponential(3) },
                  { label: 'CDF error estimate at the interval midpoint', value: cos.value.sampleCdf.diagnostics.errorEstimate.toExponential(3) },
                  {
                    label: 'Exactness',
                    value: (
                      <Badge variant={cos.value.sampleDensity.exactness}>{EXACTNESS_LABEL[cos.value.sampleDensity.exactness]}</Badge>
                    ),
                  },
                ]}
              />
              <LineChart
                title="Density from the characteristic function"
                description="The density recovered from φ by the cosine expansion, drawn over the distribution's own density function."
                series={cosSeries}
                xLabel="x"
                yLabel="Density f(x)"
                note="The dashed curve is the engine's closed-form density for the same parameters. The two are computed by completely different routes, so a visible gap between them is a real failure of the inversion settings and not a drawing artefact."
              />
              <LineChart
                title="Distribution function from the characteristic function"
                description="The cosine series integrated term by term, drawn over the distribution's own CDF."
                series={cosCdfSeries}
                xLabel="x"
                yLabel="P(X ≤ x)"
              />
              {cosDiscrepancy && (
                <Notice tone={cosDiscrepancy.worst <= 1e-3 ? 'success' : 'warning'} title="The inversion against the closed-form density">
                  <p style={{ margin: 0 }}>
                    Largest absolute difference on the plotted grid: {cosDiscrepancy.worst.toExponential(3)} at x = {formatValue(cosDiscrepancy.at, 6)}.
                  </p>
                  <p style={{ margin: 'var(--s2) 0 0' }}>
                    This is a comparison of two engine results, not an error bound. The engine&apos;s own series-truncation estimate is above, and it does not
                    include the mass of the distribution lying outside [a, b]. A difference of this size is expected where the density is not smooth: a density
                    that drops to zero at a support boundary gives the cosine series a kink to represent, and the series converges slowly there however large N
                    is. Raising N, or narrowing the interval with a smaller L, is what reduces it.
                  </p>
                </Notice>
              )}
              {cos.value.rows.some((r) => !r.trustworthy) && (
                <Notice tone="warning">
                  The engine withdraws trust from {cos.value.rows.filter((r) => !r.trustworthy).length} of the {cos.value.rows.length} plotted points, because
                  the series-truncation estimate there is not small compared with the value. Raise N, or narrow the interval with a smaller L.
                </Notice>
              )}
            </>
          )}

          <h3>FFT inversion on a uniform grid</h3>
          {!config.runFftInversion ? (
            <>
              <Notice tone="info" title="The FFT inversion is not run automatically">
                <p style={{ marginTop: 0 }}>
                  FFT inversion evaluates φ at every one of the {Math.max(16, Math.min(fftMaxTerms, Math.round(config.fftInversionTerms))).toLocaleString('en-US')} frequencies on the
                  grid. For a distribution with a closed-form φ that is quick; for one without, each of those evaluations is itself a numerical integration, and
                  the page stops responding while they run. It is run only when you ask for it.
                </p>
                <p style={{ marginBottom: 0 }}>
                  The cosine expansion above is the cheaper route and is usually the better one. This route exists because it returns the density on a whole
                  grid at once and makes the frequency truncation explicit.
                </p>
              </Notice>
              <div className="oc-btn-row">
                <Button icon="play" variant="primary" onClick={() => set({ runFftInversion: true })}>
                  Run the FFT inversion
                </Button>
              </div>
            </>
          ) : (
            <>
              <NumberField
                label="Grid points"
                symbol="N"
                value={config.fftInversionTerms}
                onChange={(fftInversionTerms) => set({ fftInversionTerms })}
                min={16}
                max={fftMaxTerms}
                integer
                hint={
                  cfIsExact
                    ? `Rounded up to a power of two, which is what the engine requires. \u03c6 has a closed form for this distribution, so up to ${FFT_MAX_TERMS_EXACT_CF.toLocaleString('en-US')} grid points stays responsive.`
                    : `Rounded up to a power of two, which is what the engine requires. \u03c6 has no closed form for this distribution, so every grid point is a separate numerical integration: the grid is capped at ${FFT_MAX_TERMS_NUMERICAL_CF.toLocaleString('en-US')} points here because ${FFT_MAX_TERMS_EXACT_CF.toLocaleString('en-US')} of them stopped the page for over six seconds.`
                }
              />
              <NumberField
                label="Frequency step"
                symbol="du"
                value={config.fftFrequencyStep}
                onChange={(fftFrequencyStep) => set({ fftFrequencyStep })}
                min={1e-6}
                step={0.01}
                hint="dx·du = 2π/N, so a larger du gives a finer spatial grid over a narrower range, and a higher truncation frequency N·du/2."
              />
              <div className="oc-btn-row">
                <Button onClick={() => set({ runFftInversion: false })}>Stop running it</Button>
              </div>
              {!fftInversion ? null : !fftInversion.ok ? (
                <Notice tone="error">{fftInversion.error}</Notice>
              ) : (
                <>
                  <KeyValueList
                    items={[
                      { label: 'Grid points N', value: String(fftInversion.value.diagnostics.terms) },
                      {
                        label: 'Grid covers',
                        value: fftInversion.value.diagnostics.range
                          ? `[${formatValue(fftInversion.value.diagnostics.range.lower, 8)}, ${formatValue(fftInversion.value.diagnostics.range.upper, 8)}]`
                          : 'not reported',
                      },
                      {
                        label: 'Integral truncated at |u| =',
                        value:
                          fftInversion.value.diagnostics.integrationLimit === undefined
                            ? 'not reported'
                            : formatValue(fftInversion.value.diagnostics.integrationLimit, 6),
                      },
                      { label: 'Error estimate', value: fftInversion.value.diagnostics.errorEstimate.toExponential(3) },
                      { label: 'Trustworthy at these settings', value: fftInversion.value.diagnostics.trustworthy ? 'yes' : 'no' },
                    ]}
                  />
                  <LineChart
                    title="Density from φ by FFT inversion"
                    description="The density on the uniform FFT grid, restricted to the range plotted above for comparability."
                    series={fftInversionSeries}
                    xLabel="x"
                    yLabel="Density f(x)"
                    note="Negative values produced by aliasing and rounding are clipped to zero by the engine and counted in the error estimate above, not hidden."
                  />
                  <WarningList warnings={fftInversion.value.diagnostics.notes} />
                </>
              )}
            </>
          )}
          <ExplanationPanel explanation={inversionExplanation} />
        </Card>

        {/* ----------------------------------------------- convolution */}
        <Card
          title="The exact distribution of a sum, by convolution"
          hint="What a transform buys over simulation: an exact answer in the far tail, where simulation has no samples at all."
        >
          {!config.runConvolution ? (
            <>
              <Notice tone="info" title="The convolution is not run automatically">
                <p style={{ marginTop: 0 }}>
                  The support of a sum of n lattice variables grows linearly in n, so the cost of the exact route grows with its square. A wide component or a
                  large n takes long enough to make the page unresponsive, so the convolution runs only when you ask for it.
                </p>
                <p style={{ marginBottom: 0 }}>
                  The engine chooses between the exact direct route and the FFT route by problem size and reports which one ran, so the answer always says
                  whether it is exact or numerical.
                </p>
              </Notice>
              <div className="oc-btn-row">
                <Button icon="play" variant="primary" onClick={() => set({ runConvolution: true })}>
                  Run the convolution
                </Button>
              </div>
            </>
          ) : (
            <>
              <SelectField
                label="Component distribution (discrete only)"
                value={convolutionDef.id}
                onChange={(convolutionId) => {
                  const next = getDistribution(convolutionId);
                  set({ convolutionId, convolutionParams: defaultParams(next) });
                }}
                options={discreteOptions}
                hint="A lattice convolution needs a distribution on a common arithmetic grid, so only the discrete families are offered here."
              />
              {convolutionDef.params.map((spec) => (
                <NumberField
                  key={spec.key}
                  label={spec.label}
                  symbol={spec.symbol}
                  value={convolutionParams[spec.key]}
                  onChange={(v) => set({ convolutionParams: { ...convolutionParams, [spec.key]: v } })}
                  step={spec.integer ? 1 : 0.1}
                  integer={spec.integer}
                  hint={spec.description}
                />
              ))}
              <NumberField
                label="Number of independent copies summed"
                symbol="n"
                value={config.convolutionN}
                onChange={(convolutionN) => set({ convolutionN })}
                min={1}
                max={2000}
                integer
                hint="Computed by binary powering: ⌊log₂ n⌋ squarings plus one product per set bit, so n = 1000 costs about 14 convolutions rather than 999."
              />
              <Segmented
                label="Route"
                value={config.convolutionRoute}
                onChange={(convolutionRoute) => set({ convolutionRoute })}
                options={[
                  { value: 'auto', label: 'Let the engine choose' },
                  { value: 'direct', label: 'Direct (exact)' },
                  { value: 'fft', label: 'FFT (numerical)' },
                ]}
              />
              <div className="oc-btn-row">
                <Button onClick={() => set({ runConvolution: false })}>Stop running it</Button>
              </div>
              {!convolution ? null : !convolution.ok ? (
                <Notice tone="error">{convolution.error}</Notice>
              ) : (
                <>
                  <KeyValueList
                    items={[
                      { label: 'Sum', value: `${config.convolutionN} independent copies of ${convolutionDef.name}` },
                      {
                        label: 'Component lattice',
                        value: `${convolution.value.base.lattice.p.length.toLocaleString('en-US')} points from ${convolution.value.base.lower} to ${convolution.value.base.upper}`,
                      },
                      { label: 'Mass omitted by truncating it', value: convolution.value.base.omittedMass.toExponential(3) },
                      { label: 'Route taken', value: convolution.value.result.route },
                      { label: 'Pairwise convolutions performed', value: String(convolution.value.result.convolutions) },
                      {
                        label: 'Support of the sum',
                        value: `${formatValue(convolution.value.values[0], 6)} to ${formatValue(convolution.value.values[convolution.value.values.length - 1], 6)} (${convolution.value.values.length.toLocaleString('en-US')} points)`,
                      },
                      { label: 'Total mass', value: formatValue(convolution.value.result.totalMass, 12) },
                      {
                        label: 'Exactness',
                        value: (
                          <Badge variant={convolution.value.result.exactness}>{EXACTNESS_LABEL[convolution.value.result.exactness]}</Badge>
                        ),
                      },
                    ]}
                  />
                  <Notice tone="warning" title="Independence is an assumption here, not a result">
                    The convolution is the distribution of the sum only if the n copies are independent. If they are not, the marginals do not determine the
                    distribution of the sum at all and only bounds could be reported — nothing on this panel detects dependence.
                  </Notice>
                  <BarChart
                    title={`Distribution of the sum of ${config.convolutionN} copies`}
                    description={`Probability of each attainable value of the sum of ${config.convolutionN} independent ${convolutionDef.name} variables.`}
                    data={convolutionBars}
                    xLabel="Value of the sum"
                    yLabel="Probability"
                    seriesLabel="Probability"
                    note={`Values carrying less than 1e-9 of probability are outside the plotted window, and a long support is thinned for drawing. The total mass of the result is ${formatValue(convolution.value.result.totalMass, 12)}; a drift away from 1 is the truncation of the component lattice, not a defect of the convolution.`}
                  />
                  <WarningList warnings={convolution.value.result.notes} />
                </>
              )}
            </>
          )}
          <ExplanationPanel explanation={convolutionExplanation} />
        </Card>

        {/* --------------------------------------------- exactness table */}
        <Card title="What is exact here and what is not" hint="Each result on this screen carries one of the four labels, for a stated reason.">
          <div style={{ overflowX: 'auto' }}>
            <DataTable
              caption="Exactness of each result on this screen"
              columns={[
                { key: 'r', header: 'Result', render: (r: ExactnessRow) => r.result },
                { key: 'e', header: 'Label', render: (r: ExactnessRow) => <Badge variant={r.exactness}>{EXACTNESS_LABEL[r.exactness]}</Badge> },
                { key: 'w', header: 'Why', render: (r: ExactnessRow) => r.why },
              ]}
              rows={EXACTNESS_ROWS}
            />
          </div>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ row types */

interface BinRow {
  k: number;
  frequency: number;
  period: number | null;
  amplitude: number;
  power: number;
  modulus: number;
}

interface CumulantRow {
  order: number;
  cumulant: number;
  centralMoment: number | null;
}

interface ExactnessRow {
  result: string;
  exactness: Exactness;
  why: string;
}

const EXACTNESS_ROWS: ExactnessRow[] = [
  {
    result: 'The discrete Fourier transform and the amplitude of each bin',
    exactness: 'numerical',
    why: 'The transform of the given numbers is a finite sum, limited only by floating-point rounding; Parseval’s identity is reported so that rounding is visible rather than claimed away.',
  },
  {
    result: 'Frequencies, the Nyquist limit and the resolution',
    exactness: 'assumed',
    why: 'Every one of them is the bin index times f_s/n, and f_s comes from the sampling interval you supplied. A wrong interval scales them all.',
  },
  {
    result: 'The characteristic function where a closed form exists',
    exactness: 'exact',
    why: 'Evaluated from the analytic formula shown, with no truncation or iteration.',
  },
  {
    result: 'The characteristic function where no closed form exists',
    exactness: 'numerical',
    why: 'A quadrature or summation on a truncated range; the engine reports the truncation and the |t| beyond which the oscillation is no longer resolved.',
  },
  {
    result: 'Cumulants of order 3 and above',
    exactness: 'numerical',
    why: 'Richardson-extrapolated central differences of the cumulant generating function at t = 0, so they carry a differentiation error.',
  },
  {
    result: 'Density and CDF recovered from φ (COS and FFT routes)',
    exactness: 'numerical',
    why: 'A truncated series over a truncated interval. Both truncations are reported, and the engine refuses points where the periodic extension of the series would contaminate the value.',
  },
  {
    result: 'The distribution of the sum by the direct convolution route',
    exactness: 'exact',
    why: 'A finite sum of products over the component lattice, exact up to rounding — net of whatever mass the component lattice itself omits, which is reported.',
  },
  {
    result: 'The distribution of the sum by the FFT convolution route',
    exactness: 'numerical',
    why: 'The product of transforms inverted back, which leaves a small negative and imaginary residue; the engine reports the largest one.',
  },
  {
    result: 'Distribution parameters, the sampling interval and n',
    exactness: 'assumed',
    why: 'Your choices, not results. Every number above them depends on them being right.',
  },
];

/** The engine's own notes and warnings, never paraphrased and never hidden. */
function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <Notice
      tone="info"
      title={warnings.length === 1 ? 'One note from the engine' : `${warnings.length} notes from the engine`}
      items={warnings}
    />
  );
}
