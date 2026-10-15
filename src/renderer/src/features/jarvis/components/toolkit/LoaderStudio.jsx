import { useState } from 'react';
import { Loader } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const SPINNERS = [
  {
    id: 'ring', label: 'Ring',
    css: (c, t, s) => `@keyframes spin { to { transform: rotate(360deg) } }\n.spinner {\n  width: ${s}px; height: ${s}px;\n  border: ${t}px solid ${c}33;\n  border-top-color: ${c};\n  border-radius: 50%;\n  animation: spin 0.8s linear infinite;\n}`,
    html: '<div class="spinner"></div>',
  },
  {
    id: 'dual', label: 'Dual ring',
    css: (c, t, s) => `@keyframes spin { to { transform: rotate(360deg) } }\n.spinner {\n  width: ${s}px; height: ${s}px;\n  border: ${t}px solid transparent;\n  border-top-color: ${c};\n  border-bottom-color: ${c};\n  border-radius: 50%;\n  animation: spin 0.9s cubic-bezier(0.6, 0.1, 0.4, 0.9) infinite;\n}`,
    html: '<div class="spinner"></div>',
  },
  {
    id: 'dots', label: 'Bouncing dots',
    css: (c, t, s) => `@keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.5 } 40% { transform: scale(1); opacity: 1 } }\n.spinner { display: flex; gap: ${Math.round(t * 1.6)}px; }\n.spinner span {\n  width: ${s}px; height: ${s}px; border-radius: 50%; background: ${c};\n  animation: bounce 1.2s ease-in-out infinite;\n}\n.spinner span:nth-child(2) { animation-delay: 0.16s }\n.spinner span:nth-child(3) { animation-delay: 0.32s }`,
    html: '<div class="spinner"><span></span><span></span><span></span></div>',
  },
  {
    id: 'bars', label: 'Bars',
    css: (c, t, s) => `@keyframes stretch { 0%, 40%, 100% { transform: scaleY(0.35) } 20% { transform: scaleY(1) } }\n.spinner { display: flex; gap: ${Math.round(t * 0.9)}px; height: ${s}px; align-items: center; }\n.spinner span {\n  width: ${Math.max(3, Math.round(s / 5))}px; height: 100%; background: ${c}; border-radius: 2px;\n  animation: stretch 1s ease-in-out infinite;\n}\n.spinner span:nth-child(2) { animation-delay: 0.1s }\n.spinner span:nth-child(3) { animation-delay: 0.2s }\n.spinner span:nth-child(4) { animation-delay: 0.3s }`,
    html: '<div class="spinner"><span></span><span></span><span></span><span></span></div>',
  },
  {
    id: 'pulse', label: 'Pulse',
    css: (c, t, s) => `@keyframes pulse { 0% { transform: scale(0.7); opacity: 1 } 100% { transform: scale(1.35); opacity: 0 } }\n.spinner {\n  width: ${s}px; height: ${s}px; border-radius: 50%; background: ${c};\n  animation: pulse 1.4s ease-out infinite;\n}`,
    html: '<div class="spinner"></div>',
  },
  {
    id: 'ripple', label: 'Ripple',
    css: (c, t, s) => `@keyframes ripple { 0% { transform: scale(0.3); opacity: 0.9 } 80%, 100% { transform: scale(1); opacity: 0 } }\n.spinner { position: relative; width: ${s * 1.6}px; height: ${s * 1.6}px; }\n.spinner span {\n  position: absolute; inset: 0; border: ${t}px solid ${c}; border-radius: 50%;\n  animation: ripple 1.5s cubic-bezier(0, 0.2, 0.8, 1) infinite;\n}\n.spinner span:nth-child(2) { animation-delay: 0.75s }`,
    html: '<div class="spinner"><span></span><span></span></div>',
  },
  {
    id: 'orbit', label: 'Orbit',
    css: (c, t, s) => `@keyframes spin { to { transform: rotate(360deg) } }\n@keyframes counter { to { transform: rotate(-360deg) } }\n.spinner { position: relative; width: ${s * 1.4}px; height: ${s * 1.4}px; animation: spin 1.6s linear infinite; }\n.spinner::before {\n  content: ''; position: absolute; top: 0; left: 50%; width: ${t * 2}px; height: ${t * 2}px;\n  margin-left: ${-t}px; border-radius: 50%; background: ${c};\n}\n.spinner::after {\n  content: ''; position: absolute; inset: ${t * 2}px; border: 1px solid ${c}66; border-radius: 50%;\n}`,
    html: '<div class="spinner"></div>',
  },
  {
    id: 'flip', label: 'Flip square',
    css: (c, t, s) => `@keyframes flip { 0% { transform: perspective(120px) rotateX(0) rotateY(0) } 50% { transform: perspective(120px) rotateX(-180deg) rotateY(0) } 100% { transform: perspective(120px) rotateX(-180deg) rotateY(-180deg) } }\n.spinner {\n  width: ${s}px; height: ${s}px; background: ${c}; border-radius: ${Math.round(t * 1.5)}px;\n  animation: flip 1.4s ease-in-out infinite;\n}`,
    html: '<div class="spinner"></div>',
  },
  {
    id: 'gradient-ring', label: 'Conic ring',
    css: (c, t, s) => `@keyframes spin { to { transform: rotate(360deg) } }\n.spinner {\n  width: ${s}px; height: ${s}px; border-radius: 50%;\n  background: conic-gradient(${c}00, ${c});\n  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - ${t}px), #000 0);\n  mask: radial-gradient(farthest-side, transparent calc(100% - ${t}px), #000 0);\n  animation: spin 0.9s linear infinite;\n}`,
    html: '<div class="spinner"></div>',
  },
  {
    id: 'grid', label: 'Grid pulse',
    css: (c, t, s) => `@keyframes fade { 0%, 100% { opacity: 0.25; transform: scale(0.85) } 50% { opacity: 1; transform: scale(1) } }\n.spinner { display: grid; grid-template-columns: repeat(3, 1fr); gap: ${Math.max(2, Math.round(t * 0.7))}px; }\n.spinner span {\n  width: ${s}px; height: ${s}px; border-radius: ${Math.round(s / 5)}px; background: ${c};\n  animation: fade 1.2s ease-in-out infinite;\n}\n.spinner span:nth-child(2) { animation-delay: 0.1s }\n.spinner span:nth-child(3) { animation-delay: 0.2s }\n.spinner span:nth-child(4) { animation-delay: 0.3s }\n.spinner span:nth-child(6) { animation-delay: 0.4s }\n.spinner span:nth-child(8) { animation-delay: 0.5s }`,
    html: '<div class="spinner"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>',
  },
];

