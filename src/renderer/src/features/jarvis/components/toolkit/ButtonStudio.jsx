import { useMemo, useState } from 'react';
import { Square } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const hexToRgba = (hex, alpha) => {
  const value = hex.replace('#', '');
  const bigint = parseInt(value.length === 3 ? value.split('').map((c) => c + c).join('') : value, 16);
  return `rgba(${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}, ${alpha})`;
};

export default function ButtonStudio() {
  const [label, setLabel] = useState('Start building');
  const [padX, setPadX] = useState(22);
  const [padY, setPadY] = useState(11);
  const [radius, setRadius] = useState(12);
  const [size, setSize] = useState(15);
  const [weight, setWeight] = useState(600);
  const [from, setFrom] = useState('#22d3ee');
  const [to, setTo] = useState('#6366f1');
  const [gradient, setGradient] = useState(true);
  const [text, setText] = useState('#04121c');
  const [border, setBorder] = useState(0);
  const [borderColour, setBorderColour] = useState('#22d3ee');
  const [glow, setGlow] = useState(18);
  const [lift, setLift] = useState(true);
  const [upper, setUpper] = useState(false);
  const [tracking, setTracking] = useState(0);

  const base = useMemo(() => ({
    padding: `${padY}px ${padX}px`,
    borderRadius: `${radius}px`,
    fontSize: `${size}px`,
    fontWeight: weight,
    color: text,
    background: gradient ? `linear-gradient(135deg, ${from}, ${to})` : from,
    border: border ? `${border}px solid ${borderColour}` : 'none',
    boxShadow: glow ? `0 ${Math.round(glow / 2)}px ${glow * 1.6}px ${hexToRgba(from, 0.35)}` : 'none',
    textTransform: upper ? 'uppercase' : 'none',
    letterSpacing: `${tracking}px`,
    cursor: 'pointer',
    transition: 'transform 0.16s ease, box-shadow 0.2s ease, filter 0.2s ease',
    fontFamily: 'inherit',
  }), [padX, padY, radius, size, weight, text, gradient, from, to, border, borderColour, glow, upper, tracking]);

  const hover = useMemo(() => ({
    ...base,
    transform: lift ? 'translateY(-2px)' : 'none',
    filter: 'brightness(1.08)',
    boxShadow: glow ? `0 ${Math.round(glow / 2) + 4}px ${glow * 2.1}px ${hexToRgba(from, 0.45)}` : 'none',
  }), [base, lift, glow, from]);

  const disabled = useMemo(() => ({ ...base, opacity: 0.45, cursor: 'not-allowed' }), [base]);

  const css = `.button {
${Object.entries(base).map(([key, value]) => `  ${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${value};`).join('\n')}
}
.button:hover {
  transform: ${lift ? 'translateY(-2px)' : 'none'};
  filter: brightness(1.08);
}
.button:active {
  transform: scale(0.97);
  filter: brightness(0.94);
}
.button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}`;

  const html = `<button class="button">${label}</button>`;

  return (
    <ToolShell
      toolId="button-studio"
      icon={Square}
      title="CSS Button Studio"
      desc="Design a button that feels premium — gradient, glow, radius and motion — and take away the exact CSS with every state."
      state={{ label, padX, padY, radius, size, weight, from, to, gradient, text, border, borderColour, glow, lift, upper, tracking }}
      onRestore={(restored) => {
        if (typeof restored.label === 'string') setLabel(restored.label);
        if (restored.padX) setPadX(Number(restored.padX));
        if (restored.padY) setPadY(Number(restored.padY));
        if (restored.radius !== undefined) setRadius(Number(restored.radius));
        if (restored.size) setSize(Number(restored.size));
        if (restored.weight) setWeight(Number(restored.weight));
        if (restored.from) setFrom(restored.from);
        if (restored.to) setTo(restored.to);
        if (typeof restored.gradient === 'boolean') setGradient(restored.gradient);
        if (restored.text) setText(restored.text);
        if (restored.border !== undefined) setBorder(Number(restored.border));
        if (restored.borderColour) setBorderColour(restored.borderColour);
        if (restored.glow !== undefined) setGlow(Number(restored.glow));
        if (typeof restored.lift === 'boolean') setLift(restored.lift);
        if (typeof restored.upper === 'boolean') setUpper(restored.upper);
        if (restored.tracking !== undefined) setTracking(Number(restored.tracking));
      }}
      exportText={`${css}\n\n<!-- ${html} -->`}
      exportName="button.css"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={`${css}\n\n${html}`} label="Copy CSS + HTML" />
        <CopyBtn value={css} label="Copy CSS only" />
      </div>

      <Panel className="!p-4">
        <div className="mb-3 text-[10px] uppercase tracking-wider text-muted-foreground">Live preview — the middle one is hover, the last is disabled</div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" style={base}>{label || 'Button'}</button>
          <button type="button" style={hover}>{label || 'Button'}</button>
          <button type="button" style={disabled} disabled>{label || 'Button'}</button>
        </div>
      </Panel>

      <Field label="Button text">
        <input value={label} onChange={(e) => setLabel(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Horizontal padding · ${padX}px`}>
          <input type="range" min={6} max={52} value={padX} onChange={(e) => setPadX(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Vertical padding · ${padY}px`}>
          <input type="range" min={4} max={26} value={padY} onChange={(e) => setPadY(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Corner radius · ${radius}px`}>
          <input type="range" min={0} max={40} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Font size · ${size}px`}>
          <input type="range" min={11} max={24} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Font weight · ${weight}`}>
          <input type="range" min={300} max={900} step={100} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Letter spacing · ${tracking}px`}>
          <input type="range" min={0} max={4} step={0.2} value={tracking} onChange={(e) => setTracking(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Colour one">
          <input type="color" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label="Colour two">
          <input type="color" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label="Text colour">
          <input type="color" value={text} onChange={(e) => setText(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label={`Glow strength · ${glow}`}>
          <input type="range" min={0} max={40} value={glow} onChange={(e) => setGlow(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Border · ${border}px`}>
          <input type="range" min={0} max={4} value={border} onChange={(e) => setBorder(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Border colour">
          <input type="color" value={borderColour} onChange={(e) => setBorderColour(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Gradient fill" checked={gradient} onChange={setGradient} />
        <ToggleRow label="Lift on hover" checked={lift} onChange={setLift} />
        <ToggleRow label="Uppercase text" checked={upper} onChange={setUpper} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">CSS</span>
          <span className="text-[10px] text-muted-foreground">paste straight into your stylesheet</span>
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{css}</pre>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Padding" value={`${padY} / ${padX}`} mono />
        <Stat label="Radius" value={`${radius}px`} mono />
        <Stat label="Font" value={`${size}px / ${weight}`} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The hover and active rules are written as separate selectors so the motion happens in CSS rather than JavaScript, which keeps the button
          smooth even on a busy page. A glow that matches the fill colour reads as lit rather than decorated — keep it under about 24px unless the
          button is the only thing on screen.
        </p>
      </Panel>
    </ToolShell>
  );
}