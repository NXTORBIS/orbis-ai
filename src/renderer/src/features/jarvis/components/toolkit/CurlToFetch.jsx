import { useMemo, useState } from 'react';
import { Terminal } from 'lucide-react';
import { ToolHeader, Seg, Area, Out, CopyBtn, Stat, Panel } from './shared';
import ToolShell from './kit/ToolShell';

const SAMPLE = `curl -X POST 'https://api.example.com/v1/orders' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer eyJhbGciOi...' \\
  -d '{"customer":"ada","items":[{"sku":"A1","qty":2}],"express":true}'`;

const VALUE_FLAGS = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '-u', '--user', '-b', '--cookie', '-A', '--user-agent', '-e', '--referer', '-F', '--form', '--url', '-o', '--output']);

function tokenize(cmd) {
  const text = cmd.replace(/\\\r?\n/g, ' ');
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && text[i + 1] === '"') { current += '"'; i++; }
      else current += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (/\s/.test(c)) { if (current) { tokens.push(current); current = ''; } }
    else current += c;
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseCurl(cmd) {
  const tokens = tokenize(cmd.trim());
  const headers = [];
  const data = [];
  const form = [];
  const flags = [];
  let method = null;
  let url = null;
  let user = null;
  let cookie = null;
  let agent = null;

  const handle = (flag, value) => {
    const f = flag.toLowerCase();
    if (f === '-x' || f === '--request') method = value.toUpperCase();
    else if (f === '-h' || f === '--header') { const i = value.indexOf(':'); if (i > 0) headers.push([value.slice(0, i).trim(), value.slice(i + 1).trim()]); }
    else if (f === '-d' || f === '--data' || f === '--data-raw' || f === '--data-binary' || f === '--data-urlencode') data.push(value);
    else if (f === '-u' || f === '--user') user = value;
    else if (f === '-b' || f === '--cookie') cookie = value;
    else if (f === '-a' || f === '--user-agent') agent = value;
    else if (f === '-f' || f === '--form') form.push(value);
    else if (f === '--url') url = value;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'curl') continue;
    if (token.startsWith('--') && token.includes('=') && !VALUE_FLAGS.has(token)) {
      const eq = token.indexOf('=');
      handle(token.slice(0, eq), token.slice(eq + 1));
    } else if (VALUE_FLAGS.has(token)) {
      handle(token, tokens[++i] ?? '');
    } else if (token.startsWith('-')) {
      flags.push(token);
    } else if (!url) {
      url = token;
    }
  }

  if (!method) method = form.length ? 'POST' : data.length ? 'POST' : 'GET';
  if (user) {
    let encoded = '';
    try { encoded = btoa(user); } catch { encoded = 'REPLACE_WITH_BASE64_CREDENTIALS'; }
    headers.push(['Authorization', `Basic ${encoded}`]);
  }
  if (cookie) headers.push(['Cookie', cookie]);
  if (agent) headers.push(['User-Agent', agent]);

  let body = null;
  let isJson = false;
  if (data.length) {
    const joined = data.join('&');
    try { body = JSON.stringify(JSON.parse(joined), null, 2); isJson = true; } catch { body = joined; }
  }
  if (isJson && !headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/json']);

  return { method, url, headers, body, isJson, form, flags, hasForm: form.length > 0 };
}

const quote = (s) => s.replace(/'/g, "\\'");

export default function CurlToFetch() {
  const [cmd, setCmd] = useState(SAMPLE);
  const [lang, setLang] = useState('fetch');

  const parsed = useMemo(() => parseCurl(cmd), [cmd]);

  const outputs = useMemo(() => {
    const { method, url, headers, body, isJson } = parsed;
    const headerLines = headers.map(([k, v]) => `    '${quote(k)}': '${quote(v)}',`);
    const bodyLine = body ? (isJson ? `  body: JSON.stringify(${body.split('\n').map((l) => l).join('\n')}),` : `  body: '${quote(body)}',`) : null;

    const js = `const response = await fetch('${url || 'https://example.com'}', {
  method: '${method}',
${headerLines.length ? `  headers: {\n${headerLines.join('\n')}\n  },\n` : ''}${bodyLine ? `${bodyLine}\n` : ''}});
const data = await response.json();`;

    const node = `import fetch from 'node-fetch'; // or use the built-in fetch on Node 18+

const response = await fetch('${url || 'https://example.com'}', {
  method: '${method}',
${headerLines.length ? `  headers: {\n${headerLines.join('\n')}\n  },\n` : ''}${bodyLine ? `${bodyLine}\n` : ''}});
console.log(await response.json());`;

    const python = `import requests

response = requests.${method.toLowerCase()}(
    "${url || 'https://example.com'}",${headerLines.length ? `\n    headers={\n${headers.map(([k, v]) => `        "${k}": "${v}",`).join('\n')}\n    },` : ''}${body ? (isJson ? `\n    json=${body.split('\n').join('\n    ')},` : `\n    data="""${body}""",`) : ''}
)
print(response.json())`;

    return { fetch: js, node, python };
  }, [parsed]);

  const output = outputs[lang];

  return (
    <ToolShell
      toolId="curl-code"
      icon={Terminal}
      title="cURL → Code"
      desc="Paste a curl command and get ready-to-run fetch, Node or Python code."
      state={{ cmd, lang }}
      onRestore={(saved) => { setCmd(saved.cmd); setLang(saved.lang || 'fetch'); }}
      exportText={output}
      exportName={lang === 'python' ? 'request.py' : 'request.js'}
    >
      <Area value={cmd} onChange={setCmd} rows={7} placeholder="Paste a curl command…" />
      <Seg value={lang} onChange={setLang} options={[{ value: 'fetch', label: 'Browser fetch' }, { value: 'node', label: 'Node fetch' }, { value: 'python', label: 'Python requests' }]} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Method" value={parsed.method} mono />
        <Stat label="URL" value={parsed.url || 'not found'} />
        <Stat label="Headers" value={String(parsed.headers.length)} />
        <Stat label="Body" value={parsed.body ? (parsed.isJson ? 'JSON' : 'text') : 'none'} />
      </div>
      {parsed.hasForm && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">This command uploads a file (-F). The generated code sends the text fields; attach the file separately with FormData.</div>}
      <Out label={lang === 'fetch' ? 'JavaScript' : lang === 'node' ? 'Node.js' : 'Python'} value={output}>
        <pre className="max-h-80 overflow-auto whitespace-pre font-mono-j text-[11px] scrollbar-thin">{output}</pre>
      </Out>
      <CopyBtn value={output} label="Copy code" />
      {parsed.headers.length > 0 && (
        <Panel>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Parsed headers</div>
          <div className="space-y-1">
            {parsed.headers.map(([k, v], i) => (
              <div key={i} className="flex gap-2 font-mono-j text-[11px]">
                <span className="text-cyan-j">{k}:</span>
                <span className="truncate text-muted-foreground">{v}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <p className="text-[11px] text-muted-foreground">Supported flags: -X, -H, -d/--data*, -u, -b, -A, -F, --url. Anything else is reported as ignored.</p>
    </ToolShell>
  );
}