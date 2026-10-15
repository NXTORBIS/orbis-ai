import { useMemo, useState } from 'react';
import { MoveDiagonal } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const round = (value, places = 4) => (Number.isFinite(value) ? Number(value.toFixed(places)) : 0);

export default function VectorCalculator() {
  const [dims, setDims] = useState('3');
  const [a, setA] = useState({ x: '3', y: '-1', z: '2' });
  const [b, setB] = useState({ x: '1', y: '4', z: '-2' });
  const [scalar, setScalar] = useState('2');

  const setVector = (setter) => (axis, value) => setter((current) => ({ ...current, [axis]: value }));
  const setAValue = setVector(setA);
  const setBValue = setVector(setB);

  const result = useMemo(() => {
    const three = dims === '3';
    const va = [Number(a.x) || 0, Number(a.y) || 0, three ? Number(a.z) || 0 : 0];
    const vb = [Number(b.x) || 0, Number(b.y) || 0, three ? Number(b.z) || 0 : 0];

    const magA = Math.hypot(...va);
    const magB = Math.hypot(...vb);
    const sum = va.map((value, index) => value + vb[index]);
    const difference = va.map((value, index) => value - vb[index]);
    const dot = va.reduce((total, value, index) => total + value * vb[index], 0);
    const cross = [
      va[1] * vb[2] - va[2] * vb[1],
      va[2] * vb[0] - va[0] * vb[2],
      va[0] * vb[1] - va[1] * vb[0],
    ];
    const crossMagnitude = Math.hypot(...cross);
    const angle = magA && magB ? (Math.acos(Math.max(-1, Math.min(1, dot / (magA * magB)))) * 180) / Math.PI : 0;
    const unitA = magA ? va.map((value) => value / magA) : [0, 0, 0];
    const projection = magB ? (dot / (magB * magB)) * 1 : 0;
    const projectionVector = vb.map((value) => value * projection);
    const distance = Math.hypot(...difference);
    const midpoint = va.map((value, index) => (value + vb[index]) / 2);
    const scaled = va.map((value) => value * (Number(scalar) || 0));
    const perpendicular = Math.abs(dot) < 1e-9;
    const parallel = !perpendicular && Math.abs(crossMagnitude) < 1e-9;

    return {
      three, va, vb, magA, magB, sum, difference, dot, cross, crossMagnitude, angle, unitA,
      projection, projectionVector, distance, midpoint, scaled, perpendicular, parallel,
      area: crossMagnitude,
      relation: perpendicular ? 'perpendicular' : parallel ? 'parallel' : 'neither',
    };
  }, [dims, a, b, scalar]);

  const render = (values) => values.map((value) => round(value, 3)).join(', ');

  const report = useMemo(() => [
    'a = (' + render(result.va) + ')   b = (' + render(result.vb) + ')',
    '',
    '|a| ' + round(result.magA, 4) + ' · |b| ' + round(result.magB, 4),
    'a + b = (' + render(result.sum) + ')',
    'a − b = (' + render(result.difference) + ')',
    'a · b = ' + round(result.dot, 4),
    result.three ? 'a × b = (' + render(result.cross) + ')' : 'cross product needs three dimensions',
    'Angle between them: ' + round(result.angle, 3) + '°',
    'Unit vector along a: (' + render(result.unitA) + ')',
    'Projection of a onto b: (' + render(result.projectionVector) + ')',
    result.three ? 'Area of the parallelogram: ' + round(result.area, 4) : '',
    'Relationship: ' + result.relation,
  ].filter(Boolean).join('\n'), [result]);

  const svg = useMemo(() => {
    const scale = 60;
    const max = Math.max(result.magA, result.magB, 1);
    const factor = Math.min(scale, 150 / max);
    const toX = (value) => 170 + value * factor;
    const toY = (value) => 150 - value * factor;
    return { toX, toY, factor };
  }, [result]);

  return (
    <ToolShell
      toolId="vector-calculator"
      icon={MoveDiagonal}
      title="Vector Calculator"
      desc="Two vectors in two or three dimensions: magnitude, unit vector, sum, difference, dot and cross product, the angle between them, projections and a live plot."
      state={{ dims, a, b, scalar }}
      onRestore={(restored) => {
        if (restored.dims) setDims(restored.dims);
        if (restored.a) setA(restored.a);
        if (restored.b) setB(restored.b);
        if (restored.scalar !== undefined) setScalar(String(restored.scalar));
      }}
      exportText={report}
      exportName="vectors.txt"
    >
      <Seg value={dims} onChange={setDims} options={[{ value: '2', label: '2 dimensions' }, { value: '3', label: '3 dimensions' }]} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium text-cyan-j">Vector a</div>
          <div className="grid grid-cols-3 gap-2">
            {['x', 'y', 'z'].map((axis) => (
              <Field key={axis} label={axis}>
                <input
                  value={a[axis]}
                  onChange={(e) => setAValue(axis, e.target.value)}
                  disabled={axis === 'z' && dims === '2'}
                  inputMode="decimal"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm disabled:opacity-40"
                />
              </Field>
            ))}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium text-cyan-j">Vector b</div>
          <div className="grid grid-cols-3 gap-2">
            {['x', 'y', 'z'].map((axis) => (
              <Field key={axis} label={axis}>
                <input
                  value={b[axis]}
                  onChange={(e) => setBValue(axis, e.target.value)}
                  disabled={axis === 'z' && dims === '2'}
                  inputMode="decimal"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm disabled:opacity-40"
                />
              </Field>
            ))}
          </div>
        </Panel>
      </div>

      <Field label="Scalar for k × a">
        <input value={scalar} onChange={(e) => setScalar(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Dot product a · b"
          value={String(round(result.dot, 3))}
          sub={'The angle between them is ' + round(result.angle, 2) + '° and the vectors are ' + result.relation + (result.perpendicular ? ' — the dot product is zero, which is the test for orthogonality.' : '.')}
        />
        <Ring
          value={result.angle}
          max={180}
          label="Angle between the vectors"
          sub={'0° is the same direction, 90° is perpendicular, 180° is exactly opposite. |a| ' + round(result.magA, 3) + ', |b| ' + round(result.magB, 3) + '.'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Every result</span>
          <CopyBtn value={report} label="Copy all the results" />
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {[
            { label: '|a| magnitude', value: round(result.magA, 4) },
            { label: '|b| magnitude', value: round(result.magB, 4) },
            { label: 'a + b', value: '(' + render(result.sum) + ')' },
            { label: 'a − b', value: '(' + render(result.difference) + ')' },
            { label: 'a · b dot', value: round(result.dot, 4) },
            { label: 'a × b cross', value: result.three ? '(' + render(result.cross) + ')' : 'needs 3D' },
            { label: '|a × b|', value: result.three ? round(result.crossMagnitude, 4) : '—' },
            { label: 'Angle', value: round(result.angle, 3) + '°' },
            { label: 'Unit vector â', value: '(' + render(result.unitA) + ')' },
            { label: 'k × a', value: '(' + render(result.scaled) + ')' },
            { label: 'Projection of a on b', value: '(' + render(result.projectionVector) + ')' },
            { label: 'Distance between tips', value: round(result.distance, 4) },
            { label: 'Midpoint', value: '(' + render(result.midpoint) + ')' },
            { label: 'Relationship', value: result.relation },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
              <span className="text-muted-foreground">{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Plot of the two vectors, viewed in the xy plane</div>
        <svg viewBox="0 0 340 300" className="w-full max-w-md">
          <defs>
            <marker id="vecArrow" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
            </marker>
          </defs>
          {[-3, -2, -1, 1, 2, 3].map((step) => (
            <g key={step}>
              <line x1={svg.toX(-4)} y1={svg.toY(step)} x2={svg.toX(4)} y2={svg.toY(step)} stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.5" />
              <line x1={svg.toX(step)} y1={svg.toY(-3.5)} x2={svg.toX(step)} y2={svg.toY(3.5)} stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.5" />
            </g>
          ))}
          <line x1={svg.toX(-4)} y1={svg.toY(0)} x2={svg.toX(4)} y2={svg.toY(0)} stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
          <line x1={svg.toX(0)} y1={svg.toY(-3.5)} x2={svg.toX(0)} y2={svg.toY(3.5)} stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
          <line
            x1={svg.toX(0)} y1={svg.toY(0)} x2={svg.toX(result.va[0])} y2={svg.toY(result.va[1])}
            stroke="hsl(var(--cyan))" strokeWidth="2.5" markerEnd="url(#vecArrow)" className="text-[hsl(var(--cyan))]"
          />
          <line
            x1={svg.toX(0)} y1={svg.toY(0)} x2={svg.toX(result.vb[0])} y2={svg.toY(result.vb[1])}
            stroke="#f472b6" strokeWidth="2.5" markerEnd="url(#vecArrow)" className="text-[#f472b6]"
          />
          <line
            x1={svg.toX(result.va[0])} y1={svg.toY(result.va[1])} x2={svg.toX(result.vb[0])} y2={svg.toY(result.vb[1])}
            stroke="hsl(var(--muted-foreground))" strokeWidth="1" strokeDasharray="4 3"
          />
          <text x={svg.toX(result.va[0]) + 6} y={svg.toY(result.va[1]) - 6} fontSize="11" fill="hsl(var(--cyan))">a</text>
          <text x={svg.toX(result.vb[0]) + 6} y={svg.toY(result.vb[1]) - 6} fontSize="11" fill="#f472b6">b</text>
          <text x={svg.toX(0) + 4} y={svg.toY(0) + 14} fontSize="10" fill="hsl(var(--muted-foreground))">origin</text>
        </svg>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {result.three ? 'The z components are included in every calculation but the drawing shows the xy plane, which is what you need for two of three axes.' : 'The dashed line closes the triangle, and the angle at the origin is the angle between the vectors.'}
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the operations mean</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The dot product measures how much the vectors point the same way. Zero means perpendicular — a genuine test, not an approximation.</p>
            <p>· The cross product gives a vector perpendicular to both, with magnitude equal to the area of the parallelogram they span{result.three ? ' (' + round(result.area, 3) + ' here)' : ''}.</p>
            <p>· Magnitude is Pythagoras extended to every axis, which is why the formula does not change with dimension.</p>
            <p>· A vector divided by its own magnitude gives a direction of length one — the standard way to isolate direction from scale.</p>
            <p>· The projection tells you the component of a that lies along b, which is how a force is resolved into useful and wasted parts.</p>
            <p>· The angle comes from rearranging the dot product: cos θ = (a · b) ÷ (|a||b|).</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where you meet this</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Physics: work is a dot product of force and displacement; torque and angular momentum are cross products.</p>
            <p>· Graphics: the dot product drives lighting and back-face culling, the cross product builds surface normals.</p>
            <p>· Machine learning: cosine similarity is the same angle calculation used here, applied to vectors with thousands of components.</p>
            <p>· Engineering: resolving a force along an inclined plane is a projection of one vector onto another.</p>
            <p>· Geometry: the area of a triangle is half the magnitude of the cross product of two of its sides.</p>
            <p>· {result.relation === 'perpendicular' ? 'Your vectors are exactly perpendicular, so they make a clean orthogonal basis.' : result.relation === 'parallel' ? 'Your vectors are parallel, so the cross product vanishes and they carry no independent direction.' : 'Your vectors are independent directions, so they span a plane and can be used as a basis for it.'}</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="|a|" value={round(result.magA, 3)} mono />
        <Stat label="|b|" value={round(result.magB, 3)} mono />
        <Stat label="a · b" value={round(result.dot, 3)} mono sub={result.perpendicular ? 'perpendicular' : 'not perpendicular'} />
        <Stat label="Angle" value={round(result.angle, 1) + '°'} mono sub={result.relation} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The formulas being used</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>|a| = √(x² + y² + z²)</p>
          <p>a · b = aₓbₓ + a_yb_y + a_zb_z</p>
          <p>a × b = (a_yb_z − a_zb_y, a_zbₓ − aₓb_z, aₓb_y − a_ybₓ)</p>
          <p>cos θ = (a · b) ÷ (|a| |b|)</p>
          <p>proj_b a = ((a · b) ÷ (b · b)) × b</p>
          <p className="text-cyan-j">Check: |a × b| should equal |a||b| sin θ = {result.three ? round(result.magA * result.magB * Math.sin((result.angle * Math.PI) / 180), 3) : '—'}</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Dimensions', value: dims },
              { label: 'Angle', value: round(result.angle, 1) + '°' },
              { label: 'Relation', value: result.relation },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Everything is computed from the components exactly as entered, with the angle found by inverting the cosine of the normalised dot product — clamped, so a
          rounding error can never produce an impossible angle. The zero-vector cases are handled rather than left to produce infinities.
        </p>
      </Panel>
    </ToolShell>
  );
}