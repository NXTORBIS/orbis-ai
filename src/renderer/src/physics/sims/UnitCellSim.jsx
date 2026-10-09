import React, { useRef, useState, useEffect } from 'react';
import { Card, NumField, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Unit Cell Builder — primitive vectors, lattice points, packing fraction
// and APF (atomic packing fraction) comparison. Unique engine: draws the
// conventional + primitive cell with real 3D projection and computes APF
// from hard-sphere geometry.
const TYPES = {
  SC: { name: 'Simple Cubic', a: 1, r: 0.5, nAtoms: 1, apf: 0.524, prim: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  BCC: { name: 'Body-Centred Cubic', a: 1, r: Math.sqrt(3) / 4, nAtoms: 2, apf: 0.680, prim: [[0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, -0.5, 0.5]] },
  FCC: { name: 'Face-Centred Cubic', a: 1, r: Math.sqrt(2) / 4, nAtoms: 4, apf: 0.740, prim: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]] },
  Diamond: { name: 'Diamond', a: 1, r: Math.sqrt(3) / 8, nAtoms: 8, apf: 0.340, prim: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]] },
};

function project(x, y, z, ang, tilt, cx, cy, sc) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const xr = x * ca - z * sa, zr = x * sa + z * ca;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  return { sx: cx + xr * sc, sy: cy - (y * ct - zr * st) * sc, depth: y * st + zr * ct };
}

export default function UnitCellSim() {
  const canvasRef = useRef(null);
  const [p, setP] = useState({ type: 'FCC', rot: 0.7, tilt: 0.5, scale: 90, showPrim: true });
  const [spin, setSpin] = useState(true);
  const angRef = useRef(p.rot);
  const { explain, explaining, output } = useAIExplain();

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => { cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (spin) angRef.current += 0.005;
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
      const T = TYPES[p.type], sc = p.scale * dpr, cx = w / 2, cy = h / 2;
      // conventional cube edges
      const corners = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]];
      const pc = corners.map((c) => project(c[0], c[1], c[2], angRef.current, p.tilt, cx, cy, sc));
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      ctx.strokeStyle = 'hsl(189 100% 50% / 0.4)'; ctx.lineWidth = 1.5 * dpr;
      for (const [a, b] of edges) { ctx.beginPath(); ctx.moveTo(pc[a].sx, pc[a].sy); ctx.lineTo(pc[b].sx, pc[b].sy); ctx.stroke(); }
      // primitive vectors from origin
      if (p.showPrim) {
        const o = project(0, 0, 0, angRef.current, p.tilt, cx, cy, sc);
        ctx.lineWidth = 2.5 * dpr;
        const colors = ['#ef4444', '#22c55e', '#eab308'];
        for (let i = 0; i < 3; i++) {
          const tip = project(T.prim[i][0] - 0.5, T.prim[i][1] - 0.5, T.prim[i][2] - 0.5, angRef.current, p.tilt, cx, cy, sc);
          ctx.strokeStyle = colors[i]; ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(tip.sx, tip.sy); ctx.stroke();
          ctx.fillStyle = colors[i]; ctx.beginPath(); ctx.arc(tip.sx, tip.sy, 4 * dpr, 0, Math.PI * 2); ctx.fill();
        }
      }
      // atoms at basis positions (fractional)
      const basis = p.type === 'SC' ? [[0, 0, 0]] : p.type === 'BCC' ? [[0, 0, 0], [0.5, 0.5, 0.5]] : p.type === 'FCC' ? [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]] : [[0, 0, 0], [0.25, 0.25, 0.25]];
      const pts = basis.map((b) => ({ ...project(b[0] - 0.5, b[1] - 0.5, b[2] - 0.5, angRef.current, p.tilt, cx, cy, sc), b }));
      pts.sort((a, b) => a.depth - b.depth);
      for (const pt of pts) {
        const rad = T.r * sc * 1.6;
        ctx.fillStyle = `hsl(189 80% ${45 + pt.depth * 15}%)`;
        ctx.beginPath(); ctx.arc(pt.sx, pt.sy, Math.max(3, rad), 0, Math.PI * 2); ctx.fill();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [p, spin]);

  const T = TYPES[p.type];
  return (
    <div className="space-y-3">
      <ResearchHeader title="Unit Cell Builder" subtitle="Conventional vs primitive cell with real 3D projection. Red/green/yellow = primitive vectors a₁, a₂, a₃. Compute APF from hard-sphere radius."
        onExplain={() => explain(`Unit cell ${T.name}: ${T.nAtoms} atoms/cell, hard-sphere r=${T.r.toFixed(3)}a, APF=${T.apf}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr_260px]">
        <div className="space-y-3">
          <Card title="Parameters">
            <div className="space-y-2">
              <label className="block text-sm"><span className="text-muted-foreground">Cell type</span>
                <select value={p.type} onChange={(e) => setP({ ...p, type: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
                  {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k} className="bg-background">{v.name}</option>)}
                </select>
              </label>
              <NumField label="Tilt" value={p.tilt} onChange={(v) => setP({ ...p, tilt: v })} min={0} max={1.4} step={0.05} />
              <NumField label="Scale" value={p.scale} onChange={(v) => setP({ ...p, scale: v })} min={40} max={140} step={5} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.showPrim} onChange={(e) => setP({ ...p, showPrim: e.target.checked })} className="accent-cyan-500" /><span className="text-muted-foreground">Primitive vectors</span></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} className="accent-cyan-500" /><span className="text-muted-foreground">Auto-rotate</span></label>
            </div>
          </Card>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ type: T, params: p }, null, 2), 'unitcell.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 420 }}>
          <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
        <div className="space-y-3">
          <SciTable headers={['Property', 'Value']} rows={[
            ['Type', T.name], ['Atoms/cell', T.nAtoms], ['r (hard sphere)', T.r.toFixed(4) + ' a'], ['APF', T.apf.toFixed(3)],
            ['a₁', `(${T.prim[0].join(',')})`], ['a₂', `(${T.prim[1].join(',')})`], ['a₃', `(${T.prim[2].join(',')})`],
          ]} />
          <Card><p className="text-xs text-muted-foreground">APF = (N·V_sphere)/V_cell. FCC is the densest packing of equal spheres (74%); diamond's low APF (34%) is why it's brittle.</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}