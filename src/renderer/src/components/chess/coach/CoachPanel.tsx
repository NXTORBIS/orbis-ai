import { useCallback, useMemo, useState } from 'react'
import { Button, Segmented } from '../../../ui'
import {
  EMPTY_PLAN, addPlanItem, dismissPlanItem, mergePlan, movePlanItem, removePlanItem, renamePlanItem,
  resetPlanTitle, restorePlanItem, weaknessProfile, type ActivityKind, type CoachEvidence, type PlanItem,
  type StudyPlan
} from '../../../../../shared/chess/coach'
import { progressReport, type CompletionRecord, type DayRules, type Window } from '../../../../../shared/chess/progress'
import type { AnalysisCoverage } from '../../../../../shared/chess/evidence'
import { challengeBoard } from '../../../../../shared/chess/challenges'
import type { StoredGame } from '../../../../../shared/chess/model'
import {
  NEVER_READ, reading, refreshButtonWords, refreshWords, type RefreshState
} from '../../../../../shared/chess/coachRefresh'
import { CoachMoments } from './CoachMoments'
import { Weaknesses } from './Weaknesses'
import { StudyPlanList } from './StudyPlanList'
import { ProgressCharts } from './ProgressCharts'
import { Goals } from './Goals'
import './coach.css'

/**
 * The coach: what the record shows, a plan you own, the measures, and the goals.
 *
 * ## It is a window onto pure functions
 *
 * Everything on these four tabs is worked out by `coach.ts`, `progress.ts` and `challenges.ts` from the records
 * handed in as props. This component holds four things and nothing else: which tab is open, how far back to measure,
 * the person's edits to their plan, and whether goals are switched on. There is no analysis here, no counting and no
 * threshold -- which is why all of it can be tested without a window.
 *
 * The records themselves are fetched by `CoachArea` beside this, which is what a host mounts: it reads the profile
 * through `useCoachEvidence` and `shared/chess/evidence.ts` gathers them. A panel mounted without `coverage` has not
 * been handed a record at all, and says so rather than drawing zeros that read as "nothing you have done counted".
 *
 * ## The moment it was worked out is fixed
 *
 * `now` is taken once and shown, with a button to take it again. A screen that quietly re-evaluated "today" on every
 * render would change a streak under somebody's hands while they read it.
 *
 * ## Where the plan is kept, said out loud
 *
 * Chess World has nowhere in the profile to save a study plan yet, so unless a host passes `plan` and
 * `onPlanChange`, the plan is kept by this window and the screen says so. And if what is there cannot be read, it is
 * reported as unreadable and **not** written over: an unreadable plan is not an absent one.
 */

export interface CoachPanelProps {
  /** Analysed games, training attempts, opening recall and review cards. Anything missing is simply not evidence. */
  evidence?: CoachEvidence
  /** The games themselves, for the count of games played and brought in. */
  played?: readonly StoredGame[]
  completions?: readonly CompletionRecord[]
  /**
   * How many of the person's games the engine has been over, and how many it has not.
   *
   * Shown whenever it is given, because the alternative is a screen that counts only the analysed games and leaves
   * somebody to assume the rest were clean. Left out means this screen was not told, and it says that instead of
   * reporting nought games.
   */
  coverage?: AnalysisCoverage
  /** Where the evidence came from and what was left out, in sentences to show as they are. */
  evidenceNotes?: readonly string[]
  /** Files that are there and could not be read. Shown, and nothing is written over them. */
  problems?: readonly string[]
  /** True while the record is still being read. Zeros drawn before the answer arrives read as "nothing was kept". */
  loading?: boolean
  /**
   * Read the record again.
   *
   * Without it "Bring up to date" can only move the clock, which is what it used to do: the figures were worked out
   * afresh from records fetched when the screen opened, so a game finished since was nowhere in them and the button
   * looked like it did nothing. A host that fetches the record passes this; a panel handed fixed records has nothing
   * to re-read, and then the button says it is only moving the clock.
   */
  onReload?: () => void
  /**
   * Where the reading has got to.
   *
   * Four states, and the screen needs all four: never read, reading now, read at a moment, and failed with a
   * reason. Without this the only thing the screen could say was "still reading", which is what it said for ever
   * when a read ended badly.
   */
  refresh?: RefreshState
  /** A host that keeps the plan itself passes both of these; otherwise this window keeps it. */
  plan?: StudyPlan
  onPlanChange?: (plan: StudyPlan) => void
  gamification?: boolean
  onGamificationChange?: (on: boolean) => void
  /** Fixed for testing. Otherwise taken once when the panel opens. */
  now?: number
  dayRules?: DayRules
  /** Tells one person's saved plan from another's in this window's own storage. */
  storageKey?: string
}

type Tab = 'moments' | 'weaknesses' | 'plan' | 'progress' | 'goals'

const TABS: { value: Tab; label: string }[] = [
  // First, and on purpose: the board is what this screen is about, and the tables are what it rests on.
  { value: 'moments', label: 'The moves themselves' },
  { value: 'weaknesses', label: 'What the record shows' },
  { value: 'plan', label: 'Study plan' },
  { value: 'progress', label: 'Progress' },
  { value: 'goals', label: 'Goals' }
]

