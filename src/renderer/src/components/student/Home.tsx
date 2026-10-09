import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Flame, GripVertical, Play, Sparkles, Trophy } from 'lucide-react'
import Orbi from './Orbi'
import NextBest from './NextBest'
import { atTime, clock, count, onDay, spell, type Call, type Catalogue } from './useStudent'
import type { LearningItem, StudentSnapshot, StudentTask } from '../../../../shared/student/types'
import type { NoticeKind } from '../../lib/notices'

/**
 * Today's Orbit: the Student home.
 *
 * A board of small parts rather than one long page, and the student decides the order. Two rules about what goes on
 * it:
 *
 *   - **Nothing here is a judgement.** Every number shown is something that was counted -- minutes, sessions, tasks,
 *     days. There is no score, and there is no comparison with anybody else, ever.
 *   - **An empty part says what to do, not that it is empty.** "Your first Focus session starts here" is useful;
 *     "No data" is a dead end, and the first week of using this is all empty states.
 */

export interface HomeProps {
  snapshot: StudentSnapshot
  catalogue: Catalogue | null
  call: Call
  onStart(): void
  /** Starting on one particular thing, which is what the suggestion at the top of the board does. */
  onStartOn(options: { subject: string | null; conceptId: string | null; minutes: number | null; title: string }): void
  onGo(where: 'focus' | 'plan' | 'learn' | 'mastery' | 'goals' | 'study' | 'progress' | 'orbi' | 'later' | 'settings'): void
  onOpenOrion?(prompt: string): void
  onNotify(message: string, kind?: NoticeKind): void
}

