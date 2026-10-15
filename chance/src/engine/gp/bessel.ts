/**
 * Modified Bessel function of the second kind, K_ν(x), for real order.
 *
 * Needed only by the general-ν Matérn kernel; ν = 1/2, 3/2, 5/2 have closed
 * forms and never reach this file.
 *
 * Method: the integral representation
 *
 *     K_ν(x) = ∫₀^∞ exp(−x·cosh t)·cosh(ν t) dt      (x > 0)
 *
 * evaluated by the trapezoidal rule. The integrand is analytic and decays
 * like exp(−x·e^t/2), so the trapezoidal rule converges geometrically in the
 * step size; the integration window is located by first finding the peak of
 * the log-integrand and then walking outwards until it has fallen 80 natural
 * logs, which is below double-precision relevance. Summation is done relative
 * to the peak so that the large values K_ν takes for small x do not overflow
 * intermediate terms.
 *
 * Validated in the tests against the closed form K_{1/2}(x) = √(π/2x)·e^{−x},
 * which is an independent reference.
 */
import { EngineError } from '../core/result';

/** log(cosh(z)) without overflow. */
function logCosh(z: number): number {
  const a = Math.abs(z);
  if (a > 20) return a - Math.LN2 + Math.log1p(Math.exp(-2 * a));
  return Math.log(Math.cosh(a));
}

export function besselK(order: number, x: number): number {
  if (!Number.isFinite(order)) {
    throw new EngineError('The Bessel order must be a finite number.', 'finite');
  }
  if (!(x > 0) || !Number.isFinite(x)) {
    throw new EngineError(
      `K_ν(x) is defined for x > 0; received x = ${x}. The Matérn kernel must not call it at zero separation.`,
      'range',
    );
  }
  // K_{−ν} = K_{ν}.
  const v = Math.abs(order);
  const logf = (t: number): number => -x * Math.cosh(t) + logCosh(v * t);

  // Locate the peak of the log-integrand on a coarse grid.
  let tStar = 0;
  let peak = logf(0);
  for (let t = 0.05; t <= 80; t += 0.05) {
    const value = logf(t);
    if (value > peak) {
      peak = value;
      tStar = t;
    } else if (t > tStar + 1 && value < peak - 120) {
      break;
    }
  }

  // Window: walk out from the peak until the log-integrand has fallen 80.
  let tEnd = tStar;
  while (tEnd < 100 && logf(tEnd) > peak - 80) tEnd += 0.25;
  let tBegin = tStar;
  while (tBegin > 0 && logf(tBegin) > peak - 80) tBegin -= 0.25;
  if (tBegin < 0) tBegin = 0;

  // A narrow peak (large x) needs a finer step; the peak width scales as
  // 1/√x for large x because cosh t ≈ 1 + t²/2 near the origin.
  const h = Math.min(0.01, 0.25 / Math.sqrt(1 + x));
  const steps = Math.ceil((tEnd - tBegin) / h);
  let sum = 0;
  for (let i = 0; i <= steps; i++) {
    const t = tBegin + i * h;
    const w = i === 0 || i === steps ? 0.5 : 1;
    sum += w * Math.exp(logf(t) - peak);
  }
  const value = sum * h * Math.exp(peak);
  if (!Number.isFinite(value)) {
    throw new EngineError(
      `K_${order}(${x}) overflowed double precision. The general-ν Matérn kernel cannot be evaluated at this separation and length scale; use ν = 1/2, 3/2 or 5/2, whose closed forms are stable.`,
      'numerical',
    );
  }
  return value;
}
