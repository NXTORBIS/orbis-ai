import { useMemo, useState } from 'react';
import { Plug, Send } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const SAMPLE_URL = 'https://api.github.com/repos/lucide-icons/lucide';

const pretty = (text, type) => {
  if (!text) return '';
  if (type.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
};

export default function ApiTester() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState(SAMPLE_URL);
  const [headers, setHeaders] = useState('Accept: application/json');
  const [body, setBody] = useState('');
  const [useAuth, setUseAuth] = useState(false);
  const [authHeader, setAuthHeader] = useState('Authorization: Bearer ');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);

  const send = async () => {
    setSending(true);
    setError('');
    setResponse(null);
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const parsedHeaders = {};
      [...(useAuth ? [authHeader] : []), ...headers.split('\n')].forEach((line) => {
        const index = line.indexOf(':');
        if (index > 0) parsedHeaders[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      });
      const options = { method, headers: parsedHeaders, signal: controller.signal };
      if (body.trim() && !['GET', 'HEAD'].includes(method)) options.body = body;
      const res = await fetch(url, options);
      const text = await res.text();
      const elapsed = performance.now() - started;
      const headerList = [...res.headers.entries()];
      const sizeLabel = new Blob([text]).size;
      setResponse({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText || '',
        type: res.type,
        elapsed,
        size: sizeLabel,
        headers: headerList,
        text,
        pretty: pretty(text, res.headers.get('content-type') || ''),
        contentType: res.headers.get('content-type') || 'unknown',
      });
      setHistory((current) => [{ method, url, status: res.status, elapsed, at: new Date().toLocaleTimeString() }, ...current].slice(0, 6));
    } catch (err) {
      const message = err.name === 'AbortError'
        ? 'The request timed out after 20 seconds.'
        : `${err.message}. This is usually CORS (the server did not allow a browser origin) or a network/DNS problem, not a fault in your request.`;
      setError(message);
      setHistory((current) => [{ method, url, status: 0, elapsed: performance.now() - started, at: new Date().toLocaleTimeString() }, ...current].slice(0, 6));
    } finally {
      clearTimeout(timeout);
      setSending(false);
    }
  };

  const curl = useMemo(() => {
    const parsed = [...(useAuth ? [authHeader] : []), ...headers.split('\n')]
      .map((line) => line.trim())
      .filter((line) => line.includes(':'))
      .map((line) => `  -H "${line}"`)
      .join(' \\\n');
    return `curl -X ${method} "${url}"${parsed ? ` \\\n${parsed}` : ''}${body.trim() && !['GET', 'HEAD'].includes(method) ? ` \\\n  -d '${body.replace(/'/g, "'\\''")}'` : ''}`;
  }, [method, url, headers, body, useAuth, authHeader]);

  const statusTone = response ? (response.status < 300 ? 'emerald' : response.status < 400 ? 'cyan' : response.status < 500 ? 'amber' : 'rose') : 'cyan';

  return (
    <ToolShell
      toolId="api-tester"
      icon={Plug}
      title="API Request Tester"
      desc="Fire a real request from your browser and read the status, timing, headers and body — then take the finished command with you."
      state={{ method, url, headers, body, useAuth, authHeader, history }}
      onRestore={(restored) => {
        if (restored.method) setMethod(restored.method);
        if (typeof restored.url === 'string') setUrl(restored.url);
        if (typeof restored.headers === 'string') setHeaders(restored.headers);
        if (typeof restored.body === 'string') setBody(restored.body);
        if (typeof restored.useAuth === 'boolean') setUseAuth(restored.useAuth);
        if (typeof restored.authHeader === 'string') setAuthHeader(restored.authHeader);
        if (Array.isArray(restored.history)) setHistory(restored.history);
      }}
      exportText={response ? `HTTP ${response.status} ${response.statusText} in ${Math.round(response.elapsed)}ms\n${response.pretty.slice(0, 4000)}` : curl}
      exportName="api-response.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={sending || !url}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send request'}
        </button>
        <CopyBtn value={curl} label="Copy as cURL" />
        {!!response && <CopyBtn value={response.pretty} label="Copy response body" />}
      </div>

      <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm">
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((verb) => <option key={verb} value={verb}>{verb}</option>)}
          </select>
        </Field>
        <Field label="URL">
          <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Area label="Headers — one per line" value={headers} onChange={setHeaders} rows={5} mono placeholder="Content-Type: application/json" />
        {!['GET', 'HEAD'].includes(method) ? (
          <Area label="Request body (JSON)" value={body} onChange={setBody} rows={5} mono placeholder={'{\n  "name": "Ada"\n}'} />
        ) : (
          <Panel className="!p-3 text-[11px] text-muted-foreground">
            {method} requests do not carry a body. Switch to POST, PUT or PATCH to send one.
          </Panel>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <ToggleRow label="Send an Authorization header" checked={useAuth} onChange={setUseAuth} hint="Kept in this page only" />
        {useAuth && (
          <input
            value={authHeader}
            onChange={(e) => setAuthHeader(e.target.value)}
            spellCheck={false}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs sm:w-96"
          />
        )}
      </div>

      {error && <Panel className="border-rose-500/40 text-[11px] text-rose-400">{error}</Panel>}

      {response && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr]">
            <Hero
              tone={statusTone}
              label="Status"
              value={response.status}
              sub={`${response.statusText || (response.ok ? 'OK' : 'error')} · ${Math.round(response.elapsed)} ms · ${(response.size / 1024).toFixed(1)} KB`}
            />
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Response headers</div>
              <div className="max-h-40 space-y-1 overflow-auto">
                {response.headers.map(([name, value]) => (
                  <div key={name} className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                    <span className="w-40 shrink-0 truncate font-mono-j text-[10px] text-cyan-j">{name}</span>
                    <span className="min-w-0 flex-1 break-all font-mono-j text-[10px] text-muted-foreground">{value}</span>
                  </div>
                ))}
                {!response.headers.length && <span className="text-[11px] text-muted-foreground">No readable headers (often due to CORS restrictions).</span>}
              </div>
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Status" value={`${response.status}`} mono />
            <Stat label="Time" value={`${Math.round(response.elapsed)} ms`} mono />
            <Stat label="Size" value={`${(response.size / 1024).toFixed(1)} KB`} mono />
            <Stat label="Content type" value={response.contentType.split(';')[0]} mono />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Response body</div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{response.pretty.slice(0, 20000) || '(empty body)'}</pre>
          </Panel>
        </>
      )}

      {!!history.length && (
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Recent requests this session</span>
            <button type="button" onClick={() => setHistory([])} className="text-[11px] text-muted-foreground transition hover:text-rose-400">Clear</button>
          </div>
          <div className="space-y-1">
            {history.map((entry, index) => (
              <div key={`${entry.at}-${index}`} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span className="font-mono-j text-cyan-j">{entry.method}</span>
                <span className="flex-1 truncate font-mono-j text-muted-foreground">{entry.url}</span>
                <span className={`font-mono-j ${entry.status >= 400 || entry.status === 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{entry.status || 'failed'}</span>
                <span className="font-mono-j text-muted-foreground">{Math.round(entry.elapsed)} ms</span>
                <button type="button" onClick={() => { setMethod(entry.method); setUrl(entry.url); }} className="text-[10px] text-cyan-j">load</button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel className="border-amber-500/30">
        <p className="text-[11px] text-amber-500">
          Requests run from your own browser, so a server that does not allow browser origins will refuse the call even when the endpoint is perfectly
          healthy — that is a CORS response, not a broken API. Anything you paste here (including tokens) stays in this page and is sent only to the URL
          you enter.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Handy when you want to check a status code before writing code, compare a response with documentation, or see how long an endpoint really
          takes without opening a terminal. The timing shown is total round trip, and the size is the byte length of the body as received.
        </p>
      </Panel>
    </ToolShell>
  );
}