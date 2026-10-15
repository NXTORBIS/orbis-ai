import { useMemo, useState } from 'react';
import { Link2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Area, Out, CopyBtn, Panel, Stat, ToggleRow } from './shared';
import ToolShell from './kit/ToolShell';

const SAMPLE = 'https://mark37.base44.app/tools?tab=toolkit&ref=home&utm_source=app#top';

const TRACKING = /^(utm_[a-z]+|ref|fbclid|gclid|mc_cid|mc_eid|igshid|si)$/i;

const parseParams = (value) => {
  try {
    const url = new URL(value);
    return [...url.searchParams.entries()].map(([k, v]) => ({ k, v }));
  } catch {
    return [];
  }
};

export default function UrlParser() {
  const [raw, setRaw] = useState(SAMPLE);
  const [params, setParams] = useState(() => parseParams(SAMPLE));
  const [showDecoded, setShowDecoded] = useState(true);
  const [sortParams, setSortParams] = useState(false);
  const [stripTracking, setStripTracking] = useState(false);

  const info = useMemo(() => {
    try {
      const url = new URL(raw);
      return {
        ok: true,
        url,
        rows: [
          ['Protocol', url.protocol.replace(':', '')],
          ['Host', url.hostname],
          ['Port', url.port || '(default)'],
          ['Path', url.pathname],
          ['Hash', url.hash || '—'],
          ['Origin', url.origin],
          ['Credentials', url.username ? 'included' : 'none'],
          ['Segments', url.pathname.split('/').filter(Boolean).length ? url.pathname.split('/').filter(Boolean).join(' / ') : '—'],
        ],
      };
    } catch {
      return { ok: false };
    }
  }, [raw]);

  const rebuilt = useMemo(() => {
    if (!info.ok) return '';
    const url = new URL(raw);
    const cleaned = params.filter((p) => p.k && !(stripTracking && TRACKING.test(p.k)));
    const ordered = sortParams ? [...cleaned].sort((a, b) => a.k.localeCompare(b.k)) : cleaned;
    const search = ordered.map((p) => `${encodeURIComponent(p.k)}=${encodeURIComponent(p.v)}`).join('&');
    url.search = search ? `?${search}` : '';
    return url.toString();
  }, [info, params, raw, sortParams, stripTracking]);

  const update = (index, patch) => setParams((cur) => cur.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const display = (value) => {
    if (!showDecoded) return value;
    try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch { return value; }
  };

  return (
    <ToolShell
      toolId="url-parser"
      icon={Link2}
      title="URL Parser & Query Editor"
      desc="Break a link into its parts, edit the query parameters, and copy the rebuilt URL."
      state={{ raw, params, showDecoded, sortParams, stripTracking }}
      onRestore={(saved) => {
        setRaw(saved.raw); setParams(saved.params || []); setShowDecoded(saved.showDecoded ?? true);
        setSortParams(!!saved.sortParams); setStripTracking(!!saved.stripTracking);
      }}
      exportText={rebuilt}
      exportName="url.txt"
    >
      <Area value={raw} onChange={(value) => { setRaw(value); setParams(parseParams(value)); }} rows={3} mono placeholder="https://example.com/path?a=1" />
      {!info.ok && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">That is not a complete URL — include the protocol, for example https://example.com.</div>}
      {info.ok && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {info.rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
                <span className="truncate font-mono-j text-xs">{value}</span>
              </div>
            ))}
          </div>
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Query parameters · {params.length}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setParams((cur) => [...cur, { k: '', v: '' }])}><Plus className="h-3.5 w-3.5" /> Add</Button>
                <CopyBtn value={JSON.stringify(Object.fromEntries(params.filter((p) => p.k).map((p) => [p.k, p.v])), null, 2)} label="Copy JSON" />
              </div>
            </div>
            <div className="space-y-2">
              {params.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={p.k} onChange={(e) => update(i, { k: e.target.value })} placeholder="key" className="h-9 w-2/5 rounded-md border border-input bg-transparent px-2 font-mono-j text-xs" />
                  <input value={p.v} onChange={(e) => update(i, { v: e.target.value })} placeholder="value" className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 font-mono-j text-xs" />
                  <Button size="icon" variant="outline" onClick={() => setParams((cur) => cur.filter((_, idx) => idx !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
              {!params.length && <p className="py-2 text-sm text-muted-foreground">No query parameters on this URL yet.</p>}
            </div>
          </Panel>
          <div className="grid gap-2 sm:grid-cols-3">
            <ToggleRow label="Show decoded values" checked={showDecoded} onChange={setShowDecoded} hint="%20 → space" />
            <ToggleRow label="Sort parameters" checked={sortParams} onChange={setSortParams} hint="A → Z" />
            <ToggleRow label="Strip tracking" checked={stripTracking} onChange={setStripTracking} hint="utm_*, fbclid" />
          </div>
          <Out label="Rebuilt URL" value={rebuilt}>
            <div className="break-all font-mono-j text-xs text-cyan-j">{rebuilt}</div>
          </Out>
          {params.length > 0 && (
            <Panel>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Values as they would be read</div>
              <div className="space-y-1.5">
                {params.filter((p) => p.k).map((p, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-[11px]">
                    <span className="font-mono-j text-cyan-j">{p.k}</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="min-w-0 break-all font-mono-j">{display(p.v)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Parameters" value={String(params.length)} />
            <Stat label="URL length" value={`${rebuilt.length} chars`} />
            <Stat label="Encoded" value={rebuilt === raw ? 'unchanged' : 'rebuild differs'} />
          </div>
        </>
      )}
    </ToolShell>
  );
}