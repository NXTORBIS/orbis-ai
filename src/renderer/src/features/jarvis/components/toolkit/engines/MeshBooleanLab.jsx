import { useEffect, useRef, useState } from 'react';
import { Box, Download, Play, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Panel, Seg, Stat, downloadBlob } from '../shared';
import { Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { VerifyPanel } from './EngineUi';
import {
  booleanChecks, makeBox, makeCone, makeCylinder, makeSphere, makeTorus,
  meshIntersect, meshSubtract, meshUnion, meshStats, toOBJ, toSTL, transform,
} from './csgCore';

const SHAPES = [
  { value: 'box', label: 'Box', fields: [['width', 'Width', 0.2, 6, 0.1], ['height', 'Height', 0.2, 6, 0.1], ['depth', 'Depth', 0.2, 6, 0.1]] },
  { value: 'sphere', label: 'Sphere', fields: [['radius', 'Radius', 0.2, 4, 0.05], ['segments', 'Segments', 6, 40, 1], ['rings', 'Rings', 4, 28, 1]] },
  { value: 'cylinder', label: 'Cylinder', fields: [['radius', 'Radius', 0.2, 4, 0.05], ['height', 'Height', 0.2, 6, 0.1], ['segments', 'Segments', 6, 40, 1]] },
  { value: 'cone', label: 'Cone', fields: [['radius', 'Radius', 0.2, 4, 0.05], ['height', 'Height', 0.2, 6, 0.1], ['segments', 'Segments', 6, 40, 1]] },
  { value: 'torus', label: 'Torus', fields: [['major', 'Major', 0.4, 4, 0.05], ['minor', 'Tube', 0.05, 1.5, 0.05], ['segments', 'Segments', 8, 40, 1], ['rings', 'Rings', 6, 28, 1]] },
];

const COLORS = {
  a: [56, 189, 248],
  b: [167, 139, 250],
  result: [52, 211, 153],
};

const SHAPE_DEFAULTS = {
  box: { width: 2, height: 2, depth: 2 },
  sphere: { radius: 1.3, segments: 28, rings: 14 },
  cylinder: { radius: 0.9, height: 2.4, segments: 28 },
  cone: { radius: 1, height: 2.4, segments: 28 },
  torus: { major: 1.2, minor: 0.45, segments: 32, rings: 18 },
};

const spec = (shape, translate, extra = {}) => ({
  shape,
  translate,
  rotate: [0, 0, 0],
  scale: 1,
  ...SHAPE_DEFAULTS[shape],
  ...extra,
});

function build(specification) {
  const s = specification ?? {};
  let mesh = [];
  if (s.shape === 'sphere') mesh = makeSphere(s.radius, s.segments, s.rings);
  else if (s.shape === 'cylinder') mesh = makeCylinder(s.radius, s.height, s.segments);
  else if (s.shape === 'cone') mesh = makeCone(s.radius, s.height, s.segments);
  else if (s.shape === 'torus') mesh = makeTorus(s.major, s.minor, s.segments, s.rings);
  else mesh = makeBox(s.width, s.height, s.depth);
  return transform(mesh, { translate: s.translate, rotate: s.rotate, scaleFactor: s.scale });
}

const OPERATIONS = [
  { value: 'union', label: 'Union' },
  { value: 'intersect', label: 'Intersection' },
  { value: 'subtract', label: 'Subtraction' },
];

export default function MeshBooleanLab() {
  const [specA, setSpecA] = useState(() => spec('box', [-0.45, 0, 0]));
  const [specB, setSpecB] = useState(() => spec('sphere', [0.55, 0, 0]));
  const [operation, setOperation] = useState('subtract');
  const [wireframe, setWireframe] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState({ a: true, b: true, result: true });

  const compute = () => {
    setBusy(true);
    setError('');
    // Defer a frame so the busy state paints before the geometry work begins.
    setTimeout(() => {
      try {
        const started = performance.now();
        const a = build(specA);
        const b = build(specB);
        const union = meshUnion(a, b);
        const intersect = meshIntersect(a, b);
        const difference = meshSubtract(a, b);
        const checks = booleanChecks({ a, b, union, intersect, difference });
        setResult({ a, b, union, intersect, difference, checks, elapsed: performance.now() - started });
      } catch (thrown) {
        setError(`The geometry could not be evaluated: ${thrown.message}. Very fine resolutions or exactly coincident faces are the usual cause — try lowering the resolution or moving one solid slightly.`);
      }
      setBusy(false);
    }, 30);
  };

  const meshes = result ? [
    { mesh: result.a, color: COLORS.a, visible: visible.a, key: 'a' },
    { mesh: result.b, color: COLORS.b, visible: visible.b, key: 'b' },
    { mesh: result[operation], color: COLORS.result, visible: visible.result, key: 'result' },
  ] : [];

  const activeStats = result ? meshStats(result[operation]) : null;
  const report = result
    ? [
        `operation: ${operation}`,
        `A: ${meshStats(result.a).triangles} triangles, volume ${meshStats(result.a).volume.toFixed(6)}`,
        `B: ${meshStats(result.b).triangles} triangles, volume ${meshStats(result.b).volume.toFixed(6)}`,
        `result: ${activeStats.triangles} triangles, volume ${activeStats.volume.toFixed(6)}, watertight ${activeStats.watertight}`,
        `union identity gap ${result.checks.unionIdentity?.toFixed(8)} (tolerance ${result.checks.tolerance.toFixed(8)})`,
        `difference identity gap ${result.checks.differenceIdentity?.toFixed(8)}`,
      ].join('\n')
    : '';

  return (
    <ToolShell
      toolId="mesh-boolean"
      icon={Box}
      title="Geometric Mesh Boolean Engine"
      desc="Union, intersection and subtraction between closed solids, computed with BSP trees — with the volume identities, manifold checks and Euler characteristic that decide whether the result can be trusted."
      state={{ specA, specB, operation, wireframe }}
      onRestore={(state) => {
        if (!state) return;
        if (state.specA) setSpecA(state.specA);
        if (state.specB) setSpecB(state.specB);
        if (state.operation) setOperation(state.operation);
        if (state.wireframe != null) setWireframe(state.wireframe);
      }}
      exportText={report}
      exportName="mesh-boolean.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={operation} onChange={setOperation} options={OPERATIONS} />
        {busy
          ? <Button size="sm" variant="outline" disabled className="gap-1.5"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Computing</Button>
          : <Button size="sm" onClick={compute} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Compute</Button>}
        <Button size="sm" variant="outline" onClick={() => setWireframe((value) => !value)} className="gap-1.5">
          {wireframe ? 'Solid' : 'Wireframe'}
        </Button>
        {['a', 'b', 'result'].map((key) => (
          <Button key={key} size="sm" variant="ghost" onClick={() => setVisible((state) => ({ ...state, [key]: !state[key] }))}
            className={visible[key] ? 'text-cyan-j' : 'text-muted-foreground'}>
            {key === 'result' ? 'Result' : key.toUpperCase()}
          </Button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">{error}</div>}

      <div className="grid gap-3 md:grid-cols-2">
        <OperandEditor title="Solid A" tint="text-cyan-j" specification={specA} onChange={setSpecA} />
        <OperandEditor title="Solid B" tint="text-violet-400" specification={specB} onChange={setSpecB} />
      </div>

      <Viewer meshes={meshes} wireframe={wireframe} />

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
            <Hero
              label={`${operation} volume`}
              value={activeStats.volume.toFixed(4)}
              tone={activeStats.watertight ? 'emerald' : 'amber'}
              sub={`${activeStats.triangles} triangles · ${activeStats.vertices} welded vertices`}
            />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Watertight" value={activeStats.watertight ? 'yes' : 'no'} sub={`${activeStats.boundaryEdges} boundary edges`} />
              <Stat label="Non-manifold edges" value={activeStats.nonManifoldEdges} sub="more than two triangles per edge" mono />
              <Stat label="Euler V−E+F" value={activeStats.euler} sub="2 for a simple closed solid, 0 for a torus" mono />
              <Stat label="Computed in" value={`${result.elapsed.toFixed(0)} ms`} sub="three operations" mono />
            </div>
          </div>

          <Panel>
            <div className="mb-2 text-xs font-semibold">All three results</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left font-mono-j text-[11px]">
                <thead className="text-muted-foreground">
                  <tr><th className="py-1">operation</th><th>triangles</th><th>volume</th><th>watertight</th><th>euler</th></tr>
                </thead>
                <tbody>
                  {['union', 'intersect', 'difference'].map((key) => {
                    const stats = meshStats(result[key]);
                    return (
                      <tr key={key} className="border-t border-border/50">
                        <td className="py-1">{key}</td>
                        <td>{stats.triangles}</td>
                        <td>{stats.volume.toFixed(4)}</td>
                        <td className={stats.watertight ? 'text-emerald-400' : 'text-amber-400'}>{stats.watertight ? 'yes' : 'no'}</td>
                        <td>{stats.euler}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <VerifyPanel
            items={[
              { label: 'V(A∪B) + V(A∩B) = V(A) + V(B)', ok: result.checks.unionOk, detail: `gap ${result.checks.unionIdentity?.toExponential(2)} ≤ ${result.checks.tolerance.toExponential(2)}` },
              { label: 'V(A−B) = V(A) − V(A∩B)', ok: result.checks.differenceOk, detail: `gap ${result.checks.differenceIdentity?.toExponential(2)}` },
              { label: 'Result is closed — every edge shared by exactly two triangles', ok: activeStats.watertight, detail: `${activeStats.boundaryEdges} boundary, ${activeStats.nonManifoldEdges} non-manifold` },
              { label: 'Result contains triangles', ok: activeStats.triangles > 0, detail: `${activeStats.triangles}` },
            ]}
            note="The two volume identities are independent of the boolean code: they hold for any correct pair of volumes, so a mistake in the BSP clipping shows up as a gap far larger than the tolerance."
          />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadBlob(new Blob([toOBJ(result[operation])], { type: 'text/plain' }), `${operation}.obj`)}>
              <Download className="h-3.5 w-3.5" /> OBJ
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadBlob(new Blob([toSTL(result[operation], operation)], { type: 'text/plain' }), `${operation}.stl`)}>
              <Download className="h-3.5 w-3.5" /> STL
            </Button>
            <Pills items={[
              { label: 'A facets', value: meshStats(result.a).triangles },
              { label: 'B facets', value: meshStats(result.b).triangles },
              { label: 'result facets', value: activeStats.triangles },
            ]} />
          </div>
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· The algorithm builds a BSP tree from one solid's faces, clips the other solid against it, and keeps the pieces that belong inside the result. Splitting triangles against planes is where every vertex of the output is born, so the topology follows the geometry rather than a voxel grid.</p>
          <p>· Exact coplanar contact is the hard case: two cubes sharing a face, or faces that touch to within floating-point noise, can leave slivers. If the checks report boundary or non-manifold edges, nudge one solid a fraction and recompute — that is the honest fix, not a tolerance dial.</p>
          <p>· Resolution is capped deliberately. Cost grows with the number of faces fed to the tree, and a browser tab is not the place to boolean a hundred thousand triangles. Coarser segments still verify exactly, which is what the volume identities are for.</p>
          <p>· Volumes come from the divergence theorem — each triangle contributes the signed tetrahedron it forms with the origin. That measure is orientation-sensitive, which is why it also validates winding.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}

function OperandEditor({ title, tint, specification, onChange }) {
  const shape = SHAPES.find((entry) => entry.value === specification.shape) ?? SHAPES[0];
  const update = (patch) => onChange({ ...specification, ...patch });
  const updateAxis = (key, index, value) => {
    const next = [...specification[key]];
    next[index] = value;
    update({ [key]: next });
  };
  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold ${tint}`}>{title}</span>
        <select
          value={specification.shape}
          onChange={(event) => update({ shape: event.target.value, ...SHAPE_DEFAULTS[event.target.value] })}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
        >
          {SHAPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {shape.fields.map(([key, label, min, max, step]) => (
          <label key={key} className="block">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
            <input
              type="number"
              value={specification[key] ?? ''}
              min={min}
              max={max}
              step={step}
              onChange={(event) => update({ [key]: Number(event.target.value) })}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-xs"
            />
          </label>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {['x', 'y', 'z'].map((axis, index) => (
          <label key={`p${axis}`} className="block">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-muted-foreground">pos {axis}</span>
            <input
              type="number"
              value={specification.translate[index]}
              step={0.05}
              onChange={(event) => updateAxis('translate', index, Number(event.target.value))}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-xs"
            />
          </label>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {['x', 'y', 'z'].map((axis, index) => (
          <label key={`r${axis}`} className="block">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-muted-foreground">rot {axis}°</span>
            <input
              type="number"
              value={specification.rotate[index]}
              step={5}
              min={-180}
              max={180}
              onChange={(event) => updateAxis('rotate', index, Number(event.target.value))}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-xs"
            />
          </label>
        ))}
      </div>
    </Panel>
  );
}

/** A small software renderer: rotate, project, sort by depth, shade flat. */
function Viewer({ meshes, wireframe }) {
  const canvasRef = useRef(null);
  const [view, setView] = useState({ yaw: 0.7, pitch: 0.32, zoom: 1 });
  const drag = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const visible = meshes.filter((entry) => entry.visible && entry.mesh?.length);
      if (!visible.length) {
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.font = '12px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Compute a boolean to see the solids', rect.width / 2, rect.height / 2);
        return;
      }

      const bounds = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
      visible.forEach((entry) => entry.mesh.forEach((triangle) => triangle.forEach((point) => {
        bounds.min.x = Math.min(bounds.min.x, point.x); bounds.max.x = Math.max(bounds.max.x, point.x);
        bounds.min.y = Math.min(bounds.min.y, point.y); bounds.max.y = Math.max(bounds.max.y, point.y);
        bounds.min.z = Math.min(bounds.min.z, point.z); bounds.max.z = Math.max(bounds.max.z, point.z);
      })));
      const centre = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: (bounds.min.z + bounds.max.z) / 2,
      };
      const radius = Math.max(0.3, Math.hypot(
        bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) / 2);
      const scale = (Math.min(rect.width, rect.height) * 0.4 * view.zoom) / radius;
      const camera = radius * 5;
      const cosY = Math.cos(view.yaw); const sinY = Math.sin(view.yaw);
      const cosP = Math.cos(view.pitch); const sinP = Math.sin(view.pitch);

      const rotate = (point) => {
        const x0 = point.x - centre.x; const y0 = point.y - centre.y; const z0 = point.z - centre.z;
        const x1 = x0 * cosY - z0 * sinY;
        const z1 = x0 * sinY + z0 * cosY;
        const y1 = y0 * cosP - z1 * sinP;
        const z2 = y0 * sinP + z1 * cosP;
        return { x: x1, y: y1, z: z2 };
      };
      const project = (point) => {
        const r = rotate(point);
        const persp = camera / Math.max(camera * 0.35, camera + r.z);
        return { x: rect.width / 2 + r.x * scale * persp, y: rect.height / 2 - r.y * scale * persp, depth: r.z };
      };

      const light = { x: 0.35, y: 0.55, z: 0.76 };
      const faces = [];
      visible.forEach((entry) => {
        entry.mesh.forEach((triangle) => {
          const projected = triangle.map(project);
          const normal = rotate({
            x: (triangle[1].y - triangle[0].y) * (triangle[2].z - triangle[0].z) - (triangle[1].z - triangle[0].z) * (triangle[2].y - triangle[0].y),
            y: (triangle[1].z - triangle[0].z) * (triangle[2].x - triangle[0].x) - (triangle[1].x - triangle[0].x) * (triangle[2].z - triangle[0].z),
            z: (triangle[1].x - triangle[0].x) * (triangle[2].y - triangle[0].y) - (triangle[1].y - triangle[0].y) * (triangle[2].x - triangle[0].x),
          });
          const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
          const shade = 0.3 + 0.7 * Math.abs((normal.x * light.x + normal.y * light.y + normal.z * light.z) / length);
          const [r, g, b] = entry.color;
          faces.push({
            projected,
            depth: (projected[0].depth + projected[1].depth + projected[2].depth) / 3,
            fill: `rgb(${Math.round(r * shade)} ${Math.round(g * shade)} ${Math.round(b * shade)})`,
          });
        });
      });

      faces.sort((left, right) => left.depth - right.depth);
      faces.forEach((face) => {
        ctx.beginPath();
        ctx.moveTo(face.projected[0].x, face.projected[0].y);
        ctx.lineTo(face.projected[1].x, face.projected[1].y);
        ctx.lineTo(face.projected[2].x, face.projected[2].y);
        ctx.closePath();
        ctx.fillStyle = face.fill;
        ctx.fill();
        if (wireframe) {
          ctx.strokeStyle = 'rgba(3,7,18,0.5)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      });
    };

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [meshes, view, wireframe]);

  return (
    <div className="tk-glass-panel relative overflow-hidden rounded-xl">
      <canvas
        ref={canvasRef}
        className="h-[22rem] w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, ...view };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setView({
            ...view,
            yaw: drag.current.yaw + (event.clientX - drag.current.x) * 0.01,
            pitch: Math.max(-1.45, Math.min(1.45, drag.current.pitch + (event.clientY - drag.current.y) * 0.01)),
          });
        }}
        onPointerUp={() => { drag.current = null; }}
        onWheel={(event) => {
          event.preventDefault();
          setView((state) => ({ ...state, zoom: Math.max(0.25, Math.min(4, state.zoom * (event.deltaY > 0 ? 0.92 : 1.08))) }));
        }}
      />
      <div className="pointer-events-none absolute bottom-2 left-3 font-mono-j text-[10px] text-muted-foreground">
        drag to orbit · scroll to zoom
      </div>
    </div>
  );
}