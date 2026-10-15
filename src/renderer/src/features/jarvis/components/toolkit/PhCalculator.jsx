import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const ACIDS = [
  { name: 'Acetic acid (vinegar)', pKa: '4.76' },
  { name: 'Carbonic acid', pKa: '6.35' },
  { name: 'Citric acid', pKa: '3.13' },
  { name: 'Formic acid', pKa: '3.75' },
  { name: 'Lactic acid', pKa: '3.86' },
  { name: 'Phosphoric acid (first)', pKa: '2.15' },
  { name: 'Ammonium ion', pKa: '9.25' },
  { name: 'Boric acid', pKa: '9.24' },
  { name: 'Phenol', pKa: '9.95' },
  { name: 'Hydrofluoric acid', pKa: '3.17' },
];

const formatSci = (value) => {
  if (!value || Number.isNaN(value)) return '—';
  const exponent = Math.floor(Math.log10(value));
  const mantissa = value / Math.pow(10, exponent);
  return mantissa.toFixed(2) + ' × 10^' + exponent;
};

export default function PhCalculator() {
  const [mode, setMode] = useState('weak-acid');
  const [concentration, setConcentration] = useState('0.1');
  const [unit, setUnit] = useState('M');
  const [pKa, setPKa] = useState('4.76');
  const [acidRatio, setAcidRatio] = useState('1');
  const [baseRatio, setBaseRatio] = useState('1');
  const [v1, setV1] = useState('25');
  const [c1, setC1] = useState('1');
  const [v2, setV2] = useState('250');

  const result = useMemo(() => {
    const molarity = (Number(concentration) || 0) / (unit === 'mM' ? 1000 : 1);
    const ka = Math.pow(10, -(Number(pKa) || 0));
    const kw = 1e-14;

    if (molarity <= 0) return { error: 'Concentration must be greater than zero.' };

    if (mode === 'strong-acid') {
      const h = molarity;
      const ph = -Math.log10(h);
      return { ph, h, oh: kw / h, formula: 'pH = −log[H⁺]', note: 'A strong acid dissociates completely, so the hydrogen ion concentration is the acid concentration itself.', dissociation: 100 };
    }

    if (mode === 'strong-base') {
      const oh = molarity;
      const poh = -Math.log10(oh);
      const ph = 14 - poh;
      return { ph, h: kw / oh, oh, formula: 'pOH = −log[OH⁻], pH = 14 − pOH', note: 'A strong base gives one hydroxide per formula unit here, so [OH⁻] equals the concentration.', dissociation: 100 };
    }

    if (mode === 'weak-acid') {
      const h = (-ka + Math.sqrt(ka * ka + 4 * ka * molarity)) / 2;
      const ph = -Math.log10(h);
      return { ph, h, oh: kw / h, ka, formula: 'Ka = [H⁺][A⁻]/[HA], solved for [H⁺]', note: 'A weak acid only partly dissociates, so the equilibrium expression is solved rather than assumed.', dissociation: (h / molarity) * 100 };
    }

    if (mode === 'weak-base') {
      const kb = kw / ka;
      const oh = (-kb + Math.sqrt(kb * kb + 4 * kb * molarity)) / 2;
      const poh = -Math.log10(oh);
      const ph = 14 - poh;
      return { ph, h: kw / oh, oh, ka, kb, formula: 'Kb = [BH⁺][OH⁻]/[B], then pH = 14 − pOH', note: 'The pKa you entered belongs to the conjugate acid, so Kb = Kw ÷ Ka.', dissociation: (oh / molarity) * 100 };
    }

    if (mode === 'buffer') {
      const ratio = (Number(baseRatio) || 0) / (Number(acidRatio) || 0);
      if (ratio <= 0) return { error: 'Both buffer amounts must be greater than zero.' };
      const ph = (Number(pKa) || 0) + Math.log10(ratio);
      return { ph, h: Math.pow(10, -ph), oh: kw / Math.pow(10, -ph), formula: 'pH = pKa + log([A⁻]/[HA])', note: 'Henderson–Hasselbalch: the buffer pH sits near the pKa and shifts with the ratio of salt to acid.', ratio, dissociation: null };
    }

    const startVolume = Number(v1) || 0;
    const startConcentration = Number(c1) || 0;
    const finalVolume = Number(v2) || 0;
    if (!startVolume || !finalVolume) return { error: 'Both volumes must be greater than zero.' };
    const final = (startConcentration * startVolume) / finalVolume;
    const ph = -Math.log10(final);
    return {
      ph, h: final, oh: kw / final,
      formula: 'C₁V₁ = C₂V₂',
      note: 'Dilution only changes concentration, never the number of moles. The pH shown assumes a strong monoprotic acid.',
      final, factor: finalVolume / startVolume,
      dissociation: 100,
    };
  }, [mode, concentration, unit, pKa, acidRatio, baseRatio, v1, c1, v2]);

  const scale = result.ph !== undefined ? Math.max(0, Math.min(14, result.ph)) : 7;
  const nature = result.ph === undefined ? '' : result.ph < 6.5 ? 'acidic' : result.ph > 7.5 ? 'basic' : 'close to neutral';
  const tone = result.ph === undefined ? 'cyan' : result.ph < 6.5 ? 'rose' : result.ph > 7.5 ? 'amber' : 'emerald';

  const report = useMemo(() => {
    if (result.error) return result.error;
    return [
      'Mode: ' + mode,
      'pH ' + result.ph.toFixed(2) + ' · pOH ' + (14 - result.ph).toFixed(2),
      '[H⁺] ' + formatSci(result.h) + ' M · [OH⁻] ' + formatSci(result.oh) + ' M',
      result.dissociation !== null ? 'Dissociation: ' + result.dissociation.toFixed(2) + '%' : '',
      result.final ? 'Final concentration ' + result.final.toFixed(6) + ' M, diluted ' + result.factor.toFixed(1) + '×' : '',
      '',
      result.formula,
    ].filter(Boolean).join('\n');
  }, [result, mode]);

  return (
    <ToolShell
      toolId="ph-calculator"
      icon={FlaskConical}
      title="pH, pKa & Buffer Calculator"
      desc="Acid and base pH from a concentration, weak acid equilibrium, buffer ratios and dilution — with hydrogen and hydroxide concentrations, pOH and percentage dissociation."
      state={{ mode, concentration, unit, pKa, acidRatio, baseRatio, v1, c1, v2 }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (restored.concentration !== undefined) setConcentration(String(restored.concentration));
        if (restored.unit) setUnit(restored.unit);
        if (restored.pKa !== undefined) setPKa(String(restored.pKa));
        if (restored.acidRatio !== undefined) setAcidRatio(String(restored.acidRatio));
        if (restored.baseRatio !== undefined) setBaseRatio(String(restored.baseRatio));
        if (restored.v1 !== undefined) setV1(String(restored.v1));
        if (restored.c1 !== undefined) setC1(String(restored.c1));
        if (restored.v2 !== undefined) setV2(String(restored.v2));
      }}
      exportText={report}
      exportName="ph-calculation.txt"
    >
      <Seg
        value={mode}
        onChange={setMode}
        options={[
          { value: 'strong-acid', label: 'Strong acid' },
          { value: 'strong-base', label: 'Strong base' },
          { value: 'weak-acid', label: 'Weak acid' },
          { value: 'weak-base', label: 'Weak base' },
          { value: 'buffer', label: 'Buffer' },
          { value: 'dilution', label: 'Dilution' },
        ]}
      />

      {mode === 'buffer' ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="pKa of the acid"><input value={pKa} onChange={(e) => setPKa(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Moles of acid, HA"><input value={acidRatio} onChange={(e) => setAcidRatio(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Moles of salt, A⁻"><input value={baseRatio} onChange={(e) => setBaseRatio(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Common acids">
            <select
              onChange={(e) => { const found = ACIDS.find((entry) => entry.name === e.target.value); if (found) setPKa(found.pKa); }}
              value=""
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="">Pick a pKa…</option>
              {ACIDS.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} · {entry.pKa}</option>)}
            </select>
          </Field>
        </div>
      ) : mode === 'dilution' ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Starting concentration, M"><input value={c1} onChange={(e) => setC1(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Starting volume, mL"><input value={v1} onChange={(e) => setV1(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Final volume, mL"><input value={v2} onChange={(e) => setV2(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Concentration">
            <input value={concentration} onChange={(e) => setConcentration(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </Field>
          <Field label="Units">
            <Seg value={unit} onChange={setUnit} options={[{ value: 'M', label: 'mol/L' }, { value: 'mM', label: 'mmol/L' }]} />
          </Field>
          {(mode === 'weak-acid' || mode === 'weak-base') && (
            <Field label={mode === 'weak-acid' ? 'pKa of the acid' : 'pKa of the conjugate acid'}>
              <input value={pKa} onChange={(e) => setPKa(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            </Field>
          )}
          {(mode === 'weak-acid' || mode === 'weak-base') && (
            <Field label="Named acids">
              <select
                onChange={(e) => { const found = ACIDS.find((entry) => entry.name === e.target.value); if (found) setPKa(found.pKa); }}
                value=""
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="">Pick a pKa…</option>
                {ACIDS.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} · {entry.pKa}</option>)}
              </select>
            </Field>
          )}
        </div>
      )}

      {result.error ? (
        <Panel className="border-rose-500/40 text-[12px] text-rose-400">{result.error}</Panel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              tone={tone}
              label={'pH ' + result.ph.toFixed(2) + ' — ' + nature}
              value={result.ph.toFixed(2)}
              sub={'pOH ' + (14 - result.ph).toFixed(2) + ' · [H⁺] ' + formatSci(result.h) + ' M · [OH⁻] ' + formatSci(result.oh) + ' M'}
            />
            <Ring
              value={scale}
              max={14}
              tone={tone}
              label="Position on the pH scale"
              sub={'Below 7 is acidic, above is basic. This solution is ' + nature + '.'}
            />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Where it sits on the scale</div>
            <div className="relative h-8 overflow-hidden rounded-lg" style={{ background: 'linear-gradient(90deg, #dc2626 0%, #f97316 22%, #facc15 40%, #4ade80 50%, #22d3ee 62%, #3b82f6 80%, #7c3aed 100%)' }}>
              <div className="absolute top-0 h-full w-1.5 bg-white shadow-lg" style={{ left: (scale / 14) * 100 + '%' }} />
            </div>
            <div className="mt-1 flex justify-between font-mono-j text-[10px] text-muted-foreground">
              {[0, 2, 4, 6, 7, 8, 10, 12, 14].map((value) => <span key={value}>{value}</span>)}
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              <p>· Stomach acid sits near 1.5, lemon juice near 2, black coffee near 5, pure water at 7, blood at 7.4, bleach around 13.</p>
              <p>· A drop of one pH unit is a tenfold change in hydrogen ion concentration, which is why small differences matter so much.</p>
              <p>· Living systems buffer hard against this scale: the bicarbonate system holds blood within about 0.05 of 7.4.</p>
            </div>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Concentrations</div>
              <div className="space-y-1.5 font-mono-j text-[11px]">
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">[H⁺]</span><span>{formatSci(result.h)} M</span>
                </div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">[OH⁻]</span><span>{formatSci(result.oh)} M</span>
                </div>
                {result.dissociation !== null && result.dissociation !== undefined && (
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                    <span className="text-muted-foreground">Dissociated</span><span>{result.dissociation.toFixed(2)}%</span>
                  </div>
                )}
                {result.ka && (
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                    <span className="text-muted-foreground">Ka · pKa</span><span>{formatSci(result.ka)} · {(Number(pKa) || 0).toFixed(2)}</span>
                  </div>
                )}
                {result.kb && (
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                    <span className="text-muted-foreground">Kb</span><span>{formatSci(result.kb)}</span>
                  </div>
                )}
                {result.final && (
                  <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5">
                    <span>Diluted to</span><span className="text-cyan-j">{result.final.toFixed(6)} M · {result.factor.toFixed(1)}×</span>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{result.note}</p>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">The working</span>
                <CopyBtn value={report} label="Copy the result" />
              </div>
              <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
                <p>{result.formula}</p>
                {mode === 'buffer' && <p>pH = {pKa} + log({baseRatio} ÷ {acidRatio}) = {result.ph.toFixed(2)}</p>}
                {(mode === 'strong-acid' || mode === 'strong-base') && <p>[H⁺] = {molarLine(concentration, unit)} = {formatSci(result.h)} M</p>}
                {(mode === 'weak-acid' || mode === 'weak-base') && (
                  <p>[H⁺] from the quadratic: (−Ka + √(Ka² + 4·Ka·C)) ÷ 2, with Ka = {formatSci(result.ka)}</p>
                )}
                <p>pH = −log({formatSci(result.h)}) = {result.ph.toFixed(2)}</p>
                <p>pOH = 14 − pH = {(14 - result.ph).toFixed(2)}</p>
                <p className="text-cyan-j">Check: [H⁺] × [OH⁻] = {formatSci(result.h * result.oh)} — this should be 1 × 10^−14 at 25 °C.</p>
              </div>
            </Panel>
          </div>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Which formula applies when</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Strong acid or base: dissociation is complete, so the concentration is the ion concentration — no equilibrium needed.</p>
            <p>· Weak acid: use Ka and the equilibrium expression. The full quadratic is used here rather than assuming [H⁺] ≈ √(Ka·C), so the answer holds even for stronger weak acids.</p>
            <p>· Weak base: convert the pKa you have into Kb with Kb = Kw ÷ Ka, then solve the same way and convert to pH through pOH.</p>
            <p>· Buffer: Henderson–Hasselbalch. The pH sits at the pKa when the amounts are equal, and moves by about one pH unit for each tenfold change in ratio.</p>
            <p>· Dilution: C₁V₁ = C₂V₂. Diluting an acid by ten raises the pH by exactly one, which is a quick sanity check on any answer.</p>
            <p>· Very dilute strong acids approach neutral water, where the autoionisation of water must be included — below about 10⁻⁶ M this simple treatment becomes optimistic.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">pKa values worth knowing</div>
          <div className="space-y-1">
            {ACIDS.map((entry) => (
              <div key={entry.name} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span>{entry.name}</span>
                <span className="font-mono-j text-cyan-j">{entry.pKa}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            A lower pKa means a stronger acid. Buffers work best within about one pH unit of the pKa, which is why the bicarbonate pair suits blood and acetate suits
            a pH near 4.8.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="pH" value={result.error ? '—' : result.ph.toFixed(2)} mono sub={nature} />
        <Stat label="pOH" value={result.error ? '—' : (14 - result.ph).toFixed(2)} mono />
        <Stat label="[H⁺]" value={result.error ? '—' : formatSci(result.h)} mono />
        <Stat label="[OH⁻]" value={result.error ? '—' : formatSci(result.oh)} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Doing this in the lab</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Enter the concentration of the species you actually weighed out, not the dilution you intended.</p>
          <p>· Measure pH with a calibrated electrode. Indicator paper is fine for a rough check and poor for anything quantitative.</p>
          <p>· Temperature matters: Kw and pKa both move with it, so a calculation at 25 °C will be slightly off in a cold room.</p>
          <p>· For a titration, the interesting pH values are at the start, at the half-equivalence point (where pH = pKa) and at equivalence — this tool covers the first two directly.</p>
          <p>· Buffer capacity falls as the ratio moves away from one, so keep the salt and acid within a factor of ten of each other.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Mode', value: mode.replace('-', ' ') },
              { label: 'pH', value: result.error ? '—' : result.ph.toFixed(2) },
              { label: 'Nature', value: nature || '—' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          All calculations use Kw = 1 × 10⁻¹⁴, valid at 25 °C, and the weak acid case is solved with the full quadratic so it stays accurate well beyond the usual
          assumption that the acid barely dissociates. The hydrogen and hydroxide concentrations are cross-checked against the ion product as you type.
        </p>
      </Panel>
    </ToolShell>
  );
}

const molarLine = (value, unitName) => (Number(value) || 0) + (unitName === 'mM' ? ' mmol/L ÷ 1000' : ' mol/L');