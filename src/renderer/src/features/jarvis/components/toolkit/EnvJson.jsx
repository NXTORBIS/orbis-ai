import { useMemo, useState } from 'react';
import { Terminal, Download } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Area, Seg, Out, CopyBtn, Panel, Stat, downloadBlob } from './shared';
import ToolShell from './kit/ToolShell';

const SAMPLE_ENV = `NODE_ENV=production
API_URL="https://api.example.com/v2"
PORT=3000
DEBUG=true
# comments and blank lines are ignored

FEATURE_FLAGS='{"beta":true}'`;

const SAMPLE_JSON = `{
  "NODE_ENV": "production",
  "API_URL": "https://api.example.com/v2",
  "PORT": 3000,
  "DEBUG": true,
  "FEATURE_FLAGS": {
    "beta": true
  }
}`;

const parseEnv = (text) => text.split('\n').map((line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const clean = trimmed.replace(/^export\s+/, '');
  const eq = clean.indexOf('=');
  if (eq === -1) return { key: clean, value: '', bad: true };
  const key = clean.slice(0, eq).trim();
  let value = clean.slice(eq + 1).trim();
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  if (quoted) value = value.slice(1, -1);
  if (!quoted) {
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value === 'null') value = null;
    else if (value !== '' && !Number.isNaN(Number(value))) value = Number(value);
    else if (/^[{[]/.test(value)) { try { value = JSON.parse(value); } catch { /* keep as string */ } }
  }
  return { key, value, bad: false };
}).filter(Boolean);

const needsQuotes = (value) => /\s|#|"|'|\\/.test(String(value));

const toEnv = (object) => Object.entries(object).map(([key, value]) => {
  const rendered = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `${key}=${needsQuotes(rendered) ? `"${rendered.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : rendered}`;
}).join('\n');

export default function EnvJson() {
  const [dir, setDir] = useState('env2json');
  const [input, setInput] = useState(SAMPLE_ENV);

  const result = useMemo(() => {
    if (dir === 'env2json') {
      const rows = parseEnv(input);
      const object = {};
      rows.forEach((r) => { object[r.key] = r.value; });
      return { output: JSON.stringify(object, null, 2), count: rows.length, warnings: rows.filter((r) => r.bad).map((r) => r.key) };
    }
    try {
      const parsed = JSON.parse(input);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { output: '', count: 0, warnings: [], error: 'The top level of the JSON must be an object of key/value pairs.' };
      }
      return { output: toEnv(parsed), count: Object.keys(parsed).length, warnings: [] };
    } catch (e) {
      return { output: '', count: 0, warnings: [], error: e.message };
    }
  }, [dir, input]);

  const switchDir = (value) => {
    setDir(value);
    setInput(value === 'env2json' ? SAMPLE_ENV : SAMPLE_JSON);
  };

  const downloadName = dir === 'env2json' ? 'converted.json' : '.env';

  return (
    <ToolShell
      toolId="env-json"
      icon={Terminal}
      title=".env ⇄ JSON Converter"
      desc="Swap between a dotenv file and a JSON object of settings — types included."
      state={{ dir, input }}
      onRestore={(saved) => { setDir(saved.dir); setInput(saved.input); }}
      exportText={result.output}
      exportName={downloadName}
    >
      <Seg value={dir} onChange={switchDir} options={[{ value: 'env2json', label: '.env → JSON' }, { value: 'json2env', label: 'JSON → .env' }]} />
      <Area value={input} onChange={setInput} rows={9} mono placeholder={dir === 'env2json' ? 'KEY=value' : '{ "KEY": "value" }'} />
      {result.error && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Invalid JSON: {result.error}</div>}
      {result.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          These lines had no value: {result.warnings.join(', ')}
        </div>
      )}
      <Out label={dir === 'env2json' ? 'JSON' : '.env file'} value={result.output}>
        <pre className="max-h-80 overflow-auto whitespace-pre font-mono-j text-[11px] text-cyan-j scrollbar-thin">{result.output || '—'}</pre>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Keys" value={String(result.count)} />
        <Stat label="Lines" value={String(result.output ? result.output.split('\n').length : 0)} />
        <Stat label="Direction" value={dir === 'env2json' ? 'env → json' : 'json → env'} />
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={result.output} label="Copy output" />
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!result.output} onClick={() => downloadBlob(new Blob([result.output], { type: 'text/plain' }), downloadName)}>
          <Download className="h-3.5 w-3.5" /> Download {downloadName}
        </Button>
      </div>
      <Panel>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Values are typed on the way in: <span className="font-mono-j">3000</span> becomes a number, <span className="font-mono-j">true</span> a boolean, and anything that looks like JSON is parsed. Quoted values stay strings, so <span className="font-mono-j">PORT="3000"</span> is preserved exactly as written.
        </div>
      </Panel>
    </ToolShell>
  );
}