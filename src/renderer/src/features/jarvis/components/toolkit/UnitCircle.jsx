import { useMemo, useState } from 'react';
import { Circle } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const EXACT = {
  0: { sin: '0', cos: '1', tan: '0' },
  30: { sin: '1/2', cos: '√3/2', tan: '1/√3' },
  45: { sin: '√2/2', cos: '√2/2', tan: '1' },
  60: { sin: '√3/2', cos: '1/2', tan: '√3' },
  90: { sin: '1', cos: '0', tan: 'undefined' },
  120: { sin: '√3/2', cos: '−1/2', tan: '−√3' },
  135: { sin: '√2/2', cos: '−√2/2', tan: '−1' },
  150: { sin: '1/2', cos: '−√3/2', tan: '−1/√3' },
  180: { sin: '0', cos: '−1', tan: '0' },
  210: { sin: '−1/2', cos: '−√3/2', tan: '1/√3' },
  225: { sin: '−√2/2', cos: '−√2/2', tan: '1' },
  240: { sin: '−√3/2', cos: '−1/2', tan: '√3' },
  270: { sin: '−1', cos: '0', tan: 'undefined' },
  300: { sin: '−√3/2', cos: '1/2', tan: '−√3' },
  315: { sin: '−√2/2', cos: '√2/2', tan: '−1' },
  330: { sin: '−1/2', cos: '√3/2', tan: '−1/√3' },
  360: { sin: '0', cos: '1', tan: '0' },
};

const SPECIALS = Object.keys(EXACT).map(Number);

const reduce = (numerator, denominator) => {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const divisor = gcd(Math.abs(numerator), denominator) || 1;
  return { n: numerator / divisor, d: denominator / divisor };
};

const piLabel = (degrees) => {
  const { n, d } = reduce(degrees, 180);
  if (n === 0) return '0';
  const top = n === 1 ? 'π' : n === -1 ? '−π' : n + 'π';
  return d === 1 ? top : top + '/' + d;
};

const quadrant = (degrees) => {
  const angle = ((degrees % 360) + 360) % 360;
  if (angle === 0 || angle === 90 || angle === 180 || angle === 270) return 'on the axis';
  if (angle < 90) return 'first (all positive)';
  if (angle < 180) return 'second (only sine positive)';
  if (angle < 270) return 'third (only tangent positive)';
  return 'fourth (only cosine positive)';
};

const reference = (degrees) => {
  const angle = ((degrees % 360) + 360) % 360;
  if (angle <= 90) return angle;
  if (angle <= 180) return 180 - angle;
  if (angle <= 270) return angle - 180;
  return 360 - angle;
};

