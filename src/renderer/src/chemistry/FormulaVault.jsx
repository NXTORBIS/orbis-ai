import { useEffect, useState } from 'react';
import { motion } from './ui/motion.jsx';
import { base44 } from './api/base44Client.js';
import { Sigma, Search, Loader2, Send, Trash2, Sparkles, BookOpen } from 'lucide-react';
import ConceptCard from './parts/ConceptCard.jsx';
import ReactMarkdown from 'react-markdown';

const SUBJECTS = [
  { id: 'Mathematics', icon: '𝝨', color: 'text-cyan-j', hint: 'Algebra · Calculus · Geometry · Stats' },
  { id: 'Physics', icon: '⚛', color: 'text-violet-400', hint: 'Mechanics · EM · Quantum · Thermo' },
  { id: 'Chemistry', icon: '⚗', color: 'text-emerald-400', hint: 'Atomic · Bonding · Organic · Reactions' },
  { id: 'Biology', icon: '🧬', color: 'text-rose-400', hint: 'Cell · Genetics · Physiology · Ecology' },
  { id: 'Computer Science', icon: '💻', color: 'text-amber-400', hint: 'Algorithms · DS · Complexity · Discrete' },
];

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subject: { type: 'string' },
    level: { type: 'string' },
    summary: { type: 'string' },
    formulas: { type: 'array', items: { type: 'string' } },
    derivation: { type: 'string' },
    example: { type: 'string' },
    related: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary'],
};

