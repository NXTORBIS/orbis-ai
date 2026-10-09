// FFT — Radix-2 Cooley–Tukey: O(N log N) vs O(N²) DFT
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import { fft, nextPow2 } from '../lib/math.js';

// Naive O(N²) DFT for timing comparison
function dftNaive(re, im) {
  const N = re.length;
  const Re = new Array(N).fill(0), Im = new Array(N).fill(0);
  for (let k = 0; k < N; k++) {
    for (let n = 0; n < N; n++) {
      const ang = -2 * Math.PI * k * n / N;
      Re[k] += re[n] * Math.cos(ang) - im[n] * Math.sin(ang);
      Im[k] += re[n] * Math.sin(ang) + im[n] * Math.cos(ang);
    }
  }
  return { Re, Im };
}

export default function FFTSim() {
  const [f1, setF1] = useState(5);
  const [f2, setF2] = useState(13);
  const [N, setN] = useState(256);
  const { explain, explaining, output } = useAIExplain();

  const { signal, fftMag, dftMag, timing, speedup } = useMemo(() => {
    const Np = nextPow2(N);
    const re = new Array(Np), im = new Array(Np).fill(0);
    for (let i = 0; i < Np; i++) re[i] = Math.sin(2 * Math.PI * f1 * i / Np) + 0.6 * Math.sin(2 * Math.PI * f2 * i / Np);
    const sig = re.slice();

    // FFT timing
    const reF = re.slice(), imF = im.slice();
    const t0 = performance.now();
    fft(reF, imF);
    const tFft = performance.now() - t0;
    const fftMag = reF.map((v, i) => Math.hypot(v, imF[i]) / Np);

    // DFT timing (only for small N to avoid hanging)
    let tDft = 0, dftMagArr = new Array(Np).fill(0);
    if (Np <= 1024) {
      const t1 = performance.now();
      const { Re, Im } = dftNaive(re, im);
      tDft = performance.now() - t1;
      dftMagArr = Re.map((v, i) => Math.hypot(v, Im[i]) / Np);
    } else {
      // extrapolate
      tDft = (Np * Np / 1024 / 1024) * 2;
    }

    const half = Math.floor(Np / 2);
    const signal = sig.map((v, i) => ({ i, s: v }));
    const fftData = fftMag.slice(0, half).map((m, i) => ({ k: i, fft: m }));
    const dftData = dftMagArr.slice(0, half).map((m, i) => ({ k: i, dft: m }));

    // timing across sizes
    const timing = [];
    for (let p = 4; p <= 12; p++) {
      const sz = Math.pow(2, p);
      const reT = new Array(sz).fill(0).map(() => Math.random());
      const imT = new Array(sz).fill(0);
      const t2 = performance.now();
      fft(reT.slice(), imT.slice());
      const tf = performance.now() - t2;
      const td = sz <= 1024 ? (sz * sz / 65536) * tf * 4 : (sz * sz / 65536) * tf * 4;
      timing.push({ N: sz, fft: tf, dft: td });
    }

    return { signal, fftMag: fftData, dftMag: dftData, timing, speedup: tDft / Math.max(tFft, 0.001) };
  }, [f1, f2, N]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="FFT — Radix-2 Cooley–Tukey"
        subtitle="O(N log N) butterfly algorithm vs O(N²) naive DFT. The speedup grows with N: at N=1024, FFT is ~100× faster; at N=4096, ~300×."
        onExplain={() => explain(`FFT of a two-tone signal (f₁=${f1}, f₂=${f2}) with N=${nextPow2(N)}. Spectrum peaks at bins ${f1} and ${f2}. FFT speedup over DFT ≈ ${speedup.toFixed(1)}× at this size. The divide-and-conquer butterfly halves the problem at each stage, giving O(N log N) instead of O(N²).`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Signal">
          <div className="mt-2"><NumField label="f₁" value={f1} onChange={setF1} min={1} max={60} step={1} /></div>
          <div className="mt-2"><NumField label="f₂" value={f2} onChange={setF2} min={1} max={60} step={1} /></div>
          <div className="mt-2"><NumField label="N (→ next pow2)" value={N} onChange={setN} min={16} max={4096} step={16} /></div>
        </Card>
        <div className="space-y-3">
          <SciPlot type="line" data={signal} xKey="i" series={[{ key: 's', label: 'signal', color: '#22d3ee' }]} xLabel="sample" yLabel="amplitude" height={160} exportName="fft-signal" />
          <SciPlot type="bar" data={fftMag} xKey="k" series={[{ key: 'fft', label: '|FFT(k)|', color: '#f97316' }]} xLabel="freq bin k" yLabel="magnitude" height={200} exportName="fft-spectrum" />
        </div>
      </div>
      <Card title="Timing: FFT O(N log N) vs DFT O(N²)">
        <SciPlot type="line" data={timing} xKey="N" log="log"
          series={[{ key: 'fft', label: 'FFT', color: '#22d3ee' }, { key: 'dft', label: 'DFT (est.)', color: '#ef4444' }]}
          xLabel="N" yLabel="time (ms)" height={200} exportName="fft-timing" />
      </Card>
      <SciTable headers={['Metric', 'Value']} rows={[
        ['N (actual)', nextPow2(N)],
        ['FFT cost', `${(nextPow2(N) * Math.log2(nextPow2(N))).toFixed(0)} ops`],
        ['DFT cost', `${(nextPow2(N) ** 2).toLocaleString()} ops`],
        ['Speedup', `${speedup.toFixed(1)}×`],
        ['Peaks at', `bins ${f1}, ${f2}`],
      ]} />
      <AIPanel output={output} />
    </div>
  );
}