import { useState } from 'react';
import { Activity, Info } from 'lucide-react';
import ToolShell from '../kit/ToolShell';
import { Field, Panel, Seg } from '../shared';
import { hostOf } from './netUtils';
import PingPanel from './PingPanel';
import BufferbloatPanel from './BufferbloatPanel';
import DnsPanel from './DnsPanel';
import WebSocketPanel from './WebSocketPanel';
import BenchPanel from './BenchPanel';
import GeoPanel from './GeoPanel';
import DomainPanel from './DomainPanel';
import HeadersPanel from './HeadersPanel';

const TABS = [
  { id: 'ping', label: 'Ping & jitter' },
  { id: 'bufferbloat', label: 'Bufferbloat' },
  { id: 'dns', label: 'DNS & PTR' },
  { id: 'headers', label: 'Headers & redirects' },
  { id: 'domain', label: 'Domain & SSL' },
  { id: 'bench', label: 'Latency bench' },
  { id: 'socket', label: 'WebSocket' },
  { id: 'ip', label: 'IP & ASN' },
];

const PRESETS = ['mark37.base44.app', 'cloudflare.com', 'github.com', '1.1.1.1'];

const UNAVAILABLE = [
  ['Traceroute', 'It needs to send packets with a rising time-to-live and read the replies. Browsers have no such API, and no browser feature can be bent into one.'],
  ['MTU / packet-size finder', 'Finding the largest packet a route passes means sending oversized packets and reading ICMP "too big" replies — neither is possible from a page.'],
  ['LAN host discovery', 'Scanning your local network requires opening sockets to arbitrary private addresses, which is exactly what a browser sandbox forbids.'],
  ['Port range scanning', 'A browser can only make web requests, and a private or unusual port will simply be blocked. The single-port check in the toolkit covers the part that is reachable.'],
];

export default function ConnectionDoctor() {
  const [tab, setTab] = useState('ping');
  const [target, setTarget] = useState('mark37.base44.app');
  const [report, setReport] = useState('');

  const shared = { target, setTarget, onReport: setReport };

  return (
    <ToolShell
      toolId="connection-doctor"
      icon={Activity}
      title="Connection Doctor"
      desc="Real measurements of your path to any host: latency and jitter, bufferbloat under load, DNS answers, TLS and header health, API timings and sockets."
      state={{ tab, target }}
      onRestore={(restored) => {
        if (typeof restored.tab === 'string') setTab(restored.tab);
        if (typeof restored.target === 'string') setTarget(restored.target);
      }}
      exportText={report ? `Connection Doctor — ${hostOf(target)}\n\n${report}` : `Connection Doctor — no measurement has been run yet.`}
      exportName="connection-doctor.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="The host everything below measures" hint="A domain, an address, or a full URL">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            spellCheck={false}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs"
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setTarget(preset)}
              className="rounded-lg border border-border/70 bg-card/50 px-2.5 py-1.5 font-mono-j text-[10px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      <Seg value={tab} onChange={setTab} options={TABS} />

      <div className="space-y-3">
        {tab === 'ping' && <PingPanel {...shared} />}
        {tab === 'bufferbloat' && <BufferbloatPanel {...shared} />}
        {tab === 'dns' && <DnsPanel {...shared} />}
        {tab === 'headers' && <HeadersPanel {...shared} />}
        {tab === 'domain' && <DomainPanel {...shared} />}
        {tab === 'bench' && <BenchPanel {...shared} />}
        {tab === 'socket' && <WebSocketPanel {...shared} />}
        {tab === 'ip' && <GeoPanel {...shared} />}
      </div>

      <Panel>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium">
          <Info className="h-3.5 w-3.5 text-cyan-j" /> Four network tests a browser honestly cannot do
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {UNAVAILABLE.map(([title, why]) => (
            <div key={title} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
              <div className="text-[11px] font-medium text-amber-400">{title}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{why}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          They are listed here rather than faked: a traceroute drawn from guesses is worse than no traceroute. Everything above this panel is a
          real reading taken from your device or from the target's own servers.
        </p>
      </Panel>
    </ToolShell>
  );
}