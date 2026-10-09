import React, { useState, useRef, useEffect } from 'react';
import { MonitorPlay, RotateCw, ZoomIn, Box } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// 3D wireframe cube with rotation, perspective projection — pure canvas, no WebGL.
export default function GraphicsLab() {
  const [rx, setRx] = useState(30);
  const [ry, setRy] = useState(45);
  const [rz, setRz] = useState(0);
  const [fov, setFov] = useState(400);
  const [shape, setShape] = useState('cube');
  const [auto, setAuto] = useState(false);
  const canvasRef = useRef(null);

  const shapes = {
    cube: { verts: [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], edges: [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]] },
    tetra: { verts: [[1,1,1],[-1,-1,1],[-1,1,-1],[1,-1,-1]], edges: [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]] },
    octa: { verts: [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]], edges: [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[2,5],[3,4],[3,5]] },
  };

  useEffect(() => {
    if (auto) {
      const id = setInterval(() => { setRy((r) => (r + 1) % 360); setRx((r) => (r + 0.3) % 360); }, 33);
      return () => clearInterval(id);
    }
  }, [auto]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const s = shapes[shape];
    const rad = (d) => d * Math.PI / 180;
    const cos = Math.cos, sin = Math.sin;
    const rot = s.verts.map(([x, y, z]) => {
      // X
      let y1 = y * cos(rad(rx)) - z * sin(rad(rx));
      let z1 = y * sin(rad(rx)) + z * cos(rad(rx));
      // Y
      let x2 = x * cos(rad(ry)) + z1 * sin(rad(ry));
      let z2 = -x * sin(rad(ry)) + z1 * cos(rad(ry));
      // Z
      let x3 = x2 * cos(rad(rz)) - y1 * sin(rad(rz));
      let y3 = x2 * sin(rad(rz)) + y1 * cos(rad(rz));
      return [x3, y3, z2];
    });
    const project = ([x, y, z]) => {
      const scale = 80;
      const d = 4;
      const f = fov / (d + z);
      return [W / 2 + x * scale * f / 100, H / 2 + y * scale * f / 100, z];
    };
    const pts = rot.map(project);
    // sort edges by depth for painter's
    ctx.strokeStyle = 'hsl(189 100% 50%)'; ctx.lineWidth = 2;
    s.edges.forEach(([a, b]) => {
      const za = pts[a][2], zb = pts[b][2];
      const avg = (za + zb) / 2;
      ctx.globalAlpha = Math.max(0.3, 1 - (avg + 2) / 4);
      ctx.beginPath(); ctx.moveTo(pts[a][0], pts[a][1]); ctx.lineTo(pts[b][0], pts[b][1]); ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // vertices
    pts.forEach((p) => { ctx.fillStyle = 'hsl(38 100% 50%)'; ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI * 2); ctx.fill(); });
  }, [rx, ry, rz, fov, shape, auto]);

  return (
    <LabShell icon={MonitorPlay} title="Computer Graphics" description="3D wireframe rendering with perspective projection — rotate shapes and adjust the field of view.">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="rounded-lg border border-border bg-card p-4">
          <canvas ref={canvasRef} width={500} height={400} className="w-full rounded bg-background" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 text-xs font-semibold">Shape</div>
            <div className="flex gap-1">
              {[['cube', 'Cube'], ['tetra', 'Tetra'], ['octa', 'Octa']].map(([id, label]) => (
                <button key={id} onClick={() => setShape(id)} className={`flex-1 rounded-md px-2 py-1.5 text-xs ${shape === id ? 'bg-cyan-j text-background' : 'border border-border text-muted-foreground hover:border-cyan-j/40'}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <Slider label="Rotate X" value={rx} onChange={setRx} min={0} max={360} />
            <Slider label="Rotate Y" value={ry} onChange={setRy} min={0} max={360} />
            <Slider label="Rotate Z" value={rz} onChange={setRz} min={0} max={360} />
            <Slider label="FOV (perspective)" value={fov} onChange={setFov} min={100} max={1000} />
          </div>
          <button onClick={() => setAuto(!auto)} className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${auto ? 'bg-cyan-j text-background' : 'border border-border hover:border-cyan-j/40'}`}>
            <RotateCw className={`size-3.5 ${auto ? 'animate-spin' : ''}`} /> {auto ? 'Stop' : 'Auto-rotate'}
          </button>
          <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
            <div className="font-semibold text-foreground">Projection</div>
            <p className="mt-1">Perspective: <code className="font-mono-j text-cyan-j">f = fov / (d + z)</code>. Closer vertices project larger — creating depth.</p>
          </div>
        </div>
      </div>
    </LabShell>
  );
}

function Slider({ label, value, onChange, min, max }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{label}</span><span className="font-mono-j text-cyan-j">{value}°</span></div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full" />
    </div>
  );
}