/**
 * NMR spin system engine — the spin Hamiltonian diagonalised, then the spectrum built from it.
 *
 * For N spin-½ nuclei the Hamiltonian in a product basis is
 *
 *   H = Σ νᵢ I_z,ᵢ + Σ J_ij (I_x,ᵢI_x,j + I_y,ᵢI_y,j + I_z,ᵢI_z,j)
 *
 * evaluated in Hz. The transverse part couples states that differ in exactly two spins with
 * matrix element J_ij/2, and because each coupling contributes two factors of i, every entry is
 * real — so H is a real symmetric matrix and a cyclic Jacobi sweep diagonalises it exactly
 * enough that the residual can be measured.
 *
 * Transitions are not assumed to be first order. Every pair of eigenstates is considered and
 * weighted by the square of its total transverse magnetisation matrix element, |⟨a|ΣI_x|b⟩|²,
 * which is what makes the equivalent-spin and strongly-coupled cases come out right: two
 * equivalent spins give one line, not two, and an AB pair shows its roof effect.
 */

export const MAX_SPINS = 6;

export const NMR_PRESETS = {
  ax: {
    name: 'AX — two weakly coupled spins',
    spins: [{ label: 'A', shift: 3.2 }, { label: 'X', shift: 1.4 }],
    couplings: [{ i: 0, j: 1, J: 7 }],
    field: 400,
    note: 'Δν ≫ J, so each spin shows a clean doublet with a spacing of J Hz.',
  },
  equivalent: {
    name: 'A₂ — two equivalent spins',
    spins: [{ label: 'A1', shift: 2 }, { label: 'A2', shift: 2 }],
    couplings: [{ i: 0, j: 1, J: 8 }],
    field: 400,
    note: 'Chemically equivalent spins couple but do not split each other: one line.',
  },
  methylX: {
    name: 'CH₃–X — three equivalent spins plus one',
    spins: [{ label: 'CH₃', shift: 1.2 }, { label: 'CH₃ b', shift: 1.2 }, { label: 'CH₃ c', shift: 1.2 }, { label: 'X', shift: 7.4 }],
    couplings: [{ i: 0, j: 3, J: 7 }, { i: 1, j: 3, J: 7 }, { i: 2, j: 3, J: 7 }],
    field: 400,
    note: 'The X signal must be a quartet with intensities 1 : 3 : 3 : 1 from Pascals triangle, the methyl a doublet.',
  },
  ab: {
    name: 'AB — strongly coupled pair',
    spins: [{ label: 'A', shift: 2.5 }, { label: 'B', shift: 2.4 }],
    couplings: [{ i: 0, j: 1, J: 30 }],
    field: 400,
    note: 'Here Δν ≈ J (40 Hz against 30 Hz), so the first-order picture fails: the lines move and the inner pair grows — the roof effect.',
  },
  ethanol: {
    name: 'Ethanol CH₃CH₂OH',
    spins: [
      { label: 'CH₃', shift: 1.19 }, { label: 'CH₃ b', shift: 1.19 }, { label: 'CH₃ c', shift: 1.19 },
      { label: 'CH₂', shift: 3.69 }, { label: 'CH₂ b', shift: 3.69 },
      { label: 'OH', shift: 2.6 },
    ],
    couplings: [
      { i: 0, j: 3, J: 7.1 }, { i: 1, j: 3, J: 7.1 }, { i: 2, j: 3, J: 7.1 },
      { i: 0, j: 4, J: 7.1 }, { i: 1, j: 4, J: 7.1 }, { i: 2, j: 4, J: 7.1 },
      { i: 3, j: 5, J: 5.2 }, { i: 4, j: 5, J: 5.2 },
    ],
    field: 400,
    note: 'Six spins, 64 states. The methyl is a triplet, the methylene a quartet split again by the OH proton.',
  },
};

/** Real symmetric matrix helpers: rows are Float64Array. */
const zeros = (n) => Array.from({ length: n }, () => new Float64Array(n));

