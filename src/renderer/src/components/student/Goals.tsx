import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Clock, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { onDay, spell, type Call } from './useStudent'
import type { Goal, StudentTask } from '../../../../shared/student/types'
import type { NoticeKind } from '../../lib/notices'

/**
 * Goals and tasks.
 *
 * A goal holds milestones, a milestone holds tasks, and progress is counted from finished tasks upward. Nothing here
 * reads a clock to work out how far along something is -- two hours in front of a chapter you did not finish is not
 * progress on it, and a bar that said otherwise would be flattering and useless.
 *
 * Deadlines are optional and shown as a count of what is left, never as a countdown. "Eight tasks before Friday" is
 * something a student can act on. A ticking clock to an exam is something they already have.
 */

type Editing = { goal: Partial<Goal> & { milestoneText: string } } | null

export default function Goals({
  call,
  onNotify,
  onStart,
  onOpenOrion
}: {
  call: Call
  onNotify(message: string, kind?: NoticeKind): void
  onStart(taskId: string | null, subject: string | null): void
  onOpenOrion?(prompt: string): void
}): React.JSX.Element {
  const [goals, setGoals] = useState<Goal[]>([])
  const [tasks, setTasks] = useState<StudentTask[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [newTask, setNewTask] = useState('')
  const [due, setDue] = useState('')
  const [estimate, setEstimate] = useState('')
  const [hours, setHours] = useState('2')
  const [plan, setPlan] = useState<{ kind: string; minutes: number; title: string; taskId: string | null }[] | null>(null)
  const [accuracy, setAccuracy] = useState<{ ratio: number; from: number } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const [g, t, a] = await Promise.all([call<Goal[]>('goals'), call<StudentTask[]>('queue', {}), call<{ ratio: number; from: number } | null>('estimate-accuracy')])
    setGoals(Array.isArray(g) ? g : [])
    setTasks(Array.isArray(t) ? t : [])
    setAccuracy(a ?? null)
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  const goal = useMemo(() => goals.find((one) => one.id === chosen) ?? null, [goals, chosen])
  const goalTasks = useMemo(() => tasks.filter((one) => one.goalId === chosen), [tasks, chosen])

  const saveGoal = async (): Promise<void> => {
    if (!editing) return
    const milestones = editing.goal.milestoneText
      .split('\n')
      .map((one) => one.trim())
      .filter(Boolean)
      .map((title, index) => {
        const before = editing.goal.milestones?.[index]
        return { id: before?.id, title, stage: before?.stage ?? '', targetDate: before?.targetDate ?? null, taskIds: before?.taskIds ?? [], order: index }
      })
    const out = await call<Goal>('save-goal', { ...editing.goal, milestones })
    setEditing(null)
    await load()
    if (out?.id) setChosen(out.id)
    onNotify('Goal saved.')
  }

  const addTask = async (): Promise<void> => {
    const title = newTask.trim()
    if (!title) return
    await call('save-task', {
      title,
      subject: goal?.subject ?? null,
      goalId: goal?.id ?? null,
      milestoneId: goal?.milestones.find((one) => one.completedAt === null)?.id ?? null,
      due: due ? new Date(`${due}T12:00`).getTime() : null,
      estimate: estimate ? Number(estimate) : null
    })
    setNewTask('')
    setDue('')
    setEstimate('')
    await load()
  }

  const complete = async (task: StudentTask): Promise<void> => {
    const out = await call<{ ok: boolean; xp: number }>('complete-task', task.id)
    await load()
    if (out?.ok) onNotify(`${task.title} done${out.xp > 0 ? ` · +${out.xp} XP` : ''}`)
  }

  const makePlan = async (): Promise<void> => {
    const minutes = Math.round(Number(hours) * 60)
    const out = await call<typeof plan>('plan-time', minutes, {})
    setPlan(Array.isArray(out) ? out : [])
  }

  return (
    <div className="st-goals-page">
      <header className="st-section-head">
        <div>
          <h2>Goals</h2>
          <p className="st-faint">
            {goals.filter((one) => one.state === 'active').length} active · {tasks.length} in the queue
          </p>
        </div>
        <button
          type="button"
          className="st-btn primary"
          onClick={() => setEditing({ goal: { title: '', why: '', horizon: 'long-term', subject: '', deadline: null, milestones: [], milestoneText: '' } })}
        >
          <Plus size={15} aria-hidden /> New goal
        </button>
      </header>

      <div className="st-split">
        <div className="st-split-list">
          {goals.length === 0 ? (
            <p className="st-empty">Start with one thing you want to accomplish.</p>
          ) : (
            <ul className="st-goal-list">
              {goals.map((one) => {
                const done = one.milestones.filter((m) => m.completedAt !== null).length
                return (
                  <li key={one.id}>
                    <button type="button" className={`st-goal-row${chosen === one.id ? ' on' : ''}`} aria-pressed={chosen === one.id} onClick={() => setChosen(one.id)}>
                      <span className="st-goal-name">
                        {one.title}
                        {one.state === 'completed' ? <Check size={13} aria-hidden /> : null}
                      </span>
                      <span className="st-faint">
                        {one.milestones.length > 0 ? `${done} of ${one.milestones.length} milestones` : 'No milestones'}
                        {one.deadline !== null ? ` · ${onDay(one.deadline)}` : ''}
                      </span>
                      <ChevronRight size={14} aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="st-plan">
            <h4>
              <Clock size={14} aria-hidden /> I have time
            </h4>
            <div className="st-plan-row">
              <input type="number" min={0.5} max={10} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours available" />
              <span className="st-faint">hours</span>
              <button type="button" className="st-btn" onClick={() => void makePlan()}>
                Suggest a plan
              </button>
            </div>
            {plan ? (
              plan.length === 0 ? (
                <p className="st-faint">Add a task or two and Orbis can lay out the time.</p>
              ) : (
                <ol className="st-plan-list">
                  {plan.map((one, index) => (
                    <li key={index} className={one.kind}>
                      <span>{one.minutes}m</span>
                      <strong>{one.title}</strong>
                      {one.kind === 'focus' ? (
                        <button type="button" className="st-link" onClick={() => onStart(one.taskId, null)}>
                          Start
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )
            ) : null}
            {plan ? <p className="st-faint small">Nothing starts until you press Start.</p> : null}
          </div>
        </div>

        <div className="st-split-detail">
          {!goal ? (
            <div className="st-detail-empty">
              <h3>Your tasks</h3>
              {tasks.length === 0 ? (
                <p className="st-empty">Nothing queued yet.</p>
              ) : (
                <ul className="st-task-list">
                  {tasks.map((one) => (
                    <li key={one.id}>
                      <button type="button" className="st-task-check" onClick={() => void complete(one)} aria-label={`Mark ${one.title} done`}>
                        <Check size={13} aria-hidden />
                      </button>
                      <span className="st-task-title">{one.title}</span>
                      {one.subject ? <span className="st-faint">{one.subject}</span> : null}
                      {one.estimate !== null ? <span className="st-faint">{one.estimate}m</span> : null}
                      {one.due !== null ? <span className={`st-task-due${one.due < Date.now() ? ' late' : ''}`}>{onDay(one.due)}</span> : null}
                      <button type="button" className="st-link" onClick={() => onStart(one.id, one.subject)}>
                        Focus
                      </button>
                      <button type="button" className="st-icon" onClick={() => void call('remove-task', one.id).then(() => void load())} aria-label={`Remove ${one.title}`}>
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="st-add-task">
                <input value={newTask} onChange={(e) => setNewTask(e.target.value.slice(0, 300))} placeholder="Add a task" aria-label="New task" onKeyDown={(e) => e.key === 'Enter' && void addTask()} />
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
                <input type="number" min={5} max={600} step={5} value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="min" aria-label="Estimated minutes" />
                <button type="button" className="st-btn" onClick={() => void addTask()}>
                  Add
                </button>
              </div>
              {accuracy ? (
                <p className="st-faint small">
                  {/* A fact about the estimates, with the sample size attached. */}
                  Your last {accuracy.from} finished tasks took about {Math.round(accuracy.ratio * 100)}% of what you estimated.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="st-goal-detail">
              <header>
                <div>
                  <h3>{goal.title}</h3>
                  {goal.why ? <p className="st-faint">{goal.why}</p> : null}
                </div>
                <div className="st-detail-actions">
                  <button
                    type="button"
                    className="st-btn"
                    onClick={() =>
                      setEditing({ goal: { ...goal, milestoneText: goal.milestones.map((one) => one.title).join('\n') } })
                    }
                  >
                    Edit
                  </button>
                  {onOpenOrion ? (
                    <button
                      type="button"
                      className="st-btn"
                      onClick={() =>
                        onOpenOrion(
                          `Break this study goal into milestones and tasks I can tick off: "${goal.title}"${goal.subject ? ` in ${goal.subject}` : ''}${goal.deadline ? `, by ${new Date(goal.deadline).toDateString()}` : ''}. Give a short list, nothing else.`
                        )
                      }
                    >
                      <Sparkles size={14} aria-hidden /> Break it down
                    </button>
                  ) : null}
                  <button type="button" className="st-icon" onClick={() => void call('remove-goal', goal.id).then(() => (setChosen(null), load()))} aria-label="Remove goal">
                    <Trash2 size={15} aria-hidden />
                  </button>
                </div>
              </header>

              {goal.milestones.length > 0 ? (
                <ol className="st-journey">
                  {[...goal.milestones]
                    .sort((a, b) => a.order - b.order)
                    .map((one) => {
                      const mine = goalTasks.filter((t) => one.taskIds.includes(t.id) || t.milestoneId === one.id)
                      const done = mine.filter((t) => t.state === 'completed').length
                      return (
                        <li key={one.id} className={one.completedAt !== null ? 'done' : ''}>
                          <span className="st-journey-dot" aria-hidden />
                          <div>
                            <strong>{one.title}</strong>
                            <span className="st-faint">
                              {one.stage ? `${one.stage} · ` : ''}
                              {mine.length > 0 ? `${done} of ${mine.length} tasks` : 'No tasks linked yet'}
                              {one.completedAt !== null ? ` · done ${onDay(one.completedAt)}` : ''}
                            </span>
                          </div>
                        </li>
                      )
                    })}
                </ol>
              ) : (
                <p className="st-faint">No milestones yet. Edit the goal to add a few stages.</p>
              )}

              <h4>Tasks</h4>
              {goalTasks.length === 0 ? (
                <p className="st-empty">Nothing linked to this goal yet.</p>
              ) : (
                <ul className="st-task-list">
                  {goalTasks.map((one) => (
                    <li key={one.id}>
                      <button type="button" className="st-task-check" onClick={() => void complete(one)} aria-label={`Mark ${one.title} done`}>
                        <Check size={13} aria-hidden />
                      </button>
                      <span className="st-task-title">{one.title}</span>
                      {one.estimate !== null ? (
                        <span className="st-faint">
                          est {one.estimate}m{one.actual > 0 ? ` · took ${spell(one.actual * 60)}` : ''}
                        </span>
                      ) : null}
                      <button type="button" className="st-link" onClick={() => onStart(one.id, one.subject)}>
                        Focus
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="st-add-task">
                <input value={newTask} onChange={(e) => setNewTask(e.target.value.slice(0, 300))} placeholder="Add a task to this goal" aria-label="New task for this goal" onKeyDown={(e) => e.key === 'Enter' && void addTask()} />
                <button type="button" className="st-btn" onClick={() => void addTask()}>
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {editing ? (
        <div className="st-sheet" role="dialog" aria-label="Goal">
          <div className="st-sheet-card">
            <header className="st-sheet-head">
              <h3>{editing.goal.id ? 'Edit goal' : 'New goal'}</h3>
              <button type="button" className="st-icon" onClick={() => setEditing(null)} aria-label="Close">
                <X size={16} aria-hidden />
              </button>
            </header>
            <label className="st-field">
              <span>What are you working toward?</span>
              <input value={editing.goal.title ?? ''} onChange={(e) => setEditing({ goal: { ...editing.goal, title: e.target.value.slice(0, 200) } })} placeholder="Physics for the boards" autoFocus />
            </label>
            <label className="st-field">
              <span>Why does it matter?</span>
              <input value={editing.goal.why ?? ''} onChange={(e) => setEditing({ goal: { ...editing.goal, why: e.target.value.slice(0, 500) } })} placeholder="I want to actually understand it" />
            </label>
            <div className="st-row">
              <label className="st-field">
                <span>Subject</span>
                <input value={editing.goal.subject ?? ''} onChange={(e) => setEditing({ goal: { ...editing.goal, subject: e.target.value.slice(0, 80) } })} placeholder="Physics" />
              </label>
              <label className="st-field">
                <span>Date to aim for</span>
                <input
                  type="date"
                  value={editing.goal.deadline ? new Date(editing.goal.deadline).toISOString().slice(0, 10) : ''}
                  onChange={(e) => setEditing({ goal: { ...editing.goal, deadline: e.target.value ? new Date(`${e.target.value}T12:00`).getTime() : null } })}
                />
                <small>Optional. Orbis will not count down at you.</small>
              </label>
            </div>
            <label className="st-field">
              <span>Stages</span>
              <textarea
                value={editing.goal.milestoneText}
                onChange={(e) => setEditing({ goal: { ...editing.goal, milestoneText: e.target.value } })}
                rows={6}
                placeholder={'Foundations\nConcepts\nPractice\nRevision'}
              />
              <small>One per line, in order. A stage is finished when every task on it is.</small>
            </label>
            <div className="st-sheet-foot">
              <button type="button" className="st-btn quiet" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="st-btn primary" disabled={!editing.goal.title?.trim()} onClick={() => void saveGoal()}>
                Save goal
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
