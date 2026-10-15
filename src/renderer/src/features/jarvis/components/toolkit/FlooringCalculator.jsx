import { useMemo, useState } from 'react';
import { Grid3x3, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const SIZE_PRESETS = [
  { label: 'Tiles 600 × 600', width: 600, height: 600 },
  { label: 'Tiles 300 × 300', width: 300, height: 300 },
  { label: 'Tiles 300 × 600', width: 300, height: 600 },
  { label: 'Planks 1200 × 200', width: 1200, height: 200 },
  { label: 'Planks 1800 × 190', width: 1800, height: 190 },
];

const money = (value) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function FlooringCalculator() {
  const [rooms, setRooms] = useState([
    { id: 'a', name: 'Living room', length: '5.4', width: '3.6' },
    { id: 'b', name: 'Kitchen', length: '3.2', width: '2.8' },
    { id: 'c', name: 'Hallway', length: '6.0', width: '1.1' },
  ]);
  const [unit, setUnit] = useState('m');
  const [mode, setMode] = useState('coverage');
  const [perBox, setPerBox] = useState('1.44');
  const [pieces, setPieces] = useState('4');
  const [tileWidth, setTileWidth] = useState('600');
  const [tileHeight, setTileHeight] = useState('600');
  const [wastage, setWastage] = useState('10');
  const [cost, setCost] = useState('32');
  const [underlay, setUnderlay] = useState('6');

  const set = (id, key, value) => setRooms((current) => current.map((room) => (room.id === id ? { ...room, [key]: value } : room)));

  const result = useMemo(() => {
    const factor = unit === 'ft' ? 0.092903 : 1;
    const waste = Math.max(0, Number(wastage) || 0) / 100;
    const boxPrice = Number(cost) || 0;
    const underlayPrice = Number(underlay) || 0;

    const coveragePerBox = mode === 'coverage'
      ? Math.max(0.01, Number(perBox) || 0)
      : Math.max(0.01, (Number(pieces) || 0) * ((Number(tileWidth) || 0) / 1000) * ((Number(tileHeight) || 0) / 1000));

    const table = rooms.map((room) => {
      const length = Number(room.length) || 0;
      const width = Number(room.width) || 0;
      const area = length * width * factor;
      const withWaste = area * (1 + waste);
      const boxes = Math.ceil(withWaste / coveragePerBox);
      return { ...room, length, width, area, withWaste, boxes, cost: boxes * boxPrice };
    });

    const area = table.reduce((sum, room) => sum + room.area, 0);
    const withWaste = table.reduce((sum, room) => sum + room.withWaste, 0);
    const boxes = Math.ceil(withWaste / coveragePerBox);
    const bought = boxes * coveragePerBox;
    const unitArea = mode === 'coverage'
      ? coveragePerBox
      : (Number(pieces) || 0) * ((Number(tileWidth) || 0) / 1000) * ((Number(tileHeight) || 0) / 1000);
    const tileCount = mode === 'pieces' ? boxes * (Number(pieces) || 0) : Math.ceil(withWaste / unitArea);

    return {
      table, area, withWaste, boxes, bought, coveragePerBox, tileCount, boxPrice, underlayPrice,
      totalCost: boxes * boxPrice,
      underlayCost: area * underlayPrice,
      projectCost: boxes * boxPrice + area * underlayPrice,
      costPerArea: area ? (boxes * boxPrice) / area : 0,
      leftover: bought - area,
      perBoxArea: coveragePerBox,
    };
  }, [rooms, unit, mode, perBox, pieces, tileWidth, tileHeight, wastage, cost, underlay]);

  const report = useMemo(() => [
    'Total floor area: ' + result.area.toFixed(2) + ' m² (' + (result.area * 10.7639).toFixed(1) + ' sq ft)',
    'With ' + wastage + '% wastage: ' + result.withWaste.toFixed(2) + ' m²',
    'Boxes needed: ' + result.boxes + ' at ' + result.coveragePerBox.toFixed(3) + ' m² per box',
    'Boxes cover: ' + result.bought.toFixed(2) + ' m² · spare left over ' + result.leftover.toFixed(2) + ' m²',
    '',
    'Material cost: ' + money(result.totalCost),
    'Underlay at ' + underlay + ' per m²: ' + money(result.underlayCost),
    'Project total: ' + money(result.projectCost),
    '',
    ...result.table.map((room) => [room.name || 'Room', room.length + ' × ' + room.width, room.area.toFixed(2) + ' m²', room.boxes + ' boxes', money(room.cost)].join(' · ')),
  ].join('\n'), [result, wastage, underlay]);

  const applySize = (preset) => {
    setMode('pieces');
    setPieces('4');
    setTileWidth(String(preset.width));
    setTileHeight(String(preset.height));
  };

  return (
    <ToolShell
      toolId="flooring-calculator"
      icon={Grid3x3}
      title="Flooring & Tiles Calculator"
      desc="Measure room by room, add a wastage allowance for cuts, and get the boxes to order, tiles needed, coverage left spare and the cost including underlay."
      state={{ rooms, unit, mode, perBox, pieces, tileWidth, tileHeight, wastage, cost, underlay }}
      onRestore={(restored) => {
        if (Array.isArray(restored.rooms) && restored.rooms.length) setRooms(restored.rooms);
        if (restored.unit) setUnit(restored.unit);
        if (restored.mode) setMode(restored.mode);
        if (restored.perBox !== undefined) setPerBox(String(restored.perBox));
        if (restored.pieces !== undefined) setPieces(String(restored.pieces));
        if (restored.tileWidth !== undefined) setTileWidth(String(restored.tileWidth));
        if (restored.tileHeight !== undefined) setTileHeight(String(restored.tileHeight));
        if (restored.wastage !== undefined) setWastage(String(restored.wastage));
        if (restored.cost !== undefined) setCost(String(restored.cost));
        if (restored.underlay !== undefined) setUnderlay(String(restored.underlay));
      }}
      exportText={report}
      exportName="flooring.txt"
    >
      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Rooms</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.area.toFixed(2)} m² measured</span>
        </div>
        <div className="space-y-2">
          {rooms.map((room) => (
            <div key={room.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-5">
              <Field label="Room"><input value={room.name} onChange={(e) => set(room.id, 'name', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
              <Field label={'Length (' + unit + ')'}><input value={room.length} onChange={(e) => set(room.id, 'length', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label={'Width (' + unit + ')'}><input value={room.width} onChange={(e) => set(room.id, 'width', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Area"><div className="flex h-9 items-center font-mono-j text-sm text-cyan-j">{(Number(room.length) * Number(room.width) * (unit === 'ft' ? 0.092903 : 1)).toFixed(2)} m²</div></Field>
              <div className="flex items-end">
                <button type="button" onClick={() => setRooms((current) => current.filter((entry) => entry.id !== room.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRooms((current) => [...current, { id: Math.random().toString(36).slice(2), name: 'Room ' + (current.length + 1), length: '', width: '' }])}
            className="inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
          >
            <Plus className="h-3.5 w-3.5" /> Add a room
          </button>
          <Seg value={unit} onChange={setUnit} options={[{ value: 'm', label: 'Metres' }, { value: 'ft', label: 'Feet' }]} />
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What you are laying</div>
          <div className="space-y-3">
            <Seg value={mode} onChange={setMode} options={[{ value: 'coverage', label: 'Coverage per box' }, { value: 'pieces', label: 'Pieces per box' }]} />
            {mode === 'coverage' ? (
              <Field label="Square metres per box"><input value={perBox} onChange={(e) => setPerBox(e.target.value)} inputMode="decimal" className="h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Pieces per box"><input value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Tile width, mm"><input value={tileWidth} onChange={(e) => setTileWidth(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Tile height, mm"><input value={tileHeight} onChange={(e) => setTileHeight(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applySize(preset)}
                  className="rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              That works out to {result.coveragePerBox.toFixed(3)} m² per box{unit === 'ft' ? ' once feet are converted' : ''}, which is the number every box count below is built on.
            </p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Wastage and prices</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label={'Wastage · ' + wastage + '%'}>
              <input type="range" min={0} max={30} step={1} value={wastage} onChange={(e) => setWastage(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
            </Field>
            <Field label="Price per box"><input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
            <Field label="Underlay per m²"><input value={underlay} onChange={(e) => setUnderlay(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
          </div>
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            <p>· Straight lay in a square room: 5% is usually enough.</p>
            <p>· A room with many doorways and alcoves: 10%.</p>
            <p>· Diagonal or herringbone patterns: 15% and upwards, because every edge tile is a cut.</p>
            <p>· Very large format tiles: add more, since a snapped corner wastes a whole tile.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Boxes to order"
          value={String(result.boxes)}
          unit="boxes"
          sub={result.bought.toFixed(2) + ' m² of material for ' + result.area.toFixed(2) + ' m² of floor, leaving ' + result.leftover.toFixed(2) + ' m² spare for future repairs. Total cost ' + money(result.projectCost) + ' including underlay.'}
        />
        <Ring
          value={result.area}
          max={Math.max(result.bought, result.area, 1)}
          label="Coverage against area"
          sub={result.area.toFixed(2) + ' m² of floor, ' + result.withWaste.toFixed(2) + ' m² including wastage'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Area by room</div>
          <Bars
            data={result.table.map((room) => ({ label: (room.name || 'Room').slice(0, 10), value: Number(room.area.toFixed(2)) }))}
            format={(value) => value.toFixed(1)}
            suffix=" m²"
            highlightLast={false}
          />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Costs</span>
            <CopyBtn value={report} label="Copy the list" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Floor area</span><span>{result.area.toFixed(2)} m²</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">With wastage</span><span>{result.withWaste.toFixed(2)} m²</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Coverage per box</span><span>{result.coveragePerBox.toFixed(3)} m²</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Tiles needed</span><span>{result.tileCount}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Boxes</span><span className="text-cyan-j">{result.boxes}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Material cost</span><span>{money(result.totalCost)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Underlay cost</span><span>{money(result.underlayCost)}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Project total</span><span className="text-cyan-j">{money(result.projectCost)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Cost per m² installed</span><span>{money(result.costPerArea)}</span></div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Boxes room by room</div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card">
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Room</th>
                <th className="py-1 text-right font-medium">Size</th>
                <th className="py-1 text-right font-medium">Area</th>
                <th className="py-1 text-right font-medium">With wastage</th>
                <th className="py-1 text-right font-medium">Boxes</th>
                <th className="py-1 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {result.table.map((room) => (
                <tr key={room.id} className="border-t border-border/50">
                  <td className="py-1">{room.name || 'Room'}</td>
                  <td className="py-1 text-right text-muted-foreground">{room.length} × {room.width} {unit}</td>
                  <td className="py-1 text-right">{room.area.toFixed(2)}</td>
                  <td className="py-1 text-right">{room.withWaste.toFixed(2)}</td>
                  <td className="py-1 text-right text-cyan-j">{room.boxes}</td>
                  <td className="py-1 text-right">{money(room.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Floor area" value={result.area.toFixed(2) + ' m²'} mono sub={(result.area * 10.7639).toFixed(0) + ' sq ft'} />
        <Stat label="Boxes" value={String(result.boxes)} mono sub={result.coveragePerBox.toFixed(2) + ' m² each'} />
        <Stat label="Spare" value={result.leftover.toFixed(2) + ' m²'} mono sub="for repairs" />
        <Stat label="Project cost" value={money(result.projectCost)} mono sub="material and underlay" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Measuring without buying twice</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Measure the widest point of each room, not the average. Rooms are rarely square and the skirting hides the difference.</p>
            <p>· Measure in metres and multiply, rather than converting each dimension separately — one conversion at the end avoids rounding drift.</p>
            <p>· Do not subtract a fireplace or a fitted unit unless it physically breaks the floor run. Cuts still have to happen around it.</p>
            <p>· Check the bay and any alcove separately and add them as their own row, so nothing gets quietly forgotten.</p>
            <p>· Buy one extra box beyond the wastage figure if the shade is being discontinued or the batch is unknown. A mismatched patch years later is worse than an unused box.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Ordering and fitting notes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Check the batch or shade code on every box. Tiles from different batches can differ visibly even when the label matches.</p>
            <p>· Order everything at once. A second order three weeks later is a different batch by definition.</p>
            <p>· Let rigid tiles and laminate acclimatise in the room for 24 to 48 hours before laying, or the joints will open.</p>
            <p>· Keep the spare box sealed and stored flat. It is insurance, and it is also the first thing a fitter asks for.</p>
            <p>· Remember the sundries: adhesive or underlay, spacers, levelling clips, trim, and a blade. On a tiled floor these often add 10 to 15% to the material cost.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Area', value: result.area.toFixed(1) + ' m²' },
                { label: 'Wastage', value: wastage + '%' },
                { label: 'Boxes', value: String(result.boxes) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Boxes are rounded up per room as well as in total, which is how an order actually gets placed and avoids the classic shortfall where each room rounds down
          individually. Feet are converted once at 0.092903 m² per square foot.
        </p>
      </Panel>
    </ToolShell>
  );
}