/** The Hamiltonian in Hz, built by bit pattern: bit i set means spin i is up. */
export function buildHamiltonian(spins, couplings, field) {
  const n = spins.length;
  const size = 1 << n;
  const h = zeros(size);
  const shifts = spins.map((spin) => spin.shift * field);
  for (let state = 0; state < size; state += 1) {
    let diagonal = 0;
    for (let i = 0; i < n; i += 1) diagonal += shifts[i] * ((state >> i) & 1 ? 0.5 : -0.5);
    couplings.forEach(({ i, j, J: coupling }) => {
      const mi = (state >> i) & 1 ? 0.5 : -0.5;
      const mj = (state >> j) & 1 ? 0.5 : -0.5;
      diagonal += coupling * mi * mj;
    });
    h[state][state] = diagonal;
  }
  couplings.forEach(({ i, j, J: coupling }) => {
    const mask = (1 << i) | (1 << j);
    for (let state = 0; state < size; state += 1) {
      const partner = state ^ mask;
      if (partner <= state) continue;
      h[state][partner] = coupling / 2;
      h[partner][state] = coupling / 2;
    }
  });
  return h;
}

/** Total transverse magnetisation: I_x flips one spin at a time with amplitude ½. */
export function buildMagnetisation(spins) {
  const n = spins.length;
  const size = 1 << n;
  const m = zeros(size);
  for (let i = 0; i < n; i += 1) {
    for (let state = 0; state < size; state += 1) {
      const partner = state ^ (1 << i);
      if (partner <= state) continue;
      m[state][partner] = 0.5;
      m[partner][state] = 0.5;
    }
  }
  return m;
}

/** Cyclic Jacobi for real symmetric matrices. Returns eigenvalues and eigenvectors as columns. */
export function jacobi(input, { sweeps = 100, tolerance = 1e-13 } = {}) {
  const n = input.length;
  const a = input.map((row) => Float64Array.from(row));
  const v = zeros(n);
  for (let i = 0; i < n; i += 1) v[i][i] = 1;

  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += a[p][q] * a[p][q];
    if (off < tolerance * tolerance) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const eigenvalues = new Float64Array(n);
  for (let i = 0; i < n; i += 1) eigenvalues[i] = a[i][i];
  return { eigenvalues, eigenvectors: v };
}

/** Every transition of the system, with its frequency in Hz and its intensity. */
export function transitionsOf(spins, couplings, field) {
  const h = buildHamiltonian(spins, couplings, field);
  const m = buildMagnetisation(spins);
  const { eigenvalues, eigenvectors } = jacobi(h);
  const size = h.length;
  const mv = zeros(size);
  for (let i = 0; i < size; i += 1) for (let j = 0; j < size; j += 1) {
    if (!m[i][j]) continue;
    for (let k = 0; k < size; k += 1) mv[i][k] += m[i][j] * eigenvectors[j][k];
  }
  const q = zeros(size);
  for (let a = 0; a < size; a += 1) for (let b = 0; b < size; b += 1) {
    let sum = 0;
    for (let k = 0; k < size; k += 1) sum += eigenvectors[k][a] * mv[k][b];
    q[a][b] = sum;
  }
  const transitions = [];
  let totalIntensity = 0;
  for (let a = 0; a < size; a += 1) {
    for (let b = 0; b < size; b += 1) {
      const intensity = q[a][b] * q[a][b];
      if (intensity < 1e-14) continue;
      totalIntensity += intensity;
      if (eigenvalues[a] <= eigenvalues[b]) continue;
      transitions.push({ frequency: eigenvalues[a] - eigenvalues[b], intensity, from: b, to: a });
    }
  }
  let residual = 0;
  for (let a = 0; a < size; a += 1) {
    for (let k = 0; k < size; k += 1) {
      let sum = 0;
      for (let j = 0; j < size; j += 1) sum += h[k][j] * eigenvectors[j][a];
      residual = Math.max(residual, Math.abs(sum - eigenvalues[a] * eigenvectors[k][a]));
    }
  }
  return { transitions: transitions.sort((a, b) => a.frequency - b.frequency), totalIntensity, eigenvalues, eigenvectors, h, residual, size, exactSum: (spins.length * size) / 4 };
}

const lorentzian = (x, centre, width, height) => (height * (width * width)) / ((x - centre) * (x - centre) + width * width);

