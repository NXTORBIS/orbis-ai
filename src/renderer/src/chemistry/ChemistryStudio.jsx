import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from './ui/router.jsx';
import { motion } from './ui/motion.jsx';
import {
  Search, ZoomIn, ZoomOut, RotateCcw, Filter,
  Atom, Sparkles, Beaker, Zap, Star,
  Lightbulb, FileText, Target, ChevronRight,
  FlaskConical, Leaf, Globe, Calculator, Microscope,
} from 'lucide-react';
import { ALL_ELEMENTS, getElement } from './lib/elementsData.js';
import { searchElements, dailyFact, dailyFormula, dailyReaction, dailyQuiz, featuredElement, molarMass } from './lib/chemistry.js';
import { renderFormula } from './lib/formulaRender.jsx';
import { getCategory, CATEGORIES } from './lib/chemistryCategories.js';
import PeriodicTableGrid from './parts/PeriodicTableGrid.jsx';
import AIPanel from './parts/AIPanel.jsx';
import PageTitle from './ui/PageTitle.jsx';
import { MODULES, GROUPS, searchModules } from './lib/chemistryStudio/registry.js';
import { useSettings } from './ui/useSettings.js';
import { staggerContainer, staggerItem, breathing, useReducedMotion, loopTransition } from './lib/motion.js';

