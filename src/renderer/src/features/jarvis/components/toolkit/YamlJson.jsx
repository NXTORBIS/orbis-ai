import { useMemo, useState } from 'react';
import { FileCode } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Panel, Seg, Stat } from './shared';

const SAMPLE_YAML = [
  'service: api',
  'version: 2',
  'port: 8080',
  'debug: false',
  'tags:',
  '  - production',
  '  - public',
  'database:',
  '  host: db.internal',
  '  pool: 10',
  '  replicas:',
  '    - db-1',
  '    - db-2',
  'limits:',
  '  cpu: "500m"',
  '  memory: 512',
].join('\n');

const SAMPLE_JSON = JSON.stringify({
  service: 'api',
  version: 2,
  port: 8080,
  debug: false,
  tags: ['production', 'public'],
  database: { host: 'db.internal', pool: 10, replicas: ['db-1', 'db-2'] },
  limits: { cpu: '500m', memory: 512 },
}, null, 2);

const scalar = (raw) => {
  const text = raw.trim();
  if (text === '') return null;
  if (text === '~' || text === 'null') return null;
  if (text === 'true' || text === 'false') return text === 'true';
  if (/^".*"$/.test(text) || /^'.*'$/.test(text)) return text.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text === '[]') return [];
  if (text === '{}') return {};
  if (text.startsWith('[') && text.endsWith(']')) {
    return text.slice(1, -1).split(',').map((part) => scalar(part));
  }
  return text;
};

const parseYaml = (source) => {
  const lines = source.split('\n');
  const root = {};
  const stack = [{ indent: -1, value: root }];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.search(/\S/);
    const text = raw.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (text.startsWith('- ')) {
      const rest = text.slice(2).trim();
      if (!Array.isArray(parent)) {
        return { error: 'Line ' + (index + 1) + ': a list item has no list to belong to.' };
      }
      if (!rest) {
        const nested = {};
        parent.push(nested);
        stack.push({ indent, value: nested });
      } else if (rest.includes(':')) {
        const split = rest.indexOf(':');
        const item = { [rest.slice(0, split).trim()]: scalar(rest.slice(split + 1)) };
        parent.push(item);
        stack.push({ indent, value: item });
      } else {
        parent.push(scalar(rest));
      }
      continue;
    }

    if (text === '-') {
      if (!Array.isArray(parent)) return { error: 'Line ' + (index + 1) + ': a list item has no list to belong to.' };
      const nested = {};
      parent.push(nested);
      stack.push({ indent, value: nested });
      continue;
    }

    const split = text.indexOf(':');
    if (split === -1) return { error: 'Line ' + (index + 1) + ': expected "key: value".' };
    const key = text.slice(0, split).trim();
    const valuePart = text.slice(split + 1).trim();
    if (Array.isArray(parent)) return { error: 'Line ' + (index + 1) + ': cannot use a key inside a list.' };

    if (valuePart === '') {
      const nextLine = lines.find((line, position) => position > index && line.trim() && !line.trim().startsWith('#'));
      const nextIndent = nextLine ? nextLine.search(/\S/) : -1;
      const container = nextLine && nextIndent > indent && nextLine.trim().startsWith('-') ? [] : {};
      parent[key] = container;
      stack.push({ indent, value: container });
    } else {
      parent[key] = scalar(valuePart);
    }
  }
  return { value: root, lines: lines.filter((line) => line.trim()).length };
};

