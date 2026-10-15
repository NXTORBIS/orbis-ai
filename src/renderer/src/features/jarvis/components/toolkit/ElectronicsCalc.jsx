import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

const nearestStandard = (ohms) => {
  if (!ohms || ohms <= 0) return null;
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
  const error = (bestDiff / ohms) * 100;
  const exponent = Math.floor(Math.log10(best)) - 1;
  const first = Math.floor(best / Math.pow(10, exponent) / 10);
  const second = Math.round(best / Math.pow(10, exponent) - first * 10);
  return { value: best, error, first, second, multiplier: exponent + 1 };
};

const format = (value, unit) => {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(3) + ' M' + unit;
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(3) + ' k' + unit;
  if (Math.abs(value) < 0.001 && value !== 0) return (value * 1e6).toFixed(2) + ' µ' + unit;
  return value.toFixed(4) + ' ' + unit;
};

export default function ElectronicsCalc() {
  const [mode, setMode] = useState('divider');
  const [divider, setDivider] = useState({ vin: '12', r1: '10', r2: '4.7' });
  const [led, setLed] = useState({ supply: '5', forward: '2', current: '15', count: '1' });
  const [rc, setRc] = useState({ r: '10', c: '100' });
  const [network, setNetwork] = useState({ r1: '100', r2: '220', r3: '470' });
  const [timer, setTimer] = useState({ r1: '10', r2: '47', c: '10' });

  const result = useMemo(() => {
    if (mode === 'divider') {
      const vin = Number(divider.vin) || 0;
      const r1 = (Number(divider.r1) || 0) * 1000;
      const r2 = (Number(divider.r2) || 0) * 1000;
      if (!r1 + !r2) return { rows: [] };
      const vout = (vin * r2) / (r1 + r2);
      const current = vin / (r1 + r2);
      const p1 = current * current * r1;
      const p2 = current * current * r2;
      return {
        hero: { label: 'Output voltage', value: vout.toFixed(3) + ' V', sub: 'From ' + vin + ' V across ' + r1 / 1000 + ' kΩ and ' + r2 / 1000 + ' kΩ — the ratio of the resistors sets the fraction of the input you see.' },
        ring: { value: vin ? (vout / vin) * 100 : 0, label: 'Share of the input at the output', sub: (vin ? ((vout / vin) * 100).toFixed(1) : 0) + '% of ' + vin + ' V' },
        rows: [
          { label: 'Output voltage', value: format(vout, 'V') },
          { label: 'Current through the chain', value: format(current * 1000, 'A') },
          { label: 'Power in R1', value: format(p1 * 1000, 'W') },
          { label: 'Power in R2', value: format(p2 * 1000, 'W') },
          { label: 'Total power wasted', value: format((p1 + p2) * 1000, 'W') },
          { label: 'Ratio R2 ÷ (R1 + R2)', value: (vin ? (vout / vin).toFixed(4) : '—') },
        ],
        working: [
          'Vout = Vin × R2 ÷ (R1 + R2)',
          'Vout = ' + vin + ' × ' + r2 / 1000 + ' ÷ (' + r1 / 1000 + ' + ' + r2 / 1000 + ') = ' + vout.toFixed(3) + ' V',
          'I = Vin ÷ (R1 + R2) = ' + (current * 1000).toFixed(3) + ' mA',
          'A load across the output changes this answer — keep the load at least ten times R2 for the figure to hold.',
        ],
      };
    }

    if (mode === 'led') {
      const supply = Number(led.supply) || 0;
      const forward = Number(led.forward) || 0;
      const currentA = (Number(led.current) || 0) / 1000;
      const count = Math.max(1, Number(led.count) || 1);
      const drop = forward * count;
      const voltageAcrossResistor = supply - drop;
      if (voltageAcrossResistor <= 0) return { hero: { label: 'Not enough voltage', value: '—', sub: 'The supply must be higher than the total forward voltage of ' + drop.toFixed(1) + ' V before any current can flow.' }, rows: [], working: [] };
      const resistance = voltageAcrossResistor / currentA;
      const standard = nearestStandard(resistance);
      const power = voltageAcrossResistor * currentA;
      return {
        hero: { label: 'Series resistor needed', value: format(resistance, 'Ω'), sub: 'The nearest standard E24 value is ' + (standard ? format(standard.value, 'Ω') : '—') + (standard ? ', ' + standard.error.toFixed(2) + '% away' : '') + '.' },
        ring: { value: Math.min(100, (drop / supply) * 100), label: 'Voltage dropped across the LEDs', sub: drop.toFixed(2) + ' V of the ' + supply + ' V supply is used by ' + count + ' LED' + (count === 1 ? '' : 's') },
        rows: [
          { label: 'Resistance', value: format(resistance, 'Ω') },
          { label: 'Nearest standard', value: standard ? format(standard.value, 'Ω') + ' (' + standard.error.toFixed(2) + '% off)' : '—' },
          { label: 'Voltage across the resistor', value: voltageAcrossResistor.toFixed(3) + ' V' },
          { label: 'Current', value: (currentA * 1000).toFixed(2) + ' mA' },
          { label: 'Power in the resistor', value: (power * 1000).toFixed(2) + ' mW' },
          { label: 'Recommended resistor rating', value: power > 0.5 ? '1 W or more' : power > 0.125 ? '0.25 W' : '0.125 W' },
          { label: 'Band colours for the standard value', value: standard ? standard.first + ' · ' + standard.second + ' · ×10^' + standard.multiplier : '—' },
        ],
        working: [
          'R = (Vsupply − Vforward × count) ÷ I',
          'R = (' + supply + ' − ' + forward + ' × ' + count + ') ÷ ' + currentA.toFixed(3) + ' = ' + resistance.toFixed(2) + ' Ω',
          'P = V × I = ' + voltageAcrossResistor.toFixed(2) + ' × ' + currentA.toFixed(3) + ' = ' + (power * 1000).toFixed(1) + ' mW',
          'Round the resistor up, never down — a smaller resistor means more current and a shorter-lived LED.',
        ],
      };
    }

    if (mode === 'rc') {
      const r = (Number(rc.r) || 0) * 1000;
      const c = (Number(rc.c) || 0) / 1e6;
      const tau = r * c;
      if (!tau) return { rows: [] };
      const cutoff = 1 / (2 * Math.PI * tau);
      return {
        hero: { label: 'Time constant τ', value: format(tau, 's'), sub: 'The capacitor reaches 63.2% of the supply in one time constant, 95% in three and 99.3% in five.' },
        ring: { value: 99.3, max: 100, label: 'Charge after 5τ', sub: 'After ' + format(tau * 5, 's') + ' the capacitor is effectively fully charged' },
        rows: [
          { label: 'Time constant τ = RC', value: format(tau, 's') },
          { label: 'Charge to 1τ (63.2%)', value: format(tau, 's') },
          { label: 'Charge to 3τ (95%)', value: format(tau * 3, 's') },
          { label: 'Charge to 5τ (99.3%)', value: format(tau * 5, 's') },
          { label: 'Half charge (0.693τ)', value: format(tau * 0.693, 's') },
          { label: 'Cut-off frequency', value: format(cutoff, 'Hz') },
          { label: 'Corner period', value: format(1 / cutoff, 's') },
        ],
        working: [
          'τ = R × C',
          'τ = ' + r / 1000 + ' kΩ × ' + c * 1e6 + ' µF = ' + tau.toFixed(4) + ' s',
          'fc = 1 ÷ (2πτ) = ' + cutoff.toFixed(2) + ' Hz',
          'Above the cut-off frequency an RC filter attenuates by 20 dB per decade — useful when you need to smooth a noisy signal.',
        ],
      };
    }

    if (mode === 'network') {
      const r1 = Number(network.r1) || 0;
      const r2 = Number(network.r2) || 0;
      const r3 = Number(network.r3) || 0;
      const series = r1 + r2 + r3;
      const parallel = 1 / ((r1 ? 1 / r1 : 0) + (r2 ? 1 / r2 : 0) + (r3 ? 1 / r3 : 0));
      const twoParallel = r1 + r2 ? (r1 * r2) / (r1 + r2) : 0;
      const capacitorSeries = 1 / ((r1 ? 1 / r1 : 0) + (r2 ? 1 / r2 : 0) + (r3 ? 1 / r3 : 0));
      return {
        hero: { label: 'Three in parallel', value: format(parallel, 'Ω'), sub: 'In series the same resistors sum to ' + format(series, 'Ω') + ' — parallel is always lower than the smallest single resistor.' },
        ring: { value: series ? (parallel / series) * 100 : 0, label: 'Parallel as a share of series', sub: 'Going parallel always drops the total resistance' },
        rows: [
          { label: 'Series total', value: format(series, 'Ω') },
          { label: 'Parallel total', value: format(parallel, 'Ω') },
          { label: 'First two in parallel', value: format(twoParallel, 'Ω') },
          { label: 'Parallel as a share of series', value: (series ? ((parallel / series) * 100).toFixed(2) : '—') + '%' },
          { label: 'Capacitors in series (µF)', value: capacitorSeries.toFixed(3) + ' µF' },
          { label: 'Capacitors in parallel (µF)', value: series.toFixed(3) + ' µF' },
          { label: 'Note', value: 'Capacitors behave the opposite way to resistors' },
        ],
        working: [
          'Series: R = R1 + R2 + R3 = ' + series.toFixed(2) + ' Ω',
          'Parallel: 1/R = 1/R1 + 1/R2 + 1/R3',
          'Parallel total = ' + parallel.toFixed(3) + ' Ω',
          'Two resistors in parallel use the shortcut (R1 × R2) ÷ (R1 + R2) = ' + twoParallel.toFixed(3) + ' Ω',
          'Capacitors add in parallel and combine reciprocally in series — the reverse of resistors.',
        ],
      };
    }

    const r1 = (Number(timer.r1) || 0) * 1000;
    const r2 = (Number(timer.r2) || 0) * 1000;
    const c = (Number(timer.c) || 0) / 1e6;
    const total = (r1 + 2 * r2) * c;
    if (!total) return { rows: [] };
    const frequency = 1.44 / total;
    const high = 0.693 * (r1 + r2) * c;
    const low = 0.693 * r2 * c;
    const duty = total ? ((high / (high + low)) * 100) : 0;
    return {
      hero: { label: 'Oscillator frequency', value: format(frequency, 'Hz'), sub: 'R1 ' + r1 / 1000 + ' kΩ, R2 ' + r2 / 1000 + ' kΩ, C ' + c * 1e6 + ' µF. Below about 50% duty is impossible with this circuit without a diode across R2.' },
      ring: { value: duty, max: 100, label: 'Duty cycle, time high', sub: 'High for ' + format(high, 's') + ', low for ' + format(low, 's') },
      rows: [
        { label: 'Frequency', value: format(frequency, 'Hz') },
        { label: 'Period', value: format(1 / frequency, 's') },
        { label: 'Time high', value: format(high, 's') },
        { label: 'Time low', value: format(low, 's') },
        { label: 'Duty cycle', value: duty.toFixed(2) + '%' },
        { label: 'R1 + 2R2', value: format(r1 + 2 * r2, 'Ω') },
        { label: 'Practical range', value: 'Under 1 Hz the capacitor becomes very large' },
      ],
      working: [
        'f = 1.44 ÷ ((R1 + 2R2) × C)',
        'f = 1.44 ÷ (' + (r1 + 2 * r2).toFixed(0) + ' × ' + c.toExponential(3) + ') = ' + frequency.toFixed(3) + ' Hz',
        'High time = 0.693 × (R1 + R2) × C = ' + high.toFixed(4) + ' s',
        'Low time = 0.693 × R2 × C = ' + low.toFixed(4) + ' s',
        'Duty = (R1 + R2) ÷ (R1 + 2R2) = ' + (duty / 100).toFixed(3) + ', so this circuit never goes below 50%.',
      ],
    };
  }, [mode, divider, led, rc, network, timer]);

  const report = useMemo(() => [
    'Mode: ' + mode,
    result.hero ? result.hero.label + ': ' + result.hero.value : '',
    '',
    ...(result.rows || []).map((row) => row.label + ': ' + row.value),
    '',
    ...(result.working || []),
  ].filter(Boolean).join('\n'), [mode, result]);

  const numberField = (label, value, onChange) => (
    <Field key={label} label={label}>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
    </Field>
  );

  return (
    <ToolShell
      toolId="electronics-calc"
      icon={Zap}
      title="Electronics Calculator"
      desc="Voltage dividers, LED series resistors, RC timing, resistor networks and a 555 astable — each with the working shown and the value nearest to something you can buy."
      state={{ mode, divider, led, rc, network, timer }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (restored.divider) setDivider(restored.divider);
        if (restored.led) setLed(restored.led);
        if (restored.rc) setRc(restored.rc);
        if (restored.network) setNetwork(restored.network);
        if (restored.timer) setTimer(restored.timer);
      }}
      exportText={report}
      exportName="electronics.txt"
    >
      <Seg
        value={mode}
        onChange={setMode}
        options={[
          { value: 'divider', label: 'Voltage divider' },
          { value: 'led', label: 'LED resistor' },
          { value: 'rc', label: 'RC timing' },
          { value: 'network', label: 'Networks' },
          { value: 'timer', label: '555 astable' },
        ]}
      />

      {mode === 'divider' && (
        <div className="grid gap-3 sm:grid-cols-3">
          {numberField('Input voltage, V', divider.vin, (value) => setDivider((current) => ({ ...current, vin: value })))}
          {numberField('R1 to the supply, kΩ', divider.r1, (value) => setDivider((current) => ({ ...current, r1: value })))}
          {numberField('R2 to ground, kΩ', divider.r2, (value) => setDivider((current) => ({ ...current, r2: value })))}
        </div>
      )}

      {mode === 'led' && (
        <div className="grid gap-3 sm:grid-cols-4">
          {numberField('Supply voltage, V', led.supply, (value) => setLed((current) => ({ ...current, supply: value })))}
          {numberField('LED forward voltage, V', led.forward, (value) => setLed((current) => ({ ...current, forward: value })))}
          {numberField('Target current, mA', led.current, (value) => setLed((current) => ({ ...current, current: value })))}
          {numberField('LEDs in series', led.count, (value) => setLed((current) => ({ ...current, count: value })))}
        </div>
      )}

      {mode === 'rc' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {numberField('Resistance, kΩ', rc.r, (value) => setRc((current) => ({ ...current, r: value })))}
          {numberField('Capacitance, µF', rc.c, (value) => setRc((current) => ({ ...current, c: value })))}
        </div>
      )}

      {mode === 'network' && (
        <div className="grid gap-3 sm:grid-cols-3">
          {numberField('R1, Ω', network.r1, (value) => setNetwork((current) => ({ ...current, r1: value })))}
          {numberField('R2, Ω', network.r2, (value) => setNetwork((current) => ({ ...current, r2: value })))}
          {numberField('R3, Ω', network.r3, (value) => setNetwork((current) => ({ ...current, r3: value })))}
        </div>
      )}

      {mode === 'timer' && (
        <div className="grid gap-3 sm:grid-cols-3">
          {numberField('R1, kΩ', timer.r1, (value) => setTimer((current) => ({ ...current, r1: value })))}
          {numberField('R2, kΩ', timer.r2, (value) => setTimer((current) => ({ ...current, r2: value })))}
          {numberField('C, µF', timer.c, (value) => setTimer((current) => ({ ...current, c: value })))}
        </div>
      )}

      {result.hero && (
        <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
          <Hero label={result.hero.label} value={result.hero.value} sub={result.hero.sub} />
          {result.ring && <Ring value={result.ring.value} max={result.ring.max || 100} label={result.ring.label} sub={result.ring.sub} />}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Every value</div>
          <div className="space-y-1.5">
            {(result.rows || []).map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="text-right">{row.value}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The working</span>
            <CopyBtn value={report} label="Copy the result" />
          </div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            {(result.working || []).map((line, index) => (
              <p key={index} className={index === 0 ? 'text-cyan-j' : ''}>{line}</p>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Formulas in use</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>Divider: Vout = Vin × R2 ÷ (R1 + R2)</p>
            <p>LED: R = (Vsupply − Vforward × count) ÷ I</p>
            <p>RC: τ = R C, fc = 1 ÷ (2πRC)</p>
            <p>Parallel: 1/R = 1/R1 + 1/R2 + 1/R3</p>
            <p>555 astable: f = 1.44 ÷ ((R1 + 2R2) C)</p>
            <p>Duty: (R1 + R2) ÷ (R1 + 2R2)</p>
            <p className="text-cyan-j">Ohm's law underpins every one of them: V = I R, P = V I.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Mode', value: mode },
                { label: 'E24 series', value: '5% steps' },
                { label: 'Units', value: 'SI' },
              ]}
            />
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Practical notes from the bench</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A voltage divider is only accurate when the load draws far less current than the divider chain itself — ten times less is the usual rule of thumb.</p>
            <p>· LED current is set by the resistor, never by the LED's voltage. Sizing for 10–20 mA keeps most indicator LEDs bright and long-lived.</p>
            <p>· Always check resistor power: a quarter-watt resistor driven past its rating drifts and eventually fails, usually at the worst moment.</p>
            <p>· RC time constants assume an ideal capacitor. Real electrolytics have wide tolerances, often −20% to +80%, so time the circuit rather than trusting the calculation.</p>
            <p>· A 555 astable cannot go below 50% duty without a diode across R2; if you need a short pulse, that addition is not optional.</p>
            <p>· Keep the load above about 1 kΩ when driving from a divider, or buffer it — the maths changes the moment current actually flows.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Mode" value={mode} mono />
        <Stat label="Primary result" value={result.hero ? result.hero.value : '—'} mono sub={result.hero ? result.hero.label : ''} />
        <Stat label="Values shown" value={String((result.rows || []).length)} mono />
        <Stat label="Working steps" value={String((result.working || []).length)} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Standard resistor values</div>
        <div className="flex flex-wrap gap-1.5">
          {E24.map((value) => (
            <span key={value} className="rounded-md border border-border/60 px-2 py-0.5 font-mono-j text-[10px] text-muted-foreground">{value}</span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Multiply these by a power of ten and you have every commonly available resistor. Designs that ask for anything else will be built from the nearest value in
          this list, which is why the calculator reports it.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Each calculator uses the ideal-component formulas and then reports the nearest standard value and the power dissipated, so the answer is something you can
          actually build rather than a number that only exists on paper.
        </p>
      </Panel>
    </ToolShell>
  );
}