export default function FormulaVault() {
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState([]);
  const [savedIds, setSavedIds] = useState(new Set());
  const [tutorQ, setTutorQ] = useState('');
  const [tutorA, setTutorA] = useState('');
  const [tutorLoading, setTutorLoading] = useState(false);

  useEffect(() => { loadSaved(); }, []);

  const loadSaved = async () => {
    try {
      const items = await base44.entities.FormulaEntry.list('-created_date', 50);
      setSaved(items);
      setSavedIds(new Set(items.map((s) => s.title.toLowerCase())));
    } catch {}
  };

  const search = async (q) => {
    const term = (q ?? query).trim();
    if (!term || loading) return;
    setQuery(term);
    setLoading(true); setResult(null); setTutorA('');
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are Formula Vault, a precise academic reference engine. Produce a structured concept card for the topic: "${term}".${subject ? ` Subject area: ${subject}.` : ''}\n\nReturn accurate, textbook-quality content. Include the most important formulas (use clean plain-text / LaTeX-style notation inside backticks), a concise derivation or proof, one fully worked example, and 4-6 closely related concepts. Keep explanations clear and correct. Match the difficulty to a sensible default unless the query specifies a level.`,
        add_context_from_internet: true,
        response_json_schema: SCHEMA,
        model: 'gemini_3_flash',
      });
      const card = res?.title ? res : { ...res, title: term };
      setResult(card);
    } catch {
      setResult({ title: term, summary: 'Could not reach the knowledge engine. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!result || savedIds.has((result.title || '').toLowerCase())) return;
    try {
      await base44.entities.FormulaEntry.create({
        title: result.title,
        subject: result.subject || subject || '',
        level: result.level || '',
        summary: result.summary || '',
        formulas: result.formulas || [],
        derivation: result.derivation || '',
        example: result.example || '',
        related: result.related || [],
      });
      await loadSaved();
    } catch {}
  };

  const removeSaved = async (id) => {
    try { await base44.entities.FormulaEntry.delete(id); setSaved((s) => s.filter((x) => x.id !== id)); } catch {}
  };

  const openSaved = (s) => { setResult(s); setTutorA(''); };

  const askTutor = async () => {
    const q = tutorQ.trim();
    if (!q || !result || tutorLoading) return;
    setTutorLoading(true); setTutorA('');
    try {
      const ctx = `Concept: ${result.title}\nFormulas: ${(result.formulas || []).join(', ')}\nSummary: ${result.summary || ''}`;
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are the Formula Vault AI tutor. Explain clearly and step-by-step, adapting to the student's level.\n\nContext:\n${ctx}\n\nStudent question: ${q}`,
        model: 'gemini_3_flash',
      });
      setTutorA(typeof res === 'string' ? res : res?.output || 'No answer.');
    } catch {
      setTutorA('Could not reach the tutor. Try again.');
    } finally {
      setTutorLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-6">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-j/10 text-cyan-j">
          <Sigma className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Formula Vault</h1>
          <p className="text-xs text-muted-foreground">Your living academic knowledge engine — search, understand, and master any concept.</p>
        </div>
      </div>

      {/* Search */}
      <form
        onSubmit={(e) => { e.preventDefault(); search(); }}
        className="mt-5 flex items-center gap-2 rounded-2xl border border-border/70 bg-card/60 p-2 backdrop-blur"
      >
        <Search className="ml-2 h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any formula, concept, or theorem — e.g. 'Newton's second law', 'quadratic formula', 'Gibbs free energy'…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button type="submit" disabled={loading || !query.trim()} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground transition hover:opacity-90 disabled:opacity-40">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Lookup
        </button>
      </form>

      {/* Subjects */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {SUBJECTS.map((s) => (
          <button
            key={s.id}
            onClick={() => { setSubject(subject === s.id ? '' : s.id); setQuery(''); }}
            className={`rounded-xl border p-3 text-left transition ${subject === s.id ? 'border-cyan-j bg-cyan-j/5' : 'border-border/70 bg-card/40 hover:border-cyan-j/40'}`}
          >
            <div className={`text-lg ${s.color}`}>{s.icon}</div>
            <div className="mt-1 font-display text-xs font-bold tracking-wide">{s.id}</div>
            <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{s.hint}</div>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* Result + tutor */}
        <div className="min-w-0">
          {loading && (
            <div className="grid place-items-center rounded-2xl border border-border/70 bg-card/40 py-20">
              <Loader2 className="h-6 w-6 animate-spin text-cyan-j" />
              <p className="mt-3 text-sm text-muted-foreground">Consulting the knowledge engine…</p>
            </div>
          )}
          {!loading && result && (
            <>
              <ConceptCard
                data={result}
                saved={savedIds.has((result.title || '').toLowerCase())}
                onSave={save}
              />
              {/* AI Tutor */}
              <div className="mt-4 rounded-2xl border border-border/70 bg-card/40 p-4">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-muted-foreground/70">
                  <BookOpen className="h-3.5 w-3.5" /> AI TUTOR — ASK ABOUT THIS CONCEPT
                </div>
                <form onSubmit={(e) => { e.preventDefault(); askTutor(); }} className="flex items-center gap-2">
                  <input
                    value={tutorQ}
                    onChange={(e) => setTutorQ(e.target.value)}
                    placeholder="Ask a follow-up, request a deeper proof, or a practice problem…"
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-j/50"
                  />
                  <button type="submit" disabled={tutorLoading || !tutorQ.trim()} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40">
                    {tutorLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </form>
                {tutorA && (
                  <div className="mt-3 rounded-xl border border-border/60 bg-background/40 p-3 text-sm">
                    <ReactMarkdown className="prose prose-sm max-w-none leading-relaxed dark:prose-invert">{tutorA}</ReactMarkdown>
                  </div>
                )}
              </div>
            </>
          )}
          {!loading && !result && (
            <div className="grid place-items-center rounded-2xl border border-dashed border-border/70 bg-card/20 py-20 text-center">
              <div className="text-4xl">📚</div>
              <p className="mt-3 text-sm text-muted-foreground">Search for any formula or concept to begin.</p>
            </div>
          )}
        </div>

        {/* Saved */}
        <div className="rounded-2xl border border-border/70 bg-card/40 p-4">
          <div className="mb-3 text-[10px] tracking-[0.2em] text-muted-foreground/70">SAVED CARDS</div>
          {saved.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground/70">No saved concepts yet.</p>
          ) : (
            <div className="space-y-2">
              {saved.map((s) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="group flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5"
                >
                  <button onClick={() => openSaved(s)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium">{s.title}</div>
                    {s.subject && <div className="text-[10px] tracking-wide text-muted-foreground">{s.subject}</div>}
                  </button>
                  <button onClick={() => removeSaved(s.id)} className="text-muted-foreground/40 opacity-0 transition hover:text-destructive group-hover:opacity-100" aria-label="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}