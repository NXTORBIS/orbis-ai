import { useMemo, useState } from 'react';
import { Binary } from 'lucide-react';
import { ToolHeader, Area, Out, CopyBtn, Stat, ToggleRow, Panel } from './shared';
import ToolShell from './kit/ToolShell';

const encode = (text, separate) => Array.from(new TextEncoder().encode(text))
  .map((byte) => byte.toString(2).padStart(8, '0'))
  .join(separate ? ' ' : '');

export default function BinaryText() {
  const [mode, setMode] = useState('encode');
  const [text, setText] = useState('Mark32');
  const [separate, setSeparate] = useState(true);

  const result = useMemo(() => {
    if (mode === 'encode') {
      const bits = encode(text, separate);
      return { output: bits, bits: bits.replace(/\s/g, '').length, bytes: new TextEncoder().encode(text).length, warning: null };
    }
    const clean = text.replace(/[^01]/g, '');
    if (!clean.length) return { output: '', bits: 0, bytes: 0, warning: 'Type some binary — only 0 and 1 are read.' };
    const padded = clean.length % 8 === 0 ? clean : clean.padEnd(Math.ceil(clean.length / 8) * 8, '0');
    const bytes = new Uint8Array(padded.length / 8);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(padded.slice(i * 8, i * 8 + 8), 2);
    const decoded = new TextDecoder('utf-8').decode(bytes);
    const warning = padded.length !== clean.length
      ? `The bit count was not a multiple of eight, so ${padded.length - clean.length} zero${padded.length - clean.length === 1 ? '' : 's'} were added to complete the last byte.`
      : decoded.includes('\uFFFD') ? 'Some bytes do not form valid UTF-8 text, so they appear as �.' : null;
    return { output: decoded, bits: padded.length, bytes: bytes.length, warning };
  }, [mode, text, separate]);

  return (
    <ToolShell
      toolId="binary-text"
      icon={Binary}
      title="Binary ⇄ Text Converter"
      desc="Turn text into bits and back — handy for teaching, puzzles and low-level checks."
      state={{ mode, text, separate }}
      onRestore={(saved) => { setMode(saved.mode); setText(saved.text); setSeparate(saved.separate); }}
      exportText={result.output}
      exportName="binary.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setMode('encode')} className={`rounded-lg border px-3 py-1.5 text-xs transition ${mode === 'encode' ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>Text → Binary</button>
        <button onClick={() => setMode('decode')} className={`rounded-lg border px-3 py-1.5 text-xs transition ${mode === 'decode' ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>Binary → Text</button>
      </div>
      {mode === 'encode' && <ToggleRow label="Separate each byte with a space" checked={separate} onChange={setSeparate} />}
      <Area value={text} onChange={setText} rows={5} mono={mode === 'decode'} placeholder={mode === 'encode' ? 'Type or paste text…' : '01001101 01100001 01110010 01101011'} />
      {result.warning && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{result.warning}</div>}
      <Out label={mode === 'encode' ? 'Binary' : 'Text'} value={result.output}>
        <pre className={`whitespace-pre-wrap break-all ${mode === 'encode' ? 'font-mono-j text-[11px] text-cyan-j' : 'text-sm'}`}>{result.output || '—'}</pre>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Bytes" value={String(result.bytes)} />
        <Stat label="Bits" value={String(result.bits)} />
        <Stat label="Characters" value={String(result.output.length)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={result.output} label="Copy result" />
        <CopyBtn value={mode === 'encode' ? encode(text, false) : text} label={mode === 'encode' ? 'Copy without spaces' : 'Copy input'} />
      </div>
      <Panel>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Text is encoded as UTF-8 first, so an accented letter or emoji takes more than one byte — that is why the byte count can be larger than the number of characters you see.
        </div>
      </Panel>
    </ToolShell>
  );
}