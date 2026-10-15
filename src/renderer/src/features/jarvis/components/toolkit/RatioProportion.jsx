import { useMemo, useState } from 'react';
import { Divide } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

const simplify = (parts) => {
  if (!parts.length) return parts;
  const divisor = parts.reduce((acc, value) => gcd(acc, Math.round(value)), Math.round(parts[0])) || 1;
  return parts.map((value) => value / divisor);
};

const tidy = (value) => {
  const rounded = Math.round((Number(value) || 0) * 1000) / 1000;
  return String(rounded);
};

export default function RatioProportion() {
  const [a, setA] = useState('3');
  const [b, setB] = useState('4');
  const [c, setC] = useState('18');
  const [scale, setScale] = useState('2.5');
  const [total, setTotal] = useState('500');
  const [shares, setShares] = useState('2,3,5');
  const [mapScale, setMapScale] = useState('25000');
  const [mapDistance, setMapDistance] = useState('4.6');

  const proportion = useMemo(() => {
    const left = Number(a) || 0;
    const right = Number(b) || 0;
    const known = Number(c) || 0;
    if (!left || !right) return null;
    const missing = (known * right) / left;
    const unit = right / left;
    return { missing, unit, solved: known ? missing : NaN };
  }, [a, b, c]);

  const simplified = useMemo(() => {
    const left = Number(a) || 0;
    const right = Number(b) || 0;
    if (!left || !right) return '—';
    const [x, y] = simplify([left, right]);
    return `${x} : ${y}`;
  }, [a, b]);

  const scaled = useMemo(() => {
    const factor = Number(scale) || 1;
    return { a: (Number(a) || 0) * factor, b: (Number(b) || 0) * factor };
  }, [a, b, scale]);

  const split = useMemo(() => {
    const parts = String(shares).split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
    const sum = parts.reduce((acc, v) => acc + v, 0);
    const amount = Number(total) || 0;
    if (!parts.length || !sum) return [];
    return parts.map((part, index) => ({ index: index + 1, part, amount: (amount * part) / sum, percent: (part / sum) * 100 }));
  }, [shares, total]);

  const map = useMemo(() => {
    const scaleValue = Number(mapScale) || 1;
    const distance = Number(mapDistance) || 0;
    return { ground: (distance * scaleValue) / 1000, inverse: distance / scaleValue };
  }, [mapScale, mapDistance]);

  const report = [
    `${a} : ${b} simplifies to ${simplified}`,
    `Proportion ${a} : ${b} = ${c} : ${proportion ? tidy(proportion.missing) : '?'}`,
    `Recipe/plan scale ×${scale}: ${tidy(scaled.a)} : ${tidy(scaled.b)}`,
    ...split.map((s) => `Share ${s.index} (${s.part} parts): ${tidy(s.amount)} · ${s.percent.toFixed(1)}%`),
    `Map 1:${mapScale} — ${mapDistance} cm on the map is ${map.ground.toFixed(3)} km on the ground`,
  ].join('\n');

  return (
    <ToolShell
      toolId="ratio"
      icon={Divide}
      title="Ratio & Proportion"
      desc="Simplify a ratio, solve the missing term in a proportion, scale a recipe or plan, split an amount by shares, or convert a map distance."
      state={{ a, b, c, scale, total, shares, mapScale, mapDistance }}
      onRestore={(restored) => {
        if (restored.a !== undefined) setA(String(restored.a));
        if (restored.b !== undefined) setB(String(restored.b));
        if (restored.c !== undefined) setC(String(restored.c));
        if (restored.scale !== undefined) setScale(String(restored.scale));
        if (restored.total !== undefined) setTotal(String(restored.total));
        if (typeof restored.shares === 'string') setShares(restored.shares);
        if (restored.mapScale !== undefined) setMapScale(String(restored.mapScale));
        if (restored.mapDistance !== undefined) setMapDistance(String(restored.mapDistance));
      }}
      exportText={report}
      exportName="ratios.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={report} label="Copy all answers" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Your ratio and the missing term</div>
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-end gap-2">
          <Field label="A">
            <input value={a} onChange={(e) => setA(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
          <span className="pb-2 font-mono-j text-cyan-j">:</span>
          <Field label="B">
            <input value={b} onChange={(e) => setB(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
          <span className="pb-2 font-mono-j text-cyan-j">=</span>
          <Field label="C">
            <input value={c} onChange={(e) => setC(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Stat label="Simplified ratio" value={simplified} mono />
          <Stat label="Per one of A" value={proportion ? `×${proportion.unit.toFixed(4)}` : '—'} mono />
          <Stat label="Missing term (B side)" value={proportion ? tidy(proportion.missing) : '—'} mono />
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Scale the ratio by ×${scale}`}>
          <input type="range" min={0.1} max={10} step={0.1} value={scale} onChange={(e) => setScale(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Panel className="!p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Scaled</div>
          <div className="mt-1 font-mono-j text-lg text-cyan-j">{tidy(scaled.a)} : {tidy(scaled.b)}</div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Split an amount by shares</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Total amount">
            <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
          <Field label="Shares (comma separated)" hint="e.g. 2,3,5 — partners, rooms, people">
            <input value={shares} onChange={(e) => setShares(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </Field>
        </div>
        <div className="mt-3 space-y-1">
          {split.map((share) => (
            <div key={share.index} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span>Share {share.index} · {share.part} part{share.part === 1 ? '' : 's'}</span>
              <span className="font-mono-j text-muted-foreground">{share.percent.toFixed(1)}%</span>
              <span className="font-mono-j">{tidy(share.amount)}</span>
            </div>
          ))}
          {!split.length && <span className="text-[11px] text-muted-foreground">Enter shares to divide the amount.</span>}
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Map & plan scale</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Scale 1 :">
            <input value={mapScale} onChange={(e) => setMapScale(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
          <Field label="Measured distance (cm on the map)">
            <input value={mapDistance} onChange={(e) => setMapDistance(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Stat label="Real-world distance" value={`${map.ground.toFixed(3)} km`} mono />
          <Stat label="Or in metres" value={`${(map.ground * 1000).toFixed(0)} m`} mono />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Cross-multiplication is all that is happening in the proportion box: with A : B = C : ?, the answer is C × B ÷ A. Ratios must use the same
          units on each side, so convert before you type — that single step is where most ratio mistakes come from in recipes, mixing and drawings.
        </p>
      </Panel>
    </ToolShell>
  );
}