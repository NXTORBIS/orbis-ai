import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat } from './shared';

const PRESETS = {
  'Fade in': { from: { opacity: '0' }, to: { opacity: '1' } },
  'Slide up': { from: { opacity: '0', transform: 'translateY(26px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
  Pop: { '0%': { opacity: '0', transform: 'scale(0.62)' }, '60%': { opacity: '1', transform: 'scale(1.09)' }, '100%': { transform: 'scale(1)' } },
  Pulse: { '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(34, 211, 238, 0.55)' }, '50%': { transform: 'scale(1.05)', boxShadow: '0 0 0 16px rgba(34, 211, 238, 0)' } },
  Shake: { '0%, 100%': { transform: 'translateX(0)' }, '20%': { transform: 'translateX(-9px)' }, '40%': { transform: 'translateX(9px)' }, '60%': { transform: 'translateX(-6px)' }, '80%': { transform: 'translateX(6px)' } },
  Float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-14px)' } },
  Spin: { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
  Bounce: { '0%, 100%': { transform: 'translateY(0)', animationTimingFunction: 'cubic-bezier(0.8, 0, 1, 1)' }, '50%': { transform: 'translateY(-26px)', animationTimingFunction: 'cubic-bezier(0, 0, 0.2, 1)' } },
  'Blur in': { from: { opacity: '0', filter: 'blur(14px)' }, to: { opacity: '1', filter: 'blur(0)' } },
  Flip: { from: { opacity: '0', transform: 'perspective(700px) rotateY(-90deg)' }, to: { opacity: '1', transform: 'perspective(700px) rotateY(0)' } },
  Wobble: { '0%, 100%': { transform: 'rotate(-5deg)' }, '50%': { transform: 'rotate(5deg)' } },
  Shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
};

const EASINGS = [
  { value: 'ease', label: 'ease' },
  { value: 'linear', label: 'linear' },
  { value: 'ease-in-out', label: 'ease-in-out' },
  { value: 'cubic-bezier(0.34, 1.56, 0.64, 1)', label: 'springy' },
];

const kebab = (key) => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

const ANIM = 'tk-keyframe-preview';

export default function KeyframeStudio() {
  const [preset, setPreset] = useState('Slide up');
  const [duration, setDuration] = useState(620);
  const [delay, setDelay] = useState(0);
  const [easing, setEasing] = useState('ease');
  const [loop, setLoop] = useState('once');
  const [replay, setReplay] = useState(0);

  const iteration = loop === 'loop' ? 'infinite' : '1';
  const shorthand = `${ANIM} ${duration}ms ${easing} ${delay}ms ${iteration} both`;

  const keyframes = useMemo(() => {
    const frames = PRESETS[preset];
    const body = Object.entries(frames)
      .map(([stop, decl]) => `  ${stop} {\n${Object.entries(decl).map(([k, v]) => `    ${kebab(k)}: ${v};`).join('\n')}\n  }`)
      .join('\n');
    return `@keyframes ${ANIM} {\n${body}\n}`;
  }, [preset]);

  const usage = `.animated {\n  animation: ${ANIM} ${duration}ms ${easing} ${delay}ms ${iteration} both;\n}`;
  const full = `${keyframes}\n\n${usage}`;

  return (
    <ToolShell
      toolId="keyframes"
      icon={Sparkles}
      title="CSS Animation Generator"
      desc="Pick a motion, tune the timing, watch it play, then take the keyframes and the rule."
      state={{ preset, duration, delay, easing, loop }}
      onRestore={(saved) => {
        if (saved.preset) setPreset(saved.preset);
        setDuration(saved.duration ?? 620);
        setDelay(saved.delay ?? 0);
        if (saved.easing) setEasing(saved.easing);
        if (saved.loop) setLoop(saved.loop);
      }}
      exportText={full}
      exportName="animation.css"
      exportMime="text/css"
    >
      <style>{keyframes}</style>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {Object.keys(PRESETS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => { setPreset(name); setReplay((n) => n + 1); }}
            className={`rounded-lg border px-2.5 py-2 text-[11px] transition ${preset === name ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            {name}
          </button>
        ))}
      </div>

      <Panel className="overflow-hidden !p-0">
        <div className="relative flex min-h-56 items-center justify-center bg-gradient-to-br from-cyan-j/10 via-transparent to-fuchsia-500/10 p-6">
          <div aria-hidden className="tk-aurora" />
          <div
            key={replay}
            className="relative grid h-24 w-24 place-items-center rounded-2xl bg-gradient-to-br from-cyan-j/70 to-fuchsia-500/60 text-[11px] font-semibold text-white shadow-lg"
            style={{ animation: shorthand, backgroundSize: preset === 'Shimmer' ? '200% 100%' : undefined }}
          >
            {preset}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border/70 px-4 py-3">
          <span className="font-mono-j text-[11px] text-muted-foreground">{duration}ms · {easing} · {iteration === 'infinite' ? 'forever' : 'once'}</span>
          <button
            type="button"
            onClick={() => setReplay((n) => n + 1)}
            className="rounded-lg border border-cyan-j/50 px-3 py-1.5 text-[11px] text-cyan-j transition hover:bg-cyan-j/10"
          >
            Replay
          </button>
        </div>
      </Panel>

      <Panel>
        <div className="mb-3 text-xs font-medium">Same motion on a row of elements</div>
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={`${replay}-${i}`}
              className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-j/70 to-fuchsia-500/60"
              style={{ animation: shorthand, animationDelay: `${delay + i * 90}ms` }}
            />
          ))}
        </div>
      </Panel>

      <Field label={`Duration · ${duration}ms`}>
        <input type="range" min={80} max={3000} step={20} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Delay · ${delay}ms`}>
        <input type="range" min={0} max={1500} step={20} value={delay} onChange={(e) => setDelay(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <Field label="Easing">
        <Seg value={easing} onChange={setEasing} options={EASINGS} />
      </Field>
      <Field label="Plays">
        <Seg value={loop} onChange={setLoop} options={[{ value: 'once', label: 'Once' }, { value: 'loop', label: 'Forever' }]} />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Keyframes" value={String(Object.keys(PRESETS[preset]).length)} />
        <Stat label="Duration" value={`${duration}ms`} mono />
        <Stat label="Easing" value={easing.split('(')[0]} />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">CSS</span>
          <CopyBtn value={full} />
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre font-mono-j text-[11px] scrollbar-thin">{full}</pre>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The <span className="font-mono-j">both</span> fill mode keeps the final state after the run, so nothing snaps back.
          Stagger the row above by delaying each element a little more — that is the trick behind most entrance sequences.
        </p>
      </Panel>
    </ToolShell>
  );
}