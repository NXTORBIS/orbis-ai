import { useCallback, useMemo, useState } from 'react'
import { Button, Chip, EmptyState } from '../../../ui'
import { Board } from '../Board'
import { ENDGAMES } from '../../../../../shared/chess/endgamesData'
import {
  DEFENCE_RULES, DIFFICULTY_LABEL, PROOF_TEXT, THEME_LABEL, THEME_ORDER,
  drillMove, hintFor, objectiveText, proofKind, startDrill, verifyEntry,
  type Difficulty, type DrillState, type EndgameEntry, type EntryCheck
} from '../../../../../shared/chess/endgames'
import type { ChessMove } from '../../../../../shared/chess/rules'
import './endgames.css'
import { useSurface } from '../../../lib/surfaces'
import { simpleAreaSurface } from '../chessSurfaces'

/**
 * The Endgame Lab.
 *
 * Pick an ending, play the strong side, and be told what happened. Three things on this screen are deliberate:
 *
 *   - **The objective is stated before the first move**, in words that say which side you are and what counts as
 *     done. An endgame drill that only says "your move" is asking somebody to guess what they are being tested on.
 *   - **Done is decided by the position**, by `objectiveMet` in the shared module, never by matching a line. Mate a
 *     different way from the author and the screen says you have done it.
 *   - **What Orbis has and has not proved is on the screen**, not hidden in a comment. An ending that says "mate in
 *     two" has had every defence tried; an ending that teaches the opposition has had its position and its line
 *     checked and nothing more, and the badge says which.
 *
 * All the thinking lives in `src/shared/chess/endgames.ts`. This file arranges it and takes the clicks.
 */

/**
 * The difficulties to offer, read off the endings rather than written down.
 *
 * This was `[1, 2, 3, 4, 5]`, and no ending is difficulty 5 -- the 22 endings run 1 to 4. So the strip carried a
 * filter that could never match anything, and turning the other four off said "no ending is at the difficulties you
 * have picked" about a level that has no endings at all. Taking it from the data means the strip cannot say
 * otherwise again when an ending is added or removed.
 */
const DIFFICULTIES: readonly Difficulty[] = [...new Set(ENDGAMES.map((one) => one.difficulty))].sort((a, b) => a - b)

/** Each state wears its own class, because a bare `lost` or `achieved` would be a class two stylesheets own. */
const STATE_CLASS: Record<DrillState['status'], string> = { playing: 'cw-en-going', achieved: 'cw-en-done', lost: 'cw-en-gone' }

/**
 * A search on a screen gets a limit, and the limit is a number of positions rather than a number of milliseconds.
 *
 * This screen was written asking for a `deadline` -- a wall-clock moment -- which `endgames.ts` does not accept and
 * says why: "a node budget is the honest limit and the only one the tests use, because the same budget always gives
 * the same" answer. A clock-based cut-off makes the same move produce a proved claim on a quiet machine and an
 * unproved one on a busy machine, which is the one thing an endgame claim must never do.
 *
 * The numbers below are measured, and an earlier version of this comment claimed they were "chosen small enough
 * that the window does not sit still" when nobody had timed a single one. A position costs roughly 2 ms of real
 * work, so 120,000 of them is about four minutes of a frozen window, and 20,000 is about forty seconds. Neither had
 * ever been felt because the real endings settle in 120 to 450 positions -- the budgets were harmless by luck, not
 * by design, and one harder ending would have hung the screen.
 *
 * So they are set from the measured cost and a worst case somebody would tolerate: about seven seconds for the full
 * check, under a second for judging a move, which is still twenty times what any ending in the collection needs.
 * Running out is not a wrong answer -- `complete: false` means "not proved", never "not true" -- and the panel says
 * so when it happens.
 */
const JUDGE_POSITIONS = 4_000
const CHECK_POSITIONS = 3_000

