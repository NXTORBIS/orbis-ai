import { useState } from 'react';
import { Plug } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Stat, Unsupported } from './shared';

export default function PortChecker() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    const h = host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const p = parseInt(port, 10);
    if (!h || !p) return;
    setLoading(true); setResult(null);
    const start = performance.now();
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 5000);
    try {
      const url = `${location.protocol}//${h}:${p}/`;
      await fetch(url, { mode: 'no-cors', signal: controller.signal, cache: 'no-store' });
      const elapsed = Math.round(performance.now() - start);
      setResult({ open: true, ms: elapsed });
    } catch (e) {
      const elapsed = Math.round(performance.now() - start);
      setResult({ open: e.name === 'AbortError' ? 'timeout' : 'blocked', ms: elapsed });
    } finally { clearTimeout(to); setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Plug} title="Port Checker" desc="Probes whether a host:port responds. Browsers cannot open raw TCP sockets — this uses a fetch probe, which has real limitations." />
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Host</span>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" className="w-44" />
        </label>
        <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Port</span>
          <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="443" className="w-24" />
        </label>
        <Button size="sm" onClick={check} disabled={loading} className="mb-0.5">{loading ? 'Checking…' : 'Check'}</Button>
      </div>
      {result && (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Status" value={result.open === true ? 'Open / responding' : result.open === 'timeout' ? 'Timeout' : 'Unreachable'} />
          <Stat label="Time" value={`${result.ms} ms`} mono />
        </div>
      )}
      <Unsupported msg="Browser limitation: raw TCP port scanning is impossible from a web page. This tool issues a fetch request and infers reachability from whether it connects or times out. CORS, firewalls and closed ports can all produce ambiguous results — treat the result as a hint, not a definitive scan." />
    </div>
  );
}