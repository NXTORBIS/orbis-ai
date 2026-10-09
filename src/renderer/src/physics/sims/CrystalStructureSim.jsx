import React, { useRef, useState, useEffect } from 'react';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Crystal Structure Viewer — 3D lattice rendering (SC, BCC, FCC, diamond)
// with rotation, basis display, and neighbour bonds. Unique engine: real
// 3D point projection of lattice + basis, not a canned image.
const LATTICES = {
  SC: { name: 'Simple Cubic', basis: [[0, 0, 0]], nn: 6, packing: 0.524 },
  BCC: { name: 'Body-Centred Cubic', basis: [[0, 0, 0], [0.5, 0.5, 0.5]], nn: 8, packing: 0.680 },
  FCC: { name: 'Face-Centred Cubic', basis: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], nn: 12, packing: 0.740 },
  Diamond: { name: 'Diamond', basis: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]], nn: 4, packing: 0.340 },
};

function project(x, y, z, ang, tilt, cx, cy, scale) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const xr = x * ca - z * sa;
  const zr = x * sa + z * ca;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const yr = y * ct - zr * st;
  const zr2 = y * st + zr * ct;
  return { sx: cx + xr * scale, sy: cy - yr * scale, depth: zr2 };
}

export default function CrystalStructureSim() {
  const canvasRef = useRef(null);
  const [p, setP] = useState({ lattice: 'FCC', n: 2, bond: 0.45, rot: 0.6, tilt: 0.5, scale: 70 });
  const [spin, setSpin] = useState(true);
  const { explain, explaining, output } = useAIExplain();
  const angleRef = useRef(p.rot);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => { cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (spin) angleRef.current += 0.004;
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
      const L = LATTICES[p.lattice];
      const N = p.n, sc = p.scale * dpr;
      const cx = w / 2, cy = h / 2;
      const pts = [];
      for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (let k = 0; k <= N; k++) {
        for (const b of L.basis) {
          const x = (i + b[0]) - N / 2, y = (j + b[1]) - N / 2, z = (k + b[2]) - N / 2;
          const pr = project(x, y, z, angleRef.current, p.tilt, cx, cy, sc);
          pts.push({ ...pr, x, y, z });
        }
      }
      pts.sort((a, b) => a.depth - b.depth);
      // bonds
      ctx.strokeStyle = 'hsl(189 100% 50% / 0.25)'; ctx.lineWidth = 1 * dpr;
      for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
        const dx = pts[a].x - pts[b].x, dy = pts[a].y - pts[b].y, dz = pts[a].z - pts[b].z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > 0.01 && d < p.bond) {
          ctx.beginPath(); ctx.moveTo(pts[a].sx, pts[a].sy); ctx.lineTo(pts[b].sx, pts[b].sy); ctx.stroke();
        }
      }
      // atoms
      for (const pt of pts) {
        const r = (4 + pt.depth * 0.5) * dpr;
        const shade = Math.max(0.3, Math.min(1, 0.5 + pt.depth * 0.15));
        ctx.fillStyle = `hsl(189 90% ${40 + shade * 30}%)`;
        ctx.beginPath(); ctx.arc(pt.sx, pt.sy, Math.max(2, r), 0, Math.PI * 2); ctx.fill();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [p, spin]);

  const L = LATTICES[p.lattice];
  return (
    <div className="space-y-3">
      <ResearchHeader title="Crystal Structure Viewer" subtitle="3D lattice + basis rendering for SC, BCC, FCC and diamond. Rotate, toggle bonds, inspect coordination and packing."
        onExplain={() => explain(`Crystal ${L.name}: ${L.basis.length} atoms/cell, ${L.nn} nearest neighbours, packing fraction ${L.packing}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <label className="block text-sm"><span className="text-muted-foreground">Lattice type</span>
                <select value={p.lattice} onChange={(e) => setP({ ...p, lattice: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
                  {Object.entries(LATTICES).map(([k, v]) => <option key={k} value={k} className="bg-background">{v.name}</option>)}
                </select>
              </label>
              <NumField label="Cells per side" value={p.n} onChange={(v) => setP({ ...p, n: v })} min={1} max={4} step={1} />
              <NumField label="Bond cutoff" value={p.bond} onChange={(v) => setP({ ...p, bond: v })} min={0.2} max={0.9} step={0.05} unit="a" />
              <NumField label="Tilt" value={p.tilt} onChange={(v) => setP({ ...p, tilt: v })} min={0} max={1.4} step={0.05} />
              <NumField label="Scale" value={p.scale} onChange={(v) => setP({ ...p, scale: v })} min={30} max={120} step={5} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} className="accent-cyan-500" /><span className="text-muted-foreground">Auto-rotate</span></label>
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ lattice: L, params: p }, null, 2), 'crystal.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 420 }}>
          <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
        <div className="space-y-3">
          <SciTable headers={['Property', 'Value']} rows={[
            ['Type', L.name], ['Atoms/cell', L.basis.length], ['Coordination', L.nn], ['Packing', L.packing.toFixed(3)],
            ['Basis', L.basis.map((b) => `(${b.join(',')})`).join(' ')],
          ]} />
          <Card><p className="text-xs text-muted-foreground">The lattice is the periodic scaffold; the basis is the motif placed at each lattice point. Diamond = two interpenetrating FCC lattices offset by (¼,¼,¼).</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}