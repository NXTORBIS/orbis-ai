import { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Gauge, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const UNITS = [
  { id: 'mgdl', label: 'mg/dL' },
  { id: 'umol', label: 'µmol/L' },
];

export default function GfrEstimator() {
  const [creatinine, setCreatinine] = useState('1.1');
  const [units, setUnits] = useState('mgdl');
  const [age, setAge] = useState('48');
  const [sex, setSex] = useState('male');
  const [weight, setWeight] = useState('78');
  const [height, setHeight] = useState('176');
  const [albumin, setAlbumin] = useState('0');
  const [urea, setUrea] = useState('14');
  const [chronic, setChronic] = useState(true);
  const [extra, setExtra] = useState({ cg: true, ckd: true, bsa: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const rawCreat = Math.max(0.1, Number(creatinine) || 1);
    const scr = units === 'umol' ? rawCreat / 88.4 : rawCreat;
    const a = Math.max(18, Number(age) || 40);
    const female = sex === 'female';
    const kg = Math.max(20, Number(weight) || 70);
    const cm = Math.max(100, Number(height) || 170);
    const uacr = Math.max(0, Number(albumin) || 0);
    const bun = Math.max(0, Number(urea) || 0);

    // CKD-EPI 2021, which removed the race coefficient.
    const kappa = female ? 0.7 : 0.9;
    const alpha = female ? -0.241 : -0.302;
    const ratio = scr / kappa;
    const egfr = 142 * Math.pow(Math.min(ratio, 1), alpha) * Math.pow(Math.max(ratio, 1), -1.2) * Math.pow(0.9938, a) * (female ? 1.012 : 1);

    // Cockcroft-Gault creatinine clearance, still used for drug dosing.
    const crcl = (((140 - Math.min(120, a)) * kg) / (72 * scr)) * (female ? 0.85 : 1);

    // Body surface area and an indexed filtration rate.
    const bsa = Math.sqrt((cm * kg) / 3600);
    const egfrIndexed = (egfr * 1.73) / bsa;

    // CKD staging from the 2024 categories.
    const stage = !chronic
      ? null
      : egfr >= 90
      ? { label: 'G1', desc: 'Normal or high filtration', risk: 'Low' }
      : egfr >= 60
      ? { label: 'G2', desc: 'Mildly reduced', risk: uacr >= 30 ? 'Moderate when albuminuria is present' : 'Low' }
      : egfr >= 45
      ? { label: 'G3a', desc: 'Mild to moderately reduced', risk: 'Moderate' }
      : egfr >= 30
      ? { label: 'G3b', desc: 'Moderately to severely reduced', risk: 'High' }
      : egfr >= 15
      ? { label: 'G4', desc: 'Severely reduced', risk: 'Very high' }
      : { label: 'G5', desc: 'Kidney failure', risk: 'Very high' };

    const albuminStage = uacr === 0 ? null : uacr < 30 ? 'A1 — normal to mildly increased' : uacr <= 300 ? 'A2 — moderately increased' : 'A3 — severely increased';

    const bmi = kg / ((cm / 100) ** 2);
    const bunMgdl = bun * 2.8;
    const bunCrRatio = scr > 0 ? bunMgdl / scr : 0;

    const estimate = (value) => {
      const r = value / kappa;
      return 142 * Math.pow(Math.min(r, 1), alpha) * Math.pow(Math.max(r, 1), -1.2) * Math.pow(0.9938, a) * (female ? 1.012 : 1);
    };
    const curve = [0.5, 0.7, 0.9, 1.1, 1.4, 1.8, 2.4, 3.2, 4.5].map((value) => ({
      label: value.toFixed(1),
      value: Number(estimate(value).toFixed(0)),
      tone: estimate(value) < 60 ? 'rose' : undefined,
    }));

    const warnings = [];
    if (egfr >= 60 && uacr === 0) warnings.push('Filtration looks fine, but kidney health is judged on filtration and albuminuria together. Without a urine albumin measurement this is only half the picture.');
    if (!chronic) warnings.push('An eGFR based on a single creatinine is an acute reading, not a chronic one. CKD staging requires at least three months of reduced filtration.');
    if (!female && scr < 0.7) warnings.push('A low creatinine in this configuration can reflect low muscle mass rather than excellent kidney function. The equation assumes average muscle mass.');
    if (bmi > 32) warnings.push('At a BMI of ' + bmi.toFixed(1) + ', creatinine production is higher than the equation assumes, so the eGFR is likely understated.');
    if (bmi < 18.5) warnings.push('Low body mass reduces creatinine production, which overstates the eGFR. The result should be read with caution.');
    if (a > 75) warnings.push('Above 75 the age term dominates. Absolute eGFR figures are less meaningful than the trend over time in older adults.');
    if (crcl > egfr * 1.4) warnings.push('Cockcroft-Gault gives ' + crcl.toFixed(0) + ' against an eGFR of ' + egfr.toFixed(0) + '. Drug dosing usually follows Cockcroft-Gault while kidney staging follows CKD-EPI, so both are shown.');
    if (egfr < 60) warnings.push('A result below 60 needs confirmation on a repeat sample and a urine albumin-to-creatinine ratio before it means chronic kidney disease.');

    const report = [
      'KIDNEY FUNCTION ESTIMATE',
      'Creatinine ' + rawCreat + (units === 'umol' ? ' µmol/L' : ' mg/dL') + ' (' + scr.toFixed(2) + ' mg/dL), age ' + a + ', ' + sex,
      'Weight ' + kg + ' kg, height ' + cm + ' cm, BSA ' + bsa.toFixed(2) + ' m²',
      '',
      'eGFR (CKD-EPI 2021): ' + egfr.toFixed(1) + ' mL/min/1.73 m²',
      extra.bsa ? 'eGFR indexed to your own BSA: ' + egfrIndexed.toFixed(1) + ' mL/min' : '',
      extra.cg ? 'Cockcroft-Gault creatinine clearance: ' + crcl.toFixed(1) + ' mL/min' : '',
      '',
      stage ? 'CKD stage: ' + stage.label + ' — ' + stage.desc + ' (risk ' + stage.risk.toLowerCase() + ')' : 'Staging withheld: chronicity not confirmed',
      albuminStage ? 'Albuminuria: ' + albuminStage : 'Albuminuria: not supplied',
      '',
      'Urea ' + bun + ' mmol/L, BUN/creatinine ratio ' + bunCrRatio.toFixed(1),
      'BMI ' + bmi.toFixed(1),
      '',
      'eGFR across creatinine values',
      ...curve.map((row) => '  ' + row.label + ' mg/dL: ' + row.value + ' mL/min/1.73 m²'),
    ].filter(Boolean).join('\n');

    return {
      scr, a, female, kg, cm, uacr, bun, egfr, crcl, bsa, egfrIndexed, stage, albuminStage, bmi, bunMgdl, bunCrRatio,
      curve, warnings, report, rawCreat, units,
    };
  }, [creatinine, units, age, sex, weight, height, albumin, urea, chronic, extra]);

  const gaugeMax = 120;

  return (
    <ToolShell
      toolId="gfr-estimate"
      icon={Activity}
      title="Kidney Function (eGFR) Estimator"
      desc="Creatinine, age and sex into the CKD-EPI 2021 eGFR and Cockcroft-Gault clearance, with the CKD stage, albuminuria category and the caveats that change the reading."
      state={{ creatinine, units, age, sex, weight, height, albumin, urea, chronic, extra }}
      onRestore={(restored) => {
        const map = { creatinine: setCreatinine, age: setAge, weight: setWeight, height: setHeight, albumin: setAlbumin, urea: setUrea };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.units) setUnits(restored.units);
        if (restored.sex) setSex(restored.sex);
        if (typeof restored.chronic === 'boolean') setChronic(restored.chronic);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="kidney-function.txt"
    >
      <Seg value={units} onChange={setUnits} options={UNITS.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <Seg value={sex} onChange={setSex} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={'Serum creatinine, ' + (units === 'umol' ? 'µmol/L' : 'mg/dL')}><input value={creatinine} onChange={(e) => setCreatinine(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Age, years"><input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Weight, kg"><input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Height, cm"><input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Urine albumin, mg/g"><input value={albumin} onChange={(e) => setAlbumin(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Urea, mmol/L"><input value={urea} onChange={(e) => setUrea(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Reduced for three months or more" checked={chronic} onChange={() => setChronic((current) => !current)} hint="Chronicity is required for CKD staging" />
        <ToggleRow label="Show Cockcroft-Gault clearance" checked={extra.cg} onChange={() => toggle('cg')} hint="Used for drug dosing" />
        <ToggleRow label="Index to your own body surface area" checked={extra.bsa} onChange={() => toggle('bsa')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={result.stage ? 'CKD stage ' + result.stage.label : 'Filtration estimate'}
          value={result.egfr.toFixed(0)}
          unit="mL/min/1.73m²"
          sub={'The CKD-EPI 2021 equation gives ' + result.egfr.toFixed(1) + ' for a creatinine of ' + result.scr.toFixed(2) + ' mg/dL at age ' + result.a + '. Cockcroft-Gault clearance works out at ' + result.crcl.toFixed(0) + ' mL/min, which is the figure drug dosing usually follows.' + (result.stage ? ' ' + result.stage.desc + ', with ' + result.stage.risk.toLowerCase() + ' risk.' : '')}
        />
        <Gauge
          value={Number(result.egfr.toFixed(1))}
          min={0}
          max={gaugeMax}
          label="eGFR"
          unit=" mL/min"
          bands={[{ to: 30, tone: 'rose' }, { to: 60, tone: 'violet' }, { to: 90, tone: 'amber' }, { to: gaugeMax, tone: 'cyan' }]}
          caption="Above 60 the exact number matters less than the trend. Below 60, persistence over three months is what defines chronic kidney disease."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">eGFR across creatinine values</div>
          <Bars data={result.curve} suffix="" format={(v) => v.toFixed(0)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Red bars fall below 60, the threshold that generally needs confirmation and further investigation.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Result summary</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">eGFR, CKD-EPI 2021</span><span className="text-cyan-j">{result.egfr.toFixed(1)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Cockcroft-Gault CrCl</span><span>{result.crcl.toFixed(1)} mL/min</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Indexed to your BSA</span><span>{result.egfrIndexed.toFixed(1)} mL/min</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Body surface area</span><span>{result.bsa.toFixed(2)} m²</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">CKD stage</span><span>{result.stage ? result.stage.label : 'not staged'}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Albuminuria</span><span>{result.albuminStage ? result.albuminStage.split(' ')[0] : 'not supplied'}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">BUN/creatinine ratio</span><span>{result.bunCrRatio.toFixed(1)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">BMI</span><span>{result.bmi.toFixed(1)}</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Creatinine', value: result.scr.toFixed(2) + ' mg/dL' },
                { label: 'Risk', value: result.stage ? result.stage.risk : 'unstaged', tone: result.stage && (result.stage.risk === 'High' || result.stage.risk === 'Very high') ? 'rose' : undefined },
                { label: 'Albumin', value: result.uacr ? result.uacr + ' mg/g' : 'not given' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Full estimate</div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Staging categories</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Stage</th><th className="py-1 text-right">eGFR</th><th className="py-1 pr-2 text-left">Meaning</th></tr>
              </thead>
              <tbody>
                {[['G1', '≥ 90', 'Normal, needs other evidence'], ['G2', '60–89', 'Mildly reduced'], ['G3a', '45–59', 'Mild to moderate'], ['G3b', '30–44', 'Moderate to severe'], ['G4', '15–29', 'Severely reduced'], ['G5', '< 15', 'Kidney failure']].map(([label, range, note]) => (
                  <tr key={label} className={`border-t border-border/40 ${result.stage && result.stage.label === label ? 'text-cyan-j' : ''}`}>
                    <td className="py-1 pl-2">{label}</td>
                    <td className="py-1 text-right">{range}</td>
                    <td className="py-1 pr-2">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Chronic kidney disease needs reduced filtration or a marker of damage persisting for three months or more. A single result never establishes it on its own.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="eGFR" value={result.egfr.toFixed(0)} mono sub="mL/min/1.73m²" />
        <Stat label="Creatinine clearance" value={result.crcl.toFixed(0)} mono sub="mL/min, drug dosing" />
        <Stat label="CKD stage" value={result.stage ? result.stage.label : '—'} mono sub={result.stage ? result.stage.desc : 'chronicity unconfirmed'} />
        <Stat label="BSA indexed" value={result.egfrIndexed.toFixed(0)} mono sub="mL/min for your size" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Read this with the caveats</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What changes the estimate</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· These equations estimate filtration from creatinine, which depends on muscle mass. A muscular person and a frail person with the same creatinine have very different kidney function.</p>
            <p>· Any equation based on creatinine lags real changes by a day or more. In acute illness the estimate can be badly wrong in both directions.</p>
            <p>· Certain drugs block tubular secretion of creatinine and raise the measured level without changing filtration. The result then understates function.</p>
            <p>· Albuminuria often appears before filtration falls, which is why a normal eGFR with protein in the urine still needs attention.</p>
            <p>· CKD-EPI 2021 removed the race coefficient because it was a poor proxy. The equation is now applied identically to everyone, which is more accurate and fairer.</p>
            <p>· The trend across several results is far more informative than any single value, especially near the thresholds.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Albuminuria categories</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Category</th><th className="py-1 text-right">mg/g</th><th className="py-1 pr-2 text-left">Meaning</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">A1</td><td className="py-1 text-right">&lt; 30</td><td className="py-1 pr-2">Normal to mildly increased</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">A2</td><td className="py-1 text-right">30–300</td><td className="py-1 pr-2">Moderately increased</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">A3</td><td className="py-1 text-right">&gt; 300</td><td className="py-1 pr-2">Severely increased</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Risk is graded on the grid of filtration and albuminuria together, not filtration alone. A person at G2 A3 carries more risk than one at G3a A1.
          </p>
        </Panel>
      </div>

      <Panel className="!p-3">
        <p className="text-[11px] text-muted-foreground">
          This estimates kidney function using published equations — CKD-EPI 2021 for eGFR and Cockcroft-Gault for creatinine clearance. It is a calculation aid, not a diagnosis, and it cannot account
          for your muscle mass, medications or acute illness. Discuss results with the clinician who ordered the test, who will interpret them alongside a repeat sample and a urine albumin measurement.
        </p>
      </Panel>
    </ToolShell>
  );
}