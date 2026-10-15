import { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const SECTIONS = [
  { value: 'rect', label: 'Rectangular' },
  { value: 'circle', label: 'Circular' },
  { value: 'ibeam', label: 'I-beam from tables' },
];

const MATERIALS = {
  steel: { label: 'Structural steel', e: 200, ft: 275, density: 7850, yield: 275 },
  stainless: { label: 'Stainless steel', e: 193, ft: 220, density: 8000, yield: 220 },
  aluminium: { label: 'Aluminium 6061', e: 69, ft: 275, density: 2700, yield: 275 },
  timber: { label: 'Softwood timber', e: 11, ft: 30, density: 500, yield: 30 },
  glulam: { label: 'Glulam timber', e: 13, ft: 35, density: 600, yield: 35 },
  concrete: { label: 'Reinforced concrete', e: 30, ft: 30, density: 2500, yield: 30 },
};

export default function BeamLoadCalculator() {
  const [support, setSupport] = useState('simple');
  const [loadType, setLoadType] = useState('udl');
  const [span, setSpan] = useState('4');
  const [load, setLoad] = useState('10');
  const [section, setSection] = useState('rect');
  const [material, setMaterial] = useState('steel');
  const [width, setWidth] = useState('100');
  const [height, setHeight] = useState('200');
  const [diameter, setDiameter] = useState('150');
  const [inertia, setInertia] = useState('2000');
  const [areaCm2, setAreaCm2] = useState('32');
  const [limit, setLimit] = useState('360');

  const result = useMemo(() => {
    const length = Math.max(0.2, Number(span) || 4);
    const materialSpec = MATERIALS[material] || MATERIALS.steel;
    const eMpa = materialSpec.e * 1000;

    const isUdl = loadType === 'udl';
    const loadValue = Math.max(0, Number(load) || 0);
    const loadN = isUdl ? loadValue * 1000 * length : loadValue * 1000;
    const wNPerMm = isUdl ? (loadValue * 1000) / 1000 : 0;

    const spanMm = length * 1000;

    const geometry = (() => {
      if (section === 'rect') {
        const b = Math.max(20, Number(width) || 100);
        const h = Math.max(20, Number(height) || 200);
        const i = (b * Math.pow(h, 3)) / 12;
        return { i, y: h / 2, area: b * h, label: b + ' × ' + h + ' mm rectangle', depth: h };
      }
      if (section === 'circle') {
        const d = Math.max(20, Number(diameter) || 150);
        const i = (Math.PI * Math.pow(d, 4)) / 64;
        return { i, y: d / 2, area: (Math.PI * d * d) / 4, label: d + ' mm diameter', depth: d };
      }
      const i = Math.max(1000, Number(inertia) || 2000) * 10000;
      const area = Math.max(1, Number(areaCm2) || 32) * 100;
      return { i, y: 100, area, label: 'I-beam, I = ' + (i / 10000).toFixed(0) + ' cm⁴', depth: 200 };
    })();

    const formulas = {
      simple: isUdl
        ? { moment: (wNPerMm * spanMm * spanMm) / 8, deflection: (5 * wNPerMm * Math.pow(spanMm, 4)) / (384 * eMpa * geometry.i), reaction: loadN / 2, label: 'simply supported, uniformly distributed' }
        : { moment: (loadN * spanMm) / 4, deflection: (loadN * Math.pow(spanMm, 3)) / (48 * eMpa * geometry.i), reaction: loadN / 2, label: 'simply supported, central point load' },
      cantilever: isUdl
        ? { moment: (wNPerMm * spanMm * spanMm) / 2, deflection: (wNPerMm * Math.pow(spanMm, 4)) / (8 * eMpa * geometry.i), reaction: loadN, label: 'cantilever, uniformly distributed' }
        : { moment: loadN * spanMm, deflection: (loadN * Math.pow(spanMm, 3)) / (3 * eMpa * geometry.i), reaction: loadN, label: 'cantilever, point load at the tip' },
      fixed: isUdl
        ? { moment: (wNPerMm * spanMm * spanMm) / 12, deflection: (wNPerMm * Math.pow(spanMm, 4)) / (384 * eMpa * geometry.i), reaction: loadN / 2, label: 'fixed at both ends, uniformly distributed' }
        : { moment: (loadN * spanMm) / 8, deflection: (loadN * Math.pow(spanMm, 3)) / (192 * eMpa * geometry.i), reaction: loadN / 2, label: 'fixed at both ends, central point load' },
    };

    const active = formulas[support] || formulas.simple;
    const momentKnM = active.moment / 1e6;
    const stress = (active.moment * geometry.y) / geometry.i;
    const shear = active.reaction;
    const shearStress = (shear / 2) * 1.5 / (geometry.area / 2);
    const deflection = active.deflection;
    const deflectionLimit = spanMm / Math.max(60, Number(limit) || 360);
    const utilisation = materialSpec.yield ? (stress / materialSpec.yield) * 100 : 0;
    const safetyFactor = stress > 0 ? materialSpec.yield / stress : 0;
    const mass = (geometry.area / 1e6) * length * materialSpec.density;
    const selfWeight = mass * 9.81;
    const selfWeightShare = loadN ? (selfWeight / loadN) * 100 : 0;
    const volume = (geometry.area / 1e6) * length;

    const alternatives = ['rect', 'circle', 'ibeam'].map((value) => {
      if (value === 'rect') {
        const b = 100;
        const h = 200;
        return { label: '100×200', value: Number((((b * Math.pow(h, 3)) / 12) / 10000).toFixed(0)) };
      }
      if (value === 'circle') {
        return { label: 'Ø150', value: Number(((Math.PI * Math.pow(150, 4)) / 64 / 10000).toFixed(0)) };
      }
      return { label: 'I-beam', value: Number((geometry.i / 10000).toFixed(0)) };
    });

    const sectionCompare = [100, 150, 200, 250, 300].map((h) => ({
      label: h + ' mm deep',
      value: Number((((100 * Math.pow(h, 3)) / 12) / 10000).toFixed(0)),
    }));

    const warnings = [];
    if (deflection > deflectionLimit) warnings.push('Deflection is ' + deflection.toFixed(1) + ' mm against a limit of ' + deflectionLimit.toFixed(1) + ' mm at span/' + limit + '. Serviceability, not strength, governs this beam — go deeper.');
    if (utilisation > 100) warnings.push('Bending stress is ' + utilisation.toFixed(0) + '% of the yield strength. The section is overstressed at this load.');
    else if (utilisation > 60) warnings.push('Bending stress is ' + utilisation.toFixed(0) + '% of yield, leaving a factor of ' + safetyFactor.toFixed(2) + '. That is slim for anything but a temporary structure.');
    if (selfWeightShare > 20) warnings.push('Self weight is ' + selfWeightShare.toFixed(0) + '% of the applied load, which is significant. Include it in the design load rather than treating it as a rounding error.');
    if (material === 'timber' && utilisation > 50) warnings.push('Timber creeps under sustained load and is graded below its average strength. Long-term deflection will exceed the figure here.');
    if (!warnings.length) warnings.push('Bending stress is ' + utilisation.toFixed(0) + '% of yield with a factor of ' + safetyFactor.toFixed(2) + ', and deflection is ' + deflection.toFixed(1) + ' mm against a limit of ' + deflectionLimit.toFixed(1) + ' mm. Both are within normal limits.');

    const report = [
      materialSpec.label + ', ' + geometry.label,
      active.label + ', span ' + length + ' m, ' + (isUdl ? loadValue + ' kN/m' : loadValue + ' kN point load'),
      '',
      'Reaction at each support ' + (active.reaction / 1000).toFixed(2) + ' kN',
      'Maximum bending moment ' + momentKnM.toFixed(2) + ' kNm',
      'Second moment of area ' + (geometry.i / 10000).toFixed(0) + ' cm⁴ · section modulus ' + (geometry.i / geometry.y / 1000).toFixed(0) + ' cm³',
      'Maximum bending stress ' + stress.toFixed(1) + ' MPa against a yield of ' + materialSpec.yield + ' MPa',
      'Utilisation ' + utilisation.toFixed(0) + '% · safety factor ' + safetyFactor.toFixed(2),
      'Maximum deflection ' + deflection.toFixed(2) + ' mm, which is span/' + (deflection ? (spanMm / deflection) : 0).toFixed(0),
      'Deflection limit used ' + deflectionLimit.toFixed(2) + ' mm at span/' + limit,
      'Self weight ' + mass.toFixed(1) + ' kg' + (selfWeightShare ? ' (' + selfWeightShare.toFixed(0) + '% of the applied load)' : ''),
      '',
      ...warnings,
    ].join('\n');

    return {
      length, materialSpec, geometry, active, momentKnM, stress, shear, shearStress, deflection, deflectionLimit, utilisation,
      safetyFactor, mass, selfWeight, selfWeightShare, volume, warnings, report, isUdl, loadValue, spanMm,
      chart: sectionCompare,
      bars: [
        { label: 'Stress', value: Number(utilisation.toFixed(0)) },
        { label: 'Deflection', value: Number(((deflection / deflectionLimit) * 100).toFixed(0)) },
      ],
      alternatives,
    };
  }, [support, loadType, span, load, section, material, width, height, diameter, inertia, areaCm2, limit]);

  return (
    <ToolShell
      toolId="beam-load"
      icon={Activity}
      title="Beam Load & Deflection"
      desc="Span, load, section and material into reactions, bending moment, stress, deflection and factor of safety — with the governing limit named, so you know whether strength or stiffness is deciding."
      state={{ support, loadType, span, load, section, material, width, height, diameter, inertia, areaCm2, limit }}
      onRestore={(restored) => {
        if (restored.support) setSupport(restored.support);
        if (restored.loadType) setLoadType(restored.loadType);
        if (restored.span !== undefined) setSpan(String(restored.span));
        if (restored.load !== undefined) setLoad(String(restored.load));
        if (restored.section) setSection(restored.section);
        if (restored.material) setMaterial(restored.material);
        if (restored.width !== undefined) setWidth(String(restored.width));
        if (restored.height !== undefined) setHeight(String(restored.height));
        if (restored.diameter !== undefined) setDiameter(String(restored.diameter));
        if (restored.inertia !== undefined) setInertia(String(restored.inertia));
        if (restored.areaCm2 !== undefined) setAreaCm2(String(restored.areaCm2));
        if (restored.limit !== undefined) setLimit(String(restored.limit));
      }}
      exportText={result.report}
      exportName="beam-check.txt"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Seg value={support} onChange={setSupport} options={[{ value: 'simple', label: 'Simply supported' }, { value: 'cantilever', label: 'Cantilever' }, { value: 'fixed', label: 'Fixed both ends' }]} />
        <Seg value={loadType} onChange={setLoadType} options={[{ value: 'udl', label: 'Uniform load, kN/m' }, { value: 'point', label: 'Point load, kN' }]} />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Span, m"><input value={span} onChange={(e) => setSpan(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={result.isUdl ? 'Uniform load, kN/m' : 'Point load, kN'}><input value={load} onChange={(e) => setLoad(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Deflection limit, span/">
          <select value={limit} onChange={(e) => setLimit(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            <option value="180">180 — rough</option>
            <option value="240">240 — general</option>
            <option value="360">360 — normal floors</option>
            <option value="500">500 — brittle finishes</option>
          </select>
        </Field>
        <Field label="Material">
          <select value={material} onChange={(e) => setMaterial(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {Object.entries(MATERIALS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
        </Field>
      </div>

      <Seg value={section} onChange={setSection} options={SECTIONS} />

      <div className="grid gap-3 sm:grid-cols-4">
        {section === 'rect' && (
          <>
            <Field label="Width, mm"><input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Depth, mm"><input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </>
        )}
        {section === 'circle' && (
          <Field label="Diameter, mm"><input value={diameter} onChange={(e) => setDiameter(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        )}
        {section === 'ibeam' && (
          <>
            <Field label="Second moment I, cm⁴"><input value={inertia} onChange={(e) => setInertia(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Cross-section area, cm²"><input value={areaCm2} onChange={(e) => setAreaCm2(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </>
        )}
        <Field label="Section in use">
          <div className="flex h-9 items-center font-mono-j text-[11px] text-muted-foreground">{result.geometry.label}</div>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.utilisation > 100 ? 'rose' : result.utilisation > 60 ? 'amber' : 'emerald'}
          label="Bending utilisation"
          value={result.utilisation.toFixed(0)}
          unit="% of yield"
          sub={result.materialSpec.label + ', ' + result.active.label + '. Maximum moment is ' + result.momentKnM.toFixed(2) + ' kNm giving ' + result.stress.toFixed(1) + ' MPa against a yield of ' + result.materialSpec.yield + ' MPa, so the factor of safety is ' + result.safetyFactor.toFixed(2) + '. Deflection is ' + result.deflection.toFixed(1) + ' mm against a limit of ' + result.deflectionLimit.toFixed(1) + ' mm.'}
        />
        <Ring
          value={Math.min((result.deflection / result.deflectionLimit) * 100, 200)}
          max={150}
          tone={result.deflection > result.deflectionLimit ? 'rose' : 'cyan'}
          label="Deflection against its limit"
          sub={result.deflection <= result.deflectionLimit ? 'Within the span/' + limit + ' criterion' : 'Exceeds span/' + limit + ' — stiffness governs this beam'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Strength against serviceability</div>
          <Bars data={result.bars} format={(value) => value + '%'} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Both bars are percentages of their own limit. Whichever is higher is the one governing this beam, and it is usually deflection rather than stress — a beam that
            sags visibly is uncomfortable long before it is unsafe.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The numbers</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Reaction each end</span><span>{(result.active.reaction / 1000).toFixed(2)} kN</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Max bending moment</span><span className="text-cyan-j">{result.momentKnM.toFixed(2)} kNm</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Second moment of area</span><span>{(result.geometry.i / 10000).toFixed(0)} cm⁴</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Section modulus</span><span>{(result.geometry.i / result.geometry.y / 1000).toFixed(0)} cm³</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Bending stress</span><span>{result.stress.toFixed(1)} MPa</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Average shear stress</span><span>{result.shearStress.toFixed(2)} MPa</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Deflection</span><span>{result.deflection.toFixed(2)} mm</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">As a span ratio</span><span>span/{result.deflection ? (result.spanMm / result.deflection).toFixed(0) : '—'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Section weight</span><span>{result.mass.toFixed(1)} kg</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Self weight share</span><span>{result.selfWeightShare.toFixed(0)}%</span></div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Depth matters more than anything else</div>
        <Bars data={result.chart} format={(value) => value.toLocaleString()} suffix=" cm⁴" highlightLast={false} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Second moment of area grows with the cube of depth, so doubling the depth of a 100 mm wide beam multiplies its stiffness by eight for twice the material. Depth is the
          cheapest stiffness available, and it is why floor joists are deep rather than thick.
        </p>
      </Panel>

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {result.warnings.map((line) => <p key={line}>· {line}</p>)}
          <p>· This checks a single span in bending and deflection. It does not check lateral torsional buckling, web crippling, connection capacity, fire, notches or holes, any of which can govern a real beam.</p>
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Moment" value={result.momentKnM.toFixed(2) + ' kNm'} mono sub={result.active.label.split(',')[0]} />
        <Stat label="Stress" value={result.stress.toFixed(0) + ' MPa'} mono sub={'factor ' + result.safetyFactor.toFixed(2)} />
        <Stat label="Deflection" value={result.deflection.toFixed(1) + ' mm'} mono sub={'span/' + (result.deflection ? (result.spanMm / result.deflection).toFixed(0) : '—')} />
        <Stat label="Weight" value={result.mass.toFixed(1) + ' kg'} mono sub={result.volume.toFixed(3) + ' m³'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Designing a beam that behaves</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Check deflection first. Most domestic beams are governed by how much they sag, not by whether they break.</p>
            <p>· Increase depth, not width. Doubling depth multiplies stiffness by eight; doubling width only doubles it.</p>
            <p>· Shorten the span if you can. Deflection grows with the fourth power of span, so a 20% shorter span is twice as stiff.</p>
            <p>· Include self weight in the load, especially for concrete and for long timber spans. Here it is {result.selfWeightShare.toFixed(0)}% of the applied load.</p>
            <p>· Stiffen the ends and restrain the compression flange. An unrestrained beam can buckle sideways at a fraction of its bending capacity.</p>
            <p>· Keep services out of the middle third of a timber beam, and never notch the bottom edge in the middle of a span.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the standard formulas come from</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>bending stress σ = M × y ÷ I, with y to the extreme fibre</p>
            <p>simply supported UDL: M = wL² ÷ 8, δ = 5wL⁴ ÷ 384EI</p>
            <p>simply supported point load: M = PL ÷ 4, δ = PL³ ÷ 48EI</p>
            <p>cantilever UDL: M = wL² ÷ 2, δ = wL⁴ ÷ 8EI</p>
            <p>fixed both ends, UDL: M = wL² ÷ 12, δ = wL⁴ ÷ 384EI</p>
            <p>deflection limit = span ÷ {'360'}, the usual domestic serviceability criterion</p>
            <p className="text-cyan-j">Check: {result.isUdl ? result.loadValue + ' kN/m over ' + result.length + ' m' : result.loadValue + ' kN over ' + result.length + ' m'} gives {result.momentKnM.toFixed(2)} kNm.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Section', value: result.geometry.label.split(',')[0] },
                { label: 'Utilisation', value: result.utilisation.toFixed(0) + '%' },
                { label: 'Deflection', value: 'span/' + (result.deflection ? (result.spanMm / result.deflection).toFixed(0) : '—') },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Elastic analysis of a single-span beam with standard load cases and no partial safety factors. Real design adds load factors, material factors, buckling checks and
          connection design, and any structure carrying people or property should be signed off by a qualified engineer.
        </p>
      </Panel>
    </ToolShell>
  );
}