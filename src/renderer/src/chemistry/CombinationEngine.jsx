import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from './ui/router.jsx';
import { motion, AnimatePresence } from './ui/motion.jsx';
import {
  Beaker, Search, X, Sparkles, Atom, Layers, AlertTriangle, CheckCircle2,
  Loader2, FlaskConical, ChevronRight, Plus,
} from 'lucide-react';
import { ALL_ELEMENTS, getElementBySymbol, getElement } from './lib/elementsData.js';
import { predictBinary, nameForFormula, molarMass, balanceSynthesis } from './lib/chemistry.js';
import { renderFormula } from './lib/formulaRender.jsx';
import { getCategory } from './lib/chemistryCategories.js';
import { askAI } from './parts/AIPanel.jsx';
import PageTitle from './ui/PageTitle.jsx';

function CompoundCard({ compound, onOpen, onExplain }) {
  const { mass } = molarMass(compound.formula);
  const cat = 'ionic';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="glass glass-border rounded-2xl p-4"
    >
      <div className="mb-2 flex items-start justify-between">
        <div>
          <h3 className="font-mono-j text-xl text-cyan-j">{renderFormula(compound.formula)}</h3>
          <p className="text-sm font-medium">{compound.name}</p>
        </div>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] capitalize text-secondary-foreground">{compound.type}</span>
      </div>
      <div className="mb-3 space-y-0.5 text-[11px] text-muted-foreground">
        <p><span className="text-muted-foreground">Molar mass:</span> <span className="font-medium text-foreground">{mass.toFixed(2)} g/mol</span></p>
        {compound.note && <p className="text-cyan-j/80">{compound.note}</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => onExplain(compound)} className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/50 px-2.5 py-1 text-[11px] transition hover:border-cyan-j/50">
          <Sparkles className="h-3 w-3" /> Explain
        </button>
      </div>
    </motion.div>
  );
}

function ElementChip({ el, onRemove }) {
  const cat = getCategory(el.category);
  return (
    <div className="flex items-center gap-1.5 rounded-xl border bg-card/70 px-2 py-1.5" style={{ borderColor: cat.color + '55' }}>
      <span className="font-display text-sm font-bold" style={{ color: cat.color }}>{el.symbol}</span>
      <span className="hidden text-[10px] text-muted-foreground sm:inline">{el.name}</span>
      <button onClick={onRemove} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
    </div>
  );
}

