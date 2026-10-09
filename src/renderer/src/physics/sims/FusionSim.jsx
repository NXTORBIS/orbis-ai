import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, NumField, SciTable, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Unique fusion engine: Gamow peak cross-section vs temperature (Gaussian
// barrier penetration), Lawson criterion (nτT), and Q-values for D-T, D-D,
// D-He3, and p-B11 reactions.

const uMeV = 931.494;
const REACTIONS = {
  DT:   { name: 'D + T → ⁴He + n',  Q: 17.59, label: 'D-T' },
  DDn:  { name: 'D + D → ³He + n',  Q: 3.27,  label: 'D-D (n)' },
  DDp:  { name: 'D + D → T + p',   Q: 4.03,  label: 'D-D (p)' },
  DHe3: { name: 'D + ³He → ⁴He + p', Q: 18.3, label: 'D-He3' },
  pB11: { name: 'p + ¹¹B → 3α',     Q: 8.7,   label: 'p-B11' },
};

// Gamow peak: σv ∝ T^(-2/3) · exp(−b·T^(-1/3)) — reaction rate parameter
function gamowRate(T, Z1, Z2, mu) {
  // T in keV; b = 1.44·Z1·Z2·sqrt(2·mu·c²) in keV^(1/3)
  const b = 1.44 * Z1 * Z2 * Math.sqrt(2 * mu) * 0.3; // simplified constant
  return Math.pow(T, -2 / 3) * Math.exp(-b * Math.pow(T, -1 / 3));
}

export default function FusionSim() {
  const [reaction, setReaction] = useState('DT');
  const [Tmin, setTmin] = useState(1);
  const [Tmax, setTmax] = useState(100);
  const [nTau, setNTau] = useState(1e20); // Lawson nτ (m^-3 · s)
  const [Ti, setTi] = useState(15); // ion temperature keV

  const r = REACTIONS[reaction];

  const crossSectionData = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= 100; i++) {
      const T = Tmin + (Tmax - Tmin) * (i / 100);
      const Z1 = 1, Z2 = 1; // simplified: all H-like
      const mu = 1.5; // reduced mass in amu (approx)
      const rate = gamowRate(T, Z1, Z2, mu);
      pts.push({ T: +T.toFixed(2), rate: +rate.toExponential(3), logRate: +Math.log10(rate).toFixed(3) });
    }
    return pts;
  }, [Tmin, Tmax]);

  // Lawson triple product: n·τ·T > 3e21 keV·s/m³ for D-T
  const lawsonThreshold = 3e21;
  const lawsonProduct = nTau * Ti;
  const ignition = lawsonProduct > lawsonThreshold;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(REACTIONS).map(([k, v]) => (
          <button key={k} onClick={() => setReaction(k)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${reaction === k ? 'bg-cyan-j text-black' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}>{v.label}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <NumField label="T min (keV)" value={Tmin} onChange={setTmin} min={0.5} max={50} step={0.5} />
              <NumField label="T max (keV)" value={Tmax} onChange={setTmax} min={10} max={200} step={5} />
              <NumField label="Ion temp Ti (keV)" value={Ti} onChange={setTi} min={1} max={100} step={1} />
              <NumField label="nτ (m⁻³·s)" value={nTau} onChange={setNTau} min={1e18} max={1e22} step={1e19} />
            </div>
          </Card>
          <SciTable headers={['Quantity', 'Value']} rows={[
            ['Reaction', r.name],
            ['Q-value', r.Q.toFixed(2) + ' MeV'],
            ['nτ·T', lawsonProduct.toExponential(2)],
            ['Threshold', lawsonThreshold.toExponential(2)],
            ['Ignition', ignition ? '✓ Yes' : '✗ No'],
          ]} />
          <div className={`rounded-lg border p-2.5 text-xs ${ignition ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
            <div className={`font-semibold ${ignition ? 'text-emerald-500' : 'text-red-500'}`}>{ignition ? 'Ignition achieved' : 'Below ignition threshold'}</div>
            <div className="text-muted-foreground">Lawson: nτT &gt; {lawsonThreshold.toExponential(1)} for D-T.</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ reaction: r, Ti, nTau, crossSectionData }, null, 2), 'fusion.json', 'application/json')}><Download className="size-3.5" />Export</Button>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={crossSectionData} margin={{ top: 8, right: 12, bottom: 10, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="T" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'Temperature (keV)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis dataKey="logRate" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'log₁₀(σv)', angle: -90, fontSize: 10, position: 'insideLeft' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="logRate" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground rounded-lg border border-border/60 bg-card/40 p-2.5">
            Fusion requires overcoming the Coulomb barrier. The Gamow peak is the energy window where enough particles tunnel through. σv ∝ T^(−2/3)·exp(−b·T^(−1/3)). D-T has the lowest barrier (Q=17.6 MeV) — easiest to ignite. Stars fuse at lower T via quantum tunneling over billions of years.
          </div>
        </div>
      </div>
    </div>
  );
}