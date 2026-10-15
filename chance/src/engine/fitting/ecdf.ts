/**
 * Empirical distribution function with Dvoretzky–Kiefer–Wolfowitz bands.
 *
 * This is the honest fallback when no parametric family fits: it assumes only
 * that the observations are independent and identically distributed. The DKW
 * band is simultaneous over all x (Massart's tight constant), which is a
 * stronger and more useful statement than a pointwise band.
 */
import { EngineError } from '../core/result';
import { sortedCopy } from '../stats/descriptive';

export interface EcdfBandPoint {
  x: number;
  ecdf: number;
  low: number;
  high: number;
}

export interface EcdfResult {
  n: number;
  points: EcdfBandPoint[];
  /** Half-width of the band, constant in x. */
  epsilon: number;
  level: number;
  method: string;
  caveats: string[];
}

export function ecdfWithDkwBand(data: ArrayLike<number>, level = 0.95): EcdfResult {
  const n = data.length;
  if (n < 2) throw new EngineError('An empirical distribution needs at least 2 observations.', 'insufficient');
  if (!(level > 0 && level < 1)) throw new EngineError('Confidence level must be between 0 and 1.', 'range');
  const alpha = 1 - level;
  const epsilon = Math.sqrt(Math.log(2 / alpha) / (2 * n));
  const sorted = sortedCopy(data);
  const points: EcdfBandPoint[] = [];
  for (let i = 0; i < n; i++) {
    if (i + 1 < n && sorted[i + 1] === sorted[i]) continue;
    const f = (i + 1) / n;
    points.push({ x: sorted[i], ecdf: f, low: Math.max(0, f - epsilon), high: Math.min(1, f + epsilon) });
  }
  return {
    n,
    points,
    epsilon,
    level,
    method: `Dvoretzky–Kiefer–Wolfowitz band with Massart's constant: |F̂(x) − F(x)| ≤ √(ln(2/α) / 2n) = ${epsilon.toPrecision(6)} simultaneously for all x, with probability at least ${level}.`,
    caveats: [
      'The band is simultaneous over all x, so it is wider than a pointwise interval at any single x — and correspondingly stronger.',
      'It assumes only independent, identically distributed observations. No distributional family is assumed.',
      'The band is conservative: actual coverage exceeds the stated level, especially in the tails where the true variance of F̂ is small.',
    ],
  };
}
