import React, { useState } from 'react';
import { FolderKanban, Plus, Trash2, GripVertical, Check } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// Kanban project board — add tasks, drag between columns (To Do / In Progress / Review / Done).
const COLUMNS = [
  { id: 'todo', label: 'To Do', color: 'text-muted-foreground' },
  { id: 'progress', label: 'In Progress', color: 'text-cyan-j' },
  { id: 'review', label: 'Review', color: 'text-amber-400' },
  { id: 'done', label: 'Done', color: 'text-emerald-400' },
];

const INITIAL = [
  { id: 1, title: 'Setup CI/CD', col: 'todo', tags: ['devops'] },
  { id: 2, title: 'Implement auth', col: 'progress', tags: ['backend'] },
  { id: 3, title: 'Design landing page', col: 'review', tags: ['design'] },
  { id: 4, title: 'Write unit tests', col: 'done', tags: ['testing'] },
];

export default function ProjectsLab() {
  const [tasks, setTasks] = useState(INITIAL);
  const [dragId, setDragId] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [newCol, setNewCol] = useState('todo');

  const addTask = () => {
    if (!newTitle.trim()) return;
    setTasks((t) => [...t, { id: Date.now(), title: newTitle, col: newCol, tags: [] }]);
    setNewTitle('');
  };

  const moveTask = (id, col) => {
    setTasks((ts) => ts.map((t) => t.id === id ? { ...t, col } : t));
  };

  const deleteTask = (id) => setTasks((ts) => ts.filter((t) => t.id !== id));

  return (
    <LabShell icon={FolderKanban} title="Projects" description="Kanban project board — add tasks, drag between columns, track progress from To Do to Done.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask()} placeholder="New task…"
            className="flex-1 min-w-40 rounded border border-border bg-background px-3 py-1.5 text-sm focus:border-cyan-j focus:outline-none" />
          <select value={newCol} onChange={(e) => setNewCol(e.target.value)} className="rounded border border-border bg-background px-2 py-1.5 text-xs">
            {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button onClick={addTask} className="flex items-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background hover:bg-cyan-j/90"><Plus className="size-3.5" /> Add</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.col === col.id);
            return (
              <div key={col.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragId) moveTask(dragId, col.id); }}
                className="flex flex-col rounded-lg border border-border bg-card/50 min-h-48">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className={`text-xs font-semibold ${col.color}`}>{col.label}</span>
                  <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{colTasks.length}</span>
                </div>
                <div className="flex-1 space-y-2 p-2">
                  {colTasks.map((t) => (
                    <div key={t.id} draggable onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)}
                      className="group cursor-grab rounded-md border border-border bg-card p-2.5 transition hover:border-cyan-j/40 active:cursor-grabbing">
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="mt-0.5 size-3 shrink-0 text-muted-foreground/50" />
                        <span className="flex-1 text-xs">{t.title}</span>
                        <button onClick={() => deleteTask(t.id)} aria-label="Delete this task" title="Delete this task" className="text-muted-foreground opacity-0 transition hover:text-red-400 group-hover:opacity-100"><Trash2 className="size-3" /></button>
                      </div>
                      {t.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1 pl-4">
                          {t.tags.map((tag) => <span key={tag} className="rounded bg-cyan-j/10 px-1.5 py-0.5 text-[9px] text-cyan-j">{tag}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                  {colTasks.length === 0 && <div className="py-4 text-center text-[11px] text-muted-foreground/50">Drop tasks here</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-xs font-semibold">Progress</div>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            {COLUMNS.map((col) => {
              const pct = tasks.length ? (tasks.filter((t) => t.col === col.id).length / tasks.length) * 100 : 0;
              const bg = col.id === 'done' ? 'bg-emerald-500' : col.id === 'review' ? 'bg-amber-500' : col.id === 'progress' ? 'bg-cyan-j' : 'bg-muted-foreground/30';
              return <div key={col.id} className={bg} style={{ width: `${pct}%` }} />;
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
            <span>{tasks.length} total</span>
            <span className="text-emerald-400">{tasks.filter((t) => t.col === 'done').length} done ({tasks.length ? Math.round(tasks.filter((t) => t.col === 'done').length / tasks.length * 100) : 0}%)</span>
          </div>
        </div>
      </div>
    </LabShell>
  );
}