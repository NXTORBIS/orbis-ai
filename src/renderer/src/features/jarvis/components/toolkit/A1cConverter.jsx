import { useMemo, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Gauge, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const INPUTS = [
  { id: 'a1c', label: 'HbA1c' },
  { id: 'eag', label: 'Average glucose' },
  { id: 'mean', label: 'Mean sensor glucose' },
];

export default function A1cConverter() {
  const [mode, setMode] = useState('a1c');
  const [a1c, setA1c] = useState('7.2');
  const [glucose, setGlucose] = useState('160');
  const [units, setUnits] = useState('mgdl');
  const [variant, setVariant] = useState('none');
  const [kidney, setKidney] = useState(false);
  const [anemia, setAnemia] = useState(false);
  const [extra, setExtra] = useState({ ifcc: true, tir: true, category: true });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const value = Math.max(3, Math.min(20, Number(a1c) || 7));
    const mgdlInput = units === 'mgdl' ? Math.max(20, Number(glucose) || 140) : Math.max(1.1, (Number(glucose) || 7.8)) * 18.0182;
    const meanSensor = mgdlInput;

    // The standard ADAG relationship, and GMI for sensor-derived means.
    const eagFromA1c = 28.7 * value - 46.7;
    const a1cFromEag = (meanSensor + 46.7) / 28.7;
    const gmi = 3.31 + 0.02392 * meanSensor;
    const ifcc = (value - 2.15) * 10.929;

    const displayedA1c = mode === 'a1c' ? value : mode === 'eag' ? a1cFromEag : gmi;
    const displayedEag = mode === 'a1c' ? eagFromA1c : meanSensor;

    const category = (() => {
      if (variant === 'pregnancy') {
        return displayedA1c < 6 ? { label: 'Within target range for pregnancy', tone: 'cyan' }
          : { label: 'Above the usual pregnancy target of 6.0%', tone: 'amber' };
      }
      if (displayedA1c < 5.7) return { label: 'Normal range', tone: 'cyan' };
      if (displayedA1c < 6.5) return { label: 'Prediabetes range', tone: 'amber' };
      if (displayedA1c < 7) return { label: 'At the usual treatment target', tone: 'cyan' };
      if (displayedA1c < 8) return { label: 'Above target, common but improvable', tone: 'amber' };
      return { label: 'Well above target', tone: 'rose' };
    })();

    // Time in range bands for a sensor glucose mean of this value.
    const tir = [
      { label: 'Very low', value: Math.max(0, Math.round(8 - displayedEag / 22)), tone: 'rose' },
      { label: 'Low', value: Math.max(0, Math.round(10 - displayedEag / 25)) },
      { label: 'In range', value: Math.max(10, Math.min(90, Math.round(150 - Math.abs(displayedEag - 120) * 0.9))) },
      { label: 'High', value: Math.max(5, Math.round((displayedEag - 120) * 0.35) + 5) },
      { label: 'Very high', value: Math.max(2, Math.round((displayedEag - 180) * 0.5) + 3), tone: 'rose' },
    ];
    const tirTotal = tir.reduce((sum, band) => sum + band.value, 0) || 1;

    const conversion = [5, 5.7, 6, 6.5, 7, 7.5, 8, 9, 10].map((point) => ({
      label: point.toFixed(1) + '%',
      value: Number((28.7 * point - 46.7).toFixed(0)),
      tone: point >= 6.5 ? 'rose' : undefined,
    }));

    const reliabilityFlags = [];
    if (kidney) reliabilityFlags.push('Kidney disease changes red cell lifespan and makes HbA1c less reliable — CGM data or fructosamine is preferred.');
    if (anemia) reliabilityFlags.push('Anaemia or recent transfusion can distort HbA1c in either direction.');
    if (variant === 'sickle') reliabilityFlags.push('Haemoglobin variants interfere with many HbA1c assays. An alternative measure is needed.');
    if (variant === 'pregnancy') reliabilityFlags.push('In pregnancy HbA1c reflects a shorter red cell lifespan, so targets are lower and glucose monitoring more informative.');

    const warnings = [];
    if (mode !== 'a1c' && Math.abs(displayedA1c - value) > 0.6) warnings.push('The value you entered works out at an HbA1c of ' + displayedA1c.toFixed(2) + '%, which differs from the ' + value.toFixed(1) + '% entered elsewhere. Sensor-derived and laboratory figures rarely agree exactly. GMI is an estimate, not a substitute for a lab result.');
    if (mode === 'mean' && gmi > 7) warnings.push('Estimated GMI of ' + gmi.toFixed(2) + '% is above the usual 7% target. The 70% time-in-range goal is the more actionable number when you have sensor data.');
    if (displayedEag > 250) warnings.push('An average glucose of ' + Math.round(displayedEag) + ' mg/dL is high. Sustained values at this level are worth reviewing with your care team promptly.');
    if (a1c && Number(a1c) > 10) warnings.push('Values above 10% are unusual even in poorly controlled diabetes. Confirm the units and the assay before acting on it.');
    reliabilityFlags.forEach((flag) => warnings.push(flag));

    const report = [
      'GLYCEMIC MARKER CONVERSION',
      'Input: ' + (mode === 'a1c' ? 'HbA1c ' + value.toFixed(1) + '%' : (mode === 'eag' ? 'Average glucose ' : 'Mean sensor glucose ') + Math.round(meanSensor) + ' mg/dL'),
      '',
      'HbA1c: ' + displayedA1c.toFixed(2) + '%' + (extra.ifcc ? '  (IFCC ' + ((displayedA1c - 2.15) * 10.929).toFixed(0) + ' mmol/mol)' : ''),
      'Estimated average glucose: ' + Math.round(displayedEag) + ' mg/dL  (' + (displayedEag / 18.0182).toFixed(1) + ' mmol/L)',
      'Glucose management indicator: ' + gmi.toFixed(2) + '%',
      extra.category ? 'Interpretation: ' + category.label : '',
      '',
      'Conversions',
      'eAG = 28.7 x HbA1c - 46.7',
      'HbA1c = (eAG + 46.7) / 28.7',
      'GMI = 3.31 + 0.02392 x mean glucose',
      'IFCC = (HbA1c - 2.15) x 10.929',
      '',
      extra.tir ? 'Illustrative time-in-range split' : '',
      ...(extra.tir ? tir.map((band) => '  ' + band.label + ': ' + Math.round((band.value / tirTotal) * 100) + '%') : []),
      '',
      'HbA1c to average glucose',
      ...conversion.map((row) => '  ' + row.label + ': ' + row.value + ' mg/dL'),
    ].filter(Boolean).join('\n');

    return {
      value, mgdlInput, meanSensor, eagFromA1c, a1cFromEag, gmi, ifcc, displayedA1c, displayedEag, category, tir,
      tirTotal, conversion, warnings, report, mode, units, reliabilityFlags,
    };
  }, [mode, a1c, glucose, units, variant, kidney, anemia, extra]);

  return (
    <ToolShell
      toolId="a1c-converter"
      icon={HeartPulse}
      title="HbA1c, Average Glucose & GMI"
      desc="Convert between laboratory HbA1c, estimated average glucose, IFCC units and the glucose management indicator from sensor data — with targets and the conditions that make HbA1c unreliable."
      state={{ mode, a1c, glucose, units, variant, kidney, anemia, extra }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (restored.a1c !== undefined) setA1c(String(restored.a1c));
        if (restored.glucose !== undefined) setGlucose(String(restored.glucose));
        if (restored.units) setUnits(restored.units);
        if (restored.variant) setVariant(restored.variant);
        if (typeof restored.kidney === 'boolean') setKidney(restored.kidney);
        if (typeof restored.anemia === 'boolean') setAnemia(restored.anemia);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="glycemic-conversion.txt"
    >
      <Seg value={mode} onChange={setMode} options={INPUTS.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <Seg value={variant} onChange={setVariant} options={[{ value: 'none', label: 'Standard' }, { value: 'pregnancy', label: 'Pregnancy' }, { value: 'sickle', label: 'Hb variant' }]} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="HbA1c, %"><input value={a1c} onChange={(e) => setA1c(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Glucose (' + (units === 'mgdl' ? 'mg/dL' : 'mmol/L') + ')'}>
          <div className="flex gap-2">
            <input value={glucose} onChange={(e) => setGlucose(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            <select value={units} onChange={(e) => setUnits(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono-j text-xs">
              <option value="mgdl">mg/dL</option>
              <option value="mmol">mmol/L</option>
            </select>
          </div>
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <ToggleRow label="Show IFCC units" checked={extra.ifcc} onChange={() => toggle('ifcc')} hint="mmol/mol" />
        <ToggleRow label="Show time in range" checked={extra.tir} onChange={() => toggle('tir')} />
        <ToggleRow label="Show interpretation" checked={extra.category} onChange={() => toggle('category')} />
        <ToggleRow label="Kidney disease present" checked={kidney} onChange={() => setKidney((current) => !current)} />
        <ToggleRow label="Anaemia or recent transfusion" checked={anemia} onChange={() => setAnemia((current) => !current)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={mode === 'a1c' ? 'From HbA1c ' + result.value.toFixed(1) + '%' : 'From a mean glucose of ' + Math.round(result.meanSensor) + ' mg/dL'}
          value={result.displayedA1c.toFixed(2)}
          unit="% HbA1c"
          sub={'Estimated average glucose is ' + Math.round(result.displayedEag) + ' mg/dL (' + (result.displayedEag / 18.0182).toFixed(1) + ' mmol/L)' + (extra.ifcc ? ', which is ' + ((result.displayedA1c - 2.15) * 10.929).toFixed(0) + ' mmol/mol in IFCC units' : '') + '. The glucose management indicator works out at ' + result.gmi.toFixed(2) + '%. ' + (extra.category ? result.category.label + '.' : '')}
        />
        <Gauge
          value={Number(result.displayedA1c.toFixed(2))}
          min={4}
          max={12}
          label="HbA1c"
          unit="%"
          bands={[{ to: 5.7, tone: 'cyan' }, { to: 6.5, tone: 'amber' }, { to: 8, tone: 'violet' }, { to: 12, tone: 'rose' }]}
          caption="Under 5.7% is normal, 5.7 to 6.4% is the prediabetes range, and most treatment targets sit around 7%."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">HbA1c to average glucose</div>
          <Bars data={result.conversion} suffix=" mg/dL" format={(v) => v.toFixed(0)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The relationship is linear, but individual red cell lifespan varies, so two people with the same HbA1c can genuinely have different average glucose.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Conversion summary</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">HbA1c</span><span className="text-cyan-j">{result.displayedA1c.toFixed(2)}%</span></div>
            {extra.ifcc && <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">IFCC</span><span>{((result.displayedA1c - 2.15) * 10.929).toFixed(0)} mmol/mol</span></div>}
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Average glucose</span><span>{Math.round(result.displayedEag)} mg/dL</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">In mmol/L</span><span>{(result.displayedEag / 18.0182).toFixed(1)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">GMI</span><span>{result.gmi.toFixed(2)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Interpretation</span><span>{result.category.label.split(',')[0]}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Reliability flags</span><span>{result.reliabilityFlags.length || 'none'}</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Input', value: mode === 'a1c' ? 'HbA1c' : mode === 'eag' ? 'eAG' : 'Sensor mean' },
                { label: 'Category', value: result.category.label.split(' ')[0], tone: result.category.tone === 'rose' ? 'rose' : result.category.tone === 'amber' ? 'amber' : undefined },
                { label: 'Variant', value: variant === 'none' ? 'standard' : variant },
              ]}
            />
          </div>
        </Panel>
      </div>

      {extra.tir && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Illustrative time-in-range split for this average</div>
          <div className="flex gap-1 overflow-hidden rounded-lg">
            {result.tir.map((band) => (
              <div
                key={band.label}
                className={`flex h-16 items-center justify-center text-[10px] font-medium ${band.tone === 'rose' ? 'bg-rose-500/25 text-rose-200' : band.label === 'In range' ? 'bg-cyan-j/30 text-cyan-100' : 'bg-violet-500/20 text-violet-200'}`}
                style={{ width: Math.max(6, (band.value / result.tirTotal) * 100) + '%' }}
              >
                {Math.round((band.value / result.tirTotal) * 100)}%
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 font-mono-j text-[10px] text-muted-foreground">
            {result.tir.map((band) => <span key={band.label}>{band.label}</span>)}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The usual goals are more than 70% of time between 70 and 180 mg/dL, less than 4% below 70 and less than 1% below 54. A single average hides the difference between a stable reading and a
            rollercoaster that happens to average the same.
          </p>
        </Panel>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="HbA1c" value={result.displayedA1c.toFixed(2) + '%'} mono sub="NGSP units" />
        <Stat label="Average glucose" value={String(Math.round(result.displayedEag))} mono sub="mg/dL" />
        <Stat label="IFCC" value={((result.displayedA1c - 2.15) * 10.929).toFixed(0)} mono sub="mmol/mol" />
        <Stat label="GMI" value={result.gmi.toFixed(2) + '%'} mono sub="from sensor mean" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Before acting on this number</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Full conversion sheet</div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What HbA1c really measures</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· It reflects glucose attached to haemoglobin over the lifespan of a red blood cell — roughly the last two to three months, weighted towards the most recent month.</p>
            <p>· Anything that changes red cell lifespan changes the reading: anaemia, recent transfusion, kidney disease and some haemoglobin variants all distort it.</p>
            <p>· It is an average, so it cannot distinguish steady control from wide swings. Two identical HbA1c values can represent very different days.</p>
            <p>· GMI from continuous monitoring describes the same average over weeks rather than months and usually differs slightly from a laboratory figure.</p>
            <p>· Targets are individual. Age, other conditions, hypoglycaemia risk and life expectancy all shift the appropriate target.</p>
            <p>· Trends matter more than single readings. A fall from 8.4 to 7.6 is an achievement even when the number is still above target.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reference points</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">HbA1c</th><th className="py-1 text-right">Average glucose</th><th className="py-1 pr-2 text-left">Interpretation</th></tr>
              </thead>
              <tbody>
                {[[5.5, 'Normal'], [6, 'Upper normal'], [6.5, 'Prediabetes upper bound'], [7, 'Common target'], [8, 'Above target'], [9, 'Markedly elevated']].map(([point, note]) => (
                  <tr key={point} className="border-t border-border/40">
                    <td className="py-1 pl-2">{point}%</td>
                    <td className="py-1 text-right">{Math.round(28.7 * point - 46.7)} mg/dL</td>
                    <td className="py-1 pr-2">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Conversion follows the international ADAG relationship. Targets vary between guidelines and between individuals, so treat these as orientation points rather than thresholds.
          </p>
        </Panel>
      </div>

      <Panel className="!p-3">
        <p className="text-[11px] text-muted-foreground">
          Conversions use the published ADAG equation for HbA1c to estimated average glucose, the GMI formula for sensor-derived means and the standard IFCC conversion. This is a calculation aid for
          interpreting numbers you already have — it is not a diagnosis, and treatment decisions belong with your clinical team.
        </p>
      </Panel>
    </ToolShell>
  );
}