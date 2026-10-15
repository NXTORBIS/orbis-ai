import { useMemo, useState } from 'react';
import { AlignLeft } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow, downloadBlob } from './shared';

const SAMPLE = `Wrap long paragraphs so they survive being pasted into an email client, a code comment or a terminal. A fixed column width keeps diffs tidy and stops editors from soft-wrapping in places that make the text harder to scan, especially when you are reviewing a document alongside someone else.`;

const PREFIXES = [
  { value: '', label: 'None' },
  { value: '# ', label: '# shell' },
  { value: '// ', label: '// code' },
  { value: '> ', label: '> quote' },
  { value: '* ', label: '* bullet' },
  { value: '    ', label: 'Indent' },
];

export default function TextWrap() {
  const [text, setText] = useState(SAMPLE);
  const [columns, setColumns] = useState(72);
  const [prefix, setPrefix] = useState('');
  const [breakWords, setBreakWords] = useState(false);
  const [keepBlank, setKeepBlank] = useState(true);
  const [trim, setTrim] = useState(true);

  const wrapped = useMemo(() => {
    const prefixLength = prefix.length;
    const width = Math.max(20, Number(columns) || 72);
    const available = Math.max(8, width - prefixLength);

    return String(text)
      .split('\n')
      .map((rawLine) => {
        const line = trim ? rawLine.trim() : rawLine.replace(/\s+$/, '');
        if (!line) return keepBlank ? prefix.trimEnd() : null;
        const words = line.split(/\s+/);
        const out = [];
        let current = '';
        words.forEach((word) => {
          let piece = word;
          while (breakWords && piece.length > available) {
            if (current) {
              out.push(current);
              current = '';
            }
            out.push(piece.slice(0, available));
            piece = piece.slice(available);
          }
          if (!current) current = piece;
          else if (current.length + 1 + piece.length <= available) current += ` ${piece}`;
          else {
            out.push(current);
            current = piece;
          }
        });
        if (current) out.push(current);
        return out.map((entry) => `${prefix}${entry}`).join('\n');
      })
      .filter((line) => line !== null)
      .join('\n');
  }, [text, columns, prefix, keepBlank, trim]);

  const stats = useMemo(() => {
    const lines = wrapped ? wrapped.split('\n') : [];
    const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
    const words = (text.trim().match(/\S+/g) || []).length;
    return { lines: lines.length, longest, words, original: text.split('\n').filter((l) => l.trim()).length };
  }, [wrapped, text]);

  const wrapCss = wrapped.split('\n').map((line) => `/* ${line.padEnd(stats.longest, ' ')} */`).join('\n');

  return (
    <ToolShell
      toolId="text-wrap"
      icon={AlignLeft}
      title="Text Wrapper"
      desc="Re-wrap any text to a fixed column width — for emails, code comments, READMEs and terminals that punish long lines."
      state={{ text, columns, prefix, breakWords, keepBlank, trim }}
      onRestore={(restored) => {
        if (typeof restored.text === 'string') setText(restored.text);
        if (restored.columns) setColumns(Number(restored.columns));
        if (typeof restored.prefix === 'string') setPrefix(restored.prefix);
        if (typeof restored.breakWords === 'boolean') setBreakWords(restored.breakWords);
        if (typeof restored.keepBlank === 'boolean') setKeepBlank(restored.keepBlank);
        if (typeof restored.trim === 'boolean') setTrim(restored.trim);
      }}
      exportText={wrapped}
      exportName="wrapped.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={columns} onChange={setColumns} options={[{ value: 40, label: '40' }, { value: 60, label: '60' }, { value: 72, label: '72' }, { value: 80, label: '80' }, { value: 100, label: '100' }, { value: 120, label: '120' }]} />
        <CopyBtn value={wrapped} label="Copy wrapped" />
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([wrapped], { type: 'text/plain' }), 'wrapped.txt')}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
        >
          Download .txt
        </button>
      </div>

      <Field label="Original text">
        <Area value={text} onChange={setText} rows={6} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Column width · ${columns} characters`}>
          <input type="range" min={20} max={160} value={columns} onChange={(e) => setColumns(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Prefix each line">
          <Seg value={prefix} onChange={setPrefix} options={PREFIXES} />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Break very long words" checked={breakWords} onChange={setBreakWords} hint="URLs and hashes" />
        <ToggleRow label="Keep blank lines" checked={keepBlank} onChange={setKeepBlank} />
        <ToggleRow label="Trim each line first" checked={trim} onChange={setTrim} />
      </div>

      <div className="tk-card tk-depth overflow-auto rounded-xl border border-border/70 bg-card/40 p-3">
        <pre className="whitespace-pre-wrap break-words font-mono-j text-[11px]">{wrapped || ' '}</pre>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={wrapCss} label="Copy as comment block" />
        <span className="text-[11px] text-muted-foreground">Handy when pasting wrapped prose into a source file.</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Output lines" value={String(stats.lines)} mono sub={`from ${stats.original}`} />
        <Stat label="Longest line" value={`${stats.longest} chars`} mono />
        <Stat label="Words" value={String(stats.words)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          72 characters is the classic convention because email replies nest with a quote marker and still fit an 80-column terminal — 80 or 100 suits
          docs and READMEs. Wrapping happens on word boundaries and never mid-word, unless you ask it to, so pasted URLs and identifiers survive
          intact.
        </p>
      </Panel>
    </ToolShell>
  );
}