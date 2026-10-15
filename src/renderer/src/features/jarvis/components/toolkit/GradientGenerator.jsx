import { useState } from 'react';
import { Blend } from 'lucide-react';
import { ToolHeader, Field, Seg, CopyBtn, Panel } from './shared';

export default function GradientGenerator() {
  const [type, setType] = useState('linear');
  const [angle, setAngle] = useState(135);
  const [c1, setC1] = useState('#22d3ee');
  const [c2, setC2] = useState('#6366f1');
  const [c3, setC3] = useState('#ec4899');
  const [useThird, setUseThird] = useState(true);

  const stops = useThird ? [c1, c2, c3] : [c1, c2];
  const css = type === 'linear'
    ? `linear-gradient(${angle}deg, ${stops.join(', ')})`
    : `radial-gradient(circle at 50% 50%, ${stops.join(', ')})`;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Blend} title="CSS Gradient Generator" desc="Dial in a gradient and copy the exact CSS — with live preview." />
      <div className="h-40 rounded-2xl border border-border/70" style={{ backgroundImage: css }} />
      <Seg value={type} onChange={setType} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} />
      {type === 'linear' && (
        <Field label={`Angle · ${angle}°`}>
          <input type="range" min={0} max={360} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      )}
      <div className={`grid gap-3 ${useThird ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <Field label="Start"><input type="color" value={c1} onChange={(e) => setC1(e.target.value)} className="h-10 w-full cursor-pointer rounded-lg border border-border/70 bg-transparent" /></Field>
        <Field label="Middle"><input type="color" value={c2} onChange={(e) => setC2(e.target.value)} className="h-10 w-full cursor-pointer rounded-lg border border-border/70 bg-transparent" /></Field>
        {useThird && <Field label="End"><input type="color" value={c3} onChange={(e) => setC3(e.target.value)} className="h-10 w-full cursor-pointer rounded-lg border border-border/70 bg-transparent" /></Field>}
      </div>
      <Seg value={useThird ? 'three' : 'two'} onChange={(v) => setUseThird(v === 'three')} options={[{ value: 'three', label: '3 stops' }, { value: 'two', label: '2 stops' }]} />
      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">CSS</span>
          <div className="flex gap-2">
            <CopyBtn value={css} label="background-image" />
            <CopyBtn value={`background: ${css};`} label="full rule" />
          </div>
        </div>
        <pre className="overflow-x-auto font-mono-j text-xs text-cyan-j">{`background: ${css};`}</pre>
      </Panel>
      <div className="grid gap-2 sm:grid-cols-4">
        {[['Cyan → Indigo', '#22d3ee', '#6366f1'], ['Sunset', '#f97316', '#ec4899'], ['Aurora', '#22c55e', '#06b6d4'], ['Midnight', '#1e293b', '#7c3aed']].map(([label, a, b]) => (
          <button key={label} onClick={() => { setC1(a); setC2(b); setUseThird(false); }} className="rounded-xl border border-border/70 p-2 text-left transition hover:border-cyan-j/50">
            <div className="h-8 rounded-lg" style={{ backgroundImage: `linear-gradient(135deg, ${a}, ${b})` }} />
            <div className="mt-1.5 text-[11px] text-muted-foreground">{label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}