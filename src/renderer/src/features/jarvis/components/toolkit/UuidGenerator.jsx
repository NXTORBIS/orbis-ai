import { useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, CopyBtn, Field } from './shared';

export default function UuidGenerator() {
  const [count, setCount] = useState(5);
  const [uuids, setUuids] = useState([]);

  const gen = () => {
    const out = [];
    for (let i = 0; i < Math.min(count, 100); i++) out.push(crypto.randomUUID());
    setUuids(out);
  };
  const copyAll = () => navigator.clipboard?.writeText(uuids.join('\n'));

  return (
    <div className="space-y-4">
      <ToolHeader icon={Fingerprint} title="UUID Generator" desc="Generate cryptographically random UUIDs (v4) using the Web Crypto API." />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Count"><Input type="number" min="1" max="100" value={count} onChange={(e) => setCount(+e.target.value || 1)} className="w-24" /></Field>
        <Button size="sm" onClick={gen}>Generate</Button>
        {uuids.length > 0 && <Button size="sm" variant="outline" onClick={copyAll}>Copy all</Button>}
      </div>
      {uuids.length > 0 && (
        <div className="space-y-1">
          {uuids.map((u) => (
            <div key={u} className="flex items-center justify-between rounded-md border border-border/60 bg-card/40 px-3 py-1.5">
              <span className="font-mono-j text-sm">{u}</span>
              <CopyBtn value={u} label="" size="sm" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}