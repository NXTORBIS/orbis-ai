// Shared research-layer UI: AI explanation (post-calculation only), tables,
// cards, numeric fields, and research-style export helpers.
import React, { useState } from 'react';
import { Button } from './ui/button.jsx';
import { Sparkles, AlertTriangle, Loader2 } from 'lucide-react';
import { base44 } from './api/base44Client.js';

// Shared UI for the research layer.

// Honest "Not Implemented" placeholder — never fakes a feature.
export function NotImplemented({ title = 'Not Implemented', note }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
      <AlertTriangle className="mx-auto size-6 text-amber-500" />
      <div className="mt-2 font-display text-sm font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note || 'This method is not yet implemented. No simulated results are shown.'}</div>
    </div>
  );
}

// Research header with title + optional AI explanation button.
export function ResearchHeader({ title, subtitle, onExplain, explaining, aiLabel = 'AI Explanation' }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-bold tracking-wide">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {onExplain && (
        <Button size="sm" variant="outline" onClick={onExplain} disabled={explaining}>
          {explaining ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {explaining ? 'Explaining…' : aiLabel}
        </Button>
      )}
    </div>
  );
}

// AI Explanation button — interprets ALREADY-COMPUTED results only. It never
// performs physics. Pass a plain-language summary of the computed numbers.
export function useAIExplain() {
  const [explaining, setExplaining] = useState(false);
  const [output, setOutput] = useState(null);
  const explain = async (summary) => {
    setExplaining(true); setOutput(null);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a physics tutor. Interpret the following ALREADY-COMPUTED simulation results for a student. Do NOT recompute or invent numbers; explain the physics and what the values mean. Keep it concise (max ~150 words).\n\n${summary}`,
      });
      setOutput(typeof res === 'string' ? res : JSON.stringify(res));
    } catch (e) {
      setOutput(`AI explanation unavailable: ${e?.message || 'integration credits may be exhausted'}. The computed results above remain valid.`);
    } finally { setExplaining(false); }
  };
  return { explain, explaining, output };
}

export function AIPanel({ output }) {
  if (!output) return null;
  return (
    <div className="mt-3 rounded-xl border border-cyan-j/30 bg-cyan-j/5 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-j">AI Interpretation (post-calculation)</div>
      <div className="text-xs text-muted-foreground whitespace-pre-wrap">{output}</div>
    </div>
  );
}

// Compact numeric input with label and unit.
export function NumField({ label, value, onChange, min, max, step = 1, unit }) {
  return (
    <label className="block text-sm">
      <div className="flex items-center justify-between"><span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-xs">{typeof value === 'number' ? (Number.isInteger(step) ? value : value.toFixed(Math.max(0, -Math.log10(step)))) : value}{unit ? ` ${unit}` : ''}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full accent-cyan-500" />
    </label>
  );
}

export function SciTable({ headers, rows, mono = true }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/40">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-muted-foreground">{headers.map((h) => <th key={h} className="px-2 py-1 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border/40">{r.map((c, j) => <td key={j} className={`px-2 py-1 ${mono ? 'font-mono' : ''}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Card({ title, children, right }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3">
      {(title || right) && <div className="mb-2 flex items-center justify-between"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>{right}</div>}
      {children}
    </div>
  );
}

// Download helper for research-style export (section 26).
export function downloadFile(content, filename, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
export function downloadCanvas(canvasRef, filename) {
  const cv = canvasRef.current; if (!cv) return;
  const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = filename; a.click();
}