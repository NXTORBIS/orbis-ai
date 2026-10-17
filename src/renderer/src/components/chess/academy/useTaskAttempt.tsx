import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChessMove } from '../../../../../shared/chess/rules'
import { isVerified, type Exercise, type ExerciseHint } from '../../../../../shared/chess/exercise'
import { advance, takeHint, type AttemptSession, type Performance, type Verdict } from '../../../../../shared/chess/attempt'
import {
  answerGaveUp, answerHint, answerPerformance, answerSubmitted, answerWorth, judgeAnswer, newAnswerAttempt,
  nextHintCost, playOpponentReply, playedPerformance, solutionLine, startAttempt, submitMove, wrongAllowed,
  type AnswerAttempt, type AnswerVerdict
} from '../../../../../shared/chess/academyPath'

/**
 * One go at one task, without a screen.
 *
 * ## Why it was taken out of the card
 *
 * Because the board moved. A task used to draw its own little board inside its own card, which is how the Academy
 * ended up with the fault the owner named: a board about a third of the width of a narrow column, with the
 * controls, the hints and the verdicts stacked underneath it. Now the board belongs to `ChessStage`, which measures
 * the room and draws it as large as the room allows, and the task's controls sit in the column beside it.
 *
 * That means two different arrangements need the same attempt: the lesson, where the board is the stage's and the
 * controls are in the right-hand column, and the review queue, where a task is opened in place. So the attempt
 * itself lives here, it hands out the board's props rather than a board, and both arrangements draw the same thing.
 *
 * ## It decides nothing about chess
 *
 * Every verdict comes from `attempt.ts` (a task answered by playing) or `judgeAnswer` in `academyPath.ts` (one
 * answered by naming squares, a count or a word). This hook drives the state machine and holds what the screen
 * needs to draw. There is nowhere in it that decides whether something was right.
 */

export type Tone = 'good' | 'wrong' | 'rules' | 'plain'

export interface Feedback {
  tone: Tone
  text: string
  /** The author's note about the move, when the solution carried one. */
  why?: string
}

function toneOf(verdict: Verdict): Tone {
  if (verdict.kind === 'solved') return 'good'
  if (verdict.kind === 'on-track') return 'good'
  if (verdict.kind === 'illegal') return 'rules'
  if (verdict.kind === 'not-the-idea') return 'wrong'
  return 'plain'
}

/** Everything the board needs for a task, except how big it is -- which is the layout's business, not the task's. */
export interface TaskBoard {
  fen: string
  orientation: 'w' | 'b'
  interactive: boolean
  onMove: (move: ChessMove) => void
  highlight: string[]
  lastMove: { from: string; to: string } | null
  showLegal: boolean
  label: string
}

export interface TaskAttempt {
  task: Exercise
  /** The task did not pass its own check. Nothing may be started: a screen must say so instead. */
  broken: boolean
  checked: boolean
  board: TaskBoard
  answered: boolean
  running: boolean
  over: boolean
  solvedNow: boolean
  /** How many wrong tries this task forgives before the go is over. */
  forgiven: number
  session: AttemptSession | null
  answer: AnswerAttempt | null
  feedback: Feedback | null
  shownHints: ExerciseHint[]
  replyNote: string | null
  /** Said when the exercise has no defence written for the position reached, so the go cannot carry on. */
  gap: string | null
  chosen: string[]
  typed: string
  verdict: AnswerVerdict | null
  worth: ReturnType<typeof answerWorth> | null
  hintCost: ReturnType<typeof nextHintCost>
  /** The solution, in words, once the go is over and lost. */
  line: readonly string[]
  goes: number
  begin: () => void
  again: () => void
  clearFeedback: () => void
  askForHint: () => void
  giveUp: () => void
  addSquare: () => void
  removeSquare: (square: string) => void
  setTyped: (text: string) => void
  submitAnswer: (given: { squares?: readonly string[]; value?: number; text?: string }) => void
}

export interface UseTaskAttemptOptions {
  task: Exercise
  /** How many goes have already been had at this task. Decides which defence is played, so a retry can differ. */
  priorAttempts: number
  /** Called once, when the go ends, with the record it leaves. */
  onFinished: (performance: Performance) => void
  /** Put the position on the board and start the clock without waiting to be asked. */
  autoStart?: boolean
}

