import { useMemo, useState } from 'react';
import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const DEFAULT_FRAMES = [
  { id: 'a', label: 'Large print', w: '60', h: '80' },
  { id: 'b', label: 'Medium landscape', w: '50', h: '40' },
  { id: 'c', label: 'Small square', w: '30', h: '30' },
  { id: 'd', label: 'Portrait', w: '40', h: '50' },
  { id: 'e', label: 'Small square', w: '30', h: '30' },
];

const blank = () => ({ id: Math.random().toString(36).slice(2), label: 'New frame', w: '30', h: '40' });

export default function GalleryWallPlanner() {
  const [frames, setFrames] = useState(DEFAULT_FRAMES);
  const [layout, setLayout] = useState('grid');
  const [wallWidth, setWallWidth] = useState('300');
  const [wallHeight, setWallHeight] = useState('240');
  const [gap, setGap] = useState('6');
  const [margin, setMargin] = useState('15');
  const [centreHeight, setCentreHeight] = useState('145');
  const [furnitureHeight, setFurnitureHeight] = useState('70');
  const [units, setUnits] = useState('cm');

  const set = (id, key, value) => setFrames((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const wall = Math.max(50, Number(wallWidth) || 300);
    const height = Math.max(50, Number(wallHeight) || 240);
    const space = Math.max(0, Number(gap) || 6);
    const edge = Math.max(0, Number(margin) || 15);
    const centre = Math.max(30, Number(centreHeight) || 145);
    const furniture = Math.max(0, Number(furnitureHeight) || 0);

    const items = frames.map((row) => ({
      ...row,
      w: Math.max(5, Number(row.w) || 30),
      h: Math.max(5, Number(row.h) || 40),
    }));

    const usable = wall - edge * 2;
    let rows = [];
    if (layout === 'column') {
      rows = [items];
    } else {
      const sorted = [...items].sort((a, b) => b.h - a.h);
      let current = [];
      let used = 0;
      sorted.forEach((item) => {
        const extra = current.length ? space + item.w : item.w;
        if (current.length && used + extra > usable) {
          rows.push(current);
          current = [item];
          used = item.w;
        } else {
          current.push(item);
          used += extra;
        }
      });
      if (current.length) rows.push(current);
    }

    const rowStats = rows.map((row) => ({
      items: row,
      width: row.reduce((sum, item) => sum + item.w, 0) + space * Math.max(0, row.length - 1),
      height: Math.max(...row.map((item) => item.h)),
    }));

    const totalHeight = rowStats.reduce((sum, row) => sum + row.height, 0) + space * Math.max(0, rowStats.length - 1);
    let cursor = centre + totalHeight / 2;

    const placed = [];
    rowStats.forEach((row, rowIndex) => {
      const rowTop = cursor;
      const rowBottom = cursor - row.height;
      let x = edge + (usable - row.width) / 2;
      row.items.forEach((item) => {
        const insideX = x;
        const insideY = layout === 'centre' || layout === 'row-centre'
          ? cursor - totalHeight / 2 + rowStats.slice(0, rowIndex).reduce((sum, entry) => sum + entry.height + space, 0) - row.height / 2 + row.height / 2 - item.h / 2 + row.height / 2
          : rowTop - item.h;
        placed.push({
          ...item,
          left: insideX,
          bottom: layout === 'column' || layout === 'grid' ? rowTop - item.h : insideY,
          top: layout === 'column' || layout === 'grid' ? rowTop : insideY + item.h,
          row: rowIndex + 1,
          hookX: insideX + item.w / 2,
          hookY: (layout === 'column' || layout === 'grid' ? rowTop : insideY + item.h) - 5,
        });
        x += item.w + space;
      });
      cursor = rowBottom - space;
    });

    const compositionWidth = Math.max(...rowStats.map((row) => row.width), 0);
    const compositionTop = Math.max(...placed.map((entry) => entry.top), 0);
    const compositionBottom = Math.min(...placed.map((entry) => entry.bottom), 0);
    const compositionHeight = compositionTop - compositionBottom;
    const coverage = wall * height ? ((compositionWidth * compositionHeight) / (wall * height)) * 100 : 0;
    const clearance = compositionBottom - furniture;

    const warnings = [];
    if (compositionWidth > usable) warnings.push('The composition is ' + compositionWidth.toFixed(0) + ' wide against ' + usable.toFixed(0) + ' of usable wall between the margins. Drop a frame or narrow the gaps.');
    if (compositionTop > height - edge) warnings.push('The top of the composition would sit above the safe margin. Lower it or reduce the number of rows.');
    if (clearance < 15) warnings.push('Only ' + clearance.toFixed(0) + ' clearance above the furniture. Aim for 20 to 25 so the frames read as a group rather than sitting on the sofa.');
    if (placed.some((entry) => entry.w > 60)) warnings.push('Frames wider than 60 need two hooks spaced a third in from each side, or they will tilt.');

    const scale = 260 / Math.max(wall, height);
    const drawing = { width: wall * scale, height: height * scale };

    return {
      placed, rows: rowStats, wall, height, space, edge, centre, furniture, usable, compositionWidth, compositionHeight,
      compositionTop, compositionBottom, coverage, clearance, warnings, drawing, layout,
      hooks: placed.length,
      marks: placed.map((entry, index) => (index + 1) + '. centre ' + entry.hookX.toFixed(0) + ' from the left wall, ' + entry.hookY.toFixed(0) + ' from the floor'),
    };
  }, [frames, layout, wallWidth, wallHeight, gap, margin, centreHeight, furnitureHeight]);

  const report = useMemo(() => [
    'Gallery wall plan: ' + result.placed.length + ' frames in ' + result.rows.length + ' row' + (result.rows.length === 1 ? '' : 's'),
    'Composition ' + result.compositionWidth.toFixed(0) + ' wide by ' + result.compositionHeight.toFixed(0) + ' tall, centred at ' + result.centre + ' from the floor',
    'Wall coverage ' + result.coverage.toFixed(1) + '% · clearance above furniture ' + result.clearance.toFixed(0),
    '',
    'Wall marks, measured from the left wall and the floor:',
    ...result.marks,
    '',
    ...result.warnings.map((line) => '· ' + line),
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="gallery-wall"
      icon={LayoutGrid}
      title="Gallery Wall Planner"
      desc="Frame sizes and a wall into exact positions: rows, gaps, the centre height at eye level, the wall marks to pencil in, and a scale drawing of how it will look."
      state={{ frames, layout, wallWidth, wallHeight, gap, margin, centreHeight, furnitureHeight, units }}
      onRestore={(restored) => {
        if (Array.isArray(restored.frames) && restored.frames.length) setFrames(restored.frames);
        if (restored.layout) setLayout(restored.layout);
        if (restored.wallWidth !== undefined) setWallWidth(String(restored.wallWidth));
        if (restored.wallHeight !== undefined) setWallHeight(String(restored.wallHeight));
        if (restored.gap !== undefined) setGap(String(restored.gap));
        if (restored.margin !== undefined) setMargin(String(restored.margin));
        if (restored.centreHeight !== undefined) setCentreHeight(String(restored.centreHeight));
        if (restored.furnitureHeight !== undefined) setFurnitureHeight(String(restored.furnitureHeight));
        if (restored.units) setUnits(restored.units);
      }}
      exportText={report}
      exportName="gallery-wall.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={layout}
          onChange={setLayout}
          options={[{ value: 'grid', label: 'Grid rows' }, { value: 'column', label: 'Single row' }, { value: 'centre', label: 'Centre line' }]}
        />
        <Seg value={units} onChange={setUnits} options={[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'inches' }]} />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={'Wall width, ' + units}><input value={wallWidth} onChange={(e) => setWallWidth(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Wall height, ' + units}><input value={wallHeight} onChange={(e) => setWallHeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Gap between frames"><input value={gap} onChange={(e) => setGap(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Edge margin"><input value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Centre height from the floor"><input value={centreHeight} onChange={(e) => setCentreHeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Furniture height below"><input value={furnitureHeight} onChange={(e) => setFurnitureHeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Frames, largest first is best</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.placed.length} placed</span>
        </div>
        <div className="space-y-2">
          {frames.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-4">
              <Field label="Frame"><input value={row.label} onChange={(e) => set(row.id, 'label', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
              <Field label="Width"><input value={row.w} onChange={(e) => set(row.id, 'w', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Height"><input value={row.h} onChange={(e) => set(row.id, 'h', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <div className="flex items-end">
                <button type="button" onClick={() => setFrames((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setFrames((current) => [...current, blank()])} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Plus className="h-3.5 w-3.5" /> Add a frame
        </button>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Scale drawing of the wall</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.wall} × {result.height} {units}</span>
        </div>
        <svg viewBox={'0 0 ' + (result.drawing.width + 20) + ' ' + (result.drawing.height + 20)} className="mx-auto h-auto w-full max-w-md rounded-lg border border-border/60 bg-card/30">
          <rect x="10" y="10" width={result.drawing.width} height={result.drawing.height} fill="hsl(var(--muted) / 0.3)" stroke="hsl(var(--border))" strokeWidth="1" />
          {result.placed.map((entry, index) => (
            <g key={entry.id}>
              <rect
                x={10 + entry.left * (result.drawing.width / result.wall)}
                y={10 + (result.height - entry.top) * (result.drawing.height / result.height)}
                width={Math.max(3, entry.w * (result.drawing.width / result.wall))}
                height={Math.max(3, entry.h * (result.drawing.height / result.height))}
                fill="hsl(var(--cyan) / 0.18)"
                stroke="hsl(var(--cyan))"
                strokeWidth="1"
                rx="1"
              />
              <text
                x={10 + (entry.left + entry.w / 2) * (result.drawing.width / result.wall)}
                y={10 + (result.height - entry.top + entry.h / 2) * (result.drawing.height / result.height) + 3}
                textAnchor="middle"
                fontSize="7"
                fill="hsl(var(--muted-foreground))"
              >
                {index + 1}
              </text>
            </g>
          ))}
          <line x1="10" x2={10 + result.drawing.width} y1={10 + result.drawing.height - result.centre * (result.drawing.height / result.height)} y2={10 + result.drawing.height - result.centre * (result.drawing.height / result.height)} stroke="hsl(var(--cyan) / 0.5)" strokeWidth="0.75" strokeDasharray="3 3" />
        </svg>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The dashed line is the centre height at {result.centre} {units}. Hanging the middle of the whole group there, rather than the middle of each frame, is what makes the
          arrangement feel deliberate.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Wall marks to make"
          value={String(result.hooks)}
          unit="hook positions"
          sub={'The composition measures ' + result.compositionWidth.toFixed(0) + ' by ' + result.compositionHeight.toFixed(0) + ' ' + units + ' in ' + result.rows.length + ' row' + (result.rows.length === 1 ? '' : 's') + ', covering ' + result.coverage.toFixed(1) + '% of the wall, with ' + result.clearance.toFixed(0) + ' ' + units + ' of clearance above the furniture.'}
        />
        <Ring
          value={result.coverage}
          max={40}
          tone={result.warnings.length ? 'amber' : 'emerald'}
          label="Wall coverage"
          sub={result.coverage < 8 ? 'A light scattering — add one or two frames to anchor the group' : result.coverage > 30 ? 'Dense. Consider a little more breathing room between frames' : 'A comfortable density for a gallery wall'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Where to mark and what to hang</span>
          <CopyBtn value={report} label="Copy the plan" />
        </div>
        <div className="max-h-72 space-y-1.5 overflow-auto">
          {result.placed.map((entry, index) => (
            <div key={entry.id} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-border/60 px-1.5 py-0.5 font-mono-j text-[10px] text-cyan-j">{index + 1}</span>
                <span>{entry.label}</span>
                <span className="font-mono-j text-muted-foreground">{entry.w} × {entry.h}</span>
                <span className="ml-auto font-mono-j text-muted-foreground">row {entry.row}</span>
              </div>
              <div className="mt-0.5 font-mono-j text-[10px] text-muted-foreground">
                left edge {entry.left.toFixed(0)} {units} from the wall end · bottom {entry.bottom.toFixed(0)} {units} from the floor · hook centre {entry.hookX.toFixed(0)} across, {entry.hookY.toFixed(0)} up
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Frames" value={String(result.placed.length)} mono sub={result.rows.length + ' rows'} />
        <Stat label="Composition" value={result.compositionWidth.toFixed(0) + ' × ' + result.compositionHeight.toFixed(0)} mono sub={units} />
        <Stat label="Centre height" value={result.centre + ' ' + units} mono sub="from the floor" />
        <Stat label="Above furniture" value={result.clearance.toFixed(0) + ' ' + units} mono sub={result.clearance < 15 ? 'raise it a little' : 'a good gap'} />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3 !border-amber-400/50">
          <div className="space-y-1 text-[11px] text-amber-200">
            {result.warnings.map((line) => <p key={line}>· {line}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Hanging it straight</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Cut paper templates of every frame and tape them to the wall first. It costs ten minutes and saves a dozen holes.</p>
            <p>· Measure from the floor to the hook, not from the frame top to the hook. Picture wire sits a few centimetres below the top, and that gap varies per frame.</p>
            <p>· Mark the hook centre on the template before taping it up, then drill straight through the paper.</p>
            <p>· Use two hooks on anything wider than about 60 {units}, spaced a third in from each edge. One hook on a wide frame will tilt as the room changes temperature.</p>
            <p>· Find the studs. A 5 kg frame needs a proper fixing in plasterboard, and one of those hooks rated for 10 kg is not the same thing as a screw into timber.</p>
            <p>· Keep a spirit level on the bench as you go. Levels are easier to check on the floor than with your arms above your head.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Arranging the group</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Hang the centre of the whole group at about 145 {units} from the floor. That is average eye level and works in almost every room.</p>
            <p>· Leave 20 to 25 {units} between the bottom of the arrangement and the furniture below it, so the frames and the sofa read as separate things.</p>
            <p>· Keep the gap between frames even. Uneven spacing is what makes a group look accidental rather than designed.</p>
            <p>· Put the heaviest and largest frame low and slightly off centre. Weight at the bottom makes the arrangement feel grounded.</p>
            <p>· Mix orientations deliberately. A group of identical squares looks like stock; a mix of portrait and landscape looks collected.</p>
            <p>· Keep the group inside about two thirds of the wall height. Frames that reach the ceiling shrink the room.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Layout', value: result.layout === 'grid' ? 'grid rows' : result.layout === 'column' ? 'single row' : 'centre line' },
                { label: 'Frames', value: String(result.placed.length) },
                { label: 'Coverage', value: result.coverage.toFixed(0) + '%' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How the arrangement is calculated</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>usable width = wall width − 2 × edge margin</p>
          <p>rows are built by adding frames until the next one would exceed the usable width, tallest frames first</p>
          <p>each row is centred horizontally on the wall</p>
          <p>rows are stacked around the centre height, which is the middle of the whole composition</p>
          <p>hook y = frame top − 5 {units}, which is the usual wire drop for a small frame</p>
          <p className="text-cyan-j">Check: rows are {result.rows.length} deep, giving a composition {result.compositionHeight.toFixed(0)} {units} tall.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The plan assumes a flat wall, frames hung with a wire drop of about 5 {units}, and a level ceiling and floor to measure from. Check the floor line with a level before
          trusting any of these measurements in an old building.
        </p>
      </Panel>
    </ToolShell>
  );
}