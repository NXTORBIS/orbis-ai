/**
 * Computed tomography.
 *
 * Three independent routes to the same image, which is what makes the checks meaningful:
 *  · the Radon transform of an elliptical phantom is exact — a closed-form chord length per
 *    ellipse — so the sinogram is a real measurement, not a resampling of a picture;
 *  · the ramp kernel of the filtered backprojection comes from sampling the continuous
 *    transform of |ω| at the detector spacing, which fixes its scale;
 *  · SIRT shares one system matrix with the reprojection, so data consistency, the residual
 *    curve and the image all follow from the same algebraic model.
 */

const DEG = Math.PI / 180;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const rng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const PHANTOMS = {
  'shepp-logan': {
    label: 'Shepp–Logan head',
    note: 'Ten ellipses with the classic low-contrast values — the standard object for judging reconstruction quality.',
    ellipses: [
      { rho: 2, a: 0.69, b: 0.92, x: 0, y: 0, phi: 0 },
      { rho: -0.98, a: 0.6624, b: 0.874, x: 0, y: -0.0184, phi: 0 },
      { rho: -0.02, a: 0.11, b: 0.31, x: 0.22, y: 0, phi: -18 },
      { rho: -0.02, a: 0.16, b: 0.41, x: -0.22, y: 0, phi: 18 },
      { rho: 0.01, a: 0.21, b: 0.25, x: 0, y: 0.35, phi: 0 },
      { rho: 0.01, a: 0.046, b: 0.046, x: 0, y: 0.1, phi: 0 },
      { rho: 0.01, a: 0.046, b: 0.046, x: 0, y: -0.1, phi: 0 },
      { rho: 0.01, a: 0.046, b: 0.023, x: -0.08, y: -0.605, phi: 0 },
      { rho: 0.01, a: 0.023, b: 0.023, x: 0, y: -0.606, phi: 0 },
      { rho: 0.01, a: 0.023, b: 0.046, x: 0.06, y: -0.605, phi: 0 },
    ],
  },
  disk: {
    label: 'Uniform disk',
    note: 'One uniform ellipse: the single object whose reconstruction has a closed form, which is what the scale of the ramp filter is measured against.',
    ellipses: [{ rho: 1, a: 0.62, b: 0.62, x: 0, y: 0, phi: 0 }],
  },
  rings: {
    label: 'Concentric rings',
    note: 'Sharp density steps against a small difference — the hardest case for a ramp filter and the clearest place to see streaks.',
    ellipses: [
      { rho: 1, a: 0.88, b: 0.88, x: 0, y: 0, phi: 0 },
      { rho: -0.45, a: 0.62, b: 0.62, x: 0, y: 0, phi: 0 },
      { rho: 0.55, a: 0.4, b: 0.4, x: 0, y: 0, phi: 0 },
      { rho: -0.3, a: 0.18, b: 0.18, x: 0, y: 0, phi: 0 },
    ],
  },
  bars: {
    label: 'Resolution bars',
    note: 'Alternating thin elliptical bars at fixed spatial frequency: detector spacing and filtering change recovered contrast and edge sharpness.',
    ellipses: [
      { rho: 1, a: 0.9, b: 0.9, x: 0, y: 0, phi: 0 },
      ...[-0.78, -0.58, -0.38, -0.18, 0.02, 0.22, 0.42, 0.62].map((x, index) => ({ rho: index % 2 === 0 ? -0.9 : 0.9, a: 0.045, b: 0.32, x, y: 0, phi: 0 })),
    ],
  },
  tilted: {
    label: 'Tilted ellipses',
    note: 'Ellipses at oblique angles: the projection of an ellipse changes shape with angle, so the sinogram is genuinely two-dimensional.',
    ellipses: [
      { rho: 1, a: 0.85, b: 0.5, x: 0, y: 0, phi: 25 },
      { rho: -0.4, a: 0.3, b: 0.16, x: -0.3, y: 0.28, phi: -40 },
      { rho: 0.6, a: 0.22, b: 0.34, x: 0.34, y: -0.22, phi: 70 },
      { rho: 0.3, a: 0.12, b: 0.12, x: 0.1, y: 0.5, phi: 0 },
    ],
  },
};

