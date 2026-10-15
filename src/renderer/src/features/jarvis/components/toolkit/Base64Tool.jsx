import { useState } from 'react';
import { Binary } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, CopyBtn } from './shared';

function b64Encode(str) { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach((b) => bin += String.fromCharCode(b)); return btoa(bin); }
function b64Decode(b64) { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }

export default function Base64Tool() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState('encode');
  let err = null;
  let out = '';
  try {
    out = mode === 'encode' ? b64Encode(text) : b64Decode(text);
  } catch (e) { err = 'Invalid Base64 input'; }

  return (
    <div className="space-y-4">
      <ToolHeader icon={Binary} title="Base64 Encoder / Decoder" desc="Encode text to Base64 or decode it back, with UTF-8 support." />
      <div className="flex gap-2">
        <Button size="sm" variant={mode === 'encode' ? 'default' : 'outline'} onClick={() => setMode('encode')}>Encode</Button>
        <Button size="sm" variant={mode === 'decode' ? 'default' : 'outline'} onClick={() => setMode('decode')}>Decode</Button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'encode' ? 'Text to encode…' : 'Base64 string…'} className="h-32 w-full rounded-md border border-input bg-transparent p-3 font-mono-j text-sm" />
      <div>
        <div className="mb-1 flex items-center justify-between"><span className="text-xs text-muted-foreground">Result</span><CopyBtn value={out} /></div>
        <div className="min-h-24 break-all rounded-md border border-border/70 bg-card/60 p-3 font-mono-j text-sm">{err ? <span className="text-red-500">{err}</span> : out || '—'}</div>
      </div>
    </div>
  );
}