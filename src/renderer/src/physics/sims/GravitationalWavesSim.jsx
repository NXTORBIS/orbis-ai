import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';
import Spectrogram from '../Spectrogram.jsx';

// Gravitational wave inspiral: leading post-Newtonian chirp
// f(tau) = (1/pi) (5/256 tau)^(-3/8) / M_chirp
// h(t) = A f^(2/3) cos(2 pi integral f dt)
export default function GravitationalWavesSim() {
  const [m1, setM1] = useState(30);
  const [m2, setM2] = useState(25);
  const [dist, setDist] = useState(400);
  const { explain, explaining, output } = useAIExplain();

  const Mc = Math.pow(m1 * m2, 0.6) / Math.pow(m1 + m2, 0.2);

  const data = useMemo(() => {
    const out = [];
    const N = 4000;
    const fMax = 0.05;
    let t = 0, phase = 0, f = 0.005;
    const dt = 0.5;
    for (let i = 0; i < N; i++) {
      const tau = 1000 - t;
      if (tau < 1) break;
      f = (1 / Math.PI) * Math.pow(5 / 256 / tau, -3 / 8) / Mc * 0.01;
      f = Math.min(f, fMax);
      const h = (1 / dist) * Math.pow(f, 2 / 3) * Math.cos(phase) * 1e3;
      out.push({ t, h: +h.toFixed(4), f: +(f * 1000).toFixed(4) });
      phase += 2 * Math.PI * f * dt;
      t += dt;
    }
    return out;
  }, [m1, m2, dist, Mc]);

  const signal = data.map((d) => d.h);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Gravitational Waves — Binary Inspiral Chirp" subtitle="Leading-order post-Newtonian chirp from a compact binary merger. f(t) sweeps upward (chirp); h(t) amplitude grows until merger cutoff."
        onExplain={() => explain(`GW: m1=${m1}, m2=${m2} Msun, chirp mass Mc=${Mc.toFixed(2)} Msun, distance=${dist} Mpc. The chirp frequency rises from ~5 Hz to cutoff. Strain h ~ 1e-21 for LIGO sources at ~400 Mpc.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Binary Parameters">
            <NumField label="m1" value={m1} onChange={setM1} min={1} max={100} step={1} unit="Msun" />
            <div className="mt-2"><NumField label="m2" value={m2} onChange={setM2} min={1} max={100} step={1} unit="Msun" /></div>
            <div className="mt-2"><NumField label="Distance" value={dist} onChange={setDist} min={50} max={2000} step={50} unit="Mpc" /></div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Chirp mass', Mc.toFixed(3) + ' Msun'],
            ['Total mass', (m1 + m2) + ' Msun'],
            ['Mass ratio q', (Math.min(m1, m2) / Math.max(m1, m2)).toFixed(3)],
            ['Peak f', ((data[data.length - 1]?.f) || 0).toFixed(2) + ' Hz'],
          ]} />
        </div>
        <div className="space-y-3">
          <Card title="Strain h(t)"><SciPlot type="line" data={data} xKey="t" series={[{ key: 'h', label: 'h(t)', color: '#22d3ee' }]} xLabel="t" yLabel="strain" height={200} exportName="gw-strain" /></Card>
          <Card title="Frequency f(t)"><SciPlot type="line" data={data} xKey="t" series={[{ key: 'f', label: 'f(t)', color: '#f97316' }]} xLabel="t" yLabel="frequency (Hz)" height={180} exportName="gw-freq" /></Card>
          <Card title="Spectrogram"><Spectrogram signal={signal} sampleRate={1000} window={256} hop={64} height={220} label="time -> freq ^" /></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}