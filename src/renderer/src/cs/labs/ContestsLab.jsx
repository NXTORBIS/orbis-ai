import React, { useState, useEffect } from 'react';
import { Trophy, Clock, Users, Play, Medal, Flame, Calendar } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// Contests hub — live countdown, upcoming/past contests, leaderboard, virtual join.
const CONTESTS = [
  { id: 'wk12', title: 'Weekly Challenge #12', status: 'live', endsIn: 5400, participants: 342, difficulty: 'Medium', problems: 4 },
  { id: 'algo', title: 'Algorithm Sprint', status: 'upcoming', startsIn: 7200, participants: 128, difficulty: 'Hard', problems: 5 },
  { id: 'ds', title: 'Data Structures Cup', status: 'upcoming', startsIn: 86400, participants: 89, difficulty: 'Easy', problems: 3 },
  { id: 'wk11', title: 'Weekly Challenge #11', status: 'ended', participants: 410, difficulty: 'Medium', problems: 4 },
  { id: 'bit', title: 'Bitwise Brawl', status: 'ended', participants: 256, difficulty: 'Hard', problems: 6 },
];

const LEADERBOARD = [
  { rank: 1, name: 'algoNinja', score: 1850, solved: 4, time: 2340 },
  { rank: 2, name: 'binaryQueen', score: 1620, solved: 4, time: 3120 },
  { rank: 3, name: 'stackOverflow', score: 1450, solved: 3, time: 2880 },
  { rank: 4, name: 'recursionGod', score: 1320, solved: 3, time: 3450 },
  { rank: 5, name: 'dpMaster', score: 1180, solved: 3, time: 4100 },
  { rank: 6, name: 'you', score: 980, solved: 2, time: 3600 },
  { rank: 7, name: 'graphWiz', score: 840, solved: 2, time: 4200 },
  { rank: 8, name: 'hashSling', score: 720, solved: 2, time: 4800 },
];

export default function ContestsLab() {
  const [now, setNow] = useState(Date.now());
  const [joined, setJoined] = useState(null);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const fmt = (s) => {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const live = CONTESTS.filter((c) => c.status === 'live');
  const upcoming = CONTESTS.filter((c) => c.status === 'upcoming');
  const ended = CONTESTS.filter((c) => c.status === 'ended');

  return (
    <LabShell icon={Trophy} title="Contests" description="Compete in timed coding challenges — join live contests, see countdowns, and climb the leaderboard.">
      <div className="flex flex-col gap-5">
        {/* Live */}
        {live.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-red-400"><Flame className="size-4" /> LIVE NOW</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {live.map((c) => (
                <div key={c.id} className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-400">● LIVE</span>
                    <span className="text-[10px] text-muted-foreground">{c.difficulty}</span>
                  </div>
                  <div className="mt-2 font-semibold">{c.title}</div>
                  <div className="mt-2 flex items-center gap-1.5 font-mono-j text-lg font-bold text-red-400"><Clock className="size-4" /> {fmt(c.endsIn - Math.floor((Date.now() - now) / 1000))}</div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="size-3" /> {c.participants}</span>
                    <span>{c.problems} problems</span>
                  </div>
                  <button onClick={() => setJoined(c.id)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background hover:bg-cyan-j/90">
                    {joined === c.id ? 'Joined ✓' : <><Play className="size-3.5" /> Join Contest</>}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cyan-j"><Calendar className="size-4" /> UPCOMING</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((c) => (
                <div key={c.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-cyan-j/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-j">Soon</span>
                    <span className="text-[10px] text-muted-foreground">{c.difficulty}</span>
                  </div>
                  <div className="mt-2 font-semibold">{c.title}</div>
                  <div className="mt-2 flex items-center gap-1.5 font-mono-j text-sm text-muted-foreground"><Clock className="size-3.5" /> starts in {fmt(c.startsIn - Math.floor((Date.now() - now) / 1000))}</div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="size-3" /> {c.participants} registered</span>
                    <span>{c.problems} problems</span>
                  </div>
                  <button onClick={() => setJoined(c.id)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-cyan-j/40">
                    {joined === c.id ? 'Registered ✓' : 'Register'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Leaderboard */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs font-semibold"><Medal className="size-4 text-amber-400" /> Leaderboard — Weekly #12</div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border bg-muted/30 text-[10px] text-muted-foreground">
                  <th className="px-3 py-1.5 text-left">#</th><th className="px-3 py-1.5 text-left">User</th><th className="px-3 py-1.5">Score</th><th className="px-3 py-1.5">Solved</th><th className="px-3 py-1.5">Time</th>
                </tr></thead>
                <tbody>
                  {LEADERBOARD.map((r) => (
                    <tr key={r.rank} className={`border-b border-border/50 ${r.name === 'you' ? 'bg-cyan-j/5' : ''}`}>
                      <td className="px-3 py-1.5">
                        <span className={`font-mono-j font-bold ${r.rank <= 3 ? 'text-amber-400' : 'text-muted-foreground'}`}>{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
                      </td>
                      <td className="px-3 py-1.5 font-medium">{r.name === 'you' ? <span className="text-cyan-j">{r.name}</span> : r.name}</td>
                      <td className="px-3 py-1.5 text-center font-mono-j">{r.score}</td>
                      <td className="px-3 py-1.5 text-center font-mono-j">{r.solved}/{CONTESTS[0].problems}</td>
                      <td className="px-3 py-1.5 text-center font-mono-j text-muted-foreground">{fmt(r.time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Past contests */}
          <div>
            <div className="mb-2 text-xs font-semibold text-muted-foreground">PAST CONTESTS</div>
            <div className="space-y-2">
              {ended.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3 opacity-80">
                  <div>
                    <div className="text-sm font-medium">{c.title}</div>
                    <div className="text-[11px] text-muted-foreground">{c.participants} participants · {c.problems} problems · {c.difficulty}</div>
                  </div>
                  <button className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-cyan-j/40 hover:text-cyan-j">View Results</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </LabShell>
  );
}