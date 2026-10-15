import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Workflow, Search, Heart, GitCompare, ArrowUp, Maximize2 } from 'lucide-react';
import ExpandedView from '@jarvis/components/algoviz/ExpandedView';
import { Button } from '@jarvis/components/ui/button';
import { Input } from '@jarvis/components/ui/input';
import PageTitle from '@jarvis/components/PageTitle';
import { ALL_ALGORITHMS, ALGO_MAP, CATEGORIES, searchAlgorithms, getFavorites, toggleFavorite, getRecent, addRecent, clearRecent } from '@jarvis/components/algoviz/registry';
import { usePlayback } from '@jarvis/components/algoviz/usePlayback';
import { ViewRenderer } from '@jarvis/components/algoviz/views';
import { PlaybackControls, SpeedControl, Timeline, StepDescription, CodeView, VariableInspector, Statistics, ComplexityPanel, InputControls, ComparisonView, FavoritesBar } from '@jarvis/components/algoviz/panels';
import PathGridEditor from '@jarvis/components/algoviz/PathGridEditor';

// Seeded RNG so a given seed reproduces the same dataset.
function seededRng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 100000) / 100000; }; }

function genArray(opts) {
  const { size, min, max, seed, preset } = opts;
  const rng = seededRng(seed);
  const span = Math.max(1, max - min);
  let a = Array.from({ length: size }, () => min + Math.floor(rng() * span));
  if (preset === 'sorted') a.sort((x, y) => x - y);
  else if (preset === 'reverse') a.sort((x, y) => y - x);
  else if (preset === 'nearly') { a.sort((x, y) => x - y); for (let i = 0; i < Math.max(1, size >> 3); i++) { const x = Math.floor(rng() * size), y = Math.floor(rng() * size); [a[x], a[y]] = [a[y], a[x]]; } }
  else if (preset === 'dups') { a = Array.from({ length: size }, () => min + Math.floor(rng() * Math.min(5, span))); }
  return a;
}

function parseInput(str, inputType) {
  if (inputType === 'string') return str;
  if (inputType === 'none') return [];
  return str.split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
}