export function EndgameLab({ onNotify }: { onNotify?: (text: string) => void } = {}): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  const [levels, setLevels] = useState<readonly Difficulty[]>(DIFFICULTIES)
  const [drill, setDrill] = useState<DrillState | null>(null)
  const [said, setSaid] = useState<string[]>([])
  const [check, setCheck] = useState<EntryCheck | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const entry = useMemo(() => ENDGAMES.find((one) => one.id === openId) ?? null, [openId])

  const shown = useMemo(() => {
    const byTheme = THEME_ORDER.map((theme) => ({
      theme,
      entries: ENDGAMES
        .filter((one) => one.theme === theme && levels.includes(one.difficulty))
        .sort((a, b) => a.difficulty - b.difficulty || (a.title < b.title ? -1 : 1))
    }))
    return byTheme.filter((group) => group.entries.length > 0)
  }, [levels])

  const open = useCallback((one: EndgameEntry): void => {
    setOpenId(one.id)
    setDrill(startDrill(one))
    setSaid([])
    setCheck(null)
    setHint(null)
  }, [])

  const again = useCallback((): void => {
    if (!entry) return
    setDrill(startDrill(entry))
    setSaid([])
    setHint(null)
  }, [entry])

  const onMove = useCallback((move: ChessMove): void => {
    if (!entry || !drill) return
    const out = drillMove(entry, drill, move.uci, { judge: true, budget: JUDGE_POSITIONS })
    if (!out.accepted) {
      setSaid((lines) => [...lines, out.feedback])
      return
    }
    setDrill(out.state)
    setHint(null)
    setSaid((lines) => [...lines, `${move.san} — ${out.feedback}`])
    if (out.state.status === 'achieved') onNotify?.(out.state.message)
  }, [entry, drill, onNotify])

  const showHint = useCallback((): void => {
    if (!entry || !drill) return
    const found = hintFor(entry, drill)
    setHint(found.text)
  }, [entry, drill])

  const recheck = useCallback((): void => {
    if (!entry) return
    setChecking(true)
    // The search runs after the next paint, not in this handler.
    //
    // All three of these calls used to sit together in the one handler, so React put them in a single commit with
    // `checking` already back to false: the button's "Checking…" state was written and could never appear, and the
    // window simply stopped answering for a second or two with nothing to show why. Handing the work to a timeout
    // lets the busy frame paint first. It is still on the main thread -- the search is synchronous and this is a few
    // hundred positions for every ending in the collection -- so the point is that the person can see it happening,
    // not that the window stays live throughout.
    window.setTimeout(() => {
      const result = verifyEntry(entry, { budget: CHECK_POSITIONS })
      setCheck(result)
      setChecking(false)
    }, 0)
  }, [entry])

  const lastMove = drill && drill.moves.length
    ? { from: drill.moves[drill.moves.length - 1].uci.slice(0, 2), to: drill.moves[drill.moves.length - 1].uci.slice(2, 4) }
    : null
  const learnerMoves = drill ? drill.moves.filter((one) => one.by === 'learner').length : 0

  /* What Orbis itself may do here: which ending is open. The drill itself is played on the board. */
  useSurface(
    simpleAreaSurface({
      id: 'endgames',
      name: 'Endgames',
      about: 'Endings played out against the engine, with the claim about each one proved rather than asserted.',
      keywords: ['endgame', 'endgames', 'ending', 'drill', 'technique'],
      controls: {
        ending: {
          name: 'The ending',
          spec: { type: 'string', description: 'Which ending is open, by its id.', enum: ENDGAMES.map((one) => one.id) },
          get: () => openId ?? '',
          set: (value) => {
            const found = ENDGAMES.find((one) => one.id === String(value))
            if (!found) throw new Error(`There is no ending called “${String(value)}”.`)
            open(found)
          }
        }
      },
      state: () => ({
        ending: openId,
        endings: ENDGAMES.length,
        drill: drill === null ? null : drill.status,
        yourMoves: learnerMoves,
        levelsShown: levels.length
      })
    })
  )

  return (
    <div className="cw-en-lab">
      <aside className="cw-en-side" aria-label="Endings">
        <div className="cw-en-filter" role="group" aria-label="Show which difficulties">
          {DIFFICULTIES.map((level) => (
            <Chip
              key={level}
              on={levels.includes(level)}
              className="cw-en-level"
              title={DIFFICULTY_LABEL[level]}
              aria-label={`${DIFFICULTY_LABEL[level]} endings`}
              onClick={() => setLevels((now) => (now.includes(level) ? now.filter((one) => one !== level) : [...now, level]))}
            >
              {level}
            </Chip>
          ))}
        </div>

        {shown.length === 0
          ? <EmptyState>No ending is at the difficulties you have picked. Turn one back on above.</EmptyState>
          : shown.map((group) => (
            <section key={group.theme} className="cw-en-group">
              <h4 className="cw-en-theme">{THEME_LABEL[group.theme]}</h4>
              <ul className="cw-en-items">
                {group.entries.map((one) => (
                  <li key={one.id}>
                    <button
                      type="button"
                      className={`cw-en-item${one.id === openId ? ' cw-en-on' : ''}`}
                      aria-current={one.id === openId ? 'true' : undefined}
                      onClick={() => open(one)}
                    >
                      <strong>{one.title}</strong>
                      <small>
                        {DIFFICULTY_LABEL[one.difficulty]}
                        {' · '}
                        {proofKind(one) === 'searched' ? 'proved by search' : 'position checked'}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </aside>

      {!entry || !drill
        ? (
          <section className="cw-en-play">
            <EmptyState>
              {/* "in the list", not "on the left": beside the chat sidebar this screen is about 600px wide and the
                  list moves to the top, so the old wording sent somebody looking at an empty edge of the screen. */}
              Pick an ending from the list. You play the side that is to move, the objective is stated before you
              start, and Orbis decides whether you have done it by looking at the position.
            </EmptyState>
          </section>
        )
        : (
          <section className="cw-en-play" aria-label={entry.title}>
            <header className="cw-en-head">
              <h3 className="cw-en-title">{entry.title}</h3>
              <p className="cw-en-meta">
                {THEME_LABEL[entry.theme]} · {DIFFICULTY_LABEL[entry.difficulty]}
                <span
                  className={`cw-en-badge ${proofKind(entry) === 'searched' ? 'cw-en-searched' : 'cw-en-checked'}`}
                  title={PROOF_TEXT[proofKind(entry)]}
                >
                  {proofKind(entry) === 'searched' ? 'Proved by search' : 'Position checked'}
                </span>
              </p>
            </header>

            <p className="cw-en-aim" role="status">{objectiveText(entry)}</p>

            <div className="cw-en-table">
              <Board
                fen={drill.fen}
                orientation={drill.learner}
                interactive={drill.status === 'playing'}
                lastMove={lastMove}
                onMove={onMove}
                highlight={[...(entry.marks ?? [])]}
                label={`${entry.title}. ${objectiveText(entry)}`}
              />

              <div className="cw-en-aside">
                <p className={`cw-en-state ${STATE_CLASS[drill.status]}`} role="status">
                  {drill.status === 'achieved' ? drill.message : drill.status === 'lost' ? (drill.slip ?? drill.message) : drill.message}
                </p>
                {drill.status === 'lost' && <p className="cw-en-slipnote">Nothing is broken: start it again and try the other move.</p>}

                <p className="cw-en-count">
                  {learnerMoves === 0 ? 'No moves yet.' : `${learnerMoves} of your own ${learnerMoves === 1 ? 'move' : 'moves'} so far.`}
                </p>

                <div className="cw-en-controls">
                  <Button size="small" kind="primary" onClick={again}>Start again</Button>
                  <Button size="small" onClick={showHint} disabled={drill.status !== 'playing'}>Show the next move of the line</Button>
                  <Button size="small" busy={checking} busyLabel="Checking…" onClick={recheck}>Check this position</Button>
                </div>
                {hint && <p className="cw-en-hint" role="status">{hint}</p>}

                <ol className="cw-en-moves" aria-label="What has been played">
                  {drill.moves.map((one, index) => (
                    <li key={`${index}-${one.uci}`} className={one.by === 'learner' ? 'cw-en-mine' : 'cw-en-theirs'}>
                      <span className="cw-en-san">{one.san}</span>
                      <span className="cw-en-why">{one.by === 'learner' ? 'you' : (one.note ?? 'the defence')}</span>
                    </li>
                  ))}
                </ol>
                {said.length > 0 && (
                  <ul className="cw-en-said" aria-label="Move by move">
                    {said.slice(-6).map((line, index) => <li key={`${index}-${line.slice(0, 12)}`}>{line}</li>)}
                  </ul>
                )}
              </div>
            </div>

            <div className="cw-en-notes">
              <p className="cw-en-method">{entry.method}</p>
              <details className="cw-en-more">
                <summary>How the defence plays, and what Orbis has proved</summary>
                <p className="cw-en-proof">{PROOF_TEXT[proofKind(entry)]}</p>
                <p className="cw-en-prov">{entry.provenance}</p>
                <p className="cw-en-faint">
                  The side against you is not an engine. Where this ending has a defence worth knowing, those moves are
                  written into it; everywhere else it follows this, in order, and beating it is not proof you have the
                  technique:
                </p>
                <ol className="cw-en-rules">
                  {DEFENCE_RULES.map((rule) => <li key={rule}>{rule}</li>)}
                </ol>
              </details>

              {check && (
                <div className="cw-en-check" role="status">
                  <p className={check.ok ? 'cw-en-ok' : 'cw-en-bad'}>
                    {check.ok ? 'Checked just now, and everything Orbis can check is sound.' : 'Something is wrong with this ending:'}
                  </p>
                  {check.problems.length > 0 && <ul>{check.problems.map((one) => <li key={one} className="cw-en-bad">{one}</li>)}</ul>}
                  {check.proved.length > 0 && <ul>{check.proved.map((one) => <li key={one}>{one}</li>)}</ul>}
                  {check.unproved.length > 0 && (
                    <ul className="cw-en-unproved">{check.unproved.map((one) => <li key={one}>{one}</li>)}</ul>
                  )}
                  <p className="cw-en-faint">{check.nodes.toLocaleString()} positions looked at.</p>
                </div>
              )}
            </div>
          </section>
        )}
    </div>
  )
}

export default EndgameLab
