// Fourier Transform — DFT vs continuous FT, frequency spectra
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Naive O(N²) DFT for educational comparison
function dftNaive(re) {
  const N = re.length;
  const Re = new Array(N).fill(0), Im = new Array(N).fill(0);
  for (let k = 0; k < N; k++) {
    for (let n = 0; n < N; n++) {
      const ang = -2 * Math.PI * k * n / N;
      Re[k] += re[n] * Math.cos(ang);
      Im[k] += re[n] * Math.sin(ang);
    }
  }
  return { Re, Im };
}

const SIGNALS = {
  'Gaussian pulse': (t, p) => Math.exp(-((t - 0.5) ** 2) / (2 * p.width * p.width)),
  'Square pulse': (t, p) => (t > 0.5 - p.width / 2 && t < 0.5 + p.width / 2) ? 1 : 0,
  'Sine burst': (t, p) => Math.sin(2 * Math.PI * p.freq * t) * Math.exp(-((t - 0.5) ** 2) / (2 * p.width * p.width)),
  'Two tones': (t, p) => 0.5 * (Math.sin(2 * Math.PI * p.freq * t) + Math.sin(2 * Math.PI * p.freq * 3 * t)),
};

export default function FourierTransformSim() {
  const [sigKey, setSigKey] = useState('Gaussian pulse');
  const [width, setWidth] = useState(0.1);
  const [freq, setFreq] = useState(5);
  const [N, setN] = useState(128);
  const { explain, explaining, output } = useAIExplain();

  const { signal, spectrum, halfMag, halfFreqs, peakFreq } = useMemo(() => {
    const sig = SIGNALS[sigKey];
    const p = { width, freq };
    const dt = 1 / N;
    const re = new Array(N);
    for (let i = 0; i < N; i++) re[i] = sig(i * dt, p);
    const { Re, Im } = dftNaive(re);
    const mag = Re.map((v, i) => Math.hypot(v, Im[i]) / N);
    const freqs = Array.from({ length: N }, (_, k) => k <= N / 2 ? k : k - N);
    const half = Math.floor(N / 2);
    const halfMag = mag.slice(0, half);
    const halfFreqs = freqs.slice(0, half);
    // find peak
    let peakIdx = 0, peakVal = 0;
    for (let i = 1; i < half; i++) if (halfMag[i] > peakVal) { peakVal = halfMag[i]; peakIdx = i; }
    const signal = re.map((v, i) => ({ t: i * dt, s: v }));
    return { signal, spectrum: { Re, Im }, halfMag, halfFreqs: halfFreqs.map((f) => ({ f, mag: halfMag[f] })), peakFreq: peakIdx };
  }, [sigKey, width, freq, N]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Fourier Transform — Signal & Spectrum"
        subtitle="Discrete Fourier Transform (DFT) decomposes a signal into its frequency components. The spectrum reveals what frequencies live in the signal."
        onExplain={() => explain(`DFT of ${sigKey} (N=${N}). Dominant frequency at bin ${peakFreq} (≈${peakFreq} Hz). For a Gaussian pulse of width ${width.toFixed(3)}, the spectrum is also Gaussian (Fourier transform of a Gaussian is a Gaussian). A square pulse produces a sinc spectrum with side-lobes.`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Signal">
          <label className="block text-sm"><span className="text-muted-foreground">Type</span>
            <select value={sigKey} onChange={(e) => setSigKey(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.keys(SIGNALS).map((k) => <option key={k} className="bg-background">{k}</option>)}
            </select>
          </label>
          <div className="mt-3"><NumField label="pulse width σ" value={width} onChange={setWidth} min={0.02} max={0.5} step={0.01} /></div>
          <div className="mt-2"><NumField label="frequency f" value={freq} onChange={setFreq} min={1} max={30} step={1} /></div>
          <div className="mt-2"><NumField label="samples N" value={N} onChange={setN} min={32} max={512} step={32} /></div>
        </Card>
        <div className="space-y-3">
          <SciPlot type="line" data={signal} xKey="t" series={[{ key: 's', label: 'signal', color: '#22d3ee' }]} xLabel="t (s)" yLabel="amplitude" height={180} exportName="ft-signal" />
          <SciPlot type="bar" data={halfFreqs} xKey="f" series={[{ key: 'mag', label: '|X(f)|', color: '#f97316' }]} xLabel="frequency (Hz)" yLabel="magnitude" height={200} exportName="ft-spectrum" />
        </div>
      </div>
      <SciTable headers={['Property', 'Value']} rows={[
        ['Peak frequency', `${peakFreq} Hz`],
        ['N samples', N],
        ['DFT cost', `O(N²) = ${N * N} ops`],
        ['Resolution', `${(1 / N).toFixed(4)} Hz/bin`],
        ['Nyquist', `${N / 2} Hz`],
      ]} />
      <AIPanel output={output} />
    </div>
  );
}