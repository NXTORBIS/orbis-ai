import { useState } from 'react';
import { Squircle } from 'lucide-react';
import { ToolHeader, Field, Seg, CopyBtn, Panel, ToggleRow } from './shared';

const BLOBS = ['30% 70% 70% 30% / 30% 30% 70% 70%', '60% 40% 30% 70% / 60% 30% 70% 40%', '50% 50% 50% 50% / 60% 40% 60% 40%', '70% 30% 60% 40% / 40% 60% 40% 60%'];

export default function RadiusGenerator() {
  const [corners, setCorners] = useState({ tl: 22, tr: 22, br: 22, bl: 22 });
  const [linked, setLinked] = useState(true);
  const [blob, setBlob] = useState(false);
  const [blobIndex, setBlobIndex] = useState(0);

  const set = (key, value) => {
    if (linked) setCorners({ tl: value, tr: value, br: value, bl: value });
    else setCorners((c) => ({ ...c, [key]: value }));
  };

  const value = blob ? BLOBS[blobIndex] : `${corners.tl}px ${corners.tr}px ${corners.br}px ${corners.bl}px`;
  const labels = [['tl', 'Top left'], ['tr', 'Top right'], ['br', 'Bottom right'], ['bl', 'Bottom left']];

  return (
    <div className="space-y-4">
      <ToolHeader icon={Squircle} title="Border Radius Generator" desc="Shape corners independently — or morph into an organic blob." />
      <div className="grid place-items-center rounded-2xl border border-border/70 bg-secondary/40 py-10">
        <div className="grid h-32 w-40 place-items-center border border-cyan-j/30 bg-gradient-to-br from-cyan-j/20 to-violet-500/20 text-xs text-muted-foreground" style={{ borderRadius: value }}>
          radius
        </div>
      </div>
      <ToggleRow label="Freeze all corners together" checked={linked} onChange={setLinked} />
      <Seg value={blob ? 'blob' : 'corners'} onChange={(v) => setBlob(v === 'blob')} options={[{ value: 'corners', label: 'Corner control' }, { value: 'blob', label: 'Blob shape' }]} />
      {!blob ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {labels.map(([key, label]) => (
            <Field key={key} label={`${label} · ${corners[key]}px`}>
              <input type="range" min={0} max={80} value={corners[key]} onChange={(e) => set(key, Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
            </Field>
          ))}
        </div>
      ) : (
        <Field label="Preset blobs">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BLOBS.map((b, i) => (
              <button key={b} onClick={() => setBlobIndex(i)} className={`rounded-lg border p-2 transition ${blobIndex === i ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/70 hover:border-cyan-j/40'}`}>
                <div className="mx-auto mb-1.5 h-8 w-8 bg-cyan-j/30" style={{ borderRadius: b }} />
                <div className="text-center text-[10px] text-muted-foreground">Blob {i + 1}</div>
              </button>
            ))}
          </div>
        </Field>
      )}
      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">CSS</span>
          <CopyBtn value={`border-radius: ${value};`} />
        </div>
        <pre className="overflow-x-auto font-mono-j text-xs text-cyan-j">{`border-radius: ${value};`}</pre>
      </Panel>
    </div>
  );
}