export default function AlgorithmLab() {
  const [algoId, setAlgoId] = useState('bubbleSort');
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState('All');
  const [input, setInput] = useState('5,3,8,1,9,2,7,4,6');
  const [opts, setOpts] = useState({ size: 10, min: 1, max: 99, seed: 1, preset: 'random' });
  const [runResult, setRunResult] = useState(null); // { steps, code }
  const [favorites, setFavorites] = useState([]);
  const [recent, setRecent] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [comparePick, setComparePick] = useState([]);
  const [compareResults, setCompareResults] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const labRef = useRef(null);
  const [gridState, setGridState] = useState({ rows: 15, cols: 25, start: { r: 1, c: 1 }, end: { r: 13, c: 23 }, walls: [] });

  const algo = ALGO_MAP[algoId];
  const isPathfinding = algo?.view === 'pathgrid';

  const scrollToLab = useCallback(() => {
    labRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const pb = usePlayback(runResult?.steps || []);

  useEffect(() => { setFavorites(getFavorites()); setRecent(getRecent()); }, []);

  const filtered = useMemo(() => {
    let list = searchAlgorithms(query);
    if (activeCat !== 'All') list = list.filter((a) => a.category === activeCat);
    return list;
  }, [query, activeCat]);

  const run = useCallback((id, customInput, customOpts) => {
    const a = ALGO_MAP[id];
    if (!a) return;
    const data = customInput !== undefined ? customInput : parseInput(input, a.inputType);
    try {
      const res = a.generate(data, customOpts || opts);
      setRunResult(res);
      setRecent(addRecent(id, Array.isArray(data) ? data.length : 0));
      setFavorites(getFavorites());
    } catch (e) {
      setRunResult({ steps: [{ array: [], view: a.view, viewData: {}, vars: {}, stats: {}, desc: `Error: ${e.message}`, codeLine: 0 }], code: [] });
    }
  }, [input, opts]);

  const onGenerate = useCallback(() => run(algoId), [run, algoId]);
  const onRandomizeRun = useCallback(() => {
    const newSeed = Math.floor(Math.random() * 100000);
    const newOpts = { ...opts, seed: newSeed, preset: 'random' };
    setOpts(newOpts);
    if (algo.inputType === 'array') {
      const data = genArray(newOpts);
      setInput(data.join(','));
      run(algoId, data, newOpts);
    } else { run(algoId, undefined, newOpts); }
  }, [opts, algo, run, algoId]);

  // Apply preset buttons
  useEffect(() => {
    if (algo?.inputType === 'array' && opts.preset) {
      const data = genArray(opts);
      setInput(data.join(','));
    }
  }, [opts.preset, opts.size, opts.min, opts.max, opts.seed, algo]);

  const selectAlgo = (id) => {
    setAlgoId(id);
    setShowCompare(false);
    setCompareResults([]);
    setTimeout(scrollToLab, 50);
  };
  const fav = () => { setFavorites(toggleFavorite(algoId)); };
  const isFav = favorites.includes(algoId);

  const runComparison = () => {
    const data = algo.inputType === 'array' ? parseInput(input, 'array') : parseInput(input, algo.inputType);
    const results = comparePick.map((id) => { const a = ALGO_MAP[id]; const res = a.generate(data, opts); return { id, name: a.name, complexity: a.complexity, steps: res.steps }; });
    setCompareResults(results);
  };

  const step = runResult?.steps[pb.idx];

  return (
    <div className="pb-12">
      <PageTitle title="Algorithm Laboratory" subtitle="Step-by-step visualization of real algorithm execution">
        <Workflow className="h-7 w-7 text-cyan-j" />
      </PageTitle>

      {/* Search + favorites + recent */}
      <div className="space-y-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search algorithms, categories, complexity…" className="pl-9" />
          </div>
          <Button size="sm" variant={showCompare ? 'default' : 'outline'} onClick={() => setShowCompare(!showCompare)} className="gap-1.5"><GitCompare className="h-4 w-4" /> Compare</Button>
          <Button size="sm" variant={isFav ? 'default' : 'outline'} onClick={fav} className="gap-1.5"><Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} /> {isFav ? 'Favorited' : 'Favorite'}</Button>
        </div>
        <FavoritesBar favorites={favorites} recent={recent} onSelect={selectAlgo} onClearRecent={() => { clearRecent(); setRecent([]); }} />
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {['All', ...CATEGORIES].map((c) => (
          <button key={c} onClick={() => setActiveCat(c)} className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${activeCat === c ? 'bg-cyan-j text-white' : 'bg-secondary text-muted-foreground hover:bg-accent'}`}>{c}</button>
        ))}
      </div>

      {/* Algorithm grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-6">
        {filtered.map((a) => (
          <button key={a.id} onClick={() => selectAlgo(a.id)} className={`text-left p-2.5 rounded-lg border transition-all ${algoId === a.id ? 'border-cyan-j bg-cyan-j/10' : 'border-border bg-card/40 hover:border-cyan-j/50'}`}>
            <div className="text-xs font-semibold leading-tight">{a.name}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{a.category}</div>
            {showCompare && (
              <label className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={comparePick.includes(a.id)} onChange={(e) => { if (e.target.checked) setComparePick([...comparePick, a.id]); else setComparePick(comparePick.filter((x) => x !== a.id)); }} />
                <span className="text-[10px] text-muted-foreground">compare</span>
              </label>
            )}
          </button>
        ))}
      </div>

      {showCompare && comparePick.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{comparePick.length} selected</span>
          <Button size="sm" onClick={runComparison}>Run Comparison</Button>
          <Button size="sm" variant="ghost" onClick={() => setComparePick([])}>Clear</Button>
        </div>
      )}
      {showCompare && <ComparisonView results={compareResults} />}

      {/* Main lab */}
      <div ref={labRef} className="grid grid-cols-1 lg:grid-cols-3 gap-4 scroll-mt-4">
        <div className="lg:col-span-2 space-y-3">
          {isPathfinding ? (
            <PathGridEditor grid={gridState} setGrid={setGridState} onRun={() => run(algoId, gridState)} algo={algo} />
          ) : (
            <InputControls input={input} setInput={setInput} onGenerate={onGenerate} onRandomizeRun={onRandomizeRun} opts={opts} setOpts={setOpts} algo={algo} />
          )}
          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 px-3 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">Visualization</span>
            <button onClick={() => setExpanded(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-j transition-colors btn-press" aria-label="Expand visualization">
              <Maximize2 className="h-4 w-4" /> Expand
            </button>
          </div>
          <ViewRenderer step={step} />
          <StepDescription step={step} />
          <div className="space-y-3">
            <PlaybackControls pb={pb} />
            <Timeline pb={pb} />
            <SpeedControl speed={pb.speed} setSpeed={pb.setSpeed} />
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card/60 p-3">
            <div className="text-sm font-semibold mb-1">{algo?.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-cyan-j">{algo?.category}</div>
          </div>
          <VariableInspector step={step} />
          <Statistics step={step} />
          <CodeView code={runResult?.code} line={step?.codeLine} />
          <ComplexityPanel algo={algo} />
        </div>
      </div>

      {expanded && (
        <ExpandedView step={step} algoName={algo?.name} onClose={() => setExpanded(false)} />
      )}
      <button
        onClick={() => {
          const main = document.querySelector('main.scrollbar-thin') || document.querySelector('main');
          if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
          else window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        className="fixed bottom-6 right-6 z-40 h-11 w-11 rounded-full bg-cyan-j text-white shadow-lg flex items-center justify-center hover:bg-cyan-j/90 transition-colors btn-press"
        aria-label="Back to top"
      >
        <ArrowUp className="h-5 w-5" />
      </button>
    </div>
  );
}