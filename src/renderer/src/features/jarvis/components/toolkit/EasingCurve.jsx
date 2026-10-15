import { useEffect, useMemo, useState } from 'react';
import { Sliders, Play } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Out, CopyBtn, Panel, Stat } from './shared';
import ToolShell from './kit/ToolShell';

const PRESETS = [
  ['Linear', 0, 0, 1, 1],
  ['Ease', 0.25, 0.1, 0.25, 1],
  ['Ease in', 0.42, 0, 1, 1],
  ['Ease out', 0, 0, 0.58, 1],
  ['Ease in out', 0.42, 0, 0.58, 1],
  ['Smooth', 0.4, 0, 0.2, 1],
  ['Back out', 0.34, 1.56, 0.64, 1],
  ['Anticipate', 0.68, -0.55, 0.27, 1.55],
  ['Snap', 0.2, 0.9, 0.1, 1],
];

export default function EasingCurve() {
  const [curve, setCurve] = useState([0.34, 1.56, 0.64, 1]);
  const [active, setActive] = useState('Back out');
  const [on, setOn] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setOn((v) => !v), 1500);
    return () => clearInterval(id);
  }, []);

  const [x1, y1, x2, y2] = curve;
  const css = `cubic-bezier(${curve.map((n) => Number(n.toFixed(3))).join(', ')})`;
  const transitionCss = `transition: transform 0.6s ${css};`;

  const path = useMemo(() => {
    const toX = (v) => 20 + v * 200;
    const toY = (v) => 220 - v * 200;
    return {
      curve: `M ${toX(0)} ${toY(0)} C ${toX(x1)} ${toY(y1)} ${toX(x2)} ${toY(y2)} ${toX(1)} ${toY(1)}`,
      handles: [
        [toX(0), toY(0), toX(x1), toY(y1)],
        [toX(1), toY(1), toX(x2), toY(y2)],
      ],
      points: [[toX(x1), toY(y1)], [toX(x2), toY(y2)]],
    };
  }, [x1, y1, x2, y2]);

  const applyPreset = (preset) => {
    setCurve([preset[1], preset[2], preset[3], preset[4]]);
    setActive(preset[0]);
  };

  const update = (index, value) => {
    setActive(null);
    setCurve((cur) => cur.map((n, i) => (i === index ? value : n)));
  };

  const sliders = [
    [0, 'Control 1 · x', 0, 1, 0.01],
    [1, 'Control 1 · y', -1, 2, 0.01],
    [2, 'Control 2 · x', 0, 1, 0.01],
    [3, 'Control 2 · y', -1, 2, 0.01],
  ];

  return (
    <ToolShell
      toolId="easing-curve"
      icon={Sliders}
      title="CSS Easing Curve"
      desc="Shape a cubic-bezier by hand, watch it move, then copy the value into your styles."
      state={{ curve, active }}
      onRestore={(saved) => { setCurve(saved.curve); setActive(saved.active); }}
      exportText={transitionCss}
      exportName="easing.css"
      exportMime="text/css"
    >
      <div className="grid gap-4 sm:grid-cols-[240px_1fr]">
        <Panel className="grid place-items-center">
          <svg viewBox="0 0 240 240" className="h-48 w-48 sm:h-56 sm:w-56">
            <rect x="20" y="20" width="200" height="200" fill="none" stroke="hsl(var(--border))" strokeWidth="1" />
            <line x1="20" y1="220" x2="220" y2="20" stroke="hsl(var(--border))" strokeDasharray="3 4" strokeWidth="1" />
            {path.handles.map(([ax, ay, bx, by], i) => (
              <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke="hsl(var(--muted-foreground))" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            ))}
            <path d={path.curve} fill="none" stroke="hsl(var(--cyan))" strokeWidth="2.5" />
            {path.points.map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy} r="4.5" fill="hsl(var(--cyan))" />
            ))}
          </svg>
          <div className="font-mono-j text-[11px] text-muted-foreground">x: 0 → 1 · y: time progress</div>
        </Panel>
        <div className="space-y-3">
          {sliders.map(([index, label, min, max, step]) => (
            <Field key={label} label={`${label} · ${curve[index].toFixed(2)}`}>
              <input type="range" min={min} max={max} step={step} value={curve[index]} onChange={(e) => update(index, Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
            </Field>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset[0]}
                onClick={() => applyPreset(preset)}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${active === preset[0] ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}
              >
                {preset[0]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Movement preview</span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOn((v) => !v)}><Play className="h-3.5 w-3.5" /> Move now</Button>
        </div>
        <div className="relative h-14 rounded-xl border border-border/70 bg-secondary/25">
          <div className="absolute top-2 h-10 w-10 rounded-lg bg-cyan-j/80 shadow-lg" style={{ left: on ? 'calc(100% - 2.75rem)' : '0.25rem', transition: `left 0.9s ${css}` }} />
        </div>
        <div className="relative mt-3 h-10 rounded-xl border border-border/70 bg-secondary/25">
          {[0, 0.12, 0.24].map((delay, i) => (
            <div
              key={delay}
              className="absolute top-1.5 h-7 w-7 rounded-full bg-cyan-j/60"
              style={{ left: on ? 'calc(100% - 2rem)' : '0.25rem', transition: `left 0.9s ${css} ${delay}s` }}
            />
          ))}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">Three dots with staggered delays — the same curve applied to a sequence, as you would stagger a list.</div>
      </Panel>
      <Out label="CSS" value={transitionCss}>
        <pre className="font-mono-j text-xs text-cyan-j">{transitionCss}</pre>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Value" value={css} mono />
        <Stat label="Overshoot" value={y1 > 1 || y2 > 1 || y1 < 0 || y2 < 0 ? 'yes' : 'no'} />
        <Stat label="Feel" value={y1 > 1 ? 'springy' : y1 < 0 ? 'anticipating' : y1 < y2 ? 'ease out' : 'ease in'} />
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={css} label="Copy value" />
        <CopyBtn value={transitionCss} label="Copy full rule" />
      </div>
      <p className="text-[11px] text-muted-foreground">The x values must stay between 0 and 1 — they are the time axis — while y may go outside the range to overshoot, which is what gives springy motion its bounce.</p>
    </ToolShell>
  );
}