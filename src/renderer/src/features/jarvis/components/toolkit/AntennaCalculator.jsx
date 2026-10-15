import { useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const FEEDLINES = {
  none: { label: 'Direct, no feeder', loss: 0, vf: 1 },
  rg58: { label: 'RG-58, thin coax', loss: 6.5, vf: 0.66 },
  rg8x: { label: 'RG-8X, medium coax', loss: 3.6, vf: 0.82 },
  rg213: { label: 'RG-213, thick coax', loss: 2.2, vf: 0.66 },
  ladder: { label: 'Ladder line, open wire', loss: 0.35, vf: 0.91 },
  catv: { label: 'Hardline or Heliax', loss: 1.1, vf: 0.88 },
};

const BANDS = [
  { label: '160 m', mhz: 1.85 },
  { label: '80 m', mhz: 3.7 },
  { label: '40 m', mhz: 7.1 },
  { label: '20 m', mhz: 14.2 },
  { label: '15 m', mhz: 21.2 },
  { label: '10 m', mhz: 28.5 },
  { label: '6 m', mhz: 50.1 },
  { label: '2 m', mhz: 145 },
  { label: '70 cm', mhz: 433 },
];

export default function AntennaCalculator() {
  const [frequency, setFrequency] = useState('14.2');
  const [feedline, setFeedline] = useState('rg58');
  const [lineLength, setLineLength] = useState('20');
  const [power, setPower] = useState('100');
  const [swr, setSwr] = useState('1.5');
  const [velocityFactor, setVelocityFactor] = useState('0.95');
  const [radius, setRadius] = useState('1');
  const [pathDistance, setPathDistance] = useState('5');

  const result = useMemo(() => {
    const mhz = Math.max(0.1, Number(frequency) || 14.2);
    const line = FEEDLINES[feedline] || FEEDLINES.rg58;
    const length = Math.max(0, Number(lineLength) || 0);
    const watts = Math.max(0.1, Number(power) || 100);
    const swrValue = Math.max(1, Number(swr) || 1);
    const vf = Math.max(0.5, Math.min(1, Number(velocityFactor) || 0.95));
    const wireRadius = Math.max(0.1, Number(radius) || 1);

    const wavelength = 300 / mhz;
    const halfWave = (wavelength / 2) * vf;
    const quarterWave = (wavelength / 4) * vf;
    const fiveEighth = (wavelength * 0.625) * vf;
    const fullWaveLoop = (wavelength) * vf;
    const radialLength = (wavelength / 4) * vf;
    const radialCount = mhz > 50 ? 4 : mhz > 20 ? 8 : 16;

    const reflectorLength = halfWave * 1.05;
    const directorLength = halfWave * 0.95;
    const boomSpacing = wavelength * 0.15;

    const heightForNvis = wavelength * 0.25;
    const groundPlaneAngle = 45;

    const lossDb = (line.loss / 100) * length * Math.sqrt(mhz / 14.2);
    const lossFactor = Math.pow(10, -lossDb / 10);
    const delivered = watts * lossFactor;
    const reflectedFraction = Math.pow((swrValue - 1) / (swrValue + 1), 2);
    const reflected = delivered * reflectedFraction;
    const mismatchLoss = -10 * Math.log10(1 - reflectedFraction);
    const radiated = delivered - reflected;
    const erp = radiated * 1.64;

    const fresnelRadius = Math.sqrt((pathDistance * 1000 * 0.5 * 0.5) / (pathDistance * 1000)) * Math.sqrt(wavelength) * 0.6;

    const shortening = ((1 - vf) * 100).toFixed(1);
    const endEffect = { thin: 0.98, thick: 0.96 };
    const dipoleWithEndEffect = (wavelength / 2) * (wireRadius > 2 ? endEffect.thick : endEffect.thin);

    const bandTable = BANDS.map((band) => ({
      label: band.label,
      value: Number(((300 / band.mhz) / 2 * endEffect.thin).toFixed(2)),
      mhz: band.mhz,
      dipole: (300 / band.mhz) / 2 * endEffect.thin,
    }));

    const lengths = [
      { label: 'Full wave', value: Number(fullWaveLoop.toFixed(2)) },
      { label: 'Half wave', value: Number((wavelength / 2).toFixed(2)) },
      { label: '5/8 wave', value: Number((wavelength * 0.625).toFixed(2)) },
      { label: 'Quarter wave', value: Number((wavelength / 4).toFixed(2)) },
      { label: '1/8 wave', value: Number((wavelength / 8).toFixed(2)) },
    ];

    const swrTable = [1, 1.2, 1.5, 2, 2.5, 3, 5, 10].map((value) => {
      const fraction = Math.pow((value - 1) / (value + 1), 2);
      return {
        label: 'SWR ' + value,
        value: Number(((1 - fraction) * 100).toFixed(1)),
        fraction,
      };
    });

    const warnings = [];
    if (lossDb > 3) warnings.push('Feedline loss is ' + lossDb.toFixed(1) + ' dB, which is ' + ((1 - lossFactor) * 100).toFixed(0) + '% of your power heating the coax. Shorter, thicker or higher-grade line matters more than any antenna tweak.');
    if (swrValue > 2) warnings.push('An SWR of ' + swrValue + ' reflects ' + (reflectedFraction * 100).toFixed(0) + '% of the power delivered, costing ' + mismatchLoss.toFixed(2) + ' dB. Most solid-state rigs will fold back power here.');
    if (swrValue <= 1.5 && lossDb <= 2) warnings.push('An SWR of ' + swrValue + ' costs only ' + mismatchLoss.toFixed(2) + ' dB, which is about the same as breathing on the microphone. Stop tuning and start operating.');
    if (mhz < 2 && lineLength > 30) warnings.push('On the low bands a long coax run is expensive in loss. Ladder line at ' + FEEDLINES.ladder.loss + ' dB per 100 m is the usual answer if the layout allows it.');
    if (lossDb > 0) warnings.push('The cable is not radiating, but its loss is real: ' + (watts - delivered).toFixed(1) + ' W of your ' + watts + ' W never reaches the antenna.');

    const report = [
      mhz + ' MHz · wavelength ' + wavelength.toFixed(3) + ' m',
      '',
      'Half wave dipole ' + halfWave.toFixed(3) + ' m' + ' (with end effect, ' + dipoleWithEndEffect.toFixed(3) + ' m in practice)',
      'Quarter wave vertical ' + quarterWave.toFixed(3) + ' m',
      'Five eighths wave ' + fiveEighth.toFixed(3) + ' m',
      'Full wave loop ' + (fullWaveLoop / 4).toFixed(3) + ' m per side',
      'Ground plane radials: ' + radialCount + ' × ' + radialLength.toFixed(3) + ' m at about ' + groundPlaneAngle + '° down',
      'Yagi starting point: reflector ' + reflectorLength.toFixed(3) + ' m, driven element ' + halfWave.toFixed(3) + ' m, director ' + directorLength.toFixed(3) + ' m, boom spacing ' + boomSpacing.toFixed(3) + ' m',
      '',
      'Feedline ' + line.label + ' over ' + length + ' m: loss ' + lossDb.toFixed(2) + ' dB, so ' + delivered.toFixed(1) + ' W of ' + watts + ' W arrives.',
      'SWR ' + swrValue + ' reflects ' + reflected.toFixed(2) + ' W and costs ' + mismatchLoss.toFixed(2) + ' dB.',
      'Effective radiated power about ' + erp.toFixed(0) + ' W',
      '',
      'NVIS height for short skip on the low bands: ' + heightForNvis.toFixed(2) + ' m',
      'First Fresnel zone radius over ' + pathDistance + ' km: ' + fresnelRadius.toFixed(1) + ' m',
    ].join('\n');

    return {
      mhz, line, length, watts, swrValue, wavelength, halfWave, quarterWave, fiveEighth, fullWaveLoop, dipoleWithEndEffect,
      radialLength, radialCount, reflectorLength, directorLength, boomSpacing, heightForNvis, groundPlaneAngle, lossDb, lossFactor,
      delivered, reflected, mismatchLoss, radiated, erp, fresnelRadius, lengths, swrTable, bandTable, warnings, report, shortening,
      lossesChart: [
        { label: 'Radiated', value: Number(radiated.toFixed(1)) },
        { label: 'Reflected', value: Number(reflected.toFixed(1)) },
        { label: 'Cable loss', value: Number((watts - delivered).toFixed(1)) },
      ],
    };
  }, [frequency, feedline, lineLength, power, swr, velocityFactor, radius, pathDistance]);

  return (
    <ToolShell
      toolId="antenna"
      icon={Radio}
      title="Antenna & Feedline Calculator"
      desc="Frequency into every practical antenna length, plus real feedline loss, the cost of a bad SWR, effective radiated power and the Fresnel zone for a line-of-sight path."
      state={{ frequency, feedline, lineLength, power, swr, velocityFactor, radius, pathDistance }}
      onRestore={(restored) => {
        if (restored.frequency !== undefined) setFrequency(String(restored.frequency));
        if (restored.feedline) setFeedline(restored.feedline);
        if (restored.lineLength !== undefined) setLineLength(String(restored.lineLength));
        if (restored.power !== undefined) setPower(String(restored.power));
        if (restored.swr !== undefined) setSwr(String(restored.swr));
        if (restored.velocityFactor !== undefined) setVelocityFactor(String(restored.velocityFactor));
        if (restored.radius !== undefined) setRadius(String(restored.radius));
        if (restored.pathDistance !== undefined) setPathDistance(String(restored.pathDistance));
      }}
      exportText={result.report}
      exportName="antenna-design.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Frequency, MHz"><input value={frequency} onChange={(e) => setFrequency(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Wire radius, mm"><input value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Transmit power, W"><input value={power} onChange={(e) => setPower(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Measured SWR"><input value={swr} onChange={(e) => setSwr(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Feedline">
          <select value={feedline} onChange={(e) => setFeedline(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {Object.entries(FEEDLINES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
        </Field>
        <Field label="Feedline length, m"><input value={lineLength} onChange={(e) => setLineLength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Path distance, km"><input value={pathDistance} onChange={(e) => setPathDistance(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Shortening factor for a loaded or coiled element">
          <Seg value={velocityFactor} onChange={setVelocityFactor} options={[{ value: '1', label: 'None' }, { value: '0.95', label: 'End effect' }, { value: '0.8', label: 'Loaded' }]} />
        </Field>
        <Field label="Or jump to a band">
          <div className="flex flex-wrap gap-1.5">
            {BANDS.map((band) => (
              <button
                key={band.label}
                type="button"
                onClick={() => setFrequency(String(band.mhz))}
                className="rounded-lg border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
              >
                {band.label}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Half wave dipole"
          value={result.halfWave.toFixed(3)}
          unit="m"
          sub={'At ' + result.mhz + ' MHz the wavelength is ' + result.wavelength.toFixed(3) + ' m. A quarter wave vertical is ' + result.quarterWave.toFixed(3) + ' m, a five eighths wave ' + result.fiveEighth.toFixed(3) + ' m, and shortening for end effect brings the practical dipole to ' + result.dipoleWithEndEffect.toFixed(3) + ' m.'}
        />
        <Ring
          value={result.delivered}
          max={Math.max(10, result.watts)}
          tone={result.lossDb > 3 ? 'amber' : 'emerald'}
          label="Power reaching the antenna"
          sub={result.delivered.toFixed(1) + ' W of ' + result.watts + ' W after ' + result.lossDb.toFixed(2) + ' dB of feeder loss, with ' + result.reflected.toFixed(2) + ' W reflected back'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Element lengths from the same wavelength</div>
          <Bars data={result.lengths} format={(value) => value.toFixed(2)} suffix=" m" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Cut for the centre of the band you use, then remember that a wire antenna can be trimmed in small steps but not lengthened once cut. Start long.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Every element you need</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Wavelength</span><span>{result.wavelength.toFixed(3)} m</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Half wave dipole</span><span className="text-cyan-j">{result.halfWave.toFixed(3)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">With end effect</span><span>{result.dipoleWithEndEffect.toFixed(3)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Quarter wave vertical</span><span>{result.quarterWave.toFixed(3)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Radials for a ground plane</span><span>{result.radialCount} × {result.radialLength.toFixed(3)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Yagi reflector</span><span>{result.reflectorLength.toFixed(3)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Yagi director</span><span>{result.directorLength.toFixed(3)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Element spacing on a boom</span><span>{result.boomSpacing.toFixed(3)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">NVIS height for short skip</span><span>{result.heightForNvis.toFixed(2)} m</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Wavelength" value={result.wavelength.toFixed(2) + ' m'} mono sub={Math.round(result.mhz * 1000) + ' kHz'} />
        <Stat label="Feeder loss" value={result.lossDb.toFixed(2) + ' dB'} mono sub={((1 - result.lossFactor) * 100).toFixed(0) + '% of power lost'} />
        <Stat label="Mismatch loss" value={result.mismatchLoss.toFixed(2) + ' dB'} mono sub={'SWR ' + result.swrValue} />
        <Stat label="Effective radiated" value={result.erp.toFixed(0) + ' W'} mono sub="with a dipole's 1.64 gain" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where your watts actually go</div>
          <Bars data={result.lossesChart} format={(value) => value.toFixed(1)} suffix=" W" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Reflected power is not lost — it comes back down the line and gets re-reflected, eventually leaving the antenna or heating the cable. Cable loss, on the other hand,
            is gone for good.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What SWR actually costs you</div>
          <Bars data={result.swrTable} format={(value) => value.toFixed(1)} suffix="% delivered" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            An SWR of 2 delivers about 89% of the power, a loss of less than 0.5 dB — inaudible at the other end. Above 3 the transmitter's protection becomes the real problem,
            not the loss.
          </p>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {result.warnings.map((line) => <p key={line}>· {line}</p>)}
          <p>· A resonant antenna is not the goal in itself. Any antenna with a matching network and low feeder loss radiates; resonance only makes matching convenient.</p>
          <p>· Height does more for your signal than length. On the low bands, raising a dipole from a quarter wave to a half wave changes the radiation angle and can be worth several dB in the direction that matters.</p>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Building and tuning it</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Cut 2% long, then trim. Every cut affects resonance predictably, and a wire that is too long is easy to fix while one that is too short needs replacing.</p>
            <p>· Keep the ends away from walls, gutters and metalwork. Proximity detunes the element and absorbs power, and the effect is worse at the ends than in the middle.</p>
            <p>· Feed at the current maximum, which for a dipole is the centre. Off-centre feeding trades a little efficiency for a multi-band match.</p>
            <p>· Use a balun at the feed point of a balanced antenna. Without one, the outside of the coax becomes part of the antenna and your pattern, your noise floor and your interference all get worse.</p>
            <p>· Ground the mast and use a choke or a lightning arrestor. Antennas are the tallest thing in the garden, which makes them the best path to earth.</p>
            <p>· Raise ground-plane radials at about {result.groundPlaneAngle}° and use at least {result.radialCount} of them for a predictable pattern, or bury a lot more of them for a low-angle vertical.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Choosing an antenna for what you want</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· For local contacts on the low bands, a horizontal dipole low to the ground gives high-angle radiation — NVIS — and covers a few hundred kilometres well.</p>
            <p>· For long distance, you want low radiation angles. That means height on the low bands and a vertical, a beam or a sloping wire on the higher ones.</p>
            <p>· On the VHF and UHF bands, height and line of sight dominate everything. Get above the roofline before spending money on gain.</p>
            <p>· A simple quarter-wave ground plane on 2 m outperforms an expensive compromise antenna. Simple, well-made and well-placed wins.</p>
            <p>· Ferrite chokes on the coax are often the single biggest improvement available for receive noise, and they cost almost nothing.</p>
            <p>· On a line-of-sight path, keep the first Fresnel zone clear — about {result.fresnelRadius.toFixed(1)} m at the midpoint of this {result.pathDistance} km link. Buildings and trees intruding into that zone cost far more than a small change in antenna gain.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Band', value: result.mhz + ' MHz' },
                { label: 'Dipole', value: result.halfWave.toFixed(2) + ' m' },
                { label: 'Feeder', value: result.lossDb.toFixed(2) + ' dB' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>wavelength = 300 ÷ frequency in MHz</p>
          <p>dipole = λ ÷ 2 × 0.95 for end effect · vertical = λ ÷ 4 · five eighths = λ × 0.625</p>
          <p>feeder loss scales with the square root of frequency relative to the reference band</p>
          <p>reflected fraction = ((SWR − 1) ÷ (SWR + 1))² · mismatch loss = −10 log₁₀(1 − reflected fraction)</p>
          <p>effective radiated power = radiated power × 1.64 for a dipole over a perfect ground</p>
          <p>first Fresnel zone radius = 8.66 √(d₁ d₂ ÷ (f × D)) with distances in kilometres and frequency in gigahertz</p>
          <p className="text-cyan-j">Check: 300 ÷ {result.mhz} MHz = {result.wavelength.toFixed(3)} m, so a half wave is {(result.wavelength / 2).toFixed(3)} m.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Feedline loss figures are typical published values for a good cable at these frequencies and do not include connector losses, which add roughly 0.1 dB per joint.
          Real installations suffer from nearby metalwork, ground conductivity and height, none of which this arithmetic can see.
        </p>
      </Panel>
    </ToolShell>
  );
}