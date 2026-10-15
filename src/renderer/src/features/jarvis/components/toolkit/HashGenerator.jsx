import { useState } from 'react';
import { Hash } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, CopyBtn } from './shared';

const ALGOS = ['SHA-256', 'SHA-512', 'SHA-1'];

export default function HashGenerator() {
  const [text, setText] = useState('');
  const [out, setOut] = useState({});

  const run = async () => {
    const buf = new TextEncoder().encode(text);
    const res = {};
    for (const a of ALGOS) {
      try { const d = await crypto.subtle.digest(a, buf); res[a] = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); } catch { res[a] = 'unsupported'; }
    }
    setOut(res);
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Hash} title="Hash Generator" desc="Generate SHA-256, SHA-512 and SHA-1 hashes from text using Web Crypto." />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to hash…" className="h-32 w-full rounded-md border border-input bg-transparent p-3 font-mono-j text-sm" />
      <Button size="sm" onClick={run}>Generate hashes</Button>
      {Object.keys(out).length > 0 && (
        <div className="space-y-2">
          {ALGOS.map((a) => (
            <div key={a} className="rounded-lg border border-border/70 bg-card/60 p-3">
              <div className="flex items-center justify-between"><span className="text-xs font-bold text-cyan-j">{a}</span><CopyBtn value={out[a]} /></div>
              <div className="mt-1 break-all font-mono-j text-xs">{out[a]}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}