/** Apodization windows, each a plain function of the normalised frequency. */
export const FILTERS = {
  ramp: { label: 'Ramp (Ram-Lak)', note: 'No apodization: maximum resolution, maximum noise.', window: () => 1 },
  hann: { label: 'Hann', note: 'Smooth roll-off: less noise, visible loss of edge sharpness.', window: (u) => 0.5 * (1 + Math.cos(Math.PI * u)) },
  cosine: { label: 'Cosine', note: 'The middle ground between resolution and noise.', window: (u) => Math.cos((Math.PI * u) / 2) },
  'shepp-logan': { label: 'Shepp–Logan', note: 'A sinc roll-off tuned for object outlines.', window: (u) => (u < 1e-6 ? 1 : Math.sin((Math.PI * u) / 2) / ((Math.PI * u) / 2)) },
};

const ellipsesOf = (name) => PHANTOMS[name].ellipses;

/** The phantom sampled at pixel centres — the same grid the reconstruction lands on. */
export function rasterize(name, n, extent = 1) {
  const image = new Float64Array(n * n);
  for (let iy = 0; iy < n; iy += 1) {
    const y = (((iy + 0.5) / n) * 2 - 1) * extent;
    for (let ix = 0; ix < n; ix += 1) {
      const x = (((ix + 0.5) / n) * 2 - 1) * extent;
      let value = 0;
      ellipsesOf(name).forEach((e) => {
        const cos = Math.cos(e.phi * DEG);
        const sin = Math.sin(e.phi * DEG);
        const dx = x - e.x;
        const dy = y - e.y;
        const u = (cos * dx + sin * dy) / e.a;
        const v = (-sin * dx + cos * dy) / e.b;
        if (u * u + v * v <= 1) value += e.rho;
      });
      image[iy * n + ix] = value;
    }
  }
  return image;
}

/**
 * Analytic Radon transform. For each ellipse the line integral is the chord length through
 * it: the line maps to a line in the ellipse's unit circle, whose quadratic gives the chord
 * in the mapped parameter, and the map's stretch along the line converts it back.
 */
export function radon(name, { angles = 90, detectors = 96, extent = 1, noise = 0, seed = 5 } = {}) {
  const ds = (2 * extent) / detectors;
  const sinogram = new Float64Array(angles * detectors);
  const masses = new Float64Array(angles);
  let peak = 0;
  for (let a = 0; a < angles; a += 1) {
    const theta = (Math.PI * a) / angles;
    const nx = Math.cos(theta);
    const ny = Math.sin(theta);
    const dx = -ny;
    const dy = nx;
    let mass = 0;
    for (let j = 0; j < detectors; j += 1) {
      const t = (j - (detectors - 1) / 2) * ds;
      let value = 0;
      ellipsesOf(name).forEach((e) => {
        const cos = Math.cos(e.phi * DEG);
        const sin = Math.sin(e.phi * DEG);
        const bx = t * nx - e.x;
        const by = t * ny - e.y;
        const ax = (cos * bx + sin * by) / e.a;
        const ay = (-sin * bx + cos * by) / e.b;
        const mxx = (cos * dx + sin * dy) / e.a;
        const myy = (-sin * dx + cos * dy) / e.b;
        const bb = mxx * mxx + myy * myy;
        const ab = ax * mxx + ay * myy;
        const aa = ax * ax + ay * ay;
        const discriminant = ab * ab - bb * (aa - 1);
        if (discriminant > 0 && bb > 0) value += (e.rho * 2 * Math.sqrt(discriminant)) / bb;
      });
      sinogram[a * detectors + j] = value;
      mass += value * ds;
      peak = Math.max(peak, Math.abs(value));
    }
    masses[a] = mass;
  }
  if (noise > 0) {
    const random = rng(seed);
    for (let i = 0; i < sinogram.length; i += 1) {
      const gaussian = (random() + random() + random() + random() - 2) * 0.7071;
      sinogram[i] += gaussian * noise * peak;
    }
  }
  return { sinogram, masses, angles, detectors, ds, peak, extent, dsMass: (2 * extent) / detectors };
}

