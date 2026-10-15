import { useMemo, useState } from 'react';
import { Wrench } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const METRIC = [
  { label: 'M5 × 0.8', d: 5, pitch: 0.8, area: 14.2, class8: 580, class10: 830, class12: 970 },
  { label: 'M6 × 1.0', d: 6, pitch: 1, area: 20.1, class8: 580, class10: 830, class12: 970 },
  { label: 'M8 × 1.25', d: 8, pitch: 1.25, area: 36.6, class8: 580, class10: 830, class12: 970 },
  { label: 'M10 × 1.5', d: 10, pitch: 1.5, area: 58, class8: 580, class10: 830, class12: 970 },
  { label: 'M12 × 1.75', d: 12, pitch: 1.75, area: 84.3, class8: 580, class10: 830, class12: 970 },
  { label: 'M16 × 2.0', d: 16, pitch: 2, area: 157, class8: 580, class10: 830, class12: 970 },
  { label: 'M20 × 2.5', d: 20, pitch: 2.5, area: 245, class8: 580, class10: 830, class12: 970 },
  { label: 'M24 × 3.0', d: 24, pitch: 3, area: 353, class8: 580, class10: 830, class12: 970 },
];

const IMPERIAL = [
  { label: '1/4-20 UNC', d: 6.35, pitch: 1.27, area: 0.0318, grade2: 380, grade5: 630, grade8: 830 },
  { label: '5/16-18 UNC', d: 7.94, pitch: 1.41, area: 0.0524, grade2: 380, grade5: 630, grade8: 830 },
  { label: '3/8-16 UNC', d: 9.53, pitch: 1.59, area: 0.0775, grade2: 380, grade5: 630, grade8: 830 },
  { label: '1/2-13 UNC', d: 12.7, pitch: 1.95, area: 0.1419, grade2: 380, grade5: 630, grade8: 830 },
  { label: '5/8-11 UNC', d: 15.88, pitch: 2.31, area: 0.2258, grade2: 380, grade5: 630, grade8: 830 },
  { label: '3/4-10 UNC', d: 19.05, pitch: 2.54, area: 0.3345, grade2: 380, grade5: 630, grade8: 830 },
];

const LUBRICATION = {
  dry: { label: 'Dry, as-rolled', k: 0.2 },
  oiled: { label: 'Lightly oiled', k: 0.16 },
  waxed: { label: 'Waxed or PTFE coated', k: 0.12 },
  antis: { label: 'Anti-seize compound', k: 0.14 },
};

