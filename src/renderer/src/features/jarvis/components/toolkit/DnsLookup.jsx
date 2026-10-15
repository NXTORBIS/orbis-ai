import { useState } from 'react';
import { Globe, Search } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, CopyBtn, Unsupported } from './shared';

const DOH = 'https://cloudflare-dns.com/dns-query';
const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA'];

export default function DnsLookup() {
  const [domain, setDomain] = useState('');
  const [type, setType] = useState('A');
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const lookup = async () => {
    const d = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!d) return;
    setLoading(true); setErr(null); setRecords(null);
    try {
      const res = await fetch(`${DOH}?name=${encodeURIComponent(d)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
      if (!res.ok) throw new Error(`DNS query failed (${res.status})`);
      const json = await res.json();
      setRecords(json.Answer || json.Authority || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Globe} title="DNS Lookup" desc="Query DNS records (A, AAAA, CNAME, MX, TXT, NS, SOA) via DNS-over-HTTPS." />
      <div className="flex flex-wrap gap-2">
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" className="max-w-xs" onKeyDown={(e) => e.key === 'Enter' && lookup()} />
        <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button size="sm" onClick={lookup} disabled={loading} className="gap-1.5"><Search className="h-4 w-4" /> {loading ? 'Querying…' : 'Lookup'}</Button>
      </div>
      {err && <Unsupported msg={err} />}
      {records && (
        <div className="space-y-1">
          {records.length === 0 ? <div className="text-sm text-muted-foreground">No records found.</div> :
            records.map((r, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border border-border/60 bg-card/40 px-3 py-2">
                <div className="min-w-0">
                  <span className="mr-2 text-[10px] font-bold text-cyan-j">{r.type === 1 ? 'A' : r.type === 28 ? 'AAAA' : r.type === 5 ? 'CNAME' : r.type === 15 ? 'MX' : r.type === 16 ? 'TXT' : r.type === 2 ? 'NS' : r.type === 6 ? 'SOA' : `T${r.type}`}</span>
                  <span className="break-all font-mono-j text-xs">{r.data}</span>
                </div>
                <CopyBtn value={r.data} label="" size="sm" />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}