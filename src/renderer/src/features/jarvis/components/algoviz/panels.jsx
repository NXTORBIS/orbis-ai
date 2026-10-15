import React from 'react';
import { Button } from '@jarvis/components/ui/button';
import { Input } from '@jarvis/components/ui/input';
import { Slider } from '@jarvis/components/ui/slider';
import { Play, Pause, Square, RotateCcw, SkipBack, SkipForward, ChevronFirst, ChevronLast, Heart, Clock, Trash2, Zap } from 'lucide-react';

const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8, 16, 32, 64, 128];

// ── Playback controls ──
export function PlaybackControls({ pb }) {
  const btn = 'h-9 w-9 p-0';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="icon" variant="ghost" className={btn} onClick={pb.toStart} title="Jump to start"><ChevronFirst className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" className={btn} onClick={() => pb.skip(-5)} title="Skip back 5"><SkipBack className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" className={btn} onClick={pb.prev} title="Previous step"><ChevronFirst className="h-4 w-4 rotate-180" /></Button>
      <Button size="icon" variant="default" className="h-10 w-10" onClick={pb.toggle} title="Play/Pause">{pb.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</Button>
      <Button size="icon" variant="ghost" className={btn} onClick={pb.next} title="Next step"><ChevronLast className="h-4 w-4 rotate-180" /></Button>
      <Button size="icon" variant="ghost" className={btn} onClick={() => pb.skip(5)} title="Skip forward 5"><SkipForward className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" className={btn} onClick={pb.toEnd} title="Jump to end"><ChevronLast className="h-4 w-4" /></Button>
      <div className="w-px h-6 bg-border mx-1" />
      <Button size="sm" variant="outline" onClick={pb.stop} className="gap-1.5"><Square className="h-3.5 w-3.5" /> Stop</Button>
      <Button size="sm" variant="outline" onClick={pb.restart} className="gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> Restart</Button>
    </div>
  );
}