export function useTaskAttempt({ task, priorAttempts, onFinished, autoStart = false }: UseTaskAttemptOptions): TaskAttempt {
  const checked = useMemo(() => isVerified(task), [task])
  const broken = task.verification.status === 'rejected'

  const [goes, setGoes] = useState(0)
  const [session, setSession] = useState<AttemptSession | null>(null)
  const [answer, setAnswer] = useState<AnswerAttempt | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [shownHints, setShownHints] = useState<ExerciseHint[]>([])
  const [replyNote, setReplyNote] = useState<string | null>(null)
  const [gap, setGap] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [typed, setTyped] = useState('')
  const [verdict, setVerdict] = useState<AnswerVerdict | null>(null)
  const reported = useRef<string | null>(null)

  const answered = task.objective === 'answer'
  const running = answered
    ? answer !== null && answer.outcome === null
    : session !== null && session.state !== 'completed' && session.state !== 'failed' && session.state !== 'abandoned'
  const over = answered
    ? answer !== null && answer.outcome !== null
    : session !== null && (session.state === 'completed' || session.state === 'failed')

  const begin = useCallback((): void => {
    const now = Date.now()
    const id = `${task.id}-${priorAttempts + goes + 1}`
    setFeedback(null)
    setShownHints([])
    setReplyNote(null)
    setGap(null)
    setChosen([])
    setTyped('')
    setVerdict(null)
    if (answered) {
      setAnswer(newAnswerAttempt(task, now))
      setSession(null)
    } else {
      setSession(startAttempt(task, id, now))
      setAnswer(null)
    }
  }, [task, answered, priorAttempts, goes])

  /*
   * A different task in the same slot is a different task: nothing from the last one carries over.
   *
   * It is kept against a remembered id rather than run on every change of `task.id`, because an effect with that
   * dependency also runs on the first render -- which is exactly when the auto-start has just put a position on the
   * board, and clearing it there left every task showing a Start button that had already been pressed.
   */
  const was = useRef(task.id)
  const started = useRef(false)
  useEffect(() => {
    if (was.current === task.id) return
    was.current = task.id
    started.current = false
    reported.current = null
    setSession(null)
    setAnswer(null)
    setFeedback(null)
    setShownHints([])
    setReplyNote(null)
    setGap(null)
    setChosen([])
    setTyped('')
    setVerdict(null)
    setGoes(0)
  }, [task.id])

  // Starting on its own, when the screen asked for that. Only once per task, and never for a broken one.
  useEffect(() => {
    if (!autoStart || started.current || broken) return
    started.current = true
    begin()
  }, [autoStart, broken, begin, task.id])

  // The opponent's reply, a beat after the move, so the two moves are not one flicker.
  useEffect(() => {
    if (!session || session.state !== 'awaiting-opponent') return
    const current = session
    const timer = window.setTimeout(() => {
      const step = playOpponentReply(current, task, Date.now(), priorAttempts + goes)
      setReplyNote(step.reply ? `They replied ${step.reply.san}.` : null)
      setGap(step.reply ? null : step.says)
      setSession(step.session)
      if (step.finished) setFeedback({ tone: 'good', text: step.says })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [session, task, priorAttempts, goes])

  // The record, handed up exactly once per go.
  useEffect(() => {
    const now = Date.now()
    const performance = session
      ? playedPerformance(session, task, now)
      : answer && answer.outcome !== null ? answerPerformance(answer, task, now) : null
    if (!performance) return
    const id = session ? session.id : `${task.id}-answer-${answer?.startedAt ?? 0}`
    if (reported.current === id) return
    reported.current = id
    onFinished(performance)
  }, [session, answer, task, onFinished])

  const onMove = useCallback((move: ChessMove): void => {
    if (!session) return
    const step = submitMove(session, task, move.uci, Date.now())
    if (!step.ok) {
      setFeedback({ tone: 'plain', text: step.refused ?? 'That could not be taken just now.' })
      return
    }
    setSession(step.session)
    setReplyNote(null)
    setFeedback({
      tone: toneOf(step.verdict),
      text: step.verdict.says,
      ...(step.verdict.kind === 'solved' || step.verdict.kind === 'on-track' ? { why: step.verdict.why } : {})
    })
  }, [session, task])

  const clearFeedback = useCallback((): void => {
    if (!session || session.state !== 'awaiting-feedback') return
    const stepped = advance(session, { kind: 'feedback-done' }, Date.now())
    if (stepped.ok) {
      setSession(stepped.session)
      if (stepped.session.state === 'active') setFeedback(null)
    }
  }, [session])

  const askForHint = useCallback((): void => {
    if (answered) {
      if (!answer) return
      const taken = answerHint(answer, task)
      if (!taken.hint) return
      setAnswer(taken.attempt)
      setShownHints((held) => [...held, taken.hint as ExerciseHint])
      return
    }
    if (!session) return
    const taken = takeHint(session, task)
    if (!taken.hint) return
    setSession(taken.session)
    setShownHints((held) => [...held, taken.hint as ExerciseHint])
  }, [answered, answer, session, task])

  const giveUp = useCallback((): void => {
    const now = Date.now()
    if (answered) {
      if (!answer) return
      setAnswer(answerGaveUp(answer, now))
      setVerdict(judgeAnswer(task, task.answer?.kind === 'count' ? { value: Number.NaN } : {}))
      return
    }
    if (!session) return
    const ended = advance(session, { kind: 'give-up' }, now)
    if (ended.ok) {
      setSession(ended.session)
      setFeedback({ tone: 'plain', text: 'Here is the answer. A look at it is not a solve, and it is recorded that way.' })
    }
  }, [answered, answer, session, task])

  const addSquare = useCallback((): void => {
    const square = typed.trim().toLowerCase()
    if (square === '') return
    setChosen((held) => (held.includes(square) ? held : [...held, square]))
    setTyped('')
  }, [typed])

  const removeSquare = useCallback((square: string): void => {
    setChosen((held) => held.filter((one) => one !== square))
  }, [])

  const submitAnswer = useCallback((given: { squares?: readonly string[]; value?: number; text?: string }): void => {
    if (!answer || answer.outcome !== null) return
    const judged = judgeAnswer(task, given)
    setVerdict(judged)
    setAnswer(answerSubmitted(answer, task, judged, Date.now()))
  }, [answer, task])

  const again = useCallback((): void => {
    setGoes((held) => held + 1)
    begin()
  }, [begin])

  const hintCost = useMemo(
    () => nextHintCost(task, answered ? answer?.hintsTaken ?? [] : session?.hintsTaken ?? []),
    [task, answered, answer, session]
  )
  const worth = answered && answer ? answerWorth(answer, task) : null
  const line = useMemo(() => (over && !answered ? solutionLine(task) : []), [over, answered, task])
  const solvedNow = (answered ? answer?.outcome === 'solved' : session?.outcome === 'solved') === true

  const played = session && session.played.length > 0 ? session.played[session.played.length - 1] : null

  const board: TaskBoard = {
    fen: session ? session.fen : task.startFen,
    orientation: task.sideToMove,
    interactive: !answered && session?.state === 'active',
    onMove,
    // The squares named so far on a task answered by naming squares. It marks what was said, not the answer.
    highlight: answered ? chosen : [],
    lastMove: played ? { from: played.uci.slice(0, 2), to: played.uci.slice(2, 4) } : null,
    showLegal: !answered,
    label: `Task board. ${task.prompt}`
  }

  return {
    task,
    broken,
    checked,
    board,
    answered,
    running,
    over,
    solvedNow,
    forgiven: wrongAllowed(task),
    session,
    answer,
    feedback,
    shownHints,
    replyNote,
    gap,
    chosen,
    typed,
    verdict,
    worth,
    hintCost,
    line,
    goes,
    begin,
    again,
    clearFeedback,
    askForHint,
    giveUp,
    addSquare,
    removeSquare,
    setTyped,
    submitAnswer
  }
}

export default useTaskAttempt
