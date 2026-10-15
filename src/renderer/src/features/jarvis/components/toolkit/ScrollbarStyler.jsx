import { useState } from 'react';
import { Sliders } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

export default function ScrollbarStyler() {
  const [track, setTrack] = useState('#0b1120');
  const [thumb, setThumb] = useState('#22d3ee');
  const [thumbHover, setThumbHover] = useState('#67e8f9');
  const [width, setWidth] = useState(10);
  const [radius, setRadius] = useState(8);
  const [border, setBorder] = useState(true);
  const [firefox, setFirefox] = useState(true);

  const css = `.scroll-area {
  scrollbar-width: ${firefox ? 'thin' : 'auto'};
  scrollbar-color: ${thumb} ${track};
}
.scroll-area::-webkit-scrollbar {
  width: ${width}px;
  height: ${width}px;
}
.scroll-area::-webkit-scrollbar-track {
  background: ${track};
  border-radius: ${radius}px;
}
.scroll-area::-webkit-scrollbar-thumb {
  background: ${thumb};
  border-radius: ${radius}px;${border ? `\n  border: 2px solid ${track};` : ''}
}
.scroll-area::-webkit-scrollbar-thumb:hover {
  background: ${thumbHover};
}
.scroll-area::-webkit-scrollbar-corner {
  background: ${track};
}`;

  const scoped = css.replace(/\.scroll-area/g, '.preview-area');

  return (
    <ToolShell
      toolId="scrollbar"
      icon={Sliders}
      title="Scrollbar Styler"
      desc="Make long lists feel intentional — style the track, thumb and hover, with the Firefox properties included in one clean block of CSS."
      state={{ track, thumb, thumbHover, width, radius, border, firefox }}
      onRestore={(restored) => {
        if (restored.track) setTrack(restored.track);
        if (restored.thumb) setThumb(restored.thumb);
        if (restored.thumbHover) setThumbHover(restored.thumbHover);
        if (restored.width) setWidth(Number(restored.width));
        if (restored.radius !== undefined) setRadius(Number(restored.radius));
        if (typeof restored.border === 'boolean') setBorder(restored.border);
        if (typeof restored.firefox === 'boolean') setFirefox(restored.firefox);
      }}
      exportText={css}
      exportName="scrollbar.css"
    >
      <style>{scoped}</style>

      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={css} label="Copy CSS" />
        <Seg value={firefox ? 'on' : 'off'} onChange={(v) => setFirefox(v === 'on')} options={[{ value: 'on', label: 'Firefox support on' }, { value: 'off', label: 'Webkit only' }]} />
      </div>

      <div
        className="preview-area tk-card tk-depth overflow-auto rounded-xl border border-border/70 p-3"
        style={{ height: '17rem', background: 'linear-gradient(160deg, hsl(var(--card) / 0.8), hsl(var(--card) / 0.35))' }}
      >
        <div className="space-y-2">
          {Array.from({ length: 24 }, (_, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-3 py-2">
              <span className="text-xs">Message {String(i + 1).padStart(2, '0')}</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">scroll me</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Track">
          <input type="color" value={track} onChange={(e) => setTrack(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label="Thumb">
          <input type="color" value={thumb} onChange={(e) => setThumb(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label="Thumb on hover">
          <input type="color" value={thumbHover} onChange={(e) => setThumbHover(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Thickness · ${width}px`}>
          <input type="range" min={4} max={24} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Rounding · ${radius}px`}>
          <input type="range" min={0} max={20} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <ToggleRow label="Inset border between thumb and track" checked={border} onChange={setBorder} />

      <Panel className="!p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">CSS</div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{css}</pre>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Thickness" value={`${width}px`} mono />
        <Stat label="Rounding" value={`${radius}px`} mono />
        <Stat label="Firefox" value={firefox ? 'included' : 'not included'} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Thin scrollbars suit side panels and chat lists, while a heavier style works on a full-page document. Applying this to{' '}
          <span className="font-mono-j">html</span> or <span className="font-mono-j">body</span> styles the whole page rather than one panel — worth
          doing deliberately, since it is the one detail people notice on a long site.
        </p>
      </Panel>
    </ToolShell>
  );
}