const quoteIfNeeded = (value) => {
  const text = String(value);
  if (text === '') return "''";
  if (/^(true|false|null|yes|no|on|off)$/i.test(text)) return '"' + text + '"';
  if (/^-?\d+(\.\d+)?$/.test(text)) return '"' + text + '"';
  if (/[:#\-{}[\],&*?|>%@`"']/.test(text)) return '"' + text.replace(/"/g, '\\"') + '"';
  return text;
};

const toYaml = (value, indent = 0) => {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return pad + '[]';
    return value.map((entry) => {
      if (entry && typeof entry === 'object') {
        const inner = toYaml(entry, indent + 2).split('\n').map((line) => line.trim()).join('\n' + ' '.repeat(indent + 2));
        return pad + '- ' + inner.trim();
      }
      return pad + '- ' + quoteIfNeeded(entry);
    }).join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return pad + '{}';
    return entries.map(([key, entry]) => {
      if (Array.isArray(entry) && !entry.length) return pad + key + ': []';
      if (entry && typeof entry === 'object' && Object.keys(entry).length) {
        return pad + key + ':\n' + toYaml(entry, indent + 2);
      }
      if (Array.isArray(entry)) return pad + key + ':\n' + toYaml(entry, indent + 2);
      return pad + key + ': ' + (entry === null ? 'null' : quoteIfNeeded(entry));
    }).join('\n');
  }
  return pad + quoteIfNeeded(value);
};

const countShape = (value) => {
  if (Array.isArray(value)) return { kind: 'array', size: value.length };
  if (value && typeof value === 'object') return { kind: 'object', size: Object.keys(value).length };
  return { kind: typeof value, size: 0 };
};

export default function YamlJson() {
  const [direction, setDirection] = useState('yaml');
  const [yaml, setYaml] = useState(SAMPLE_YAML);
  const [json, setJson] = useState(SAMPLE_JSON);

  const result = useMemo(() => {
    if (direction === 'yaml') {
      const parsed = parseYaml(yaml);
      if (parsed.error) return { error: parsed.error, side: 'yaml' };
      return { output: JSON.stringify(parsed.value, null, 2), shape: countShape(parsed.value), sourceLines: parsed.lines };
    }
    try {
      const parsed = JSON.parse(json);
      return { output: toYaml(parsed), shape: countShape(parsed), sourceLines: json.split('\n').length };
    } catch (error) {
      return { error: String(error.message).replace('JSON.parse: ', ''), side: 'json' };
    }
  }, [direction, yaml, json]);

  const output = result.output || '';
  const source = direction === 'yaml' ? yaml : json;

  return (
    <ToolShell
      toolId="yaml-json"
      icon={FileCode}
      title="YAML ⇄ JSON Converter"
      desc="Config files in and out either way, with the structure summarised and the offending line named when something will not parse."
      state={{ direction, yaml, json }}
      onRestore={(restored) => {
        if (restored.direction) setDirection(restored.direction);
        if (typeof restored.yaml === 'string') setYaml(restored.yaml);
        if (typeof restored.json === 'string') setJson(restored.json);
      }}
      exportText={output}
      exportName={direction === 'yaml' ? 'config.json' : 'config.yaml'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={direction}
          onChange={setDirection}
          options={[{ value: 'yaml', label: 'YAML → JSON' }, { value: 'json', label: 'JSON → YAML' }]}
        />
        <button
          type="button"
          onClick={() => {
            if (direction === 'yaml') setYaml(SAMPLE_YAML);
            else setJson(SAMPLE_JSON);
          }}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          Load a sample
        </button>
        <button
          type="button"
          onClick={() => {
            if (direction === 'yaml') setJson(output);
            else setYaml(output);
          }}
          disabled={!output}
          className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          Send to the other side
        </button>
        <CopyBtn value={output} label="Copy result" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">{direction === 'yaml' ? 'YAML' : 'JSON'}</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{source.split('\n').length} lines</span>
          </div>
          {direction === 'yaml' ? (
            <Area value={yaml} onChange={setYaml} rows={16} mono placeholder={'service: api\nport: 8080'} />
          ) : (
            <Area value={json} onChange={setJson} rows={16} mono placeholder='{"service": "api"}' />
          )}
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">{direction === 'yaml' ? 'JSON' : 'YAML'}</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{output ? output.split('\n').length + ' lines' : '—'}</span>
          </div>
          <Area value={output} onChange={() => {}} rows={16} mono readOnly placeholder="The converted output appears here" />
        </Panel>
      </div>

      {result.error && <Panel className="border-rose-500/40 !p-3 text-[11px] text-rose-400">Could not parse: {result.error}</Panel>}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={result.error ? 'Waiting for valid input' : 'Converted'}
          value={result.error ? '—' : (direction === 'yaml' ? 'JSON' : 'YAML')}
          sub={result.error
            ? 'Fix the line named above and the conversion happens as you type.'
            : 'Top level is a ' + result.shape.kind + ' with ' + result.shape.size + ' ' + (result.shape.kind === 'array' ? 'items' : 'keys') + '. Nothing is sent anywhere — the whole conversion runs in this page.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Structure at a glance</div>
          <div className="space-y-1 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Top level</span>
              <span className="text-cyan-j">{result.error ? '—' : result.shape.kind}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">{result.shape && result.shape.kind === 'array' ? 'Items' : 'Keys'}</span>
              <span>{result.error ? '—' : result.shape.size}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Source lines</span>
              <span>{result.sourceLines || 0}</span>
            </div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="text-muted-foreground">Output size</span>
              <span>{output.length} chars</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What this converter understands</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Nesting by indentation, with two spaces or any consistent width — the parser compares indentation levels rather than assuming a size.</p>
            <p>· Lists with <span className="font-mono-j text-cyan-j">- item</span>, including lists of maps and nested lists under a key.</p>
            <p>· Scalars: strings, integers, decimals, true/false, null and ~, plus quoted values that must stay strings.</p>
            <p>· Inline flow lists like <span className="font-mono-j text-cyan-j">[a, b, c]</span> and empty <span className="font-mono-j text-cyan-j">[]</span> / <span className="font-mono-j text-cyan-j">{'{}'}</span>.</p>
            <p>· Comments with #, blank lines, and CRLF line endings — all ignored rather than tripped over.</p>
            <p>· Not supported: anchors, aliases, multi-line literal blocks, tags and merge keys. Those are rare in config and better handled by a full parser.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Gotchas worth knowing</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· YAML turns <span className="font-mono-j">1.0</span> into a number and <span className="font-mono-j">"1.0"</span> into a string; version numbers need quotes or they come back as 1.</p>
            <p>· <span className="font-mono-j">yes</span>, <span className="font-mono-j">no</span> and <span className="font-mono-j">on</span> are booleans in YAML 1.1 but strings in 1.2 — this converter will quote them when writing.</p>
            <p>· Tabs are illegal for YAML indentation. If a paste fails on every line, look for tabs first.</p>
            <p>· A key with nothing after it starts a nested block, which is why a stray blank line can change the shape of a file.</p>
            <p>· Colons inside unquoted values break parsing in real YAML too — quote anything containing a colon and a space.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Direction" value={direction === 'yaml' ? 'YAML → JSON' : 'JSON → YAML'} mono />
        <Stat label="Top level" value={result.error ? '—' : result.shape.kind} mono />
        <Stat label="Entries" value={result.error ? '—' : String(result.shape.size)} mono />
        <Stat label="Output" value={output ? String(output.length) : '0'} mono sub="characters" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">When to use which</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· YAML for anything a human edits: deployment manifests, CI config, small data files. Comments and readable nesting are worth the quirks.</p>
          <p>· JSON for anything a machine exchanges: API payloads, lockfiles, anything that must be unambiguous.</p>
          <p>· Converting YAML to JSON is the usual direction — parse it strictly before shipping, since a silently coerced string is the classic production bug.</p>
          <p>· Keep the diff small: sort keys and use two spaces when regenerating a file, so version control shows what changed rather than everything.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Direction', value: direction },
              { label: 'Output lines', value: output ? String(output.split('\n').length) : '0' },
              { label: 'Status', value: result.error ? 'error' : 'valid' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The parser is written for configuration files: it tracks an indentation stack, recognises list items and nested maps, coerces scalars the way YAML
          does, and reports the line number of anything it cannot follow. Writing YAML back quotes any value that would otherwise be reinterpreted, so a round
          trip through both directions leaves your strings as strings.
        </p>
      </Panel>
    </ToolShell>
  );
}