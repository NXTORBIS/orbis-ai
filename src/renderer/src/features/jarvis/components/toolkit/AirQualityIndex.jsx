import { useMemo, useState } from 'react';
import { Wind, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const POLLUTANTS = {
  'pm25': {
    label: 'PM2.5',
    unit: 'µg/m³',
    averaging: '24 hour',
    bands: [[0, 12], [12.1, 35.4], [35.5, 55.4], [55.5, 150.4], [150.5, 250.4], [250.5, 500.4]],
  },
  'pm10': {
    label: 'PM10',
    unit: 'µg/m³',
    averaging: '24 hour',
    bands: [[0, 54], [55, 154], [155, 254], [255, 354], [355, 424], [425, 604]],
  },
  'o3': {
    label: 'Ozone',
    unit: 'ppb',
    averaging: '8 hour',
    bands: [[0, 54], [55, 70], [71, 85], [86, 105], [106, 200], [201, 404]],
  },
  'no2': {
    label: 'Nitrogen dioxide',
    unit: 'ppb',
    averaging: '1 hour',
    bands: [[0, 53], [54, 100], [101, 360], [361, 649], [650, 1249], [1250, 2049]],
  },
  'so2': {
    label: 'Sulphur dioxide',
    unit: 'ppb',
    averaging: '1 hour',
    bands: [[0, 35], [36, 75], [76, 185], [186, 304], [305, 604], [605, 1004]],
  },
  'co': {
    label: 'Carbon monoxide',
    unit: 'ppm',
    averaging: '8 hour',
    bands: [[0, 4.4], [4.5, 9.4], [9.5, 12.4], [12.5, 15.4], [15.5, 30.4], [30.5, 50.4]],
  },
};

const INDEX_BANDS = [
  { max: 50, label: 'Good', colour: '#34d399', advice: 'Air quality is satisfactory and poses little risk. Normal outdoor activity is fine.' },
  { max: 100, label: 'Moderate', colour: '#facc15', advice: 'Acceptable for most people. Unusually sensitive individuals should consider shortening intense outdoor exertion.' },
  { max: 150, label: 'Unhealthy for sensitive groups', colour: '#fb923c', advice: 'People with asthma, heart or lung conditions, older adults and children should reduce prolonged outdoor exertion.' },
  { max: 200, label: 'Unhealthy', colour: '#f87171', advice: 'Everyone may begin to feel effects. Sensitive groups should avoid outdoor exertion entirely and move activity indoors.' },
  { max: 300, label: 'Very unhealthy', colour: '#c084fc', advice: 'Health alert. Everyone should avoid outdoor exertion and keep windows closed, with filtration running indoors.' },
  { max: 500, label: 'Hazardous', colour: '#e11d48', advice: 'Emergency conditions. Stay indoors with filtered air, and use a well-fitted N95 or better if you must go out.' },
];

const bandFor = (index) => INDEX_BANDS.find((entry) => index <= entry.max) || INDEX_BANDS[INDEX_BANDS.length - 1];

const subIndex = (key, concentration) => {
  const entry = POLLUTANTS[key];
  if (!entry || concentration < 0) return null;
  const bands = entry.bands;
  const high = [50, 100, 150, 200, 300, 500];
  for (let index = 0; index < bands.length; index += 1) {
    const [low, top] = bands[index];
    if (concentration <= top) {
      const lowIndex = index === 0 ? 0 : high[index - 1] + 1;
      const value = ((high[index] - lowIndex) / (top - bands[index][0] === 0 ? 1 : top - low)) * (concentration - low) + lowIndex;
      return Math.round(Math.max(0, Math.min(500, value)));
    }
  }
  return 500;
};

const blank = () => ({ id: Math.random().toString(36).slice(2), key: 'pm25', value: '20' });

export default function AirQualityIndex() {
  const [rows, setRows] = useState([
    { id: 'a', key: 'pm25', value: '35' },
    { id: 'b', key: 'pm10', value: '60' },
    { id: 'c', key: 'o3', value: '45' },
    { id: 'd', key: 'no2', value: '30' },
  ]);
  const [mode, setMode] = useState('index');

  const set = (id, key, value) => setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const computed = rows.map((row) => {
      const value = Math.max(0, Number(row.value) || 0);
      const index = subIndex(row.key, value);
      return {
        ...row,
        value,
        index: index === null ? 0 : index,
        label: POLLUTANTS[row.key] ? POLLUTANTS[row.key].label : 'Unknown',
        unit: POLLUTANTS[row.key] ? POLLUTANTS[row.key].unit : '',
        averaging: POLLUTANTS[row.key] ? POLLUTANTS[row.key].averaging : '',
      };
    }).filter((row) => row.index !== null && row.value > 0);

    const worst = computed.reduce((best, row) => (row.index > (best.index || -1) ? row : best), { index: -1 });
    const overall = computed.length ? worst.index : 0;
    const band = bandFor(overall);

    const ladder = INDEX_BANDS.map((entry) => ({
      label: entry.label.split(' ')[0],
      value: entry.max,
      colour: entry.colour,
    }));

    const healthNote = overall <= 50
      ? 'Outdoor exercise, open windows and normal routines are all fine.'
      : overall <= 100
        ? 'Most people are unaffected. If you are unusually sensitive to pollution, keep hard exercise shorter than usual.'
        : overall <= 150
          ? 'Sensitive groups should cut back on prolonged or intense outdoor effort, and take routes away from busy roads.'
          : overall <= 200
            ? 'Everyone should limit outdoor exertion, keep windows closed and run filtration indoors where possible.'
            : 'Treat this as a health alert: stay indoors with clean air, and wear a well-fitted N95 if you have to be outside.';

    return {
      computed, overall, band, worst, ladder, healthNote,
      dominant: worst.label || 'none',
      chart: computed.map((row) => ({ label: row.label, value: row.index })),
      maskAdvice: worst.key === 'pm25' || worst.key === 'pm10'
        ? 'The dominant pollutant here is particulate matter, which a well-fitted N95 or P2 mask does filter. Surgical masks and cloth coverings do not.'
        : 'The dominant pollutant here is a gas rather than particles, which an N95 mask does not filter. Reducing exposure and ventilation indoors matters more.',
      whoCompare: worst.key === 'pm25' ? (worst.value / 15).toFixed(1) : null,
    };
  }, [rows]);

  const report = useMemo(() => [
    'Air quality index ' + result.overall + ' — ' + result.band.label,
    'Dominant pollutant: ' + result.dominant,
    '',
    ...result.computed.map((row) => row.label + ': ' + row.value + ' ' + row.unit + ' (' + row.averaging + ') gives a sub-index of ' + row.index),
    '',
    result.band.advice,
    result.maskAdvice,
    result.whoCompare ? 'For context, the WHO 24 hour guideline for PM2.5 is 15 µg/m³, so this reading is about ' + result.whoCompare + ' times that level.' : '',
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="air-quality"
      icon={Wind}
      title="Air Quality Index Calculator"
      desc="Turn pollutant concentrations into the index number everyone quotes, find which pollutant is driving it, and see what the band actually means for exercise, windows and masks."
      state={{ rows, mode }}
      onRestore={(restored) => {
        if (Array.isArray(restored.rows) && restored.rows.length) setRows(restored.rows);
        if (restored.mode) setMode(restored.mode);
      }}
      exportText={report}
      exportName="air-quality.txt"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'index', label: 'Concentrations to index' }, { value: 'reference', label: 'Band reference' }]} />

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Pollutant readings</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.computed.length} counted</span>
        </div>
        <div className="space-y-2">
          {rows.map((row) => {
            const meta = POLLUTANTS[row.key] || POLLUTANTS.pm25;
            const index = subIndex(row.key, Number(row.value) || 0);
            const band = bandFor(index || 0);
            return (
              <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-5">
                <Field label="Pollutant">
                  <select value={row.key} onChange={(e) => set(row.id, 'key', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                    {Object.keys(POLLUTANTS).map((key) => <option key={key} value={key}>{POLLUTANTS[key].label}</option>)}
                  </select>
                </Field>
                <Field label={'Concentration, ' + meta.unit}><input value={row.value} onChange={(e) => set(row.id, 'value', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label={'Averaging period'}>
                  <div className="flex h-9 items-center font-mono-j text-[11px] text-muted-foreground">{meta.averaging}</div>
                </Field>
                <Field label="Sub-index">
                  <div className="flex h-9 items-center">
                    <span className="rounded-md border px-2 py-1 font-mono-j text-[11px]" style={{ borderColor: band.colour + '80', color: band.colour, backgroundColor: band.colour + '1a' }}>{index} · {band.label.split(' ')[0]}</span>
                  </div>
                </Field>
                <div className="flex items-end">
                  <button type="button" onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => setRows((current) => [...current, blank()])} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Plus className="h-3.5 w-3.5" /> Add a pollutant
        </button>
      </Panel>

      {mode === 'reference' ? (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The index bands</div>
          <div className="space-y-1.5">
            {INDEX_BANDS.map((entry) => (
              <div key={entry.label} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.colour }} />
                  <span className="text-[11px] font-medium">{entry.label}</span>
                  <span className="ml-auto font-mono-j text-[10px] text-muted-foreground">up to {entry.max}</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{entry.advice}</p>
              </div>
            ))}
          </div>
        </Panel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              label="Air quality index"
              value={String(result.overall)}
              sub={result.band.label + '. Driven mainly by ' + result.dominant + (result.worst.value ? ' at ' + result.worst.value + ' ' + result.worst.unit : '') + '. ' + result.band.advice}
            />
            <Ring
              value={result.overall}
              max={300}
              tone={result.overall <= 50 ? 'emerald' : result.overall <= 100 ? 'amber' : 'rose'}
              label="Against the unhealthy threshold"
              sub={result.overall <= 100 ? 'Below 101, so no general health warning applies' : 'Above 100, which is where the general health advice changes'}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Sub-index by pollutant</div>
              <Bars data={result.chart} format={(value) => String(value)} suffix="" highlightLast={false} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                The overall index is simply the highest sub-index. That is why one pollutant can dominate the headline number even when every other reading is clean.
              </p>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">The figures</span>
                <CopyBtn value={report} label="Copy" />
              </div>
              <div className="space-y-1.5 font-mono-j text-[11px]">
                <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Overall index</span><span className="text-cyan-j">{result.overall} · {result.band.label}</span></div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Dominant pollutant</span><span>{result.dominant}</span></div>
                {result.computed.map((row) => (
                  <div key={row.id} className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                    <span className="text-muted-foreground">{row.label} · {row.value} {row.unit}</span>
                    <span>{row.index}</span>
                  </div>
                ))}
                {result.whoCompare && (
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                    <span className="text-muted-foreground">Against the WHO 24 hour guideline</span>
                    <span>{result.whoCompare}× of 15 µg/m³</span>
                  </div>
                )}
              </div>
            </Panel>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">The band scale</div>
            <div className="flex overflow-hidden rounded-lg border border-border/60">
              {INDEX_BANDS.map((entry) => (
                <div key={entry.label} className="flex-1 px-1 py-2 text-center text-[9px]" style={{ backgroundColor: entry.colour + '33', outline: entry.label === result.band.label ? '2px solid hsl(var(--cyan))' : 'none', outlineOffset: '-2px' }}>
                  {entry.label.split(' ')[0]}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {result.healthNote}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{result.maskAdvice}</p>
          </Panel>
        </>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Overall index" value={String(result.overall)} mono sub={result.band.label.split(' ')[0]} />
        <Stat label="Dominant pollutant" value={result.dominant} mono sub={result.worst.value ? result.worst.value + ' ' + result.worst.unit : ''} />
        <Stat label="Pollutants counted" value={String(result.computed.length)} mono />
        <Stat label="Exercise guidance" value={result.overall <= 50 ? 'none needed' : result.overall <= 100 ? 'light caution' : result.overall <= 150 ? 'reduce' : 'avoid'} mono sub="outdoor exertion" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading an air quality number properly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The index is a scale, not a measurement. Every pollutant maps onto the same 0 to 500 range so that a single number can summarise very different chemistry.</p>
            <p>· The headline is the worst pollutant on the day. In a city this is usually PM2.5 in winter and ozone on hot sunny afternoons.</p>
            <p>· PM2.5 matters most to health because the particles are small enough to reach deep into the lungs and the bloodstream. That is why it dominates research on long-term effects.</p>
            <p>· An index of 100 for PM2.5 is about 35 µg/m³, while the WHO 24 hour guideline is 15 µg/m³. The official index and the health guideline are not the same yardstick.</p>
            <p>· Indoor air is not automatically better. Cooking, candles and poor ventilation can push indoor particulate levels above the street outside.</p>
            <p>· Hourly values swing widely, so a single reading is a snapshot. Look at the trend rather than one number.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What actually reduces your exposure</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Timing beats everything. Pollution peaks with the morning and evening commute and falls overnight, so an early run is measurably cleaner than a rush hour one.</p>
            <p>· Route choice matters. A parallel street away from traffic can be several times lower in particulate than standing at a junction.</p>
            <p>· Exercise multiplies the dose: you breathe far more air when working hard, so the same concentration delivers a much larger exposure.</p>
            <p>· A HEPA filter in the room where you sleep makes the biggest difference, because that is where the most hours are spent.</p>
            <p>· Wildfire smoke is a particulate problem, so filtration and a fitted N95 work; air fresheners, ionisers and ozone generators do not help and some make it worse.</p>
            <p>· {result.worst.key === 'o3' ? 'Ozone peaks in the afternoon on sunny days, so morning is genuinely the cleaner time to be outside.' : result.worst.key === 'pm25' || result.worst.key === 'pm10' ? 'Particulate levels often peak overnight in winter from heating and still air, so a morning walk can be worse than an afternoon one.' : 'Traffic-related gases peak with congestion, so avoiding the commute hours reduces exposure substantially.'}</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Index', value: String(result.overall) },
                { label: 'Band', value: result.band.label.split(' ')[0] },
                { label: 'Dominant', value: result.dominant },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How the sub-index is calculated</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>I = (I_high − I_low) ÷ (C_high − C_low) × (C − C_low) + I_low</p>
          <p>each pollutant is mapped onto the same index range using its own concentration breakpoints</p>
          <p>the overall index is the maximum of the sub-indices, and that pollutant is named the dominant one</p>
          <p>PM2.5 breaks at 12.0, 35.4, 55.4, 150.4 and 250.4 µg/m³ for indices 50, 100, 150, 200 and 300</p>
          <p className="text-cyan-j">Here {result.dominant} yields a sub-index of {result.worst.index || 0}, which sets the overall figure of {result.overall}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This follows the US EPA breakpoint table for the criteria pollutants, applied to the averaging periods shown. Other countries publish their own bands with different
          thresholds, so the same air can carry a different official number depending on whose scale is used.
        </p>
      </Panel>
    </ToolShell>
  );
}