// ── Speed control ──
export function SpeedControl({ speed, setSpeed }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Speed</span>
        <span className="text-sm font-mono font-semibold text-cyan-j">{speed}×</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${speed === s ? 'bg-cyan-j text-white' : 'bg-secondary text-muted-foreground hover:bg-accent'}`}>{s}×</button>
        ))}
      </div>
      <Slider value={[Math.log2(speed * 10)]} min={Math.log2(1)} max={Math.log2(1280)} step={0.1} onValueChange={([v]) => setSpeed(Math.max(0.1, Math.round((Math.pow(2, v) / 10) * 100) / 100))} />
    </div>
  );
}

// ── Timeline ──
export function Timeline({ pb }) {
  const pct = pb.total > 1 ? (pb.idx / (pb.total - 1)) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Step {pb.idx + 1} / {pb.total}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="relative h-6 flex items-center">
        <div className="absolute inset-x-0 h-1.5 bg-secondary rounded-full" />
        <div className="absolute h-1.5 bg-cyan-j rounded-full" style={{ width: `${pct}%` }} />
        <input
          type="range" min={0} max={Math.max(0, pb.total - 1)} value={pb.idx}
          onChange={(e) => pb.jump(parseInt(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
        <div className="absolute h-4 w-4 -ml-2 rounded-full bg-cyan-j border-2 border-background shadow pointer-events-none" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Step description ──
export function StepDescription({ step }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Current Step</div>
      <div className="text-sm">{step?.desc || '—'}</div>
    </div>
  );
}

// ── Code view ──
export function CodeView({ code, line }) {
  return (
    <div className="rounded-lg border border-border bg-zinc-950/80 p-3 font-mono text-xs overflow-x-auto">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Source Code</div>
      {(code || []).map((l, i) => (
        <div key={i} className={`px-2 py-0.5 rounded ${i === line ? 'bg-cyan-j/20 text-cyan-j border-l-2 border-cyan-j' : 'text-zinc-400'}`}>
          <span className="text-zinc-600 mr-2 select-none">{i + 1}</span>{l}
        </div>
      ))}
    </div>
  );
}

// ── Variable inspector ──
export function VariableInspector({ step }) {
  const vars = step?.vars || {};
  const stack = step?.callStack || [];
  const keys = Object.keys(vars);
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Variables</div>
      {keys.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
      {keys.map((k) => (
        <div key={k} className="flex justify-between font-mono text-xs">
          <span className="text-muted-foreground">{k}</span>
          <span className="text-cyan-j font-semibold">{String(vars[k])}</span>
        </div>
      ))}
      {stack.length > 0 && (
        <div className="pt-2 border-t border-border">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Call Stack</div>
          <div className="space-y-0.5">
            {stack.map((f, i) => (
              <div key={i} className={`font-mono text-xs ${i === stack.length - 1 ? 'text-amber-500' : 'text-muted-foreground'}`}>{f.name}({f.args})</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Statistics ──
export function Statistics({ step }) {
  const s = step?.stats || {};
  const labels = { comparisons: 'Comparisons', swaps: 'Swaps', assignments: 'Assignments', accesses: 'Array accesses', reads: 'Reads', writes: 'Writes', recursiveCalls: 'Recursive calls', queueOps: 'Queue ops', stackOps: 'Stack ops', nodeVisits: 'Node visits', edgeTraversals: 'Edge traversals', heapOps: 'Heap ops' };
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Statistics</div>
      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(labels).map(([k, label]) => {
          const val = s[k] || 0;
          if (val === 0 && !['comparisons', 'swaps', 'assignments', 'accesses'].includes(k)) return null;
          return (
            <div key={k} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono font-semibold">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Complexity panel ──
export function ComplexityPanel({ algo }) {
  if (!algo) return null;
  const c = algo.complexity || {};
  const rows = [
    ['Best case', c.best], ['Average case', c.avg], ['Worst case', c.worst], ['Space', c.space],
    ['Stable', algo.stable ? 'Yes' : 'No'], ['In-place', algo.inplace ? 'Yes' : 'No'],
  ];
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Complexity & Properties</div>
      <p className="text-xs text-muted-foreground">{algo.description}</p>
      <div className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono font-semibold">{v || '—'}</span>
          </div>
        ))}
      </div>
      <div className="pt-2 border-t border-border space-y-1 text-xs">
        <div><span className="text-muted-foreground">Use cases: </span>{algo.useCases}</div>
        <div><span className="text-emerald-500">Advantages: </span>{algo.advantages}</div>
        <div><span className="text-red-500">Disadvantages: </span>{algo.disadvantages}</div>
      </div>
    </div>
  );
}

// ── Input controls ──
export function InputControls({ input, setInput, onGenerate, onRandomizeRun, opts, setOpts, algo }) {
  const needsTarget = algo?.needsTarget;
  const needsK = algo?.needsK;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-muted-foreground">Input {algo?.inputType === 'string' ? '(string)' : '(comma-separated numbers)'}</label>
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={algo?.inputType === 'string' ? 'AABAACAADAABAABA' : '5,3,8,1,9,2,7,4,6'} />
        </div>
        <Button size="sm" onClick={onGenerate} className="gap-1.5"><Play className="h-4 w-4" /> Run</Button>
        <Button size="sm" variant="secondary" onClick={onRandomizeRun} className="gap-1.5"><Zap className="h-4 w-4" /> Randomize & Run</Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpts({ ...opts, preset: 'random' })}>Random</Button>
        <Button size="sm" variant="outline" onClick={() => setOpts({ ...opts, preset: 'sorted' })}>Sorted</Button>
        <Button size="sm" variant="outline" onClick={() => setOpts({ ...opts, preset: 'reverse' })}>Reverse</Button>
        <Button size="sm" variant="outline" onClick={() => setOpts({ ...opts, preset: 'nearly' })}>Nearly sorted</Button>
        <Button size="sm" variant="outline" onClick={() => setOpts({ ...opts, preset: 'dups' })}>Duplicates</Button>
        <div>
          <label className="text-xs text-muted-foreground">Size</label>
          <Input type="number" value={opts.size} onChange={(e) => setOpts({ ...opts, size: parseInt(e.target.value) || 10 })} className="w-20" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Min</label>
          <Input type="number" value={opts.min} onChange={(e) => setOpts({ ...opts, min: parseInt(e.target.value) || 0 })} className="w-16" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Max</label>
          <Input type="number" value={opts.max} onChange={(e) => setOpts({ ...opts, max: parseInt(e.target.value) || 99 })} className="w-16" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Seed</label>
          <Input type="number" value={opts.seed} onChange={(e) => setOpts({ ...opts, seed: parseInt(e.target.value) || 1 })} className="w-20" />
        </div>
        {needsTarget && (
          <div>
            <label className="text-xs text-muted-foreground">Target</label>
            <Input type="number" value={opts.target ?? ''} onChange={(e) => setOpts({ ...opts, target: parseInt(e.target.value) })} className="w-20" />
          </div>
        )}
        {needsK && (
          <div>
            <label className="text-xs text-muted-foreground">k</label>
            <Input type="number" value={opts.k ?? 2} onChange={(e) => setOpts({ ...opts, k: parseInt(e.target.value) || 2 })} className="w-16" />
          </div>
        )}
      </div>
      {opts.size > 200 && <div className="text-xs text-amber-500">⚠ Large input — visualization may have many steps and run slowly.</div>}
    </div>
  );
}

// ── Comparison view ──
export function ComparisonView({ results }) {
  if (!results || results.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 overflow-x-auto">
      <div className="text-sm font-semibold mb-3">Comparison (same input)</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-2">Algorithm</th>
            <th className="text-right p-2">Steps</th>
            <th className="text-right p-2">Comparisons</th>
            <th className="text-right p-2">Swaps</th>
            <th className="text-right p-2">Assignments</th>
            <th className="text-right p-2">Accesses</th>
            <th className="text-right p-2">Avg complexity</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const last = r.steps[r.steps.length - 1] || { stats: {} };
            return (
              <tr key={r.id} className="border-b border-border/50">
                <td className="p-2 font-medium">{r.name}</td>
                <td className="text-right p-2 font-mono">{r.steps.length}</td>
                <td className="text-right p-2 font-mono">{last.stats.comparisons || 0}</td>
                <td className="text-right p-2 font-mono">{last.stats.swaps || 0}</td>
                <td className="text-right p-2 font-mono">{last.stats.assignments || 0}</td>
                <td className="text-right p-2 font-mono">{last.stats.accesses || 0}</td>
                <td className="text-right p-2 font-mono text-muted-foreground">{r.complexity?.avg}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Favorites & recent ──
export function FavoritesBar({ favorites, recent, onSelect, onClearRecent }) {
  return (
    <div className="flex flex-wrap gap-2">
      {favorites.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Heart className="h-3.5 w-3.5 text-red-500" />
          {favorites.slice(0, 8).map((id) => (
            <button key={id} onClick={() => onSelect(id)} className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-500 hover:bg-red-500/20">{id}</button>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          {recent.slice(0, 6).map((r) => (
            <button key={r.id} onClick={() => onSelect(r.id)} className="text-xs px-2 py-1 rounded bg-secondary text-muted-foreground hover:bg-accent">{r.id}</button>
          ))}
          <button onClick={onClearRecent} className="text-xs px-1.5 py-1 text-muted-foreground hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
        </div>
      )}
    </div>
  );
}