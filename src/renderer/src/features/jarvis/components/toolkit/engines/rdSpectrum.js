/** Full two-dimensional radix-2 FFT with signed frequencies and Parseval-normalized radial power. */
function fft1(re, im, n, stride, offset) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { const a = offset + i * stride, b = offset + j * stride; [re[a], re[b]] = [re[b], re[a]]; [im[a], im[b]] = [im[b], im[a]]; }
  }
  for (let len = 2; len <= n; len <<= 1) for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
    const angle = -2 * Math.PI * k / len, wr = Math.cos(angle), wi = Math.sin(angle), a = offset + (i + k) * stride, b = offset + (i + k + len / 2) * stride;
    const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
    re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
  }
}
export function powerSpectrum(field, n = field.n) {
  if (n & (n - 1)) throw new Error('FFT requires a power-of-two grid.');
  const mean = field.u.reduce((s, v) => s + v, 0) / field.u.length, re = Float64Array.from(field.u, v => v - mean), im = new Float64Array(n * n);
  for (let y = 0; y < n; y++) fft1(re, im, n, 1, y * n);
  for (let x = 0; x < n; x++) fft1(re, im, n, n, x);
  const bins = new Array(Math.ceil(Math.SQRT2 * n / 2) + 1).fill(0); let peak = { power: 0, nx: 0, ny: 0, k: 0 };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!x && !y) continue;
    const nx = x <= n / 2 ? x : x - n, ny = y <= n / 2 ? y : y - n, k = Math.hypot(nx, ny), p = (re[y * n + x] ** 2 + im[y * n + x] ** 2) / n ** 4;
    bins[Math.round(k)] += p; if (p > peak.power) peak = { power: p, nx, ny, k };
  }
  const total = bins.reduce((s, v) => s + v, 0), safe = total || 1;
  return { peak, total, bins: bins.map((v, i) => ({ x: i, y: v / safe })), ringFraction: bins[Math.round(peak.k)] / safe };
}
export function classifyPattern(stats, spectrum, temporalSpread = 0) {
  if (stats.rms < 1e-3) return 'near-uniform';
  if (temporalSpread > 0.35) return 'time-varying';
  if (spectrum.ringFraction > 0.55) return 'narrow-band pattern';
  return 'broad-band pattern';
}