const PLAN_KEY = 'orbis.chess.coach.plan'
const GAME_KEY = 'orbis.chess.coach.gamification'

/**
 * A stored plan, or what went wrong reading it.
 *
 * Two failures that look alike are kept apart on purpose. A window with no storage at all has **nothing stored**,
 * which is the ordinary first-run case. A window whose storage holds something that will not parse has a plan that
 * cannot be read -- and that is reported, and never written over, because an unreadable plan is not an absent one.
 */
function readPlan(key: string): { plan: StudyPlan | null; unreadable: boolean } {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return { plan: null, unreadable: false }
  }
  if (raw === null) return { plan: null, unreadable: false }
  try {
    const held = JSON.parse(raw) as StudyPlan
    if (!held || !Array.isArray(held.items)) return { plan: null, unreadable: true }
    for (const item of held.items) {
      if (typeof item?.id !== 'string' || typeof item?.order !== 'number') return { plan: null, unreadable: true }
    }
    return { plan: held, unreadable: false }
  } catch {
    return { plan: null, unreadable: true }
  }
}

function writePlan(key: string, plan: StudyPlan): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(plan))
  } catch {
    // A window with no storage still works; the plan simply lasts as long as the screen is open.
  }
}

export default function CoachPanel(props: CoachPanelProps): React.JSX.Element {
  const storageKey = props.storageKey ? `${PLAN_KEY}.${props.storageKey}` : PLAN_KEY
  const gameKey = props.storageKey ? `${GAME_KEY}.${props.storageKey}` : GAME_KEY

  const [tab, setTab] = useState<Tab>('moments')
  const [window_, setWindow] = useState<Window>('month')
  const [now, setNow] = useState(() => props.now ?? Date.now())
  const [stored] = useState(() => readPlan(storageKey))
  const [kept, setKept] = useState<StudyPlan>(() => stored.plan ?? EMPTY_PLAN)
  const [switchedOn, setSwitchedOn] = useState(() => {
    try {
      return window.localStorage.getItem(gameKey) !== 'off'
    } catch {
      return true
    }
  })

  const rules = useMemo<DayRules>(
    () => props.dayRules ?? { offsetMinutes: -new Date().getTimezoneOffset(), dayStartHour: 0 },
    [props.dayRules]
  )

  const profile = useMemo(() => weaknessProfile(props.evidence ?? {}, now), [props.evidence, now])

  // The plan on screen is always the person's plan brought up to date with the profile. The merge keeps their order,
  // their own lines and their dismissals; it is the coach's wording that follows the evidence.
  const base = props.plan ?? kept
  const plan = useMemo(() => mergePlan(base, profile, now), [base, profile, now])

  const update = useCallback((next: StudyPlan): void => {
    if (props.onPlanChange) { props.onPlanChange(next); return }
    setKept(next)
    writePlan(storageKey, next)
  }, [props.onPlanChange, storageKey])

  const report = useMemo(
    () => progressReport(
      { games: props.evidence?.games, training: props.evidence?.training, openings: props.evidence?.openings, played: props.played, completions: props.completions },
      now,
      { window: window_, rules }
    ),
    [props.evidence, props.played, props.completions, now, window_, rules]
  )

  const on = props.gamification ?? switchedOn
  const board = useMemo(
    () => challengeBoard({ events: report.events, now, rules, on, plan }),
    [report.events, now, rules, on, plan]
  )

  const setOn = (next: boolean): void => {
    if (props.onGamificationChange) { props.onGamificationChange(next); return }
    setSwitchedOn(next)
    try {
      window.localStorage.setItem(gameKey, next ? 'on' : 'off')
    } catch {
      // Nothing to do: the choice lasts as long as the screen is open.
    }
  }

  /**
   * Nobody has handed this screen a record to read.
   *
   * Which is a different thing from a record with nothing in it, and has to read differently. `CoachArea` beside
   * this fetches the record and passes `coverage`, so a panel with none was mounted without one -- and saying "you
   * have not played any chess" to somebody with forty games in their Library would be the worst thing here.
   */
  const notGivenARecord = props.coverage === undefined

  /*
   * Where the reading has got to.
   *
   * A host that fetches the record passes this. A panel handed fixed records has nothing to read, so the state is
   * "never read" and the button says it only moves the clock. `props.loading` is still honoured, because a host may
   * pass that and not the state.
   */
  const refresh = props.refresh ?? NEVER_READ
  const busy = reading(refresh) || props.loading === true

  /*
   * Where the plan is kept, in a line rather than a paragraph.
   *
   * Two sentences of engineering apology sat above the plan before this. The facts are the same and they still have
   * to be said -- an unreadable plan is not an absent one, and this computer is not your profile -- but they fit in
   * a badge, and the plan is what somebody came to this tab to read.
   */
  const keptNote = props.onPlanChange
    ? 'Kept by Chess World.'
    : stored.unreadable
      ? 'A saved plan is there and could not be read. It has not been written over; a change here saves a fresh copy.'
      // There is a place for it in the profile -- `chess-progress.json` holds a plan and the goals -- but nothing
      // writes to it yet, so what this window keeps is all there is.
      : 'Kept on this computer, not in your profile, so it will not follow you to another machine.'

  return (
    // The board tab needs the height, so the root gives its height away instead of scrolling.
    <div className={tab === 'moments' ? 'cw-co-root is-board' : 'cw-co-root'}>
      <Segmented
        value={tab}
        options={TABS}
        onChange={setTab}
        label="The coach"
        className="cw-co-tabs"
        optionClass="cw-co-tab"
      />

      <p className="cw-co-asof">
        <span className="cw-co-dim">Measured at {new Date(now).toLocaleTimeString()}.</span>
        {/* Both halves of being up to date: the moment everything is measured against, and the record itself. Doing
            only the first is what made this button look dead -- the clock moved and every figure stayed put. */}
        <Button
          size="tiny"
          kind="quiet"
          busy={busy}
          busyLabel="Reading…"
          onClick={() => {
            setNow(Date.now())
            props.onReload?.()
          }}
        >
          {refreshButtonWords(refresh, props.onReload !== undefined)}
        </Button>
        {/*
          * What the read is doing, or when it last finished, or why it did not.
          *
          * This is the fault the owner found. The old screen could only say "Still reading what you have done.", it
          * said it from a flag that was never cleared when a read ended badly, and it never said when a read had
          * last worked -- so there was no way to tell a running read from a stuck one, and no way to know whether
          * the game you just finished was in these figures.
          */}
        <span className={`cw-co-read is-${refresh.phase}`} role="status" aria-live="polite">
          {refreshWords(refresh, now)}
        </span>
        {props.onReload === undefined && (
          <span className="cw-co-dim">Fixed record: only the moment moves.</span>
        )}
      </p>

      {notGivenARecord && (
        <p className="cw-co-warning">
          <strong>No record yet.</strong> <span className="cw-co-dim">Press Bring up to date to read it.</span>
        </p>
      )}

      {(props.problems ?? []).length > 0 && (
        <div className="cw-co-warning">
          <strong>Some of what you have done could not be read, and has not been written over.</strong>
          <ul className="cw-co-problems">
            {(props.problems ?? []).map((line, index) => <li key={`problem-${index}`}>{line}</li>)}
          </ul>
        </div>
      )}

      {props.coverage && (
        <p className="cw-co-coverage" role="status">
          <span>{props.coverage.says}</span>
          {props.coverage.sideUnknown > 0 && (
            <span className="cw-co-dim">
              {' '}{props.coverage.sideUnknown} of them {props.coverage.sideUnknown === 1 ? 'does' : 'do'} not say which
              side you played, so the moves in {props.coverage.sideUnknown === 1 ? 'it are' : 'them are'} not counted as
              anybody&rsquo;s.
            </span>
          )}
        </p>
      )}

      {(props.evidenceNotes ?? []).length > 0 && (
        <details className="cw-co-numbers">
          <summary>Where these figures come from, and what was left out</summary>
          <ul className="cw-co-notes">
            {(props.evidenceNotes ?? []).map((line, index) => <li key={`note-${index}`}>{line}</li>)}
          </ul>
        </details>
      )}

      {/* The board, and it is the only tab that gets the room: the stage takes the height that is left. */}
      {tab === 'moments' && (
        <CoachMoments evidence={props.evidence} {...(props.loading === undefined ? {} : { loading: props.loading })} />
      )}

      {tab === 'weaknesses' && (
        <Weaknesses profile={profile} plan={plan} onRestore={(id) => update(restorePlanItem(plan, id, Date.now()))} />
      )}

      {tab === 'plan' && (
        <StudyPlanList
          plan={plan}
          kept={keptNote}
          onMove={(id, direction) => update(movePlanItem(plan, id, direction, Date.now()))}
          onDismiss={(id) => update(dismissPlanItem(plan, id, Date.now()))}
          onRestore={(id) => update(restorePlanItem(plan, id, Date.now()))}
          onRemove={(id) => update(removePlanItem(plan, id, Date.now()))}
          onRename={(id, title) => update(renamePlanItem(plan, id, title, Date.now()))}
          onResetTitle={(id) => update(resetPlanTitle(plan, id, Date.now()))}
          onAdd={(title: string, activity: ActivityKind) => {
            const at = Date.now()
            update(addPlanItem(plan, { id: `person:${at}:${plan.items.length}`, title, activity }, at))
          }}
        />
      )}

      {tab === 'progress' && <ProgressCharts report={report} window={window_} onWindow={setWindow} />}

      {tab === 'goals' && <Goals board={board} onSwitch={setOn} />}
    </div>
  )
}

/** Exported for a host that wants to show a line or two of the coach somewhere else. */
export function planSummary(plan: StudyPlan): { showing: readonly PlanItem[]; aside: number } {
  return {
    showing: plan.items.filter((one) => !one.dismissed).sort((a, b) => a.order - b.order),
    aside: plan.items.filter((one) => one.dismissed).length
  }
}
