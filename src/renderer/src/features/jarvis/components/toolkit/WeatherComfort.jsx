import { useMemo, useState } from 'react';
import { Cloud } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const round = (value, places = 1) => (Number.isFinite(value) ? value.toFixed(places) : '—');

export default function WeatherComfort() {
  const [units, setUnits] = useState('metric');
  const [temperature, setTemperature] = useState('32');
  const [humidity, setHumidity] = useState('70');
  const [wind, setWind] = useState('12');
  const [windUnit, setWindUnit] = useState('kmh');
  const [activity, setActivity] = useState('rest');

  const result = useMemo(() => {
    const tC = units === 'metric' ? Number(temperature) || 0 : ((Number(temperature) || 0) - 32) / 1.8;
    const rh = Math.max(1, Math.min(100, Number(humidity) || 50));
    const rawWind = Math.max(0, Number(wind) || 0);
    const windKmh = windUnit === 'kmh' ? rawWind : windUnit === 'ms' ? rawWind * 3.6 : rawWind * 1.60934;

    const toDisplayTemp = (value) => (units === 'metric' ? value : value * 1.8 + 32);
    const tempUnitLabel = units === 'metric' ? '°C' : '°F';

    const gamma = Math.log(rh / 100) + (17.27 * tC) / (237.7 + tC);
    const dewPoint = (237.7 * gamma) / (17.27 - gamma);
    const vapourPressure = (rh / 100) * 6.105 * Math.exp((17.27 * tC) / (237.7 + tC));
    const apparent = tC + 0.33 * vapourPressure - 0.7 * windKmh - 4;
    const absoluteHumidity = (216.7 * (rh / 100) * 6.112 * Math.exp((17.62 * tC) / (243.12 + tC))) / (tC + 273.15);

    const tF = tC * 1.8 + 32;
    const heatIndexF = (() => {
      if (tF < 80) return tF;
      const hi = -42.379 + 2.04901523 * tF + 10.14333127 * rh - 0.22475541 * tF * rh
        - 0.00683783 * tF * tF - 0.05481717 * rh * rh
        + 0.00122874 * tF * tF * rh + 0.00085282 * tF * rh * rh
        - 0.00000199 * tF * tF * rh * rh;
      return hi;
    })();
    const heatIndexC = (heatIndexF - 32) / 1.8;

    const windChillC = (tC <= 10 && windKmh > 4.8)
      ? 13.12 + 0.6215 * tC - 11.37 * Math.pow(windKmh, 0.16) + 0.3965 * tC * Math.pow(windKmh, 0.16)
      : tC;

    const wetBulb = tC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
      + Math.atan(tC + rh) - Math.atan(rh - 1.676331)
      + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035;

    const activityFactor = activity === 'rest' ? 0 : activity === 'light' ? 2 : activity === 'moderate' ? 4 : 7;
    const feelsWithActivity = heatIndexC > tC ? heatIndexC + activityFactor : apparent + activityFactor;

    const heatBand = heatIndexC >= 54 ? 'extreme danger'
      : heatIndexC >= 41 ? 'danger'
      : heatIndexC >= 32 ? 'extreme caution'
      : heatIndexC >= 27 ? 'caution'
      : 'no heat risk';

    const dewBand = dewPoint < 10 ? 'dry and comfortable'
      : dewPoint < 16 ? 'comfortable'
      : dewPoint < 20 ? 'humid, noticeable'
      : dewPoint < 24 ? 'oppressive'
      : 'muggy, hard to cool down';

    const wetBulbRisk = wetBulb >= 35 ? 'lethal within hours without cooling'
      : wetBulb >= 31 ? 'dangerous for any exertion'
      : wetBulb >= 28 ? 'dangerous for prolonged exertion'
      : wetBulb >= 25 ? 'strenuous activity becomes risky'
      : 'safe for normal activity';

    const frostbite = (() => {
      if (tC > 0) return 'no frostbite risk';
      if (windChillC > -10) return 'low risk with suitable clothing';
      if (windChillC > -27) return 'frostbite possible on exposed skin in about 30 minutes';
      if (windChillC > -39) return 'frostbite in about 10 minutes';
      return 'frostbite in under 5 minutes';
    })();

    const scale = [10, 20, 30, 40, 50].map((value) => ({
      air: value,
      heatIndex: (() => {
        const f = value * 1.8 + 32;
        if (f < 80) return value;
        const hi = -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh
          - 0.00683783 * f * f - 0.05481717 * rh * rh
          + 0.00122874 * f * f * rh + 0.00085282 * f * rh * rh
          - 0.00000199 * f * f * rh * rh;
        return (hi - 32) / 1.8;
      })(),
    }));

    const measures = [
      { label: 'Air', value: Number(toDisplayTemp(tC).toFixed(1)) },
      { label: 'Apparent', value: Number(toDisplayTemp(apparent).toFixed(1)) },
      { label: 'Heat index', value: Number(toDisplayTemp(heatIndexC).toFixed(1)) },
      { label: 'Wind chill', value: Number(toDisplayTemp(windChillC).toFixed(1)) },
      { label: 'Wet bulb', value: Number(toDisplayTemp(wetBulb).toFixed(1)) },
    ];

    return {
      tC, tF, rh, windKmh, dewPoint, dewBand, apparent, heatIndexC, heatBand, windChillC, wetBulb, wetBulbRisk,
      absoluteHumidity, vapourPressure, feelsWithActivity, activityFactor, frostbite, scale, measures,
      toDisplayTemp, tempUnitLabel, feelsLike: heatIndexC > tC + 0.5 ? heatIndexC : windChillC < tC - 0.5 ? windChillC : apparent,
      humidityFlag: wetBulb >= 31,
    };
  }, [units, temperature, humidity, wind, windUnit, activity]);

  const report = useMemo(() => [
    'Air temperature ' + round(result.toDisplayTemp(result.tC)) + ' ' + result.tempUnitLabel + ' at ' + result.rh + '% humidity and ' + Math.round(result.windKmh) + ' km/h wind',
    'Feels like ' + round(result.toDisplayTemp(result.feelsLike)) + ' ' + result.tempUnitLabel,
    'Heat index ' + round(result.toDisplayTemp(result.heatIndexC)) + ' · wind chill ' + round(result.toDisplayTemp(result.windChillC)) + ' · wet bulb ' + round(result.toDisplayTemp(result.wetBulb)),
    'Dew point ' + round(result.toDisplayTemp(result.dewPoint)) + ' — ' + result.dewBand,
    'Absolute humidity ' + round(result.absoluteHumidity, 2) + ' g/m³',
    'Heat risk: ' + result.heatBand + '. Wet bulb risk: ' + result.wetBulbRisk + '.',
    'Cold: ' + result.frostbite + '.',
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="weather-comfort"
      icon={Cloud}
      title="Weather Comfort Calculator"
      desc="Heat index, wind chill, dew point, wet bulb and absolute humidity from one set of readings — with the activity adjustment and the thresholds that actually matter for safety."
      state={{ units, temperature, humidity, wind, windUnit, activity }}
      onRestore={(restored) => {
        if (restored.units) setUnits(restored.units);
        if (restored.temperature !== undefined) setTemperature(String(restored.temperature));
        if (restored.humidity !== undefined) setHumidity(String(restored.humidity));
        if (restored.wind !== undefined) setWind(String(restored.wind));
        if (restored.windUnit) setWindUnit(restored.windUnit);
        if (restored.activity) setActivity(restored.activity);
      }}
      exportText={report}
      exportName="weather-comfort.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={units} onChange={setUnits} options={[{ value: 'metric', label: 'Celsius' }, { value: 'imperial', label: 'Fahrenheit' }]} />
        <Seg value={windUnit} onChange={setWindUnit} options={[{ value: 'kmh', label: 'km/h' }, { value: 'ms', label: 'm/s' }, { value: 'mph', label: 'mph' }]} />
        <Seg value={activity} onChange={setActivity} options={[{ value: 'rest', label: 'Resting' }, { value: 'light', label: 'Light work' }, { value: 'moderate', label: 'Moderate' }, { value: 'hard', label: 'Hard effort' }]} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={'Air temperature, ' + result.tempUnitLabel}><input value={temperature} onChange={(e) => setTemperature(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Relative humidity, %"><input value={humidity} onChange={(e) => setHumidity(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Wind speed"><input value={wind} onChange={(e) => setWind(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      {result.humidityFlag && (
        <Panel className="!p-3 !border-rose-400/50">
          <p className="text-[11px] text-rose-200">
            The wet bulb temperature is {round(result.toDisplayTemp(result.wetBulb))} {result.tempUnitLabel}. Above a wet bulb of 35 {result.tempUnitLabel} the body cannot cool itself by
            sweating at all, and even healthy people are at risk within hours. This is the threshold that matters most in a heatwave, more than the headline air temperature.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.feelsLike >= 35 ? 'rose' : result.feelsLike <= 0 ? 'blue' : 'emerald'}
          label="Feels like"
          value={round(result.toDisplayTemp(result.feelsLike))}
          unit={result.tempUnitLabel}
          sub={'With ' + result.activityFactor.toFixed(0) + ' degrees added for your activity level the effective figure is ' + round(result.toDisplayTemp(result.feelsWithActivity)) + ' ' + result.tempUnitLabel + '. Heat risk is ' + result.heatBand + ', and the dew point of ' + round(result.toDisplayTemp(result.dewPoint)) + ' ' + result.tempUnitLabel + ' means the air is ' + result.dewBand + '.'}
        />
        <Ring
          value={result.toDisplayTemp(result.wetBulb)}
          max={45}
          tone={result.wetBulb >= 31 ? 'rose' : result.wetBulb >= 28 ? 'amber' : 'emerald'}
          label="Wet bulb temperature"
          sub={result.wetBulbRisk}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Five ways of describing the same air</div>
          <Bars data={result.measures} format={(value) => value.toFixed(1)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            They disagree because they answer different questions. Heat index asks how hot it feels in shade, wind chill asks how fast exposed skin loses heat, and wet bulb asks how
            much cooling is even physically possible.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Every figure</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Air temperature</span><span>{round(result.toDisplayTemp(result.tC))} {result.tempUnitLabel}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Heat index</span><span className="text-cyan-j">{round(result.toDisplayTemp(result.heatIndexC))} {result.tempUnitLabel}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Wind chill</span><span className="text-cyan-j">{round(result.toDisplayTemp(result.windChillC))} {result.tempUnitLabel}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Apparent temperature</span><span>{round(result.toDisplayTemp(result.apparent))} {result.tempUnitLabel}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Wet bulb</span><span>{round(result.toDisplayTemp(result.wetBulb))} {result.tempUnitLabel}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Dew point</span><span>{round(result.toDisplayTemp(result.dewPoint))} {result.tempUnitLabel}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Absolute humidity</span><span>{round(result.absoluteHumidity, 2)} g/m³</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Vapour pressure</span><span>{round(result.vapourPressure, 2)} hPa</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Wind</span><span>{Math.round(result.windKmh)} km/h</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Heat risk band</span><span className="text-cyan-j">{result.heatBand}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Heat index rises with humidity at the same temperature</div>
          <div className="space-y-1.5">
            {result.scale.map((row) => (
              <div key={row.air} className="flex items-center gap-2 text-[11px]">
                <span className="w-16 font-mono-j text-muted-foreground">{round(result.toDisplayTemp(row.air))} {result.tempUnitLabel}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: Math.min(100, Math.max(4, ((row.heatIndex - 10) / 60) * 100)) + '%',
                      backgroundColor: row.heatIndex >= 41 ? 'hsl(0 84% 60%)' : row.heatIndex >= 32 ? 'hsl(38 92% 55%)' : 'hsl(var(--cyan))',
                    }}
                  />
                </div>
                <span className="w-20 text-right font-mono-j">{round(result.toDisplayTemp(row.heatIndex))} {result.tempUnitLabel}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Humidity holds at {result.rh}% in this table. Above 40 {result.tempUnitLabel} of air temperature, every extra per cent of moisture raises the felt temperature further
            because sweat evaporates more slowly and cooling stalls.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Dew point bands</div>
          <div className="space-y-1.5 text-[11px]">
            {[
              { band: 'Under 10', note: 'dry and comfortable', value: 10 },
              { band: '10 to 16', note: 'comfortable', value: 16 },
              { band: '16 to 20', note: 'humid and noticeable', value: 20 },
              { band: '20 to 24', note: 'oppressive', value: 24 },
              { band: 'Above 24', note: 'muggy, cooling is hard', value: 28 },
            ].map((entry) => (
              <div key={entry.band} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                <span className="text-muted-foreground">{entry.band} {result.tempUnitLabel === '°C' ? '°C' : '°F'}</span>
                <span>{entry.note}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The dew point is the honest measure of humidity, because it does not move when the temperature changes. Two days at 30% and 90% relative humidity feel completely
            different, but the dew point tells you which one will actually let you sweat.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Feels like" value={round(result.toDisplayTemp(result.feelsLike)) + ' ' + result.tempUnitLabel} mono />
        <Stat label="Dew point" value={round(result.toDisplayTemp(result.dewPoint)) + ' ' + result.tempUnitLabel} mono sub={result.dewBand} />
        <Stat label="Wet bulb" value={round(result.toDisplayTemp(result.wetBulb)) + ' ' + result.tempUnitLabel} mono sub={result.wetBulbRisk.split(' ')[0]} />
        <Stat label="Cold risk" value={result.frostbite.split(' ').slice(0, 3).join(' ')} mono sub={result.frostbite} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Staying safe in heat</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Drinks before thirst. By the time you feel thirsty you are already behind on fluid, and heat illness develops faster than the thirst catches up.</p>
            <p>· Move hard activity to early morning. The wet bulb figure is lowest then, and it is the wet bulb, not the air temperature, that sets the ceiling on exertion.</p>
            <p>· Watch the urine colour rather than counting litres. Pale straw means hydrated; dark means drink now.</p>
            <p>· Alcohol and heavy meals both make heat harder to handle, and medication for blood pressure or allergy often changes how well sweating works.</p>
            <p>· Shade and moving air do most of the work. A fan stops helping above about a wet bulb of 35 degrees, when it simply moves air that cannot cool anyone.</p>
            <p>· {result.heatBand === 'no heat risk' ? 'There is no meaningful heat risk at this combination.' : 'The current band is ' + result.heatBand + ', which calls for ' + (result.heatBand === 'extreme danger' || result.heatBand === 'danger' ? 'postponing all unnecessary exertion.' : 'regular breaks, shade and continuous fluid intake.')}</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading the cold figures</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Wind chill only applies below about 10 {result.tempUnitLabel} and above a light breeze. Above that, wind actually cools rather than chills, which is what the apparent temperature captures.</p>
            <p>· Wind chill is about exposed skin, so covering up removes it almost entirely. {result.frostbite}.</p>
            <p>· Absolute humidity in g/m³ is the physical amount of water in the air, and unlike relative humidity it does not change when the temperature changes.</p>
            <p>· Cold air holds very little water, which is why heating indoors in winter dries everything out even when it is raining outside.</p>
            <p>· Layers trap air, and trapped air is the insulation. One thick layer is worse than two thin ones because you cannot adjust it.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Feels like', value: round(result.toDisplayTemp(result.feelsLike)) + ' ' + result.tempUnitLabel },
                { label: 'Heat risk', value: result.heatBand },
                { label: 'Wet bulb', value: round(result.toDisplayTemp(result.wetBulb)) + ' ' + result.tempUnitLabel },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>dew point: γ = ln(RH ÷ 100) + 17.27T ÷ (237.7 + T), then T_d = 237.7γ ÷ (17.27 − γ)</p>
          <p>heat index: the Rothfusz regression in Fahrenheit, applied above 80 °F</p>
          <p>wind chill: 13.12 + 0.6215T − 11.37v⁰·¹⁶ + 0.3965Tv⁰·¹⁶, for T below 10 °C and v above 4.8 km/h</p>
          <p>apparent temperature: T + 0.33e − 0.7v − 4, with e the vapour pressure in hPa</p>
          <p>wet bulb: the Stull approximation from temperature and relative humidity</p>
          <p className="text-cyan-j">Here {round(result.tC)} °C at {result.rh}% gives a dew point of {round(result.dewPoint)} °C and a wet bulb of {round(result.wetBulb)} °C.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          These are standard published approximations rather than first-principles thermodynamics, and they assume shade, light wind at human height and no direct sun. Standing in full
          sun adds several degrees that no formula here accounts for.
        </p>
      </Panel>
    </ToolShell>
  );
}