/** The rendered spectrum: a Lorentzian line per transition across the requested window. */
export function spectrum(transitions, { linewidth = 0.6, points = 1600, margin = 0.08 } = {}) {
  if (!transitions.length) return { x: [], y: [], range: [0, 1], peak: 1 };
  const lowest = transitions[0].frequency;
  const highest = transitions[transitions.length - 1].frequency;
  const padding = Math.max((highest - lowest) * margin, linewidth * 6);
  const from = lowest - padding;
  const to = highest + padding;
  const x = [];
  const y = [];
  let peak = 0;
  for (let index = 0; index < points; index += 1) {
    const position = from + ((to - from) * index) / (points - 1);
    let sum = 0;
    transitions.forEach((line) => { sum += lorentzian(position, line.frequency, linewidth / 2, line.intensity); });
    x.push(position);
    y.push(sum);
    peak = Math.max(peak, sum);
  }
  return { x, y, range: [from, to], peak };
}

/** Groups nearby lines into reported peaks, with an intensity ratio against the strongest. */
export function findPeaks(transitions, { linewidth = 0.6 } = {}) {
  if (!transitions.length) return [];
  const tolerance = Math.max(linewidth, 0.05) * 1.5;
  const peaks = [];
  transitions.forEach((line) => {
    const peak = peaks.find((entry) => Math.abs(entry.frequency - line.frequency) < tolerance);
    if (peak) {
      peak.frequency = (peak.frequency * peak.intensity + line.frequency * line.intensity) / (peak.intensity + line.intensity);
      peak.intensity += line.intensity;
    } else {
      peaks.push({ frequency: line.frequency, intensity: line.intensity });
    }
  });
  const strongest = Math.max(...peaks.map((peak) => peak.intensity));
  return peaks
    .filter((peak) => peak.intensity > strongest * 1e-6)
    .map((peak) => ({ ...peak, relative: peak.intensity / strongest }))
    .sort((a, b) => a.frequency - b.frequency);
}