export default function UnitCircle() {
  const [angle, setAngle] = useState('60');
  const [unit, setUnit] = useState('degrees');

  const view = useMemo(() => {
    const degrees = Math.max(0, Math.min(360, Number(angle) || 0));
    const radians = (degrees * Math.PI) / 180;
    const sin = Math.sin(radians);
    const cos = Math.cos(radians);
    const tan = Math.abs(cos) < 1e-12 ? null : sin / cos;
    const exact = EXACT[degrees] || null;

    return {
      degrees, radians, sin, cos, tan, exact,
      pi: piLabel(degrees),
      quadrant: quadrant(degrees),
      reference: reference(degrees),
      sec: Math.abs(cos) < 1e-12 ? null : 1 / cos,
      csc: Math.abs(sin) < 1e-12 ? null : 1 / sin,
      cot: tan === null ? 0 : 1 / tan,
      pointX: cos,
      pointY: sin,
      arc: degrees <= 180 ? 1 : 0,
      isSpecial: SPECIALS.includes(degrees),
    };
  }, [angle]);

  const report = useMemo(() => [
    view.degrees + '°  =  ' + view.pi + ' rad  (' + view.radians.toFixed(4) + ')',
    'sin ' + view.sin.toFixed(5) + (view.exact ? '  exactly ' + view.exact.sin : ''),
    'cos ' + view.cos.toFixed(5) + (view.exact ? '  exactly ' + view.exact.cos : ''),
    'tan ' + (view.tan === null ? 'undefined' : view.tan.toFixed(5)) + (view.exact ? '  exactly ' + view.exact.tan : ''),
    '',
    'Quadrant: ' + view.quadrant,
    'Reference angle: ' + view.reference + '°',
    'Point on the circle: (' + view.cos.toFixed(4) + ', ' + view.sin.toFixed(4) + ')',
    'sec ' + (view.sec === null ? 'undefined' : view.sec.toFixed(4)) + ' · csc ' + (view.csc === null ? 'undefined' : view.csc.toFixed(4)) + ' · cot ' + view.cot.toFixed(4),
  ].join('\n'), [view]);

  const px = 120 + view.cos * 100;
  const py = 120 - view.sin * 100;

  return (
    <ToolShell
      toolId="unit-circle"
      icon={Circle}
      title="Unit Circle Explorer"
      desc="Drag the angle and watch sine, cosine and tangent move around the circle — with exact values, radians in terms of π, the quadrant and the reference angle."
      state={{ angle, unit }}
      onRestore={(restored) => {
        if (restored.angle !== undefined) setAngle(String(restored.angle));
        if (restored.unit) setUnit(restored.unit);
      }}
      exportText={report}
      exportName="unit-circle.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Field label={'Angle · ' + view.degrees + '°'}>
          <input type="range" min={0} max={360} step={1} value={angle} onChange={(e) => setAngle(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Enter an angle">
            <input value={angle} onChange={(e) => setAngle(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </Field>
          <Field label="Show as">
            <Seg value={unit} onChange={setUnit} options={[{ value: 'degrees', label: 'Degrees' }, { value: 'radians', label: 'Radians' }]} />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SPECIALS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setAngle(String(value))}
            className={Number(angle) === value
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 font-mono-j text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 font-mono-j text-[11px] text-muted-foreground transition hover:text-foreground'}
          >
            {value}°
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <Panel className="!p-3">
          <svg viewBox="-20 -20 280 280" className="w-full max-w-sm">
            <line x1="120" y1="4" x2="120" y2="236" stroke="hsl(var(--border))" strokeWidth="1" />
            <line x1="4" y1="120" x2="236" y2="120" stroke="hsl(var(--border))" strokeWidth="1" />
            <circle cx="120" cy="120" r="100" fill="none" stroke="hsl(var(--border))" strokeWidth="1.5" strokeDasharray="3 3" />
            <circle cx="120" cy="120" r="2" fill="hsl(var(--muted-foreground))" />
            <line x1="120" y1="120" x2={px} y2={py} stroke="hsl(var(--cyan))" strokeWidth="2" />
            <line x1={px} y1={py} x2={px} y2="120" stroke="hsl(var(--cyan))" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
            <line x1={px} y1={py} x2="120" y2={py} stroke="hsl(var(--cyan))" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
            <circle cx={px} cy={py} r="5" fill="hsl(var(--cyan))" />
            <text x={px + 8} y={py - 8} fontSize="11" fill="hsl(var(--cyan))" fontFamily="monospace">
              ({view.cos.toFixed(2)}, {view.sin.toFixed(2)})
            </text>
            <text x="226" y="115" fontSize="10" fill="hsl(var(--muted-foreground))" fontFamily="monospace">1</text>
            <text x="124" y="12" fontSize="10" fill="hsl(var(--muted-foreground))" fontFamily="monospace">1</text>
            <text x="10" y="115" fontSize="10" fill="hsl(var(--muted-foreground))" fontFamily="monospace">−1</text>
            <text x="30" y="26" fontSize="10" fill="hsl(var(--muted-foreground))">II</text>
            <text x="200" y="26" fontSize="10" fill="hsl(var(--muted-foreground))">I</text>
            <text x="30" y="222" fontSize="10" fill="hsl(var(--muted-foreground))">III</text>
            <text x="200" y="222" fontSize="10" fill="hsl(var(--muted-foreground))">IV</text>
            <path
              d={'M ' + (120 + 22) + ' 120 A 22 22 0 ' + view.arc + ' 0 ' + (120 + Math.cos(view.radians) * 22) + ' ' + (120 - Math.sin(view.radians) * 22)}
              fill="none"
              stroke="hsl(var(--cyan))"
              strokeWidth="2"
              opacity="0.7"
            />
          </svg>
          <p className="mt-1 text-[11px] text-muted-foreground">
            The dashed lines are the sine (vertical) and cosine (horizontal) — the point on the circle is always (−0.9… wait, always (cos θ, sin θ). Dragging the slider
            moves the point, and both dashed legs move with it.
          </p>
        </Panel>

        <div className="space-y-3">
          <Hero
            label={unit === 'degrees' ? view.degrees + '°' : view.pi + ' rad'}
            value={view.sin.toFixed(3)}
            sub={'sin θ = ' + view.sin.toFixed(4) + ' · cos θ = ' + view.cos.toFixed(4) + ' · tan θ = ' + (view.tan === null ? 'undefined' : view.tan.toFixed(4))}
          />
          <Ring
            value={Math.abs(view.sin)}
            max={1}
            label="Sine magnitude"
            sub={view.degrees + '° sits in the ' + view.quadrant + ' quadrant, reference angle ' + view.reference + '°'}
          />
        </div>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">{view.isSpecial ? 'Exact values at this angle' : 'Nearest special angle values'}</span>
          <CopyBtn value={report} label="Copy readout" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Angle</th>
                <th className="py-1 text-left font-medium">Radians</th>
                <th className="py-1 text-right font-medium">sin</th>
                <th className="py-1 text-right font-medium">cos</th>
                <th className="py-1 text-right font-medium">tan</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {SPECIALS.map((value) => (
                <tr key={value} className={value === view.degrees ? 'border-t border-cyan-j/40 bg-cyan-j/5' : 'border-t border-border/50'}>
                  <td className="py-1">{value}°</td>
                  <td className="py-1 text-muted-foreground">{piLabel(value)}</td>
                  <td className="py-1 text-right">{EXACT[value].sin}</td>
                  <td className="py-1 text-right">{EXACT[value].cos}</td>
                  <td className="py-1 text-right text-cyan-j">{EXACT[value].tan}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Every derived value at this angle</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            {[
              { label: 'sin θ', value: view.sin.toFixed(5), exact: view.exact ? view.exact.sin : '—' },
              { label: 'cos θ', value: view.cos.toFixed(5), exact: view.exact ? view.exact.cos : '—' },
              { label: 'tan θ = sin/cos', value: view.tan === null ? 'undefined' : view.tan.toFixed(5), exact: view.exact ? view.exact.tan : '—' },
              { label: 'sec θ = 1/cos', value: view.sec === null ? 'undefined' : view.sec.toFixed(5), exact: '—' },
              { label: 'csc θ = 1/sin', value: view.csc === null ? 'undefined' : view.csc.toFixed(5), exact: '—' },
              { label: 'cot θ = 1/tan', value: view.cot.toFixed(5), exact: '—' },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                <span className="text-muted-foreground">{row.label}</span>
                <span>{row.value}</span>
                <span className="text-cyan-j">{row.exact}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            At 90° and 270° the cosine is zero, so tangent and secant are undefined rather than infinite — a distinction exam marks are awarded for.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading the circle</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The point is (cos θ, sin θ) because the radius is 1 — that is the whole definition, and everything else follows from it.</p>
            <p>· Sine is the height, cosine the width. Watch the height fall to zero at 0° and 180°, and the width vanish at 90° and 270°.</p>
            <p>· Signs follow the quadrant: {view.quadrant}. Cosine is negative on the left half, sine is negative on the bottom half.</p>
            <p>· The reference angle of {view.reference}° is the acute angle to the horizontal axis; every angle in a quadrant shares the values of its reference angle, signed.</p>
            <p>· Radians are just arc length on a unit circle, so {view.degrees}° is {view.pi} — a fraction of the full 2π.</p>
            <p>· Tangent is the slope of the radius line, which is why it is undefined when the radius is vertical.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="sin" value={view.sin.toFixed(3)} mono sub={view.exact ? view.exact.sin : 'no exact form'} />
        <Stat label="cos" value={view.cos.toFixed(3)} mono sub={view.exact ? view.exact.cos : 'no exact form'} />
        <Stat label="tan" value={view.tan === null ? 'undef.' : view.tan.toFixed(3)} mono sub={view.exact ? view.exact.tan : 'no exact form'} />
        <Stat label="Radians" value={view.pi} mono sub={view.radians.toFixed(4)} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The identities this picture gives you</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Pythagoras on the two legs: sin²θ + cos²θ = 1. Check it at {view.degrees}° — {(view.sin ** 2 + view.cos ** 2).toFixed(4)}.</p>
          <p>· Tangent is the ratio: tan θ = sin θ ÷ cos θ, here {(view.tan === null ? 0 : Math.abs(view.sin / (view.cos || 1))).toFixed(4)}.</p>
          <p>· The circle repeats every 360°, so any angle can be reduced to one in the table above — 420° behaves exactly like 60°.</p>
          <p>· Negative angles run clockwise: −30° lands on the same point as 330°.</p>
          <p>· The reciprocal functions blow up wherever their partner is zero, which is why cosec at 0° is undefined rather than a very large number.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Angle', value: view.degrees + '°' },
              { label: 'Quadrant', value: view.quadrant.split(' ')[0] },
              { label: 'Reference', value: view.reference + '°' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The numeric values come from the browser's own trigonometry, and the exact forms are the standard surd values for the special angles. Where an angle is not
          a special one, the table still shows the exact values around it, which is usually how a question wants you to reason about it.
        </p>
      </Panel>
    </ToolShell>
  );
}