/** Iterative in-place FFT (forward sign = −1 when inverse is false). */
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/**
 * Ramp filtering in the frequency domain. With the projection sampled at Δs, the continuous
 * filtered projection is q = IFFT(|k|·P) / (N·Δs) — the padding and the window only change
 * the bandwidth, never that scale.
 */
export function filterProjections(scan, filter = 'ramp') {
  const { sinogram, angles, detectors, ds } = scan;
  const window = FILTERS[filter] ? FILTERS[filter].window : FILTERS.ramp.window;
  let pad = 1;
  while (pad < detectors * 2) pad <<= 1;
  const filtered = new Float64Array(angles * detectors);
  for (let a = 0; a < angles; a += 1) {
    const re = new Float64Array(pad);
    const im = new Float64Array(pad);
    for (let j = 0; j < detectors; j += 1) re[j] = sinogram[a * detectors + j];
    fft(re, im);
    for (let k = 0; k < pad; k += 1) {
      const signed = k <= pad / 2 ? k : k - pad;
      const u = Math.min(1, Math.abs(signed) / (pad / 2));
      const weight = (Math.abs(signed) / (pad * ds)) * window(u);
      re[k] *= weight;
      im[k] *= weight;
    }
    fft(re, im, true);
    for (let j = 0; j < detectors; j += 1) filtered[a * detectors + j] = re[j];
  }
  return filtered;
}

/** Backprojection with linear interpolation in the detector coordinate. */
export function backproject(filtered, { angles, detectors, ds, extent, n }) {
  const image = new Float64Array(n * n);
  const scale = Math.PI / angles;
  for (let a = 0; a < angles; a += 1) {
    const theta = (Math.PI * a) / angles;
    const cx = Math.cos(theta);
    const cy = Math.sin(theta);
    for (let iy = 0; iy < n; iy += 1) {
      const y = (((iy + 0.5) / n) * 2 - 1) * extent;
      for (let ix = 0; ix < n; ix += 1) {
        const x = (((ix + 0.5) / n) * 2 - 1) * extent;
        const position = (x * cx + y * cy) / ds + (detectors - 1) / 2;
        const base = Math.floor(position);
        if (base < -1 || base > detectors - 1) continue;
        const frac = position - base;
        const left = base >= 0 && base < detectors ? filtered[a * detectors + base] : 0;
        const right = base + 1 >= 0 && base + 1 < detectors ? filtered[a * detectors + base + 1] : 0;
        image[iy * n + ix] += left * (1 - frac) + right * frac;
      }
    }
  }
  for (let i = 0; i < image.length; i += 1) image[i] *= scale;
  return image;
}

/**
 * Exact ray/pixel chord lengths from grid-line intersections (piecewise-constant pixels).
 * Sparse row sums and inverse column sums provide the SIRT normalization.
 */