export default function BoltTorqueCalculator() {
  const [standard, setStandard] = useState('metric');
  const [metricSize, setMetricSize] = useState('M10 × 1.5');
  const [imperialSize, setImperialSize] = useState('1/2-13 UNC');
  const [grade, setGrade] = useState('class8');
  const [lubrication, setLubrication] = useState('oiled');
  const [preload, setPreload] = useState('75');
  const [count, setCount] = useState('4');
  const [shearPlanes, setShearPlanes] = useState('1');
  const [gripLength, setGripLength] = useState('40');

  const result = useMemo(() => {
    const table = standard === 'metric' ? METRIC : IMPERIAL;
    const size = table.find((row) => row.label === (standard === 'metric' ? metricSize : imperialSize)) || table[3];
    const gradeKey = standard === 'metric' ? (grade.startsWith('class') ? grade : 'class8') : (grade.startsWith('grade') ? grade : 'grade5');
    const proofStrength = size[gradeKey] || (standard === 'metric' ? 580 : 630);
    const lube = LUBRICATION[lubrication] || LUBRICATION.oiled;
    const targetPreload = Math.max(20, Math.min(95, Number(preload) || 75)) / 100;

    const areaMm2 = standard === 'metric' ? size.area : size.area * 645.16;
    const forceN = targetPreload * proofStrength * areaMm2;
    const forceKn = forceN / 1000;
    const torqueNm = (lube.k * (size.d / 1000) * forceN);
    const torqueFtLb = torqueNm * 0.7376;
    const yieldStress = proofStrength;
    const shearStrengthN = 0.6 * yieldStress * areaMm2 * Math.max(1, Number(shearPlanes) || 1);
    const shearKn = shearStrengthN / 1000;
    const tensionStress = forceN / areaMm2;
    const stretch = (forceN * Math.max(5, Number(gripLength) || 40)) / (areaMm2 * 205000) * 1000;
    const totalForceKn = forceKn * Math.max(1, Number(count) || 1);
    const totalTorque = torqueNm * Math.max(1, Number(count) || 1);
    const threadEngagement = standard === 'metric' ? 1.5 * size.d : 1.5 * size.d;
    const engagementMet = true;

    const torqueTable = [60, 65, 70, 75, 80, 85, 90].map((percent) => {
      const value = (lube.k * (size.d / 1000) * ((percent / 100) * proofStrength * areaMm2));
      return { label: percent + '%', value: Number(value.toFixed(1)) };
    });

    const lubeCompare = Object.entries(LUBRICATION).map(([key, value]) => ({
      label: key,
      value: Number((value.k * (size.d / 1000) * forceN).toFixed(1)),
      k: value.k,
    }));

    const warnings = [];
    if (lube.k <= 0.14) warnings.push('With lubrication this effective, torque is ' + ((1 - lube.k / 0.2) * 100).toFixed(0) + '% lower than dry for the same preload. Applying a dry-torque table to a lubricated bolt overloads it badly, and that is the most common way bolts are broken by hand.');
    if (targetPreload >= 0.9) warnings.push('You are targeting ' + (targetPreload * 100).toFixed(0) + '% of proof load. Production practice is 65 to 75%; above 90% the bolt is being used as a spring at its limit and relaxation or failure follows.');
    if (size.d <= 6 && standard === 'metric') warnings.push('Small bolts are torque-sensitive. A torque wrench with a 20% tolerance is a large error at M6, so measure stretch where it matters.');
    if (tensionStress > proofStrength) warnings.push('Tension stress exceeds the proof strength, which is not physically achievable — preload cannot exceed the proof load.');
    if (!warnings.length) warnings.push('Preload is ' + (targetPreload * 100).toFixed(0) + '% of proof load, which sits in the normal range. Torque is calculated for ' + lube.label.toLowerCase() + ', so the friction assumption matches the joint.');

    const report = [
      size.label + ' at ' + gradeKey.replace('class', 'property class ').replace('grade', 'grade ') + ', ' + lube.label.toLowerCase(),
      '',
      'Stress area ' + areaMm2.toFixed(1) + ' mm² · proof strength ' + proofStrength + ' MPa',
      'Target preload ' + forceKn.toFixed(1) + ' kN (' + (targetPreload * 100).toFixed(0) + '% of proof load)',
      'Tightening torque ' + torqueNm.toFixed(1) + ' Nm (' + torqueFtLb.toFixed(1) + ' ft·lb)',
      'Bolt stretch ' + stretch.toFixed(3) + ' mm over a grip of ' + gripLength + ' mm',
      'Shear capacity ' + shearKn.toFixed(1) + ' kN across ' + shearPlanes + ' plane' + (Number(shearPlanes) > 1 ? 's' : ''),
      'Minimum thread engagement ' + threadEngagement.toFixed(1) + ' mm (1.5 × diameter)',
      '',
      Number(count) > 1 ? 'For ' + count + ' bolts: ' + totalForceKn.toFixed(1) + ' kN total clamp force and ' + totalTorque.toFixed(0) + ' Nm of tightening in total.' : '',
      '',
      'Torque at other preload targets: ' + torqueTable.map((entry) => entry.label + ' ' + entry.value + ' Nm').join(' · '),
      '',
      ...warnings,
    ].join('\n');

    return {
      size, proofStrength, lube, areaMm2, forceKn, torqueNm, torqueFtLb, shearKn, tensionStress, stretch, totalForceKn, totalTorque,
      threadEngagement, engagementMet, torqueTable, lubeCompare, warnings, targetPreload, count: Math.max(1, Number(count) || 1), report,
      chart: torqueTable,
      gradeLabel: standard === 'metric' ? gradeKey.toUpperCase().replace('CLASS', 'Class ') : gradeKey.replace('grade', 'Grade '),
    };
  }, [standard, metricSize, imperialSize, grade, lubrication, preload, count, shearPlanes, gripLength]);

  const table = standard === 'metric' ? METRIC : IMPERIAL;

  return (
    <ToolShell
      toolId="bolt-torque"
      icon={Wrench}
      title="Bolt Torque & Preload"
      desc="Bolt size, property class and lubrication into clamping force, tightening torque, stretch and shear capacity — with the friction assumption made explicit, because that is what usually breaks bolts."
      state={{ standard, metricSize, imperialSize, grade, lubrication, preload, count, shearPlanes, gripLength }}
      onRestore={(restored) => {
        if (restored.standard) setStandard(restored.standard);
        if (restored.metricSize) setMetricSize(restored.metricSize);
        if (restored.imperialSize) setImperialSize(restored.imperialSize);
        if (restored.grade) setGrade(restored.grade);
        if (restored.lubrication) setLubrication(restored.lubrication);
        if (restored.preload !== undefined) setPreload(String(restored.preload));
        if (restored.count !== undefined) setCount(String(restored.count));
        if (restored.shearPlanes !== undefined) setShearPlanes(String(restored.shearPlanes));
        if (restored.gripLength !== undefined) setGripLength(String(restored.gripLength));
      }}
      exportText={result.report}
      exportName="bolt-torque.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Thread standard">
          <Seg value={standard} onChange={setStandard} options={[{ value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Imperial' }]} />
        </Field>
        <Field label="Size">
          <select value={standard === 'metric' ? metricSize : imperialSize} onChange={(e) => (standard === 'metric' ? setMetricSize(e.target.value) : setImperialSize(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {table.map((row) => <option key={row.label} value={row.label}>{row.label}</option>)}
          </select>
        </Field>
        <Field label={standard === 'metric' ? 'Property class' : 'Grade'}>
          <select value={grade} onChange={(e) => setGrade(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {standard === 'metric' ? (
              <>
                <option value="class8">Class 8.8 — 580 MPa</option>
                <option value="class10">Class 10.9 — 830 MPa</option>
                <option value="class12">Class 12.9 — 970 MPa</option>
              </>
            ) : (
              <>
                <option value="grade2">Grade 2 — 380 MPa</option>
                <option value="grade5">Grade 5 — 630 MPa</option>
                <option value="grade8">Grade 8 — 830 MPa</option>
              </>
            )}
          </select>
        </Field>
        <Field label="Lubrication">
          <select value={lubrication} onChange={(e) => setLubrication(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {Object.entries(LUBRICATION).map(([key, value]) => <option key={key} value={key}>{value.label} · K = {value.k}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={'Preload target — ' + preload + '% of proof load'}>
          <input type="range" min="50" max="95" value={preload} onChange={(e) => setPreload(e.target.value)} className="w-full accent-cyan-j" />
        </Field>
        <Field label="Number of bolts"><input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Shear planes per bolt"><input value={shearPlanes} onChange={(e) => setShearPlanes(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Grip length, mm"><input value={gripLength} onChange={(e) => setGripLength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Tightening torque"
          value={result.torqueNm.toFixed(1)}
          unit="Nm"
          sub={result.size.label + ' ' + result.gradeLabel + ', lubricated ' + result.lube.label.toLowerCase() + ', gives ' + result.forceKn.toFixed(1) + ' kN of clamp force at ' + (result.targetPreload * 100).toFixed(0) + '% of the ' + result.proofStrength + ' MPa proof strength. The same torque is ' + result.torqueFtLb.toFixed(1) + ' ft·lb, and the bolt stretches ' + result.stretch.toFixed(3) + ' mm over its grip.'}
        />
        <Ring
          value={result.lube.k * 100}
          max={25}
          tone={result.lube.k <= 0.14 ? 'amber' : 'cyan'}
          label="Friction factor K"
          sub={'K = ' + result.lube.k + ' — roughly 90% of the torque goes into friction under the head and in the threads, not into clamping'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Torque at other preload targets</div>
          <Bars data={result.chart} format={(value) => value.toFixed(1)} suffix=" Nm" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Preload scales directly with torque, so a torque wrench reading 10% high gives 10% more preload. That is the whole argument for measuring stretch or using a
            torque-angle method on critical joints.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Lubrication changes the torque dramatically</div>
          <Bars data={result.lubeCompare} format={(value) => value.toFixed(1)} suffix=" Nm" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Dry, oiled and anti-seize are all the same bolt at the same preload — only the friction has changed. This is why torque tables always state a lubrication condition,
            and why a table applied blind is a guess.
          </p>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">The numbers</span>
          <CopyBtn value={result.report} label="Copy" />
        </div>
        <div className="space-y-1.5 font-mono-j text-[11px]">
          <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Tensile stress area</span><span>{result.areaMm2.toFixed(1)} mm²</span></div>
          <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Proof strength</span><span>{result.proofStrength} MPa</span></div>
          <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Clamp force</span><span className="text-cyan-j">{result.forceKn.toFixed(1)} kN</span></div>
          <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Torque</span><span className="text-cyan-j">{result.torqueNm.toFixed(1)} Nm · {result.torqueFtLb.toFixed(1)} ft·lb</span></div>
          <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Stress in the bolt</span><span>{result.tensionStress.toFixed(0)} MPa</span></div>
          <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Stretch over the grip</span><span>{result.stretch.toFixed(3)} mm</span></div>
          <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Shear capacity</span><span>{result.shearKn.toFixed(1)} kN</span></div>
          <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Minimum engagement</span><span>{result.threadEngagement.toFixed(1)} mm</span></div>
          <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Friction factor used</span><span>K = {result.lube.k}</span></div>
          <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Total clamp for the joint</span><span>{result.totalForceKn.toFixed(1)} kN</span></div>
          <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Total tightening torque</span><span>{result.totalTorque.toFixed(0)} Nm</span></div>
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Torque" value={result.torqueNm.toFixed(1) + ' Nm'} mono sub={result.torqueFtLb.toFixed(1) + ' ft·lb'} />
        <Stat label="Clamp force" value={result.forceKn.toFixed(1) + ' kN'} mono sub={(result.targetPreload * 100).toFixed(0) + '% of proof load'} />
        <Stat label="Shear" value={result.shearKn.toFixed(1) + ' kN'} mono sub={shearPlanes + ' plane' + (Number(shearPlanes) > 1 ? 's' : '')} />
        <Stat label="Weight of clamping" value={result.count + ' bolts'} mono sub={result.totalForceKn.toFixed(1) + ' kN total'} />
      </div>

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {result.warnings.map((line) => <p key={line}>· {line}</p>)}
          <p>· Only about a tenth of the torque you apply becomes clamp force. The rest is overcome by friction under the head and between the threads, which is why the same bolt needs 7.8 Nm dry and 6.2 Nm oiled for identical preload.</p>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Tightening in practice</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Tighten in a star or spiral pattern, in stages. Doing up one bolt fully before its neighbours distorts the flange and leaves the joint unevenly loaded.</p>
            <p>· Two or three passes — 30%, 60%, 100% of final torque — give a far more even result than a single pass, especially on a gasket or a large flange.</p>
            <p>· Thread engagement of at least 1.5 times the diameter in steel, and more than 2 times in aluminium or cast iron, because the weaker material dictates the joint.</p>
            <p>· A torque wrench needs to be in calibration and used on the middle two thirds of its scale. Borrowed tools at the extreme of their range are wildly inaccurate.</p>
            <p>· Clean and inspect threads. Rust, thread lockers, burrs and damaged plating all change friction, which changes preload at the same torque.</p>
            <p>· Re-torque after the first few thermal cycles, or use a locking method. Bolts relax as the joint beds in and as gaskets take a set.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Shear, tension and the real failure</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A properly tightened bolt resists shear through friction between the plates, not through the shank. Clamp load is the mechanism, so losing preload loses load capacity long before anything yields.</p>
            <p>· Allow about 0.6 of the tensile strength for shear across the threads, which is what is used above. Threads in the shear plane reduce capacity further.</p>
            <p>· Combined tension and shear interact. A bolt loaded to half its capacity in each direction is not at half load overall; the interaction is roughly square-law.</p>
            <p>· Bolts fail in fatigue at loads far below their static capacity. A joint that cycles needs a preload high enough that the bolt never sees the full external load.</p>
            <p>· Thread stripping in the parent material is the common failure in aluminium, so check engagement and the material of the nut or tapped hole, not just the bolt.</p>
            <p>· For anything safety-critical, use the fastener supplier's published table and torque-angle or stretch control rather than a general calculation like this one.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Size', value: result.size.label },
                { label: 'Class', value: result.gradeLabel },
                { label: 'K', value: String(result.lube.k) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equation in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>torque = K × d × F, where d is the nominal diameter in metres and F the clamp force in newtons</p>
          <p>F = preload fraction × proof strength × tensile stress area</p>
          <p>K values: 0.20 dry, 0.16 oiled, 0.14 anti-seize, 0.12 waxed or PTFE coated</p>
          <p>shear capacity = 0.6 × strength × area × number of shear planes</p>
          <p>stretch = F × grip ÷ (area × E), with E as 205 GPa for steel</p>
          <p>engagement = 1.5 × nominal diameter in a steel nut</p>
          <p className="text-cyan-j">Check: K = {result.lube.k} × {result.size.d} mm × {result.forceKn.toFixed(1)} kN = {result.torqueNm.toFixed(1)} Nm.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Nominal stress areas and proof strengths from standard fastener tables, combined with the short-form torque equation. Real preload varies by plus or minus 25% at a
          given torque even with correct lubrication, so treat this as a starting point and use the fastener manufacturer's data for critical joints.
        </p>
      </Panel>
    </ToolShell>
  );
}