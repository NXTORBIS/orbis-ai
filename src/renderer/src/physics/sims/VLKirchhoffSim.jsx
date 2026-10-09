import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { RotateCcw } from 'lucide-react';

// Kirchhoff's Laws — multi-loop circuit analysis.
// Unique: two-loop circuit with KVL/KCL solver, node voltages and branch currents.
export default function VLKirchhoffSim() {
  const [V1, setV1] = useState(12);
  const [V2, setV2] = useState(9);
  const [R1, setR1] = useState(100);
  const [R2, setR2] = useState(150);
  const [R3, setR3] = useState(200);
  const [trials, setTrials] = useState([]);
  const { explain, explaining, output } = useAIExplain();

  // Two-loop circuit: V1-R1-R3-R2-V2 (outer), R3 is shared middle branch.
  // KVL loop 1: V1 - I1*R1 - (I1-I2)*R3 = 0
  // KVL loop 2: V2 - I2*R2 - (I2-I1)*R3 = 0
  // → solve 2x2 linear system
  const solution = useMemo(() => {
    const a11 = R1 + R3, a12 = -R3, b1 = V1;
    const a21 = -R3, a22 = R2 + R3, b2 = V2;
    const det = a11 * a22 - a12 * a21;
    const I1 = (b1 * a22 - b2 * a12) / det;
    const I2 = (a11 * b2 - a21 * b1) / det;
    const I3 = I1 - I2;
    const VA = V1 - I1 * R1; // node A (junction of R1, R3, R2)
    const VB = V2 - I2 * R2; // node B
    return { I1, I2, I3, VA, VB };
  }, [V1, V2, R1, R2, R3]);

  const takeTrial = () => {
    const noise = () => (Math.random() - 0.5) * 0.02;
    setTrials((t) => [...t, {
      I1: solution.I1 * (1 + noise()), I2: solution.I2 * (1 + noise()), I3: solution.I3 * (1 + noise()),
      VA: solution.VA * (1 + noise()), VB: solution.VB * (1 + noise()),
    }]);
  };

  // KCL check at node A: I1 = I3 + I2
  const kclCheck = trials.length ? trials[trials.length - 1].I1 - (trials[trials.length - 1].I3 + trials[trials.length - 1].I2) : 0;

  return (
    <div className="space-y-4">
      <ResearchHeader title="Kirchhoff's Laws" subtitle="Verify KVL and KCL in a two-loop circuit. Solve for branch currents and node voltages."
        onExplain={() => explain(`Kirchhoff: ${trials.length} trials. I1=${solution.I1.toFixed(6)}A, I2=${solution.I2.toFixed(6)}A, I3=${solution.I3.toFixed(6)}A. KCL residual=${kclCheck.toExponential(3)}A.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Circuit Parameters">
          <NumField label="Source V₁" value={V1} onChange={setV1} min={1} max={24} step={0.5} unit="V" />
          <NumField label="Source V₂" value={V2} onChange={setV2} min={1} max={24} step={0.5} unit="V" />
          <NumField label="R₁" value={R1} onChange={setR1} min={10} max={500} step={10} unit="Ω" />
          <NumField label="R₂" value={R2} onChange={setR2} min={10} max={500} step={10} unit="Ω" />
          <NumField label="R₃ (shared)" value={R3} onChange={setR3} min={10} max={500} step={10} unit="Ω" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}>Measure</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
        </Card>
        <div className="space-y-3">
          <Card title="Solved Values (theory)">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[['I₁', solution.I1.toFixed(6) + ' A'], ['I₂', solution.I2.toFixed(6) + ' A'], ['I₃', solution.I3.toFixed(6) + ' A'], ['V_A', solution.VA.toFixed(4) + ' V'], ['V_B', solution.VB.toFixed(4) + ' V'], ['KCL residual', kclCheck.toExponential(3) + ' A']].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border/50 bg-card/30 px-2.5 py-1.5"><div className="text-[10px] uppercase text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>
              ))}
            </div>
          </Card>
          <Card title="Circuit Topology">
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Loop 1: V₁ → R₁ → R₃ → ground. KVL: V₁ = I₁R₁ + (I₁−I₂)R₃</div>
              <div>Loop 2: V₂ → R₂ → R₃ → ground. KVL: V₂ = I₂R₂ + (I₂−I₁)R₃</div>
              <div>KCL at node A: I₁ = I₂ + I₃ (I₃ = I₁ − I₂ through R₃)</div>
            </div>
          </Card>
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'I₁ (A)', 'I₂ (A)', 'I₃ (A)']} rows={trials.map((t, i) => [i + 1, t.I1.toFixed(6), t.I2.toFixed(6), t.I3.toFixed(6)])} /></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ V1, V2, R1, R2, R3, solution, trials }, null, 2), 'kirchhoff.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}