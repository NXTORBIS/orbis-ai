import { useMemo, useState } from 'react';
import { Terminal } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Panel, Seg, Stat } from './shared';

const toBase64 = (text) => {
  try {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  } catch {
    return '';
  }
};

export default function HeaderBuilder() {
  const [raw, setRaw] = useState('Authorization: Bearer eyJhbGciOi...\nContent-Type: application/json\nAccept: application/json');
  const [target, setTarget] = useState('fetch');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [token, setToken] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('https://api.example.com/v1/items');
  const [body, setBody] = useState('');

  const parsed = useMemo(() => {
    const map = new Map();
    String(raw).split('\n').forEach((line) => {
      const trimmed = line.trim().replace(/^[-*]\s*/, '');
      if (!trimmed) return;
      const index = trimmed.indexOf(':');
      if (index < 0) {
        map.set('', (map.get('') || []).concat(trimmed));
        return;
      }
      const name = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      map.set(name, (map.get(name) || []).concat(value));
    });
    return [...map.entries()].filter(([name]) => name);
  }, [raw]);

  const authHeaders = useMemo(() => {
    const out = [];
    if (user || pass) out.push({ name: 'Authorization', value: `Basic ${toBase64(`${user}:${pass}`)}` });
    if (token) out.push({ name: 'Authorization', value: `Bearer ${token}` });
    return out;
  }, [user, pass, token]);

  const all = [...parsed, ...authHeaders];
  const headerObject = `{\n${all.map(([name, values]) => `  "${name}": "${String(values[0] ?? '').replace(/"/g, '\\"')}"`).join(',\n')}\n}`;

  const code = useMemo(() => {
    const headerLines = all.map(([name, values]) => `  "${name}": "${String(values[0] ?? '').replace(/"/g, '\\"')}"`).join(',\n');
    if (target === 'curl') {
      return `curl -X ${method} "${url}"${all.length ? ` \\\n${all.map(([name, values]) => `  -H "${name}: ${values[0]}"`).join(' \\\n')}` : ''}${body && ['POST', 'PUT', 'PATCH'].includes(method) ? ` \\\n  -d '${body}'` : ''}`;
    }
    if (target === 'node') {
      return `const res = await fetch("${url}", {\n  method: "${method}",\n  headers: {\n${headerLines}\n  }${body && ['POST', 'PUT', 'PATCH'].includes(method) ? `,\n  body: JSON.stringify(${body})` : ''}\n});\nconst data = await res.json();`;
    }
    if (target === 'python') {
      return `import requests\n\nheaders = ${headerObject}\n\nresponse = requests.${method.toLowerCase()}("${url}", headers=headers${body && ['POST', 'PUT', 'PATCH'].includes(method) ? `, json=${body}` : ''})\nprint(response.status_code, response.json())`;
    }
    if (target === 'axios') {
      return `const { data } = await axios.${method.toLowerCase()}("${url}", ${body && ['POST', 'PUT', 'PATCH'].includes(method) ? `${body}, ` : ''}{\n  headers: {\n${headerLines}\n  }\n});`;
    }
    return `fetch("${url}", {\n  method: "${method}",\n  headers: {\n${headerLines}\n  }${body && ['POST', 'PUT', 'PATCH'].includes(method) ? `,\n  body: JSON.stringify(${body})` : ''}\n}).then((res) => res.json()).then(console.log);`;
  }, [target, all, method, url, body, headerObject]);

  const checklist = [
    { header: 'Authorization', note: 'Prefer short-lived bearer tokens over long-lived API keys.' },
    { header: 'Content-Type', note: 'Set application/json when you send a JSON body, or servers may ignore it.' },
    { header: 'Accept', note: 'Ask for what you can parse — application/json beats guessing.' },
    { header: 'User-Agent', note: 'Identifies you politely and gets you better support answers.' },
    { header: 'Idempotency-Key', note: 'Send on POSTs you might retry so a duplicate charge cannot happen.' },
    { header: 'X-Request-Id', note: 'Correlate your logs with the provider when you raise a ticket.' },
  ];

  const missing = checklist.filter((item) => !parsed.some(([name]) => name.toLowerCase() === item.header.toLowerCase()));

  return (
    <ToolShell
      toolId="headers"
      icon={Terminal}
      title="HTTP Headers & Auth Builder"
      desc="Paste a set of headers to read them back as a table, build Basic or Bearer auth, and generate the request in five languages."
      state={{ raw, target, user, pass, token, method, url, body }}
      onRestore={(restored) => {
        if (typeof restored.raw === 'string') setRaw(restored.raw);
        if (restored.target) setTarget(restored.target);
        if (typeof restored.user === 'string') setUser(restored.user);
        if (typeof restored.pass === 'string') setPass(restored.pass);
        if (typeof restored.token === 'string') setToken(restored.token);
        if (restored.method) setMethod(restored.method);
        if (typeof restored.url === 'string') setUrl(restored.url);
        if (typeof restored.body === 'string') setBody(restored.body);
      }}
      exportText={code}
      exportName="request.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={target} onChange={setTarget} options={[{ value: 'fetch', label: 'fetch' }, { value: 'axios', label: 'axios' }, { value: 'node', label: 'Node' }, { value: 'python', label: 'Python' }, { value: 'curl', label: 'cURL' }]} />
        <CopyBtn value={code} label="Copy request" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm">
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="URL">
          <input value={url} onChange={(e) => setUrl(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
        <Field label="Bearer token">
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="paste a token" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Basic auth username">
          <input value={user} onChange={(e) => setUser(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
        <Field label="Basic auth password">
          <input value={pass} onChange={(e) => setPass(e.target.value)} type="password" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
      </div>

      <Field label="Headers (one per line, as you would copy them from docs or devtools)">
        <Area value={raw} onChange={setRaw} rows={6} mono placeholder="Content-Type: application/json" />
      </Field>

      {!!body.trim() && ['POST', 'PUT', 'PATCH'].includes(method) && (
        <Field label="JSON body">
          <Area value={body} onChange={setBody} rows={4} mono />
        </Field>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Parsed headers ({all.length})</div>
        <div className="space-y-1">
          {all.map(([name, values]) => (
            <div key={name} className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="w-40 shrink-0 truncate font-mono-j text-[11px] text-cyan-j">{name}</span>
              <span className="min-w-0 flex-1 break-all font-mono-j text-[11px]">
                {name.toLowerCase() === 'authorization' ? `${String(values[0]).slice(0, 12)}…` : values.join(', ')}
              </span>
            </div>
          ))}
          {!all.length && <span className="text-[11px] text-muted-foreground">Nothing parsed yet — paste a header block or add a token.</span>}
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Generated request</div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{code || '—'}</pre>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Worth adding</div>
        <div className="space-y-1">
          {checklist.map((item) => {
            const isMissing = missing.includes(item);
            return (
              <div key={item.header} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${isMissing ? 'border-border/50 bg-card/40' : 'border-cyan-j/40 bg-cyan-j/5 text-cyan-j'}`}>
                <span className="w-32 shrink-0 font-mono-j">{item.header}</span>
                <span className={isMissing ? 'text-muted-foreground' : ''}>{item.note}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Headers" value={String(all.length)} mono />
        <Stat label="Generated for" value={target} mono />
        <Stat label="Suggestions left" value={String(missing.length)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Tokens and passwords stay in this page — nothing is sent anywhere, which makes this a safe place to sanity-check a request before you paste
          it into a notebook. The Basic value is standard base64 of user:password, so treat the generated string as a secret too.
        </p>
      </Panel>
    </ToolShell>
  );
}