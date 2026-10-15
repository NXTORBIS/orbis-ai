import { useCallback, useEffect, useMemo, useState } from 'react';
import { HardDrive, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { Bars, Hero, Pills, Ring } from '../kit/premium';
import { Panel, Stat, ToggleRow, fmtBytes } from '../shared';

const readWebStorage = (store) => {
  let bytes = 0;
  let keys = 0;
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    const value = store.getItem(key) || '';
    bytes += new Blob([key]).size + new Blob([value]).size;
    keys += 1;
  }
  return { bytes, keys };
};

const AREAS = [
  ['localStorage', 'Small key-value store that survives closing the browser. Synchronous, so keep it small — 5 MB is the usual ceiling.'],
  ['sessionStorage', 'Same idea, cleared when the tab closes. Never used for anything that must last.'],
  ['IndexedDB', 'Structured records and blobs. Where an app keeps real data offline, and where a wipe of site data bites hardest.'],
  ['Cache Storage', 'Files saved by a service worker for offline use. The safest thing to clear, because it can be fetched again.'],
  ['Cookies', 'Small and sent with every request to the domain. Only a few kilobytes, but they are the oldest tracking mechanism there is.'],
];

export default function StorageAudit() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [countCaches, setCountCaches] = useState(false);
  const [persistGranted, setPersistGranted] = useState(null);

  const scan = useCallback(async (withCacheCount) => {
    setBusy(true);
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => null) : null;
    const idb = indexedDB.databases ? await indexedDB.databases().then((rows) => rows.map((row) => row.name).filter(Boolean)).catch(() => null) : null;
    let cacheNames = [];
    if (window.caches) cacheNames = await caches.keys().catch(() => []);
    let cacheEntries = null;
    if (withCacheCount && cacheNames.length) {
      cacheEntries = [];
      for (const name of cacheNames) {
        const cache = await caches.open(name).catch(() => null);
        const count = cache ? (await cache.keys()).length : null;
        cacheEntries.push({ name, count });
      }
    }
    setData({
      estimate,
      persisted,
      idb,
      caches: cacheNames,
      cacheEntries,
      local: readWebStorage(window.localStorage),
      session: readWebStorage(window.sessionStorage),
      cookieBytes: new Blob([document.cookie || '']).size,
      cookieCount: (document.cookie || '').split(';').filter((part) => part.trim()).length,
    });
    setBusy(false);
  }, []);

  useEffect(() => { scan(false); }, [scan]);

  const requestPersistence = async () => {
    if (!navigator.storage?.persist) return;
    const granted = await navigator.storage.persist().catch(() => false);
    setPersistGranted(granted);
    scan(countCaches);
  };

  const usage = data?.estimate?.usage ?? null;
  const quota = data?.estimate?.quota ?? null;
  const detail = data?.estimate?.usageDetails || null;
  const pressure = usage != null && quota ? (usage / quota) * 100 : null;
  const knownBytes = data ? data.local.bytes + data.session.bytes + data.cookieBytes : 0;

  const bars = useMemo(() => {
    if (!data) return [];
    const rows = [];
    if (detail) {
      if (detail.indexedDB) rows.push({ label: 'IndexedDB', value: detail.indexedDB });
      if (detail.caches) rows.push({ label: 'Caches', value: detail.caches });
      if (detail.serviceWorkerRegistrations) rows.push({ label: 'Workers', value: detail.serviceWorkerRegistrations });
      if (detail.localStorage) rows.push({ label: 'Local', value: detail.localStorage });
    } else {
      rows.push({ label: 'Local', value: data.local.bytes });
      rows.push({ label: 'Session', value: data.session.bytes });
    }
    const accounted = rows.reduce((sum, row) => sum + row.value, 0);
    if (usage != null && usage > accounted) rows.push({ label: 'Other', value: usage - accounted });
    return rows.map((row) => ({ label: row.label, value: Math.max(1, Math.round(row.value / 1024)) }));
  }, [data, detail, usage]);

  const report = data ? [
    'Usage ' + (usage != null ? fmtBytes(usage) : 'unknown') + ' of a ' + (quota != null ? fmtBytes(quota) : 'unknown') + ' quota' + (pressure != null ? ' (' + pressure.toFixed(2) + '%)' : ''),
    'Storage marked persistent: ' + (data.persisted ? 'yes' : 'no'),
    'localStorage ' + fmtBytes(data.local.bytes) + ' in ' + data.local.keys + ' keys',
    'sessionStorage ' + fmtBytes(data.session.bytes) + ' in ' + data.session.keys + ' keys',
    'IndexedDB databases: ' + (data.idb ? (data.idb.length ? data.idb.join(', ') : 'none') : 'not listed by this browser'),
    'Cache Storage buckets: ' + (data.caches.length ? data.caches.join(', ') : 'none'),
    'Cookies ' + data.cookieCount + ' (' + fmtBytes(data.cookieBytes) + ')',
    'Cookies enabled: ' + navigator.cookieEnabled,
  ].join('\n') : '';

  return (
    <ToolShell
      toolId="storage-audit"
      icon={HardDrive}
      title="Storage & Quota Audit"
      desc="How much of this origin’s quota is in use, what each storage area actually holds, whether the browser is allowed to evict it, and what to clear first."
      exportText={report}
      exportName="storage-audit.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => scan(countCaches)} disabled={busy} className="gap-1.5">
          <RefreshCw className={busy ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> {busy ? 'Scanning…' : 'Scan again'}
        </Button>
        <span className="text-[11px] text-muted-foreground">Nothing is written or deleted here — this only reads what already exists.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.3fr]">
        <Hero
          label="Quota used"
          value={usage != null ? fmtBytes(usage).split(' ')[0] : '—'}
          unit={usage != null ? fmtBytes(usage).split(' ')[1] : ''}
          sub={quota != null ? 'of ' + fmtBytes(quota) + ' available to this origin' : 'this browser does not report a quota'}
          tone={pressure != null && pressure > 80 ? 'rose' : pressure != null && pressure > 50 ? 'amber' : 'cyan'}
        />
        <Ring
          value={pressure ?? 0}
          max={100}
          tone={pressure != null && pressure > 80 ? 'rose' : 'cyan'}
          label="Of the quota"
          sub={pressure != null ? pressure.toFixed(2) + '% used — eviction starts to matter when this is high on a full disk' : 'unknown'}
        />
        <div className="grid grid-cols-2 gap-2">
          <Stat label="localStorage" value={data ? fmtBytes(data.local.bytes) : '—'} mono sub={data ? data.local.keys + ' keys' : ''} />
          <Stat label="sessionStorage" value={data ? fmtBytes(data.session.bytes) : '—'} mono sub={data ? data.session.keys + ' keys' : ''} />
          <Stat label="Cookies" value={data ? data.cookieCount + ' set' : '—'} mono sub={data ? fmtBytes(data.cookieBytes) : ''} />
          <Stat label="Persistent" value={data?.persisted ? 'granted' : 'not granted'} mono sub="whether eviction is allowed" />
        </div>
      </div>

      {bars.length > 1 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the bytes are, in kilobytes</div>
          <Bars data={bars} format={(value) => value >= 1024 ? (value / 1024).toFixed(1) + ' MB' : value + ' KB'} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The breakdown comes from the browser’s own accounting, and only Chromium reports it. Firefox and Safari give a total without the detail, so anything unaccounted
            shows as other.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What is on this origin</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Total usage</span><span>{usage != null ? fmtBytes(usage) : 'not reported'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Quota</span><span>{quota != null ? fmtBytes(quota) : 'not reported'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Tracked directly</span><span>{fmtBytes(knownBytes)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">IndexedDB</span><span>{data?.idb ? (data.idb.length ? data.idb.join(', ') : 'none') : 'not listable here'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Cache buckets</span><span>{data?.caches?.length ?? 0}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Cookies enabled</span><span>{String(navigator.cookieEnabled)}</span></div>
          </div>
          {data?.caches?.length > 0 && (
            <div className="mt-2">
              <ToggleRow label="Count entries in each cache" checked={countCaches} onChange={(value) => { setCountCaches(value); scan(value); }} hint="opens every cache bucket" />
            </div>
          )}
          {data?.cacheEntries?.length > 0 && (
            <div className="mt-2 space-y-1 font-mono-j text-[11px]">
              {data.cacheEntries.map((row) => (
                <div key={row.name} className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="max-w-[70%] truncate text-muted-foreground">{row.name}</span>
                  <span>{row.count != null ? row.count + ' entries' : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="!p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="h-3.5 w-3.5 text-cyan-j" /> Eviction and persistence</div>
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              {data?.persisted
                ? 'This origin is marked persistent. The browser will not clear it to free space without asking, which is what makes offline data and long-lived app state reliable.'
                : 'This origin is not persistent: under disk pressure the browser may clear everything it stores here without warning. That takes saved records with it.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={requestPersistence} disabled={!navigator.storage?.persist}>Ask for persistence</Button>
              {persistGranted !== null && (
                <span className={persistGranted ? 'text-[11px] text-emerald-400' : 'text-[11px] text-amber-400'}>
                  {persistGranted ? 'Granted — this origin will not be evicted.' : 'Refused. Browsers decide by engagement: bookmarking or installing the app usually tips it.'}
                </span>
              )}
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· Private windows get a small, temporary quota and throw everything away when the last private tab closes.</p>
              <p>· Safari clears script-writable storage after about seven days of not visiting the site, unless it is installed to the home screen.</p>
              <p>· Quota is a fraction of free disk space, shared across every site. A nearly full disk shrinks everyone’s allowance.</p>
              <p>· When the quota is reached, writes fail with a quota error rather than silently trimming your data — an app that ignores that error loses the record.</p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What each area is for</div>
        <div className="space-y-1.5">
          {AREAS.map(([name, note]) => (
            <div key={name} className="border-b border-border/40 pb-1.5 text-[11px] last:border-0">
              <span className="text-cyan-j">{name}</span>
              <span className="text-muted-foreground"> — {note}</span>
            </div>
          ))}
        </div>
        {!navigator.storage?.estimate && (
          <p className="mt-2 text-[11px] text-amber-400">This browser does not implement the Storage Manager API, so usage and quota cannot be read here at all.</p>
        )}
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Pills
          items={[
            { label: 'Usage', value: usage != null ? fmtBytes(usage) : 'unknown' },
            { label: 'Quota', value: quota != null ? fmtBytes(quota) : 'unknown' },
            { label: 'Persistent', value: data?.persisted ? 'yes' : 'no' },
          ]}
        />
      </div>
    </ToolShell>
  );
}