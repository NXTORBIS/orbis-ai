import React, { useState, useEffect, useRef } from 'react';
import { Share2, Play, Pause, RotateCcw, Server } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// Distributed consensus: leader election (Bully algorithm) + Raft-style heartbeats.
// Watch nodes elect a leader and handle failures.
const COLORS = ['hsl(189 100% 50%)', 'hsl(142 70% 45%)', 'hsl(38 100% 50%)', 'hsl(280 70% 60%)', 'hsl(0 70% 55%)'];

export default function DistributedLab() {
  const [nodes, setNodes] = useState([
    { id: 1, alive: true, role: 'follower', term: 0 },
    { id: 2, alive: true, role: 'follower', term: 0 },
    { id: 3, alive: true, role: 'follower', term: 0 },
    { id: 4, alive: true, role: 'follower', term: 0 },
    { id: 5, alive: true, role: 'follower', term: 0 },
  ]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [leader, setLeader] = useState(null);
  const [tick, setTick] = useState(0);
  const timerRef = useRef(null);

  const log = (msg) => setLogs((l) => [...l.slice(-12), `t${tick}: ${msg}`]);

  const electLeader = (ns) => {
    const alive = ns.filter((n) => n.alive);
    if (!alive.length) return { ns, leader: null };
    alive.sort((a, b) => b.id - a.id);
    const newLeader = alive[0].id;
    const newTerm = Math.max(...ns.map((n) => n.term)) + 1;
    return { ns: ns.map((n) => n.alive ? { ...n, role: n.id === newLeader ? 'leader' : 'follower', term: newTerm } : n), leader: newLeader };
  };

  const startElection = () => {
    setNodes((ns) => {
      const { ns: next, leader: ld } = electLeader(ns);
      log(`Election started — leader elected: Node ${ld}`);
      setLeader(ld);
      return next;
    });
  };

  const toggleNode = (id) => {
    setNodes((ns) => {
      const next = ns.map((n) => n.id === id ? { ...n, alive: !n.alive, role: 'follower' } : n);
      if (leader === id) {
        log(`Node ${id} (leader) crashed! Re-election triggered.`);
        const { ns: r, leader: ld } = electLeader(next);
        setLeader(ld);
        log(ld ? `New leader: Node ${ld}` : 'No nodes alive — no leader.');
        return r;
      }
      log(`Node ${id} ${next.find((n) => n.id === id).alive ? 'recovered' : 'crashed'}.`);
      return next;
    });
  };

  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => {
        setTick((t) => t + 1);
        setNodes((ns) => {
          const alive = ns.filter((n) => n.alive);
          if (!alive.length) return ns;
          // Random heartbeat / election timeout
          if (Math.random() < 0.15) {
            const { ns: next, leader: ld } = electLeader(ns);
            if (ld !== leader) { log(`Heartbeat timeout — new election. Leader: Node ${ld}`); setLeader(ld); }
            return next;
          }
          return ns;
        });
      }, 1500);
    }
    return () => clearInterval(timerRef.current);
  }, [running, leader]);

  const reset = () => {
    setNodes(nodes.map((n) => ({ ...n, alive: true, role: 'follower', term: 0 })));
    setLeader(null); setLogs([]); setTick(0); setRunning(false);
  };

  return (
    <LabShell icon={Share2} title="Distributed Systems" description="Leader election & consensus — elect a leader, crash nodes, watch the system re-elect automatically.">
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex items-center justify-center gap-4 flex-wrap">
              {nodes.map((n, i) => (
                <div key={n.id} className="flex flex-col items-center gap-2">
                  <button onClick={() => toggleNode(n.id)} disabled={false}
                    className={`relative grid size-20 place-items-center rounded-full border-2 transition ${
                      !n.alive ? 'border-red-500/30 bg-red-500/5 opacity-40' :
                      n.role === 'leader' ? 'border-cyan-j bg-cyan-j/20 orb-glow' : 'border-border bg-card hover:border-cyan-j/40'
                    }`}>
                    <Server className={`size-7 ${n.alive ? '' : 'text-red-400'}`} style={{ color: n.alive ? COLORS[i] : undefined }} />
                    <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-background text-[10px] font-bold">{n.id}</span>
                    {n.role === 'leader' && <span className="absolute -bottom-6 text-[10px] font-semibold text-cyan-j">LEADER</span>}
                  </button>
                  <div className="text-[10px] text-muted-foreground">{n.alive ? `term ${n.term}` : 'down'}</div>
                </div>
              ))}
            </div>
            <div className="mt-8 flex justify-center gap-2">
              <button onClick={startElection} className="flex items-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background hover:bg-cyan-j/90"><Play className="size-3.5" /> Start Election</button>
              <button onClick={() => setRunning(!running)} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-cyan-j/40">{running ? <><Pause className="size-3.5" /> Pause</> : <><Play className="size-3.5" /> Auto</>}</button>
              <button onClick={reset} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-cyan-j/40"><RotateCcw className="size-3.5" /> Reset</button>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 text-xs font-semibold">Event Log</div>
            <div className="h-40 overflow-y-auto scrollbar-thin space-y-0.5 font-mono-j text-[11px]">
              {logs.length === 0 ? <div className="text-muted-foreground">No events yet. Start an election or crash a node.</div> :
                logs.map((l, i) => <div key={i} className="text-foreground/80">{l}</div>)}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] font-semibold text-muted-foreground">CURRENT LEADER</div>
            <div className="mt-1 font-mono-j text-2xl font-bold text-cyan-j">{leader ? `Node ${leader}` : 'None'}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-xs">
            <div className="font-semibold">Bully Algorithm</div>
            <p className="mt-1 text-muted-foreground">The node with the highest ID among alive nodes becomes leader. If the leader crashes, remaining nodes detect the failure and start a new election.</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-xs">
            <div className="font-semibold">Try this</div>
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
              <li>Click "Start Election"</li>
              <li>Click the leader node to crash it</li>
              <li>Watch automatic re-election</li>
              <li>Click "Auto" for heartbeat timeouts</li>
            </ol>
          </div>
        </div>
      </div>
    </LabShell>
  );
}