import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ResearchHeader, Card, AIPanel, useAIExplain, SciTable, NumField, downloadFile } from '../research.jsx';
import { Button } from '../ui/button.jsx';
import { Plus, RotateCcw } from 'lucide-react';

// Conservation of Momentum — before/after collision verification.
// Unique: 1D collision canvas with two carts, momentum bar comparison.
export default function VLMomentumSim() {
  const [m1, setM1] = useState(1.0);
  const [m2, setM2] = useState(2.0);
  const [v1, setV1] = useState(5);
  const [v2, setV2] = useState(0);
  const [elastic, setElastic] = useState(true);
  const [trials, setTrials] = useState([]);
  const canvasRef = useRef(null);
  const tRef = useRef(0);
  const { explain, explaining, output } = useAIExplain();

  // Collision physics
  const result = useMemo(() => {
    if (elastic) {
      const u1 = ((m1 - m2) * v1 + 2 * m2 * v2) / (m1 + m2);
      const u2 = ((m2 - m1) * v2 + 2 * m1 * v1) / (m1 + m2);
      return { v1f: u1, v2f: u2, e: 1 };
    } else {
      const vf = (m1 * v1 + m2 * v2) / (m1 + m2);
      return { v1f: vf, v2f: vf, e: 0 };
    }
  }, [m1, m2, v1, v2, elastic]);

  const pBefore = m1 * v1 + m2 * v2;
  const pAfter = m1 * result.v1f + m2 * result.v2f;
  const keBefore = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;
  const keAfter = 0.5 * m1 * result.v1f * result.v1f + 0.5 * m2 * result.v2f * result.v2f;

  // Collision animation
  useEffect(() => {
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current; if (!cv) return;
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      ctx.fillStyle = 'hsl(222 47% 6%)'; ctx.fillRect(0, 0, w, h);
      const oy = h / 2;
      // track
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, oy + 20); ctx.lineTo(w, oy + 20); ctx.stroke();
      const scale = 8;
      const phase = tRef.current % 4;
      let x1, x2, c1, c2;
      if (phase < 1.5) {
        x1 = 40 + v1 * scale * phase; x2 = w - 120 + v2 * scale * phase;
        c1 = '#22d3ee'; c2 = '#f97316';
      } else {
        const t = phase - 1.5;
        x1 = 40 + v1 * scale * 1.5 + result.v1f * scale * t;
        x2 = w - 120 + v2 * scale * 1.5 + result.v2f * scale * t;
        c1 = '#06b6d4'; c2 = '#fb923c';
      }
      // cart 1
      const r1 = 12 + m1 * 4;
      ctx.fillStyle = c1; ctx.fillRect(x1, oy - r1, r1 * 2, r1 * 2);
      ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText(`m₁=${m1}`, x1 + r1, oy - r1 - 4);
      // cart 2
      const r2 = 12 + m2 * 4;
      ctx.fillStyle = c2; ctx.fillRect(x2, oy - r2, r2 * 2, r2 * 2);
      ctx.fillStyle = '#fff'; ctx.fillText(`m₂=${m2}`, x2 + r2, oy - r2 - 4);
      tRef.current += 0.016;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [m1, m2, v1, v2, result]);

  const takeTrial = () => {
    const noise = () => (Math.random() - 0.5) * 0.02;
    const v1m = result.v1f * (1 + noise()), v2m = result.v2f * (1 + noise());
    const pB = m1 * v1 + m2 * v2, pA = m1 * v1m + m2 * v2m;
    setTrials((t) => [...t, { type: elastic ? 'elastic' : 'inelastic', pBefore: pB, pAfter: pA, pctErr: Math.abs(pA - pB) / Math.abs(pB) * 100 }]);
  };

  return (
    <div className="space-y-4">
      <ResearchHeader title="Conservation of Momentum" subtitle="Verify Σp before = Σp after in 1D collisions. Compare elastic and perfectly inelastic collisions."
        onExplain={() => explain(`Momentum conservation: ${trials.length} trials. p_before=${pBefore.toFixed(4)}, p_after=${pAfter.toFixed(4)} kg·m/s. KE ${elastic ? 'conserved' : 'not conserved'} (elastic e=1).`)} explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        <Card title="Apparatus">
          <NumField label="Mass m₁" value={m1} onChange={setM1} min={0.5} max={5} step={0.1} unit="kg" />
          <NumField label="Mass m₂" value={m2} onChange={setM2} min={0.5} max={5} step={0.1} unit="kg" />
          <NumField label="Velocity v₁" value={v1} onChange={setV1} min={-10} max={10} step={0.5} unit="m/s" />
          <NumField label="Velocity v₂" value={v2} onChange={setV2} min={-10} max={10} step={0.5} unit="m/s" />
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={elastic} onChange={(e) => setElastic(e.target.checked)} className="accent-cyan-500" /><span className="text-muted-foreground">Elastic collision</span></label>
          <div className="mt-3 flex gap-2"><Button size="sm" onClick={takeTrial}><Plus className="size-3.5" />Record</Button><Button size="sm" variant="outline" onClick={() => setTrials([])}><RotateCcw className="size-3.5" /></Button></div>
        </Card>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 220 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Card title="Momentum"><div className="space-y-1 text-xs"><div>p before = <span className="font-mono text-cyan-j">{pBefore.toFixed(4)}</span> kg·m/s</div><div>p after = <span className="font-mono text-cyan-j">{pAfter.toFixed(4)}</span> kg·m/s</div><div>Δp = <span className="font-mono">{(pAfter - pBefore).toExponential(2)}</span></div></div></Card>
            <Card title="Kinetic Energy"><div className="space-y-1 text-xs"><div>KE before = <span className="font-mono text-orange-400">{keBefore.toFixed(4)}</span> J</div><div>KE after = <span className="font-mono text-orange-400">{keAfter.toFixed(4)}</span> J</div><div>ΔKE = <span className="font-mono">{(keAfter - keBefore).toFixed(4)}</span> J</div></div></Card>
          </div>
        </div>
        <div className="space-y-3">
          {trials.length > 0 && <Card title={`Trials (${trials.length})`}><SciTable headers={['#', 'Type', 'p before', 'p after', '% err']} rows={trials.map((t, i) => [i + 1, t.type, t.pBefore.toFixed(3), t.pAfter.toFixed(3), t.pctErr.toFixed(2)])} /></Card>}
          <Button size="sm" variant="outline" onClick={() => downloadFile(JSON.stringify({ m1, m2, v1, v2, elastic, trials }, null, 2), 'momentum.json', 'application/json')}>Export JSON</Button>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}