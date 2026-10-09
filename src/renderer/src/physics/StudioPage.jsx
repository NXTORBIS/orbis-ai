import React, { useMemo, useState } from 'react';
import { useNavigate } from './ui/router.jsx';
import { SECTIONS, ALL_TOPICS, LIVE_COUNT, TOTAL_COUNT } from './lib/registry.js';
import { getExplanation } from './lib/topicExplanations.js';
import PageTitle from './ui/PageTitle.jsx';
import { Button } from './ui/button.jsx';
import ConceptPanel from './ConceptPanel.jsx';
import ConceptExplainer from './ConceptExplainer.jsx';
import { ArrowLeft, CheckCircle2, Search, HelpCircle, BookOpen } from 'lucide-react';

export default function PhysicsStudio() {
  const navigate = useNavigate();
  const [sectionId, setSectionId] = useState(SECTIONS[0].id);
  const [active, setActive] = useState(null); // topic object
  const [query, setQuery] = useState('');
  const [showExplain, setShowExplain] = useState(false);
  const [autoExplain, setAutoExplain] = useState(() => localStorage.getItem('physics_auto_explain') !== 'off');

  const section = SECTIONS.find((s) => s.id === sectionId);
  const isSearching = query.trim().length > 0;
  const topics = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return section.topics;
    return ALL_TOPICS.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.desc || '').toLowerCase().includes(q) ||
      (t.sectionName || '').toLowerCase().includes(q)
    );
  }, [section, query]);

  const open = (tp) => {
    setActive(tp);
    setShowExplain(autoExplain);
  };

  const toggleAuto = () => {
    const v = !autoExplain;
    setAutoExplain(v);
    localStorage.setItem('physics_auto_explain', v ? 'on' : 'off');
  };

  const Live = active && active.component;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <PageTitle
        title="Physics Studio"
        subtitle={active ? null : 'Interactive simulations with real numerical models — classical → quantum → astrophysics → research. Every live topic runs genuine computation, not canned animation.'}
      >
        <Button variant="outline" size="sm" onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/studios'); }}><ArrowLeft className="size-4" /> Back</Button>
      </PageTitle>

      {/* Section tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button key={s.id} onClick={() => { setSectionId(s.id); setActive(null); setQuery(''); }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${s.id === sectionId ? 'text-white' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}
            style={s.id === sectionId ? { background: s.accent } : {}}>
            {s.name}
          </button>
        ))}
      </div>

      {/* The explainer is told the topic's OWN section, not whichever tab happens to be selected. Searching crosses
          sections, so opening a quantum topic from a search while Classical Mechanics was selected labelled it
          "Quantum Many-Body Simulator · Classical Mechanics". */}
      {!active ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this section…"
                className="w-full rounded-lg border border-input bg-transparent pl-8 pr-3 py-1.5 text-sm" />
            </div>
            <button onClick={toggleAuto}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${autoExplain ? 'bg-cyan-j text-black' : 'bg-card/40 text-muted-foreground hover:bg-card/70'}`}
              title="Show explanations automatically when opening a simulator">
              <BookOpen className="inline size-3.5 mr-1" />Auto-explain: {autoExplain ? 'ON' : 'OFF'}
            </button>
            <span className="text-xs text-muted-foreground">{TOTAL_COUNT} topics · all open</span>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((tp) => {
              const ex = getExplanation(tp.id);
              return (
                <button key={tp.id} onClick={() => open(tp)}
                  className="group rounded-xl border border-border/60 bg-card/40 p-3 text-left transition-all hover:border-cyan-j hover:bg-card/70">
                  {isSearching && tp.sectionName && (
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-cyan-j/80">{tp.sectionName}</div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{tp.name}</span>
                    <CheckCircle2 className="size-4 text-cyan-j shrink-0" />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{tp.desc}</div>
                  {ex && (
                    <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
                      <div><span className="text-[10px] font-semibold text-foreground">What it means: </span><span className="text-[11px] leading-snug text-muted-foreground">{ex.means}</span></div>
                      <div><span className="text-[10px] font-semibold text-foreground">What you explore: </span><span className="text-[11px] leading-snug text-muted-foreground">{ex.explore}</span></div>
                    </div>
                  )}
                  <div className="mt-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-j">Open simulator →</span>
                  </div>
                </button>
              );
            })}
            {!topics.length && <div className="col-span-full text-sm text-muted-foreground py-8 text-center">No topics match “{query}”.</div>}
          </div>
        </>
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setActive(null)}><ArrowLeft className="size-4" />All topics</Button>
            <div className="flex-1 min-w-0">
              <h2 className="font-display text-lg font-bold">{active.name}</h2>
              <p className="text-xs text-muted-foreground">{active.desc}</p>
            </div>
            <Button size="sm" variant={showExplain ? 'default' : 'outline'} onClick={() => setShowExplain((s) => !s)}>
              <HelpCircle className="size-4" /> {showExplain ? 'Hide explanation' : 'What does this mean?'}
            </Button>
          </div>
          {/*
            * The simulation first, the explanation under it.
            *
            * The explainer opens by itself, and above the simulation it pushed the whole laboratory past the
            * bottom of the window: the parameter panel landed 1,145 pixels down in a 770-pixel view, so the first
            * thing anybody had to do was scroll to find the controls. Reading comes after doing here.
            */}
          {Live ? <Live /> : active.to ? (
            <div className="rounded-xl border border-border/60 bg-card/40 p-6 text-center">
              <p className="text-sm text-muted-foreground mb-3">This simulator runs on its own dedicated page.</p>
              <Button onClick={() => navigate(active.to)}>Open in dedicated lab →</Button>
            </div>
          ) : <ConceptPanel topic={active} section={SECTIONS.find((s) => s.id === active.section) || section} onOpen={open} />}
          {showExplain && (
            <div className="mt-4">
              <ConceptExplainer topic={active} section={SECTIONS.find((s) => s.id === active.section) || section} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}