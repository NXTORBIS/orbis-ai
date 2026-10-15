import React, { useMemo, useState } from 'react';
import { Hourglass } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat } from './shared';

const CITIES = [
  { city: 'New Delhi', zone: 'Asia/Kolkata' },
  { city: 'Dubai', zone: 'Asia/Dubai' },
  { city: 'London', zone: 'Europe/London' },
  { city: 'Berlin', zone: 'Europe/Berlin' },
  { city: 'Paris', zone: 'Europe/Paris' },
  { city: 'Moscow', zone: 'Europe/Moscow' },
  { city: 'New York', zone: 'America/New_York' },
  { city: 'Chicago', zone: 'America/Chicago' },
  { city: 'Denver', zone: 'America/Denver' },
  { city: 'Los Angeles', zone: 'America/Los_Angeles' },
  { city: 'Toronto', zone: 'America/Toronto' },
  { city: 'São Paulo', zone: 'America/Sao_Paulo' },
  { city: 'Singapore', zone: 'Asia/Singapore' },
  { city: 'Hong Kong', zone: 'Asia/Hong_Kong' },
  { city: 'Shanghai', zone: 'Asia/Shanghai' },
  { city: 'Tokyo', zone: 'Asia/Tokyo' },
  { city: 'Seoul', zone: 'Asia/Seoul' },
  { city: 'Sydney', zone: 'Australia/Sydney' },
  { city: 'Auckland', zone: 'Pacific/Auckland' },
  { city: 'Nairobi', zone: 'Africa/Nairobi' },
  { city: 'Cairo', zone: 'Africa/Cairo' },
  { city: 'UTC', zone: 'UTC' },
];

const hourIn = (zone, instant) => {
  const value = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour12: false, hour: '2-digit' }).format(instant);
  return Number(value === '24' ? 0 : value);
};

const bandFor = (hour) => {
  if (hour >= 9 && hour <= 17) return 'work';
  if (hour >= 6 && hour <= 8) return 'edge';
  if (hour >= 18 && hour <= 21) return 'edge';
  return 'asleep';
};

const BAND_STYLE = {
  work: 'bg-cyan-j/40',
  edge: 'bg-amber-400/35',
  asleep: 'bg-muted',
};

