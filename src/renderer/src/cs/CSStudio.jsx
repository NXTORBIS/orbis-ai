import React from 'react';
import { NavLink, Outlet, useLocation } from './ui/router.jsx';
import {
  LayoutDashboard, BookOpen, Code2, CalendarDays, Trophy, Terminal, Workflow, Cpu,
  Network, Database, Binary, GitMerge, Sigma, ShieldCheck, Brain, BarChart3, Boxes,
  MonitorPlay, Share2, GitBranch, FolderKanban, Play, Award, TrendingUp, ChevronLeft,
} from 'lucide-react';

// Top-level sections with real routes; laboratory sections route to the Labs hub
// until their dedicated interactive pages are built.
const SECTIONS = [
  { label: 'Overview', to: '/cs', icon: LayoutDashboard, end: true },
  { label: 'Learn', to: '/cs/learn', icon: BookOpen },
  { label: 'Problems', to: '/cs/problems', icon: Code2 },
  { label: 'Daily Challenge', to: '/cs/daily', icon: CalendarDays },
  { label: 'Contests', to: '/cs/contests', icon: Trophy },
  { label: 'Programming & Development', to: '/cs/playground', icon: Terminal },
  { label: 'Algorithms & DSA', to: '/algorithm-lab', icon: Workflow },
  { label: 'Computer Architecture', to: '/cs/architecture', icon: Cpu },
  { label: 'Operating Systems', to: '/cs/os', icon: Terminal },
  { label: 'Computer Networks', to: '/cs/networks', icon: Network },
  { label: 'Databases', to: '/cs/databases', icon: Database },
  { label: 'Digital Logic', to: '/digital-logic-lab', icon: Binary },
  { label: 'Compiler Design', to: '/cs/compilers', icon: GitMerge },
  { label: 'Theory of Computation', to: '/cs/theory', icon: Sigma },
  { label: 'Cybersecurity', to: '/cs/cybersecurity', icon: ShieldCheck },
  { label: 'AI & Machine Learning', to: '/cs/ai-ml', icon: Brain },
  { label: 'Data Science', to: '/cs/data-science', icon: BarChart3 },
  { label: 'Computer Graphics', to: '/cs/graphics', icon: MonitorPlay },
  { label: 'Distributed Systems', to: '/cs/distributed', icon: Share2 },
  { label: 'Software Engineering', to: '/cs/software-engineering', icon: GitBranch },
  { label: 'Projects', to: '/cs/projects', icon: FolderKanban },
  { label: 'Playground', to: '/cs/playground', icon: Play },
  { label: 'Achievements', to: '/cs/progress', icon: Award },
  { label: 'Progress', to: '/cs/progress', icon: TrendingUp },
];

export default function CSStudio() {
  const location = useLocation();
  const onSubpage = location.pathname !== '/cs';

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      {/* Sidebar nav */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/50 md:flex">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="grid size-8 place-items-center rounded-lg bg-cyan-j/15 text-cyan-j">
            <Boxes className="size-5" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-sm font-semibold">Computer Science</div>
            <div className="text-[10px] text-muted-foreground">Studio</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto scrollbar-thin py-2">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.label}
              to={s.to}
              end={s.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-4 py-2 text-xs font-medium transition ${
                  isActive ? 'bg-cyan-j/10 text-cyan-j' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`
              }
            >
              <s.icon className="size-4 shrink-0" />
              <span className="flex-1 truncate">{s.label}</span>
              {s.soon && <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">soon</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Mobile top tabs */}
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-card/50 px-3 py-2 scrollbar-thin md:hidden">
          {SECTIONS.filter((s) => !s.lab).map((s) => (
            <NavLink key={s.label} to={s.to} end={s.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${isActive ? 'bg-cyan-j/10 text-cyan-j' : 'text-muted-foreground'}`
              }>
              {s.label}
            </NavLink>
          ))}
        </div>
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}