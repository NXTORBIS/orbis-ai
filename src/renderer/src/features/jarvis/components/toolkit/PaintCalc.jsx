import { useMemo, useState } from 'react';
import { Palette, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const money = (value) => (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);

export default function PaintCalc() {
  const [rooms, setRooms] = useState([
    { id: uid(), name: 'Living room', length: '5.2', width: '4.0', height: '2.4', doors: '2', windows: '2', coats: '2' },
    { id: uid(), name: 'Bedroom', length: '3.6', width: '3.0', height: '2.4', doors: '1', windows: '1', coats: '2' },
  ]);
  const [coverage, setCoverage] = useState('12');
  const [price, setPrice] = useState('9.5');
  const [tin, setTin] = useState('5');
  const [wastage, setWastage] = useState(10);
  const [ceilings, setCeilings] = useState(false);
  const [currency, setCurrency] = useState('$');

  const result = useMemo(() => {
    const cov = Number(coverage) || 12;
    const waste = 1 + (Number(wastage) || 0) / 100;
    const tinSize = Number(tin) || 5;

    const rows = rooms.map((room) => {
      const l = Number(room.length) || 0;
      const w = Number(room.width) || 0;
      const h = Number(room.height) || 0;
      const coats = Number(room.coats) || 1;
      const wallArea = 2 * (l + w) * h;
      const openings = (Number(room.doors) || 0) * 1.9 + (Number(room.windows) || 0) * 1.5;
      const ceiling = ceilings ? l * w : 0;
      const paintable = Math.max(0, wallArea - openings) + ceiling;
      const litres = (paintable * coats * waste) / cov;
      return { ...room, paintable, litres, coats };
    });

    const totalArea = rows.reduce((sum, row) => sum + row.paintable, 0);
    const totalLitres = rows.reduce((sum, row) => sum + row.litres, 0);
    const tins = Math.ceil(totalLitres / tinSize);
    const cost = tins * tinSize * (Number(price) || 0);
    return { rows, totalArea, totalLitres, tins, cost, purchaseLitres: tins * tinSize };
  }, [rooms, coverage, price, tin, wastage, ceilings]);

  const setRoom = (id, patch) => setRooms((current) => current.map((room) => (room.id === id ? { ...room, ...patch } : room)));

  const report = [
    `Paintable area: ${result.totalArea.toFixed(1)} m² (${ceilings ? 'walls and ceilings' : 'walls only'}, openings deducted)`,
    `Paint needed: ${result.totalLitres.toFixed(1)} L including ${wastage}% wastage at ${coverage} m²/L`,
    `Buy: ${result.tins} × ${tin} L tins = ${result.purchaseLitres} L for ${currency}${money(result.cost)}`,
    '',
    ...result.rows.map((row) => `${row.name || 'Room'}: ${row.paintable.toFixed(1)} m² · ${row.litres.toFixed(1)} L (${row.coats} coats)`),
  ].join('\n');

  return (
    <ToolShell
      toolId="paint"
      icon={Palette}
      title="Paint & Wall Coverage Calculator"
      desc="Room by room, openings deducted, coats counted — and the number of tins to actually buy, with wastage built in."
      state={{ rooms, coverage, price, tin, wastage, ceilings, currency }}
      onRestore={(restored) => {
        if (Array.isArray(restored.rooms) && restored.rooms.length) setRooms(restored.rooms);
        if (restored.coverage !== undefined) setCoverage(String(restored.coverage));
        if (restored.price !== undefined) setPrice(String(restored.price));
        if (restored.tin !== undefined) setTin(String(restored.tin));
        if (restored.wastage !== undefined) setWastage(Number(restored.wastage));
        if (typeof restored.ceilings === 'boolean') setCeilings(restored.ceilings);
        if (restored.currency) setCurrency(restored.currency);
      }}
      exportText={report}
      exportName="paint-estimate.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={currency} onChange={setCurrency} options={[{ value: '$', label: '$' }, { value: '€', label: '€' }, { value: '£', label: '£' }, { value: '₹', label: '₹' }]} />
        <Seg value={tin} onChange={setTin} options={[{ value: '1', label: '1 L tin' }, { value: '2.5', label: '2.5 L' }, { value: '5', label: '5 L' }, { value: '10', label: '10 L' }]} />
        <CopyBtn value={report} label="Copy estimate" />
      </div>

      <div className="space-y-2">
        <div className="hidden grid-cols-[1.3fr_0.8fr_0.8fr_0.8fr_0.6fr_0.6fr_0.6fr_auto] gap-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground lg:grid">
          <span>Room</span><span>Length m</span><span>Width m</span><span>Height m</span><span>Doors</span><span>Windows</span><span>Coats</span><span />
        </div>
        {rooms.map((room) => (
          <div key={room.id} className="tk-card tk-depth grid grid-cols-3 gap-2 rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5 lg:grid-cols-[1.3fr_0.8fr_0.8fr_0.8fr_0.6fr_0.6fr_0.6fr_auto] lg:items-center">
            <input value={room.name} onChange={(e) => setRoom(room.id, { name: e.target.value })} placeholder="Room" className="col-span-3 h-9 rounded-md border border-input bg-transparent px-2.5 text-sm lg:col-span-1" />
            {['length', 'width', 'height', 'doors', 'windows', 'coats'].map((field) => (
              <input
                key={field}
                value={room[field]}
                onChange={(e) => setRoom(room.id, { [field]: e.target.value })}
                inputMode="decimal"
                placeholder={field}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-right font-mono-j text-sm"
              />
            ))}
            <button type="button" onClick={() => setRooms(rooms.filter((row) => row.id !== room.id))} disabled={rooms.length <= 1} className="col-span-3 justify-self-end text-muted-foreground transition hover:text-red-500 disabled:opacity-30 lg:col-span-1">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRooms((current) => [...current, { id: uid(), name: '', length: '4', width: '3', height: '2.4', doors: '1', windows: '1', coats: '2' }].slice(0, 10))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add a room
        </button>
        <ToggleRow label="Also paint the ceilings" checked={ceilings} onChange={setCeilings} />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Coverage on the tin (m² per litre)">
          <input value={coverage} onChange={(e) => setCoverage(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={`Price per litre · ${currency}`}>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={`Allowance for wastage · ${wastage}%`} hint="Roller soak, touch-ups, odd shapes">
          <input type="range" min={0} max={25} value={wastage} onChange={(e) => setWastage(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Panel className="!p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Buy this much</div>
          <div className="mt-1 font-mono-j text-lg text-cyan-j">{result.tins} × {tin} L</div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero label="Paint to buy" value={`${result.purchaseLitres.toFixed(1)}`} unit="litres" sub={`${result.tins} tins · ${result.totalLitres.toFixed(1)} L needed before rounding up`} />
        <Ring value={result.totalArea} max={Math.max(result.totalArea, 1)} label="Paintable area" unit={`${result.totalArea.toFixed(0)} m²`} sub={`${ceilings ? 'walls + ceilings' : 'walls only'}`} />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Paintable area" value={`${result.totalArea.toFixed(1)} m²`} mono />
        <Stat label="Paint needed" value={`${result.totalLitres.toFixed(1)} L`} mono />
        <Stat label="Cost" value={`${currency}${money(result.cost)}`} mono />
        <Stat label="Left over" value={`${Math.max(0, result.purchaseLitres - result.totalLitres).toFixed(1)} L`} mono sub="for touch-ups" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the paint goes</div>
          <Bars data={result.rows.map((row) => ({ label: (row.name || 'Room').slice(0, 10), value: row.litres }))} format={(value) => value.toFixed(1)} suffix=" L" />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Room by room</div>
          <div className="space-y-1">
            {result.rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span className="flex-1 truncate">{row.name || 'Untitled room'}</span>
                <span className="font-mono-j text-muted-foreground">{row.paintable.toFixed(1)} m²</span>
                <span className="font-mono-j text-cyan-j">{row.litres.toFixed(1)} L</span>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <Pills
              items={[
                { label: 'Coats assumed', value: result.rows[0]?.coats ?? 2 },
                { label: 'Wastage', value: `${wastage}%` },
                { label: 'Coverage', value: `${coverage} m²/L` },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Doors are counted at about 1.9 m² and windows at 1.5 m² — adjust the counts rather than the areas if your openings are unusually large. Two
          coats of a quality paint usually cost less than three of a cheap one, and a primer over fresh plaster, dark colours or patchy walls is worth
          adding to the litre total rather than discovering mid-wall.
        </p>
      </Panel>
    </ToolShell>
  );
}