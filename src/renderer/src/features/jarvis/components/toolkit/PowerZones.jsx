import { useMemo, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { Field, Panel, Stat } from './shared';

const ZONES = [
  { id: 1, label: 'Active recovery', from: 0, to: 0.55, use: 'Between intervals, warm-ups and easy spins. Conversational, no training stress worth counting.' },
  { id: 2, label: 'Endurance', from: 0.56, to: 0.75, use: 'The bulk of aerobic training. All-day pace, full sentences, most of your weekly hours belong here.' },
  { id: 3, label: 'Tempo', from: 0.76, to: 0.9, use: 'Steady, purposeful work. Short sentences only. Useful for sustained efforts of 20 to 60 minutes.' },
  { id: 4, label: 'Threshold', from: 0.91, to: 1.05, use: 'FTP and 20–60 minute maximum efforts. The most productive zone, and the one that needs recovery after.' },
  { id: 5, label: 'VO₂ max', from: 1.06, to: 1.2, use: 'Three to eight minute efforts. Sharp breathing, high cost, twice a week at most.' },
  { id: 6, label: 'Anaerobic', from: 1.21, to: 1.5, use: 'Thirty seconds to three minutes. Attacks, sprints and surges; race-winning, recovery-hungry.' },
  { id: 7, label: 'Neuromuscular', from: 1.51, to: 2.2, use: 'Under thirty seconds, maximal. Sprints and jumps, measured in seconds of work not minutes.' },
];

const CATEGORIES = [
  { label: 'Untrained', value: 2.0 },
  { label: 'Fair', value: 2.5 },
  { label: 'Good', value: 3.2 },
  { label: 'Very good', value: 3.9 },
  { label: 'Excellent', value: 4.6 },
  { label: 'World class', value: 5.7 },
];

const AIR_DENSITY = 1.225;

export default function PowerZones() {
  const [ftp, setFtp] = useState(250);
  const [weight, setWeight] = useState(72);
  const [climb, setClimb] = useState({ mass: 82, gradient: 7, speed: 12, cda: 0.32, crr: 0.005, efficiency: 0.97 });
  const setC = (key, value) => setClimb((current) => ({ ...current, [key]: value }));

  const zones = useMemo(() => {
    const value = Number(ftp) || 0;
    const kg = Number(weight) || 1;
    return ZONES.map((zone) => {
      const low = Math.round(value * zone.from);
      const high = zone.to >= 2 ? null : Math.round(value * zone.to);
      return { ...zone, low, high, lowWkg: low / kg, highWkg: high ? high / kg : null };
    });
  }, [ftp, weight]);

  const wPerKg = (Number(ftp) || 0) / (Number(weight) || 1);
  const category = useMemo(() => {
    const match = CATEGORIES.filter((entry) => wPerKg >= entry.value).pop();
    return match ? match.label : 'Below untrained';
  }, [wPerKg]);

  const climbing = useMemo(() => {
    const mass = Number(climb.mass) || 0;
    const gradient = (Number(climb.gradient) || 0) / 100;
    const cda = Number(climb.cda) || 0;
    const crr = Number(climb.crr) || 0;
    const efficiency = Number(climb.efficiency) || 1;
    const speedKmh = Number(climb.speed) || 0;
    const speed = speedKmh / 3.6;
    const angle = Math.atan(gradient);

    const powerFor = (v) => {
      const gravity = mass * 9.80665 * Math.sin(angle) * v;
      const rolling = crr * mass * 9.80665 * Math.cos(angle) * v;
      const air = 0.5 * AIR_DENSITY * cda * v * v * v;
      return (gravity + rolling + air) / efficiency;
    };

    const required = powerFor(speed);
    const vam = speedKmh * 1000 * (gradient / Math.sqrt(1 + gradient * gradient));
    const wPerKgClimb = required / (Number(weight) || 1);
    const gravityShare = speed > 0 ? ((mass * 9.80665 * Math.sin(angle) * speed) / (required * efficiency)) * 100 : 0;
    const rollingShare = speed > 0 ? ((crr * mass * 9.80665 * Math.cos(angle) * speed) / (required * efficiency)) * 100 : 0;
    const airShare = Math.max(0, 100 - gravityShare - rollingShare);

    let low = 0.5;
    let high = 30;
    for (let step = 0; step < 60; step += 1) {
      const middle = (low + high) / 2;
      if (powerFor(middle) < required) low = middle;
      else high = middle;
    }
    const samePowerAt8 = (() => {
      const target = required;
      const targetAngle = Math.atan(0.08);
      const powerAt = (v) => (mass * 9.80665 * Math.sin(targetAngle) * v + crr * mass * 9.80665 * Math.cos(targetAngle) * v + 0.5 * AIR_DENSITY * cda * v * v * v) / efficiency;
      let a = 0.5;
      let b = 30;
      for (let step = 0; step < 60; step += 1) {
        const middle = (a + b) / 2;
        if (powerAt(middle) < target) a = middle;
        else b = middle;
      }
      return ((a + b) / 2) * 3.6;
    })();

    return { required, vam, wPerKgClimb, gravityShare, rollingShare, airShare, samePowerAt8, mass, gradient: Number(climb.gradient) || 0 };
  }, [climb, weight]);

  const zoneForClimb = useMemo(() => {
    const value = Number(ftp) || 0;
    if (!value) return null;
    return zones.find((zone) => climbing.required >= zone.low && (zone.high === null || climbing.required <= zone.high)) || (climbing.required > value * 2.2 ? zones[6] : zones[0]);
  }, [climbing, zones, ftp]);

  const report = [
    'Power zones',
    '',
    'FTP ' + ftp + ' W · weight ' + weight + ' kg · ' + wPerKg.toFixed(2) + ' W/kg (' + category + ')',
    '',
    ...zones.map((zone) => zone.label.padEnd(18) + zone.low + (zone.high ? '–' + zone.high : '+') + ' W  (' + zone.lowWkg.toFixed(1) + (zone.highWkg ? '–' + zone.highWkg.toFixed(1) : '+') + ' W/kg)'),
    '',
    'Climb at ' + climb.gradient + '% and ' + climb.speed + ' km/h: ' + climbing.required.toFixed(0) + ' W (' + climbing.wPerKgClimb.toFixed(2) + ' W/kg), ' + Math.round(climbing.vam) + ' m/h',
    'Gravity ' + climbing.gravityShare.toFixed(0) + '% · rolling ' + climbing.rollingShare.toFixed(0) + '% · air ' + climbing.airShare.toFixed(0) + '%',
  ].join('\n');

  return (
    <ToolShell
      toolId="power-zones"
      icon={HeartPulse}
      title="Cycling Power Zones & Climbing"
      desc="Turn an FTP into the seven training zones with their watt ranges and W/kg, and work out the power a climb actually demands at a given speed — including how much of it simply fights gravity."
      state={{ ftp, weight, climb }}
      onRestore={(restored) => {
        if (restored.ftp !== undefined) setFtp(restored.ftp);
        if (restored.weight !== undefined) setWeight(restored.weight);
        if (restored.climb && typeof restored.climb === 'object') setClimb({ ...climb, ...restored.climb });
      }}
      exportText={report}
      exportName="power-zones.txt"
    >
      <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <Panel className="!p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="FTP (watts)" hint="The best power you can hold for about an hour."><Input type="number" value={ftp} onChange={(event) => setFtp(event.target.value)} /></Field>
            <Field label="Body weight (kg)"><Input type="number" step="0.5" value={weight} onChange={(event) => setWeight(event.target.value)} /></Field>
          </div>
          <div className="mt-3">
            <div className="mb-2 text-xs font-medium">Zones at {ftp} W · {wPerKg.toFixed(2)} W/kg ({category})</div>
            <div className="space-y-1.5">
              {zones.map((zone) => (
                <div key={zone.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
                  <span className="text-xs">
                    <span className="mr-2 font-mono-j text-[10px] text-muted-foreground">Z{zone.id}</span>
                    {zone.label}
                  </span>
                  <span className="font-mono-j text-xs text-cyan-j">{zone.low}{zone.high ? '–' + zone.high : '+'} W</span>
                  <span className="font-mono-j text-[11px] text-muted-foreground">{zone.lowWkg.toFixed(1)}{zone.highWkg ? '–' + zone.highWkg.toFixed(1) : '+'} W/kg</span>
                  <span className="w-full text-[11px] text-muted-foreground lg:w-auto">{zone.use}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">The climb</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Total mass (kg)" hint="Rider, bike and kit."><Input type="number" step="0.5" value={climb.mass} onChange={(event) => setC('mass', event.target.value)} /></Field>
              <Field label="Gradient (%)"><Input type="number" step="0.5" value={climb.gradient} onChange={(event) => setC('gradient', event.target.value)} /></Field>
              <Field label="Speed (km/h)"><Input type="number" step="0.5" value={climb.speed} onChange={(event) => setC('speed', event.target.value)} /></Field>
              <Field label="Frontal area (m²)"><Input type="number" step="0.01" value={climb.cda} onChange={(event) => setC('cda', event.target.value)} /></Field>
              <Field label="Rolling resistance"><Input type="number" step="0.0005" value={climb.crr} onChange={(event) => setC('crr', event.target.value)} /></Field>
              <Field label="Drivetrain efficiency"><Input type="number" step="0.01" value={climb.efficiency} onChange={(event) => setC('efficiency', event.target.value)} /></Field>
            </div>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-[1.1fr_1fr]">
            <Hero
              tone={zoneForClimb && zoneForClimb.id >= 4 ? 'rose' : 'emerald'}
              label="Power to hold that speed"
              value={climbing.required.toFixed(0)}
              unit="W"
              sub={climbing.wPerKgClimb.toFixed(2) + ' W/kg · ' + Math.round(climbing.vam) + ' m of climbing an hour'}
            />
            <Ring
              value={climbing.required}
              max={Math.max(200, (Number(ftp) || 100) * 1.6)}
              tone={zoneForClimb && zoneForClimb.id >= 4 ? 'rose' : 'emerald'}
              label="Share of your FTP"
              sub={'about ' + (climbing.required / (Number(ftp) || 1) * 100).toFixed(0) + '% · ' + (zoneForClimb ? zoneForClimb.label : 'off the scale')}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the watts go</div>
          <Bars
            data={[
              { label: 'Gravity', value: climbing.gravityShare },
              { label: 'Air', value: climbing.airShare },
              { label: 'Rolling', value: climbing.rollingShare },
            ]}
            format={(value) => value.toFixed(0)}
            suffix="%"
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            At {climbing.gradient}% gravity takes {climbing.gravityShare.toFixed(0)}% of the effort and air resistance only {climbing.airShare.toFixed(0)}%. This is why
            weight matters so much uphill and aerodynamics matter so little: on the flat the proportions reverse completely. Holding the same {climbing.required.toFixed(0)} W
            on an 8% ramp would give you about {climbing.samePowerAt8.toFixed(1)} km/h.
          </p>
        </Panel>

        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the numbers mean</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· At {wPerKg.toFixed(2)} W/kg you sit in the {category.toLowerCase()} range for an hour-long effort. The gap to the next category is {((CATEGORIES.find((entry) => entry.value > wPerKg)?.value ?? wPerKg) - wPerKg).toFixed(2)} W/kg, or about {Math.round(((CATEGORIES.find((entry) => entry.value > wPerKg)?.value ?? wPerKg) - wPerKg) * (Number(weight) || 0))} W.</p>
            <p>· Threshold sits at {zones[3].low}–{zones[3].high} W. Anything held in this zone for more than an hour means your FTP estimate is too low.</p>
            <p>· The three training zones that matter most are 2, 4 and 5: most hours in endurance, one or two hard threshold sessions, and short VO₂ work twice a week at most.</p>
            <p>· Zone 7 lasts seconds. If you can hold it for a minute, it is zone 6 or lower.</p>
            <p>· Climbing at {climbing.wPerKgClimb.toFixed(2)} W/kg for an hour is a strong effort; most riders cannot repeat it the next day.</p>
            <p>· Losing 1 kg at this gradient saves roughly {((9.80665 * Math.sin(Math.atan(climbing.gradient / 100)) * (Number(climb.speed) / 3.6)) / (Number(climb.efficiency) || 1)).toFixed(0)} W at the same speed — the same as weeks of fitness work.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'FTP', value: ftp + ' W' },
                { label: 'W/kg', value: wPerKg.toFixed(2) },
                { label: 'Climb', value: climbing.required.toFixed(0) + ' W' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="VAM" value={Math.round(climbing.vam) + ' m/h'} mono sub="vertical metres per hour" />
        <Stat label="Same power at 8%" value={climbing.samePowerAt8.toFixed(1) + ' km/h'} mono sub="holding this wattage" />
        <Stat label="Gravity share" value={climbing.gravityShare.toFixed(0) + '%'} mono sub="of the total demand" />
        <Stat label="Zone required" value={zoneForClimb ? 'Z' + zoneForClimb.id : '—'} mono sub={zoneForClimb ? zoneForClimb.label : 'no FTP set'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Setting zones honestly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· FTP from a proper test beats FTP from an estimate. A 20-minute test at 95% of average power, done rested, is the usual field method.</p>
            <p>· Retest every four to six weeks. Zones based on a stale number quietly turn endurance rides into threshold rides.</p>
            <p>· Indoor and outdoor FTP differ, often by 5–10%. Set separate numbers if you train in both, rather than splitting the difference.</p>
            <p>· These percentages are one convention among several. What matters is that you use the same one consistently, so your zones mean the same thing week to week.</p>
            <p>· Heart rate lags power badly above threshold. Pace zones by power and use heart rate only as a cross-check.</p>
            <p>· Recovery weeks are not optional. Zone 4 and 5 work is where fitness is built and where overtraining starts.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The physics behind the climb</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Power to climb = gravity + rolling resistance + aerodynamic drag, all divided by drivetrain efficiency.</p>
            <p>· Gravity scales with mass × g × sin(angle) × speed, so it grows linearly with both mass and gradient.</p>
            <p>· Drag scales with the cube of speed. On a climb at 12 km/h it is almost irrelevant; on the flat at 40 km/h it is nearly everything.</p>
            <p>· Rolling resistance scales with mass and speed but shrinks with gradient, because the normal force drops as the road tilts.</p>
            <p>· Air density of 1.225 kg/m³ assumes sea level at 15 °C. At 2,000 m the air is noticeably thinner, so the same power buys a little more speed.</p>
            <p>· VAM is vertical metres gained per hour, and it is a better comparison between riders and gradients than average speed. Near 1,000 m/h is strong club level; above 1,600 m/h is professional.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Zones are percentages of the FTP you enter, following the seven-zone convention. Climbing power is the standard steady-state model — gravity, rolling resistance
          and drag against drivetrain efficiency — evaluated at your chosen speed, with the shares shown so you can see which force dominates. Road surface, wind, altitude
          and how smoothly you ride will all move the real number, so use this as the shape of the effort rather than a prediction to the watt.
        </p>
      </Panel>
    </ToolShell>
  );
}