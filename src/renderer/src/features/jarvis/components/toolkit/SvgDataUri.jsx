import { useMemo, useState } from 'react';
import { FileCode } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, Seg, CopyBtn, Panel, Stat, ToggleRow, fmtBytes } from './shared';

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <!-- a small gradient mark -->
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22d3ee" />
      <stop offset="1" stop-color="#a855f7" />
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="26" fill="url(#g)" />
  <circle cx="60" cy="60" r="26" fill="none" stroke="#ffffff" stroke-width="6" />
</svg>`;

const minify = (source) => String(source)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<metadata[\s\S]*?<\/metadata>/gi, '')
  .replace(/<title[\s\S]*?<\/title>/gi, '')
  .replace(/\s+/g, ' ')
  .replace(/>\s+</g, '><')
  .replace(/\s*\/>\s*/g, '/>')
  .trim();

const toPercent = (source) => `data:image/svg+xml,${encodeURIComponent(source).replace(/'/g, '%27').replace(/"/g, '%22')}`;

const toBase64 = (source) => {
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return `data:image/svg+xml;base64,${btoa(binary)}`;
};

export default function SvgDataUri() {
  const [svg, setSvg] = useState(SAMPLE);
  const [compact, setCompact] = useState(true);
  const [mode, setMode] = useState('percent');

  const processed = useMemo(() => (compact ? minify(svg) : svg.trim()), [svg, compact]);
  const uri = useMemo(() => (processed ? (mode === 'percent' ? toPercent(processed) : toBase64(processed)) : ''), [processed, mode]);

  const originalBytes = new TextEncoder().encode(svg).length;
  const smallBytes = new TextEncoder().encode(processed).length;
  const saved = originalBytes ? Math.max(0, Math.round((1 - smallBytes / originalBytes) * 100)) : 0;

  const css = uri ? `.mark {\n  background-image: url("${uri}");\n  background-size: contain;\n  background-repeat: no-repeat;\n}` : '';
  const imgTag = uri ? `<img src="${uri}" alt="" width="120" height="120" />` : '';

  return (
    <ToolShell
      toolId="svg-uri"
      icon={FileCode}
      title="SVG → Data URI"
      desc="Inline a vector straight into CSS or HTML — tidied up, encoded and previewed before you paste it."
      state={{ svg, compact, mode }}
      onRestore={(saved2) => {
        if (saved2.svg !== undefined) setSvg(saved2.svg);
        setCompact(saved2.compact ?? true);
        if (saved2.mode) setMode(saved2.mode);
      }}
      exportText={uri}
      exportName="svg-data-uri.txt"
    >
      <Area value={svg} onChange={setSvg} rows={9} mono placeholder="Paste SVG markup…" />

      <Seg value={mode} onChange={setMode} options={[{ value: 'percent', label: 'Percent encoded' }, { value: 'base64', label: 'Base64' }]} />
      <ToggleRow label="Strip comments and extra whitespace" checked={compact} onChange={setCompact} hint="smaller, still valid" />

      <Panel className="!p-3">
        <div
          className="mx-auto grid h-40 w-full max-w-xs place-items-center rounded-xl border border-border/70"
          style={{
            backgroundImage: 'linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%)',
            backgroundSize: '14px 14px',
            backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0px',
          }}
        >
          {uri ? <img src={uri} alt="SVG preview" className="max-h-32 max-w-[80%]" /> : <span className="text-[11px] text-muted-foreground">No SVG yet</span>}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Original" value={fmtBytes(originalBytes)} mono />
        <Stat label="Tidied" value={fmtBytes(smallBytes)} mono />
        <Stat label="Saved" value={`${saved}%`} mono />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Data URI ({uri.length.toLocaleString()} characters)</span>
          <CopyBtn value={uri} />
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono-j text-[10px] scrollbar-thin">{uri || '—'}</pre>
      </Panel>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">CSS snippet</span>
          <CopyBtn value={css} />
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono-j text-[10px] scrollbar-thin">{css || '—'}</pre>
      </Panel>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">HTML snippet</span>
          <CopyBtn value={imgTag} />
        </div>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono-j text-[10px] scrollbar-thin">{imgTag || '—'}</pre>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Inlining SVG removes a network request, which is why icons in CSS often ship this way. Percent encoding stays readable and works in every
          browser, while base64 is a little shorter for complex artwork. Very large data URIs bloat a stylesheet — past a few kilobytes, a separate
          file is the better deal.
        </p>
      </Panel>
    </ToolShell>
  );
}