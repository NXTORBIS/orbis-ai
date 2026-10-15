import { useMemo, useState } from 'react';
import { Circle } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const SHAPES = [
  {
    id: 'circle', label: 'Circle', fields: [{ key: 'r', label: 'Radius (r)' }],
    run: (v) => [
      { label: 'Area', value: Math.PI * v.r ** 2 },
      { label: 'Circumference', value: 2 * Math.PI * v.r },
      { label: 'Diameter', value: v.r * 2 },
    ],
    formula: 'A = πr²   C = 2πr',
  },
  {
    id: 'ring', label: 'Ring / annulus', fields: [{ key: 'R', label: 'Outer radius (R)' }, { key: 'r', label: 'Inner radius (r)' }],
    run: (v) => [
      { label: 'Area', value: Math.PI * (v.R ** 2 - v.r ** 2) },
      { label: 'Outer circumference', value: 2 * Math.PI * v.R },
      { label: 'Inner circumference', value: 2 * Math.PI * v.r },
      { label: 'Width', value: v.R - v.r },
    ],
    formula: 'A = π(R² − r²)',
  },
  {
    id: 'rect', label: 'Rectangle', fields: [{ key: 'w', label: 'Width' }, { key: 'h', label: 'Height' }],
    run: (v) => [
      { label: 'Area', value: v.w * v.h },
      { label: 'Perimeter', value: 2 * (v.w + v.h) },
      { label: 'Diagonal', value: Math.hypot(v.w, v.h) },
      { label: 'Aspect ratio', value: `${(v.w / (v.h || 1)).toFixed(3)} : 1` },
    ],
    formula: 'A = w · h   P = 2(w + h)   d = √(w² + h²)',
  },
  {
    id: 'triangle', label: 'Triangle (3 sides)', fields: [{ key: 'a', label: 'Side a' }, { key: 'b', label: 'Side b' }, { key: 'c', label: 'Side c' }],
    run: (v) => {
      const s = (v.a + v.b + v.c) / 2;
      const area2 = s * (s - v.a) * (s - v.b) * (s - v.c);
      if (area2 <= 0) return [{ label: 'Area', value: NaN, note: 'these three sides cannot form a triangle' }];
      const area = Math.sqrt(area2);
      const angleA = (Math.acos((v.b ** 2 + v.c ** 2 - v.a ** 2) / (2 * v.b * v.c)) * 180) / Math.PI;
      return [
        { label: 'Area', value: area },
        { label: 'Perimeter', value: 2 * s },
        { label: 'Height on side a', value: (2 * area) / v.a },
        { label: 'Angle opposite a', value: angleA, suffix: '°' },
        { label: 'Type', value: v.a === v.b && v.b === v.c ? 'Equilateral' : v.a === v.b || v.b === v.c || v.a === v.c ? 'Isosceles' : 'Scalene' },
      ];
    },
    formula: 'A = √(s(s−a)(s−b)(s−c)),  s = (a+b+c)/2',
  },
  {
    id: 'trapezoid', label: 'Trapezoid', fields: [{ key: 'a', label: 'Parallel side a' }, { key: 'b', label: 'Parallel side b' }, { key: 'h', label: 'Height' }],
    run: (v) => [{ label: 'Area', value: ((v.a + v.b) / 2) * v.h }, { label: 'Average width', value: (v.a + v.b) / 2 }],
    formula: 'A = ½(a + b) · h',
  },
  {
    id: 'polygon', label: 'Regular polygon', fields: [{ key: 'n', label: 'Number of sides' }, { key: 's', label: 'Side length' }],
    run: (v) => {
      const n = Math.max(3, Math.round(v.n));
      const area = (n * v.s ** 2) / (4 * Math.tan(Math.PI / n));
      return [
        { label: 'Area', value: area },
        { label: 'Perimeter', value: n * v.s },
        { label: 'Apothem', value: v.s / (2 * Math.tan(Math.PI / n)) },
        { label: 'Interior angle', value: ((n - 2) * 180) / n, suffix: '°' },
        { label: 'Circumradius', value: v.s / (2 * Math.sin(Math.PI / n)) },
      ];
    },
    formula: 'A = n·s² / (4·tan(π/n))',
  },
  {
    id: 'ellipse', label: 'Ellipse', fields: [{ key: 'a', label: 'Semi-major (a)' }, { key: 'b', label: 'Semi-minor (b)' }],
    run: (v) => {
      const h = ((v.a - v.b) / (v.a + v.b)) ** 2;
      return [
        { label: 'Area', value: Math.PI * v.a * v.b },
        { label: 'Perimeter (Ramanujan)', value: Math.PI * (v.a + v.b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))) },
        { label: 'Eccentricity', value: Math.sqrt(1 - v.b ** 2 / v.a ** 2) },
      ];
    },
    formula: 'A = πab',
  },
  {
    id: 'sphere', label: 'Sphere (3D)', fields: [{ key: 'r', label: 'Radius (r)' }],
    run: (v) => [
      { label: 'Volume', value: (4 / 3) * Math.PI * v.r ** 3 },
      { label: 'Surface area', value: 4 * Math.PI * v.r ** 2 },
      { label: 'Great-circle circumference', value: 2 * Math.PI * v.r },
    ],
    formula: 'V = 4/3·πr³   S = 4πr²',
  },
  {
    id: 'cylinder', label: 'Cylinder (3D)', fields: [{ key: 'r', label: 'Radius' }, { key: 'h', label: 'Height' }],
    run: (v) => [
      { label: 'Volume', value: Math.PI * v.r ** 2 * v.h },
      { label: 'Total surface', value: 2 * Math.PI * v.r * (v.r + v.h) },
      { label: 'Lateral surface', value: 2 * Math.PI * v.r * v.h },
      { label: 'Capacity (litres, cm units)', value: (Math.PI * v.r ** 2 * v.h) / 1000 },
    ],
    formula: 'V = πr²h   S = 2πr(r + h)',
  },
  {
    id: 'cone', label: 'Cone (3D)', fields: [{ key: 'r', label: 'Base radius' }, { key: 'h', label: 'Height' }],
    run: (v) => {
      const slant = Math.hypot(v.r, v.h);
      return [
        { label: 'Volume', value: (Math.PI * v.r ** 2 * v.h) / 3 },
        { label: 'Slant height', value: slant },
        { label: 'Total surface', value: Math.PI * v.r * (v.r + slant) },
        { label: 'Lateral surface', value: Math.PI * v.r * slant },
      ];
    },
    formula: 'V = ⅓πr²h   S = πr(r + l),  l = √(r² + h²)',
  },
  {
    id: 'box', label: 'Box / cube (3D)', fields: [{ key: 'l', label: 'Length' }, { key: 'w', label: 'Width' }, { key: 'h', label: 'Height' }],
    run: (v) => [
      { label: 'Volume', value: v.l * v.w * v.h },
      { label: 'Surface area', value: 2 * (v.l * v.w + v.w * v.h + v.l * v.h) },
      { label: 'Space diagonal', value: Math.hypot(v.l, v.w, v.h) },
      { label: 'Capacity (litres, cm units)', value: (v.l * v.w * v.h) / 1000 },
    ],
    formula: 'V = l·w·h   S = 2(lw + wh + lh)',
  },
  {
    id: 'pyramid', label: 'Square pyramid (3D)', fields: [{ key: 'a', label: 'Base side' }, { key: 'h', label: 'Height' }],
    run: (v) => {
      const slant = Math.hypot(v.h, v.a / 2);
      return [
        { label: 'Volume', value: (v.a ** 2 * v.h) / 3 },
        { label: 'Slant height', value: slant },
        { label: 'Lateral surface', value: 2 * v.a * slant },
        { label: 'Total surface', value: v.a ** 2 + 2 * v.a * slant },
      ];
    },
    formula: 'V = ⅓a²h   S = a² + 2a·l',
  },
  {
    id: 'torus', label: 'Torus (3D)', fields: [{ key: 'R', label: 'Ring radius (R)' }, { key: 'r', label: 'Tube radius (r)' }],
    run: (v) => [
      { label: 'Volume', value: 2 * Math.PI ** 2 * v.R * v.r ** 2 },
      { label: 'Surface area', value: 4 * Math.PI ** 2 * v.R * v.r },
      { label: 'Inner hole diameter', value: 2 * (v.R - v.r) },
    ],
    formula: 'V = 2π²Rr²   S = 4π²Rr',
  },
];

