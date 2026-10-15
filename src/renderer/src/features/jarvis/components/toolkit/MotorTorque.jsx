import { useMemo, useState } from 'react';
import { Cog } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const LOAD_TYPES = [
  { id: 'fan', label: 'Fan / blower', factor: 1.1, inertiaFactor: 4, start: 'Low starting torque' },
  { id: 'conveyor', label: 'Conveyor', factor: 1.5, inertiaFactor: 3, start: 'High breakaway torque' },
  { id: 'pump', label: 'Centrifugal pump', factor: 1.25, inertiaFactor: 2, start: 'Low, easy start' },
  { id: 'compressor', label: 'Compressor', factor: 1.8, inertiaFactor: 6, start: 'Very high starting torque' },
  { id: 'crusher', label: 'Crusher / mill', factor: 2.2, inertiaFactor: 10, start: 'Shock loads, high inertia' },
];

const SUPPLY = [
  { id: 'single', label: 'Single phase 230 V', volts: 230, phase: 1 },
  { id: 'three', label: 'Three phase 400 V', volts: 400, phase: 3 },
  { id: 'dc24', label: 'DC 24 V', volts: 24, phase: 0 },
  { id: 'dc48', label: 'DC 48 V', volts: 48, phase: 0 },
];

export default function MotorTorque() {
  const [power, setPower] = useState('7.5');
  const [powerUnit, setPowerUnit] = useState('kw');
  const [inputRpm, setInputRpm] = useState('1450');
  const [outputRpm, setOutputRpm] = useState('145');
  const [loadType, setLoadType] = useState('conveyor');
  const [supply, setSupply] = useState('three');
  const [efficiency, setEfficiency] = useState('0.9');
  const [powerFactor, setPowerFactor] = useState('0.85');
  const [startSeconds, setStartSeconds] = useState('3');
  const [extra, setExtra] = useState({ brake: false, flywheel: false, vfd: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const load = LOAD_TYPES.find((entry) => entry.id === loadType) || LOAD_TYPES[1];
    const src = SUPPLY.find((entry) => entry.id === supply) || SUPPLY[1];
    const kw = powerUnit === 'kw' ? Math.max(0.05, Number(power) || 0) : Math.max(0.05, (Number(power) || 0) * 0.7457);
    const hp = kw / 0.7457;
    const nIn = Math.max(1, Number(inputRpm) || 1450);
    const nOut = Math.max(0.5, Number(outputRpm) || nIn);
    const eff = Math.min(0.99, Math.max(0.4, Number(efficiency) || 0.9));
    const pf = Math.min(1, Math.max(0.4, Number(powerFactor) || 0.85));
    const start = Math.max(0.2, Number(startSeconds) || 3);

    const shaftTorque = (9550 * kw) / nIn;
    const motorTorque = (9550 * (kw / eff)) / nIn;
    const outputTorque = shaftTorque * (nIn / nOut);
    const ratio = nIn / nOut;
    const beltSpeedFactor = 1;

    // Duty torque accounts for the load characteristic and service factor.
    const dutyTorque = outputTorque * load.factor;
    const requiredMotorTorque = (motorTorque * load.factor);

    // Inertia and acceleration: rough but honest, assuming a solid cylindrical mass.
    const assumedInertia = (kw / 100) * load.inertiaFactor;
    const alpha = (2 * Math.PI * (nOut / 60)) / start;
    const accelTorque = assumedInertia * alpha;
    const peakTorque = dutyTorque + accelTorque;
    const peakKw = (peakTorque * (nOut * ratio) * 2 * Math.PI) / 60 / 1000 / eff;

    const current = src.phase === 1
      ? (kw * 1000) / (src.volts * eff * pf)
      : src.phase === 3
      ? (kw * 1000) / (Math.sqrt(3) * src.volts * eff * pf)
      : (kw * 1000) / (src.volts * eff * 0.95);
    const startCurrent = current * (extra.vfd ? 1.5 : 6.5);
    const breakerSize = Math.ceil((current * 1.25) / 5) * 5;
    const cableAmps = current * 1.25;

    const heat = kw * (1 - eff);
    const dailyKwh = kw * 8;

    const torqueByRatio = [0.25, 0.5, 1, 1.5, 2, 3].map((factor) => ({
      label: factor.toFixed(2) + ':1',
      value: Number((shaftTorque * factor).toFixed(1)),
    }));

    const warnings = [];
    if (peakKw > kw * 1.4) warnings.push('Accelerating this load needs about ' + peakKw.toFixed(1) + ' kW at the peak — well above the running power. A drive with a ramp setting removes almost all of that demand.');
    if (!extra.vfd && load.inertiaFactor >= 6) warnings.push('Direct-on-line starting pulls roughly six times running current and hits the driven machine hard. Star-delta or a soft starter is the minimum here.');
    if (nOut < 10 && ratio > 40) warnings.push('Output speed of ' + nOut.toFixed(1) + ' rpm at ' + ratio.toFixed(0) + ':1 is a lot for one reduction stage. Two stages will last longer and run cooler.');
    if (eff < 0.75) warnings.push('Efficiency below 75% means a quarter of the electricity becomes heat in the motor. Check the sizing rather than accepting the loss.');
    if (src.phase === 0 && kw > 1.5) warnings.push('Low-voltage DC motors above about 1.5 kW draw very heavy current. Keep cable runs short and size the controller for continuous, not peak, rating.');
    if (load.factor >= 1.8) warnings.push(load.label + ' loads shock the drivetrain. Add a service factor of at least ' + load.factor.toFixed(1) + ' to the gearbox rating, not just the motor.');

    const report = [
      'MOTOR AND DRIVE CALCULATION',
      'Motor: ' + kw.toFixed(2) + ' kW (' + hp.toFixed(2) + ' hp) at ' + nIn + ' rpm, supply ' + src.label,
      'Driven machine: ' + load.label + ', output ' + nOut + ' rpm, reduction ' + ratio.toFixed(2) + ':1',
      'Efficiency ' + Math.round(eff * 100) + '%, power factor ' + pf.toFixed(2),
      '',
      'Shaft torque: ' + shaftTorque.toFixed(2) + ' N·m',
      'Output torque: ' + outputTorque.toFixed(2) + ' N·m',
      'Service factor: ' + load.factor.toFixed(2) + ' -> duty torque ' + dutyTorque.toFixed(1) + ' N·m',
      'Estimated load inertia: ' + assumedInertia.toFixed(2) + ' kg·m²',
      'Acceleration torque: ' + accelTorque.toFixed(2) + ' N·m over ' + start + ' s',
      'Peak torque: ' + peakTorque.toFixed(2) + ' N·m',
      'Peak power demand: ' + peakKw.toFixed(2) + ' kW',
      '',
      'Running current: ' + current.toFixed(2) + ' A',
      'Starting current: ' + startCurrent.toFixed(1) + ' A (' + (extra.vfd ? 'with a drive' : 'direct on line') + ')',
      'Breaker suggestion: ' + breakerSize + ' A, cable rated at least ' + cableAmps.toFixed(1) + ' A',
      'Heat rejected by the motor: ' + heat.toFixed(2) + ' kW',
      'Energy at 8 h/day: ' + dailyKwh.toFixed(1) + ' kWh/day',
      '',
      'Torque by reduction',
      ...torqueByRatio.map((row) => '  ' + row.label + ': ' + row.value.toFixed(1) + ' N·m'),
    ].join('\n');

    return {
      load, src, kw, hp, nIn, nOut, eff, pf, start, shaftTorque, motorTorque, outputTorque, ratio, dutyTorque,
      requiredMotorTorque, assumedInertia, alpha, accelTorque, peakTorque, peakKw, current, startCurrent, breakerSize,
      cableAmps, heat, dailyKwh, torqueByRatio, warnings, report, beltSpeedFactor,
    };
  }, [power, powerUnit, inputRpm, outputRpm, loadType, supply, efficiency, powerFactor, startSeconds, extra]);

  return (
    <ToolShell
      toolId="motor-torque"
      icon={Cog}
      title="Motor Torque, Gearing & Starting Load"
      desc="Turn motor power and speed into shaft and output torque, add the service factor and acceleration demand, then check running and starting current with the supply you actually have."
      state={{ power, powerUnit, inputRpm, outputRpm, loadType, supply, efficiency, powerFactor, startSeconds, extra }}
      onRestore={(restored) => {
        if (restored.power !== undefined) setPower(String(restored.power));
        if (restored.powerUnit) setPowerUnit(restored.powerUnit);
        if (restored.inputRpm !== undefined) setInputRpm(String(restored.inputRpm));
        if (restored.outputRpm !== undefined) setOutputRpm(String(restored.outputRpm));
        if (restored.loadType) setLoadType(restored.loadType);
        if (restored.supply) setSupply(restored.supply);
        if (restored.efficiency !== undefined) setEfficiency(String(restored.efficiency));
        if (restored.powerFactor !== undefined) setPowerFactor(String(restored.powerFactor));
        if (restored.startSeconds !== undefined) setStartSeconds(String(restored.startSeconds));
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="motor-torque.txt"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Driven machine"><Seg value={loadType} onChange={setLoadType} options={LOAD_TYPES.map((entry) => ({ value: entry.id, label: entry.label.split(' ')[0] }))} /></Field>
        <Field label="Supply"><Seg value={supply} onChange={setSupply} options={SUPPLY.map((entry) => ({ value: entry.id, label: entry.label.split(' ')[0] + ' ' + entry.label.split(' ')[1] }))} /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={'Power (' + (powerUnit === 'kw' ? result.hp.toFixed(1) + ' hp' : result.kw.toFixed(2) + ' kW')}>
          <div className="flex gap-2">
            <input value={power} onChange={(e) => setPower(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            <select value={powerUnit} onChange={(e) => setPowerUnit(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono-j text-xs">
              <option value="kw">kW</option>
              <option value="hp">hp</option>
            </select>
          </div>
        </Field>
        <Field label="Motor speed, rpm"><input value={inputRpm} onChange={(e) => setInputRpm(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Output speed, rpm"><input value={outputRpm} onChange={(e) => setOutputRpm(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Start-up time, s"><input value={startSeconds} onChange={(e) => setStartSeconds(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Motor efficiency"><input value={efficiency} onChange={(e) => setEfficiency(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Power factor"><input value={powerFactor} onChange={(e) => setPowerFactor(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Variable speed drive" checked={extra.vfd} onChange={() => toggle('vfd')} hint="Starting current about 1.5x" />
        <ToggleRow label="Flywheel on the shaft" checked={extra.flywheel} onChange={() => toggle('flywheel')} />
        <ToggleRow label="Brake or holding device" checked={extra.brake} onChange={() => toggle('brake')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={result.kw.toFixed(2) + ' kW at ' + result.nIn + ' rpm driving ' + result.load.label.toLowerCase()}
          value={result.outputTorque.toFixed(0)}
          unit="N·m output"
          sub={'Shaft torque is ' + result.shaftTorque.toFixed(1) + ' N·m through a ' + result.ratio.toFixed(2) + ':1 reduction, giving ' + result.outputTorque.toFixed(1) + ' N·m at ' + result.nOut + ' rpm. With the ' + result.load.factor.toFixed(2) + ' service factor the drivetrain should be rated for ' + result.dutyTorque.toFixed(0) + ' N·m.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Starting and supply</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Running current</span><span>{result.current.toFixed(2)} A</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Starting current</span><span className={result.startCurrent > result.cableAmps * 4 ? 'text-amber-400' : 'text-cyan-j'}>{result.startCurrent.toFixed(0)} A</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Breaker</span><span>{result.breakerSize} A</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Cable ampacity</span><span>{result.cableAmps.toFixed(1)} A min</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Motor heat</span><span>{result.heat.toFixed(2)} kW</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Supply', value: result.src.label },
                { label: 'Load type', value: result.load.start, tone: result.load.factor > 1.6 ? 'amber' : undefined },
                { label: 'Ratio', value: result.ratio.toFixed(2) + ':1' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Output torque by reduction ratio</div>
          <Bars data={result.torqueByRatio} suffix=" N·m" format={(v) => v.toFixed(0)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            A reduction multiplies torque and divides speed. The gearbox, shafts and couplings all see the multiplied figure, so they get sized on torque rather than on motor power.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Acceleration demand</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Assumed inertia</span><span>{result.assumedInertia.toFixed(2)} kg·m²</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Angular acceleration</span><span>{result.alpha.toFixed(2)} rad/s²</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Acceleration torque</span><span>{result.accelTorque.toFixed(2)} N·m</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Duty torque</span><span>{result.dutyTorque.toFixed(1)} N·m</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Peak torque</span><span>{result.peakTorque.toFixed(1)} N·m</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Peak power</span><span>{result.peakKw.toFixed(2)} kW</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Shaft torque" value={result.shaftTorque.toFixed(1)} mono sub="N·m at motor" />
        <Stat label="Output torque" value={result.outputTorque.toFixed(0)} mono sub="N·m at load" />
        <Stat label="Service factor" value={result.load.factor.toFixed(2)} mono sub={result.load.label} />
        <Stat label="Running current" value={result.current.toFixed(1)} mono sub="amps per phase" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Engineering catches</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Full calculation sheet</div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting the drivetrain right</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Torque is what does the work; power is torque multiplied by speed. That is why a small fast motor through a big reduction can move a load a large slow motor struggles with.</p>
            <p>· Start-up is where drives fail, not steady running. Breakaway and accelerating torque usually exceed running torque several times over.</p>
            <p>· A service factor is not decoration. Conveyors, compressors and crushers all ask for one, and ignoring it is why gearboxes fail at eighteen months.</p>
            <p>· A variable speed drive converts a six-times starting current into roughly one and a half, and lets the ramp do the acceleration rather than the supply.</p>
            <p>· Keep the motor's own cooling in mind. A motor on a drive running slowly loses its self-cooling and should be inverter-rated or derated.</p>
            <p>· Alignment and belt tension cause more premature failures than overload does. A correctly sized machine badly installed still dies early.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Starting methods compared</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Method</th><th className="py-1 text-right">Start current</th><th className="py-1 pr-2 text-right">Torque</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Direct on line</td><td className="py-1 text-right">6.5×</td><td className="py-1 pr-2 text-right">100%</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Star-delta</td><td className="py-1 text-right">2.5×</td><td className="py-1 pr-2 text-right">33%</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Soft starter</td><td className="py-1 text-right">3×</td><td className="py-1 pr-2 text-right">adjustable</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Variable speed drive</td><td className="py-1 text-right">1.5×</td><td className="py-1 pr-2 text-right">up to 150%</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Auto-transformer</td><td className="py-1 text-right">4×</td><td className="py-1 pr-2 text-right">64%</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Star-delta is cheap but halves breakaway torque, so it fails on conveyors and crushers. A drive costs more and does far more.
          </p>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Torque comes from the standard power-to-torque relationship. Load inertia is estimated from the load family and motor size rather than measured; if you have the driven machine's real inertia, the
          acceleration torque is the figure to trust. Always confirm the motor, gearbox and coupling ratings against the manufacturer's data at your duty point.
        </p>
      </Panel>
    </ToolShell>
  );
}