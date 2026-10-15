import { useMemo, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { ToolHeader, Field, Out, CopyBtn, Panel, ToggleRow, Seg } from './shared';
import ToolShell from './kit/ToolShell';

const ALIGN = ['stretch', 'start', 'center', 'end'];
const JUSTIFY = ['stretch', 'start', 'center', 'end'];

export default function GridGenerator() {
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(2);
  const [colGap, setColGap] = useState(12);
  const [rowGap, setRowGap] = useState(12);
  const [padding, setPadding] = useState(12);
  const [fit, setFit] = useState(false);
  const [minCol, setMinCol] = useState(220);
  const [align, setAlign] = useState('stretch');
  const [justify, setJustify] = useState('stretch');

  const css = useMemo(() => {
    const track = fit ? `repeat(auto-fit, minmax(${minCol}px, 1fr))` : `repeat(${cols}, minmax(0, 1fr))`;
    return `.grid {\n  display: grid;\n  grid-template-columns: ${track};\n${fit ? '' : `  grid-template-rows: repeat(${rows}, minmax(0, 1fr));\n`}  gap: ${rowGap}px ${colGap}px;\n  align-items: ${align};\n  justify-items: ${justify};\n  padding: ${padding}px;\n}`;
  }, [cols, rows, colGap, rowGap, padding, fit, minCol, align, justify]);

  const cellCount = useMemo(() => (fit ? 8 : Math.max(1, cols * rows)), [cols, rows, fit]);

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: fit ? `repeat(auto-fit, minmax(${minCol}px, 1fr))` : `repeat(${cols}, minmax(0, 1fr))`,
    gridTemplateRows: fit ? undefined : `repeat(${rows}, minmax(0, 1fr))`,
    gap: `${rowGap}px ${colGap}px`,
    alignItems: align,
    justifyItems: justify,
    padding: `${padding}px`,
    minHeight: 260,
  };

  return (
    <ToolShell
      toolId="grid-builder"
      icon={LayoutGrid}
      title="CSS Grid Builder"
      desc="Dial in tracks and gaps, watch the layout respond, then copy the CSS."
      state={{ cols, rows, colGap, rowGap, padding, fit, minCol, align, justify }}
      onRestore={(saved) => {
        setCols(saved.cols); setRows(saved.rows); setColGap(saved.colGap); setRowGap(saved.rowGap);
        setPadding(saved.padding); setFit(!!saved.fit); setMinCol(saved.minCol);
        setAlign(saved.align); setJustify(saved.justify);
      }}
      exportText={css}
      exportName="grid.css"
      exportMime="text/css"
    >
      <ToggleRow label="Responsive auto-fit (instead of fixed columns)" checked={fit} onChange={setFit} />
      <div className="grid gap-3 sm:grid-cols-2">
        {!fit && (
          <>
            <Field label={`Columns · ${cols}`}><input type="range" min={1} max={8} value={cols} onChange={(e) => setCols(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" /></Field>
            <Field label={`Rows · ${rows}`}><input type="range" min={1} max={6} value={rows} onChange={(e) => setRows(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" /></Field>
          </>
        )}
        {fit && (
          <Field label={`Minimum column width · ${minCol}px`}><input type="range" min={80} max={400} step={10} value={minCol} onChange={(e) => setMinCol(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" /></Field>
        )}
        <Field label={`Column gap · ${colGap}px`}><input type="range" min={0} max={48} value={colGap} onChange={(e) => setColGap(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" /></Field>
        <Field label={`Row gap · ${rowGap}px`}><input type="range" min={0} max={48} value={rowGap} onChange={(e) => setRowGap(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" /></Field>
        <Field label={`Padding · ${padding}px`}><input type="range" min={0} max={48} value={padding} onChange={(e) => setPadding(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Align items (vertical)"><Seg value={align} onChange={setAlign} options={ALIGN.map((v) => ({ value: v, label: v }))} /></Field>
        <Field label="Justify items (horizontal)"><Seg value={justify} onChange={setJustify} options={JUSTIFY.map((v) => ({ value: v, label: v }))} /></Field>
      </div>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Preview</div>
        <div className="rounded-xl border border-border/70 bg-secondary/20" style={gridStyle}>
          {Array.from({ length: cellCount }, (_, i) => (
            <div key={i} className="grid min-h-12 place-items-center rounded-lg border border-cyan-j/30 bg-cyan-j/10 font-mono-j text-xs text-cyan-j">{i + 1}</div>
          ))}
        </div>
      </Panel>
      <Out label="CSS" value={css}>
        <pre className="overflow-x-auto font-mono-j text-[11px] text-cyan-j">{css}</pre>
      </Out>
      <CopyBtn value={css} label="Copy CSS" />
    </ToolShell>
  );
}