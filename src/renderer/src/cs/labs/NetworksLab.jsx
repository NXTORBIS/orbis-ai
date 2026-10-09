import React, { useState, useRef } from 'react';
import { Network, Play, Radio, Router } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// Packet routing visualizer: a small network of routers.
// Click two nodes → simulate shortest-path routing with animated packet.
const NODES = [
  { id: 'A', x: 80, y: 80 }, { id: 'B', x: 280, y: 60 }, { id: 'C', x: 480, y: 100 },
  { id: 'D', x: 150, y: 220 }, { id: 'E', x: 360, y: 240 }, { id: 'F', x: 520, y: 280 },
];
const LINKS = [
  ['A', 'B', 4], ['A', 'D', 2], ['B', 'C', 3], ['B', 'E', 5],
  ['C', 'F', 2], ['D', 'E', 3], ['E', 'F', 4], ['B', 'D', 6], ['C', 'E', 1],
];

export default function NetworksLab() {
  const [src, setSrc] = useState('A');
  const [dst, setDst] = useState('F');
  const [path, setPath] = useState([]);
  const [hops, setHops] = useState([]);
  const [animating, setAnimating] = useState(false);
  const [cost, setCost] = useState(0);
  const svgRef = useRef(null);

  const adj = {};
  NODES.forEach((n) => (adj[n.id] = []));
  LINKS.forEach(([a, b, w]) => { adj[a].push({ to: b, w }); adj[b].push({ to: a, w }); });

  const dijkstra = (s, d) => {
    const dist = {}, prev = {};
    NODES.forEach((n) => { dist[n.id] = Infinity; prev[n.id] = null; });
    dist[s] = 0;
    const unvisited = new Set(NODES.map((n) => n.id));
    while (unvisited.size) {
      let u = null, min = Infinity;
      unvisited.forEach((id) => { if (dist[id] < min) { min = dist[id]; u = id; } });
      if (u === null || u === d) break;
      unvisited.delete(u);
      adj[u].forEach(({ to, w }) => {
        if (unvisited.has(to) && dist[u] + w < dist[to]) { dist[to] = dist[u] + w; prev[to] = u; }
      });
    }
    const p = [];
    let cur = d;
    while (cur) { p.unshift(cur); cur = prev[cur]; }
    return { path: p, cost: dist[d] };
  };

  const route = () => {
    if (src === dst) return;
    const { path: p, cost: c } = dijkstra(src, dst);
    setPath(p);
    setCost(c);
    setHops(p);
    setAnimating(true);
    setTimeout(() => setAnimating(false), p.length * 500 + 500);
  };

  const node = (id) => NODES.find((n) => n.id === id);
  const onPath = (a, b) => {
    for (let i = 0; i < path.length - 1; i++) {
      if ((path[i] === a && path[i + 1] === b) || (path[i] === b && path[i + 1] === a)) return true;
    }
    return false;
  };

  return (
    <LabShell icon={Network} title="Computer Networks" description="Packet routing simulator — pick source and destination, watch Dijkstra find the shortest path.">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="rounded-lg border border-border bg-card p-4">
          <svg ref={svgRef} viewBox="0 0 600 340" className="w-full">
            {LINKS.map(([a, b, w], i) => {
              const na = node(a), nb = node(b);
              const active = onPath(a, b);
              return (
                <g key={i}>
                  <line x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    stroke={active ? 'hsl(189 100% 50%)' : 'hsl(222 20% 30%)'}
                    strokeWidth={active ? 3 : 1.5} strokeDasharray={active ? '0' : '4'} />
                  <text x={(na.x + nb.x) / 2} y={(na.y + nb.y) / 2 - 4} textAnchor="middle" className="fill-muted-foreground text-[9px] font-mono-j">{w}</text>
                </g>
              );
            })}
            {NODES.map((n) => {
              const isSrc = n.id === src, isDst = n.id === dst, inPath = path.includes(n.id);
              return (
                <g key={n.id} onClick={() => { if (!src || (src && src !== n.id && !dst)) setSrc(n.id); else if (n.id !== src) setDst(n.id); }} className="cursor-pointer">
                  <circle cx={n.x} cy={n.y} r={isSrc || isDst ? 22 : 18}
                    fill={isSrc ? 'hsl(189 100% 50%)' : isDst ? 'hsl(142 70% 45%)' : inPath ? 'hsl(189 100% 50% / 0.2)' : 'hsl(222 30% 14%)'}
                    stroke={inPath ? 'hsl(189 100% 50%)' : 'hsl(222 20% 40%)'} strokeWidth={2} />
                  <text x={n.x} y={n.y + 4} textAnchor="middle" className="fill-foreground text-xs font-bold">{n.id}</text>
                  {isSrc && <text x={n.x} y={n.y - 30} textAnchor="middle" className="fill-cyan-j text-[8px] font-semibold">SRC</text>}
                  {isDst && <text x={n.x} y={n.y - 30} textAnchor="middle" className="fill-emerald-400 text-[8px] font-semibold">DST</text>}
                </g>
              );
            })}
            {animating && path.length > 1 && (
              <circle r={6} fill="hsl(38 100% 50%)" className="drop-shadow">
                <animateMotion dur={`${path.length * 0.5}s`} path={`M ${path.map((id) => `${node(id).x},${node(id).y}`).join(' L ')}`} />
              </circle>
            )}
          </svg>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-full bg-cyan-j" /> Source</span>
            <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-full bg-emerald-500" /> Destination</span>
            <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-full border-2 border-cyan-j" /> On path</span>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 text-xs font-semibold">Route</div>
            <div className="flex items-center gap-2 text-sm">
              <select value={src} onChange={(e) => setSrc(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 font-mono-j text-xs">
                {NODES.map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
              </select>
              <Radio className="size-4 text-cyan-j" />
              <select value={dst} onChange={(e) => setDst(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 font-mono-j text-xs">
                {NODES.map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
              </select>
            </div>
            <button onClick={route} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background hover:bg-cyan-j/90"><Play className="size-3.5" /> Route Packet</button>
          </div>
          {path.length > 0 && (
            <>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[10px] font-semibold text-muted-foreground">PATH ({path.length - 1} hops)</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1 font-mono-j text-xs">
                  {path.map((h, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <span className="rounded bg-cyan-j/10 px-1.5 py-0.5 text-cyan-j">{h}</span>
                      {i < path.length - 1 && <span className="text-muted-foreground">→</span>}
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-xs">Total cost: <span className="font-mono-j font-bold text-cyan-j">{cost}</span></div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[10px] font-semibold text-muted-foreground">ROUTING TABLE (from {src})</div>
                <div className="mt-1.5 space-y-0.5 font-mono-j text-[11px]">
                  {NODES.filter((n) => n.id !== src).map((n) => {
                    const r = dijkstra(src, n.id);
                    return <div key={n.id} className="flex justify-between"><span className="text-muted-foreground">→ {n.id}</span><span>via {r.path[1] || n.id} (cost {r.cost})</span></div>;
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </LabShell>
  );
}