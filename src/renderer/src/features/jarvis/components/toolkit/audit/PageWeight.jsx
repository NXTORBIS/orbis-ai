import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChartColumn, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { Bars, Hero, Pills, Ring } from '../kit/premium';
import { Panel, Stat, fmtBytes } from '../shared';

const readLcp = () => new Promise((resolve) => {
  if (!('PerformanceObserver' in window)) { resolve(null); return; }
  let settled = false;
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length) {
        settled = true;
        resolve(entries[entries.length - 1].startTime);
        observer.disconnect();
      }
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    resolve(null);
    return;
  }
  setTimeout(() => {
    if (!settled) {
      try { observer.disconnect(); } catch { /* already gone */ }
      resolve(null);
    }
  }, 500);
});

const host = (url) => {
  try { return new URL(url).hostname; } catch { return 'inline'; }
};

export default function PageWeight() {
  const [data, setData] = useState(null);
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    const navigation = performance.getEntriesByType('navigation')[0] || null;
    const paints = performance.getEntriesByType('paint');
    const lcp = await readLcp();
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name.split('?')[0].split('/').pop() || entry.name,
      full: entry.name,
      host: host(entry.name),
      type: entry.initiatorType || 'other',
      transfer: entry.transferSize || 0,
      decoded: entry.decodedBodySize || 0,
      duration: entry.duration || 0,
      start: entry.startTime || 0,
      cached: (entry.transferSize || 0) === 0 && (entry.decodedBodySize || 0) > 0,
      opaque: (entry.transferSize || 0) === 0 && (entry.decodedBodySize || 0) === 0,
    }));
    setData({
      navigation,
      resources,
      fp: paints.find((paint) => paint.name === 'first-paint')?.startTime ?? null,
      fcp: paints.find((paint) => paint.name === 'first-contentful-paint')?.startTime ?? null,
      lcp,
      at: Date.now(),
    });
    setScanning(false);
  }, []);

  useEffect(() => { scan(); }, [scan]);

  const totals = useMemo(() => {
    if (!data) return null;
    const transfer = data.resources.reduce((sum, row) => sum + row.transfer, 0);
    const decoded = data.resources.reduce((sum, row) => sum + row.decoded, 0);
    const cached = data.resources.filter((row) => row.cached).length;
    const opaque = data.resources.filter((row) => row.opaque).length;
    const thirdParty = data.resources.filter((row) => row.host !== location.hostname && row.host !== 'inline');
    const span = Math.max(
      1,
      data.navigation?.loadEventEnd || 0,
      ...data.resources.map((row) => row.start + row.duration),
    );
    return {
      transfer,
      decoded,
      cached,
      opaque,
      thirdParty,
      span,
      count: data.resources.length,
      saving: decoded > transfer ? ((decoded - transfer) / decoded) * 100 : null,
    };
  }, [data]);

  const byType = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    data.resources.forEach((row) => {
      const size = row.transfer || row.decoded;
      map.set(row.type, (map.get(row.type) || 0) + size);
    });
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([type, bytes]) => ({ label: type === 'img' ? 'images' : type, value: Math.max(1, Math.round(bytes / 1024)) }));
  }, [data]);

  const heaviest = useMemo(() => (data ? [...data.resources].sort((a, b) => (b.transfer || b.decoded) - (a.transfer || a.decoded)).slice(0, 12) : []), [data]);
  const waterfall = useMemo(() => (data ? [...data.resources].sort((a, b) => a.start - b.start).slice(0, 14) : []), [data]);

  const thirdPartyRows = useMemo(() => {
    if (!data || !totals) return [];
    const map = new Map();
    totals.thirdParty.forEach((row) => {
      const current = map.get(row.host) || { host: row.host, count: 0, bytes: 0 };
      current.count += 1;
      current.bytes += row.transfer || row.decoded;
      map.set(row.host, current);
    });
    return [...map.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
  }, [data, totals]);

  const timings = useMemo(() => {
    if (!data?.navigation) return null;
    const nav = data.navigation;
    return [
      { label: 'Time to first byte', value: nav.responseStart ? nav.responseStart.toFixed(0) + ' ms' : '—', note: 'server thinking time' },
      { label: 'DOM ready', value: nav.domContentLoadedEventEnd ? nav.domContentLoadedEventEnd.toFixed(0) + ' ms' : '—', note: 'the page can be scripted' },
      { label: 'Load complete', value: nav.loadEventEnd ? nav.loadEventEnd.toFixed(0) + ' ms' : '—', note: 'every asset fetched' },
      { label: 'Protocol', value: nav.nextHopProtocol || 'unknown', note: 'h3 and h2 multiplex better than http/1.1' },
    ];
  }, [data]);

  const report = data && totals ? [
    'Requests ' + totals.count + ' · transferred ' + fmtBytes(totals.transfer) + ' · decoded ' + fmtBytes(totals.decoded),
    'Served from cache: ' + totals.cached + ' of ' + totals.count,
    'Third-party hosts: ' + totals.thirdParty.length,
    totals.saving ? 'Compression saved ' + totals.saving.toFixed(0) + '%' : '',
    '',
    'HEAVIEST',
    ...heaviest.map((row) => row.type + ' — ' + row.name + ' (' + fmtBytes(row.transfer || row.decoded) + ', ' + row.duration.toFixed(0) + ' ms)'),
    '',
    'TIMINGS',
    data.navigation ? 'TTFB ' + (data.navigation.responseStart || 0).toFixed(0) + ' ms · DOM ready ' + (data.navigation.domContentLoadedEventEnd || 0).toFixed(0) + ' ms · load ' + (data.navigation.loadEventEnd || 0).toFixed(0) + ' ms' : 'timings unavailable',
    'First paint ' + (data.fp != null ? data.fp.toFixed(0) + ' ms' : 'unknown') + ' · first contentful paint ' + (data.fcp != null ? data.fcp.toFixed(0) + ' ms' : 'unknown') + ' · largest contentful paint ' + (data.lcp != null ? data.lcp.toFixed(0) + ' ms' : 'not reported'),
  ].filter(Boolean).join('\n') : '';

  return (
    <ToolShell
      toolId="page-weight"
      icon={ChartColumn}
      title="Page Weight & Resource Audit"
      desc="What this page actually transferred — every request, its size, whether it came from cache, which host served it and how long it took — with the paint and load markers."
      exportText={report}
      exportName="page-weight.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={scan} disabled={scanning} className="gap-1.5">
          <RefreshCw className={scanning ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> {scanning ? 'Reading…' : 'Scan again'}
        </Button>
        <span className="text-[11px] text-muted-foreground">Read from this browser’s own timing buffer. It grows as you use the app, so a fresh load shows fewer requests than a long session.</span>
      </div>

      {!data && <Panel className="!p-3"><p className="text-[11px] text-muted-foreground">Reading resource timings…</p></Panel>}

      {data && totals && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.3fr]">
            <Hero
              label="Transferred"
              value={(totals.transfer / 1024).toFixed(totals.transfer > 1024 * 100 ? 0 : 1)}
              unit="KB"
              sub={totals.count + ' requests · ' + fmtBytes(totals.decoded) + ' once decompressed'}
              tone={totals.transfer > 3e6 ? 'rose' : totals.transfer > 1.5e6 ? 'amber' : 'cyan'}
            />
            <Ring
              value={totals.count ? (totals.cached / totals.count) * 100 : 0}
              max={100}
              tone="emerald"
              label="From cache"
              sub={totals.cached + ' of ' + totals.count + ' requests cost no bytes'}
            />
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Requests" value={String(totals.count)} mono sub={totals.opaque + ' cross-origin, size hidden'} />
              <Stat label="Third-party hosts" value={String(totals.thirdParty.length)} mono sub={totals.thirdParty.length ? 'data leaves your origin for these' : 'none — everything same-origin'} />
              <Stat label="Compression" value={totals.saving != null ? totals.saving.toFixed(0) + '% saved' : 'not measurable'} mono sub="decoded against transferred" />
              <Stat label="Largest contentful paint" value={data.lcp != null ? data.lcp.toFixed(0) + ' ms' : 'not reported'} mono sub={data.fcp != null ? 'first paint at ' + data.fcp.toFixed(0) + ' ms' : 'paint timing unavailable'} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">By resource type, in kilobytes</div>
              {byType.length ? (
                <Bars data={byType} format={(value) => value >= 1024 ? (value / 1024).toFixed(1) + ' MB' : value + ' KB'} />
              ) : (
                <p className="text-[11px] text-muted-foreground">No resources recorded yet.</p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Scripts dominate most web apps, and this one splits its code so only the pages you open are fetched. Fonts and images are usually the next largest, and both are
                easy to over-serve.
              </p>
            </Panel>

            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Page timings</div>
              <div className="space-y-1.5 font-mono-j text-[11px]">
                {timings?.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span>{row.value}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">First contentful paint</span>
                  <span>{data.fcp != null ? data.fcp.toFixed(0) + ' ms' : 'not reported'}</span>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Time to first byte is the server and the network. Everything after it is your bundle, your fonts and how much work happens before anything is painted. LCP is the
                moment the biggest visible element lands — the closest thing to “when the page felt ready”.
              </p>
            </Panel>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Heaviest requests</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left font-mono-j text-[11px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="py-1.5 font-normal">Resource</th>
                    <th className="py-1.5 font-normal">Type</th>
                    <th className="py-1.5 text-right font-normal">Transferred</th>
                    <th className="py-1.5 text-right font-normal">Decoded</th>
                    <th className="py-1.5 text-right font-normal">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {heaviest.map((row) => (
                    <tr key={row.full} className="border-b border-border/30 last:border-0">
                      <td className="max-w-[14rem] truncate py-1.5 pr-3" title={row.full}>{row.name}{row.cached ? <span className="ml-1.5 text-emerald-400">cache</span> : null}{row.opaque ? <span className="ml-1.5 text-muted-foreground">hidden</span> : null}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{row.type}</td>
                      <td className="py-1.5 text-right">{row.transfer ? fmtBytes(row.transfer) : '—'}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{row.decoded ? fmtBytes(row.decoded) : '—'}</td>
                      <td className="py-1.5 text-right">{row.duration.toFixed(0)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              A request marked hidden came from another origin without the header that permits size reporting — the browser withholds the byte count deliberately. A request
              marked cache was served from local storage and cost no network bytes at all.
            </p>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Request timeline</div>
            <div className="space-y-1">
              {waterfall.map((row) => (
                <div key={row.full} className="grid grid-cols-[8rem_1fr_4rem] items-center gap-2">
                  <span className="truncate font-mono-j text-[10px] text-muted-foreground" title={row.full}>{row.name}</span>
                  <div className="relative h-3 overflow-hidden rounded bg-card/50">
                    <div
                      className={row.cached ? 'absolute h-3 rounded bg-gradient-to-r from-emerald-500/60 to-emerald-400' : 'absolute h-3 rounded bg-gradient-to-r from-cyan-j/60 to-violet-400'}
                      style={{
                        left: Math.min(99, (row.start / totals.span) * 100) + '%',
                        width: Math.max(0.6, Math.min(100, (row.duration / totals.span) * 100)) + '%',
                      }}
                    />
                  </div>
                  <span className="text-right font-mono-j text-[10px] text-muted-foreground">{row.duration.toFixed(0)} ms</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Bars start where the request did and run for as long as it took. Requests bunched at the far left compete with each other for the same connection; a waterfall is
              also how you spot a chain where one request waits on another.
            </p>
          </Panel>

          {thirdPartyRows.length > 0 && (
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Third-party hosts this page talked to</div>
              <div className="space-y-1.5 font-mono-j text-[11px]">
                {thirdPartyRows.map((row) => (
                  <div key={row.host} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                    <span className="truncate text-muted-foreground">{row.host}</span>
                    <span>{row.count} request{row.count === 1 ? '' : 's'} · {row.bytes ? fmtBytes(row.bytes) : 'size hidden'}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Every third-party host is another party that sees your visitors and another place a page can fail. Each one is also a separate DNS lookup and connection if it is
                not already warm.
              </p>
            </Panel>
          )}

          <div className="grid gap-2 sm:grid-cols-4">
            <Pills
              items={[
                { label: 'Transferred', value: fmtBytes(totals.transfer) },
                { label: 'Requests', value: String(totals.count) },
                { label: 'Cached', value: totals.cached + '/' + totals.count },
                { label: 'Third-party', value: String(totals.thirdParty.length) },
              ]}
            />
          </div>

          <Panel>
            <p className="text-[11px] text-muted-foreground">
              This audit is limited by what the browser chooses to reveal. Sizes for cross-origin resources stay hidden unless the server sends a timing header, so a page can
              look lighter than it is. The buffer is also finite: older entries are dropped once it fills, which is why a long session reports fewer requests than the total
              fetched since load.
            </p>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}