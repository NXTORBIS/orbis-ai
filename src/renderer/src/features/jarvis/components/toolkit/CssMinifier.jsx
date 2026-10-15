import { useMemo, useState } from 'react';
import { Eraser, Download } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Area, Out, CopyBtn, Stat, Panel, downloadBlob, fmtBytes , ToggleRow } from './shared';
import ToolShell from './kit/ToolShell';

const SAMPLE = `/* Buttons -------------------------------------------------- */
.btn {
  display: inline-flex;      /* keeps the row tidy */
  padding: 0.5rem   1rem;
  background: #22d3ee;
  border-radius: 0.75rem;
}

@media (min-width: 768px) {
  .btn {
    padding: 0.75rem 1.5rem;
  }
}`;

const minify = (css, dropEmpty) => {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let str = ch;
      while (j < css.length) {
        str += css[j];
        if (css[j] === '\\') { str += css[j + 1] ?? ''; j += 2; continue; }
        if (css[j] === ch) { j += 1; break; }
        j += 1;
      }
      out += str;
      i = j;
      continue;
    }
    if (/\s/.test(ch)) {
      while (i < css.length && /\s/.test(css[i])) i += 1;
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }
  const tidy = out
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\s*!\s*important/gi, '!important')
    .replace(/^\s+|\s+$/g, '');
  return dropEmpty ? tidy.replace(/([^{}]+)\{\s*\}/g, '').replace(/([^{}]+)\{\s*\}/g, '') : tidy;
};

const beautify = (css) => css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s*([{}:;,>])/g, '$1')
  .replace(/;/g, ';\n')
  .replace(/\{/g, ' {\n  ')
  .replace(/\}/g, '\n}\n')
  .replace(/\n\s*\n/g, '\n')
  .replace(/^\s*\n/, '')
  .trim();

export default function CssMinifier() {
  const [input, setInput] = useState(SAMPLE);
  const [mode, setMode] = useState('minify');
  const [dropEmpty, setDropEmpty] = useState(true);

  const output = useMemo(() => (mode === 'minify' ? minify(input, dropEmpty) : beautify(input)), [input, mode, dropEmpty]);

  const original = new TextEncoder().encode(input).length;
  const compressed = new TextEncoder().encode(output).length;
  const saved = original ? Math.max(0, ((original - compressed) / original) * 100) : 0;

  return (
    <ToolShell
      toolId="css-minifier"
      icon={Eraser}
      title="CSS Minifier"
      desc="Squeeze a stylesheet down for production — comments and whitespace go, strings and calc() stay intact."
      state={{ input, mode, dropEmpty }}
      onRestore={(saved) => { setInput(saved.input); setMode(saved.mode); setDropEmpty(saved.dropEmpty ?? true); }}
      exportText={output}
      exportName={mode === 'minify' ? 'styles.min.css' : 'styles.tidy.css'}
      exportMime="text/css"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setMode('minify')} className={`rounded-lg border px-3 py-1.5 text-xs transition ${mode === 'minify' ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>Minify</button>
        <button onClick={() => setMode('beautify')} className={`rounded-lg border px-3 py-1.5 text-xs transition ${mode === 'beautify' ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>Tidy up</button>
      </div>
      {mode === 'minify' && (
        <ToggleRow label="Remove empty rule blocks" checked={dropEmpty} onChange={setDropEmpty} hint=".rule { }" />
      )}
      <Area value={input} onChange={setInput} rows={9} mono placeholder="Paste CSS here" />
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Input" value={fmtBytes(original)} />
        <Stat label="Output" value={fmtBytes(compressed)} />
        <Stat label={compressed <= original ? 'Saved' : 'Growth'} value={`${Math.abs(saved).toFixed(1)}%`} />
      </div>
      <Out label={mode === 'minify' ? 'Minified CSS' : 'Tidied CSS'} value={output}>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono-j text-[11px] text-cyan-j scrollbar-thin">{output || '—'}</pre>
      </Out>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={output} label="Copy CSS" />
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!output} onClick={() => downloadBlob(new Blob([output], { type: 'text/css' }), 'styles.min.css')}>
          <Download className="h-3.5 w-3.5" /> Download CSS
        </Button>
      </div>
      <Panel>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Comments are removed, runs of whitespace collapse to a single space, and the spaces around <span className="font-mono-j">{'{ } : ; , > + ~'}</span> disappear. Values inside quotes and maths inside <span className="font-mono-j">calc()</span> are left exactly as you wrote them.
        </div>
      </Panel>
    </ToolShell>
  );
}