export function systemMatrix({ angles, detectors, ds, extent, n }) {
  const rows = [], norms = new Float64Array(angles * detectors);
  const column = new Float64Array(n * n), cell = 2 * extent / n;
  for (let a = 0; a < angles; a += 1) {
    const theta = Math.PI * a / angles, nx = Math.cos(theta), ny = Math.sin(theta);
    const dx = -ny, dy = nx;
    for (let j = 0; j < detectors; j += 1) {
      const t = (j - (detectors - 1) / 2) * ds, px = t * nx, py = t * ny;
      let low = -Infinity, high = Infinity;
      for (const [p, v] of [[px, dx], [py, dy]]) {
        if (Math.abs(v) < 1e-12) { if (Math.abs(p) >= extent) high = -Infinity; }
        else { const u = (-extent - p) / v, w = (extent - p) / v; low = Math.max(low, Math.min(u, w)); high = Math.min(high, Math.max(u, w)); }
      }
      const row = [];
      if (high > low) {
        const crossings = [low, high];
        for (let k = 1; k < n; k += 1) {
          for (const [p, v] of [[px, dx], [py, dy]]) {
            if (Math.abs(v) < 1e-12) continue;
            const s = (-extent + k * cell - p) / v;
            if (s > low && s < high) crossings.push(s);
          }
        }
        crossings.sort((u, v) => u - v);
        for (let k = 1; k < crossings.length; k += 1) {
          const weight = crossings[k] - crossings[k - 1];
          if (weight < 1e-12) continue;
          const mid = (crossings[k] + crossings[k - 1]) / 2;
          const ix = Math.min(n - 1, Math.max(0, Math.floor((px + mid * dx + extent) / cell)));
          const iy = Math.min(n - 1, Math.max(0, Math.floor((py + mid * dy + extent) / cell)));
          row.push([iy * n + ix, weight]);
          norms[a * detectors + j] += weight;
          column[iy * n + ix] += weight;
        }
      }
      rows.push(row);
      if (!norms[a * detectors + j]) norms[a * detectors + j] = 1;
    }
  }
  for (let i = 0; i < column.length; i += 1) column[i] = column[i] > 1e-12 ? 1 / column[i] : 0;
  return { rows, norms, column };
}

export function forward(matrix, image) {
  return matrix.rows.map((row) => row.reduce((sum, [pixel, weight]) => sum + weight * image[pixel], 0));
}

/** Simultaneous iterative reconstruction: one residual pass, one backprojection pass. */
export function sirt(scan, { n = 40, extent = 1, iterations = 8, relaxation = 1 } = {}) {
  const { sinogram, angles, detectors } = scan;
  const matrix = systemMatrix({ angles, detectors, ds: scan.ds, extent, n });
  let image = new Float64Array(n * n);
  const measured = Array.from(sinogram);
  const frames = [];
  const curve = [];
  const keep = 1;
  for (let step = 0; step <= iterations; step += 1) {
    if (step > 0) {
      const projected = forward(matrix, image);
      const correction = new Float64Array(n * n);
      for (let row = 0; row < matrix.rows.length; row += 1) {
        const residual = (measured[row] - projected[row]) / matrix.norms[row];
        if (residual === 0) continue;
        matrix.rows[row].forEach(([pixel, weight]) => { correction[pixel] += weight * residual; });
      }
      for (let i = 0; i < image.length; i += 1) image[i] += relaxation * matrix.column[i] * correction[i];
      for (let i = 0; i < image.length; i += 1) if (image[i] < 0) image[i] = 0;
    }
    const projected = forward(matrix, image);
    let residual = 0;
    let magnitude = 0;
    for (let row = 0; row < measured.length; row += 1) {
      residual += (measured[row] - projected[row]) ** 2;
      magnitude += measured[row] ** 2;
    }
    curve.push({ iteration: step, residual: magnitude > 0 ? Math.sqrt(residual / magnitude) : 0 });
    if (step === 0 || step === iterations || step % keep === 0) frames.push(Array.from(image));
  }
  return { image, frames, curve, matrix, measured };
}

export function reproject(image, scan, { n = 40, extent = 1 } = {}) {
  const matrix = systemMatrix({ angles: scan.angles, detectors: scan.detectors, ds: scan.ds, extent, n });
  return forward(matrix, image);
}

const rmse = (a, b) => {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += (a[i] - b[i]) ** 2;
  return Math.sqrt(total / a.length);
};

