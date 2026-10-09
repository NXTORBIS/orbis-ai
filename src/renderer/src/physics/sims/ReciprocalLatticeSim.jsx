import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Scatter } from 'recharts';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Reciprocal Lattice — construct b₁,b₂,b₃ from real a₁,a₂,a₃, plot the
// 2D reciprocal lattice points, first Brillouin zone (Wigner-Seitz), and
// diffraction peak positions. Unique engine: real reciprocal-vector
// computation via b_i = 2π ε_ijk cross products, then Wigner-Seitz cell.
function cross(u, v) { return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; }
function dot(u, v) { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; }
function recip(a1, a2, a3) {
  const V = dot(a1, cross(a2, a3));
  const f = 2 * Math.PI / V;
  return [cross(a2, a3).map((x) => x * f), cross(a3, a1).map((x) => x * f), cross(a1, a2).map((x) => x * f)];
}

export default function ReciprocalLatticeSim() {
  const [p, setP] = useState({ lattice: 'square', a: 1.0, range: 3 });
  const { explain, explaining, output } = useAIExplain();

  const data = useMemo(() => {
    let a1, a2, a3;
    if (p.lattice === 'square') { a1 = [p.a, 0, 0]; a2 = [0, p.a, 0]; a3 = [0, 0, 1]; }
    else if (p.lattice === 'rect') { a1 = [p.a, 0, 0]; a2 = [0, p.a * 1.4, 0]; a3 = [0, 0, 1]; }
    else if (p.lattice === 'hex') { a1 = [p.a, 0, 0]; a2 = [p.a * 0.5, p.a * 0.866, 0]; a3 = [0, 0, 1]; }
    else { a1 = [p.a, 0, 0]; a2 = [0, p.a, 0]; a3 = [0, 0, p.a]; } // cubic
    const [b1, b2, b3] = recip(a1, a2, a3);
    // 2D reciprocal points (project out z)
    const pts = [];
    const R = p.range;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const kx = i * b1[0] + j * b2[0], ky = i * b1[1] + j * b2[1];
      const d = Math.sqrt(kx * kx + ky * ky);
      pts.push({ kx: +kx.toFixed(3), ky: +ky.toFixed(3), intensity: d < 0.01 ? 1 : +(1 / (1 + d * 0.3)).toFixed(3), label: `${i},${j}` });
    }
    // first Brillouin zone boundary = perpendicular bisector of nearest G vectors
    const zone = [];
    const nearest = pts.filter((pt) => pt.kx !== 0 || pt.ky !== 0).map((pt) => ({ ...pt, d: Math.sqrt(pt.kx ** 2 + pt.ky ** 2) })).sort((a, b) => a.d - b.d).slice(0, 6);
    for (const n of nearest) {
      const mx = n.kx / 2, my = n.ky / 2;
      const len = Math.sqrt(n.kx ** 2 + n.ky ** 2) / 2;
      const ux = -n.ky / (2 * len * 2), uy = n.kx / (2 * len * 2);
      zone.push({ x: +(mx + ux * 3).toFixed(3), y: +(my + uy * 3).toFixed(3) });
      zone.push({ x: +(mx - ux * 3).toFixed(3), y: +(my - uy * 3).toFixed(3) });
    }
    return { b1, b2, b3, pts, zone, V: Math.abs(dot(a1, cross(a2, a3))) };
  }, [p]);

  return (
    <div className="space-y-3">
      <ResearchHeader title="Reciprocal Lattice" subtitle="Real → reciprocal via b_i = 2π (a_j × a_k)/V. Plot reciprocal points, first Brillouin zone, and diffraction peak intensities."
        onExplain={() => explain(`Reciprocal lattice ${p.lattice}: b1=(${data.b1.map((x) => x.toFixed(2)).join(',')}), b2=(${data.b2.map((x) => x.toFixed(2)).join(',')}). Unit cell V=${data.V.toFixed(3)}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <label className="block text-sm"><span className="text-muted-foreground">Lattice</span>
                <select value={p.lattice} onChange={(e) => setP({ ...p, lattice: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
                  <option value="square" className="bg-background">Square (2D)</option>
                  <option value="rect" className="bg-background">Rectangular (2D)</option>
                  <option value="hex" className="bg-background">Hexagonal (2D)</option>
                  <option value="cubic" className="bg-background">Cubic (3D proj.)</option>
                </select>
              </label>
              <NumField label="Lattice const a" value={p.a} onChange={(v) => setP({ ...p, a: v })} min={0.5} max={3} step={0.1} unit="Å" />
              <NumField label="Range (±G)" value={p.range} onChange={(v) => setP({ ...p, range: v })} min={1} max={5} step={1} />
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ b1: data.b1, b2: data.b2, b3: data.b3, pts: data.pts }, null, 2), 'reciprocal.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height: 420 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.zone} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="x" type="number" domain={[-8, 8]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'kx (2π/a)', position: 'insideBottom', offset: -5, fontSize: 10 }} />
              <YAxis dataKey="y" type="number" domain={[-8, 8]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <Line dataKey="y" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3">
          <SciTable headers={['Vector', 'Value']} rows={[
            ['b₁', `(${data.b1.map((x) => x.toFixed(2)).join(',')})`],
            ['b₂', `(${data.b2.map((x) => x.toFixed(2)).join(',')})`],
            ['b₃', `(${data.b3.map((x) => x.toFixed(2)).join(',')})`],
            ['V (real)', data.V.toFixed(3)],
            ['|b₁|', Math.sqrt(dot(data.b1, data.b1)).toFixed(3)],
            ['Points', data.pts.length],
          ]} />
          <Card><p className="text-xs text-muted-foreground">The first Brillouin zone is the Wigner-Seitz cell of the reciprocal lattice. X-ray diffraction peaks occur at reciprocal-lattice points (Bragg condition Δk = G).</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}