export function verifyNmr() {
  const ax = transitionsOf(NMR_PRESETS.ax.spins, NMR_PRESETS.ax.couplings, NMR_PRESETS.ax.field);
  const equivalent = transitionsOf(NMR_PRESETS.equivalent.spins, NMR_PRESETS.equivalent.couplings, NMR_PRESETS.equivalent.field);
  const methyl = transitionsOf(NMR_PRESETS.methylX.spins, NMR_PRESETS.methylX.couplings, NMR_PRESETS.methylX.field);
  const ab = transitionsOf(NMR_PRESETS.ab.spins, NMR_PRESETS.ab.couplings, NMR_PRESETS.ab.field);
  const ethanol = transitionsOf(NMR_PRESETS.ethanol.spins, NMR_PRESETS.ethanol.couplings, NMR_PRESETS.ethanol.field);
  const all = [ax, equivalent, methyl, ab, ethanol];
  const asMatrix = (rows) => rows.map((row) => Array.from(row));

  const axPeaks = findPeaks(ax.transitions);
  const axSpacings = axPeaks.slice(1).map((peak, index) => peak.frequency - axPeaks[index].frequency);
  const eqPeaks = findPeaks(equivalent.transitions);
  const methylPeaks = findPeaks(methyl.transitions);
  const quartet = methylPeaks.slice(-4);
  const quartetRatios = quartet.map((peak) => peak.relative / Math.max(...quartet.map((entry) => entry.relative), 1e-30));
  const pascalsNormalised = [1, 3, 3, 1].map((value) => value / 3);
  const pascalsOk = quartet.length === 4 && quartetRatios.every((ratio, index) => Math.abs(ratio - pascalsNormalised[index]) < 0.02);
  const methylDoublet = methylPeaks.slice(0, 2);
  const abPeaks = findPeaks(ab.transitions);
  const firstOrder = [2.5 * 400 - 15, 2.5 * 400 + 15, 2.4 * 400 - 15, 2.4 * 400 + 15].sort((a, b) => a - b);
  const shiftsFromFirstOrder = abPeaks.length === 4 ? Math.max(...abPeaks.map((peak, index) => Math.abs(peak.frequency - firstOrder[index]))) : 0;
  const innerStronger = abPeaks.length === 4 && abPeaks[1].intensity > abPeaks[0].intensity && abPeaks[2].intensity > abPeaks[3].intensity;
  const symmetry = (rows) => {
    let worst = 0;
    for (let i = 0; i < rows.length; i += 1) for (let j = 0; j < rows.length; j += 1) worst = Math.max(worst, Math.abs(rows[i][j] - rows[j][i]));
    return worst;
  };
  const traceOf = (rows) => rows.reduce((sum, row, index) => sum + row[index], 0);
  const orthonormality = (eigenvectors) => {
    const n = eigenvectors.length;
    let worst = 0;
    for (let a = 0; a < n; a += 1) for (let b = 0; b < n; b += 1) {
      let sum = 0;
      for (let k = 0; k < n; k += 1) sum += eigenvectors[k][a] * eigenvectors[k][b];
      worst = Math.max(worst, Math.abs(sum - (a === b ? 1 : 0)));
    }
    return worst;
  };

  return {
    ax, equivalent, methyl, ab, ethanol, axPeaks, eqPeaks, methylPeaks, abPeaks,
    checks: [
      { label: 'The Hamiltonian is symmetric to machine precision', ok: all.every((run) => symmetry(asMatrix(run.h)) < 1e-12), detail: `worst asymmetry ${Math.max(...all.map((run) => symmetry(asMatrix(run.h)))).toExponential(2)}` },
      { label: 'Its eigenvectors reproduce it: ‖HV − VΛ‖ is vanishingly small', ok: all.every((run) => run.residual < 1e-9), detail: `worst residual ${Math.max(...all.map((run) => run.residual)).toExponential(2)} across 4-, 16- and 64-state systems` },
      { label: 'The eigenvectors are orthonormal', ok: all.every((run) => orthonormality(run.eigenvectors) < 1e-10), detail: `worst deviation from the identity ${Math.max(...all.map((run) => orthonormality(run.eigenvectors))).toExponential(2)}` },
      { label: 'The eigenvalues sum to the trace, which spin operators force to zero', ok: all.every((run) => Math.abs(run.eigenvalues.reduce((sum, value) => sum + value, 0) - traceOf(asMatrix(run.h))) < 1e-9 && Math.abs(traceOf(asMatrix(run.h))) < 1e-8), detail: `trace(H) = ${Math.max(...all.map((run) => Math.abs(traceOf(asMatrix(run.h))))).toExponential(1)} against a diagonal scale of ~10³ Hz — zero to floating-point cancellation` },
      { label: 'All transition intensity adds up to Tr(I_x²) = N·2^(N−2)', ok: all.every((run) => Math.abs(run.totalIntensity - run.exactSum) / run.exactSum < 1e-9), detail: `e.g. ${ax.totalIntensity.toFixed(12)} against the exact ${ax.exactSum.toFixed(4)} for two spins` },
      { label: 'Two weakly coupled spins give two doublets spaced by J', ok: axPeaks.length === 4 && Math.abs(axSpacings[0] - 7) < 0.01 && Math.abs(axSpacings[2] - 7) < 0.01, detail: `${axPeaks.length} lines with spacings ${axSpacings.map((value) => value.toFixed(3)).join(', ')} Hz` },
      { label: 'Two equivalent spins give a single line, not a doublet', ok: eqPeaks.length === 1, detail: `${eqPeaks.length} line${eqPeaks.length === 1 ? '' : 's'} at ${eqPeaks[0]?.frequency.toFixed(2)} Hz — equivalent spins couple but do not split each other` },
      { label: 'Three equivalent spins split their neighbour into 1 : 3 : 3 : 1', ok: pascalsOk, detail: `quartet ratios ${quartetRatios.map((value) => value.toFixed(3)).join(' : ')} against Pascal ${pascalsNormalised.map((value) => value.toFixed(3)).join(' : ')}` },
      { label: 'The equivalent methyl protons see a doublet', ok: methylDoublet.length === 2 && Math.abs(methylDoublet[0].relative - methylDoublet[1].relative) < 0.02, detail: `${methylDoublet.length} lines of equal intensity at the methyl shift` },
      { label: 'A strongly coupled pair departs from the first-order prediction', ok: shiftsFromFirstOrder > 0.5, detail: `lines move by up to ${shiftsFromFirstOrder.toFixed(2)} Hz from where first-order theory puts them` },
      { label: 'And it shows the roof effect: the inner lines are stronger', ok: innerStronger, detail: `AB inner/outer intensity ratio ${(abPeaks[1].relative / abPeaks[0].relative).toFixed(3)}` },
      { label: 'A six-spin system diagonalises cleanly too', ok: ethanol.size === 64 && ethanol.residual < 1e-9, detail: `${ethanol.size} states, residual ${ethanol.residual.toExponential(2)}, ${ethanol.transitions.length} transitions` },
    ],
  };
}