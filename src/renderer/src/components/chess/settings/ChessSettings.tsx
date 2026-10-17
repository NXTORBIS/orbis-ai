import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Field } from '../../../ui'
import { ChessStage } from '../ChessStage'
import { START_FEN, applyMove, outcome, sideToMove } from '../../../../../shared/chess/rules'
import {
  BOARD_ACCESS_NOTES,
  CHESS_SHORTCUTS,
  GROUPS,
  NOT_EVERYWHERE,
  analysisRequestFrom,
  boardTheme,
  describeEngineRequest,
  drawnAs,
  fieldsIn,
  formatForSettings,
  notateSan,
  valueAt,
  type BoardThemeId,
  type ChessSettings as ChessSettingsShape,
  type FieldInfo,
  type FieldPath
} from '../../../../../shared/chess/settings'
import type { Score } from '../../../../../shared/chess/evaluation'
import { useSurface } from '../../../lib/surfaces'
import { chessSettingsSurface } from '../chessSurfaces'
import { useChessSettings, type ChessSettingsStore } from './chessSettingsStore'
import { SOUND_LABEL, SOUND_RESULT_WORDS, playChessSound, releaseChessSound, type ChessSoundName } from './chessSound'
import { ShortcutHelp } from './ShortcutHelp'
import './chessSettings.css'

/**
 * Chess World's settings.
 *
 * ## The one rule this screen is built around
 *
 * A control is drawn only for a setting that does something. That is not a style; it is the whole design, and it is
 * decided by `drawnAs()` in `shared/chess/settings.ts` rather than by remembering -- the screen switches on where
 * each field's value *lands*, and a field whose value lands nowhere yet is printed as a sentence saying what will
 * read it. A settings screen full of switches that quietly do nothing is the most common way a program loses
 * somebody's trust, because once they have found one of them they stop believing any of them.
 *
 * So: the board settings take effect at once, on every board in the window, and the little board on this screen is
 * the real `Board` component, so what is here is literally what will be there. The engine settings are really sent
 * to the engine by the button that asks it -- real numbers from a real search, or the real reason there were none.
 * The sound settings really decide what the "hear it" buttons make. And the four that are only stored -- which way
 * up a board opens, move numbering, the evaluation bar, the engine's arrow -- say so, and say which screen has to
 * change for them to work.
 *
 * ## What it saves to
 *
 * The profile, in `personal/chess-settings.json`, through two channels. So they follow the profile rather than the
 * computer and they travel in a profile export. `chessSettingsStore.tsx` says why one copy is still kept in this
 * window's own storage, and what that copy is and is not for.
 */

/**
 * The two positions the preview uses, played out by the rules rather than written down.
 *
 * Writing a FEN by hand is how a settings screen ends up previewing a position that cannot happen. These are two
 * real games played move by move through `applyMove`, so if the rules ever disagreed with them the preview would be
 * short rather than wrong.
 */
function play(moves: readonly string[]): {
  fen: string
  last: { from: string; to: string } | null
  san: { san: string; uci: string }[]
} {
  let fen = START_FEN
  let last: { from: string; to: string } | null = null
  const san: { san: string; uci: string }[] = []
  for (const move of moves) {
    const made = applyMove(fen, move)
    if (!made) break
    fen = made.after
    last = { from: made.uci.slice(0, 2), to: made.uci.slice(2, 4) }
    san.push({ san: made.san, uci: made.uci })
  }
  return { fen, last, san }
}

/** The Spanish Opening, five moves in: both colours of piece on both colours of square. */
const OPENING = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])
/** The shortest game there is, so the check mark has something to mark. */
const CHECKED = play(['f3', 'e5', 'g4', 'Qh4'])

type PreviewAt = 'opening' | 'check'

/** One engine answer, read out of an update whose shape cannot be assumed. */
interface EngineAnswer {
  depth: number | null
  score: Score
  line: string[]
  nodes: number | null
  timeMs: number | null
  done: boolean
  note: string | null
}

