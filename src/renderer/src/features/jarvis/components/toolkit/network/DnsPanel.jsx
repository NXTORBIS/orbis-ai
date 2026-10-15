import { useState } from 'react';
import { Search } from 'lucide-react';
import { Pills } from '../kit/premium';
import { CopyBtn, Field, Panel } from '../shared';
import { hostOf, isIp, reverseName } from './netUtils';

const RESOLVERS = [
  { id: 'cloudflare', label: 'Cloudflare · 1.1.1.1', url: 'https://cloudflare-dns.com/dns-query' },
  { id: 'google', label: 'Google · 8.8.8.8', url: 'https://dns.google/resolve' },
];

const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'PTR'];

const TYPE_NAMES = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 257: 'CAA' };

const ask = async (resolver, name, type) => {
  const started = performance.now();
  try {
    const res = await fetch(`${resolver.url}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
    const json = await res.json();
    const answers = (json.Answer || []).map((a) => ({ name: a.name, type: TYPE_NAMES[a.type] || `T${a.type}`, data: a.data, ttl: a.TTL }));
    return { id: resolver.id, label: resolver.label, ok: true, status: json.Status, answers, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { id: resolver.id, label: resolver.label, ok: false, answers: [], ms: Math.round(performance.now() - started), error: err.message };
  }
};

export default function DnsPanel({ onReport }) {
  const [name, setName] = useState('mark37.base44.app');
  const [type, setType] = useState('A');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    const raw = name.trim();
    if (!raw) return;
    const query = type === 'PTR' && isIp(raw) ? reverseName(raw) : hostOf(raw);
    setLoading(true);
    setResults([]);
    const found = await Promise.all(RESOLVERS.map((resolver) => ask(resolver, query, type)));
    setResults(found);
    setLoading(false);

    const first = found[0]?.answers?.map((a) => a.data).sort().join(' | ') || '';
    const second = found[1]?.answers?.map((a) => a.data).sort().join(' | ') || '';
    onReport?.(
      `DNS ${type} ${query}\n${found.map((r) => `${r.label}: ${r.ok ? (r.answers.map((a) => a.data).join(', ') || 'no answer') : `unreachable (${r.error})`}`).join('\n')}\n${first && second && first === second ? 'Both resolvers agree.' : 'Answers differ or one resolver did not answer.'}`,
    );
  };

  const answered = results.filter((r) => r.answers?.length);
  const signatures = results.map((r) => r.answers?.map((a) => a.data).sort().join('|') || (r.ok ? 'none' : 'unreachable'));
  const agree = results.length > 1 && signatures.every((s) => s === signatures[0]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Domain or IP">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && lookup()}
            spellCheck={false}
            placeholder="example.com"
            className="h-9 w-64 rounded-md border border-input bg-transparent px-3 font-mono-j text-xs"
          />
        </Field>
        <Field label="Record">
          <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono-j text-xs">
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <button
          type="button"
          onClick={lookup}
          disabled={loading || !name.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          <Search className="h-3.5 w-3.5" /> {loading ? 'Querying…' : 'Query both resolvers'}
        </button>
      </div>

      {!!results.length && (
        <div className="grid gap-3 sm:grid-cols-2">
          {results.map((r) => (
            <Panel key={r.id} className="!p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{r.label}</span>
                <span className="font-mono-j text-[10px] text-muted-foreground">{r.ms} ms</span>
              </div>
              {!r.ok ? (
                <p className="text-[11px] text-amber-500">This resolver could not be reached from your browser ({r.error}).</p>
              ) : r.answers.length ? (
                <div className="space-y-1">
                  {r.answers.map((a, i) => (
                    <div key={`${a.data}-${i}`} className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                      <span className="shrink-0 font-mono-j text-[10px] text-cyan-j">{a.type}</span>
                      <span className="min-w-0 flex-1 break-all font-mono-j text-[10px]">{a.data}</span>
                      <span className="shrink-0 font-mono-j text-[10px] text-muted-foreground">TTL {a.ttl}s</span>
                      <CopyBtn value={a.data} label="" size="sm" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  No {type} records. {r.status === 3 ? 'The domain does not exist (NXDOMAIN).' : 'The name resolves to nothing for this type.'}
                </p>
              )}
            </Panel>
          ))}
        </div>
      )}

      {!!answered.length && (
        <Pills
          items={[
            { label: 'answers', value: answered.reduce((n, r) => n + r.answers.length, 0) },
            { label: 'agreement', value: agree ? 'both resolvers match' : 'resolvers differ' },
          ]}
        />
      )}

      <Panel className="border-amber-500/30">
        <p className="text-[11px] text-amber-500">
          Two independent public resolvers are queried over DNS-over-HTTPS, which is a real check that a record exists in the public DNS and
          that the two biggest caches agree. It is not a worldwide propagation sample: sampling every resolver on earth needs services a
          browser cannot reach, and a record that matches here is already live for everyone.
        </p>
      </Panel>
    </>
  );
}