function Card({ children, className = '', ...rest }) {
  return (
    <motion.div
      variants={staggerItem}
      initial="initial"
      animate="in"
      whileHover={{ y: -3 }}
      className={`glass glass-border rounded-2xl p-4 ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

function SectionHeader({ icon: Icon, title, action }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-4 w-4 text-cyan-j" strokeWidth={1.5} /> {title}
      </div>
      {action}
    </div>
  );
}

export default function ChemistryStudio() {
  const nav = useNavigate();
  const { settings, update } = useSettings();
  const [query, setQuery] = useState('');
  const [moduleQuery, setModuleQuery] = useState('');
  const [category, setCategory] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [phaseFilter, setPhaseFilter] = useState(null);
  const [blockFilter, setBlockFilter] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [quizAnswer, setQuizAnswer] = useState(null);
  const reduce = useReducedMotion();
  const [recent] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chem_recent') || '[]'); } catch { return []; }
  });

  const fact = useMemo(() => dailyFact(), []);
  const formula = useMemo(() => dailyFormula(), []);
  const reaction = useMemo(() => dailyReaction(), []);
  const quiz = useMemo(() => dailyQuiz(), []);
  const featured = useMemo(() => featuredElement(), []);
  const featuredCat = getCategory(featured.category);
  const favorites = settings.favoriteElements || [];

  const matchIds = useMemo(() => {
    if (!query.trim() && !category && !phaseFilter && !blockFilter && !highlight) return null;
    const q = query.trim().toLowerCase();
    const set = new Set();
    for (const el of ALL_ELEMENTS) {
      const matchesQuery = !q || el.name.toLowerCase().includes(q) || el.symbol.toLowerCase() === q || el.symbol.toLowerCase().startsWith(q) || String(el.atomic_number) === q;
      const matchesCategory = !category || el.category === category;
      const matchesPhase = !phaseFilter || el.phase === phaseFilter;
      const matchesBlock = !blockFilter || el.block === blockFilter;
      let matchesHighlight = true;
      if (highlight === 'radioactive') matchesHighlight = el.radioactive;
      else if (highlight === 'synthetic') matchesHighlight = el.synthetic;
      else if (highlight === 'metals') matchesHighlight = ['alkali-metal','alkaline-earth-metal','transition-metal','post-transition-metal','lanthanide','actinide'].includes(el.category);
      else if (highlight === 'nonmetals') matchesHighlight = ['reactive-nonmetal','noble-gas','halogen','metalloid'].includes(el.category);
      if (matchesQuery && matchesCategory && matchesPhase && matchesBlock && matchesHighlight) set.add(el.atomic_number);
    }
    return set;
  }, [query, category, phaseFilter, blockFilter, highlight]);

  const openElement = (el) => {
    try {
      const r = JSON.parse(localStorage.getItem('chem_recent') || '[]');
      const next = [el.atomic_number, ...r.filter((n) => n !== el.atomic_number)].slice(0, 8);
      localStorage.setItem('chem_recent', JSON.stringify(next));
    } catch {}
    nav(`/chemistry/element/${el.atomic_number}`);
  };

  const formulaMass = molarMass(formula.formula).mass;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageTitle title="CHEMISTRY STUDIO" subtitle="Interactive periodic table · compound engine · AI chemistry lab" />

      {/* Module search */}
      <div className="mb-4">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <input
            value={moduleQuery}
            onChange={(e) => setModuleQuery(e.target.value)}
            placeholder="Search modules, tools, concepts, equations… (e.g. kinetics, Nernst, phase, polymer)"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {moduleQuery && <button onClick={() => setModuleQuery('')} className="text-xs text-muted-foreground hover:text-foreground">clear</button>}
        </div>
        {moduleQuery && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {searchModules(moduleQuery).map((m) => (
              <button key={m.id} onClick={() => nav(m.route)} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-left text-sm hover:border-cyan-j/50 hover:bg-card/80">
                <m.icon className="h-4 w-4 shrink-0 text-cyan-j" strokeWidth={1.5} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.name} {m.soon && <span className="text-[9px] text-amber-500">soon</span>}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{m.desc}</span>
                </span>
              </button>
            ))}
            {searchModules(moduleQuery).length === 0 && <p className="text-xs text-muted-foreground">No module matches. Try a different term.</p>}
          </div>
        )}
      </div>

      {/* Grouped module navigation hub */}
      <div className="mb-6 space-y-3">
        {GROUPS.map((group) => {
          const mods = MODULES.filter((m) => m.group === group);
          if (!mods.length) return null;
          return (
            <div key={group}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</div>
              <motion.div variants={staggerContainer(0.03)} initial="initial" animate="in" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {mods.map((m) => (
                  <motion.button key={m.id} variants={staggerItem} whileHover={{ y: -2, scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => nav(m.route)} className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-sm transition-colors hover:border-cyan-j/50 hover:bg-card/80">
                    <m.icon className="h-4 w-4 shrink-0 text-cyan-j" strokeWidth={1.5} />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate">{m.name} {m.soon && <span className="text-[9px] text-amber-500">•</span>}</span>
                      <span className="text-[9px] text-muted-foreground">{m.v}{m.soon ? ' · soon' : ''}</span>
                    </span>
                  </motion.button>
                ))}
              </motion.div>
            </div>
          );
        })}
      </div>

      {/* Search + controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, symbol, number, config, discoverer, use…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && <button onClick={() => setQuery('')} className="text-xs text-muted-foreground hover:text-foreground">clear</button>}
        </div>
        <button onClick={() => setShowFilters((s) => !s)} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition ${showFilters ? 'border-cyan-j/60 bg-cyan-j/10 text-foreground' : 'border-border/60 bg-card/50'}`}>
          <Filter className="h-4 w-4" strokeWidth={1.5} /> Filters
        </button>
      </div>

      {showFilters && (
        <div className="mb-4 space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
          {/* Category highlight */}
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button key={c.id} onClick={() => setCategory(category === c.id ? null : c.id)} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition ${category === c.id ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 bg-card/50'}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} /> {c.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {['solid','liquid','gas'].map((ph) => (
              <button key={ph} onClick={() => setPhaseFilter(phaseFilter === ph ? null : ph)} className={`rounded-full border px-2.5 py-1 text-[10px] capitalize transition ${phaseFilter === ph ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 bg-card/50'}`}>{ph}</button>
            ))}
            {['s','p','d','f'].map((bl) => (
              <button key={bl} onClick={() => setBlockFilter(blockFilter === bl ? null : bl)} className={`rounded-full border px-2.5 py-1 text-[10px] uppercase transition ${blockFilter === bl ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 bg-card/50'}`}>{bl}-block</button>
            ))}
            <div className="mx-1 h-5 w-px bg-border/60" />
            {[
              ['radioactive','Radioactive'],['synthetic','Synthetic'],['metals','Metals'],['nonmetals','Nonmetals'],
            ].map(([id,lbl]) => (
              <button key={id} onClick={() => setHighlight(highlight === id ? null : id)} className={`rounded-full border px-2.5 py-1 text-[10px] transition ${highlight === id ? 'border-cyan-j/60 bg-cyan-j/10' : 'border-border/60 bg-card/50'}`}>{lbl}</button>
            ))}
          </div>
        </div>
      )}

      {/* Periodic table with controls */}
      <Card className="mb-6">
        <SectionHeader
          icon={Atom}
          title="Interactive Periodic Table"
          action={
            <div className="flex items-center gap-1.5">
              <button onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))} className="rounded-lg border border-border/60 bg-card/50 p-1.5 hover:border-cyan-j/50"><ZoomOut className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
              <span className="w-10 text-center text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(1.8, z + 0.2))} className="rounded-lg border border-border/60 bg-card/50 p-1.5 hover:border-cyan-j/50"><ZoomIn className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
              <button onClick={() => { setZoom(1); setCategory(null); setPhaseFilter(null); setBlockFilter(null); setHighlight(null); setQuery(''); }} className="rounded-lg border border-border/60 bg-card/50 p-1.5 hover:border-cyan-j/50"><RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
            </div>
          }
        />
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
          <PeriodicTableGrid elements={ALL_ELEMENTS} matchIds={matchIds} onSelect={openElement} />
        </div>
      </Card>

      {/* Daily widgets */}
      <motion.div variants={staggerContainer(0.06)} initial="initial" animate="in" className="grid gap-4 lg:grid-cols-3">
        {/* Featured element */}
        <Card>
          <SectionHeader icon={Sparkles} title="Featured Element" />
          <button onClick={() => openElement(featured)} className="flex w-full items-center gap-3 text-left">
            <motion.div
              animate={reduce ? undefined : breathing.animate}
              transition={loopTransition(reduce, 4)}
              className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl border-2 bg-card/70"
              style={{ borderColor: featuredCat.color }}
            >
              <span className="text-[10px] text-muted-foreground">{featured.atomic_number}</span>
              <span className="font-display text-2xl font-bold" style={{ color: featuredCat.color }}>{featured.symbol}</span>
            </motion.div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-lg font-semibold">{featured.name}</h3>
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{featured.summary}</p>
              <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-cyan-j">Explore <ChevronRight className="h-3 w-3" /></span>
            </div>
          </button>
        </Card>

        {/* Daily fact */}
        <Card>
          <SectionHeader icon={Lightbulb} title="Daily Chemistry Fact" />
          <p className="text-sm leading-relaxed text-foreground/90">{fact}</p>
        </Card>

        {/* Formula of the day */}
        <Card>
          <SectionHeader icon={FileText} title="Formula of the Day" />
          <h3 className="font-display text-lg font-semibold">{formula.name}</h3>
          <p className="my-1 font-mono-j text-xl text-cyan-j">{renderFormula(formula.formula)}</p>
          <p className="text-xs text-muted-foreground">{formula.note}</p>
          <p className="mt-2 text-xs"><span className="text-muted-foreground">Molar mass:</span> <span className="font-medium">{formulaMass.toFixed(2)} g/mol</span></p>
        </Card>

        {/* Reaction of the day */}
        <Card>
          <SectionHeader icon={Zap} title="Reaction of the Day" />
          <h3 className="font-display text-base font-semibold">{reaction.name}</h3>
          <p className="my-2 font-mono-j text-sm text-cyan-j">{reaction.equation}</p>
          <p className="text-xs text-muted-foreground">{reaction.note}</p>
        </Card>

        {/* Today's quiz */}
        <Card>
          <SectionHeader icon={Target} title="Today's Quiz" />
          <p className="mb-2 text-sm font-medium">{quiz.q}</p>
          <div className="grid grid-cols-1 gap-1.5">
            {quiz.options.map((o, i) => (
              <button
                key={i}
                onClick={() => setQuizAnswer(i)}
                className={`rounded-lg border px-3 py-1.5 text-left text-xs transition ${
                  quizAnswer === null ? 'border-border/60 bg-card/50 hover:border-cyan-j/40'
                  : i === quiz.a ? 'border-green-500/60 bg-green-500/10 text-green-400'
                  : i === quizAnswer ? 'border-destructive/60 bg-destructive/10 text-destructive'
                  : 'border-border/40 opacity-60'
                }`}
              >
                {o}
              </button>
            ))}
          </div>
          {quizAnswer !== null && <p className="mt-2 text-[11px] text-muted-foreground">{quizAnswer === quiz.a ? '✓ Correct!' : '✗ See the highlighted answer.'}</p>}
        </Card>

        {/* Favorites + recent */}
        <Card>
          <SectionHeader icon={Star} title="Favorites & Recently Viewed" />
          <div className="flex flex-wrap gap-1.5">
            {favorites.slice(0, 8).map((n) => {
              const el = getElement(n); if (!el) return null;
              const c = getCategory(el.category);
              return (
                <button key={n} onClick={() => openElement(el)} className="flex h-12 w-12 flex-col items-center justify-center rounded-lg border bg-card/60 hover:scale-110 transition" style={{ borderColor: c.color + '55' }}>
                  <span className="font-display text-sm font-bold" style={{ color: c.color }}>{el.symbol}</span>
                  <span className="text-[7px] text-muted-foreground">{el.atomic_number}</span>
                </button>
              );
            })}
            {recent.filter((n) => !favorites.includes(n)).slice(0, 8 - favorites.length).map((n) => {
              const el = getElement(n); if (!el) return null;
              const c = getCategory(el.category);
              return (
                <button key={n} onClick={() => openElement(el)} className="flex h-12 w-12 flex-col items-center justify-center rounded-lg border border-border/60 bg-card/40 opacity-80 hover:scale-110 transition">
                  <span className="font-display text-sm font-bold" style={{ color: c.color }}>{el.symbol}</span>
                  <span className="text-[7px] text-muted-foreground">{el.atomic_number}</span>
                </button>
              );
            })}
            {favorites.length === 0 && recent.length === 0 && <p className="text-xs text-muted-foreground">Star elements or open them to see them here.</p>}
          </div>
        </Card>
      </motion.div>

      {/* AI assistant */}
      <Card className="mt-6">
        <SectionHeader icon={Sparkles} title="AI Chemistry Assistant" />
        <AIPanel
          systemContext="You are Jarvis, an expert AI chemistry tutor. Give concise, scientifically accurate answers. Use formulas with subscripts where helpful."
          placeholder="Ask anything about elements, compounds, reactions, or chemistry concepts…"
        />
      </Card>
    </div>
  );
}