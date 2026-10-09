import React, { useState } from 'react';
import { Download, Copy, Check } from 'lucide-react';
import Section from './Section';

export default function ExportPanel({ code, model, fault, seed, results, threshold }) {
  const [copied, setCopied] = useState(false);

  const config = {
    code: code.id, tag: code.tag, n: code.n, k: code.k, d: code.d,
    noise: model.type, p: model.p, pX: model.pX, pY: model.pY, pZ: model.pZ,
    faulty: fault.faulty, pMeas: fault.faulty ? (fault.uniform ? model.p : fault.pMeas) : 0,
    seed, decoder: 'lookup',
    timestamp: new Date().toISOString(),
  };

  const full = {
    configuration: config,
    monteCarlo: results || null,
    threshold: threshold || null,
  };

  const download = (filename, content, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const trialsCsv = results ? 'trial_type,failures,corrected,trials,p_L,ci_lower,ci_upper\n' +
    `summary,${results.failures},${results.corrected},${results.trials},${results.pL},${results.ci.lower},${results.ci.upper}\n` : '';

  const thresholdCsv = threshold ? 'p,p_L,failures,trials\n' + threshold.points.map((p) => `${p.p},${p.pL},${p.failures},${p.trials}`).join('\n') : '';

  return (
    <Section title="Export & Reproducibility" icon={Download}>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => download('qec-config.json', JSON.stringify(full, null, 2), 'application/json')} className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs">JSON</button>
        <button onClick={() => download('qec-threshold.csv', thresholdCsv || trialsCsv, 'text/csv')} className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs">CSV</button>
        <button onClick={copy} className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} Copy config
        </button>
      </div>
      <pre className="mt-3 max-h-40 overflow-auto scrollbar-thin rounded border border-border/60 p-2 font-mono text-[10px] text-muted-foreground">{JSON.stringify(config, null, 2)}</pre>
    </Section>
  );
}