function asScore(raw: unknown): Score {
  if (!raw || typeof raw !== 'object') return { kind: 'none' }
  const o = raw as Record<string, unknown>
  if (o.kind === 'cp' && typeof o.cp === 'number' && Number.isFinite(o.cp)) return { kind: 'cp', cp: o.cp }
  if (o.kind === 'mate' && typeof o.moves === 'number' && Number.isFinite(o.moves)) return { kind: 'mate', moves: o.moves }
  return { kind: 'none' }
}

/**
 * An analysis update, narrowed.
 *
 * The channel hands these over as `unknown`, which is the right shape for it: a renderer that assumes a field is
 * there and reads `undefined.toFixed` takes the whole screen down with it. Everything below is checked, and a field
 * that is not what it should be becomes null rather than a number nobody can account for.
 *
 * The request id and the position are returned rather than used here, because the check that matters belongs to the
 * caller: an answer that arrives after the position changed is about a different position, and showing it against
 * this one would be an evaluation nobody ever computed.
 */
function readUpdate(raw: unknown): { id: string; fen: string; answer: EngineAnswer } | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.requestId !== 'string' || typeof o.fen !== 'string') return null
  const line = Array.isArray(o.pvSan)
    ? o.pvSan.filter((one): one is string => typeof one === 'string')
    : Array.isArray(o.pvUci)
      ? o.pvUci.filter((one): one is string => typeof one === 'string')
      : []
  return {
    id: o.requestId,
    fen: o.fen,
    answer: {
      depth: typeof o.depth === 'number' ? o.depth : null,
      score: asScore(o.score),
      line,
      nodes: typeof o.nodes === 'number' ? o.nodes : null,
      timeMs: typeof o.timeMs === 'number' ? o.timeMs : null,
      done: o.complete === true,
      note: typeof o.note === 'string' && o.note.length > 0 ? o.note : null
    }
  }
}

export interface ChessSettingsProps {
  /** True when somebody asked for the keys rather than for the settings. */
  openKeysAtFirst?: boolean
}

