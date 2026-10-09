import { useState } from 'react';
import { base44 } from '../api/base44Client.js';
import { Sparkles, Loader2, Send } from 'lucide-react';

const _aiCache = new Map();
const _aiLast = { t: 0 };
const AI_MIN_INTERVAL = 1500;
function _friendlyError(e) {
  const m = (e?.message || String(e)).toLowerCase();
  if (m.includes('rate') || m.includes('429') || m.includes('quota') || m.includes('limit')) {
    return 'The AI assistant is rate-limited right now. Please wait a few seconds and try again.';
  }
  return e?.message || 'Could not reach the AI assistant.';
}

// Reusable AI panel. Calls InvokeLLM with a given prompt and returns markdown-ish text.
// `systemContext` is prepended to every prompt to keep answers chemistry-focused.
export default function AIPanel({ systemContext = '', initialPrompt = '', placeholder = 'Ask the AI chemistry assistant…', compact = false }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run(p) {
    const full = `${systemContext ? systemContext + '\n\n' : ''}${p || prompt}`;
    if (!full.trim()) return;
    const key = full;
    if (_aiCache.has(key)) { setAnswer(_aiCache.get(key)); return; }
    const now = Date.now();
    if (now - _aiLast.t < AI_MIN_INTERVAL) {
      setError('Please wait a moment before asking again.');
      return;
    }
    _aiLast.t = now;
    setLoading(true); setError(''); setAnswer('');
    try {
      const res = await base44.integrations.Core.InvokeLLM({ prompt: full, add_context_from_internet: false });
      const text = typeof res === 'string' ? res : JSON.stringify(res);
      _aiCache.set(key, text);
      setAnswer(text);
    } catch (e) {
      setError(_friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-3 py-2">
          <Sparkles className="h-4 w-4 text-cyan-j shrink-0" strokeWidth={1.5} />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          onClick={() => run()}
          disabled={loading || !prompt.trim()}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-j text-background disabled:opacity-40 transition hover:opacity-90"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {answer && (
        <div className={`scrollbar-thin overflow-y-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-card/40 p-4 text-sm leading-relaxed text-foreground/90 ${compact ? 'max-h-48' : 'max-h-96'}`}>
          {answer}
        </div>
      )}
    </div>
  );
}

// Quick action button that feeds a preset prompt into a callback
export function AIAction({ label, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-border/60 bg-card/50 px-3 py-1.5 text-[11px] text-foreground/80 transition hover:border-cyan-j/50 hover:text-foreground disabled:opacity-40"
    >
      {label}
    </button>
  );
}

// One-shot AI call helper for preset prompts (used by element/compound pages)
export async function askAI(prompt, { jsonSchema = null, model = null } = {}) {
  const key = `${prompt}|${jsonSchema ? JSON.stringify(jsonSchema) : ''}|${model || ''}`;
  if (!jsonSchema && _aiCache.has(key)) return _aiCache.get(key);
  const now = Date.now();
  if (now - _aiLast.t < AI_MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, AI_MIN_INTERVAL - (now - _aiLast.t)));
  }
  _aiLast.t = Date.now();
  try {
    const res = await base44.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: false,
      ...(jsonSchema ? { response_json_schema: jsonSchema } : {}),
      ...(model ? { model } : {}),
    });
    if (!jsonSchema && typeof res === 'string') _aiCache.set(key, res);
    return res;
  } catch (e) {
    throw new Error(_friendlyError(e));
  }
}