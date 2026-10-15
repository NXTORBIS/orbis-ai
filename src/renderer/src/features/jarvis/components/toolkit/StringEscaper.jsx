import { useMemo, useState } from 'react';
import { Code } from 'lucide-react';
import { ToolHeader, Area, Seg, Out, Panel, Stat } from './shared';
import ToolShell from './kit/ToolShell';

const jsonEscape = (text, forJs) => {
  let out = JSON.stringify(text).slice(1, -1);
  if (forJs) out = out.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return out;
};

const pyEscape = (text) => Array.from(text).map((ch) => {
  const code = ch.codePointAt(0);
  if (ch === '\\') return '\\\\';
  if (ch === "'") return "\\'";
  if (ch === '"') return '\\"';
  if (ch === '\n') return '\\n';
  if (ch === '\r') return '\\r';
  if (ch === '\t') return '\\t';
  if (code < 32 || code === 127) return `\\x${code.toString(16).padStart(2, '0')}`;
  if (code > 126) return code > 0xffff ? `\\U${code.toString(16).padStart(8, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`;
  return ch;
}).join('');

const htmlEscape = (text) => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const htmlUnescape = (text) => {
  const doc = new DOMParser().parseFromString(`<body>${text}</body>`, 'text/html');
  return doc.body.textContent || '';
};

const pyUnescape = (text) => text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[nrt'"\\])/g, (_, seq) => {
  if (seq[0] === 'x') return String.fromCharCode(parseInt(seq.slice(1), 16));
  if (seq[0] === 'u') return String.fromCharCode(parseInt(seq.slice(1), 16));
  if (seq[0] === 'U') return String.fromCodePoint(parseInt(seq.slice(1), 16));
  return { n: '\n', r: '\r', t: '\t', "'": "'", '"': '"', '\\': '\\' }[seq];
});

const LANGS = [['json', 'JSON'], ['js', 'JavaScript'], ['py', 'Python'], ['html', 'HTML']];

export default function StringEscaper() {
  const [lang, setLang] = useState('json');
  const [mode, setMode] = useState('escape');
  const [input, setInput] = useState('Line one\nLine two with "quotes" & <tags> — café ☕');

  const { output, note } = useMemo(() => {
    if (mode === 'escape') {
      if (lang === 'json') return { output: jsonEscape(input, false) };
      if (lang === 'js') return { output: jsonEscape(input, true) };
      if (lang === 'py') return { output: pyEscape(input) };
      return { output: htmlEscape(input) };
    }
    if (lang === 'html') return { output: htmlUnescape(input) };
    if (lang === 'py') return { output: pyUnescape(input) };
    try {
      return { output: JSON.parse(`"${input}"`) };
    } catch {
      return { output: '', note: 'That is not a valid escaped string — check for a stray unescaped quote or trailing backslash.' };
    }
  }, [input, lang, mode]);

  const example = lang === 'html' ? '<a href="?a=1&b=2">Tom & Jerry</a>' : 'Line one\\nLine two with \\"quotes\\" & <tags> \\u2014 caf\\u00e9 \\u2615';

  return (
    <ToolShell
      toolId="string-escaper"
      icon={Code}
      title="String Escaper"
      desc="Escape a value for a JSON body, JS/Python literal or HTML — and turn it back again."
      state={{ lang, mode, input }}
      onRestore={(saved) => { setLang(saved.lang); setMode(saved.mode); setInput(saved.input); }}
      exportText={output}
      exportName="escaped.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={lang} onChange={setLang} options={LANGS.map(([value, label]) => ({ value, label }))} />
        <Seg value={mode} onChange={setMode} options={[{ value: 'escape', label: 'Escape' }, { value: 'unescape', label: 'Unescape' }]} />
      </div>
      <Area value={input} onChange={setInput} rows={5} mono placeholder={mode === 'escape' ? 'Paste the raw text…' : 'Paste the escaped string…'} />
      {note && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{note}</div>}
      <Out label={`${mode === 'escape' ? 'Escaped' : 'Unescaped'} (${['json', 'js'].includes(lang) ? 'double-quoted' : lang === 'py' ? 'single-quoted' : 'plain'} form)`} value={output}>
        <pre className="whitespace-pre-wrap break-all font-mono-j text-xs text-cyan-j">{output || '—'}</pre>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Input characters" value={String(input.length)} />
        <Stat label="Output characters" value={String(output.length)} />
        <Stat label="Difference" value={String(output.length - input.length)} />
      </div>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Try this example</div>
        <button
          onClick={() => { setInput(example); setMode('unescape'); }}
          className="w-full break-all rounded-lg border border-border/70 px-3 py-2 text-left font-mono-j text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground"
        >
          {example}
        </button>
      </Panel>
      <p className="text-[11px] text-muted-foreground">JSON and JavaScript share the same escaping rules, so the two modes differ only in how line and paragraph separators are handled.</p>
    </ToolShell>
  );
}