export default function ChessSettings({ openKeysAtFirst = false }: ChessSettingsProps): React.JSX.Element {
  const store = useChessSettings()
  const { settings, loading, setField, resetOneGroup } = store
  const [where, setWhere] = useState<PreviewAt>('opening')
  const [keysOpen, setKeysOpen] = useState(openKeysAtFirst)
  const [heard, setHeard] = useState('')

  const preview = where === 'opening' ? OPENING : CHECKED
  const previewOver = useMemo(() => outcome(preview.fen).over, [preview.fen])

  // Nothing is left running when this screen goes away.
  useEffect(() => () => releaseChessSound(), [])

  const hear = useCallback((name: ChessSoundName): void => {
    setHeard(SOUND_RESULT_WORDS[playChessSound(name, settings)])
  }, [settings])

  const facing = settings.board.orientation === 'black'
    ? 'b'
    : settings.board.orientation === 'side-to-move'
      ? sideToMove(preview.fen)
      : 'w'

  const broken = BOARD_ACCESS_NOTES.filter((one) => one.state !== 'works').length

  /*
   * What Orbis itself may do here. Above the loading answer below, because a hook has to be.
   *
   * All thirty fields, read out of `FIELDS` rather than written out again -- including which of them reach anything,
   * which is what decides whether Orbis is offered a control or a sentence saying what is waiting on it. While the
   * profile is still being read every getter throws, so a board colour nobody chose is never reported as chosen.
   */
  useSurface(
    chessSettingsSurface({
      settings: () => {
        if (loading) throw new Error('Your chess settings are still being read.')
        return settings
      },
      setField,
      resetGroup: resetOneGroup,
      problem: () => store.problem,
      fallbacks: () => store.fallbacks
    })
  )

  /*
   * The settings live in the profile now, so reading them takes a moment. Nothing is drawn in that moment: every
   * control here would otherwise be drawn at the value Orbis came with, which is indistinguishable from a screen
   * saying every preference somebody set has been lost.
   */
  if (loading) {
    return (
      <div className="cw-cfg">
        <p className="cw-loading" role="status">Reading your chess settings…</p>
        {/* The keys sheet is about the keyboard and not about any setting, so somebody who came here for it is not
            made to wait for a file to be read. */}
        {keysOpen && <ShortcutHelp onClose={() => setKeysOpen(false)} />}
      </div>
    )
  }

  /*
   * The board is the preview, and it is the biggest thing on the screen.
   *
   * It used to be a small board above a column of controls, which made the one thing every setting here is about
   * into a thumbnail. Now the shared layout measures the room and the board takes it; the controls are the column
   * beside it and scroll on their own. The board is the real `Board` with the real settings on it, so what is on
   * screen is literally what will be on screen everywhere else.
   */
  const groups = (
    <div className="cw-cfg-controls">
      <div className="cw-cfg-intro">
        <p className="cw-cfg-say">
          Every control here changes something, at once, on every board in Orbis. A setting that is kept and not
          read yet says so instead of pretending to be a switch.
        </p>
        <div className="cw-cfg-row">
          <Button size="small" onClick={() => setKeysOpen(true)}>Keys, and what works without a mouse</Button>
          <span className="cw-cfg-chip">{CHESS_SHORTCUTS.length} keys</span>
          {/* The verb has to agree with the count. There are six of these, so this read "6 things on the board
              does not work" on every machine: the singular wording was written and the plural was not. */}
          <span className="cw-cfg-chip is-warn">
            {broken === 1 ? '1 thing needs a mouse' : `${broken} things need a mouse`}
          </span>
        </div>
      </div>

      {GROUPS.map((group) => (
        <section className="cw-cfg-group" key={group.id} aria-labelledby={`cw-cfg-g-${group.id}`}>
          <div className="cw-cfg-group-top">
            <div>
              <h3 className="cw-cfg-group-name" id={`cw-cfg-g-${group.id}`}>{group.title}</h3>
              <p className="cw-cfg-group-say">{group.plain}</p>
            </div>
            <Button
              size="tiny"
              kind="quiet"
              onClick={() => resetOneGroup(group.id)}
              aria-label={`Put ${group.title} back to the way it came, and leave everything else alone`}
            >
              Reset this group
            </Button>
          </div>

          {fieldsIn(group.id).map((field) => (
            <OneField key={field.path} field={field} settings={settings} setField={setField} />
          ))}

          {group.id === 'sound' && <SoundTry onHear={hear} heard={heard} />}
          {group.id === 'engine' && <EngineCheck settings={settings} fen={preview.fen} />}
          {group.id === 'moves' && <MovesPreview settings={settings} moves={preview.san} />}
          {group.id === 'analysis' && <ScorePreview settings={settings} fen={preview.fen} />}
        </section>
      ))}
    </div>
  )

  return (
    <div className="cw-cfg">
      <Notices store={store} />

      <ChessStage
        className="cw-cfg-stage"
        label="The board, as these settings make it"
        board={{
          fen: preview.fen,
          label: 'Settings preview board',
          showCoordinates: settings.board.coordinates !== 'off',
          showLegal: settings.board.legalDots,
          lastMove: settings.board.lastMoveMark ? preview.last : null,
          interactive: !previewOver,
          orientation: facing
        }}
        below={(
          <div className="cw-cfg-under">
            {/*
              * Two toggles rather than the window's segmented strip, which always says `role="tablist"`. These do not
              * reveal panels, so calling them tabs would tell a screen reader to expect something that is not there.
              */}
            <div className="cw-cfg-choices" role="group" aria-label="What the preview shows">
              {([['opening', 'An opening'], ['check', 'A king in check']] as [PreviewAt, string][]).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="cw-cfg-choice"
                  aria-pressed={where === id}
                  onClick={() => setWhere(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="cw-cfg-preview-note">
              A real position, played out by the rules. Pick a piece up to see the dots, or walk it with the arrow
              keys to see the cursor.
            </p>
          </div>
        )}
        right={groups}
      />

      {keysOpen && <ShortcutHelp onClose={() => setKeysOpen(false)} />}
    </div>
  )
}

/** What could not be read out of the saved settings, and whether anything can be saved at all. */
function Notices({ store }: { store: ChessSettingsStore }): React.JSX.Element | null {
  if (store.fallbacks.length === 0 && store.problem === null && store.carried === null) return null
  return (
    <div className="cw-cfg-warn" role="status">
      {/*
        * The store only ever sets this when nothing was written, so it is never shown beside a save that worked. The
        * sentence is the one the store wrote, shown as it is: it names what happened to the file and what was not
        * done to it, and rewording it here would lose both.
        */}
      {store.problem !== null && <p className="cw-cfg-told-why">{store.problem}</p>}
      {store.carried !== null && <p className="cw-cfg-told-why">{store.carried}</p>}
      {store.fallbacks.length > 0 && (
        <>
          <strong>
            {store.fallbacks.length === 1 ? 'One saved setting' : `${store.fallbacks.length} saved settings`} could not be used:
          </strong>
          <ul>
            {store.fallbacks.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ul>
          <Button size="tiny" kind="quiet" onClick={store.clearNotices}>Hide this</Button>
        </>
      )}
    </div>
  )
}

/** One setting: a control when the value goes somewhere, a sentence when it does not. */
function OneField({
  field,
  settings,
  setField
}: {
  field: FieldInfo
  settings: ChessSettingsShape
  setField: (path: FieldPath, value: string | number | boolean) => void
}): React.JSX.Element {
  const value = valueAt(settings, field.path)
  const reach = field.reach
  const shape = field.shape

  if (drawnAs(reach) === 'statement') {
    const why = reach.kind === 'stored'
      ? reach.waitingFor
      : reach.kind === 'engine-sized'
        ? `Stockfish sizes this itself from what this computer has, and Orbis has no way to send it a value. The engine calls it ${reach.shownAs}.`
        : ''
    return (
      <div className="cw-cfg-field">
        <span className="cw-cfg-field-name">{field.label}</span>
        <p className="cw-cfg-field-say">{field.plain}</p>
        <div className="cw-cfg-told">
          <p className="cw-cfg-told-why">Nothing reads this yet, so there is no control for it. {why}</p>
        </div>
      </div>
    )
  }

  /*
   * The middle case. The control works; it does not yet work everywhere somebody would expect, and that sentence
   * belongs under the control rather than nowhere. It is part of the field's description, not a separate notice,
   * so a screen reader hears it when the control is reached.
   */
  const notEverywhere = NOT_EVERYWHERE[field.path]
  const hint = notEverywhere === undefined ? field.plain : `${field.plain} ${notEverywhere}`

  if (shape.kind === 'switch') {
    return (
      <Field
        label={field.label}
        hint={hint}
        className="cw-cfg-field"
        labelClassName="cw-cfg-field-name"
        hintClassName="cw-cfg-field-say"
      >
        {(wiring) => (
          <span className="cw-cfg-switch">
            <input
              type="checkbox"
              id={wiring.id}
              aria-describedby={wiring['aria-describedby']}
              checked={value === true}
              onChange={(event) => setField(field.path, event.target.checked)}
            />
          </span>
        )}
      </Field>
    )
  }

  if (shape.kind === 'number') {
    const range = shape.range
    const shown = Number(value)
    return (
      <Field
        label={field.label}
        hint={hint}
        className="cw-cfg-field"
        labelClassName="cw-cfg-field-name"
        hintClassName="cw-cfg-field-say"
      >
        {(wiring) => (
          <span className="cw-cfg-slide">
            <input
              type="range"
              id={wiring.id}
              aria-describedby={wiring['aria-describedby']}
              min={range.low}
              max={range.high}
              step={range.step}
              value={shown}
              onChange={(event) => setField(field.path, Number(event.target.value))}
            />
            {/* The number as well as the slider: a slider on its own never says what it is set to. */}
            <output className="cw-cfg-value" htmlFor={wiring.id}>
              {field.path === 'engine.thinkMs' && shown >= 1000
                ? `${(shown / 1000).toFixed(shown % 1000 === 0 ? 0 : 1)} s`
                : `${shown}${range.unit}`}
            </output>
          </span>
        )}
      </Field>
    )
  }

  const choices = shape.choices
  const chosen = choices.find((one) => one.value === value)
  return (
    <Field
      label={field.label}
      hint={hint}
      className="cw-cfg-field"
      labelClassName="cw-cfg-field-name"
      hintClassName="cw-cfg-field-say"
      as="fieldset"
    >
      {(wiring) => (
        <>
          <span className="cw-cfg-choices">
            {choices.map((one) => (
              <button
                key={one.value}
                type="button"
                className="cw-cfg-choice"
                aria-pressed={one.value === value}
                aria-describedby={wiring['aria-describedby']}
                title={one.plain}
                onClick={() => setField(field.path, one.value)}
              >
                {one.label}
                {field.path === 'board.theme' && <ThemeStripe id={one.value as BoardThemeId} />}
              </button>
            ))}
          </span>
          {/* Said out loud as it changes, so picking one explains itself without anybody having to hover. */}
          {chosen?.plain !== undefined && <p className="cw-cfg-field-say" aria-live="polite">{chosen.plain}</p>}
        </>
      )}
    </Field>
  )
}

/**
 * The two square colours of a board beside its name, so the choice can be made by looking.
 *
 * Inline rather than in the stylesheet because the colours come from the theme data, and five pairs of rules whose
 * only job is to repeat values that are already in `BOARD_THEMES` would be five more places for them to drift.
 */
function ThemeStripe({ id }: { id: BoardThemeId }): React.JSX.Element {
  const theme = boardTheme(id)
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '18px',
        height: '10px',
        marginLeft: '7px',
        verticalAlign: 'middle',
        borderRadius: '2px',
        background: `linear-gradient(90deg, ${theme.light} 0 50%, ${theme.dark} 50% 100%)`
      }}
    />
  )
}

function SoundTry({ onHear, heard }: { onHear: (name: ChessSoundName) => void; heard: string }): React.JSX.Element {
  return (
    <div className="cw-cfg-field">
      <span className="cw-cfg-field-name">Hear them</span>
      <p className="cw-cfg-field-say">
        The sounds themselves, with the settings above applied. If one is switched off, or the volume is nothing, the
        button says so rather than pretending it played.
      </p>
      <div className="cw-cfg-row">
        {(['move', 'capture', 'castle', 'check', 'end'] as ChessSoundName[]).map((name) => (
          <Button key={name} size="tiny" onClick={() => onHear(name)}>{SOUND_LABEL[name]}</Button>
        ))}
      </div>
      <p className="cw-cfg-field-say" role="status">{heard}</p>
    </div>
  )
}

/**
 * Asks the engine, with the settings as they stand.
 *
 * Every number here came out of a real search. Nothing is filled in while waiting and nothing is estimated: before
 * the first update there is no score, and "nothing back yet" is what it says.
 *
 * Two guards, and both have been bugs in this kind of panel before. An update is thrown away unless its request id
 * *and* its position both match what was asked, because an answer about the previous position shown against this
 * one is an evaluation nobody computed. And the search is stopped when this screen goes away, so closing the
 * settings does not leave Stockfish running on a position nobody is looking at.
 */
function EngineCheck({ settings, fen }: { settings: ChessSettingsShape; fen: string }): React.JSX.Element {
  const [answer, setAnswer] = useState<EngineAnswer | null>(null)
  const [state, setState] = useState<'idle' | 'asking' | 'done' | 'failed'>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const asked = useRef<{ id: string; fen: string } | null>(null)

  const stop = useCallback((): void => {
    const now = asked.current
    asked.current = null
    if (now) void window.api.chessStopAnalysis(now.id).catch(() => undefined)
  }, [])

  useEffect(() => stop, [stop])

  // A different position is a different question, so anything said about the last one goes.
  useEffect(() => {
    stop()
    setAnswer(null)
    setState('idle')
    setProblem(null)
  }, [fen, stop])

  useEffect(() => {
    const offUpdate = window.api.onChessAnalysis((raw) => {
      const update = readUpdate(raw)
      const mine = asked.current
      if (!update || !mine || update.id !== mine.id || update.fen !== mine.fen) return
      setAnswer(update.answer)
      if (update.answer.done) {
        setState('done')
        asked.current = null
      }
    })
    const offFailed = window.api.onChessAnalysisFailed((failure) => {
      if (asked.current !== null && failure.id !== asked.current.id) return
      asked.current = null
      setProblem(failure.message)
      setState('failed')
    })
    return () => {
      offUpdate()
      offFailed()
    }
  }, [])

  const ask = useCallback(async (): Promise<void> => {
    stop()
    setAnswer(null)
    setProblem(null)
    setState('asking')
    const id = `cw-cfg-${Date.now()}`
    const request = analysisRequestFrom(settings, fen, id)
    try {
      const given = await window.api.chessAnalyse({ ...request, id })
      asked.current = { id: given, fen }
    } catch (err) {
      setState('failed')
      setProblem(
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : 'The engine could not be asked.'
      )
    }
  }, [settings, fen, stop])

  const toMove = sideToMove(fen)
  const said = state === 'failed' && problem !== null
    ? problem
    : answer === null
      ? state === 'asking'
        ? 'Asked. Nothing back from the engine yet.'
        : 'Nothing asked yet.'
      : [
          `Score ${formatForSettings(answer.score, settings, toMove)}`,
          answer.depth === null ? 'depth not reported' : `depth ${answer.depth}`,
          answer.nodes === null ? null : `${answer.nodes.toLocaleString()} positions looked at`,
          answer.timeMs === null ? null : `${(answer.timeMs / 1000).toFixed(2)} seconds`,
          answer.line.length === 0 ? 'no line yet' : `line: ${answer.line.slice(0, 8).map((san) => notateSan(san, settings)).join(' ')}`,
          answer.done ? 'finished' : 'still thinking',
          answer.note
        ].filter((bit) => bit !== null).join('\n')

  return (
    <div className="cw-cfg-field">
      <span className="cw-cfg-field-name">Ask the engine, with these settings</span>
      <p className="cw-cfg-field-say">
        {describeEngineRequest(settings)} It is asked about the position on the board above. This is the same request
        the rest of Chess World makes, built by the same function, so what happens here is what will happen there.
      </p>
      <div className="cw-cfg-row">
        <Button size="small" busy={state === 'asking' && answer === null} busyLabel="Asking…" onClick={() => void ask()}>
          Ask the engine
        </Button>
        <Button size="small" kind="quiet" disabled={state !== 'asking'} onClick={() => { stop(); setState('idle') }}>
          Stop
        </Button>
      </div>
      <p className="cw-cfg-out" role="status" aria-live="polite">{said}</p>
    </div>
  )
}

/** The chosen notation, on moves really played in the position above. */
function MovesPreview({
  settings,
  moves
}: {
  settings: ChessSettingsShape
  moves: readonly { san: string; uci: string }[]
}): React.JSX.Element {
  return (
    <div className="cw-cfg-field">
      <span className="cw-cfg-field-name">How that reads</span>
      <p className="cw-cfg-field-say">The moves of the game on the board above, written the way you have chosen.</p>
      <p className="cw-cfg-out">
        {moves.length === 0 ? 'No moves.' : moves.map((move) => notateSan(move.san, settings, move.uci)).join('  ')}
      </p>
    </div>
  )
}

/**
 * The same four scores, formatted the way the two display settings ask for.
 *
 * The four are examples and are labelled as examples, which is the distinction that matters: they are input to a
 * formatter, not an evaluation of the position on the board. The engine's real score is in the group above, and it
 * goes through this same function with these same settings.
 */
function ScorePreview({ settings, fen }: { settings: ChessSettingsShape; fen: string }): React.JSX.Element {
  const toMove = sideToMove(fen)
  const examples: readonly { what: string; score: Score }[] = [
    { what: 'White a pawn and a quarter better', score: { kind: 'cp', cp: 124 } },
    { what: 'Black a third of a pawn better', score: { kind: 'cp', cp: -33 } },
    { what: 'White mating in three', score: { kind: 'mate', moves: 3 } },
    { what: 'Nothing scored yet', score: { kind: 'none' } }
  ]
  return (
    <div className="cw-cfg-field">
      <span className="cw-cfg-field-name">How a score reads</span>
      <p className="cw-cfg-field-say">
        Four made-up scores, not an evaluation of anything: they are put through the same formatter the engine&apos;s
        own answer goes through, so the two settings above can be seen rather than guessed at.{' '}
        {toMove === 'w' ? 'White' : 'Black'} is to move in the position on the board, which is what the second one turns on.
      </p>
      <p className="cw-cfg-out">
        {examples.map((one) => `${one.what}: ${formatForSettings(one.score, settings, toMove)}`).join('\n')}
      </p>
    </div>
  )
}

export { ChessSettings }
