import { useEffect, useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat } from './shared';

const CITIES = [
  { city: 'New Delhi', zone: 'Asia/Kolkata' },
  { city: 'Mumbai', zone: 'Asia/Kolkata' },
  { city: 'Dubai', zone: 'Asia/Dubai' },
  { city: 'Singapore', zone: 'Asia/Singapore' },
  { city: 'Hong Kong', zone: 'Asia/Hong_Kong' },
  { city: 'Shanghai', zone: 'Asia/Shanghai' },
  { city: 'Tokyo', zone: 'Asia/Tokyo' },
  { city: 'Seoul', zone: 'Asia/Seoul' },
  { city: 'Bangkok', zone: 'Asia/Bangkok' },
  { city: 'Jakarta', zone: 'Asia/Jakarta' },
  { city: 'Karachi', zone: 'Asia/Karachi' },
  { city: 'Dhaka', zone: 'Asia/Dhaka' },
  { city: 'Kathmandu', zone: 'Asia/Kathmandu' },
  { city: 'Colombo', zone: 'Asia/Colombo' },
  { city: 'Tehran', zone: 'Asia/Tehran' },
  { city: 'Istanbul', zone: 'Europe/Istanbul' },
  { city: 'Moscow', zone: 'Europe/Moscow' },
  { city: 'Athens', zone: 'Europe/Athens' },
  { city: 'Berlin', zone: 'Europe/Berlin' },
  { city: 'Paris', zone: 'Europe/Paris' },
  { city: 'Madrid', zone: 'Europe/Madrid' },
  { city: 'Rome', zone: 'Europe/Rome' },
  { city: 'Amsterdam', zone: 'Europe/Amsterdam' },
  { city: 'Zurich', zone: 'Europe/Zurich' },
  { city: 'Stockholm', zone: 'Europe/Stockholm' },
  { city: 'London', zone: 'Europe/London' },
  { city: 'Dublin', zone: 'Europe/Dublin' },
  { city: 'Lisbon', zone: 'Europe/Lisbon' },
  { city: 'Reykjavik', zone: 'Atlantic/Reykjavik' },
  { city: 'New York', zone: 'America/New_York' },
  { city: 'Toronto', zone: 'America/Toronto' },
  { city: 'Chicago', zone: 'America/Chicago' },
  { city: 'Denver', zone: 'America/Denver' },
  { city: 'Los Angeles', zone: 'America/Los_Angeles' },
  { city: 'Vancouver', zone: 'America/Vancouver' },
  { city: 'Mexico City', zone: 'America/Mexico_City' },
  { city: 'Bogotá', zone: 'America/Bogota' },
  { city: 'Lima', zone: 'America/Lima' },
  { city: 'São Paulo', zone: 'America/Sao_Paulo' },
  { city: 'Buenos Aires', zone: 'America/Argentina/Buenos_Aires' },
  { city: 'Cairo', zone: 'Africa/Cairo' },
  { city: 'Lagos', zone: 'Africa/Lagos' },
  { city: 'Nairobi', zone: 'Africa/Nairobi' },
  { city: 'Johannesburg', zone: 'Africa/Johannesburg' },
  { city: 'Sydney', zone: 'Australia/Sydney' },
  { city: 'Melbourne', zone: 'Australia/Melbourne' },
  { city: 'Perth', zone: 'Australia/Perth' },
  { city: 'Auckland', zone: 'Pacific/Auckland' },
  { city: 'Honolulu', zone: 'Pacific/Honolulu' },
  { city: 'UTC', zone: 'UTC' },
];

const parts = (zone, date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: zone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  weekday: 'short', day: '2-digit', month: 'short',
}).formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});

const offsetMinutes = (zone, date) => {
  const p = parts(zone, date);
  const asUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), Number(p.hour === '24' ? 0 : p.hour), Number(p.minute), Number(p.second));
  const base = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
  return Math.round((asUTC - base) / 60000);
};