const psnr = (a, b) => {
  const error = rmse(a, b);
  if (!error) return 99;
  let low = Infinity;
  let high = -Infinity;
  a.forEach((value) => { low = Math.min(low, value); high = Math.max(high, value); });
  const range = high - low || 1;
  return 20 * Math.log10(range / error);
};



export function ctAnalyze(options = {}) {
  const name = PHANTOMS[options.phantom] ? options.phantom : 'shepp-logan';
  let angles = Math.round(clamp(Number(options.angles) || 60, 12, 180));
  let detectors = Math.round(clamp(Number(options.detectors) || 80, 24, 160));
  const n = Math.round(clamp(Number(options.n) || 40, 24, 64));
  const noise = clamp(Number(options.noise) || 0, 0, 0.06);
  const iterations = Math.round(clamp(Number(options.iterations) || 16, 1, 40));
  const filter = FILTERS[options.filter] ? options.filter : 'ramp';
  let extent = 1, truth = rasterize(name, n), scan;
  if (options.input?.trim()) {
    const input = JSON.parse(options.input), projections = input.projections;
    if (!Array.isArray(projections) || projections.length < 8 || projections.length > 180) throw new Error('Provide 8–180 equally spaced projections covering 0° to 180° (endpoint excluded).');
    detectors = projections[0]?.length; angles = projections.length;
    if (!Number.isInteger(detectors) || detectors < 16 || detectors > 160 || projections.some(row => !Array.isArray(row) || row.length !== detectors || row.some(v => typeof v !== 'number' || !Number.isFinite(v)))) throw new Error('Each projection must contain the same 16–160 finite detector readings.');
    extent = input.extent ?? 1;
    if (!Number.isFinite(extent) || extent <= 0 || extent > 1000) throw new Error('Extent must be a positive half-width no greater than 1000.');
    const ds = 2 * extent / detectors, sinogram = new Float64Array(projections.flat());
    scan = { angles, detectors, ds, extent, sinogram, masses: projections.map(row => row.reduce((a,b) => a+b,0)*ds) };
    truth = null;
  } else scan = radon(name, { angles, detectors, extent, noise });
  const fbp = Array.from(backproject(filterProjections(scan, filter), { angles, detectors, ds: scan.ds, extent, n }));
  const algebraic = sirt(scan, { n, extent, iterations });
  const projected = forward(algebraic.matrix, fbp);
  const magnitude = Array.from(scan.sinogram).reduce((s,v) => s+v*v,0);
  const metrics = image => ({ rmse: truth ? rmse(image, truth) : null, psnr: truth ? psnr(truth, image) : null });
  return {
    name: truth ? name : 'custom', label: truth ? PHANTOMS[name].label : 'Pasted parallel-beam measurements',
    note: 'Parallel-beam, full half-turn reconstruction; educational inverse-problem model, not a clinical tool.',
    n, angles, detectors, extent, ds: scan.ds, filter, filterLabel: FILTERS[filter].label,
    phantom: truth ? Array.from(truth) : null,
    sinogram: { values: Array.from(scan.sinogram), rows: angles, cols: detectors },
    projections: Array.from({length:angles},(_,a) => Array.from(scan.sinogram.slice(a*detectors,(a+1)*detectors))),
    fbp, sirt: Array.from(algebraic.image), frames: algebraic.frames,
    curve: algebraic.curve.map((point,i) => ({...point, rmse: truth ? rmse(algebraic.frames[i],truth) : null})),
    metrics: { fbp: {...metrics(fbp), residual: magnitude ? Math.sqrt(projected.reduce((s,v,i)=>s+(v-scan.sinogram[i])**2,0)/magnitude):0}, sirt: {...metrics(algebraic.image), residual: algebraic.curve.at(-1).residual} },
    massByAngle: Array.from(scan.masses), iterations,
  };
}