export default function MeetingPlanner() {
  const [zones, setZones] = useState(['Asia/Kolkata', 'Europe/London', 'America/New_York', 'Asia/Tokyo']);
  const [dayOffset, setDayOffset] = useState(0);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(18);
  const [picked, setPicked] = useState(null);

  const base = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
  }, [dayOffset]);

  const grid = useMemo(() => zones.map((zone) => ({
    zone,
    city: CITIES.find((c) => c.zone === zone)?.city || zone,
    hours: Array.from({ length: 24 }, (_, hour) => hourIn(zone, new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, 0, 0))),
  })), [zones, base]);

  const goodHours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => grid.every((row) => {
    const local = row.hours[hour];
    return local >= startHour && local <= endHour;
  })), [grid, startHour, endHour]);

  const selectedLocalHour = picked === null ? null : picked;
  const selected = useMemo(() => {
    if (selectedLocalHour === null) return [];
    return grid.map((row) => ({ city: row.city, hour: row.hours[selectedLocalHour] }));
  }, [grid, selectedLocalHour]);

  const addCity = (zone) => { if (!zones.includes(zone)) setZones((z) => [...z, zone]); };
  const removeZone = (zone) => setZones((z) => z.filter((x) => x !== zone));

  const windowText = goodHours.length
    ? `${String(goodHours[0]).padStart(2, '0')}:00 – ${String(goodHours[goodHours.length - 1] + 1).padStart(2, '0')}:00 your time`
    : 'No hour works for everyone inside those hours.';

  const dayLabel = base.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  const report = selected.length
    ? `${dayLabel} at ${String(selectedLocalHour).padStart(2, '0')}:00 (your time)\n${selected.map((s) => `${s.city}: ${String(s.hour).padStart(2, '0')}:00`).join('\n')}`
    : `${dayLabel}\nOverlap: ${windowText}`;

  return (
    <ToolShell
      toolId="meeting-planner"
      icon={Hourglass}
      title="Meeting Planner"
      desc="Find the hours that work for everyone — a 24-hour grid per city, with the overlapping window called out."
      state={{ zones, dayOffset, startHour, endHour }}
      onRestore={(saved) => {
        if (Array.isArray(saved.zones) && saved.zones.length) setZones(saved.zones);
        setDayOffset(saved.dayOffset ?? 0);
        setStartHour(saved.startHour ?? 9);
        setEndHour(saved.endHour ?? 18);
      }}
      exportText={report}
      exportName="meeting-window.txt"
    >
      <Seg
        value={dayOffset}
        onChange={(v) => { setDayOffset(Number(v)); setPicked(null); }}
        options={[0, 1, 2, 3].map((d) => ({ value: d, label: d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `+${d} days` }))}
      />

      <Panel className={goodHours.length ? 'border-cyan-j/40' : 'border-amber-500/40'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{dayLabel} · best overlap</div>
            <div className={`text-sm font-semibold ${goodHours.length ? 'text-cyan-j' : 'text-amber-500'}`}>{windowText}</div>
          </div>
          <span className="rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground">
            {goodHours.length} of 24 hours
          </span>
        </div>
      </Panel>

      <Panel className="!p-2">
        <div className="overflow-x-auto scrollbar-thin">
          <div className="min-w-[520px]">
            <div className="grid grid-cols-[110px_repeat(24,minmax(0,1fr))] gap-px">
              <span />
              {Array.from({ length: 24 }, (_, hour) => (
                <button
                  key={hour}
                  type="button"
                  onClick={() => setPicked(hour)}
                  className={`rounded-sm py-1 text-[9px] transition ${picked === hour ? 'bg-cyan-j text-black' : goodHours.includes(hour) ? 'text-cyan-j' : 'text-muted-foreground'} ${hour % 3 === 0 ? 'font-semibold' : ''}`}
                >
                  {hour % 3 === 0 ? hour : ''}
                </button>
              ))}
              {grid.map((row) => (
                <React.Fragment key={row.zone}>
                  <span className="flex items-center gap-1 pr-1 text-[10px] text-muted-foreground">
                    <button type="button" onClick={() => removeZone(row.zone)} className="text-[10px] transition hover:text-red-500">×</button>
                    <span className="truncate">{row.city}</span>
                  </span>
                  {row.hours.map((localHour, hour) => (
                    <button
                      key={hour}
                      type="button"
                      onClick={() => setPicked(hour)}
                      title={`${row.city}: ${String(localHour).padStart(2, '0')}:00`}
                      className={`h-6 rounded-sm text-center text-[9px] leading-6 transition ${BAND_STYLE[bandFor(localHour)]} ${picked === hour ? 'ring-1 ring-cyan-j' : ''} ${goodHours.includes(hour) ? 'shadow-[0_0_0_1px_hsl(var(--cyan)/0.35)]' : ''}`}
                    >
                      {String(localHour).padStart(2, '0')}
                    </button>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 pl-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-cyan-j/40" /> working hours</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400/35" /> shoulder</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-muted" /> night</span>
        </div>
      </Panel>

      {selected.length > 0 && (
        <Panel>
          <div className="mb-2 text-xs font-medium">That moment in each city · {String(selectedLocalHour).padStart(2, '0')}:00 your time</div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {selected.map((s) => (
              <div key={s.city} className="flex items-center justify-between rounded-lg border border-border/60 px-2 py-1.5">
                <span className="truncate text-[11px]">{s.city}</span>
                <span className="font-mono-j text-xs">{String(s.hour).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Earliest acceptable hour · ${startHour}:00`}>
          <input type="range" min={5} max={12} value={startHour} onChange={(e) => setStartHour(Math.min(Number(e.target.value), endHour - 2))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Latest acceptable hour · ${endHour}:00`}>
          <input type="range" min={13} max={22} value={endHour} onChange={(e) => setEndHour(Math.max(Number(e.target.value), startHour + 2))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <Field label="Add a city">
        <select
          value=""
          onChange={(e) => { if (e.target.value) addCity(e.target.value); }}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">Choose a city…</option>
          {CITIES.filter((c) => !zones.includes(c.zone)).map((c) => (
            <option key={c.zone} value={c.zone}>{c.city}</option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Cities" value={String(zones.length)} />
        <Stat label="Overlap" value={`${goodHours.length}h`} mono />
        <Stat label="Day" value={dayLabel} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The grid is laid out in your own hours: read down a column to see what time it is for everyone at that moment.
          Columns outlined in cyan are the ones where every selected city sits inside the acceptable hours you set. Daylight-saving shifts are handled by
          your browser's time-zone data, so the grid is right for that particular date.
        </p>
      </Panel>
    </ToolShell>
  );
}