const shiftLabel = (minutes) => {
  if (minutes === 0) return 'same as yours';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : 'h'}`;
};

export default function WorldClock() {
  const [zones, setZones] = useState(['Asia/Kolkata', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney']);
  const [query, setQuery] = useState('');
  const [clock, setClock] = useState('24');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const localZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const localOffset = offsetMinutes(localZone, now);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return CITIES.filter((c) => c.city.toLowerCase().includes(q) && !zones.includes(c.zone)).slice(0, 8);
  }, [query, zones]);

  const timeFor = (zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour12: clock === '12', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);

  const add = (zone) => { setZones((list) => [...list, zone]); setQuery(''); };
  const remove = (zone) => setZones((list) => list.filter((z) => z !== zone));

  const report = zones.map((zone) => {
    const city = CITIES.find((c) => c.zone === zone)?.city || zone;
    return `${city}: ${timeFor(zone)} (${shiftLabel(offsetMinutes(zone, now) - localOffset)} vs ${localZone})`;
  }).join('\n');

  return (
    <ToolShell
      toolId="world-clock"
      icon={Globe}
      title="World Clock"
      desc="Your cities side by side, ticking live, with how far ahead or behind each one is."
      state={{ zones, clock }}
      onRestore={(saved) => {
        if (Array.isArray(saved.zones) && saved.zones.length) setZones(saved.zones);
        if (saved.clock) setClock(saved.clock);
      }}
      exportText={report}
      exportName="world-clock.txt"
    >
      <Field label="Add a city">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search over 50 cities…"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        />
      </Field>

      {!!matches.length && (
        <Panel className="!p-2">
          <div className="space-y-1">
            {matches.map((c) => (
              <button
                key={c.zone}
                type="button"
                onClick={() => add(c.zone)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-cyan-j/10"
              >
                <span>{c.city}</span>
                <span className="font-mono-j text-[11px] text-muted-foreground">{timeFor(c.zone)}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      <div className="space-y-2">
        {zones.map((zone) => {
          const info = CITIES.find((c) => c.zone === zone);
          const dateParts = parts(zone, now);
          const hour = Number(dateParts.hour === '24' ? 0 : dateParts.hour);
          const day = hour >= 6 && hour < 18;
          const diff = offsetMinutes(zone, now) - localOffset;
          const isLocal = zone === localZone;
          return (
            <Panel key={zone} className="flex items-center gap-3 !py-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ${day ? 'bg-amber-400/15 text-amber-400' : 'bg-indigo-400/15 text-indigo-300'}`}>
                {day ? '☀' : '☾'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{info ? info.city : zone}</span>
                  {isLocal && <span className="rounded-md bg-cyan-j/15 px-1.5 py-0.5 text-[10px] text-cyan-j">local</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {dateParts.weekday} {dateParts.day} {dateParts.month} · {shiftLabel(diff)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono-j text-lg font-semibold tabular-nums">{timeFor(zone)}</div>
                <button type="button" onClick={() => remove(zone)} className="text-[10px] text-muted-foreground transition hover:text-red-500">
                  remove
                </button>
              </div>
            </Panel>
          );
        })}
        {!zones.length && <p className="py-6 text-center text-[11px] text-muted-foreground">Search above to add a city.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Seg value={clock} onChange={setClock} options={[{ value: '24', label: '24-hour' }, { value: '12', label: '12-hour' }]} />
        <button
          type="button"
          onClick={() => setZones(['Asia/Kolkata', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney'])}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
        >
          Reset cities
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Cities" value={String(zones.length)} />
        <Stat label="Your zone" value={localZone.split('/').pop().replace(/_/g, ' ')} />
        <Stat label="Your UTC offset" value={shiftLabel(localOffset)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Times come from your browser's own time-zone data, so daylight-saving changes are handled automatically — a city can shift by an hour without
          you touching anything. The sun and moon show whether it is currently daytime there.
        </p>
      </Panel>
    </ToolShell>
  );
}