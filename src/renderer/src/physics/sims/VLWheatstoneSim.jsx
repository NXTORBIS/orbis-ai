import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { RotateCcw } from 'lucide-react';

// Wheatstone Bridge — null measurement to find unknown resistance.
// Unique: bridge circuit, balance condition P/Q = R/S, galvanometer null.
export default function VLWheatstoneSim() {
  const [P, setP] = useState(100);
  const [Q, setQ] = useState(100);
  const [R, setR] = useState(100);
  const [S, setS] = useState(150); // unknown
  const [trials, setTrials] = useState([]);
  const { explain, explaining, output } = useAIExplain();

  // Bridge balance: P/Q = R/S → S = R*Q/P
  const STheory = useMemo(() => R * Q / P, [R, Q, P]);
  const balanced = Math.abs(S - STheory) / S < 0.01;

  // Galvanometer current (simplified)
  const galvanCurrent = useMemo(() => {
    const V = 6;
    // Thévenin equivalent
    const Vth = V * (R / (P + R) - S / (Q + S));
    const Rth = (P * R) / (P + R) + (Q * S) / (Q + S);
    return Vth / (Rth + 50); // 50Ω galvanometer
  }, [P, Q, R, S]);

  const takeTrial = () => {
    const Smeasured = S * (1 + (Math.random() - 0.5) * 0.01);
    const g = galvanCurrent * (1 + (Math.random() - 0.5) * 0.05);
    setTrials((t) => [...t, { P, Q, R, S: Smeasured, galv: g, balanced: Math.abs(g) < 1e-5 }]);
  };

  return (
    <div className="space-y-4">
      <ResearchHeader title="Wheatstone Bridge" subtitle="Null measurement: find unknown resistance S by balancing the bridge. Balance condition: P/Q = R/S."
        onExplain={() => explain(`Wheatstone bridge: P=${P}Ω, Q=${Q}Ω, R=${R}Ω. S(theory)=RQ/P=${STheory.toFixed(2)}Ω. Galvanometer=${galvanCurrent.toExponential(3)}A. ${balanced ? 'BALANCED' : 'Unbalanced'}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Bridge Arms">
          <NumField label="P (known)" value={P} onChange={setP} min={10} max={1000} step={10} unit="Ω" />
          <NumField label="Q (known)" value={Q} onChange={setQ} min={10} max={1000} step={10} unit="Ω" />
          <NumField label="R (known)" value={R} onChange={setR} min={10} max={1000} step={10} unit="Ω" />
          <NumField label="S (unknown)" value={S} onChange={setS} min={10} max={1000} step={1} unit="Ω" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}>Read galv.</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className={`mt-2 text-xs ${balanced ? 'text-green-400' : 'text-amber-400'}`}>{balanced ? '● BALANCED (null)' : '○ Unbalanced'}</div>
        </Card>
        <div className="space-y-3">
          <Card title="Bridge Diagram">
            <div className="font-mono text-xs leading-relaxed text-muted-foreground">
              <pre className="whitespace-pre">{`         P
    ┌───/\\/\\/───┐
    │           │
BATT    G        S (unknown)
    │           │
    └───/\\/\\/───┘
         Q           R`}</pre>
            </div>
          </Card>
          <Card title="Galvanometer">
            <div className="text-center">
              <div className={`font-mono text-2xl ${Math.abs(galvanCurrent) < 1e-5 ? 'text-green-400' : 'text-amber-400'}`}>{galvanCurrent.toExponential(3)} A</div>
              <div className="text-xs text-muted-foreground mt-1">{Math.abs(galvanCurrent) < 1e-5 ? 'Null — bridge balanced' : 'Current flows — adjust S'}</div>
            </div>
          </Card>
        </div>
        <div className="space-y-3">
          <Card title="Balance Condition"><div className="text-xs space-y-1"><div>S = RQ/P = <span className="font-mono text-cyan-j">{STheory.toFixed(2)} Ω</span></div><div>Ratio P:Q = {P}:{Q} = {(P / Q).toFixed(3)}</div><div>Ratio R:S = {R}:{S} = {(R / S).toFixed(3)}</div></div></Card>
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'S (Ω)', 'Galv (A)', 'Null?']} rows={trials.map((t, i) => [i + 1, t.S.toFixed(2), t.galv.toExponential(3), t.balanced ? '✓' : '✗'])} /></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ P, Q, R, S, STheory, trials }, null, 2), 'wheatstone.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}