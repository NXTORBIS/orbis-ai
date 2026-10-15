import { useState } from 'react';
import { HardDrive } from 'lucide-react';
import { ToolHeader, Field, Seg, Panel, CopyBtn, Stat } from './shared';

const DEC = [['Bytes', 1], ['KB', 1e3], ['MB', 1e6], ['GB', 1e9], ['TB', 1e12], ['PB', 1e15]];
const BIN = [['Bytes', 1], ['KiB', 1024], ['MiB', 1024 ** 2], ['GiB', 1024 ** 3], ['TiB', 1024 ** 4], ['PiB', 1024 ** 5]];
const fmt = (n, d = 4) => {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  if (n < 0.0001 || n >= 1e15) return n.toExponential(3);
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
};

export default function DataSizeConverter() {
  const [value, setValue] = useState('1.5');
  const [unit, setUnit] = useState('GB');

  const bytes = Number(value) * (DEC.find(([u]) => u === unit)?.[1] || 1);
  const ok = Number.isFinite(bytes);

  return (
    <div className="space-y-4">
      <ToolHeader icon={HardDrive} title="Data Size Converter" desc="Bytes, KB/MB/GB and KiB/MiB/GiB — decimal and binary conventions side by side." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Value">
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Unit (decimal)">
          <Seg value={unit} onChange={setUnit} options={DEC.slice(1).map(([u]) => ({ value: u, label: u }))} />
        </Field>
      </div>
      {ok ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Panel>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-cyan-j">Decimal (1000)</span>
                <CopyBtn value={DEC.map(([u, m]) => `${fmt(bytes / m)} ${u}`).join(', ')} />
              </div>
              <div className="space-y-1">
                {DEC.map(([u, m]) => (
                  <div key={u} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{u}</span>
                    <span className="font-mono-j">{fmt(bytes / m)}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-cyan-j">Binary (1024)</span>
                <CopyBtn value={BIN.map(([u, m]) => `${fmt(bytes / m)} ${u}`).join(', ')} />
              </div>
              <div className="space-y-1">
                {BIN.map(([u, m]) => (
                  <div key={u} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{u}</span>
                    <span className="font-mono-j">{fmt(bytes / m)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Bytes" value={fmt(bytes, 0)} mono />
            <Stat label="Bits" value={fmt(bytes * 8, 0)} mono />
            <Stat label="Download at 10 Mbps" value={`${fmt(bytes / (10 * 1e6 / 8), 2)} s`} />
            <Stat label="Copies on 64 GB" value={fmt(64 * 1e9 / bytes, 1)} />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Enter a numeric value.</div>
      )}
    </div>
  );
}