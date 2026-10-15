import { useState } from 'react';
import { FlaskConical, Play, ShieldCheck } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { Field, Panel, Stat } from '../shared';
import { Hero } from '../kit/premium';
import { SYSTEMS, solveSpeciation, titration, verifyEquilibrium } from './equilibriumCore';

function TitrationChart({ curve }) {
  const width = 720;
  const height = 240;
  const maxBase = Math.max(...curve.map((point) => point.addedBase), 1e-9);
  const yFor = (pH) => height - ((pH / 14) * (height - 12)) - 6;
  const path = curve.map((point, index) => `${index ? 'L' : 'M'}${((point.addedBase / maxBase) * width).toFixed(1)},${yFor(point.pH).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-60 w-full">
      {[0, 7, 14].map((pH) => (
        <g key={pH}>
          <line x1="0" x2={width} y1={yFor(pH)} y2={yFor(pH)} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="3 5" />
          <text x="4" y={yFor(pH) - 4} fontSize="10" fill="hsl(var(--muted-foreground))">pH {pH}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="hsl(189 100% 50%)" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

export default function EquilibriumStudio() {
  const [systemId, setSystemId] = useState('acetic');
  const [addedBase, setAddedBase] = useState(0);
  const [sweepTo, setSweepTo] = useState(0.1);
  const [result, setResult] = useState(() => solveSpeciation(SYSTEMS.acetic));
  const [curve, setCurve] = useState(null);
  const [verification, setVerification] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const solve = (id = systemId, base = addedBase) => {
    try {
      setError(null);
      setResult(solveSpeciation(SYSTEMS[id], { addedBase: base }));
      setCurve(null);
    } catch (problem) {
      setError(problem.message);
    }
  };

  const choose = (id) => {
    setSystemId(id);
    setAddedBase(0);
    solve(id, 0);
  };

  const sweep = () => {
    setBusy('sweep');
    try {
      setCurve(titration(SYSTEMS[systemId], { from: 0, to: sweepTo, points: 60 }));
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(null);
    }
  };

  const verify = () => {
    setBusy('verify');
    try {
      setVerification(verifyEquilibrium());
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(null);
    }
  };

  const ranked = [...result.system.species].sort((a, b) => result.concentrations[b.id] - result.concentrations[a.id]);
  const largest = Math.max(...ranked.map((species) => result.concentrations[species.id]), 1e-30);
  const exportText = ranked.map((species) => `${species.label},${species.charge},${result.concentrations[species.id].toExponential(8)}`).join('\n');

  return (
    <ToolShell
      toolId="equilibrium-solver"
      title="Chemical Equilibrium Solver"
      desc="Every species written as a formation reaction from the system's components, then the mass balances and the charge balance solved together by Newton in log-concentration space. Two mass balances, four constants, one answer — and it is checked against the closed forms."
      icon={FlaskConical}
      state={{ systemId, addedBase, sweepTo }}
      onRestore={(value) => {
        if (!value) return;
        setSystemId(value.systemId);
        setAddedBase(value.addedBase ?? 0);
        setSweepTo(value.sweepTo ?? 0.1);
        solve(value.systemId, value.addedBase ?? 0);
      }}
      exportText={exportText}
      exportName="speciation.csv"
    >
      <div className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel className="space-y-3">
            <Field label="System">
              <select value={systemId} onChange={(event) => choose(event.target.value)} className="tk-glass-panel h-9 w-full rounded-md px-2 text-sm">
                {Object.entries(SYSTEMS).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}
              </select>
            </Field>
            <Field label="Added strong base (Na⁺, mol/L)" hint="A spectator ion: it carries charge in and nothing else">
              <input
                type="number"
                min="0"
                step="0.005"
                value={addedBase}
                onChange={(event) => { const value = Math.max(0, Number(event.target.value)); setAddedBase(value); solve(systemId, value); }}
                className="tk-glass-panel h-9 w-full rounded-md px-3 text-sm"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => solve()} className="gap-1.5"><Play className="h-3.5 w-3.5" />Solve</Button>
              <Button size="sm" variant="outline" onClick={sweep} disabled={Boolean(busy)} className="gap-1.5"><Play className="h-3.5 w-3.5" />Titration curve</Button>
              <Button size="sm" variant="outline" onClick={verify} disabled={Boolean(busy)} className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />Verify</Button>
            </div>
            <Field label="Sweep up to (mol/L added base)">
              <input type="number" min="0.01" step="0.01" value={sweepTo} onChange={(event) => setSweepTo(Number(event.target.value))} className="tk-glass-panel h-9 w-full rounded-md px-3 text-sm" />
            </Field>
            {error && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">{error}</p>}
            <EngineProgress busy={busy === 'sweep'} phase={busy === 'sweep' ? 'Solving the curve point by point' : null} />
            {curve && <TitrationChart curve={curve} />}
          </Panel>

          <Panel className="space-y-3">
            <Hero label="pH" value={result.pH.toFixed(4)} sub={`pOH ${result.pOH.toFixed(4)} · ${result.iterations} Newton iterations${result.scanUsed ? ' · pH scan used for the first guess' : ''} · ${result.converged ? 'converged' : 'not converged'}`} />
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Charge balance" value={Math.abs(result.chargeResidual).toExponential(2)} sub="relative to the largest total" mono />
              <Stat label="Mass balances" value={Object.entries(result.balances).map(([id, entry]) => `${id} ${entry.relative.toExponential(1)}`).join(' · ') || '—'} sub="relative residual each" mono />
            </div>
            <div className="space-y-1.5">
              {ranked.slice(0, 8).map((species) => {
                const share = result.concentrations[species.id] / largest;
                return (
                  <div key={species.id} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span>{species.label}<span className="ml-1 text-muted-foreground">z = {species.charge > 0 ? '+' : ''}{species.charge}</span></span>
                      <span className="font-mono-j text-muted-foreground">{result.concentrations[species.id].toExponential(3)} M</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-border/50">
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-j/50 to-cyan-j" style={{ width: `${Math.max(1, share * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {verification && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Weak acid, solver" value={verification.acetic.pH.toFixed(6)} sub="0.1 M acetic acid" />
              <Stat label="Half-neutralised" value={verification.acetateBuffer.pH.toFixed(4)} sub="must land on pK_a 4.76" />
              <Stat label="Amphiprotic salt" value={verification.phosphateSalt.pH.toFixed(4)} sub="between its two pK_a values" />
              <Stat label="Worst charge residual" value={Math.max(...[verification.water, verification.strong, verification.acetic].map((entry) => Math.abs(entry.chargeResidual))).toExponential(2)} sub="across systems" />
            </div>
            <VerifyPanel items={verification.checks} note="The identities used here — water at pH 7, the quadratic weak acid, half-neutralisation landing on pK_a, an amphiprotic salt at the midpoint of its two pK_a values — are independent of this solver, so agreement is evidence rather than assertion." />
          </>
        )}
      </div>
    </ToolShell>
  );
}