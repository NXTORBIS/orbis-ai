import { useMemo, useState } from 'react';
import { Sigma } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const fmt = (value, digits = 3) => {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
};

const show = (real, imag, digits = 3) => {
  const r = fmt(real, digits);
  const i = fmt(imag, digits);
  const imagPart = `${Math.abs(i)}i`;
  if (i === 0) return `${r}`;
  if (r === 0) return `${i < 0 ? '−' : ''}${imagPart}`;
  return `${r} ${i < 0 ? '−' : '+'} ${imagPart}`;
};

const polar = (real, imag) => {
  const modulus = Math.hypot(real, imag);
  const argument = Math.atan2(imag, real);
  return { modulus, argument, degrees: (argument * 180) / Math.PI };
};

export default function ComplexNumbers() {
  const [z1, setZ1] = useState({ re: '3', im: '2' });
  const [z2, setZ2] = useState({ re: '-1', im: '4' });
  const [power, setPower] = useState('3');
  const [nthRoots, setNthRoots] = useState('3');

  const result = useMemo(() => {
    const a = Number(z1.re) || 0;
    const b = Number(z1.im) || 0;
    const c = Number(z2.re) || 0;
    const d = Number(z2.im) || 0;
    const denominator = c * c + d * d;

    const sum = { re: a + c, im: b + d };
    const difference = { re: a - c, im: b - d };
    const product = { re: a * c - b * d, im: a * d + b * c };
    const quotient = denominator === 0 ? null : { re: (a * c + b * d) / denominator, im: (b * c - a * d) / denominator };

    const first = polar(a, b);
    const second = polar(c, d);
    const productPolar = { modulus: first.modulus * second.modulus, argument: first.argument + second.argument };

    const n = Math.max(1, Math.min(12, Math.round(Number(power) || 1)));
    const z1Polar = polar(a, b);
    const powerResult = {
      re: z1Polar.modulus ** n * Math.cos(n * z1Polar.argument),
      im: z1Polar.modulus ** n * Math.sin(n * z1Polar.argument),
    };

    const rootCount = Math.max(2, Math.min(12, Math.round(Number(nthRoots) || 2)));
    const roots = Array.from({ length: rootCount }, (_, index) => {
      const angle = (z1Polar.argument + 2 * Math.PI * index) / rootCount;
      const radius = z1Polar.modulus ** (1 / rootCount);
      return { re: radius * Math.cos(angle), im: radius * Math.sin(angle), angle: (angle * 180) / Math.PI, radius };
    });

    return {
      a, b, c, d, sum, difference, product, quotient, first, second, productPolar, powerResult, n, roots, rootCount,
    };
  }, [z1, z2, power, nthRoots]);

  const bounds = useMemo(() => {
    const points = [result.sum, result.difference, result.product, { re: result.a, im: result.b }, { re: result.c, im: result.d }];
    const maxX = Math.max(1, ...points.map((point) => Math.abs(point.re)));
    const maxY = Math.max(1, ...points.map((point) => Math.abs(point.im)));
    const scale = 120 / Math.max(maxX, maxY);
    return { scale, maxX, maxY };
  }, [result]);

  const toPixel = (re, im) => ({ x: 170 + re * bounds.scale, y: 170 - im * bounds.scale });

  const report = [
    `z₁ = ${show(result.a, result.b)}   z₂ = ${show(result.c, result.d)}`,
    `Sum: ${show(result.sum.re, result.sum.im)}`,
    `Difference: ${show(result.difference.re, result.difference.im)}`,
    `Product: ${show(result.product.re, result.product.im)}`,
    result.quotient ? `Quotient: ${show(result.quotient.re, result.quotient.im)}` : 'Quotient: undefined (z₂ is zero)',
    `|z₁| = ${fmt(result.first.modulus)} at ${fmt(result.first.degrees, 2)}°`,
    `|z₂| = ${fmt(result.second.modulus)} at ${fmt(result.second.degrees, 2)}°`,
    `Polar form z₁: ${fmt(result.first.modulus)} ∠ ${fmt(result.first.degrees, 2)}°`,
    `z₁^${result.n} = ${show(result.powerResult.re, result.powerResult.im)}`,
    `The ${result.rootCount} ${result.rootCount === 2 ? 'square' : result.rootCount === 3 ? 'cube' : `${result.rootCount}th`} roots of z₁:`,
    ...result.roots.map((root, index) => `  ${index + 1}. ${show(root.re, root.im)} (${fmt(root.angle, 1)}°)`),
  ].join('\n');

  const setNumber = (target, patch) => (target === 1 ? setZ1({ ...z1, ...patch }) : setZ2({ ...z2, ...patch }));

  return (
    <ToolShell
      toolId="complex-numbers"
      icon={Sigma}
      title="Complex Number Calculator"
      desc="Add, multiply, divide, raise to a power and take roots — with the polar form and an Argand diagram so the answer is something you can see."
      state={{ z1, z2, power, nthRoots }}
      onRestore={(restored) => {
        if (restored.z1 && typeof restored.z1 === 'object') setZ1({ ...z1, ...restored.z1 });
        if (restored.z2 && typeof restored.z2 === 'object') setZ2({ ...z2, ...restored.z2 });
        if (restored.power !== undefined) setPower(String(restored.power));
        if (restored.nthRoots !== undefined) setNthRoots(String(restored.nthRoots));
      }}
      exportText={report}
      exportName="complex-numbers.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={report} label="Copy working" />
        <span className="text-[11px] text-muted-foreground">i² = −1 throughout</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[{ label: 'z₁', value: z1, which: 1 }, { label: 'z₂', value: z2, which: 2 }].map((entry) => (
          <div key={entry.label} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-3">
            <div className="mb-2 font-display text-sm font-semibold text-cyan-j">{entry.label} = {show(Number(entry.value.re) || 0, Number(entry.value.im) || 0)}</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Real part">
                <input
                  value={entry.value.re}
                  onChange={(e) => setNumber(entry.which, { re: e.target.value })}
                  inputMode="decimal"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm"
                />
              </Field>
              <Field label="Imaginary part">
                <input
                  value={entry.value.im}
                  onChange={(e) => setNumber(entry.which, { im: e.target.value })}
                  inputMode="decimal"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm"
                />
              </Field>
            </div>
            <div className="mt-2 font-mono-j text-[10px] text-muted-foreground">
              |{entry.label}| = {fmt(polar(Number(entry.value.re) || 0, Number(entry.value.im) || 0).modulus)} · arg = {fmt(polar(Number(entry.value.re) || 0, Number(entry.value.im) || 0).degrees, 2)}°
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="z₁ × z₂"
          value={show(result.product.re, result.product.im)}
          sub={`moduli multiply: ${fmt(result.first.modulus)} × ${fmt(result.second.modulus)} = ${fmt(result.productPolar.modulus)} · arguments add to ${fmt((result.productPolar.argument * 180) / Math.PI, 2)}°`}
        />
        <Ring
          value={result.first.modulus}
          max={Math.max(1, result.first.modulus, result.second.modulus)}
          label="|z₁|"
          sub={`at ${fmt(result.first.degrees, 1)}° from the real axis`}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The two numbers on the complex plane</div>
        <div className="flex justify-center">
          <svg viewBox="0 0 340 340" className="h-72 w-72 max-w-full">
            <line x1="10" y1="170" x2="330" y2="170" stroke="hsl(var(--border))" strokeWidth="1" />
            <line x1="170" y1="10" x2="170" y2="330" stroke="hsl(var(--border))" strokeWidth="1" />
            <text x="322" y="186" fontSize="10" fill="hsl(var(--muted-foreground))">Re</text>
            <text x="176" y="18" fontSize="10" fill="hsl(var(--muted-foreground))">Im</text>

            {[
              { point: { re: result.a, im: result.b }, color: 'hsl(var(--cyan))', label: 'z₁' },
              { point: { re: result.c, im: result.d }, color: '#a78bfa', label: 'z₂' },
              { point: result.sum, color: '#34d399', label: 'z₁+z₂' },
              { point: result.product, color: '#fbbf24', label: 'z₁×z₂' },
            ].map((entry) => {
              const pixel = toPixel(entry.point.re, entry.point.im);
              return (
                <g key={entry.label}>
                  <line x1="170" y1="170" x2={pixel.x} y2={pixel.y} stroke={entry.color} strokeWidth="1.5" strokeDasharray="4 3" />
                  <circle cx={pixel.x} cy={pixel.y} r="4.5" fill={entry.color} />
                  <text x={pixel.x + 7} y={pixel.y - 6} fontSize="10" fill={entry.color}>{entry.label}</text>
                </g>
              );
            })}

            <circle cx="170" cy="170" r={Math.min(150, result.first.modulus * bounds.scale)} fill="none" stroke="hsl(var(--cyan))" strokeOpacity="0.25" strokeDasharray="2 4" />
          </svg>
        </div>
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          The dashed circle marks |z₁| = {fmt(result.first.modulus)}. Multiplication rotates by the second number's angle and scales by its modulus — that is
          the whole geometric meaning of the operation.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Every operation at once</div>
          <div className="space-y-1">
            {[
              { label: 'z₁ + z₂', value: show(result.sum.re, result.sum.im) },
              { label: 'z₁ − z₂', value: show(result.difference.re, result.difference.im) },
              { label: 'z₁ × z₂', value: show(result.product.re, result.product.im) },
              { label: 'z₁ ÷ z₂', value: result.quotient ? show(result.quotient.re, result.quotient.im) : 'undefined — z₂ = 0' },
              { label: 'z₁ × conj(z₁)', value: show(result.first.modulus ** 2, 0) },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                <span className="text-[11px] text-muted-foreground">{row.label}</span>
                <span className="font-mono-j text-[12px] text-cyan-j">{row.value}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Modulus and argument</div>
          <Bars
            data={[
              { label: '|z₁|', value: result.first.modulus },
              { label: '|z₂|', value: result.second.modulus },
              { label: '|z₁z₂|', value: result.productPolar.modulus },
            ]}
            format={(value) => fmt(value, 2)}
            highlightLast={false}
          />
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            <p>· z₁ in polar form: <span className="font-mono-j text-cyan-j">{fmt(result.first.modulus, 4)} ∠ {fmt(result.first.degrees, 2)}°</span></p>
            <p>· z₂ in polar form: <span className="font-mono-j text-cyan-j">{fmt(result.second.modulus, 4)} ∠ {fmt(result.second.degrees, 2)}°</span></p>
            <p>· The angle is measured anticlockwise from the positive real axis, in the range −180° to 180°.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Raise z₁ to the power (n)">
          <input value={power} onChange={(e) => setPower(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Roots to find">
          <input value={nthRoots} onChange={(e) => setNthRoots(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <div className="self-end rounded-xl border border-cyan-j/40 bg-cyan-j/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">z₁^{result.n}</div>
          <div className="font-mono-j text-sm text-cyan-j">{show(result.powerResult.re, result.powerResult.im)}</div>
        </div>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The {result.rootCount} roots of z₁ — evenly spaced around a circle</div>
        <div className="grid gap-1 sm:grid-cols-2">
          {result.roots.map((root, index) => (
            <div key={index} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="font-mono-j text-muted-foreground">root {index + 1}</span>
              <span className="font-mono-j text-cyan-j">{show(root.re, root.im)}</span>
              <span className="font-mono-j text-muted-foreground">{fmt(root.angle, 1)}°</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          By De Moivre's theorem the n roots sit on a circle of radius |z₁|^(1/n), each separated by 360°/{result.rootCount} = {fmt(360 / result.rootCount, 1)}°.
          That is why a cube root has three answers and a square root has two.
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="|z₁ × z₂|" value={fmt(result.productPolar.modulus)} mono />
        <Stat label="Re(z₁×z₂)" value={fmt(result.product.re)} mono />
        <Stat label="Im(z₁×z₂)" value={fmt(result.product.im)} mono />
        <Stat label="Range shown" value={`±${fmt(Math.max(bounds.maxX, bounds.maxY), 0)}`} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Why polar form does the work</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Rectangular form is best for adding: add the real parts, add the imaginary parts. Nothing else to remember.</p>
          <p>· Polar form is best for multiplying, dividing and powers: multiply the moduli, add the angles. Division subtracts the angles.</p>
          <p>· So {fmt(result.first.modulus, 2)} ∠ {fmt(result.first.degrees, 1)}° times {fmt(result.second.modulus, 2)} ∠ {fmt(result.second.degrees, 1)}° is {fmt(result.productPolar.modulus, 2)} ∠ {fmt((result.productPolar.argument * 180) / Math.PI, 1)}°, which is exactly the product above.</p>
          <p>· Multiplying by i is a 90° rotation — the reason complex numbers appear wherever phase matters: AC circuits, signal processing, control systems and quantum states.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'z₁', value: show(result.a, result.b, 2) },
              { label: 'z₂', value: show(result.c, result.d, 2) },
              { label: 'Power', value: result.n },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Everything is computed from the definitions: addition is component-wise, multiplication follows from i² = −1, and division rationalises the
          denominator by multiplying through by the conjugate. Powers and roots use De Moivre, which is numerically kinder than repeated multiplication and is
          how the calculator finds all n roots rather than just the principal one.
        </p>
      </Panel>
    </ToolShell>
  );
}