const fmt = (value, suffix = '') => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const rounded = Math.abs(number) >= 1000 ? number.toFixed(2) : number.toPrecision(6).replace(/\.?0+$/, '');
  return `${Number(rounded).toLocaleString(undefined, { maximumFractionDigits: 6 })}${suffix}`;
};

export default function GeometryCalculator() {
  const [shapeId, setShapeId] = useState('circle');
  const [values, setValues] = useState({});

  const shape = useMemo(() => SHAPES.find((s) => s.id === shapeId) || SHAPES[0], [shapeId]);
  const inputs = useMemo(() => {
    const out = {};
    shape.fields.forEach((field) => { out[field.key] = Number(values[`${shape.id}.${field.key}`] ?? 1) || 0; });
    return out;
  }, [shape, values]);

  const results = useMemo(() => {
    try {
      return shape.run(inputs).map((r) => ({ ...r, display: typeof r.value === 'number' ? fmt(r.value, r.suffix) : r.value, note: r.note || '' }));
    } catch {
      return [];
    }
  }, [shape, inputs]);

  const report = `${shape.label}\n${shape.fields.map((f) => `${f.label}: ${inputs[f.key]}`).join('\n')}\n\n${results.map((r) => `${r.label}: ${r.display}${r.note ? ` (${r.note})` : ''}`).join('\n')}\n\n${shape.formula}`;

  return (
    <ToolShell
      toolId="geometry"
      icon={Circle}
      title="Geometry Calculator"
      desc="Area, perimeter, volume and surface area for the shapes that come up in real work — with the formula shown beside each answer."
      state={{ shapeId, values }}
      onRestore={(restored) => {
        if (restored.shapeId) setShapeId(restored.shapeId);
        if (restored.values) setValues(restored.values);
      }}
      exportText={report}
      exportName="geometry.txt"
    >
      <Field label="Shape">
        <div className="flex flex-wrap gap-1.5">
          {SHAPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setShapeId(s.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                shapeId === s.id ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        {shape.fields.map((field) => (
          <Field key={field.key} label={field.label}>
            <input
              value={values[`${shape.id}.${field.key}`] ?? '1'}
              onChange={(e) => setValues((current) => ({ ...current, [`${shape.id}.${field.key}`]: e.target.value }))}
              inputMode="decimal"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm"
            />
          </Field>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {results.map((r) => (
          <Stat key={r.label} label={r.label} value={String(r.display)} sub={r.note} mono />
        ))}
      </div>

      <Panel className="!p-3">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Formula</div>
        <div className="font-mono-j text-xs text-cyan-j">{shape.formula}</div>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={report} label="Copy working" />
        <span className="text-[11px] text-muted-foreground">Units are whatever you put in — keep them consistent and the units come out consistent too.</span>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Volume and capacity lines assume your inputs are in centimetres when they mention litres, which is the quickest way to check paint,
          aquarium or packaging sizes. Triangles are solved from three sides with Heron's formula, and impossible side combinations say so instead
          of inventing a number.
        </p>
      </Panel>
    </ToolShell>
  );
}