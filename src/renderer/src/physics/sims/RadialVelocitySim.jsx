import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

// Radial velocity: star wobbles due to planet orbiting barycenter
// v_r = -K (cos(omega + nu) + e cos(omega))  [simplified circular: v_r = -K cos(2pi t/P)]
// K = (2pi G / P)^(1/3) * m_p sin(i) / (M_star + m_p)^(2/3) / sqrt(1-e^2)
export default function RadialVelocitySim() {
  const [mp, setMp] = useState(1); // planet mass in Jupiter masses
  const [P, setP] = useState(12); // period in days
  const [Mstar, setMstar] = useState(1); // star mass in solar masses
  const [ecc, setEcc] = useState(0); // eccentricity
  const { explain, explaining, output } = useAIExplain();

  const rv = useMemo(() => {
    // K in m/s: K = 203 * (mp sin i / Mj) * (P/365)^(-1/3) * (Mstar/Msun)^(-2/3) / sqrt(1-e^2)
    const K = 203 * mp * Math.pow(P / 365, -1 / 3) * Math.pow(Mstar, -2 / 3) / Math.sqrt(1 - ecc * ecc);
    const out = [];
    for (let t = 0; t <= P; t += P / 200) {
      const M = 2 * Math.PI * t / P; // mean anomaly
      // Solve Kepler's equation iteratively for eccentric anomaly E
      let E = M;
      for (let i = 0; i < 5; i++) E = M + ecc * Math.sin(E);
      const nu = 2 * Math.atan2(Math.sqrt(1 + ecc) * Math.sin(E / 2), Math.sqrt(1 - ecc) * Math.cos(E / 2));
      const vr = -K * (Math.cos(nu) + ecc);
      out.push({ t: +t.toFixed(2), vr: +vr.toFixed(1) });
    }
    return out;
  }, [mp, P, Mstar, ecc]);

  const K = 203 * mp * Math.pow(P / 365, -1 / 3) * Math.pow(Mstar, -2 / 3) / Math.sqrt(1 - ecc * ecc);
  const a = Math.pow(Mstar * P * P / 365, 1 / 3); // semi-major axis in AU (simplified)

  return (
    <div className="space-y-4">
      <ResearchHeader title="Radial Velocity — Stellar Wobble" subtitle="A planet tugs its star, causing a periodic Doppler shift. The RV amplitude K gives m_p sin(i); the shape reveals eccentricity."
        onExplain={() => explain(`RV curve: mp=${mp} Mj, P=${P}d, Mstar=${Mstar} Msun, e=${ecc}. Amplitude K=${K.toFixed(1)} m/s. Semi-major axis a=${a.toFixed(3)} AU. For e=0 the curve is sinusoidal; eccentricity distorts it.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="System Parameters">
            <NumField label="Planet mass" value={mp} onChange={setMp} min={0.01} max={13} step={0.01} unit="M_jup" />
            <div className="mt-2"><NumField label="Period" value={P} onChange={setP} min={1} max={365} step={1} unit="days" /></div>
            <div className="mt-2"><NumField label="Star mass" value={Mstar} onChange={setMstar} min={0.1} max={3} step={0.1} unit="M_sun" /></div>
            <div className="mt-2"><NumField label="Eccentricity" value={ecc} onChange={setEcc} min={0} max={0.9} step={0.05} /></div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['K amplitude', K.toFixed(1) + ' m/s'],
            ['m_p sin(i)', mp.toFixed(2) + ' M_jup'],
            ['Semi-major axis', a.toFixed(3) + ' AU'],
            ['e', ecc.toFixed(2)],
          ]} />
        </div>
        <div className="space-y-3">
          <SciPlot type="line" data={rv} xKey="t" series={[{ key: 'vr', label: 'v_r', color: '#f97316' }]} xLabel="time (days)" yLabel="v_r (m/s)" height={280} exportName="rv-curve" />
          <p className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            The star wobbles around the system barycenter. For a circular orbit (e=0), v_r is sinusoidal. Eccentricity makes the curve asymmetric: the star moves faster at perihelion. K = 203 m/s for a Jupiter-mass planet at 1 AU around 1 M☉.
          </p>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}