export default function CombinationEngine() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(() => {
    const focus = params.get('focus');
    const f = focus ? getElementBySymbol(focus) : null;
    return f ? [f] : [];
  });
  const [search, setSearch] = useState('');
  const [explanation, setExplanation] = useState(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState('');

  const toggleElement = (el) => {
    setSelected((prev) => {
      if (prev.find((e) => e.atomic_number === el.atomic_number)) {
        return prev.filter((e) => e.atomic_number !== el.atomic_number);
      }
      if (prev.length >= 10) return prev;
      return [...prev, el];
    });
  };

  const clearAll = () => { setSelected([]); setExplanation(null); };

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    return ALL_ELEMENTS.filter((e) => e.name.toLowerCase().includes(q) || e.symbol.toLowerCase() === q || e.symbol.toLowerCase().startsWith(q) || String(e.atomic_number) === q).slice(0, 12);
  }, [search]);

  // Predict compounds — supports 2-element binary combos
  const compounds = useMemo(() => {
    if (selected.length < 2) return { list: [], impossible: [] };
    if (selected.length === 2) {
      const [a, b] = selected;
      const list = predictBinary(a.symbol, b.symbol);
      // Detect impossible: noble gas + anything, or no valency
      const noble = (e) => e.category === 'noble-gas';
      const noValency = (e) => ['He','Ne','Ar'].includes(e.symbol);
      let impossible = [];
      if (noble(a) || noble(b)) {
        impossible.push({ reason: `${noble(a) ? a.name : b.name} is a noble gas with a complete octet — under normal conditions it does not form stable compounds. (A few xenon/krypton compounds exist under extreme conditions.)` });
      } else if (list.length === 0) {
        impossible.push({ reason: 'No common stable binary compounds predicted for this combination based on standard valency rules.' });
      }
      return { list, impossible };
    }
    // 3+ elements: limit to curated multi-element common compounds via known reactions
    return { list: [], impossible: [{ reason: 'Multi-element (>2) prediction uses curated common reactions. Try classic combinations like C+H+O (→ organic compounds) or use the AI assistant below.' }] };
  }, [selected]);

  const explain = async (compound) => {
    setExplainLoading(true); setExplainError(''); setExplanation(null);
    try {
      const res = await askAI(
        `Explain the compound ${compound.formula} (${compound.name}). Describe its formation from elements, bond type, key properties, common uses, and safety notes. Keep it concise and scientifically accurate.`,
      );
      setExplanation({ name: compound.name, formula: compound.formula, text: typeof res === 'string' ? res : JSON.stringify(res) });
    } catch (e) {
      setExplainError(e?.message || 'Could not reach AI.');
    } finally {
      setExplainLoading(false);
    }
  };

  const explainCombo = async () => {
    if (selected.length < 2) return;
    setExplainLoading(true); setExplainError(''); setExplanation(null);
    try {
      const names = selected.map((e) => `${e.name} (${e.symbol})`).join(' and ');
      const res = await askAI(
        `A student has selected these elements to combine: ${names}. Predict and explain the most likely stable compound(s) they can form, the balanced equation, reaction conditions, bond type, and whether any combination is not possible. Be scientifically accurate and concise.`,
      );
      setExplanation({ name: 'Combination Analysis', formula: selected.map((e) => e.symbol).join(' + '), text: typeof res === 'string' ? res : JSON.stringify(res) });
    } catch (e) {
      setExplainError(e?.message || 'Could not reach AI.');
    } finally {
      setExplainLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageTitle title="ELEMENT COMBINATION ENGINE" subtitle="Select elements and predict valid compounds & reactions" />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        {/* Selection panel */}
        <div className="space-y-4">
          <div className="glass glass-border rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-j"><Beaker className="h-4 w-4" /> Reaction Workspace</h2>
              {selected.length > 0 && <button onClick={clearAll} className="text-[11px] text-muted-foreground hover:text-destructive">Clear all</button>}
            </div>

            <div className="mb-3 flex flex-wrap min-h-[3rem] gap-1.5 rounded-xl border border-dashed border-border/60 bg-card/30 p-2">
              {selected.length === 0 && <p className="self-center px-2 text-xs text-muted-foreground">Tap elements below to add them to the workspace…</p>}
              {selected.map((el) => <ElementChip key={el.atomic_number} el={el} onRemove={() => toggleElement(el)} />)}
              {selected.length >= 2 && selected.length <= 4 && (
                <span className="self-center px-1 font-mono-j text-sm text-muted-foreground">→ predict</span>
              )}
            </div>

            {/* Search */}
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search elements to add…" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <div className="scrollbar-thin max-h-[18rem] overflow-y-auto">
              {searchResults ? (
                <div className="flex flex-wrap gap-1.5">
                  {searchResults.map((el) => {
                    const cat = getCategory(el.category);
                    const active = selected.find((e) => e.atomic_number === el.atomic_number);
                    return (
                      <button key={el.atomic_number} onClick={() => toggleElement(el)} className={`flex h-12 w-12 flex-col items-center justify-center rounded-lg border transition ${active ? 'border-cyan-j bg-cyan-j/10' : 'border-border/60 bg-card/50 hover:scale-105'}`} style={{ borderColor: active ? undefined : cat.color + '44' }}>
                        <span className="font-display text-sm font-bold" style={{ color: cat.color }}>{el.symbol}</span>
                        <span className="text-[7px] text-muted-foreground">{el.atomic_number}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-9 gap-1 sm:grid-cols-12">
                  {ALL_ELEMENTS.map((el) => {
                    const cat = getCategory(el.category);
                    const active = selected.find((e) => e.atomic_number === el.atomic_number);
                    return (
                      <button key={el.atomic_number} onClick={() => toggleElement(el)} className={`flex aspect-square flex-col items-center justify-center rounded-md border transition ${active ? 'border-cyan-j bg-cyan-j/15' : 'border-border/50 bg-card/40 hover:scale-110'}`} style={{ borderColor: active ? undefined : cat.color + '40' }} title={el.name}>
                        <span className="font-display text-[10px] font-bold leading-none" style={{ color: cat.color }}>{el.symbol}</span>
                        <span className="text-[6px] leading-none text-muted-foreground">{el.atomic_number}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {selected.length >= 2 && (
            <button onClick={explainCombo} disabled={explainLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-j px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50">
              {explainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Analyze Combination with AI
            </button>
          )}
        </div>

        {/* Results panel */}
        <div className="space-y-4">
          {selected.length < 2 && (
            <div className="glass glass-border flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
              <Atom className="h-10 w-10 text-cyan-j/60" strokeWidth={1.2} />
              <p className="text-sm text-muted-foreground">Select at least two elements to predict possible compounds.</p>
            </div>
          )}

          {compounds.impossible?.length > 0 && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400"><AlertTriangle className="h-4 w-4" /> Feasibility Notes</h3>
              {compounds.impossible.map((imp, i) => <p key={i} className="text-xs text-amber-200/90">{imp.reason}</p>)}
            </div>
          )}

          {compounds.list?.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Layers className="h-4 w-4" /> Predicted Compounds ({compounds.list.length})</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {compounds.list.map((c) => <CompoundCard key={c.formula} compound={c} onExplain={explain} />)}
              </div>
            </div>
          )}

          {selected.length === 2 && compounds.list?.length > 0 && (
            <div className="glass glass-border rounded-2xl p-4">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-j"><FlaskConical className="h-4 w-4" /> Balanced Synthesis Equations</h3>
              <div className="space-y-1.5">
                {compounds.list.map((c) => {
                  const [a, b] = selected;
                  const bal = balanceSynthesis(a.symbol, b.symbol, c.formula);
                  return bal && (
                    <p key={c.formula} className="font-mono-j text-sm text-foreground/90">{bal.equation}</p>
                  );
                })}
              </div>
            </div>
          )}

          {(explanation || explainLoading || explainError) && (
            <div className="glass glass-border rounded-2xl p-4">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-j"><Sparkles className="h-4 w-4" /> {explanation?.name || 'AI Analysis'}</h3>
              {explainLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Analyzing…</div>}
              {explainError && <p className="text-xs text-destructive">{explainError}</p>}
              {explanation && (
                <>
                  {explanation.formula && <p className="mb-2 font-mono-j text-sm text-cyan-j">{explanation.formula}</p>}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{explanation.text}</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}