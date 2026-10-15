import { useState } from 'react';
import { Waves, ShieldCheck, Plus, Trash2 } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { Field, Panel, Stat } from '../shared';
import { NMR_PRESETS, MAX_SPINS, transitionsOf, spectrum, findPeaks, verifyNmr } from './nmrCore';

function SpectrumChart({ trace, field }) {
  const width = 720;
  const height = 240;
  const [from, to] = trace.range;
  const points = trace.x.map((value, index) => `${(((value - from) / (to - from)) * width).toFixed(1)},${(height - (trace.y[index] / (trace.peak || 1)) * (height - 14) - 6).toFixed(1)}`);
  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-60 w-full">
        <defs>
          <linearGradient id="nmr-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(189 100% 50%)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(189 100% 50%)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line key={fraction} x1="0" x2={width} y1={height * fraction} y2={height * fraction} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="3 5" />
        ))}
        <path d={`M0,${height - 6} L${points.join(' L')} L${width},${height - 6} Z`} fill="url(#nmr-fill)" stroke="hsl(189 100% 50%)" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between font-mono-j text-[10px] text-muted-foreground">
        <span>{(from / field).toFixed(3)} ppm</span>
        <span>{(((from + to) / 2) / field).toFixed(3)} ppm</span>
        <span>{(to / field).toFixed(3)} ppm</span>
      </div>
    </div>
  );
}

