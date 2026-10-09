import React from 'react';
import { COLORS } from './stepUtils.js';

// ── Bar view (sorting / searching / arrays) ──
export function BarView({ step, fill }) {
  const arr = step.array || [];
  const max = Math.max(...arr, 1);
  const hl = step.hl || {};
  const colorFor = (i) => {
    if (hl.sorted?.includes(i)) return COLORS.sorted;
    if (hl.found === i || hl.found?.includes(i)) return COLORS.found;
    if (hl.swap?.includes(i)) return COLORS.swap;
    if (hl.compare?.includes(i)) return COLORS.compare;
    if (hl.pivot === i) return COLORS.pivot;
    if (hl.current === i) return COLORS.current;
    if (hl.active?.includes(i)) return COLORS.active;
    if (hl.range && i >= hl.range[0] && i <= hl.range[1]) return COLORS.range;
    if (hl.eliminated && i >= hl.eliminated[0] && i <= hl.eliminated[1]) return COLORS.eliminated;
    if (hl.visited?.includes(i)) return COLORS.visited;
    return COLORS.idle;
  };
  return (
    <div className={`flex items-end gap-1 rounded-xl border border-border/70 bg-card/40 p-4 overflow-x-auto ${fill ? 'h-full w-full' : 'h-[260px]'}`}>
      {arr.map((n, i) => (
        <div key={i} className="flex flex-col items-center flex-1 min-w-[14px]" style={{ height: '100%' }}>
          <div className={`flex-1 w-full rounded-t transition-all duration-150 ${colorFor(i)}`} style={{ height: `${Math.max(4, (n / max) * 100)}%` }} />
          <span className="block mt-1 text-[10px] text-muted-foreground">{n}</span>
        </div>
      ))}
    </div>
  );
}

