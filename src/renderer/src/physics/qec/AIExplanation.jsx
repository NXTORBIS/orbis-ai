import React, { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { base44 } from '../api/base44Client.js';
import Section from './Section';

// ONE optional button. It only explains already-computed results; it never
// performs or modifies the QEC calculation.
export default function AIExplanation({ code, model, fault, results, threshold }) {
  const [text, setText] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const hasResults = results || threshold;

  const explain = async () => {
    if (!hasResults) { setError('Run a simulation first.'); return; }
    setLoading(true); setError(null); setText(null);
    const summary = {
      code: code.name, tag: code.tag, n: code.n, k: code.k, d: code.d, t: code.t,
      noise: model.type, p: model.p, faulty: fault.faulty, pMeas: fault.faulty ? (fault.uniform ? model.p : fault.pMeas) : 0,
      monteCarlo: results ? { trials: results.trials, failures: results.failures, pL: results.pL, ci: results.ci, logicalCounts: results.logicalCounts } : null,
      threshold: threshold ? threshold.points.map((p) => ({ p: p.p, pL: p.pL })) : null,
    };
    const prompt = `You are a quantum computing educator. Explain in plain language (concise, ~150 words) the following Quantum Error Correction simulation result. Do NOT recompute anything; only interpret. Result JSON:\n${JSON.stringify(summary)}\nCover: what the code does, what the syndrome/decoder did, what p_L means, whether errors are suppressed vs physical p, and what fault tolerance means here.`;
    try {
      const res = await base44.integrations.Core.InvokeLLM({ prompt, response_json_schema: { type: 'object', properties: { explanation: { type: 'string' } } } });
      setText(res?.explanation || res);
    } catch (e) {
      const msg = e?.message || String(e);
      if (/402|credit|quota|payment|insufficient/i.test(msg)) {
        setError('AI explanation unavailable: the workspace is out of integration credits. The simulation itself is unaffected — this is a billing limitation, not a bug. Upgrade or wait for credits to reset.');
      } else {
        setError('AI explanation failed: ' + msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="AI Explanation" icon={Sparkles}>
      <button onClick={explain} disabled={loading} className="flex items-center gap-1.5 rounded bg-cyan-j px-3 py-1.5 text-xs text-white btn-press disabled:opacity-50">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {loading ? 'Explaining…' : 'Explain results'}
      </button>
      {!hasResults && <p className="mt-2 text-[11px] text-muted-foreground">Run a simulation first.</p>}
      {error && <p className="mt-2 text-[11px] text-amber-500">{error}</p>}
      {text && <p className="mt-2 text-[12px] leading-relaxed text-foreground">{text}</p>}
      <p className="mt-2 text-[10px] text-muted-foreground">Optional. The numerical engine works fully without this button. AI only interprets computed results.</p>
    </Section>
  );
}