function Widget({ id, title, action, children, wide }: { id: string; title: string; action?: { label: string; onClick(): void }; children: React.ReactNode; wide?: boolean }): React.JSX.Element {
  return (
    <section className={`st-widget${wide ? ' wide' : ''}`} data-widget={id} aria-label={title}>
      <header>
        <h3>{title}</h3>
        {action ? (
          <button type="button" className="st-link" onClick={action.onClick}>
            {action.label} <ArrowRight size={13} aria-hidden />
          </button>
        ) : null}
      </header>
      <div className="st-widget-body">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="st-empty">{children}</p>
}

function greeting(name: string, hour: number): string {
  const part = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Late one'
  return name ? `${part}, ${name}` : part
}

export default function Home({ snapshot, catalogue, call, onStart, onStartOn, onGo, onNotify, onOpenOrion }: HomeProps): React.JSX.Element {
  const [learning, setLearning] = useState<{ word: LearningItem | null; mix: LearningItem[]; due: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const prefs = snapshot.preferences
  const focusStreak = snapshot.streaks.find((one) => one.kind === 'focus')
  const learnStreak = snapshot.streaks.find((one) => one.kind === 'learning')
  const primary = snapshot.goals[0] ?? null
  const hour = new Date().getHours()

  useEffect(() => {
    void call<typeof learning>('today-learning').then((one) => setLearning(one ?? null))
  }, [call])

  const order = useMemo(() => prefs.widgets.filter((one) => !prefs.hiddenWidgets.includes(one)), [prefs.widgets, prefs.hiddenWidgets])

  const move = async (from: string, to: string): Promise<void> => {
    if (from === to) return
    const next = [...order]
    const at = next.indexOf(from)
    const onto = next.indexOf(to)
    if (at < 0 || onto < 0) return
    next.splice(at, 1)
    next.splice(onto, 0, from)
    await call('save-settings', { widgets: next })
  }

  const completeTask = async (task: StudentTask): Promise<void> => {
    const out = await call<{ ok: boolean; xp: number }>('complete-task', task.id)
    if (out?.ok) onNotify(`${task.title} done${out.xp > 0 ? ` · +${out.xp} XP` : ''}`)
  }

  const widgets: Record<string, React.JSX.Element | null> = {
    today: (
      <Widget key="today" id="today" title="Today's Orbit" wide>
        <div className="st-orbit">
          <div className="st-orbit-main">
            {primary ? (
              <>
                <span className="st-faint">Working toward</span>
                <strong>{primary.title}</strong>
              </>
            ) : (
              <>
                <span className="st-faint">No goal yet</span>
                <button type="button" className="st-link" onClick={() => onGo('goals')}>
                  Set one thing you want to accomplish
                </button>
              </>
            )}
            <div className="st-orbit-numbers">
              <span>
                <strong>{spell(snapshot.today.focusedSeconds)}</strong> focused today
              </span>
              <span>
                <strong>{snapshot.today.sessions}</strong> {snapshot.today.sessions === 1 ? 'session' : 'sessions'}
              </span>
              <span>
                <strong>{count(snapshot.today.xp)}</strong> XP today
              </span>
            </div>
          </div>
          <button type="button" className="st-btn primary big" onClick={onStart}>
            <Play size={16} aria-hidden /> Start Focus
          </button>
        </div>
      </Widget>
    ),
    focus: (
      <Widget key="focus" id="focus" title="Focus" action={{ label: 'History', onClick: () => onGo('progress') }}>
        {snapshot.recommendation ? (
          <button type="button" className="st-suggest" onClick={onStart}>
            <span className="st-suggest-tag">
              <Sparkles size={12} aria-hidden /> Suggested
            </span>
            <strong>
              {snapshot.recommendation.subject ? `${snapshot.recommendation.subject} · ` : ''}
              {snapshot.recommendation.minutes} minutes
            </strong>
            <span className="st-faint">{snapshot.recommendation.because}</span>
          </button>
        ) : (
          <Empty>Your first Focus session starts here.</Empty>
        )}
      </Widget>
    ),
    quests: (
      <Widget key="quests" id="quests" title="Daily quests">
        <ul className="st-quests">
          {snapshot.quests
            .filter((one) => one.period === 'daily')
            .map((one) => (
              <li key={one.questId} className={one.completedAt !== null ? 'done' : ''}>
                <span className="st-quest-check" aria-hidden>
                  {one.completedAt !== null ? <Check size={13} /> : null}
                </span>
                <span className="st-quest-title">{one.title}</span>
                <span className="st-quest-count">
                  {Math.min(one.value, one.target)}/{one.target}
                </span>
              </li>
            ))}
        </ul>
      </Widget>
    ),
    tasks: (
      <Widget key="tasks" id="tasks" title="Up next" action={{ label: 'All tasks', onClick: () => onGo('goals') }}>
        {snapshot.queue.length === 0 ? (
          <Empty>Nothing queued. Add one thing you need to do.</Empty>
        ) : (
          <ul className="st-tasks">
            {snapshot.queue.slice(0, 5).map((one) => (
              <li key={one.id}>
                <button type="button" className="st-task-check" onClick={() => void completeTask(one)} aria-label={`Mark ${one.title} done`}>
                  <Check size={13} aria-hidden />
                </button>
                <span className="st-task-title">{one.title}</span>
                {one.due !== null ? <span className={`st-task-due${one.due < Date.now() ? ' late' : ''}`}>{onDay(one.due)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Widget>
    ),
    goals: (
      <Widget key="goals" id="goals" title="Goals" action={{ label: 'Open', onClick: () => onGo('goals') }}>
        {snapshot.goals.length === 0 ? (
          <Empty>Start with one thing you want to accomplish.</Empty>
        ) : (
          <ul className="st-goals">
            {snapshot.goals.slice(0, 4).map((one) => {
              const done = one.milestones.filter((m) => m.completedAt !== null).length
              return (
                <li key={one.id}>
                  <span>{one.title}</span>
                  <span className="st-faint">
                    {one.milestones.length > 0 ? `${done} of ${one.milestones.length} milestones` : 'No milestones yet'}
                  </span>
                  <div className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={one.milestones.length || 1} aria-valuenow={done} aria-label={one.title}>
                    <span style={{ width: `${one.milestones.length ? (done / one.milestones.length) * 100 : 0}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Widget>
    ),
    word: (
      <Widget key="word" id="word" title="Word of the day" action={{ label: 'Learn', onClick: () => onGo('learn') }}>
        {learning?.word ? (
          <div className="st-word">
            <strong>{learning.word.title}</strong>
            <span className="st-faint">
              {learning.word.body.pronunciation} · {learning.word.body.partOfSpeech}
            </span>
            <p>{learning.word.body.definition}</p>
          </div>
        ) : (
          <Empty>Nothing new today. Everything is in review.</Empty>
        )}
      </Widget>
    ),
    review: (
      <Widget key="review" id="review" title="Review today" action={{ label: 'Open', onClick: () => onGo('learn') }}>
        {snapshot.due === 0 ? <Empty>You&apos;re caught up.</Empty> : <p className="st-big">{snapshot.due} ready to come back round</p>}
      </Widget>
    ),
    streak: (
      <Widget key="streak" id="streak" title="Streaks">
        <div className="st-streaks">
          <span>
            <Flame size={15} aria-hidden /> <strong>{focusStreak?.current ?? 0}</strong> days studying
          </span>
          <span>
            <strong>{learnStreak?.current ?? 0}</strong> days learning
          </span>
          {(focusStreak?.longest ?? 0) > (focusStreak?.current ?? 0) ? <span className="st-faint">Longest: {focusStreak?.longest}</span> : null}
        </div>
      </Widget>
    ),
    record: (
      <Widget key="record" id="record" title="Personal records" action={{ label: 'Progress', onClick: () => onGo('progress') }}>
        {snapshot.records.totalFocusedSeconds < 1800 ? (
          <Empty>A few more sessions and your records will show here.</Empty>
        ) : (
          <ul className="st-records">
            <li>
              <span>Longest session</span>
              <strong>{spell(snapshot.records.longestSessionSeconds)}</strong>
            </li>
            <li>
              <span>Total focused</span>
              <strong>{spell(snapshot.records.totalFocusedSeconds)}</strong>
            </li>
            <li>
              <span>Best day</span>
              <strong>{spell(snapshot.records.bestDaySeconds)}</strong>
            </li>
          </ul>
        )}
      </Widget>
    ),
    subjects: (
      <Widget key="subjects" id="subjects" title="Where your time went" action={{ label: 'Progress', onClick: () => onGo('progress') }}>
        {snapshot.today.subjects.length === 0 ? (
          <Empty>Nothing yet today.</Empty>
        ) : (
          <ul className="st-subjects">
            {snapshot.today.subjects.slice(0, 5).map((one) => (
              <li key={one.subject}>
                <span>{one.subject}</span>
                <strong>{spell(one.seconds)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Widget>
    ),
    later: (
      <Widget key="later" id="later" title="Saved for later" action={{ label: 'Open', onClick: () => onGo('later') }}>
        {snapshot.waiting === 0 ? <Empty>Nothing waiting for later.</Empty> : <p className="st-big">{snapshot.waiting} waiting</p>}
      </Widget>
    ),
    wins: (
      <Widget key="wins" id="wins" title="Recent wins">
        {snapshot.achievements.length === 0 ? (
          <Empty>Your first milestone is waiting.</Empty>
        ) : (
          <ul className="st-wins">
            {[...snapshot.achievements]
              .sort((a, b) => b.at - a.at)
              .slice(0, 4)
              .map((one) => {
                const rule = catalogue?.achievements.find((x) => x.id === one.achievementId)
                return (
                  <li key={one.achievementId}>
                    <Trophy size={14} aria-hidden />
                    <span>{rule?.title ?? one.achievementId}</span>
                    <span className="st-faint">{onDay(one.at)}</span>
                  </li>
                )
              })}
          </ul>
        )}
      </Widget>
    ),
    learning: (
      <Widget key="learning" id="learning" title="Something to look at" action={{ label: 'Learn', onClick: () => onGo('learn') }}>
        {learning?.mix[0] ? (
          <div className="st-word">
            <strong>{learning.mix[0].title}</strong>
            <p>{learning.mix[0].body.keyIdea ?? learning.mix[0].body.text ?? learning.mix[0].body.definition}</p>
            <span className="st-origin">Orbis Learning</span>
          </div>
        ) : (
          <Empty>Nothing new today.</Empty>
        )}
      </Widget>
    ),
    orbi: (
      <Widget key="orbi" id="orbi" title="Orbi" action={{ label: 'Open', onClick: () => onGo('orbi') }}>
        <div className="st-orbi-widget">
          <Orbi state="ready" behaviour={prefs.orbi} reducedMotion={prefs.reducedMotion} worn={snapshot.orbi.worn} size={72} />
          <div>
            <strong>Level {snapshot.level.level}</strong>
            <span className="st-faint">
              {count(snapshot.level.xp - snapshot.level.from)} / {count(snapshot.level.to - snapshot.level.from)} XP
            </span>
            <div className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snapshot.level.through * 100)} aria-label="Level progress">
              <span style={{ width: `${snapshot.level.through * 100}%` }} />
            </div>
          </div>
        </div>
      </Widget>
    ),
    insights: (
      <Widget key="insights" id="insights" title="What you did" action={{ label: 'Progress', onClick: () => onGo('progress') }}>
        <ul className="st-insights">
          <li>
            {snapshot.today.sessions > 0
              ? `${snapshot.today.completed} of ${snapshot.today.sessions} sessions finished today.`
              : 'Nothing started today yet.'}
          </li>
          {snapshot.today.tasksCompleted > 0 ? <li>{snapshot.today.tasksCompleted} tasks done today.</li> : null}
          {snapshot.today.distractionsSaved > 0 ? <li>{snapshot.today.distractionsSaved} things saved for later instead of leaving.</li> : null}
        </ul>
      </Widget>
    ),
    music: (
      <Widget key="music" id="music" title="Music">
        <Empty>Music opens from the Orbis sidebar, and a session can start a playlist for you.</Empty>
      </Widget>
    ),
    atmosphere: (
      <Widget key="atmosphere" id="atmosphere" title="Atmosphere" action={{ label: 'Settings', onClick: () => onGo('settings') }}>
        <p className="st-faint">{catalogue?.atmospheres.find((one) => one.id === prefs.defaultAtmosphere)?.label ?? 'None by default'}</p>
      </Widget>
    ),
    continue: (
      <Widget key="continue" id="continue" title="Continue studying" action={{ label: 'Start', onClick: onStart }}>
        {snapshot.recommendation?.subject ? <p className="st-big">{snapshot.recommendation.subject}</p> : <Empty>Nothing to carry on from yet.</Empty>}
      </Widget>
    ),
    orion: (
      <Widget key="orion" id="orion" title="Orion">
        <Empty>Ask Orion from the chat, or from “I&apos;m losing focus” during a session.</Empty>
      </Widget>
    )
  }

  return (
    <div className="st-home">
      <header className="st-home-head">
        <div>
          <h2>{greeting(prefs.name, hour)}</h2>
          <p className="st-faint">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            {snapshot.today.focusedSeconds > 0 ? ` · ${spell(snapshot.today.focusedSeconds)} focused` : ''}
          </p>
        </div>
      </header>

      {/*
        * One answer to "what should I do now", above everything else on the board.
        *
        * Not a widget: it cannot be dragged away or turned off, because it is the thing the board is for. It is
        * asked for here rather than pushed, so it is an answer and not an interruption.
        */}
      <NextBest
        call={call}
        onStart={onStartOn}
        onGo={(where) => onGo(where)}
        onNotify={onNotify}
        onOpenOrion={onOpenOrion}
        compact
      />

      <div className="st-board">
        {order.map((id) => {
          const widget = widgets[id]
          if (!widget) return null
          return (
            <div
              key={id}
              className={`st-board-slot${dragging === id ? ' dragging' : ''}`}
              draggable
              onDragStart={() => setDragging(id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragging) void move(dragging, id)
                setDragging(null)
              }}
            >
              <span className="st-grip" aria-hidden>
                <GripVertical size={13} />
              </span>
              {widget}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The card after a session finishes.
 *
 * Measurements only: what was planned, what was done, what it was worth, what was saved for later. No score, and
 * nothing implying that longer would have been better.
 */
export function Completion({
  session,
  xp,
  saved,
  call,
  onAgain,
  onBreak,
  onReview,
  onStartOn,
  onOpenUrl,
  onClose
}: {
  session: { id?: string; title: string; plannedMinutes: number; focusedSeconds: number; distractionAttempts: number; interruptions: number; breakSeconds: number }
  xp: number
  saved: number
  call?: Call
  onAgain(): void
  onBreak(): void
  onReview(): void
  onStartOn?(options: { subject: string | null; conceptId: string | null; minutes: number | null; title: string }): void
  /** Opens a page in the browser, for putting back what was open before a strict session. */
  onOpenUrl?(url: string): void
  onClose(): void
}): React.JSX.Element {
  /*
   * The surprise, asked for once the session is actually over.
   *
   * Asked here and nowhere else: a surprise during a session is an interruption, and one offered to somebody who has
   * barely studied today is a taunt. The main process decides whether there is one at all -- it refuses on a thin
   * day, refuses twice in a day, and refuses when nothing is close enough for five minutes to change the answer.
   */
  const [surprise, setSurprise] = useState<{ title: string; because: string; minutes: number; conceptId: string | null; subject: string | null } | null>(null)
  useEffect(() => {
    if (!call || !onStartOn) return
    void call<typeof surprise>('surprise').then((out) => setSurprise(out ?? null))
  }, [call, onStartOn])

  /**
   * The pages that were open before a strict session took them away.
   *
   * Saved when the session started, offered back when it ends -- which is the only moment anybody wants them. The
   * session has to have had a snapshot for this to appear at all, so a light session shows nothing.
   */
  const [snapshot, setSnapshot] = useState<{ id: string; name: string; tabs: { url: string; title: string }[] } | null>(null)
  useEffect(() => {
    if (!call || !onOpenUrl || !session.id) return
    void call<typeof snapshot>('snapshot-for', session.id).then((out) => setSnapshot(out && out.tabs.length > 0 ? out : null))
  }, [call, onOpenUrl, session.id])

  return (
    <div className="st-sheet" role="dialog" aria-label="Session complete">
      <div className="st-sheet-card">
        <h3>Session complete</h3>
        <p className="st-complete-title">{session.title}</p>
        <strong className="st-complete-time">{clock(session.focusedSeconds)}</strong>
        <dl className="st-complete-stats">
          <div>
            <dt>Planned</dt>
            <dd>{session.plannedMinutes}m</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{Math.round(session.focusedSeconds / 60)}m</dd>
          </div>
          {xp > 0 ? (
            <div>
              <dt>XP</dt>
              <dd>+{xp}</dd>
            </div>
          ) : null}
          {saved > 0 ? (
            <div>
              <dt>Saved for later</dt>
              <dd>{saved}</dd>
            </div>
          ) : null}
          {session.distractionAttempts > 0 ? (
            <div>
              <dt>Held back</dt>
              <dd>{session.distractionAttempts}</dd>
            </div>
          ) : null}
          {session.breakSeconds > 60 ? (
            <div>
              <dt>Break</dt>
              <dd>{Math.round(session.breakSeconds / 60)}m</dd>
            </div>
          ) : null}
        </dl>
        {snapshot && onOpenUrl ? (
          <div className="st-surprise">
            <strong>Put back what you had?</strong>
            <p className="st-faint small">
              {snapshot.tabs.length} {snapshot.tabs.length === 1 ? 'page was' : 'pages were'} open before you started. They were
              kept, not closed.
            </p>
            <button
              type="button"
              className="st-btn small"
              onClick={() => {
                for (const tab of snapshot.tabs) onOpenUrl(tab.url)
                setSnapshot(null)
              }}
            >
              Open them again
            </button>
          </div>
        ) : null}

        {surprise && onStartOn ? (
          <div className="st-surprise">
            <strong>{surprise.title}</strong>
            <p className="st-faint small">{surprise.because}</p>
            <button
              type="button"
              className="st-btn primary small"
              onClick={() => onStartOn({ subject: surprise.subject, conceptId: surprise.conceptId, minutes: surprise.minutes, title: surprise.title })}
            >
              Go on then
            </button>
          </div>
        ) : null}
        <div className="st-sheet-foot wrap">
          <button type="button" className="st-btn primary" onClick={onAgain}>
            Another one
          </button>
          <button type="button" className="st-btn" onClick={onBreak}>
            Take a break
          </button>
          <button type="button" className="st-btn" onClick={onReview}>
            Review
          </button>
          <button type="button" className="st-btn quiet" onClick={onClose}>
            Back to Orbis
          </button>
        </div>
        <p className="st-faint small">Finished at {atTime(Date.now())}</p>
      </div>
    </div>
  )
}
