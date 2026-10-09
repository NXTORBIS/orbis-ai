import React from 'react';
import { Link } from './ui/router.jsx';
import {
  Workflow, Binary, Cpu, Terminal, Network, Database, GitMerge, Sigma, ShieldCheck,
  Brain, BarChart3, MonitorPlay, Share2, GitBranch, Boxes, CheckCircle2, Clock, ArrowUpRight,
} from 'lucide-react';

const ICONS = { Workflow, Binary, Cpu, Terminal, Network, Database, GitMerge, Sigma, ShieldCheck, Brain, BarChart3, MonitorPlay, Share2, GitBranch, Boxes };

// Laboratories hub. Existing interactive labs link to their real pages; the rest are
// honestly marked "coming soon" until their dedicated interactive pages are built.
const LABS = [
  { id: 'algorithm', title: 'Algorithms & DSA', icon: 'Workflow', desc: 'Interactive visualizer for sorting, searching, graphs, DP and more.', to: '/algorithm-lab', available: true },
  { id: 'digital-logic', title: 'Digital Logic', icon: 'Binary', desc: 'Build and simulate logic gates, adders, flip-flops and counters.', to: '/digital-logic-lab', available: true },
  { id: 'electronics', title: 'Electronics', icon: 'Cpu', desc: 'Analog circuit design with a real MNA simulation engine.', to: '/electronics-lab', available: true },
  { id: 'architecture', title: 'Computer Architecture', icon: 'Cpu', desc: 'CPU, ALU, registers and the fetch-decode-execute cycle.', available: false },
  { id: 'os', title: 'Operating Systems', icon: 'Terminal', desc: 'CPU scheduling, paging, page replacement and deadlocks.', available: false },
  { id: 'networks', title: 'Computer Networks', icon: 'Network', desc: 'Build a network, route packets and inspect protocols.', available: false },
  { id: 'databases', title: 'Databases', icon: 'Database', desc: 'SQL editor with schema diagrams and query plans.', available: false },
  { id: 'compilers', title: 'Compiler Design', icon: 'GitMerge', desc: 'Lexing, parsing, AST and code generation pipeline.', available: false },
  { id: 'theory', title: 'Theory of Computation', icon: 'Sigma', desc: 'DFA/NFA, regular expressions and Turing machines.', available: false },
  { id: 'cybersecurity', title: 'Cybersecurity', icon: 'ShieldCheck', desc: 'Hashing, authentication and secure-coding concepts.', available: false },
  { id: 'ai-ml', title: 'AI & Machine Learning', icon: 'Brain', desc: 'Models, training and inference playgrounds.', available: false },
  { id: 'data-science', title: 'Data Science', icon: 'BarChart3', desc: 'Data wrangling, statistics and visualization.', available: false },
  { id: 'graphics', title: 'Computer Graphics', icon: 'MonitorPlay', desc: 'Transformations, projection, lighting and rasterization.', available: false },
  { id: 'distributed', title: 'Distributed Systems', icon: 'Share2', desc: 'Consensus, replication and fault tolerance.', available: false },
  { id: 'software-engineering', title: 'Software Engineering', icon: 'GitBranch', desc: 'Git workflows, testing and architecture design.', available: false },
];

export default function Labs() {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 md:p-6">
      <h1 className="font-display text-xl font-bold">Laboratories</h1>
      <p className="text-xs text-muted-foreground">Interactive Computer Science laboratories. Available labs run real simulations; others are on the roadmap.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LABS.map((lab) => {
          const Icon = ICONS[lab.icon] || Boxes;
          const inner = (
            <div className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition hover:border-cyan-j/40">
              <div className="mb-2 flex items-center gap-2">
                <div className={`grid size-9 place-items-center rounded-lg ${lab.available ? 'bg-cyan-j/10 text-cyan-j' : 'bg-muted text-muted-foreground'}`}><Icon className="size-5" /></div>
                <span className="text-[10px] text-muted-foreground">{lab.available ? 'Available' : 'Coming soon'}</span>
                {lab.available && <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />}
              </div>
              <div className="font-semibold">{lab.title}</div>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">{lab.desc}</p>
              <div className="mt-3 flex items-center gap-1.5 text-[11px]">
                {lab.available ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="size-3.5" /> Open lab</span>
                  : <span className="flex items-center gap-1 text-muted-foreground"><Clock className="size-3.5" /> On roadmap</span>}
              </div>
            </div>
          );
          return lab.available ? (
            <Link key={lab.id} to={lab.to} className="block">{inner}</Link>
          ) : (
            <div key={lab.id} className="opacity-70">{inner}</div>
          );
        })}
      </div>
    </div>
  );
}