// ── Tree view (BST / recursion call tree) ──
export function TreeView({ step }) {
  const vd = step.viewData || {};
  const root = vd.root;
  if (!root) return <EmptyView text="Empty tree" />;
  const positions = [];
  function layout(node, depth, x) {
    if (!node) return x;
    x = layout(node.left, depth + 1, x);
    positions.push({ node, x: x++, depth });
    x = layout(node.right, depth + 1, x);
    return x;
  }
  layout(root, 0, 0);
  const maxX = positions.length;
  const maxY = Math.max(...positions.map((p) => p.depth)) + 1;
  const W = Math.max(320, maxX * 60), H = Math.max(200, maxY * 70);
  const posOf = new Map();
  positions.forEach((p) => posOf.set(p.node, { x: (p.x + 0.5) * (W / maxX), y: p.depth * 70 + 30 }));
  const edges = [];
  function collect(node) {
    if (!node) return;
    [node.left, node.right].forEach((c) => { if (c) { edges.push([node, c]); collect(c); } });
  }
  collect(root);
  const isCurrent = (n) => vd.current !== undefined && (n.val === vd.current || (typeof vd.current === 'string' && n.val === vd.current));
  const inPath = (n) => vd.path?.includes(n.val);
  const isFound = (n) => vd.found && n.val === vd.current;
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-4 overflow-x-auto">
      <svg width={W} height={H} className="mx-auto">
        {edges.map(([p, c], i) => {
          const a = posOf.get(p), b = posOf.get(c); if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="hsl(var(--border))" strokeWidth={2} />;
        })}
        {positions.map((p, i) => {
          const pos = posOf.get(p.node);
          const cur = isCurrent(p.node), path = inPath(p.node), found = isFound(p.node);
          return (
            <g key={i} transform={`translate(${pos.x},${pos.y})`}>
              <circle r={18} fill={found ? COLORS.found : cur ? COLORS.current : path ? COLORS.path : 'hsl(var(--secondary))'} stroke="hsl(var(--border))" />
              <text textAnchor="middle" dy={4} fontSize={p.node.val !== undefined && String(p.node.val).length > 4 ? 7 : 11} fill="white" fontWeight="600">
                {p.node.result !== null && p.node.result !== undefined ? `${p.node.val}=${p.node.result}` : String(p.node.val)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Graph view ──
export function GraphView({ step }) {
  const vd = step.viewData || {};
  const nodes = vd.nodes || []; const edges = vd.edges || [];
  const W = 420, H = 280;
  const px = (x) => 60 + x * 90, py = (y) => H / 2 + y * 80;
  const visited = new Set(vd.visited || []);
  const inPath = new Set(vd.path || []);
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-4 overflow-x-auto">
      <svg width={W} height={H} className="mx-auto">
        {edges.map((e, i) => {
          const a = nodes[e.from], b = nodes[e.to]; if (!a || !b) return null;
          const hl = vd.edge && ((vd.edge[0] === e.from && vd.edge[1] === e.to) || (vd.edge[0] === e.to && vd.edge[1] === e.from));
          return <g key={i}><line x1={px(a.x)} y1={py(a.y)} x2={px(b.x)} y2={py(b.y)} stroke={hl ? COLORS.current : 'hsl(var(--border))'} strokeWidth={hl ? 3 : 1.5} />{e.w !== undefined && <text x={(px(a.x) + px(b.x)) / 2} y={(py(a.y) + py(b.y)) / 2} fontSize={10} fill="hsl(var(--muted-foreground))">{e.w}</text>}</g>;
        })}
        {nodes.map((n) => {
          const cur = vd.current === n.id, vis = visited.has(n.id), path = inPath.has(n.id);
          return (
            <g key={n.id} transform={`translate(${px(n.x)},${py(n.y)})`}>
              <circle r={18} fill={cur ? COLORS.current : path ? COLORS.path : vis ? COLORS.visited : 'hsl(var(--secondary))'} stroke="hsl(var(--border))" strokeWidth={2} />
              <text textAnchor="middle" dy={4} fontSize={12} fill="white" fontWeight="600">{n.label}</text>
            </g>
          );
        })}
      </svg>
      {vd.dist && <div className="mt-2 text-xs text-muted-foreground text-center">Distances: {Object.entries(vd.dist).map(([k, v]) => `${k}=${v}`).join(', ')}</div>}
    </div>
  );
}

// ── Linked list view ──
export function ListView({ step }) {
  const vd = step.viewData || {};
  const nodes = vd.nodes || []; const links = vd.links || [];
  const hl = new Set(vd.highlight || []);
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-4 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        <span className="text-xs text-muted-foreground mr-2">HEAD→</span>
        {nodes.map((n, i) => (
          <React.Fragment key={n.id}>
            <div className={`flex flex-col items-center px-3 py-2 rounded-lg border-2 ${hl.has(n.id) ? 'border-fuchsia-500 bg-fuchsia-500/20' : 'border-border bg-secondary'}`}>
              <span className="text-sm font-mono">{n.val}</span>
            </div>
            {i < nodes.length - 1 && <span className="text-cyan-j">→</span>}
          </React.Fragment>
        ))}
        {nodes.length > 0 && <span className="text-xs text-muted-foreground ml-2">→ NULL</span>}
        {vd.cycle && <span className="text-xs text-amber-500 ml-2">(cycle)</span>}
      </div>
    </div>
  );
}

// ── Stack view ──
export function StackView({ step }) {
  const vd = step.viewData || {};
  const items = vd.items || [];
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-4 flex flex-col items-center gap-3">
      <div className="text-xs text-muted-foreground">{vd.op === 'push' ? '↓ PUSH' : vd.op === 'pop' ? '↑ POP' : vd.op || ''}</div>
      <div className="flex flex-col-reverse gap-1 w-48">
        {items.length === 0 && <div className="text-center text-xs text-muted-foreground py-8 border-2 border-dashed border-border rounded-lg">empty</div>}
        {items.map((it, i) => (
          <div key={i} className={`px-3 py-2 rounded-lg text-center font-mono text-sm border-2 ${vd.highlight === i ? 'border-amber-500 bg-amber-500/20' : 'border-border bg-secondary'}`}>{it}</div>
        ))}
        <div className="h-1 bg-border rounded-full" />
      </div>
      {vd.output !== undefined && <div className="text-xs text-muted-foreground">Output: <span className="font-mono text-cyan-j">{vd.output}</span></div>}
    </div>
  );
}

// ── Queue view ──
export function QueueView({ step }) {
  const vd = step.viewData || {};
  const items = vd.items || [];
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-4 flex flex-col items-center gap-2">
      <div className="text-xs text-muted-foreground">{vd.op || ''}</div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground mr-1">FRONT→</span>
        {items.length === 0 && <div className="text-xs text-muted-foreground px-4 py-2 border-2 border-dashed border-border rounded-lg">empty</div>}
        {items.map((it, i) => (
          <React.Fragment key={i}>
            <div className={`px-3 py-2 rounded-lg font-mono text-sm border-2 ${vd.highlight === i ? 'border-amber-500 bg-amber-500/20' : 'border-border bg-secondary'}`}>{it ?? '·'}</div>
            {i < items.length - 1 && <span className="text-cyan-j">·</span>}
          </React.Fragment>
        ))}
        <span className="text-xs text-muted-foreground ml-1">→REAR</span>
      </div>
      {vd.circular && <div className="text-xs text-muted-foreground">front={vd.front} rear={vd.rear} cap={vd.cap}</div>}
    </div>
  );
}

// ── Table view (DP) ──
export function TableView({ step }) {
  const vd = step.viewData || {};
  const rows = vd.rows || [];
  const colLabels = vd.colLabels || (rows[0] || []).map((_, i) => i);
  const rowLabels = vd.rowLabels || rows.map((_, i) => i);
  const cellColor = (r, c) => {
    if (vd.cur && vd.cur[0] === r && vd.cur[1] === c) return COLORS.current;
    if (vd.prev?.some((p) => p[0] === r && p[1] === c)) return COLORS.compare;
    if (vd.done && r === vd.cur?.[0] && c === vd.cur?.[1]) return COLORS.found;
    return 'hsl(var(--secondary))';
  };
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-4 overflow-x-auto">
      <table className="mx-auto border-collapse text-sm">
        <thead>
          <tr><th className="p-1" />
            {colLabels.map((c, i) => <th key={i} className="p-1 text-xs text-muted-foreground font-mono">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              <td className="p-1 text-xs text-muted-foreground font-mono text-right pr-2">{rowLabels[r]}</td>
              {row.map((cell, c) => (
                <td key={c} className={`p-1 text-center font-mono min-w-[40px] border border-border/50 ${cellColor(r, c)}`} style={{ color: cellColor(r, c).includes('bg-') && !cellColor(r, c).includes('slate') ? 'white' : 'inherit' }}>{cell === Infinity ? '∞' : cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── String view ──
export function StringView({ step }) {
  const vd = step.viewData || {};
  const text = vd.text || []; const pat = vd.pattern || [];
  const i = vd.i ?? 0, j = vd.j ?? 0;
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-4 space-y-3">
      <div className="flex flex-wrap gap-0.5">
        <span className="text-xs text-muted-foreground mr-2">text:</span>
        {text.map((c, k) => (
          <span key={k} className={`w-6 h-7 flex items-center justify-center font-mono text-sm rounded ${k === i + j || (vd.found && k >= i && k < i + pat.length) ? 'bg-amber-500 text-white' : k >= i && k < i + pat.length ? 'bg-secondary border border-cyan-j' : 'bg-secondary'}`}>{c}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-0.5">
        <span className="text-xs text-muted-foreground mr-2">pat:</span>
        {pat.map((c, k) => (
          <span key={k} className={`w-6 h-7 flex items-center justify-center font-mono text-sm rounded ${k === j ? 'bg-fuchsia-500 text-white' : 'bg-secondary'}`}>{c}</span>
        ))}
      </div>
      {vd.lps && <div className="text-xs text-muted-foreground">LPS: [{vd.lps.join(', ')}]</div>}
      {vd.found && <div className="text-xs text-emerald-500">Match found!</div>}
    </div>
  );
}

// ── Grid view (N-Queens, permutations) ──
export function GridView({ step }) {
  const vd = step.viewData || {};
  if (vd.board) {
    const n = vd.n; const board = vd.board;
    return (
      <div className="rounded-xl border border-border/70 bg-card/40 p-4 flex justify-center">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${n}, 36px)` }}>
          {Array.from({ length: n * n }, (_, idx) => {
            const r = Math.floor(idx / n), c = idx % n;
            const q = board[r] === c;
            return <div key={idx} className={`w-9 h-9 flex items-center justify-center text-lg ${q ? 'bg-fuchsia-500/30' : (r + c) % 2 === 0 ? 'bg-secondary' : 'bg-muted'}`}>{q ? '♛' : ''}</div>;
          })}
        </div>
      </div>
    );
  }
  if (vd.path !== undefined) {
    const n = vd.n; const used = vd.used || []; const path = vd.path || [];
    return (
      <div className="rounded-xl border border-border/70 bg-card/40 p-4 space-y-2">
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: n }, (_, i) => (
            <span key={i} className={`px-3 py-2 rounded-lg font-mono border-2 ${used[i] ? 'border-emerald-500 bg-emerald-500/20' : 'border-border bg-secondary'}`}>{i < path.length ? path[i] : '·'}</span>
          ))}
        </div>
        {vd.solution && <div className="text-xs text-emerald-500">Permutation: [{path.join(', ')}]</div>}
      </div>
    );
  }
  return <EmptyView text="No grid" />;
}

// ── Hanoi view ──
export function HanoiView({ step }) {
  const vd = step.viewData || {};
  const rods = vd.rods || { A: [], B: [], C: [] };
  const n = vd.n || 1;
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-4 flex justify-center gap-6">
      {['A', 'B', 'C'].map((name) => (
        <div key={name} className="flex flex-col-reverse items-center" style={{ width: `${n * 24 + 20}px` }}>
          {rods[name].map((disk, i) => (
            <div key={i} className="rounded bg-cyan-j/70 mb-0.5" style={{ width: `${disk * 20 + 8}px`, height: 16 }} />
          ))}
          <div className="w-full h-1 bg-border" />
          <span className="text-xs text-muted-foreground mt-1">{name}</span>
        </div>
      ))}
    </div>
  );
}

// ── Buckets view (hash table) ──
export function BucketsView({ step }) {
  const vd = step.viewData || {};
  const buckets = vd.buckets || [];
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-4 overflow-x-auto">
      <div className="flex flex-col gap-1 min-w-max">
        {buckets.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono w-8 text-right">{i}:</span>
            <div className={`flex gap-1 ${vd.highlight === i ? 'ring-2 ring-amber-500 rounded' : ''}`}>
              {Array.isArray(b) ? b.map((v, k) => <span key={k} className="px-2 py-1 rounded bg-secondary border border-border font-mono text-sm">{v}</span>) : (b !== null && b !== '·' ? <span className="px-2 py-1 rounded bg-secondary border border-border font-mono text-sm">{b}</span> : <span className="px-2 py-1 text-muted-foreground">·</span>)}
            </div>
          </div>
        ))}
      </div>
      {vd.h !== undefined && <div className="mt-2 text-xs text-cyan-j">hash → {vd.h}</div>}
    </div>
  );
}

// ── Greedy view (activities / knapsack) ──
export function GreedyView({ step }) {
  const vd = step.viewData || {};
  const items = vd.items || [];
  const selected = new Set(vd.selected || []);
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-4 space-y-2 overflow-x-auto">
      {items.map((it, i) => {
        const sel = selected.has(it.id); const cur = vd.current === i; const rej = vd.reject === i;
        return (
          <div key={i} className={`flex items-center gap-3 p-2 rounded-lg border ${sel ? 'border-emerald-500 bg-emerald-500/15' : rej ? 'border-red-500/50 bg-red-500/10' : cur ? 'border-amber-500 bg-amber-500/15' : 'border-border'}`}>
            <span className="text-xs font-mono w-6">{it.id}</span>
            {it.start !== undefined && <span className="text-xs">[{it.start}, {it.end}]</span>}
            {it.ratio !== undefined && <span className="text-xs">w={it.w} v={it.v} r={it.ratio.toFixed(2)}</span>}
            {sel && <span className="text-xs text-emerald-500 ml-auto">✓ selected</span>}
            {rej && <span className="text-xs text-red-500 ml-auto">✗ rejected</span>}
          </div>
        );
      })}
      {vd.total !== undefined && <div className="text-xs text-muted-foreground">Total value: {vd.total.toFixed(2)}</div>}
    </div>
  );
}

// ── Pathfinding grid view (Dijkstra / A* on a grid) ──
export function PathGridView({ step }) {
  const vd = step.viewData || {};
  const { rows, cols, start, end } = vd;
  if (!rows || !cols) return <EmptyView text="No grid" />;
  const walls = new Set(vd.walls || []);
  const visited = new Set(vd.visited || []);
  const frontier = new Set(vd.frontier || []);
  const pathSet = new Set((vd.path || []).map((p) => `${p.r},${p.c}`));
  const cur = vd.current;
  const k = (r, c) => `${r},${c}`;
  const cellColor = (r, c) => {
    if (r === start.r && c === start.c) return 'bg-green-500';
    if (r === end.r && c === end.c) return 'bg-rose-500';
    if (walls.has(k(r, c))) return 'bg-zinc-700';
    if (pathSet.has(k(r, c))) return 'bg-emerald-400';
    if (cur && cur.r === r && cur.c === c) return 'bg-fuchsia-500';
    if (frontier.has(k(r, c))) return 'bg-amber-500/80';
    if (visited.has(k(r, c))) return 'bg-cyan-j/30';
    return 'bg-secondary/40';
  };
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-3 overflow-auto">
      <div className="grid gap-px mx-auto" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: `${cols * 26}px` }}>
        {Array.from({ length: rows * cols }, (_, idx) => {
          const r = Math.floor(idx / cols), c = idx % cols;
          return <div key={idx} className={`aspect-square rounded-[3px] ${cellColor(r, c)}`} />;
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />Start</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />End</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-zinc-700 inline-block" />Wall</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-fuchsia-500 inline-block" />Current</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-amber-500/80 inline-block" />Frontier</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-cyan-j/30 inline-block" />Visited</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />Path</span>
      </div>
    </div>
  );
}

function EmptyView({ text }) { return <div className="rounded-xl border border-border/70 bg-card/40 p-8 text-center text-sm text-muted-foreground">{text}</div>; }

// Master dispatcher
export function ViewRenderer({ step, fill }) {
  if (!step) return <EmptyView text="Press Run to begin" />;
  switch (step.view) {
    case 'bar': return <BarView step={step} fill={fill} />;
    case 'tree': return <TreeView step={step} />;
    case 'graph': return <GraphView step={step} />;
    case 'list': return <ListView step={step} />;
    case 'stack': return <StackView step={step} />;
    case 'queue': return <QueueView step={step} />;
    case 'table': return <TableView step={step} />;
    case 'string': return <StringView step={step} />;
    case 'grid': return <GridView step={step} />;
    case 'hanoi': return <HanoiView step={step} />;
    case 'buckets': return <BucketsView step={step} />;
    case 'greedy': return <GreedyView step={step} />;
    case 'pathgrid': return <PathGridView step={step} />;
    default: return <BarView step={step} />;
  }
}