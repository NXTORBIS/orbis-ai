import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const BANDS = [
  { name: 'Black', hex: '#111827', value: 0, multiplier: 1, tolerance: null, temp: 250 },
  { name: 'Brown', hex: '#78350f', value: 1, multiplier: 10, tolerance: 1, temp: 100 },
  { name: 'Red', hex: '#dc2626', value: 2, multiplier: 100, tolerance: 2, temp: 50 },
  { name: 'Orange', hex: '#ea580c', value: 3, multiplier: 1000, tolerance: null, temp: 15 },
  { name: 'Yellow', hex: '#facc15', value: 4, multiplier: 10000, tolerance: null, temp: 25 },
  { name: 'Green', hex: '#16a34a', value: 5, multiplier: 100000, tolerance: 0.5, temp: 20 },
  { name: 'Blue', hex: '#2563eb', value: 6, multiplier: 1000000, tolerance: 0.25, temp: 10 },
  { name: 'Violet', hex: '#7c3aed', value: 7, multiplier: 10000000, tolerance: 0.1, temp: 5 },
  { name: 'Grey', hex: '#9ca3af', value: 8, multiplier: 100000000, tolerance: 0.05, temp: 1 },
  { name: 'White', hex: '#f8fafc', value: 9, multiplier: 1000000000, tolerance: null, temp: null },
  { name: 'Gold', hex: '#d4a017', value: null, multiplier: 0.1, tolerance: 5, temp: null },
  { name: 'Silver', hex: '#cbd5e1', value: null, multiplier: 0.01, tolerance: 10, temp: null },
];

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

const formatOhms = (ohms) => {
  if (ohms === null || ohms === undefined || Number.isNaN(ohms)) return '—';
  if (ohms >= 1e9) return (ohms / 1e9).toFixed(2) + ' GΩ';
  if (ohms >= 1e6) return (ohms / 1e6).toFixed(2) + ' MΩ';
  if (ohms >= 1e3) return (ohms / 1e3).toFixed(2) + ' kΩ';
  return ohms.toFixed(2) + ' Ω';
};

const nearestE24 = (ohms) => {
  if (!ohms) return null;
  const decade = Math.pow(10, Math.floor(Math.log10(ohms)));
  let best = null;
  let bestDiff = Infinity;
  [decade, decade / 10, decade * 10].forEach((base) => {
    E24.forEach((value) => {
      const candidate = value * base;
      const diff = Math.abs(candidate - ohms);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidate;
      }
    });
  });
  return { value: best, error: ohms ? (bestDiff / ohms) * 100 : 0 };
};

const bandsFromValue = (ohms) => {
  if (!ohms) return null;
  const exponent = Math.floor(Math.log10(ohms)) - 1;
  const mantissa = ohms / Math.pow(10, exponent);
  const digits = Math.round(mantissa * 10) / 10;
  const first = Math.floor(digits / 10);
  const second = Math.round(digits - first * 10);
  return { first, second, multiplierExponent: exponent + 1 };
};

