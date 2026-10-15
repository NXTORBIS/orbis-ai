import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartColumn } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const PALETTES = {
  cyan: ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#f472b6'],
  warm: ['#f97316', '#f59e0b', '#facc15', '#fb7185', '#f472b6'],
  forest: ['#34d399', '#22c55e', '#84cc16', '#a3e635', '#4ade80'],
  mono: ['#94a3b8', '#64748b', '#475569', '#334155', '#1e293b'],
};

const SAMPLE = 'Mon 32\nTue 41\nWed 28\nThu 55\nFri 61\nSat 74\nSun 48';

const parseData = (text) => text
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const parts = line.split(/[,\t;]+|\s{2,}/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const value = Number(parts[parts.length - 1].replace(/[^\d.\-]/g, ''));
      return { label: parts.slice(0, -1).join(' '), value: Number.isFinite(value) ? value : 0 };
    }
    const match = line.match(/^(.*?)[\s:=]+(-?[\d.]+)$/);
    if (match) return { label: match[1].trim(), value: Number(match[2]) };
    const value = Number(line.replace(/[^\d.\-]/g, ''));
    return { label: line, value: Number.isFinite(value) ? value : 0 };
  });

const svgToBase64 = (markup) => {
  const bytes = new TextEncoder().encode(markup);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

export default function ChartBuilder() {
  const [raw, setRaw] = useState(SAMPLE);
  const [type, setType] = useState('bar');
  const [palette, setPalette] = useState('cyan');
  const [title, setTitle] = useState('Weekly totals');
  const [showValues, setShowValues] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [stamp, setStamp] = useState(0);
  const svgRef = useRef(null);

  const data = useMemo(() => parseData(raw), [raw]);
  const colours = PALETTES[palette] || PALETTES.cyan;

  const stats = useMemo(() => {
    const values = data.map((row) => row.value);
    const total = values.reduce((sum, value) => sum + value, 0);
    const max = Math.max(0, ...values);
    const min = Math.min(0, ...values);
    const average = values.length ? total / values.length : 0;
    return { total, max, min, average, count: data.length };
  }, [data]);

  const width = 640;
  const height = 360;
  const padding = { top: 46, right: 24, bottom: 52, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const ceiling = stats.max > 0 ? stats.max * 1.15 : 1;
  const scaleY = (value) => padding.top + plotHeight - (value / ceiling) * plotHeight;

  useEffect(() => {
    setStamp((current) => current + 1);
    if (svgRef.current) svgRef.current.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }, [data, type, palette, title, showValues, showGrid]);

  const download = (format) => {
    const svg = svgRef.current;
    if (!svg) return;
    const markup = '<?xml version="1.0" standalone="no"?>' + svg.outerHTML;
    if (format === 'svg') {
      const blob = new Blob([markup], { type: 'image/svg+xml' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'chart.svg';
      link.click();
      URL.revokeObjectURL(link.href);
      return;
    }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext('2d');
      context.fillStyle = '#0b1120';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = 'chart.png';
      link.click();
    };
    image.src = 'data:image/svg+xml;base64,' + svgToBase64(markup);
  };

  const pieTotal = data.reduce((sum, row) => sum + Math.max(0, row.value), 0) || 1;
  const slices = useMemo(() => {
    let angle = -Math.PI / 2;
    return data.map((row, index) => {
      const share = Math.max(0, row.value) / pieTotal;
      const start = angle;
      angle += share * Math.PI * 2;
      const radius = 118;
      const x1 = Math.cos(start) * radius;
      const y1 = Math.sin(start) * radius;
      const x2 = Math.cos(angle) * radius;
      const y2 = Math.sin(angle) * radius;
      return {
        ...row,
        colour: colours[index % colours.length],
        share: share * 100,
        path: 'M 0 0 L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A ' + radius + ' ' + radius + ' 0 ' + (share > 0.5 ? 1 : 0) + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z',
      };
    });
  }, [data, pieTotal, colours]);

  const report = useMemo(() => [
    title,
    '',
    ...data.map((row) => row.label.padEnd(14) + row.value),
    '',
    'Total ' + stats.total + ' · average ' + stats.average.toFixed(2) + ' · highest ' + stats.max + ' · lowest ' + stats.min,
  ].join('\n'), [title, data, stats]);

  return (
    <ToolShell
      toolId="chart-builder"
      icon={ChartColumn}
      title="Chart Builder"
      desc="Paste labelled numbers and get a clean bar, line, pie or donut chart — with totals, shares, and a PNG or SVG you can drop into a document."
      state={{ raw, type, palette, title, showValues, showGrid }}
      onRestore={(restored) => {
        if (typeof restored.raw === 'string') setRaw(restored.raw);
        if (restored.type) setType(restored.type);
        if (restored.palette) setPalette(restored.palette);
        if (typeof restored.title === 'string') setTitle(restored.title);
        if (typeof restored.showValues === 'boolean') setShowValues(restored.showValues);
        if (typeof restored.showGrid === 'boolean') setShowGrid(restored.showGrid);
      }}
      exportText={report}
      exportName="chart-data.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Your data</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{data.length} rows</span>
          </div>
          <Area value={raw} onChange={setRaw} rows={10} mono placeholder={'Mon, 32\nTue, 41'} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            One row per point: a label then the number, separated by a comma, a tab, a colon or two spaces. Rows are labelled automatically if you paste numbers alone.
          </p>
        </Panel>
        <div className="space-y-3">
          <Field label="Chart title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
          </Field>
          <Seg
            value={type}
            onChange={setType}
            options={[{ value: 'bar', label: 'Bars' }, { value: 'hbar', label: 'Horizontal' }, { value: 'line', label: 'Line' }, { value: 'pie', label: 'Pie' }, { value: 'donut', label: 'Donut' }]}
          />
          <Seg
            value={palette}
            onChange={setPalette}
            options={[{ value: 'cyan', label: 'Cyan' }, { value: 'warm', label: 'Warm' }, { value: 'forest', label: 'Green' }, { value: 'mono', label: 'Mono' }]}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow label="Show values" checked={showValues} onChange={setShowValues} />
            <ToggleRow label="Show grid lines" checked={showGrid} onChange={setShowGrid} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => download('png')} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
              Download PNG
            </button>
            <button type="button" onClick={() => download('svg')} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground">
              Download SVG
            </button>
            <CopyBtn value={svgRef.current ? svgRef.current.outerHTML : ''} label="Copy SVG code" />
          </div>
        </div>
      </div>

      <Panel className="!p-3">
        <svg ref={svgRef} key={stamp} viewBox={'0 0 ' + width + ' ' + height} className="w-full">
          <rect x="0" y="0" width={width} height={height} fill="#0b1120" rx="12" />
          <text x={padding.left} y="28" fill="#e2e8f0" fontSize="16">{title}</text>

          {(type === 'bar' || type === 'line') && showGrid && [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = padding.top + plotHeight - fraction * plotHeight;
            return (
              <g key={fraction}>
                <line x1={padding.left} y1={y} x2={padding.left + plotWidth} y2={y} stroke="#1e293b" strokeWidth="1" />
                <text x={padding.left - 8} y={y + 4} fill="#64748b" fontSize="10" textAnchor="end" fontFamily="monospace">{Math.round(fraction * ceiling)}</text>
              </g>
            );
          })}

          {type === 'bar' && data.map((row, index) => {
            const slot = plotWidth / Math.max(1, data.length);
            const barWidth = Math.min(58, slot * 0.62);
            const x = padding.left + index * slot + (slot - barWidth) / 2;
            const y = scaleY(Math.max(0, row.value));
            const barHeight = Math.max(1, padding.top + plotHeight - y);
            return (
              <g key={row.label + index}>
                <rect x={x} y={y} width={barWidth} height={barHeight} rx="4" fill={colours[index % colours.length]} />
                {showValues && <text x={x + barWidth / 2} y={y - 6} fill="#e2e8f0" fontSize="11" textAnchor="middle" fontFamily="monospace">{row.value}</text>}
                <text x={x + barWidth / 2} y={padding.top + plotHeight + 18} fill="#94a3b8" fontSize="11" textAnchor="middle">{row.label.slice(0, 10)}</text>
              </g>
            );
          })}

          {type === 'line' && (
            <>
              <polyline
                fill="none"
                stroke={colours[0]}
                strokeWidth="2.5"
                points={data.map((row, index) => {
                  const slot = plotWidth / Math.max(1, data.length);
                  return (padding.left + index * slot + slot / 2) + ',' + scaleY(row.value);
                }).join(' ')}
              />
              {data.map((row, index) => {
                const slot = plotWidth / Math.max(1, data.length);
                const x = padding.left + index * slot + slot / 2;
                const y = scaleY(row.value);
                return (
                  <g key={row.label + index}>
                    <circle cx={x} cy={y} r="4" fill={colours[index % colours.length]} />
                    {showValues && <text x={x} y={y - 10} fill="#e2e8f0" fontSize="11" textAnchor="middle" fontFamily="monospace">{row.value}</text>}
                    <text x={x} y={padding.top + plotHeight + 18} fill="#94a3b8" fontSize="11" textAnchor="middle">{row.label.slice(0, 10)}</text>
                  </g>
                );
              })}
            </>
          )}

          {type === 'hbar' && data.map((row, index) => {
            const slot = plotHeight / Math.max(1, data.length);
            const barHeight = Math.min(38, slot * 0.6);
            const y = padding.top + index * slot + (slot - barHeight) / 2;
            const barWidth = Math.max(2, (Math.max(0, row.value) / ceiling) * plotWidth);
            return (
              <g key={row.label + index}>
                <text x={padding.left - 8} y={y + barHeight / 2 + 4} fill="#94a3b8" fontSize="11" textAnchor="end">{row.label.slice(0, 12)}</text>
                <rect x={padding.left} y={y} width={barWidth} height={barHeight} rx="4" fill={colours[index % colours.length]} />
                {showValues && <text x={padding.left + barWidth + 8} y={y + barHeight / 2 + 4} fill="#e2e8f0" fontSize="11" fontFamily="monospace">{row.value}</text>}
              </g>
            );
          })}

          {(type === 'pie' || type === 'donut') && (
            <>
              <g transform={'translate(' + (width / 2 - 70) + ' ' + (height / 2 + 14) + ')'}>
                {slices.map((slice, index) => (
                  <path key={slice.label + index} d={slice.path} fill={slice.colour} stroke="#0b1120" strokeWidth="2" />
                ))}
                {type === 'donut' && <circle cx="0" cy="0" r="60" fill="#0b1120" />}
                {type === 'donut' && <text x="0" y="5" fill="#e2e8f0" fontSize="18" textAnchor="middle" fontFamily="monospace">{stats.total}</text>}
              </g>
              <g transform={'translate(' + (width - 170) + ' 100)'}>
                {slices.slice(0, 8).map((slice, index) => (
                  <g key={slice.label + 'key' + index} transform={'translate(0 ' + (index * 20) + ')'}>
                    <rect x="0" y="0" width="10" height="10" rx="2" fill={slice.colour} />
                    <text x="16" y="9" fill="#94a3b8" fontSize="11">{slice.label.slice(0, 12)} · {slice.share.toFixed(0)}%</text>
                  </g>
                ))}
              </g>
            </>
          )}
        </svg>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Total across every point"
          value={stats.total.toLocaleString()}
          sub={'Average ' + stats.average.toFixed(2) + ' per point · highest ' + stats.max.toLocaleString() + ' · lowest ' + stats.min.toLocaleString() + ' across ' + stats.count + ' rows'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Share of the total</div>
          <div className="max-h-64 space-y-1 overflow-auto">
            {[...data].sort((a, b) => b.value - a.value).map((row, index) => (
              <div key={row.label + index} className="flex items-center gap-2 text-[11px]">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colours[index % colours.length] }} />
                <span className="truncate">{row.label}</span>
                <span className="ml-auto shrink-0 font-mono-j text-muted-foreground">{stats.total ? ((row.value / stats.total) * 100).toFixed(1) + '%' : '—'}</span>
                <span className="w-14 shrink-0 text-right font-mono-j text-cyan-j">{row.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Choosing a chart that tells the truth</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Bars to compare values, lines to show change over time, pie only for a handful of parts of one whole.</p>
            <p>· Start bar axes at zero. Anything else exaggerates the differences, which is impressive and misleading in equal measure.</p>
            <p>· Past about six slices a pie stops being readable — the horizontal bar chart handles many categories far better.</p>
            <p>· Sort the bars when the order carries no meaning; keep the original order when it does, for example days of the week.</p>
            <p>· Label the axis with units. A number without units is a guess, and readers supply their own.</p>
            <p>· {stats.max > stats.average * 3 ? 'Your largest value is over three times the average, so the smaller points will look flat next to it.' : 'The values are close enough that a linear scale shows the differences honestly.'}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Exporting and getting data in</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· PNG exports at double resolution, so it stays sharp in a slide or a PDF.</p>
            <p>· SVG keeps every element editable in a design tool — text and colours still change after export.</p>
            <p>· Paste two columns straight from a spreadsheet: label first, value second, tabs or commas both work.</p>
            <p>· Currency symbols, thousands separators and percent signs are parsed as numbers — 1,250 and 12% both work.</p>
            <p>· Everything runs in the page; nothing about your data leaves the browser.</p>
          </div>
          <div className="mt-3">
            <CopyBtn value={report} label="Copy data as text" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Points" value={String(stats.count)} mono />
        <Stat label="Total" value={stats.total.toLocaleString()} mono />
        <Stat label="Average" value={stats.average.toFixed(1)} mono />
        <Stat label="Highest" value={stats.max.toLocaleString()} mono sub={stats.min.toLocaleString() + ' lowest'} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The chart is plain SVG built from your numbers, so it scales cleanly on any screen and exports without a rasterising library. Bar heights are
          proportioned against the largest value and pie shares are computed from positive values only, which stops a negative row from flipping the geometry.
        </p>
      </Panel>
    </ToolShell>
  );
}