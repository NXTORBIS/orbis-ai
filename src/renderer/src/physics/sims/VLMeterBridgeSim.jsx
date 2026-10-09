import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { RotateCcw } from 'lucide-react';

// Meter Bridge — slide-wire Wheatstone bridge.
// Unique: 1m wire with sliding jockey, balance at l₁ where P/Q = l₁/(100−l₁).
export default function VLMeterBridgeSim() {
  const [P, setP] = useState(100);
  const [S, setS] = useState(150);
  const [l1, setL1] = useState(40);
  const [trials, setTrials] = useState([]);
  const { explain, explaining, output } = useAIExplain();

  // Balance: P/S = l1/l2 = l1/(100-l1) → S = P*(100-l1)/l1
  const STheory = useMemo(() => P * (100 - l1) / l1, [P, l1]);
  const l2 = 100 - l1;
  const balanced = Math.abs(S - STheory) / S < 0.01;

  const takeTrial = () => {
    const l1m = l1 * (1 + (Math.random() - 0.5) * 0.005);
    const Sm = P * (100 - l1m) / l1m;
    setTrials((t) => [...t, { l1: l1m, l2: 100 - l1m, S: Sm, balanced: Math.abs(Sm - S) / S < 0.01 }]);
  };

  return (
    <div className="space-y-4">
      <ResearchHeader title="Meter Bridge" subtitle="Slide-wire Wheatstone bridge: find unknown resistance S from the balance point on a 1m wire. S = P·(100−l₁)/l₁."
        onExplain={() => explain(`Meter bridge: P=${P}Ω, l₁=${l1}cm, l₂=${l2}cm. S=P·l₂/l₁=${STheory.toFixed(2)}Ω vs actual ${S}Ω. ${balanced ? 'Balanced' : 'Unbalanced'}.`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Known R (P)" value={P} onChange={setP} min={10} max={1000} step={10} unit="Ω" />
          <NumField label="Unknown R (S)" value={S} onChange={setS} min={10} max={1000} step={1} unit="Ω" />
          <NumField label="Jockey position l₁" value={l1} onChange={setL1} min={1} max={99} step={0.5} unit="cm" />
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}>Read null</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
          <div className={`mt-2 text-xs ${balanced ? 'text-green-400' : 'text-amber-400'}`}>{balanced ? '● Null at this position' : '○ Slide to find null'}</div>
        </Card>
        <div className="space-y-3">
          <Card title="Meter Bridge Wire">
            <div className="relative h-16 rounded-lg border border-border/60 bg-card/30">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full h-1 bg-gradient-to-r from-cyan-500 to-orange-500 rounded-full" />
              </div>
              <div className="absolute top-0 left-0 right-0 flex justify-between px-1 text-[10px] text-muted-foreground font-mono">
                <span>0 cm</span><span>50</span><span>100 cm</span>
              </div>
              <div className="absolute top-2 bottom-2 w-0.5 bg-yellow-400" style={{ left: `${l1}%` }}>
                <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-yellow-400 border border-yellow-600" />
              </div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground text-center">Jockey at l₁ = {l1} cm, l₂ = {l2} cm</div>
          </Card>
          <Card title="Balance Condition">
            <div className="text-xs space-y-1">
              <div>P/S = l₁/l₂ = {l1}/{l2} = {(l1 / l2).toFixed(4)}</div>
              <div>S = P·l₂/l₁ = <span className="font-mono text-cyan-j">{STheory.toFixed(2)} Ω</span></div>
              <div className={balanced ? 'text-green-400' : 'text-amber-400'}>{balanced ? '✓ Bridge balanced' : '✗ Adjust l₁ for null'}</div>
            </div>
          </Card>
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'l₁ (cm)', 'l₂ (cm)', 'S (Ω)', 'Null?']} rows={trials.map((t, i) => [i + 1, t.l1.toFixed(2), t.l2.toFixed(2), t.S.toFixed(2), t.balanced ? '✓' : '✗'])} /></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ P, S, l1, STheory, trials }, null, 2), 'meter-bridge.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}