export default function NmrStudio() {
  const [presetId, setPresetId] = useState('ax');
  const [spins, setSpins] = useState(NMR_PRESETS.ax.spins);
  const [couplings, setCouplings] = useState(NMR_PRESETS.ax.couplings);
  const [field, setField] = useState(NMR_PRESETS.ax.field);
  const [linewidth, setLinewidth] = useState(0.6);
  const [run, setRun] = useState(() => {
    const computed = transitionsOf(NMR_PRESETS.ax.spins, NMR_PRESETS.ax.couplings, NMR_PRESETS.ax.field);
    return { ...computed, peaks: findPeaks(computed.transitions, { linewidth: 0.6 }), trace: spectrum(computed.transitions, { linewidth: 0.6 }) };
  });
  const [verification, setVerification] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const compute = (nextSpins = spins, nextCouplings = couplings, nextField = field, nextWidth = linewidth) => {
    try {
      setError(null);
      const computed = transitionsOf(nextSpins, nextCouplings, nextField);
      setRun({
        ...computed,
        peaks: findPeaks(computed.transitions, { linewidth: nextWidth }),
        trace: spectrum(computed.transitions, { linewidth: nextWidth }),
      });
    } catch (problem) {
      setError(problem.message);
    }
  };

  const applyPreset = (id) => {
    const preset = NMR_PRESETS[id];
    setPresetId(id);
    setSpins(preset.spins);
    setCouplings(preset.couplings);
    setField(preset.field);
    compute(preset.spins, preset.couplings, preset.field);
  };

  const verify = () => {
    setBusy('verify');
    try {
      setVerification(verifyNmr());
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(null);
    }
  };

  const exportText = run.peaks.map((peak) => `${(peak.frequency / field).toFixed(4)} ppm,${peak.frequency.toFixed(4)} Hz,${peak.relative.toFixed(4)}`).join('\n');

  return (
    <ToolShell
      toolId="nmr-spin"
      icon={Waves}
      title="NMR Spin System Simulator"
      desc="The spin Hamiltonian built from shifts and couplings, diagonalised by Jacobi sweeps, and every transition weighted by its transverse magnetisation matrix element — so equivalent spins and strongly coupled pairs come out right rather than being drawn by hand."
      state={{ presetId, spins, couplings, field, linewidth }}
      onRestore={(value) => {
        if (!value) return;
        const nextSpins = value.spins ?? spins;
        const nextCouplings = value.couplings ?? couplings;
        const nextField = value.field ?? field;
        setPresetId(value.presetId ?? 'ax');
        setSpins(nextSpins);
        setCouplings(nextCouplings);
        setField(nextField);
        setLinewidth(value.linewidth ?? 0.6);
        compute(nextSpins, nextCouplings, nextField, value.linewidth ?? 0.6);
      }}
      exportText={exportText}
      exportName="nmr-peaks.csv"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(NMR_PRESETS).map(([id, preset]) => (
            <button
              key={id}
              type="button"
              onClick={() => applyPreset(id)}
              className={`rounded-lg border px-2 py-1 text-[11px] transition ${presetId === id ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/60 text-muted-foreground hover:text-foreground'}`}
            >
              {preset.name}
            </button>
          ))}
        </div>
        {NMR_PRESETS[presetId]?.note && <p className="text-[11px] text-muted-foreground/80">{NMR_PRESETS[presetId].note}</p>}

        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Spectrometer (MHz)">
                <input type="number" min="40" max="1200" step="10" value={field} onChange={(event) => { const value = Number(event.target.value); setField(value); compute(spins, couplings, value); }} className="tk-glass-panel h-9 w-full rounded-md px-3 text-sm" />
              </Field>
              <Field label="Line width (Hz)">
                <input type="number" min="0.05" max="20" step="0.05" value={linewidth} onChange={(event) => { const value = Number(event.target.value); setLinewidth(value); compute(spins, couplings, field, value); }} className="tk-glass-panel h-9 w-full rounded-md px-3 text-sm" />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Nuclei — {spins.length} of {MAX_SPINS}, {1 << spins.length} states</span>
                <Button size="sm" variant="outline" disabled={spins.length >= MAX_SPINS} onClick={() => { const next = [...spins, { label: `S${spins.length + 1}`, shift: 3 }]; setSpins(next); compute(next, couplings, field); }} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />Add
                </Button>
              </div>
              {spins.map((spin, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-12 truncate font-mono-j text-[11px] text-muted-foreground">{spin.label}</span>
                  <input
                    type="number"
                    step="0.05"
                    value={spin.shift}
                    onChange={(event) => { const next = spins.map((entry, position) => (position === index ? { ...entry, shift: Number(event.target.value) } : entry)); setSpins(next); compute(next, couplings, field); }}
                    className="tk-glass-panel h-8 w-full rounded-md px-2 text-sm"
                  />
                  <span className="w-8 text-[11px] text-muted-foreground">ppm</span>
                  <span className="w-24 shrink-0 text-right font-mono-j text-[11px] text-muted-foreground">{(spin.shift * field).toFixed(0)} Hz</span>
                  <button
                    type="button"
                    onClick={() => { const next = spins.filter((_, position) => position !== index); setSpins(next); compute(next, couplings.filter((entry) => entry.i !== index && entry.j !== index), field); }}
                    className="text-muted-foreground transition hover:text-rose-400"
                    aria-label="Remove this nucleus"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Scalar couplings (J, Hz)</span>
                <Button size="sm" variant="outline" disabled={spins.length < 2} onClick={() => { const next = [...couplings, { i: 0, j: 1, J: 7 }]; setCouplings(next); compute(spins, next, field); }} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />Add
                </Button>
              </div>
              {couplings.map((entry, index) => (
                <div key={index} className="flex items-center gap-2">
                  <select value={entry.i} onChange={(event) => { const next = couplings.map((item, position) => (position === index ? { ...item, i: Number(event.target.value) } : item)); setCouplings(next); compute(spins, next, field); }} className="tk-glass-panel h-8 w-16 rounded-md px-1 text-xs">
                    {spins.map((spin, position) => <option key={position} value={position}>{spin.label}</option>)}
                  </select>
                  <select value={entry.j} onChange={(event) => { const next = couplings.map((item, position) => (position === index ? { ...item, j: Number(event.target.value) } : item)); setCouplings(next); compute(spins, next, field); }} className="tk-glass-panel h-8 w-16 rounded-md px-1 text-xs">
                    {spins.map((spin, position) => <option key={position} value={position}>{spin.label}</option>)}
                  </select>
                  <input
                    type="number"
                    step="0.5"
                    value={entry.J}
                    onChange={(event) => { const next = couplings.map((item, position) => (position === index ? { ...item, J: Number(event.target.value) } : item)); setCouplings(next); compute(spins, next, field); }}
                    className="tk-glass-panel h-8 w-full rounded-md px-2 text-sm"
                  />
                  <button type="button" onClick={() => { const next = couplings.filter((_, position) => position !== index); setCouplings(next); compute(spins, next, field); }} className="text-muted-foreground transition hover:text-rose-400" aria-label="Remove this coupling">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <Button size="sm" variant="outline" onClick={verify} disabled={Boolean(busy)} className="gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />{busy === 'verify' ? 'Checking…' : 'Run the verification suite'}
            </Button>
            <EngineProgress busy={busy === 'verify'} phase={busy === 'verify' ? 'Checking against the known multiplets' : null} />
            {error && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">{error}</p>}
          </Panel>

          <Panel className="space-y-3">
            <SpectrumChart trace={run.trace} field={field} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="States" value={run.size} sub={`${spins.length} spin-½ nuclei`} />
              <Stat label="Transitions" value={run.transitions.length} sub="above the intensity floor" />
              <Stat label="Eigen residual" value={run.residual.toExponential(1)} sub="‖HV − VΛ‖∞" mono />
              <Stat label="Intensity sum" value={run.totalIntensity.toFixed(4)} sub={`exactly Tr(I_x²) = ${run.exactSum.toFixed(4)}`} mono />
            </div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-card/90"><tr className="text-left text-muted-foreground"><th className="py-1">δ (ppm)</th><th>ν (Hz)</th><th>Intensity</th><th>Ratio</th></tr></thead>
                <tbody className="font-mono-j">
                  {run.peaks.map((peak, index) => (
                    <tr key={index} className="border-t border-border/50">
                      <td className="py-1">{(peak.frequency / field).toFixed(3)}</td>
                      <td>{peak.frequency.toFixed(3)}</td>
                      <td>{peak.intensity.toFixed(4)}</td>
                      <td>{peak.relative.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground/80">
              Intensities are the squared transverse magnetisation matrix elements of the diagonalised system, so they carry the second-order effects. Lines within {Math.max(linewidth, 0.05) * 1.5} Hz are reported as one peak.
            </p>
          </Panel>
        </div>

        {verification && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Equivalent spins" value={`${verification.eqPeaks.length} line${verification.eqPeaks.length === 1 ? '' : 's'}`} sub="A₂ does not split itself" />
              <Stat label="Quartet ratios" value={verification.checks[7].ok ? '1 : 3 : 3 : 1' : 'not Pascal'} sub="from Pascals triangle" />
              <Stat label="AB departure" value={verification.checks[9].detail.replace('lines move by up to ', '')} sub="from first-order theory" />
              <Stat label="Six-spin system" value={`${verification.ethanol.size} states`} sub={`residual ${verification.ethanol.residual.toExponential(1)}`} />
            </div>
            <VerifyPanel items={verification.checks} note="Agreement with Pascal intensities, the absence of splitting between equivalent spins and the roof effect of a strongly coupled pair are all consequences of the Hamiltonian here rather than inputs to it." />
          </>
        )}
      </div>
    </ToolShell>
  );
}