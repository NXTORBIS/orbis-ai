// Numerical Differentiation — step-size trade-off: truncation vs round-off
import React, { useState, useMemo } from 'react';
import { ResearchHeader, Card, NumField, SciTable, AIPanel, useAIExplain } from '../research.jsx';
import SciPlot from '../SciPlot.jsx';

const FUNCS = {
  'e^x': { f: (x) => Math.exp(x), fp: (x) => Math.exp(x), fpp: (x) => Math.exp(x), x0: 1 },
  'sin(x)': { f: (x) => Math.sin(x), fp: (x) => Math.cos(x), fpp: (x) => -Math.sin(x), x0: Math.PI / 4 },
  'x³·ln(x)': { f: (x) => x ** 3 * Math.log(x), fp: (x) => 3 * x * x * Math.log(x) + x * x, fpp: (x) => 6 * x * Math.log(x) + 5 * x, x0: 2 },
};

export default function NumericalDifferentiationSim() {
  const [funcKey, setFuncKey] = useState('e^x');
  const { explain, explaining, output } = useAIExplain();
  const { f, fp, fpp, x0 } = FUNCS[funcKey];
  const exact1 = fp(x0);
  const exact2 = fpp(x0);

  const tradeoff = useMemo(() => {
    const pts = [];
    const eps = 2.22e-16; // machine epsilon
    for (let e = -1; e >= -16; e -= 0.25) {
      const h = Math.pow(10, e);
      const fwd = (f(x0 + h) - f(x0)) / h;
      const cen = (f(x0 + h) - f(x0 - h)) / (2 * h);
      const d2 = (f(x0 + h) - 2 * f(x0) + f(x0 - h)) / (h * h);
      // truncation: forward O(h), central O(h²), second O(h²)
      // round-off: ~eps*f(x)/h for forward, ~eps*f(x)/h for central
      pts.push({
        h, fwd_err: Math.abs(fwd - exact1), cen_err: Math.abs(cen - exact1),
        d2_err: Math.abs(d2 - exact2),
        fwd_trunc: h, cen_trunc: h * h, d2_trunc: h * h,
        fwd_round: eps * Math.abs(f(x0)) / h, cen_round: eps * Math.abs(f(x0)) / h,
      });
    }
    return pts;
  }, [funcKey, x0, exact1, exact2, f]);

  const best = useMemo(() => {
    let bf = { h: 0, err: Infinity }, bc = { h: 0, err: Infinity };
    tradeoff.forEach((p) => {
      if (p.fwd_err < bf.err) bf = { h: p.h, err: p.fwd_err };
      if (p.cen_err < bc.err) bc = { h: p.h, err: p.cen_err };
    });
    return { bf, bc };
  }, [tradeoff]);

  return (
    <div className="space-y-4">
      <ResearchHeader title="Numerical Differentiation — Truncation vs Round-off"
        subtitle="Forward O(h), central O(h²), second-derivative O(h²). Total error = truncation + round-off. The optimal h balances both."
        onExplain={() => explain(`Differentiating ${funcKey} at x=${x0}. Exact f'=${exact1.toExponential(6)}, f''=${exact2.toExponential(6)}. Best forward-difference h=${best.bf.h.toExponential(2)} (err ${best.bf.err.toExponential(3)}). Best central h=${best.bc.h.toExponential(2)} (err ${best.bc.err.toExponential(3)}). Central is more accurate because truncation is O(h²) not O(h).`)}
        explaining={explaining} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Settings">
          <label className="block text-sm"><span className="text-muted-foreground">Function</span>
            <select value={funcKey} onChange={(e) => setFuncKey(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
              {Object.keys(FUNCS).map((k) => <option key={k} className="bg-background">{k}</option>)}
            </select>
          </label>
          <div className="mt-3 text-xs text-muted-foreground">Evaluation point x₀ = {x0.toFixed(4)}</div>
        </Card>
        <div className="space-y-3">
          <SciPlot type="line" data={tradeoff} xKey="h" log="log"
            series={[{ key: 'fwd_err', label: 'Forward total', color: '#f97316' },
                    { key: 'cen_err', label: 'Central total', color: '#22d3ee' },
                    { key: 'fwd_trunc', label: 'Forward trunc O(h)', color: '#ef4444' },
                    { key: 'cen_trunc', label: 'Central trunc O(h²)', color: '#06b6d4' },
                    { key: 'cen_round', label: 'Round-off ~ε/h', color: '#a855f7' }]}
            xLabel="step h" yLabel="|error|" height={260} exportName="diff-tradeoff" />
          <SciTable headers={['Method', 'Best h', 'Min |error|', 'Order']} rows={[
            ['Forward', best.bf.h.toExponential(2), best.bf.err.toExponential(3), 'O(h)'],
            ['Central', best.bc.h.toExponential(2), best.bc.err.toExponential(3), 'O(h²)'],
            ['Exact f′(x₀)', exact1.toExponential(10), '—', '—'],
            ['Exact f″(x₀)', exact2.toExponential(10), '—', '—'],
          ]} />
          <p className="text-xs text-muted-foreground">Below the optimal h, round-off dominates and error <em>increases</em> as h shrinks. Central differences shift the optimum left (smaller h, smaller error) because truncation falls as h².</p>
        </div>
      </div>
      <AIPanel output={output} />
    </div>
  );
}