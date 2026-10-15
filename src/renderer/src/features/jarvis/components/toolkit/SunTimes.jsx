import { useMemo, useState } from 'react';
import { Sunrise } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat } from './shared';

const rad = Math.PI / 180;
const dayMs = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const E = rad * 23.4397;

const PLACES = [
  { label: 'New Delhi', lat: 28.6139, lon: 77.209 },
  { label: 'London', lat: 51.5072, lon: -0.1276 },
  { label: 'New York', lat: 40.7128, lon: -74.006 },
  { label: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { label: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { label: 'Sydney', lat: -33.8688, lon: 151.2093 },
];

const toJulian = (date) => date.valueOf() / dayMs - 0.5 + J1970;
const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
const toDays = (date) => toJulian(date) - J2000;

const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (M) => {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + Math.PI;
};
const declination = (l) => Math.asin(Math.sin(E) * Math.sin(l));
const rightAscension = (l) => Math.atan2(Math.sin(l) * Math.cos(E), Math.cos(l));
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const altitudeOf = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
const azimuthOf = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));

const julianCycle = (d, lw) => Math.round(d - 0.0009 - lw / (2 * Math.PI));
const approxTransit = (Ht, lw, n) => 0.0009 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h, phi, dec) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));

function sunPosition(date, lat, lon) {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const ra = rightAscension(L);
  const H = siderealTime(d, lw) - ra;
  return { altitude: altitudeOf(H, phi, dec) / rad, azimuth: (azimuthOf(H, phi, dec) / rad + 180) % 360, dec };
}

function sunTimes(date, lat, lon) {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const noonJ = solarTransitJ(ds, M, L);

  const setAt = (degrees) => {
    const w = hourAngle(degrees * rad, phi, dec);
    if (!Number.isFinite(w)) return { rise: null, set: null };
    const jSet = solarTransitJ(approxTransit(w, lw, n), M, L);
    return { set: fromJulian(jSet), rise: fromJulian(2 * noonJ - jSet) };
  };

  return {
    noon: fromJulian(noonJ),
    sunrise: setAt(-0.833).rise,
    sunset: setAt(-0.833).set,
    dawn: setAt(-6).rise,
    dusk: setAt(-6).set,
    blueMorningEnd: setAt(-4).rise,
    goldenEveningStart: setAt(6).set,
    goldenMorningEnd: setAt(6).rise,
    blueEveningStart: setAt(-4).set,
  };
}

const clock = (instant, offset) => {
  if (!instant) return '—';
  const shifted = new Date(instant.getTime() + offset * 3600e3);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
};

