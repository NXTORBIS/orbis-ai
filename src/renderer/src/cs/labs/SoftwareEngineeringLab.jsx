import React, { useState } from 'react';
import { GitBranch, GitCommit, GitMerge, Plus, RotateCcw } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// Git branch visualizer — commit graph with branches, merges, and a workflow simulator.
export default function SoftwareEngineeringLab() {
  const [commits, setCommits] = useState(() => initialCommits());
  const [branch, setBranch] = useState('main');
  const [msg, setMsg] = useState('');

  const branches = [...new Set(commits.map((c) => c.branch))];
  const branchIdx = Object.fromEntries(branches.map((b, i) => [b, i]));

  const commit = () => {
    if (!msg.trim()) return;
    const id = `c${commits.length + 1}`;
    const parent = commits.filter((c) => c.branch === branch).slice(-1)[0]?.id || null;
    setCommits((c) => [...c, { id, branch, message: msg, parent, merge: false }]);
    setMsg('');
  };

  const newBranch = () => {
    const name = prompt('Branch name:', 'feature-x');
    if (!name) return;
    const parent = commits.filter((c) => c.branch === branch).slice(-1)[0]?.id || null;
    setCommits((c) => [...c, { id: `c${c.length + 1}`, branch: name, message: `branch ${name}`, parent, merge: false }]);
    setBranch(name);
  };

  const merge = () => {
    const target = prompt(`Merge "${branch}" into which branch?`, 'main');
    if (!target || !branches.includes(target)) return;
    const lastOnTarget = commits.filter((c) => c.branch === target).slice(-1)[0];
    const lastOnBranch = commits.filter((c) => c.branch === branch).slice(-1)[0];
    setCommits((c) => [...c, { id: `c${c.length + 1}`, branch: target, message: `merge ${branch}`, parent: lastOnTarget?.id, mergeParent: lastOnBranch?.id, merge: true }]);
  };

  const reset = () => { setCommits(initialCommits()); setBranch('main'); };

  // Layout: assign x by branch, y by commit order
  const layout = commits.map((c, i) => ({ ...c, x: branchIdx[c.branch], y: i }));

  return (
    <LabShell icon={GitBranch} title="Software Engineering" description="Git branch visualizer — create commits, branch off, merge back, and watch the commit graph grow.">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold">Current:</span>
            <span className="rounded-full bg-cyan-j/15 px-2 py-0.5 text-xs font-mono-j text-cyan-j">{branch}</span>
          </div>
          <div className="relative h-96 overflow-y-auto scrollbar-thin">
            <svg className="absolute inset-0 w-full" style={{ height: Math.max(384, commits.length * 44) }} preserveAspectRatio="none">
              {layout.map((c, i) => {
                const cx = 40 + c.x * 60;
                const cy = 20 + i * 44;
                const parent = c.parent ? layout.find((l) => l.id === c.parent) : null;
                const lines = [];
                if (parent) {
                  const px = 40 + parent.x * 60, py = 20 + (i - 1) * 44;
                  lines.push(<line key={`p${i}`} x1={px} y1={py} x2={cx} y2={cy} stroke="hsl(189 100% 50% / 0.4)" strokeWidth={2} />);
                }
                if (c.mergeParent) {
                  const mp = layout.find((l) => l.id === c.mergeParent);
                  if (mp) { const mx = 40 + mp.x * 60, my = 20 + (commits.indexOf(mp)) * 44; lines.push(<path key={`m${i}`} d={`M ${mx} ${my} C ${mx} ${cy}, ${cx} ${my}, ${cx} ${cy}`} fill="none" stroke="hsl(38 100% 50% / 0.5)" strokeWidth={2} />); }
                }
                return <g key={c.id}>{lines}</g>;
              })}
            </svg>
            <div className="relative" style={{ height: Math.max(384, commits.length * 44) }}>
              {layout.map((c, i) => {
                const cx = 40 + c.x * 60;
                const cy = 20 + i * 44;
                return (
                  <div key={c.id} className="absolute flex items-center gap-2" style={{ left: `${cx + 16}px`, top: `${cy - 10}px` }}>
                    <div className={`grid size-5 place-items-center rounded-full ${c.merge ? 'bg-amber-500' : 'bg-cyan-j'}`}>
                      <GitCommit className="size-3 text-background" />
                    </div>
                    <span className="font-mono-j text-[11px] text-foreground/80">{c.id}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-48">{c.message}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 text-xs font-semibold">New Commit</div>
            <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} placeholder="commit message"
              className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono-j text-xs" />
            <button onClick={commit} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background hover:bg-cyan-j/90"><Plus className="size-3.5" /> Commit</button>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={newBranch} className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-cyan-j/40"><GitBranch className="size-3.5" /> New Branch</button>
            <button onClick={merge} className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-cyan-j/40"><GitMerge className="size-3.5" /> Merge Branch</button>
            <button onClick={reset} className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-cyan-j/40"><RotateCcw className="size-3.5" /> Reset</button>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[10px] font-semibold text-muted-foreground">BRANCHES</div>
            <div className="mt-1.5 space-y-1">
              {branches.map((b) => (
                <button key={b} onClick={() => setBranch(b)} className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs ${b === branch ? 'bg-cyan-j/10 text-cyan-j' : 'text-muted-foreground hover:bg-accent'}`}>
                  <GitBranch className="size-3" /> {b}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </LabShell>
  );
}

function initialCommits() {
  return [
    { id: 'c1', branch: 'main', message: 'initial commit', parent: null },
    { id: 'c2', branch: 'main', message: 'add README', parent: 'c1' },
    { id: 'c3', branch: 'feature', message: 'branch feature', parent: 'c2' },
    { id: 'c4', branch: 'feature', message: 'add feature', parent: 'c3' },
    { id: 'c5', branch: 'main', message: 'merge feature', parent: 'c2', mergeParent: 'c4', merge: true },
  ];
}