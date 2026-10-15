import { useState } from 'react';
import { Droplets, Play, ShieldCheck } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { CopyBtn, Field, Panel, Seg, Stat } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import { COMPONENTS, MODELS, PAIRS, azeotrope, bubbleTemperature, dewTemperature, diagram, flash, verifyFlash } from './flashCore';

const number = (value, digits = 4) => (Number.isFinite(value) ? value.toFixed(digits) : '—');

function DiagramChart({ curve, azeotrope: point }) {
  const width = 720;
  const height = 300;
  const temperatures = curve.flatMap((entry) => [entry.bubbleT, entry.dewT]).filter(Number.isFinite);
  const low = Math.min(...temperatures) - 1.5;
  const high = Math.max(...temperatures) + 1.5;
  const x = (value) => 44 + value * (width - 60);
  const y = (tC) => height - 34 - ((tC - low) / (high - low)) * (height - 54);
  const line = (points) => points.map((p, index) => `${index ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const bubbleLine = line(curve.filter((entry) => Number.isFinite(entry.bubbleT)).map((entry) => [entry.bubbleY1, entry.bubbleT]));
  const dewLine = line(curve.filter((entry) => Number.isFinite(entry.dewT)).map((entry) => [entry.dewX1, entry.dewT]));
  const ticks = Array.from({ length: 5 }, (_, index) => low + ((high - low) * index) / 4);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {ticks.map((value) => (
        <g key={value}>
          <line x1={44} x2={width - 16} y1={y(value)} y2={y(value)} stroke="hsl(var(--border))" strokeWidth="0.6" />
          <text x={6} y={y(value) + 3} fontSize="9" fill="hsl(var(--muted-foreground))" className="font-mono-j">{value.toFixed(1)}</text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((value) => (
        <g key={`x-${value}`}>
          <line x1={x(value)} x2={x(value)} y1={height - 34} y2={height - 30} stroke="hsl(var(--border))" />
          <text x={x(value)} y={height - 20} fontSize="9" textAnchor="middle" fill="hsl(var(--muted-foreground))" className="font-mono-j">{value.toFixed(2)}</text>
        </g>
      ))}
      <path d={dewLine} fill="none" stroke="hsl(265 85% 68%)" strokeWidth="1.8" />
      <path d={bubbleLine} fill="none" stroke="hsl(189 100% 50%)" strokeWidth="1.8" />
      {point && (
        <g>
          <circle cx={x(point.x[0])} cy={y(point.tC)} r="4.5" fill="hsl(38 92% 55%)" />
          <text x={x(point.x[0]) + 8} y={y(point.tC) - 6} fontSize="10" fill="hsl(38 92% 55%)" className="font-mono-j">
            azeotrope {point.x[0].toFixed(3)} / {point.tC.toFixed(1)} °C
          </text>
        </g>
      )}
      <text x={width - 20} y={height - 20} fontSize="9" textAnchor="end" fill="hsl(var(--muted-foreground))" className="font-mono-j">
        cyan: bubble curve · violet: dew curve
      </text>
    </svg>
  );
}

export default function FlashStudio() {
  const [preset, setPreset] = useState('ethanol-water');
  const [mode, setMode] = useState('flash');
  const [tC, setTC] = useState(86);
  const [pressure, setPressure] = useState(101.325);
  const [light, setLight] = useState(0.3);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const [checks, setChecks] = useState(null);

  const pair = PAIRS[preset];
  const system = { components: pair.components, model: pair.model };
  const composition = [light, 1 - light];

  const run = () => {
    setError('');
    setProgress({ busy: true, phase: mode === 'flash' ? 'Solving the split' : 'Building the diagram' });
    try {
      if (mode === 'flash') {
        const split = flash({ components: pair.components, model: pair.model }, { tC, P: pressure, z: composition });
        const bubble = bubbleTemperature(system, pressure, split.phase === 'vapour' ? split.x : composition);
        const dew = dewTemperature(system, pressure, split.phase === 'liquid' ? split.y : composition);
        setResult({ kind: 'flash', split, bubble, dew });
      } else {
        setResult({
          kind: 'diagram',
          curve: diagram(system, { P: pressure, points: 40 }),
          azeotrope: azeotrope(system, { P: pressure }),
        });
      }
    } catch (issue) {
      setError(issue.message);
    } finally {
      setProgress(null);
    }
  };

  const verify = () => {
    setProgress({ busy: true, phase: 'Running the independent checks' });
    window.setTimeout(() => {
      setChecks(verifyFlash().checks);
      setProgress(null);
    }, 20);
  };

  const split = result?.kind === 'flash' ? result.split : null;
  const exportText = split
    ? [
      `${pair.label} at ${tC} °C and ${pressure.toFixed(3)} kPa`,
      `overall composition ${composition.map((value, index) => `${COMPONENTS[pair.components[index]].label} ${value.toFixed(4)}`).join(', ')}`,
      `phase: ${split.phase}`,
      `vapour fraction β = ${number(split.beta, 6)}`,
      `liquid  x = ${split.x.map((value) => number(value, 6)).join('  ')}`,
      `vapour  y = ${split.y.map((value) => number(value, 6)).join('  ')}`,
      `K = ${split.K.map((value) => number(value, 5)).join('  ')}`,
      split.relativeVolatility ? `relative volatility α = ${number(split.relativeVolatility, 5)}` : '',
      `bubble point ${number(result.bubble?.tC, 3)} °C, dew point ${number(result.dew?.tC, 3)} °C`,
      split.rrResidual !== undefined ? `Rachford–Rice residual ${split.rrResidual.toExponential(2)}` : '',
    ].filter(Boolean).join('\n')
    : result?.kind === 'diagram'
      ? [`${pair.label} T–x–y diagram at ${pressure.toFixed(3)} kPa`,
        result.azeotrope
          ? `azeotrope at x₁ = ${number(result.azeotrope.x[0], 4)} and ${number(result.azeotrope.tC, 2)} °C (${result.azeotrope.kind})`
          : 'no azeotrope at this pressure'].join('\n')
      : '';

  return (
    <ToolShell
      toolId="flash-separation"
      icon={Droplets}
      title="Flash & Distillation Engine"
      desc="Modified Raoult's law with Antoine vapour pressures and Margules or van Laar liquid activity, solving the Rachford–Rice split, the bubble and dew points, the full T–x–y diagram and any binary azeotrope — every result checked against the closed forms it must satisfy."
      state={{ preset, mode, tC, pressure, light }}
      onRestore={(value) => {
        if (!value) return;
        if (value.preset) setPreset(value.preset);
        if (value.mode) setMode(value.mode);
        if (value.tC != null) setTC(value.tC);
        if (value.pressure != null) setPressure(value.pressure);
        if (value.light != null) setLight(value.light);
      }}
      exportText={exportText}
      exportName="flash-separation.txt"
    >
      <div className="space-y-4">
        <Panel className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mixture">
              <select
                value={preset}
                onChange={(event) => setPreset(event.target.value)}
                className="tk-glass-panel w-full rounded-md px-2 py-2 text-sm focus-glow"
              >
                {Object.entries(PAIRS).map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
              </select>
            </Field>
            <Field label="Calculation">
              <Seg value={mode} onChange={setMode} options={[{ value: 'flash', label: 'Flash split' }, { value: 'diagram', label: 'T–x–y diagram' }]} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {mode === 'flash' && (
              <Field label="Light component mole fraction" hint={`${COMPONENTS[pair.components[0]].label} in the feed`}>
                <input
                  type="number"
                  step="0.01"
                  min="0.0001"
                  max="0.9999"
                  value={light}
                  onChange={(event) => setLight(Math.min(0.9999, Math.max(0.0001, Number(event.target.value))))}
                  className="tk-glass-panel w-full rounded-md px-2 py-2 text-sm focus-glow"
                />
              </Field>
            )}
            <Field label="Temperature (°C)">
              <input
                type="number"
                step="1"
                value={tC}
                onChange={(event) => setTC(Number(event.target.value))}
                className="tk-glass-panel w-full rounded-md px-2 py-2 text-sm focus-glow"
              />
            </Field>
            <Field label="Pressure (kPa)">
              <input
                type="number"
                step="1"
                value={pressure}
                onChange={(event) => setPressure(Math.max(1, Number(event.target.value)))}
                className="tk-glass-panel w-full rounded-md px-2 py-2 text-sm focus-glow"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={run} className="gap-1.5"><Play className="h-4 w-4" />{mode === 'flash' ? 'Solve the split' : 'Build the diagram'}</Button>
            <Pills items={[
              { label: 'Vapour pressure model', value: 'Antoine' },
              { label: 'Liquid model', value: MODELS[pair.model.kind] },
            ]} />
            {exportText && <CopyBtn value={exportText} label="Copy the result" />}
          </div>
          {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{error}</p>}
        </Panel>

        <EngineProgress {...(progress ?? {})} />

        {split && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero
                label={split.phase === 'two-phase' ? 'Vapour fraction β' : 'Phase'}
                value={split.phase === 'two-phase' ? split.beta.toFixed(4) : split.phase}
                sub={split.phase === 'two-phase' ? `${(split.beta * 100).toFixed(1)}% vapour, ${((1 - split.beta) * 100).toFixed(1)}% liquid` : 'a single phase at this state'}
                tone="cyan"
              />
              <Stat label="Bubble point" value={number(result.bubble?.tC, 2)} sub="°C where this liquid first boils" mono />
              <Stat label="Dew point" value={number(result.dew?.tC, 2)} sub="°C where this vapour first condenses" mono />
              <Stat label="Relative volatility" value={split.relativeVolatility ? number(split.relativeVolatility, 4) : '—'} sub="heavy over light K" mono />
            </div>

            <Panel className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-sm font-semibold">Phase compositions</span>
                <Pills items={[
                  { label: 'Σx − 1', value: number(split.sumX, 10) },
                  { label: 'Σy − 1', value: number(split.sumY, 10) },
                  split.rrResidual !== undefined ? { label: 'Rachford–Rice residual', value: split.rrResidual.toExponential(2) } : { label: 'Single phase' },
                ]} />
              </div>
              <Bars
                data={[
                  { label: `x ${COMPONENTS[pair.components[0]].label}`, value: split.x[0] },
                  { label: `y ${COMPONENTS[pair.components[0]].label}`, value: split.y[0] },
                  { label: `x ${COMPONENTS[pair.components[1]].label}`, value: split.x[1] },
                  { label: `y ${COMPONENTS[pair.components[1]].label}`, value: split.y[1] },
                ]}
                height={130}
                format={(value) => value.toFixed(4)}
              />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {pair.components.map((id, index) => (
                  <Stat key={id} label={`K ${COMPONENTS[id].label}`} value={number(split.K[index], 4)} sub={`γ = ${number(split.gamma?.[index] ?? 1, 4)} · Pˢᵃᵗ = ${number(split.K[index] * pressure / (split.gamma?.[index] ?? 1), 2)} kPa`} mono />
                ))}
              </div>
            </Panel>
          </>
        )}

        {result?.kind === 'diagram' && (
          <Panel className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-sm font-semibold">Temperature–composition diagram</span>
              <Pills items={result.azeotrope
                ? [{ label: 'Azeotrope', value: `x₁ = ${number(result.azeotrope.x[0], 4)} at ${number(result.azeotrope.tC, 2)} °C` },
                  { label: result.azeotrope.kind, tone: 'amber' }]
                : [{ label: 'No azeotrope at this pressure', tone: 'amber' }]} />
            </div>
            <DiagramChart curve={result.curve} azeotrope={result.azeotrope} />
            <p className="text-[11px] text-muted-foreground/80">
              The two curves meet at the pure components; where they meet in between, the mixture has an azeotrope and no amount of ordinary distillation separates it past that point.
            </p>
          </Panel>
        )}

        <Panel className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-display text-sm font-semibold">Independent checks</span>
            <Button variant="outline" onClick={verify} className="gap-1.5"><ShieldCheck className="h-4 w-4" />Run the checks</Button>
          </div>
          {checks
            ? <VerifyPanel items={checks.map((check) => ({ label: check.label, ok: check.ok, detail: check.detail }))} note="Flash against its analytic solution, bubble and dew against their definitions, the model parameters against the reported ethanol–water azeotrope, and every Antoine pair against its normal boiling point." />
            : <p className="text-[11px] text-muted-foreground/80">Seventeen checks, including the exact binary split, probability of the phase boundaries and a non-ideal consistency residual.</p>}
        </Panel>
      </div>
    </ToolShell>
  );
}