const localOf = (instant) => (instant ? instant.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

// Follows the quadratic arc drawn in the preview: from (20,118) through (200,-34) to (380,118).
const arcY = (t) => 118 - 304 * t + 304 * t * t;

const duration = (from, to) => {
  if (!from || !to) return null;
  const minutes = Math.round((to - from) / 60000);
  return { minutes, text: `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} m` };
};

export default function SunTimes() {
  const [lat, setLat] = useState(28.6139);
  const [lon, setLon] = useState(77.209);
  const [offset, setOffset] = useState(5.5);
  const [autoOffset, setAutoOffset] = useState(true);
  const [place, setPlace] = useState('New Delhi');
  const [dayOffset, setDayOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [geoState, setGeoState] = useState('');

  const effectiveOffset = autoOffset ? Math.round((lon / 15) * 2) / 2 : offset;
  const date = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
  }, [dayOffset, tick]);

  const times = useMemo(() => sunTimes(date, Number(lat) || 0, Number(lon) || 0), [date, lat, lon]);
  const nowPos = useMemo(() => sunPosition(new Date(), Number(lat) || 0, Number(lon) || 0), [lat, lon, tick]);

  const daylight = duration(times.sunrise, times.sunset);
  const morningGolden = duration(times.blueMorningEnd, times.goldenMorningEnd);
  const eveningGolden = duration(times.goldenEveningStart, times.blueEveningStart);
  const untilSunset = times.sunset ? Math.round((times.sunset - new Date()) / 60000) : null;

  const useMyLocation = () => {
    if (!navigator.geolocation) { setGeoState('This browser has no location support.'); return; }
    setGeoState('Locating…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(4)));
        setLon(Number(pos.coords.longitude.toFixed(4)));
        setAutoOffset(true);
        setPlace('My location');
        setGeoState('');
      },
      () => setGeoState('Location was refused — type the coordinates instead.'),
      { timeout: 10000 },
    );
  };

  const pickPlace = (label) => {
    const found = PLACES.find((p) => p.label === label);
    if (!found) return;
    setPlace(found.label);
    setLat(found.lat);
    setLon(found.lon);
    setAutoOffset(true);
  };

  const nowUp = nowPos.altitude > 0;
  const dayProgress = times.sunrise && times.sunset
    ? Math.max(0, Math.min(1, (Date.now() - times.sunrise.getTime()) / (times.sunset.getTime() - times.sunrise.getTime())))
    : 0;

  const report = [
    `${place} · ${Number(lat).toFixed(3)}, ${Number(lon).toFixed(3)} · ${date.toDateString()}`,
    `Sunrise ${clock(times.sunrise, effectiveOffset)} · Sunset ${clock(times.sunset, effectiveOffset)} · Noon ${clock(times.noon, effectiveOffset)}`,
    `Daylight ${daylight?.text ?? '—'} · Morning golden ${morningGolden?.text ?? '—'} · Evening golden ${eveningGolden?.text ?? '—'}`,
    `Now: sun ${nowPos.altitude.toFixed(1)}° above the horizon, azimuth ${nowPos.azimuth.toFixed(0)}°`,
  ].join('\n');

  return (
    <ToolShell
      toolId="sun-times"
      icon={Sunrise}
      title="Sun & Golden Hour"
      desc="Sunrise, sunset, golden hour and the sun's live position for any place on earth — worked out from its coordinates."
      state={{ lat, lon, offset, autoOffset, place, dayOffset }}
      onRestore={(saved) => {
        if (saved.lat !== undefined) setLat(saved.lat);
        if (saved.lon !== undefined) setLon(saved.lon);
        setOffset(saved.offset ?? 5.5);
        setAutoOffset(saved.autoOffset ?? true);
        if (saved.place) setPlace(saved.place);
        setDayOffset(saved.dayOffset ?? 0);
      }}
      exportText={report}
      exportName="sun-times.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={useMyLocation} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          Use my location
        </button>
        <select value={place} onChange={(e) => pickPlace(e.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs">
          {PLACES.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
        </select>
        <Seg
          value={dayOffset}
          onChange={(v) => setDayOffset(Number(v))}
          options={[{ value: 0, label: 'Today' }, { value: 1, label: 'Tomorrow' }, { value: -1, label: 'Yesterday' }]}
        />
        <button type="button" onClick={() => setTick((t) => t + 1)} className="text-[11px] text-muted-foreground transition hover:text-cyan-j">
          Refresh now
        </button>
      </div>
      {geoState && <p className="text-[11px] text-amber-500">{geoState}</p>}

      <Panel className="!p-3">
        <div className="flex items-end justify-between px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{clock(times.sunrise, effectiveOffset)}</span>
          <span className={nowUp ? 'text-cyan-j' : ''}>{nowUp ? 'the sun is up' : 'the sun is down'}</span>
          <span>{clock(times.sunset, effectiveOffset)}</span>
        </div>
        <svg viewBox="0 0 400 130" className="mt-1 w-full">
          <defs>
            <linearGradient id="sun-arc" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(189 100% 50%)" stopOpacity="0.25" />
              <stop offset="50%" stopColor="hsl(189 100% 55%)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="hsl(189 100% 50%)" stopOpacity="0.25" />
            </linearGradient>
          </defs>
          <path d="M20 118 Q 200 -34 380 118" fill="none" stroke="url(#sun-arc)" strokeWidth="2" />
          <line x1="20" y1="118" x2="380" y2="118" stroke="hsl(var(--border))" strokeWidth="1" />
          {[0.25, 0.5, 0.75].map((f) => (
            <circle key={f} cx={20 + f * 360} cy={arcY(f)} r="1.5" fill="hsl(var(--muted-foreground))" opacity="0.5" />
          ))}
          <g transform={`translate(${20 + dayProgress * 360} ${Math.max(8, Math.min(114, arcY(dayProgress)))})`}>
            <circle r="7" fill={nowUp ? 'hsl(38 100% 55%)' : 'hsl(var(--muted-foreground))'} opacity="0.35" />
            <circle r="4.5" fill={nowUp ? 'hsl(38 100% 58%)' : 'hsl(var(--secondary))'} />
          </g>
        </svg>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            { label: 'night', style: 'bg-secondary', span: 2 },
            { label: 'blue', style: 'bg-indigo-500/40', span: 1 },
            { label: 'golden', style: 'bg-amber-400/60', span: 2 },
            { label: 'daylight', style: 'bg-cyan-j/50', span: 6 },
            { label: 'golden', style: 'bg-amber-400/60', span: 2 },
            { label: 'blue', style: 'bg-indigo-500/40', span: 1 },
            { label: 'night', style: 'bg-secondary', span: 2 },
          ].map((seg, i) => (
            <span key={`${seg.label}-${i}`} className={`h-2 rounded-full ${seg.style}`} style={{ flexGrow: seg.span }} />
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{place} · {Number(lat).toFixed(3)}, {Number(lon).toFixed(3)} · times shown at UTC{effectiveOffset >= 0 ? '+' : ''}{effectiveOffset}</p>
      </Panel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Sunrise" value={clock(times.sunrise, effectiveOffset)} sub={localOf(times.sunrise)} mono />
        <Stat label="Solar noon" value={clock(times.noon, effectiveOffset)} sub="highest point" mono />
        <Stat label="Sunset" value={clock(times.sunset, effectiveOffset)} sub={localOf(times.sunset)} mono />
        <Stat label="Daylight" value={daylight?.text ?? '—'} sub="sun above horizon" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Golden hour</div>
          <div className="mt-1 space-y-1 text-[11px]">
            <p>Morning · {clock(times.blueMorningEnd, effectiveOffset)} → {clock(times.goldenMorningEnd, effectiveOffset)} <span className="text-muted-foreground">({morningGolden?.text ?? '—'})</span></p>
            <p>Evening · {clock(times.goldenEveningStart, effectiveOffset)} → {clock(times.blueEveningStart, effectiveOffset)} <span className="text-muted-foreground">({eveningGolden?.text ?? '—'})</span></p>
          </div>
        </Panel>
        <Panel>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Blue hour & twilight</div>
          <div className="mt-1 space-y-1 text-[11px]">
            <p>Dawn · {clock(times.dawn, effectiveOffset)} · Dusk · {clock(times.dusk, effectiveOffset)}</p>
            <p className="text-muted-foreground">civil twilight, sun 6° below the horizon</p>
          </div>
        </Panel>
        <Panel>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Right now</div>
          <div className="mt-1 space-y-1 text-[11px]">
            <p>Sun {nowPos.altitude.toFixed(1)}° above the horizon, {nowPos.azimuth.toFixed(0)}° around the compass</p>
            <p className="text-muted-foreground">
              {nowUp
                ? untilSunset != null && untilSunset > 0 ? `${Math.floor(untilSunset / 60)} h ${untilSunset % 60} m of daylight left` : 'Setting any moment'
                : 'The sun is below the horizon here'}
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Latitude · ${lat}`}>
          <input type="number" step="0.01" value={lat} onChange={(e) => setLat(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label={`Longitude · ${lon}`}>
          <input type="number" step="0.01" value={lon} onChange={(e) => setLon(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label={`UTC offset · ${effectiveOffset}`}>
          <input
            type="range"
            min={-12}
            max={14}
            step={0.5}
            value={autoOffset ? effectiveOffset : offset}
            onChange={(e) => { setAutoOffset(false); setOffset(Number(e.target.value)); }}
            className="w-full accent-[hsl(var(--cyan))]"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={autoOffset ? 'auto' : 'manual'}
          onChange={(v) => setAutoOffset(v === 'auto')}
          options={[{ value: 'auto', label: 'Offset from longitude' }, { value: 'manual', label: 'Set it myself' }]}
        />
        <CopyBtn value={report} label="Copy summary" />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Times are computed from the sun's position for that date and place, so they are accurate to within a minute or so at mid-latitudes — enough
          for a shoot, a run or dinner outside. The offset-from-longitude option shows local solar time; step it by hand to match a time zone with
          daylight saving. Near the poles the sun may not cross the horizon at all, and those rows will read as dashes.
        </p>
      </Panel>
    </ToolShell>
  );
}