export function verifyCt() {
  const checks = [];
  const push = (label, ok, detail) => checks.push({ label, ok, detail });

  const disk = radon('disk', { angles: 8, detectors: 160, extent: 1 });
  let worst = 0;
  for (let j = 0; j < disk.detectors; j += 1) {
    const t = (j - (disk.detectors - 1) / 2) * disk.ds;
    if (Math.abs(t) > 0.55) continue;
    const expected = 2 * Math.sqrt(0.62 * 0.62 - t * t);
    worst = Math.max(worst, Math.abs(disk.sinogram[j] - expected) / Math.max(expected, 1e-6));
  }
  push('Analytic Radon of a disk matches its closed form', worst < 1e-9, `max relative deviation ${worst.toExponential(1)}`);

  const massErrors = ['shepp-logan', 'rings', 'tilted'].map((name) => {
    const scan = radon(name, { angles: 12, detectors: 240, extent: 1 });
    const truth = PHANTOMS[name].ellipses.reduce((sum, e) => sum + e.rho * Math.PI * e.a * e.b, 0);
    let error = 0;
    for (let a = 0; a < scan.angles; a += 1) error = Math.max(error, Math.abs(scan.masses[a] - truth) / Math.abs(truth));
    return error;
  });
  push('Line-integral mass is angle-independent and equals the phantom mass', Math.max(...massErrors) < 0.01, `worst relative error ${Math.max(...massErrors).toExponential(1)}`);

  const full = radon('disk', { angles: 180, detectors: 168, extent: 1 });
  const diskImage = backproject(filterProjections(full, 'ramp'), { angles: 180, detectors: 168, ds: full.ds, extent: 1, n: 48 });
  const centre = diskImage[24 * 48 + 24];
  push('Filtered backprojection recovers a disk at its true density', Math.abs(centre - 1) < 0.06, `centre ${centre.toFixed(4)} against 1.0000`);

  const nullScan = { sinogram: new Float64Array(60 * 64), masses: new Float64Array(60), angles: 60, detectors: 64, ds: 2 / 64, peak: 0, extent: 1 };
  const nullImage = backproject(filterProjections(nullScan, 'ramp'), { angles: 60, detectors: 64, ds: nullScan.ds, extent: 1, n: 24 });
  push('A zero sinogram reconstructs to zero', nullImage.every((value) => value === 0), 'linearity of both stages');

  const sparse = radon('shepp-logan', { angles: 30, detectors: 96, extent: 1 });
  const sparseTruth = rasterize('shepp-logan', 32, 1);
  const sparseFbp = backproject(filterProjections(sparse, 'hann'), { angles: 30, detectors: 96, ds: sparse.ds, extent: 1, n: 32 });
  const sparseSirt = sirt(sparse, { n: 32, extent: 1, iterations: 12, relaxation: 1 });
  const fbpError = rmse(sparseFbp, sparseTruth);
  const sirtError = rmse(sparseSirt.image, sparseTruth);
  push('SIRT reduces phantom error relative to an empty initial image', sirtError < rmse(new Float64Array(32*32), sparseTruth), `SIRT RMSE ${sirtError.toFixed(4)}; FBP ${fbpError.toFixed(4)} (neither method is universally better)`);

  const curve = sparseSirt.curve.map((point) => point.residual);
  push('The data residual falls at every SIRT iteration', curve.every((value, i) => i === 0 || value <= curve[i - 1] + 1e-12), `${curve[0].toFixed(3)} → ${curve[curve.length - 1].toFixed(3)}`);

  const coarse = radon('shepp-logan', { angles: 60, detectors: 64, extent: 1 });
  const fine = radon('shepp-logan', { angles: 60, detectors: 192, extent: 1 });
  const mass = (scan) => Math.max(...Array.from(scan.masses).map((value, a) => Math.abs(value - scan.masses[(a + 1) % scan.angles])));
  push('Finer detector spacing reduces the mass quadrature error', mass(fine) < mass(coarse), `${mass(coarse).toExponential(1)} → ${mass(fine).toExponential(1)}`);

  return { checks };
}