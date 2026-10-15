import { useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { Pills } from '../kit/premium';
import { Field, Panel, Stat } from '../shared';
import { hostOf, isIp, reverseName } from './netUtils';

const lookupPtr = async (ip) => {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(reverseName(ip))}&type=PTR`, {
      headers: { accept: 'application/dns-json' },
    });
    const json = await res.json();
    return (json.Answer || []).map((a) => a.data).filter(Boolean);
  } catch {
    return [];
  }
};

export default function GeoPanel({ onReport }) {
  const [ip, setIp] = useState('');
  const [data, setData] = useState(null);
  const [ptr, setPtr] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lookup = async () => {
    const value = hostOf(ip);
    if (value && !isIp(value)) {
      setError('Enter a single IPv4 address, or leave it blank to look up your own.');
      return;
    }
    setLoading(true);
    setError('');
    setData(null);
    setPtr([]);
    try {
      const res = await fetch(`https://ipwho.is/${value}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'That address could not be looked up.');
      setData(json);
      const names = await lookupPtr(json.ip);
      setPtr(names);
      onReport?.(
        `${json.ip} — ${[json.city, json.region, json.country].filter(Boolean).join(', ')}\nNetwork ${json.connection?.org || json.connection?.isp || '—'} · AS${json.connection?.asn || '—'}\nTimezone ${json.timezone?.id || '—'} (UTC${json.timezone?.utc || ''})\nReverse DNS ${names.join(', ') || 'none published'}`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="IPv4 address" hint="Leave blank for your own public IP">
          <input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && lookup()}
            spellCheck={false}
            placeholder="8.8.8.8"
            className="h-9 w-56 rounded-md border border-input bg-transparent px-3 font-mono-j text-xs"
          />
        </Field>
        <button
          type="button"
          onClick={lookup}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          <Search className="h-3.5 w-3.5" /> {loading ? 'Looking up…' : 'Look up'}
        </button>
      </div>

      {error && <Panel className="border-amber-500/30 text-[11px] text-amber-500">{error}</Panel>}

      {data && (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="IP" value={data.ip} mono />
            <Stat label="Network (ASN)" value={data.connection?.asn ? `AS${data.connection.asn}` : '—'} mono />
            <Stat label="Owned by" value={data.connection?.org || data.connection?.isp || '—'} />
            <Stat label="Connection type" value={data.type || '—'} />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium">
              <MapPin className="h-3.5 w-3.5 text-cyan-j" /> Where it sits
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="Country" value={`${data.country || '—'}${data.country_code ? ` (${data.country_code})` : ''}`} />
              <Stat label="Region" value={data.region || '—'} />
              <Stat label="City" value={data.city || '—'} />
              <Stat label="Coordinates" value={data.latitude != null ? `${data.latitude}, ${data.longitude}` : '—'} mono />
              <Stat label="Timezone" value={data.timezone?.id || '—'} sub={data.timezone?.utc ? `UTC${data.timezone.utc}` : ''} />
              <Stat label="Reverse DNS" value={ptr[0] || 'none published'} sub={ptr.length > 1 ? `+${ptr.length - 1} more` : ''} mono />
            </div>
            <div className="mt-2">
              <Pills
                items={[
                  { label: 'continent', value: data.continent || '—' },
                  { label: 'EU member', value: data.is_eu ? 'yes' : 'no' },
                  { label: 'registry domain', value: data.connection?.domain || '—' },
                ]}
              />
            </div>
          </Panel>
        </>
      )}

      <Panel className="border-amber-500/30">
        <p className="text-[11px] text-amber-500">
          Location here is the registered location of the network, not your device — a VPN or a mobile carrier gateway usually shows a different
          city, which is exactly how you tell that a VPN is on. Reverse DNS (PTR) is the name the network publishes for that address, and a
          consumer line with no PTR at all is normal. A browser cannot see which resolver answered your DNS lookups, so a true DNS-leak test needs
          a tool that can run outside the browser.
        </p>
      </Panel>
    </>
  );
}