export default function ResistorCode() {
  const [mode, setMode] = useState('decode');
  const [bandCount, setBandCount] = useState('4');
  const [bands, setBands] = useState(['2', '2', '2', '0']);
  const [tolerance, setTolerance] = useState('5');
  const [temp, setTemp] = useState('100');
  const [target, setTarget] = useState('4.7k');

  const decoded = useMemo(() => {
    const count = Number(bandCount);
    const first = BANDS[Number(bands[0])] || BANDS[0];
    const second = BANDS[Number(bands[1])] || BANDS[0];
    const third = BANDS[Number(bands[2])] || BANDS[0];
    const fourth = BANDS[Number(bands[3])] || BANDS[0];

    if (count === 4) {
      const multiplier = third.value === null ? third.multiplier : Math.pow(10, third.value);
      return { ohms: (first.value * 10 + second.value) * multiplier, tolerance: Number(tolerance), tempCoeff: null, shown: [first, second, third] };
    }
    if (count === 5) {
      const multiplier = third.value === null ? third.multiplier : Math.pow(10, third.value);
      return { ohms: (first.value * 100 + second.value * 10 + third.value) * multiplier, tolerance: Number(tolerance), tempCoeff: null, shown: [first, second, third] };
    }
    const multiplier = fourth.value === null ? fourth.multiplier : Math.pow(10, fourth.value);
    return { ohms: (first.value * 100 + second.value * 10 + third.value) * multiplier, tolerance: Number(tolerance), tempCoeff: Number(temp), shown: [first, second, third, fourth] };
  }, [bandCount, bands, tolerance, temp]);

  const encoded = useMemo(() => {
    const text = String(target).trim();
    const raw = Number(text.replace(/[^\d.]/g, '')) || 0;
    const scaled = /m/i.test(text) ? raw / 1000 : /k/i.test(text) ? raw * 1000 : text.includes('M') ? raw * 1e6 : raw;
    const nearest = nearestE24(scaled);
    const shape = bandsFromValue(nearest ? nearest.value : scaled);
    if (!shape) return { error: 'Enter a resistance value, for example 4700 or 4.7k.' };
    return {
      ohms: scaled,
      nearest,
      shape,
      first: BANDS[shape.first] || BANDS[0],
      second: BANDS[shape.second] || BANDS[0],
      multiplier: shape.multiplierExponent,
    };
  }, [target]);

  const lower = decoded.ohms * (1 - decoded.tolerance / 100);
  const upper = decoded.ohms * (1 + decoded.tolerance / 100);

  const report = useMemo(() => (mode === 'decode'
    ? [
      'Bands: ' + decoded.shown.map((band) => band.name).join(' · ') + ' · tolerance ' + decoded.tolerance + '%' + (decoded.tempCoeff ? ' · ' + decoded.tempCoeff + ' ppm/K' : ''),
      'Resistance: ' + formatOhms(decoded.ohms),
      'Within tolerance: ' + formatOhms(lower) + ' to ' + formatOhms(upper),
    ].join('\n')
    : [
      'Target: ' + target + ' (' + formatOhms(encoded.ohms) + ')',
      encoded.nearest ? 'Nearest E24 value: ' + formatOhms(encoded.nearest.value) + ', ' + encoded.nearest.error.toFixed(2) + '% away' : '',
      encoded.shape ? 'Bands: ' + encoded.first.name + ', ' + encoded.second.name + ', x10^' + encoded.multiplier + ', gold tolerance' : '',
    ].filter(Boolean).join('\n')), [mode, decoded, lower, upper, target, encoded]);

  const setBand = (index, value) => setBands((current) => current.map((band, position) => (position === index ? value : band)));

  return (
    <ToolShell
      toolId="resistor-code"
      icon={Zap}
      title="Resistor Colour Code"
      desc="Read a resistor from its bands or work out which bands to paint for a value — with tolerance range, temperature coefficient and the nearest standard value."
      state={{ mode, bandCount, bands, tolerance, temp, target }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (restored.bandCount !== undefined) setBandCount(String(restored.bandCount));
        if (Array.isArray(restored.bands) && restored.bands.length) setBands(restored.bands);
        if (restored.tolerance !== undefined) setTolerance(String(restored.tolerance));
        if (restored.temp !== undefined) setTemp(String(restored.temp));
        if (restored.target !== undefined) setTarget(String(restored.target));
      }}
      exportText={report}
      exportName="resistor.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={setMode} options={[{ value: 'decode', label: 'Bands → value' }, { value: 'encode', label: 'Value → bands' }]} />
        {mode === 'decode' && (
          <Seg value={bandCount} onChange={setBandCount} options={[{ value: '4', label: '4 bands' }, { value: '5', label: '5 bands' }, { value: '6', label: '6 bands' }]} />
        )}
        <CopyBtn value={report} label="Copy result" />
      </div>

      <Panel className="!p-3">
        <svg viewBox="0 0 320 70" className="w-full max-w-md">
          <rect x="18" y="22" width="284" height="26" rx="13" fill="#d9c39a" stroke="hsl(var(--border))" />
          <line x1="0" y1="35" x2="20" y2="35" stroke="hsl(var(--muted-foreground))" strokeWidth="2" />
          <line x1="318" y1="35" x2="300" y2="35" stroke="hsl(var(--muted-foreground))" strokeWidth="2" />
          {(mode === 'decode'
            ? Array.from({ length: Number(bandCount) }, (_, index) => BANDS[Number(bands[index] || 0)] || BANDS[0])
            : [encoded.first, encoded.second, { hex: encoded.multiplier >= 0 ? '#111827' : '#d4a017' }, { hex: '#d4a017' }]
          ).map((band, index) => (
            <rect key={index} x={52 + index * 26} y="22" width="11" height="26" fill={band.hex} stroke="rgb(0 0 0 / 0.25)" />
          ))}
        </svg>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {mode === 'decode'
            ? 'Left to right: significant digits, then the multiplier, then tolerance — gold means 5%, silver 10%.'
            : 'Shown as two significant digits, a multiplier band and a gold 5% tolerance band.'}
        </p>
      </Panel>

      {mode === 'decode' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {['Digit 1', 'Digit 2', Number(bandCount) >= 5 ? 'Digit 3' : 'Multiplier'].map((label, index) => (
              <Field key={label} label={label}>
                <select value={bands[index]} onChange={(e) => setBand(index, e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {BANDS.map((band, position) => (
                    <option key={band.name} value={position} disabled={index < 2 && band.value === null}>{band.name}</option>
                  ))}
                </select>
              </Field>
            ))}
            {Number(bandCount) >= 5 && (
              <Field label="Multiplier">
                <select value={bands[2]} onChange={(e) => setBand(2, e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {BANDS.map((band, position) => <option key={band.name} value={position}>{band.name}</option>)}
                </select>
              </Field>
            )}
            {Number(bandCount) === 6 && (
              <Field label="Digit 4">
                <select value={bands[3]} onChange={(e) => setBand(3, e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {BANDS.map((band, position) => <option key={band.name} value={position} disabled={band.value === null}>{band.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Tolerance">
              <select value={tolerance} onChange={(e) => setTolerance(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                {[0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10].map((value) => <option key={value} value={value}>±{value}%</option>)}
              </select>
            </Field>
            {Number(bandCount) === 6 && (
              <Field label="Temperature coefficient">
                <select value={temp} onChange={(e) => setTemp(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {[1, 5, 10, 15, 20, 25, 50, 100, 250].map((value) => <option key={value} value={value}>{value} ppm/K</option>)}
                </select>
              </Field>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              label="Resistance"
              value={formatOhms(decoded.ohms)}
              sub={'±' + decoded.tolerance + '% means anything from ' + formatOhms(lower) + ' to ' + formatOhms(upper) + ' is inside specification for this part.'}
            />
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Bands you selected</div>
              <div className="space-y-1.5">
                {decoded.shown.map((band, index) => (
                  <div key={index} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                    <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: band.hex }} />
                    <span>{band.name}</span>
                    <span className="ml-auto font-mono-j text-muted-foreground">
                      {band.value === null ? 'multiplier' : 'digit ' + band.value}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      ) : (
        <>
          <Field label="Resistance, with an optional k or M suffix">
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="4.7k" className="h-10 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm text-cyan-j" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {['220', '1k', '4.7k', '10k', '47k', '100k', '1M'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setTarget(preset)}
                className={preset === target
                  ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 font-mono-j text-[11px] text-cyan-j'
                  : 'rounded-lg border border-border/70 px-2.5 py-1 font-mono-j text-[11px] text-muted-foreground transition hover:text-foreground'}
              >
                {preset}
              </button>
            ))}
          </div>

          {encoded.error ? (
            <Panel className="border-rose-500/40 text-[12px] text-rose-400">{encoded.error}</Panel>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
              <Hero
                label={'You asked for ' + formatOhms(encoded.ohms)}
                value={encoded.nearest ? formatOhms(encoded.nearest.value) : formatOhms(encoded.ohms)}
                sub={encoded.nearest
                  ? 'The nearest E24 standard value, ' + encoded.nearest.error.toFixed(2) + '% away. Resistors only come in stepped values, so this is the one to order.'
                  : 'No standard value matched.'}
              />
              <Panel className="!p-3">
                <div className="mb-2 text-xs font-medium">Bands to colour</div>
                <div className="space-y-1.5">
                  {[
                    { label: 'Band 1', name: encoded.first.name, hex: encoded.first.hex },
                    { label: 'Band 2', name: encoded.second.name, hex: encoded.second.hex },
                    { label: 'Multiplier', name: 'x10^' + encoded.multiplier, hex: encoded.multiplier >= 0 ? '#111827' : '#d4a017' },
                    { label: 'Tolerance', name: 'Gold 5%', hex: '#d4a017' },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                      <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: row.hex }} />
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="ml-auto">{row.name}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The E24 series — 24 values per decade</div>
          <div className="flex flex-wrap gap-1.5">
            {E24.map((value) => (
              <span key={value} className="rounded-md border border-border/60 px-2 py-0.5 font-mono-j text-[10px] text-muted-foreground">{value}</span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            E24 is the 5% series: the steps sit close enough that the tolerance bands just touch. 4.7 kΩ is a real resistor; 5 kΩ is not — the nearest is 5.1 kΩ, about 2% away.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading bands without mistakes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Find the tolerance band first — gold or silver, slightly apart from the rest. That end is the right-hand end.</p>
            <p>· Four bands: two digits and a multiplier. Five bands: three digits, for precision parts. Six adds temperature drift.</p>
            <p>· Gold and silver never appear as digits, which is what makes the reading direction unambiguous.</p>
            <p>· Multiply, do not append: brown-black-red is 10 × 100 = 1 kΩ, not 102 Ω.</p>
            <p>· Check critical values with a meter — misreading colours under poor light is a classic way to fit the wrong part.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Value" value={mode === 'decode' ? formatOhms(decoded.ohms) : formatOhms(encoded.ohms)} mono />
        <Stat label="Tolerance" value={(mode === 'decode' ? decoded.tolerance : 5) + '%'} mono sub="manufacturing spread" />
        <Stat label="Lowest" value={formatOhms(mode === 'decode' ? lower : (encoded.nearest ? encoded.nearest.value * 0.95 : encoded.ohms * 0.95))} mono />
        <Stat label="Highest" value={formatOhms(mode === 'decode' ? upper : (encoded.nearest ? encoded.nearest.value * 1.05 : encoded.ohms * 1.05))} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Colour reference</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Colour</th>
                <th className="py-1 text-right font-medium">Digit</th>
                <th className="py-1 text-right font-medium">Multiplier</th>
                <th className="py-1 text-right font-medium">Tolerance</th>
                <th className="py-1 text-right font-medium">ppm/K</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {BANDS.map((band) => (
                <tr key={band.name} className="border-t border-border/50">
                  <td className="py-1">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: band.hex }} />
                      {band.name}
                    </span>
                  </td>
                  <td className="py-1 text-right">{band.value === null ? '—' : band.value}</td>
                  <td className="py-1 text-right">{band.multiplier >= 1 ? '×' + band.multiplier : '×' + band.multiplier}</td>
                  <td className="py-1 text-right">{band.tolerance === null ? '—' : '±' + band.tolerance + '%'}</td>
                  <td className="py-1 text-right text-muted-foreground">{band.temp === null ? '—' : band.temp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Mode', value: mode === 'decode' ? 'bands to value' : 'value to bands' },
              { label: 'Bands', value: mode === 'decode' ? bandCount : '4' },
              { label: 'Tolerance', value: (mode === 'decode' ? decoded.tolerance : 5) + '%' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The decode path applies each band's power of ten exactly as the standard defines, and the tolerance range is the real manufacturing spread worth designing
          around. The encode path finds the nearest E24 step and says how far your requested value was from something you can actually buy.
        </p>
      </Panel>
    </ToolShell>
  );
}