const Preview = ({ css, id }) => (
  <>
    <style>{css}</style>
    <div className="grid place-items-center" dangerouslySetInnerHTML={{ __html: SPINNERS.find((s) => s.id === id)?.html || '' }} />
  </>
);

export default function LoaderStudio() {
  const [selected, setSelected] = useState('ring');
  const [colour, setColour] = useState('#22d3ee');
  const [thickness, setThickness] = useState(4);
  const [size, setSize] = useState(48);
  const [background, setBackground] = useState('#0b1120');

  const spinner = SPINNERS.find((s) => s.id === selected) || SPINNERS[0];
  const css = spinner.css(colour, thickness, size);
  const snippet = `/* ${spinner.label} */\n${css}\n\n${spinner.html}`;

  return (
    <ToolShell
      toolId="loader-studio"
      icon={Loader}
      title="Loader & Spinner Studio"
      desc="Ten production-ready loading animations — size, weight and colour dialled in live, with the exact CSS and markup to copy."
      state={{ selected, colour, thickness, size, background }}
      onRestore={(restored) => {
        if (restored.selected) setSelected(restored.selected);
        if (restored.colour) setColour(restored.colour);
        if (restored.thickness) setThickness(Number(restored.thickness));
        if (restored.size) setSize(Number(restored.size));
        if (restored.background) setBackground(restored.background);
      }}
      exportText={snippet}
      exportName="spinner.css"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={snippet} label="Copy CSS + HTML" />
        <CopyBtn value={css} label="Copy CSS only" />
      </div>

      <Field label="Animation">
        <div className="flex flex-wrap gap-1.5">
          {SPINNERS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                selected === s.id ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Field>

      <div
        className="tk-card tk-depth grid min-h-[13rem] place-items-center overflow-hidden rounded-xl border border-border/70"
        style={{ backgroundColor: background }}
      >
        <Preview id={selected} css={css} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Colour">
          <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label="Preview background">
          <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label={`Size · ${size}px`}>
          <input type="range" min={16} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Thickness · ${thickness}px`}>
          <input type="range" min={1} max={14} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">CSS & markup</div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{snippet}</pre>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Preset" value={spinner.label} />
        <Stat label="Size" value={`${size}px`} mono />
        <Stat label="Weight" value={`${thickness}px`} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Every animation is pure CSS with no images and no JavaScript, so it costs almost nothing while a request is in flight. Both sizes above
          come from the same rules — the smaller one is scaled, which is why these stay crisp anywhere.
        </p>
      </Panel>
    </ToolShell>
  );
}