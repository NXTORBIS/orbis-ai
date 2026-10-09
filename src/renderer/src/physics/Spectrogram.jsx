import React, { useEffect, useRef } from 'react';
import { CanvasStage } from './ui';
import { fft } from './lib/math.js';

// Spectrogram (short-time Fourier transform) of a 1D signal. Renders time ×
// frequency with magnitude as colour. Real radix-2 FFT per window.
export default function Spectrogram({ signal = [], sampleRate = 1000, window = 256, hop = 64, height = 240, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height;
    ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
    if (signal.length < window) return;
    const N = window; const frames = Math.floor((signal.length - N) / hop) + 1;
    const half = N / 2; const win = new Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1))); // Hann
    let magMax = 1e-9; const mags = [];
    for (let f = 0; f < frames; f++) {
      const re = new Array(N), im = new Array(N).fill(0);
      for (let i = 0; i < N; i++) { re[i] = (signal[f * hop + i] || 0) * win[i]; }
      fft(re, im);
      const m = new Array(half);
      for (let k = 0; k < half; k++) { m[k] = Math.hypot(re[k], im[k]); if (m[k] > magMax) magMax = m[k]; }
      mags.push(m);
    }
    const fw = w / frames, fh = h / half;
    for (let f = 0; f < frames; f++) for (let k = 0; k < half; k++) {
      const t = mags[f][k] / magMax;
      const r = Math.round(20 + 230 * t * t), g = Math.round(40 + 200 * Math.min(1, t * 1.4)), b = Math.round(140 - 120 * t + 80 * t * t);
      ctx.fillStyle = `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, Math.max(0, b))})`;
      ctx.fillRect(f * fw, h - (k + 1) * fh, fw + 0.6, fh + 0.6);
    }
  }, [signal, sampleRate, window, hop]);
  return (
    <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height }}>
      {label && <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>}
      <CanvasStage ref={ref} />
    </div>
  );
}