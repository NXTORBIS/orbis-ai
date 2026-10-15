import { useMemo, useState } from 'react';
import { Cog } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const CADENCES = [60, 70, 80, 90, 100, 110];

export default function GearRatioCalculator() {
  const [mode, setMode] = useState('drivetrain');
  const [driveTeeth, setDriveTeeth] = useState('48');
  const [drivenTeeth, setDrivenTeeth] = useState('16');
  const [wheelCirc, setWheelCirc] = useState('2105');
  const [crankLength, setCrankLength] = useState('172.5');
  const [cadence, setCadence] = useState('90');
  const [primary, setPrimary] = useState('1');
  const [gear, setGear] = useState('1');
  const [finalDrive, setFinalDrive] = useState('1');
  const [engineRpm, setEngineRpm] = useState('3000');
  const [tyreCirc, setTyreCirc] = useState('1985');

  const result = useMemo(() => {
    if (mode === 'drivetrain') {
      const drive = Math.max(8, Number(driveTeeth) || 48);
      const driven = Math.max(8, Number(drivenTeeth) || 16);
      const circumference = Math.max(500, Number(wheelCirc) || 2105);
      const crank = Math.max(100, Number(crankLength) || 172.5);
      const rpm = Math.max(20, Number(cadence) || 90);

      const ratio = drive / driven;
      const rollout = (circumference / 1000) * ratio;
      const speed = rollout * rpm * 60 / 1000;
      const gainRatio = ratio * ((circumference / (2 * Math.PI)) / crank);
      const torqueMultiplier = ratio;
      const wheelRadius = circumference / (2 * Math.PI) / 1000;

      const speedTable = CADENCES.map((value) => ({
        label: value + ' rpm',
        value: Number((rollout * value * 60 / 1000).toFixed(2)),
        rpm: value,
      }));

      const cogs = [11, 12, 13, 14, 16, 18, 21, 24, 28, 32].map((teeth) => {
        const cogRatio = drive / teeth;
        return {
          label: teeth + 'T',
          value: Number(((circumference / 1000) * cogRatio * rpm * 60 / 1000).toFixed(1)),
          ratio: cogRatio,
          rollout: (circumference / 1000) * cogRatio,
        };
      });

      const report = [
        'Drivetrain: ' + drive + 'T driving ' + driven + 'T',
        'Ratio ' + ratio.toFixed(2) + ':1 · rollout ' + rollout.toFixed(3) + ' m per crank revolution · gain ratio ' + gainRatio.toFixed(2),
        'Torque at the wheel is ' + torqueMultiplier.toFixed(2) + ' times the torque at the crank.',
        'Speed at ' + rpm + ' rpm is ' + speed.toFixed(1) + ' km/h (' + (speed / 1.60934).toFixed(1) + ' mph).',
        '',
        'Speed at other cadences:',
        ...speedTable.map((entry) => '  ' + entry.label.padEnd(9, ' ') + entry.value.toFixed(2) + ' km/h'),
        '',
        'Speeds with the same chainring at ' + rpm + ' rpm:',
        ...cogs.map((entry) => '  ' + entry.label.padEnd(5, ' ') + entry.ratio.toFixed(2) + ':1  ' + entry.value.toFixed(1) + ' km/h'),
        '',
        'Wheel radius ' + wheelRadius.toFixed(3) + ' m with a crank of ' + crank + ' mm.',
      ].join('\n');

      return {
        mode, ratio, rollout, speed, gainRatio, torqueMultiplier, wheelRadius, speedTable, cogs, report,
        chart: cogs.slice(0, 8),
        speedChart: speedTable,
        mph: speed / 1.60934,
        metresPerSecond: (speed * 1000) / 3600,
      };
    }

    const primaryRatio = Math.max(0.2, Number(primary) || 1);
    const gearRatio = Math.max(0.2, Number(gear) || 1);
    const finalRatio = Math.max(0.2, Number(finalDrive) || 1);
    const circumference = Math.max(500, Number(tyreCirc) || 1985);
    const rpm = Math.max(300, Number(engineRpm) || 3000);

    const totalRatio = primaryRatio * gearRatio * finalRatio;
    const wheelRpm = rpm / totalRatio;
    const speed = (wheelRpm * circumference / 1000) * 60 / 1000;
    const torqueMultiplier = totalRatio;
    const speedPerThousand = (1000 / totalRatio) * circumference / 1000 * 60 / 1000;

    const gearTable = [1, 1.5, 2, 2.5, 3, 3.5, 4].map((value) => {
      const total = primaryRatio * value * finalRatio;
      const wheelRevs = rpm / total;
      return {
        label: 'gear ' + value + ':1',
        value: Number((wheelRevs * circumference / 1000 * 60 / 1000).toFixed(1)),
        speed: (wheelRevs * circumference / 1000) * 60 / 1000,
        ratio: total,
      };
    });

    const report = [
      'Total reduction ' + totalRatio.toFixed(3) + ':1 (' + primaryRatio + ' primary × ' + gearRatio + ' gearbox × ' + finalDrive + ' final)',
      'Wheel speed ' + wheelRpm.toFixed(0) + ' rpm at an engine speed of ' + rpm + ' rpm',
      'Road speed ' + speed.toFixed(1) + ' km/h (' + (speed / 1.60934).toFixed(1) + ' mph)',
      'Torque multiplication ' + torqueMultiplier.toFixed(2) + ':1 at the wheel.',
      'Each additional 1000 rpm adds about ' + speedPerThousand.toFixed(1) + ' km/h.',
      '',
      'Road speed across the gearbox:',
      ...gearTable.map((entry) => '  ' + entry.label.padEnd(11, ' ') + entry.ratio.toFixed(2) + ':1  ' + entry.value.toFixed(1) + ' km/h'),
    ].join('\n');

    return {
      mode, totalRatio, wheelRpm, speed, torqueMultiplier, gearTable, report,
      chart: gearTable,
      speedChart: gearTable,
      mph: speed / 1.60934,
      speedPerThousand,
      metresPerSecond: (speed * 1000) / 3600,
    };
  }, [mode, driveTeeth, drivenTeeth, wheelCirc, crankLength, cadence, primary, gear, finalDrive, engineRpm, tyreCirc]);

  return (
    <ToolShell
      toolId="gear-ratio"
      icon={Cog}
      title="Gear Ratio Calculator"
      desc="Teeth, tyre size and revs into ratio, rollout, gain ratio and road speed — then what each cog or gear does, for bicycles, cars, motorcycles and machinery."
      state={{ mode, driveTeeth, drivenTeeth, wheelCirc, crankLength, cadence, primary, gear, finalDrive, engineRpm, tyreCirc }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (restored.driveTeeth !== undefined) setDriveTeeth(String(restored.driveTeeth));
        if (restored.drivenTeeth !== undefined) setDrivenTeeth(String(restored.drivenTeeth));
        if (restored.wheelCirc !== undefined) setWheelCirc(String(restored.wheelCirc));
        if (restored.crankLength !== undefined) setCrankLength(String(restored.crankLength));
        if (restored.cadence !== undefined) setCadence(String(restored.cadence));
        if (restored.primary !== undefined) setPrimary(String(restored.primary));
        if (restored.gear !== undefined) setGear(String(restored.gear));
        if (restored.finalDrive !== undefined) setFinalDrive(String(restored.finalDrive));
        if (restored.engineRpm !== undefined) setEngineRpm(String(restored.engineRpm));
        if (restored.tyreCirc !== undefined) setTyreCirc(String(restored.tyreCirc));
      }}
      exportText={result.report}
      exportName="gear-ratio.txt"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'drivetrain', label: 'Chain and sprocket' }, { value: 'vehicle', label: 'Vehicle or machine' }]} />

      {mode === 'drivetrain' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Drive teeth (chainring)"><input value={driveTeeth} onChange={(e) => setDriveTeeth(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Driven teeth (cog)"><input value={drivenTeeth} onChange={(e) => setDrivenTeeth(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Wheel circumference, mm"><input value={wheelCirc} onChange={(e) => setWheelCirc(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Crank length, mm"><input value={crankLength} onChange={(e) => setCrankLength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>
          <Field label={'Cadence — ' + cadence + ' rpm'}>
            <input type="range" min="40" max="130" value={cadence} onChange={(e) => setCadence(e.target.value)} className="w-full accent-cyan-j" />
          </Field>
          <div className="grid gap-2 sm:grid-cols-4">
            <button type="button" onClick={() => setWheelCirc('2105')} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j">700 × 25c, 2105 mm</button>
            <button type="button" onClick={() => setWheelCirc('2146')} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j">700 × 32c, 2146 mm</button>
            <button type="button" onClick={() => setWheelCirc('2180')} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j">29 inch MTB, 2180 mm</button>
            <button type="button" onClick={() => setWheelCirc('1650')} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j">20 inch folder, 1650 mm</button>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            <Field label="Primary reduction"><input value={primary} onChange={(e) => setPrimary(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Gearbox ratio"><input value={gear} onChange={(e) => setGear(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Final drive ratio"><input value={finalDrive} onChange={(e) => setFinalDrive(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Engine speed, rpm"><input value={engineRpm} onChange={(e) => setEngineRpm(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Tyre circumference, mm"><input value={tyreCirc} onChange={(e) => setTyreCirc(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Multiply every reduction in the chain into one number. A 3.5:1 primary, a 1.5:1 gearbox and a 4:1 final drive give a total reduction of 21:1.
          </p>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={mode === 'drivetrain' ? 'Ratio' : 'Total reduction'}
          value={mode === 'drivetrain' ? result.ratio.toFixed(2) + ':1' : result.totalRatio.toFixed(2) + ':1'}
          sub={mode === 'drivetrain'
            ? 'Rollout is ' + result.rollout.toFixed(3) + ' m per crank revolution, giving ' + result.speed.toFixed(1) + ' km/h at ' + Number(cadence) + ' rpm. Gain ratio is ' + result.gainRatio.toFixed(2) + ', which is the gear ratio adjusted for wheel and crank size, and the number to use when comparing bicycles of different wheel sizes.'
            : 'The wheel turns at ' + result.wheelRpm.toFixed(0) + ' rpm when the engine turns at ' + Number(engineRpm) + ' rpm, which is ' + result.speed.toFixed(1) + ' km/h on a ' + Number(tyreCirc) + ' mm tyre. Torque at the wheel is ' + result.torqueMultiplier.toFixed(1) + ' times the torque at the input.'}
        />
        <Ring
          value={Math.min(result.mph, 60)}
          max={60}
          tone="cyan"
          label="Road speed"
          sub={result.mph.toFixed(1) + ' mph · ' + result.metresPerSecond.toFixed(2) + ' m/s · ' + result.speed.toFixed(1) + ' km/h'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">{mode === 'drivetrain' ? 'Speed at each cadence' : 'Speed in each gear'}</div>
          <Bars data={result.speedChart.map((entry) => ({ label: entry.label, value: entry.value }))} format={(value) => value.toFixed(1)} suffix=" km/h" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {mode === 'drivetrain'
              ? 'Speed scales linearly with cadence, which is why cadence is the most useful thing to train on a bike.'
              : 'Speed scales linearly with engine speed, so each gear gives a straight line from idle to the redline.'}
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">{mode === 'drivetrain' ? 'The same chainring across a cassette' : 'Gearbox ratios in the same vehicle'}</span>
            <CopyBtn value={result.report} label="Copy the table" />
          </div>
          <div className="max-h-64 space-y-1 overflow-auto">
            {(mode === 'drivetrain' ? result.cogs : result.gearTable).map((entry) => (
              <div key={entry.label} className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
                <span className="w-10 text-muted-foreground">{entry.label}</span>
                <span className="w-20 text-cyan-j">{entry.ratio.toFixed(2)}:1</span>
                <span className="ml-auto">{entry.value.toFixed(1)} km/h</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        {mode === 'drivetrain' ? (
          <>
            <Stat label="Ratio" value={result.ratio.toFixed(2) + ':1'} mono sub="drive teeth ÷ driven teeth" />
            <Stat label="Rollout" value={result.rollout.toFixed(2) + ' m'} mono sub="per crank revolution" />
            <Stat label="Gain ratio" value={result.gainRatio.toFixed(2)} mono sub="size-independent" />
            <Stat label="At " value={Number(cadence) + ' rpm'} mono sub={result.speed.toFixed(1) + ' km/h'} />
          </>
        ) : (
          <>
            <Stat label="Total ratio" value={result.totalRatio.toFixed(2) + ':1'} mono sub="primary × gearbox × final" />
            <Stat label="Wheel speed" value={result.wheelRpm.toFixed(0) + ' rpm'} mono sub="at the road wheel" />
            <Stat label="Torque at wheel" value={result.torqueMultiplier.toFixed(1) + '×'} mono sub="input torque multiplier" />
            <Stat label="Per 1000 rpm" value={result.speedPerThousand.toFixed(1) + ' km/h'} mono sub="speed added" />
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the numbers mean</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Gear ratio compares turns, not speed or effort. A 4:1 ratio means the input turns four times for one turn of the output, with four times the torque and a quarter of the speed at the output.</p>
            <p>· Rollout, in metres per crank revolution, is what a cyclist actually feels: it is how far the bike travels for one push of the pedal.</p>
            <p>· Gain ratio divides the effective wheel radius by the crank length, which finally makes a 26 inch and a 28 inch wheel comparable.</p>
            <p>· Total reduction multiplies through every stage, so long chains of reductions produce very high torque and very low speed — exactly the arrangement in a winch or a mill.</p>
            <p>· Torque and speed trade off precisely: double the reduction and you double the torque while halving the speed.</p>
            <p>· Efficiency falls with each stage and with chain angle. A straight chain line is worth a couple of percent, which over a long ride is real.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Practical notes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Wheel circumference must reflect the tyre actually fitted. A 700 × 23c and a 700 × 32c differ by about 60 mm, which is nearly 3% of every distance and speed above.</p>
            <p>· Measure it properly: mark the tyre, roll one full revolution with weight on the bike, and measure the distance travelled. Published tables are close but not identical to your setup.</p>
            <p>· Cadence between about 80 and 100 rpm suits most riders for sustained effort. Below 70 loads the knees; above 110 becomes a cardiovascular problem before a muscular one.</p>
            <p>· For vehicles the tyre circumference changes with wear and pressure, and the speedometer is usually calibrated with a margin, so expect a few percent of disagreement with GPS.</p>
            <p>· Gear inches are the older equivalent of gain ratio: wheel diameter in inches × the ratio. Rollout in metres is more directly useful for gearing decisions.</p>
            <p>· {mode === 'drivetrain' ? 'A gear of about ' + result.rollout.toFixed(1) + ' m per revolution is on the tall side, which suits flat, fast riding and strong legs.' : 'A total reduction of ' + result.totalRatio.toFixed(1) + ':1 means the input must turn ' + result.totalRatio.toFixed(0) + ' times for one wheel revolution.'}</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Mode', value: mode },
                { label: 'Speed', value: result.speed.toFixed(1) + ' km/h' },
                { label: 'Torque', value: result.torqueMultiplier.toFixed(2) + '×' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>ratio = teeth driving ÷ teeth driven · total reduction = primary × gearbox × final</p>
          <p>rollout = wheel circumference × ratio</p>
          <p>speed = rollout × revolutions per minute × 60 ÷ 1000 in km/h</p>
          <p>gain ratio = ratio × (wheel radius ÷ crank length)</p>
          <p>output speed = input speed ÷ total reduction · output torque = input torque × total reduction</p>
          <p className="text-cyan-j">Check: {mode === 'drivetrain' ? result.rollout.toFixed(3) + ' m × ' + Number(cadence) + ' rpm × 60 ÷ 1000 = ' + result.speed.toFixed(1) + ' km/h.' : Number(engineRpm) + ' rpm ÷ ' + result.totalRatio.toFixed(2) + ' = ' + result.wheelRpm.toFixed(0) + ' rpm at the wheel.'}</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          These are ideal kinematic relationships with no slip, no drivetrain losses and a rigid tyre. Real vehicles lose a few percent through friction, and a loaded tyre has a
          slightly smaller effective rolling radius than its measured circumference.
        </p>
      </Panel>
    </ToolShell>
  );
}