import React, { useRef, useState, useEffect } from 'react';
import { Card, SciTable, ResearchHeader, AIPanel, useAIExplain, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Download } from 'lucide-react';

// Bravais Lattices — all 14 types with 3D projection and symmetry info.
// Unique engine: each of the 14 Bravais lattices has its own primitive
// vectors and conventional cell, rendered with real 3D projection.
const BRAVAIS = [
  { id: 'cP', name: 'Cubic P (SC)', sys: 'Cubic', a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1], basis: [[0, 0, 0]] },
  { id: 'cI', name: 'Cubic I (BCC)', sys: 'Cubic', a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1], basis: [[0, 0, 0], [0.5, 0.5, 0.5]] },
  { id: 'cF', name: 'Cubic F (FCC)', sys: 'Cubic', a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1], basis: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]] },
  { id: 'tP', name: 'Tetragonal P', sys: 'Tetragonal', a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1.4], basis: [[0, 0, 0]] },
  { id: 'tI', name: 'Tetragonal I', sys: 'Tetragonal', a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1.4], basis: [[0, 0, 0], [0.5, 0.5, 0.5]] },
  { id: 'oP', name: 'Orthorhombic P', sys: 'Orthorhombic', a: [1, 0, 0], b: [0, 1.2, 0], c: [0, 0, 1.5], basis: [[0, 0, 0]] },
  { id: 'oC', name: 'Orthorhombic C', sys: 'Orthorhombic', a: [1, 0, 0], b: [0, 1.2, 0], c: [0, 0, 1.5], basis: [[0, 0, 0], [0.5, 0.5, 0]] },
  { id: 'oI', name: 'Orthorhombic I', sys: 'Orthorhombic', a: [1, 0, 0], b: [0, 1.2, 0], c: [0, 0, 1.5], basis: [[0, 0, 0], [0.5, 0.5, 0.5]] },
  { id: 'oF', name: 'Orthorhombic F', sys: 'Orthorhombic', a: [1, 0, 0], b: [0, 1.2, 0], c: [0, 0, 1.5], basis: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]] },
  { id: 'hP', name: 'Hexagonal P', sys: 'Hexagonal', a: [1, 0, 0], b: [0.5, 0.866, 0], c: [0, 0, 1.3], basis: [[0, 0, 0]] },
  { id: 'rP', name: 'Rhombohedral', sys: 'Trigonal', a: [0.8, 0.1, 0.4], b: [-0.3, 0.85, 0.4], c: [-0.3, -0.4, 0.7], basis: [[0, 0, 0]] },
  { id: 'mP', name: 'Monoclinic P', sys: 'Monoclinic', a: [1, 0, 0], b: [0.3, 1.1, 0], c: [0, 0, 1.4], basis: [[0, 0, 0]] },
  { id: 'mC', name: 'Monoclinic C', sys: 'Monoclinic', a: [1, 0, 0], b: [0.3, 1.1, 0], c: [0, 0, 1.4], basis: [[0, 0, 0], [0.5, 0.5, 0]] },
  { id: 'aP', name: 'Triclinic P', sys: 'Triclinic', a: [1, 0.1, 0.05], b: [0.15, 1.1, 0.05], c: [0.05, 0.08, 1.3], basis: [[0, 0, 0]] },
];

function project(x, y, z, ang, tilt, cx, cy, sc) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const xr = x * ca - z * sa, zr = x * sa + z * ca;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  return { sx: cx + xr * sc, sy: cy - (y * ct - zr * st) * sc, depth: y * st + zr * ct };
}

export default function BravaisLatticesSim() {
  const canvasRef = useRef(null);
  const [p, setP] = useState({ id: 'cF', rot: 0.7, tilt: 0.5, scale: 80 });
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
      const L = BRAVAIS.find((x) => x.id === p.id);
      const sc = p.scale * dpr, cx = w / 2, cy = h / 2;
      // draw conventional cell parallelepiped
      const verts = [];
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const x = i * L.a[0] + j * L.b[0] + k * L.c[0] - 0.5 * (L.a[0] + L.b[0] + L.c[0]);
        const y = i * L.a[1] + j * L.b[1] + k * L.c[1] - 0.5 * (L.a[1] + L.b[1] + L.c[1]);
        const z = i * L.a[2] + j * L.b[2] + k * L.c[2] - 0.5 * (L.a[2] + L.b[2] + L.c[2]);
        verts.push(project(x, y, z, angRef.current, p.tilt, cx, cy, sc));
      }
      const edges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
      ctx.strokeStyle = 'hsl(189 100% 50% / 0.5)'; ctx.lineWidth = 1.5 * dpr;
      for (const [a, b] of edges) { ctx.beginPath(); ctx.moveTo(verts[a].sx, verts[a].sy); ctx.lineTo(verts[b].sx, verts[b].sy); ctx.stroke(); }
      // lattice points: basis repeated over small grid
      const pts = [];
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        for (const bs of L.basis) {
          const x = (i + bs[0]) * L.a[0] + (j + bs[1]) * L.b[0] + (k + bs[2]) * L.c[0];
          const y = (i + bs[0]) * L.a[1] + (j + bs[1]) * L.b[1] + (k + bs[2]) * L.c[1];
          const z = (i + bs[0]) * L.a[2] + (j + bs[1]) * L.b[2] + (k + bs[2]) * L.c[2];
          pts.push({ ...project(x, y, z, angRef.current, p.tilt, cx, cy, sc) });
        }
      }
      pts.sort((a, b) => a.depth - b.depth);
      for (const pt of pts) {
        ctx.fillStyle = `hsl(189 80% ${45 + pt.depth * 12}%)`;
        ctx.beginPath(); ctx.arc(pt.sx, pt.sy, Math.max(2, (3 + pt.depth * 0.4) * dpr), 0, Math.PI * 2); ctx.fill();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [p, spin]);

  const L = BRAVAIS.find((x) => x.id === p.id);
  return (
    <div className="space-y-3">
      <ResearchHeader title="Bravais Lattices" subtitle="All 14 distinct 3D lattice types across 7 crystal systems. Select any lattice; conventional cell + lattice points render with real 3D projection."
        onExplain={() => explain(`Bravais lattice ${L.name} (${L.sys}): basis ${L.basis.length} point(s).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[200px_1fr_240px]">
        <div className="space-y-2">
          <Card title="Lattice (14)">
            <div className="max-h-72 overflow-y-auto scrollbar-thin space-y-0.5">
              {BRAVAIS.map((b) => (
                <button key={b.id} onClick={() => setP({ ...p, id: b.id })}
                  className={`w-full text-left rounded px-2 py-1 text-xs transition ${p.id === b.id ? 'bg-cyan-j text-black' : 'hover:bg-card/70'}`}>{b.name}</button>
              ))}
            </div>
          </Card>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} className="accent-cyan-500" /><span className="text-muted-foreground">Auto-rotate</span></label>
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify(L, null, 2), 'bravais.json', 'application/json')}><Download className="size-3.5" />Export JSON</Button>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 420 }}>
          <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
        <div className="space-y-3">
          <SciTable headers={['Property', 'Value']} rows={[
            ['Name', L.name], ['System', L.sys], ['Points/cell', L.basis.length],
            ['a', `(${L.a.join(',')})`], ['b', `(${L.b.join(',')})`], ['c', `(${L.c.join(',')})`],
          ]} />
          <Card><p className="text-xs text-muted-foreground">14 Bravais lattices = 7 crystal systems × centring (P/I/F/C). Cubic has the highest symmetry (m3̄m); triclinic the lowest (1̄).</p></Card>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}