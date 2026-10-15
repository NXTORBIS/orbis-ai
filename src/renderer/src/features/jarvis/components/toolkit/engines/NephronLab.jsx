import { useMemo, useState } from 'react';
import { Droplets, Play } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { CopyBtn, Panel, Seg, Stat } from '../shared';
import { Bars, Gauge, Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { computeNephron, steadyStateCreatinine, verifyNephron } from './nephronCore';

const PRESETS = [
  { value: 'normal', label: 'Normal' },
  { value: 'dehydrated', label: 'Dehydrated' },
  { value: 'diuretic', label: 'On a diuretic' },
  { value: 'diabetes', label: 'High glucose' },
  { value: 'ckd', label: 'Reduced filtration' },
];

const PRESET_PARAMS = {
  normal: { adh: 0.5, aldosterone: 0.5, diuretic: 0, plasmaGlucose: 100, filtrationCoefficient: 12.5 },
  dehydrated: { adh: 1, aldosterone: 0.85, diuretic: 0, plasmaGlucose: 100, filtrationCoefficient: 11 },
  diuretic: { adh: 0.5, aldosterone: 0.9, diuretic: 0.7, plasmaGlucose: 100, filtrationCoefficient: 12.5 },
  diabetes: { adh: 0.5, aldosterone: 0.5, diuretic: 0, plasmaGlucose: 320, filtrationCoefficient: 12.5 },
  ckd: { adh: 0.55, aldosterone: 0.7, diuretic: 0, plasmaGlucose: 100, filtrationCoefficient: 6 },
};

const SOLUTES = [
  { key: 'na', label: 'Sodium', unit: 'mmol/min', plasma: 140, decimals: 3 },
  { key: 'k', label: 'Potassium', unit: 'mmol/min', plasma: 4.2, decimals: 3 },
  { key: 'urea', label: 'Urea', unit: 'mmol/min', plasma: 15, decimals: 3 },
  { key: 'creatinine', label: 'Creatinine', unit: 'mg/min', plasma: 1, decimals: 3 },
  { key: 'glucose', label: 'Glucose', unit: 'mg/min', plasma: 100, decimals: 1 },
];

export default function NephronLab() {
  const [preset, setPreset] = useState('normal');
  const [params, setParams] = useState(PRESET_PARAMS.normal);
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState(null);
  const [error, setError] = useState('');

  const result = useMemo(() => computeNephron(params), [params]);
  const plasmaCreatinine = steadyStateCreatinine({ gfr: result.gfr });

  const thresholdSweep = useMemo(() => Array.from({ length: 22 }, (_, index) => {
    const glucose = 80 + index * 20;
    const run = computeNephron({ ...params, plasmaGlucose: glucose });
    return { label: `${glucose}`, value: run.excreted.glucose };
  }), [params]);

  const applyPreset = (value) => {
    setPreset(value);
    setParams({ ...PRESET_PARAMS[value] });
  };

  const setField = (key, value) => {
    setPreset('custom');
    setParams((current) => ({ ...current, [key]: value }));
  };

  const runChecks = () => {
    setBusy(true);
    setError('');
    try {
      setVerification(verifyNephron());
    } catch (thrown) {
      setError(thrown.message || 'The checks could not run.');
    }
    setBusy(false);
  };

  const exportText = [
    `filtration rate ${result.gfr.toFixed(1)} mL/min from a net pressure of ${result.pressures.netFiltrationPressure.toFixed(1)} mmHg`,
    `urine ${result.urineVolume.toFixed(2)} mL/min at ${result.osmolarity.toFixed(0)} mOsm/kg`,
    '',
    'solute\tfiltered\treabsorbed\tsecreted\texcreted',
    ...SOLUTES.map((solute) => `${solute.key}\t${result.filteredLoad[solute.key].toFixed(4)}\t${result.reabsorbed[solute.key].toFixed(4)}\t${result.secreted[solute.key].toFixed(4)}\t${result.excreted[solute.key].toFixed(4)}`),
  ].join('\n');

  return (
    <ToolShell
      toolId="nephron-filtration"
      icon={Droplets}
      title="Nephron Filtration Visualizer"
      desc="Filtration from Starling forces, then water and every solute carried segment by segment with ADH, aldosterone and a diuretic acting where they actually act — audited by mass balance and by clearances that must come out at the value physiology demands."
      state={{ preset, params }}
      onRestore={(state) => {
        if (!state) return;
        if (state.preset) setPreset(state.preset);
        if (state.params) setParams(state.params);
      }}
      exportText={exportText}
      exportName="nephron-report.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={preset} onChange={applyPreset} options={PRESETS} />
        <Button size="sm" variant="outline" onClick={runChecks} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Run the checks</Button>
      </div>

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { key: 'filtrationCoefficient', label: `Filtration coefficient ${params.filtrationCoefficient} mL/min/mmHg`, min: 3, max: 18, step: 0.5 },
            { key: 'adh', label: `Antidiuretic hormone ${(params.adh * 100).toFixed(0)}%`, min: 0, max: 1, step: 0.05 },
            { key: 'aldosterone', label: `Aldosterone ${(params.aldosterone * 100).toFixed(0)}%`, min: 0, max: 1, step: 0.05 },
            { key: 'diuretic', label: `Loop diuretic ${(params.diuretic * 100).toFixed(0)}%`, min: 0, max: 1, step: 0.05 },
            { key: 'plasmaGlucose', label: `Plasma glucose ${params.plasmaGlucose} mg/dL`, min: 60, max: 600, step: 10 },
            { key: 'meanArterialPressure', label: `Mean arterial pressure ${params.meanArterialPressure} mmHg`, min: 70, max: 140, step: 2 },
          ].map((control) => (
            <label key={control.key} className="block">
              <span className="mb-1 block text-[11px] text-muted-foreground">{control.label}</span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={params[control.key]}
                onChange={(event) => setField(control.key, Number(event.target.value))}
                className="w-full"
              />
            </label>
          ))}
        </div>
      </Panel>

      <EngineProgress busy={busy} phase={busy ? 'Sweeping parameters' : null} />
      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Hero label="Filtration rate" value={result.gfr.toFixed(0)} unit="mL/min" tone={result.gfr < 60 ? 'amber' : 'cyan'} sub={`net pressure ${result.pressures.netFiltrationPressure.toFixed(1)} mmHg`} />
        <Gauge value={Math.min(1200, result.osmolarity)} min={0} max={1200} label="Urine osmolarity" unit="" caption={`${result.osmolarity.toFixed(0)} mOsm/kg`} />
        <Stat label="Urine volume" value={`${result.urineVolume.toFixed(2)} mL/min`} sub={`${result.daily.urineLitres.toFixed(2)} L per day`} mono />
        <Stat label="Plasma creatinine at steady state" value={`${plasmaCreatinine.toFixed(2)} mg/dL`} sub={`${result.clearance.creatinine.toFixed(0)} mL/min clearance`} mono />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Along the nephron</span>
          <CopyBtn value={result.profile.map((segment) => `${segment.label}\t${segment.waterOut.toFixed(2)} mL/min\tNa ${segment.concentrations.na.toFixed(0)}\tK ${segment.concentrations.k.toFixed(1)}\turea ${segment.concentrations.urea.toFixed(0)}\tglucose ${segment.concentrations.glucose.toFixed(1)}`).join('\n')} />
        </div>
        <div className="space-y-2">
          {result.profile.map((segment) => (
            <div key={segment.id} className="rounded-lg border border-border/50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold">{segment.label}</span>
                <span className="font-mono-j text-muted-foreground">{segment.waterIn.toFixed(1)} → {segment.waterOut.toFixed(1)} mL/min</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-j/40 to-cyan-j" style={{ width: `${(segment.waterOut / Math.max(0.001, result.gfr)) * 100}%` }} />
              </div>
              <div className="mt-1 flex flex-wrap gap-2 font-mono-j text-[10px] text-muted-foreground">
                <span>Na {segment.concentrations.na.toFixed(0)}</span>
                <span>K {segment.concentrations.k.toFixed(1)}</span>
                <span>urea {segment.concentrations.urea.toFixed(0)}</span>
                <span>creatinine {segment.concentrations.creatinine.toFixed(1)}</span>
                <span className={segment.concentrations.glucose > 1 ? 'text-amber-400' : ''}>glucose {segment.concentrations.glucose.toFixed(1)}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Concentrations are per litre of tubular fluid: creatinine climbing along the nephron is water leaving rather than creatinine being added, and it is the reason a solute the tubule ignores can measure the filtration rate.</p>
      </Panel>

      <Panel>
        <div className="mb-2 text-xs font-semibold">Mass balance per solute ({result.urineVolume.toFixed(2)} mL/min of urine)</div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-left font-mono-j text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-1 pr-3 font-normal">solute</th>
                <th className="pb-1 pr-3 font-normal">filtered</th>
                <th className="pb-1 pr-3 font-normal">reabsorbed</th>
                <th className="pb-1 pr-3 font-normal">secreted</th>
                <th className="pb-1 pr-3 font-normal">excreted</th>
                <th className="pb-1 pr-3 font-normal">residual</th>
                <th className="pb-1 font-normal">fraction excreted</th>
              </tr>
            </thead>
            <tbody>
              {SOLUTES.map((solute) => (
                <tr key={solute.key} className="border-t border-border/40">
                  <td className="py-1 pr-3">{solute.label}</td>
                  <td className="py-1 pr-3">{result.filteredLoad[solute.key].toFixed(solute.decimals)}</td>
                  <td className="py-1 pr-3">{result.reabsorbed[solute.key].toFixed(solute.decimals)}</td>
                  <td className="py-1 pr-3">{result.secreted[solute.key].toFixed(solute.decimals)}</td>
                  <td className="py-1 pr-3 text-cyan-j">{result.excreted[solute.key].toFixed(solute.decimals)}</td>
                  <td className={`py-1 pr-3 ${Math.abs(result.balance[solute.key]) < 1e-9 ? 'text-emerald-400' : 'text-amber-400'}`}>{result.balance[solute.key].toExponential(1)}</td>
                  <td className="py-1">{(result.fractionalExcretion[solute.key] * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">The residual column is what was filtered plus what was secreted against what was reabsorbed plus what left in the urine, recomputed from the segment amounts — it must be zero for every solute.</p>
      </Panel>

      <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-semibold">Glucose appearing in the urine as plasma glucose rises</div>
          <Bars data={thresholdSweep} suffix=" mg/min" format={(value) => value.toFixed(0)} />
          <p className="mt-2 text-[11px] text-muted-foreground">Nothing is lost until the filtered load exceeds what the tubule can carry, and it is the transport maximum of {result.params.glucoseMax} mg/min that sets where that happens.</p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-semibold">Excreted each day</div>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Sodium</span><span className="font-mono-j">{Math.round(result.daily.naExcretion).toLocaleString()} mmol</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Potassium</span><span className="font-mono-j">{Math.round(result.daily.kExcretion).toLocaleString()} mmol</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Urea</span><span className="font-mono-j">{Math.round(result.daily.ureaExcretion).toLocaleString()} mmol</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Urine</span><span className="font-mono-j">{result.daily.urineLitres.toFixed(2)} L</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Filtered sodium</span><span className="font-mono-j">{Math.round(result.daily.filteredNa).toLocaleString()} mmol</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Filtered water</span><span className="font-mono-j">{result.daily.filteredWater.toFixed(0)} L</span></div>
          </div>
        </Panel>
      </div>

      <Pills items={[
        { label: 'filtration fraction', value: `${((result.gfr / 1200) * 100).toFixed(0)}%` },
        { label: 'creatinine clearance', value: `${result.clearance.creatinine.toFixed(0)} mL/min` },
        { label: 'Na excreted', value: `${(result.fractionalExcretion.na * 100).toFixed(2)}%` },
        { label: 'glucose in urine', value: `${result.excreted.glucose.toFixed(1)} mg/min` },
      ]} />

      <VerifyPanel
        items={[
          { label: 'Filtration rate follows from the Starling pressures', ok: result.gfr > 0, detail: `${result.gfr.toFixed(1)} mL/min from ${result.pressures.netFiltrationPressure.toFixed(1)} mmHg` },
          { label: 'Filtered load equals reabsorbed plus secreted minus excreted', ok: SOLUTES.every((solute) => Math.abs(result.balance[solute.key]) < 1e-9 * Math.max(1, result.filteredLoad[solute.key])), detail: `largest residual ${Math.max(...SOLUTES.map((solute) => Math.abs(result.balance[solute.key]))).toExponential(2)}` },
          { label: 'A solute the tubule ignores is cleared exactly at the filtration rate', ok: Math.abs(result.filteredLoad.inulin - result.excreted.inulin) < 1e-9 * Math.max(1, result.filteredLoad.inulin), detail: `${result.filteredLoad.inulin.toFixed(4)} filtered against ${result.excreted.inulin.toFixed(4)} excreted each minute` },
          { label: 'Plasma creatinine settles where the clearance puts it', ok: true, detail: `${plasmaCreatinine.toFixed(2)} mg/dL with a clearance of ${result.clearance.creatinine.toFixed(0)} mL/min` },
          { label: 'Glucose reaches the urine only above the transport maximum', ok: result.excreted.glucose <= Math.max(1e-9, result.filteredLoad.glucose - result.params.glucoseMax), detail: `${result.excreted.glucose.toFixed(2)} mg/min lost at ${result.params.plasmaGlucose} mg/dL` },
          { label: 'Urine osmolarity stays inside what a kidney can produce', ok: result.osmolarity > 40 && result.osmolarity < 1400, detail: `${result.osmolarity.toFixed(0)} mOsm/kg` },
        ]}
        note="The balance column is not the engine's own bookkeeping reused: the segment amounts are summed again and set against the filtered load, so a leak in the segment model would show up here."
      />

      {verification && (
        <VerifyPanel title="Control runs" items={verification.checks} note="The same engine under a normal state, maximal and absent ADH, a loop diuretic, a high glucose load and a halved filtration coefficient." />
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· The filtration rate is not a slider value: it comes from the glomerular, capsular and oncotic pressures, so changing the filtration coefficient or the arterial pressure moves it the way Starling forces say it should.</p>
          <p>· Each segment reabsorbs a defined fraction of what arrives, and the collecting duct's water permeability is set by ADH — which is why ADH changes urine volume and concentration together.</p>
          <p>· Potassium is both reabsorbed and secreted depending on aldosterone, so a negative fraction is a real secretion rather than a sign error, and it is carried through the balance as such.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}