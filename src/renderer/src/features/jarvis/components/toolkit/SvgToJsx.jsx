import { useMemo, useState } from 'react';
import { FileCode } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <!-- a small rocket -->
  <path d="M5 13l4 4L19 7"/>
  <circle cx="12" cy="12" r="9"/>
</svg>`;

const ATTR_MAP = {
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-opacity': 'strokeOpacity',
  'fill-rule': 'fillRule',
  'fill-opacity': 'fillOpacity',
  'clip-rule': 'clipRule',
  'clip-path': 'clipPath',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
  'text-anchor': 'textAnchor',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'letter-spacing': 'letterSpacing',
  'marker-end': 'markerEnd',
  'marker-start': 'markerStart',
  'mask-type': 'maskType',
  'paint-order': 'paintOrder',
  'shape-rendering': 'shapeRendering',
  'vector-effect': 'vectorEffect',
  'xlink:href': 'xlinkHref',
  'xml:space': 'xmlSpace',
  'preserve-aspect-ratio': 'preserveAspectRatio',
  'base-profile': 'baseProfile',
};

const camel = (name) => ATTR_MAP[name] || name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

const minify = (svg) => svg
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/>\s+</g, '><')
  .replace(/\s{2,}/g, ' ')
  .replace(/\s+\/>/g, '/>')
  .trim();

const toJsx = (svg, { name, typescript, spread, dropSize, currentColor, pretty }) => {
  let output = svg;
  if (dropSize) {
    output = output.replace(/\swidth="[^"]*"/i, '').replace(/\sheight="[^"]*"/i, '');
  }
  if (currentColor) {
    output = output.replace(/stroke="(?!none)[^"]*"/gi, 'stroke="currentColor"').replace(/fill="(?!none)[^"]*"/gi, 'fill="currentColor"');
  }
  if (!pretty) output = minify(output);
  else output = output.replace(/></g, '>\n  <');

  output = output
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/\s([a-zA-Z:-]+)=/g, (match, attr) => ` ${camel(attr)}=`)
    .replace(/class=/g, 'className=')
    .replace(/xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/g, '')
    .replace(/xmlns=/g, 'xmlns=')
    .replace(/<([a-z][\w:-]*)([^>]*?)\/>/g, '<$1$2 />');

  const [opening, ...rest] = output.split('>');
  const body = rest.join('>');
  const props = `${spread ? ' {...props}' : ''}${spread ? '' : ' ...props'}`;
  const header = typescript
    ? `import type { SVGProps } from 'react';\n\nexport default function ${name}(props: SVGProps<SVGSVGElement>) {`
    : `export default function ${name}(props) {`;

  const indented = body
    .split('\n')
    .map((line, index, lines) => (index === lines.length - 1 ? line : `    ${line}`))
    .join('\n');

  return `${header}\n  return (\n    ${opening}${props}>${pretty ? '\n' : ''}${indented}\n  );\n}\n`;
};

export default function SvgToJsx() {
  const [svg, setSvg] = useState(SAMPLE);
  const [name, setName] = useState('Icon');
  const [mode, setMode] = useState('tsx');
  const [spread, setSpread] = useState(true);
  const [dropSize, setDropSize] = useState(true);
  const [currentColor, setCurrentColor] = useState(true);
  const [pretty, setPretty] = useState(true);

  const problem = useMemo(() => {
    if (!svg.trim()) return '';
    if (!/<svg[\s>]/i.test(svg)) return 'That does not look like an SVG — paste the whole <svg> element including the opening tag.';
    const open = (svg.match(/</g) || []).length;
    const close = (svg.match(/>/g) || []).length;
    return open === close ? '' : 'The tags look unbalanced — check for a missing closing bracket before converting.';
  }, [svg]);

  const jsx = useMemo(() => {
    if (!svg.trim() || problem) return '';
    try {
      return toJsx(svg, { name: name.replace(/[^A-Za-z0-9_$]/g, '') || 'Icon', typescript: mode === 'tsx', spread, dropSize, currentColor, pretty });
    } catch (err) {
      return `/* Could not convert: ${err.message} */`;
    }
  }, [svg, name, mode, spread, dropSize, currentColor, pretty, problem]);

  const minified = useMemo(() => (svg.trim() ? minify(svg) : ''), [svg]);
  const dataUri = useMemo(() => (minified ? `url("data:image/svg+xml,${encodeURIComponent(minified.replace(/\s+/g, ' ')).replace(/'/g, '%27').replace(/"/g, '%22')}")` : ''), [minified]);

  const counts = useMemo(() => {
    const elements = (minified.match(/<[a-z]/gi) || []).length;
    const paths = (minified.match(/<path/gi) || []).length;
    const groups = (minified.match(/<g[\s>]/gi) || []).length;
    return { elements, paths, groups };
  }, [minified]);

  const report = jsx || '';

  return (
    <ToolShell
      toolId="svg-to-jsx"
      icon={FileCode}
      title="SVG → React Component"
      desc="Turn raw SVG into a clean, prop-ready React or TypeScript component — camel-cased attributes, currentColor and no stray width or height."
      state={{ svg, name, mode, spread, dropSize, currentColor, pretty }}
      onRestore={(restored) => {
        if (typeof restored.svg === 'string') setSvg(restored.svg);
        if (restored.name) setName(restored.name);
        if (restored.mode) setMode(restored.mode);
        if (typeof restored.spread === 'boolean') setSpread(restored.spread);
        if (typeof restored.dropSize === 'boolean') setDropSize(restored.dropSize);
        if (typeof restored.currentColor === 'boolean') setCurrentColor(restored.currentColor);
        if (typeof restored.pretty === 'boolean') setPretty(restored.pretty);
      }}
      exportText={report}
      exportName={mode === 'tsx' ? `${name || 'Icon'}.tsx` : `${name || 'Icon'}.jsx`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={setMode} options={[{ value: 'tsx', label: 'TypeScript' }, { value: 'jsx', label: 'JavaScript' }]} />
        <CopyBtn value={jsx} label="Copy component" />
        <CopyBtn value={dataUri} label="Copy data URI" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Area label="SVG source" value={svg} onChange={setSvg} rows={12} mono />
        <Panel className="!p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Component</div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{jsx || 'Paste an SVG on the left.'}</pre>
        </Panel>
      </div>

      {problem && <Panel className="border-amber-500/40 text-[11px] text-amber-400">{problem}</Panel>}

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Component name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <div className="space-y-1 self-end">
          <ToggleRow label="Accept props" checked={spread} onChange={setSpread} />
          <ToggleRow label="Drop width/height" checked={dropSize} onChange={setDropSize} />
        </div>
        <div className="space-y-1 self-end">
          <ToggleRow label="Use currentColor" checked={currentColor} onChange={setCurrentColor} />
          <ToggleRow label="Pretty print" checked={pretty} onChange={setPretty} />
        </div>
        <Panel className="!p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Preview</div>
          <div className="mt-2 grid h-20 place-items-center text-cyan-j" dangerouslySetInnerHTML={{ __html: minified || '' }} />
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Minified size"
          value={`${(minified.length / 1024).toFixed(2)}`}
          unit="KB"
          sub={`from ${(svg.length / 1024).toFixed(2)} KB · ${svg.length ? Math.round((1 - minified.length / svg.length) * 100) : 0}% smaller inline`}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Use it three ways</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Inline component from the output above — accepts className and merges with currentColor for theme-aware icons.</p>
            <p>· As a CSS background with the data URI, no extra request and no file to host.</p>
            <p>· As a static asset if the artwork is large and reused: the browser can cache a file, it cannot cache inline markup.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Elements" value={String(counts.elements)} mono />
        <Stat label="Paths" value={String(counts.paths)} mono />
        <Stat label="Groups" value={String(counts.groups)} mono />
        <Stat label="Original size" value={`${(svg.length / 1024).toFixed(2)} KB`} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What the converter changes, and why</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· <span className="font-mono-j">stroke-width</span> becomes <span className="font-mono-j">strokeWidth</span> — React passes attributes as DOM properties, and hyphens are not valid in JSX.</p>
          <p>· Comments and metadata are dropped, because they are invisible in the rendered icon and inflate every bundle they land in.</p>
          <p>· {dropSize ? 'Width and height are removed so the icon scales from its viewBox — the usual cause of a 48px icon that refuses to be 16px.' : 'Width and height stay, which pins the icon to its original pixel size unless you override them.'}</p>
          <p>· {currentColor ? 'Hard-coded colours are replaced with currentColor, so one icon works in light and dark themes and inherits your text colour.' : 'Colours are kept exactly as authored.'}</p>
          <p>· Keep <span className="font-mono-j">xmlns</span> only for standalone SVG files; React injects it for inline markup.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Name', value: name || 'Icon' },
              { label: 'Language', value: mode.toUpperCase() },
              { label: 'Paths', value: counts.paths },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Large traced SVGs (from illustration tools) carry thousands of path points and no amount of camel-casing will make them small — run those through an
          SVG optimiser first and keep hand-drawn icons for UI. For anything under about 2 KB the inline component is the friendliest option: one file, no
          extra request, and colourable with your own text colour.
        </p>
      </Panel>
    </ToolShell>
  );
}