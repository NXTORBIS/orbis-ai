import { useCallback, useEffect, useMemo, useState } from 'react'
import { Segmented } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import { ChessStage } from '../ChessStage'
import { MoveList } from '../MoveList'
import { openingTrail, stopLabel, trailWords } from '../../../../../shared/chess/openingTrail'
import { START_FEN, sideToMove, type ChessMove } from '../../../../../shared/chess/rules'
import type { GameMove, StoredGame } from '../../../../../shared/chess/model'
import { walkLine } from '../../../../../shared/chess/openings'
import {
  REPERTOIRE_TAG, SIDE_TAG, buildBook, drillAnswer, drillReveal, drillSkipLine, lineFromStored, lineToStored, makeLine,
  sideTag, startDrill, type Drill, type DrillOrder, type RepertoireLine
} from '../../../../../shared/chess/repertoire'
import { OpeningExplorer } from './OpeningExplorer'
import { RepertoireEditor } from './RepertoireEditor'
import { RecallTrainer } from './RecallTrainer'
import './openings.css'
import { useSurface } from '../../../lib/surfaces'
import { simpleAreaSurface } from '../chessSurfaces'

/**
 * The Opening Lab.
 *
 * One board, three things to do with it: see what the opening dataset calls the position in front of you and where it
 * can go, write down the lines you mean to play, and find out whether you remember them (Sections 131-140).
 *
 * Two decisions are worth knowing about before reading the code.
 *
 * **Repertoire lines are saved, properly.** Each one is a game in your own chess library with `source.kind: 'study'`
 * and a `repertoire` tag, so it survives closing Orbis, can be exported as a PGN like anything else, and cannot be
 * mistaken for a game that was played. Nothing is held only in this screen.
 *
 * **Nothing here judges a move.** The trainer says whether a move is the one you wrote down. It never says a move is
 * bad, because this screen asks no engine and therefore has no evidence. `gradeRecall` takes an engine score when a
 * caller has one; this screen has none and says so rather than implying a verdict.
 */

type Tab = 'explore' | 'repertoire' | 'recall'

const TABS: { value: Tab; label: string }[] = [
  { value: 'explore', label: 'Explore' },
  { value: 'repertoire', label: 'Repertoire' },
  { value: 'recall', label: 'Recall' }
]

const SIDES: { value: 'w' | 'b'; label: string }[] = [
  { value: 'w', label: 'White' },
  { value: 'b', label: 'Black' }
]

export interface OpeningLabProps {
  /** Said in the window's own way, when something happens that is worth a word. */
  onNotify?: (text: string, kind?: NoticeKind) => void
}

/** A move on the board. The same three fields a stored game keeps, so a line can be saved without translation. */
type BoardMove = Pick<GameMove, 'san' | 'uci' | 'fen'>

export default function OpeningLab({ onNotify }: OpeningLabProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('explore')
  const [side, setSide] = useState<'w' | 'b'>('w')
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [moves, setMoves] = useState<BoardMove[]>([])
  const [ply, setPly] = useState(0)
  const [lines, setLines] = useState<RepertoireLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [storeProblem, setStoreProblem] = useState<string | null>(null)
  const [drill, setDrill] = useState<Drill | null>(null)
  const [busy, setBusy] = useState(false)

  const say = useCallback((text: string, kind?: NoticeKind) => { onNotify?.(text, kind) }, [onNotify])

  /**
   * The repertoire comes out of the games store, filtered by its tag.
   *
   * A game that is not a repertoire line is left alone: `lineFromStored` returns nothing for it, so an ordinary game
   * in the library can never turn up here as a line.
   */
  const load = useCallback(async () => {
    try {
      const games: StoredGame[] = await window.api.chessGames()
      const found = games.map(lineFromStored).filter((one): one is RepertoireLine => one !== null)
      setLines(found)
      setStoreProblem(null)
    } catch (err) {
      // "Your repertoire could not be read" and "your repertoire is empty" are not the same thing, so an empty list
      // is never shown as if it were an answer.
      setStoreProblem(err instanceof Error ? err.message : 'Your saved lines could not be read.')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
    return window.api.onChessGamesChanged(() => { void load() })
  }, [load])

  const boardSans = useMemo(() => moves.slice(0, ply).map((m) => m.san), [moves, ply])
  const exploreFen = ply === 0 ? START_FEN : moves[ply - 1].fen
  const drillLine = drill ? lines.find((one) => one.id === drill.lineIds[drill.at]) ?? null : null
  const drillPrevious = drill && drillLine && drill.ply > 0 ? drillLine.moves[drill.ply - 1] : null
  const fen = drill && !drill.done ? drill.fen : exploreFen
  const lastMove = drill && !drill.done
    ? drillPrevious ? { from: drillPrevious.uci.slice(0, 2), to: drillPrevious.uci.slice(2, 4) } : null
    : ply > 0
      ? { from: moves[ply - 1].uci.slice(0, 2), to: moves[ply - 1].uci.slice(2, 4) }
      : null

  const book = useMemo(() => buildBook(lines, side), [lines, side])

  /** A move played on the board. In a drill it is an answer; otherwise it walks the line forward. */
  const onMove = (move: ChessMove): void => {
    if (drill && !drill.done) {
      const answered = drillAnswer(drill, lines, move.san)
      setDrill(answered.drill)
      return
    }
    const next: BoardMove[] = [...moves.slice(0, ply), { san: move.san, uci: move.uci, fen: move.after }]
    setMoves(next)
    setPly(next.length)
  }

  /** Putting a whole line on the board: from the dataset, or from one of your own saved lines. */
  const loadSans = useCallback((sans: string[], turnTo?: 'w' | 'b'): void => {
    const walk = walkLine(sans)
    setMoves(walk.steps.map((step) => ({ san: step.san, uci: step.uci, fen: step.fen })))
    setPly(walk.steps.length)
    setDrill(null)
    if (turnTo) setOrientation(turnTo)
    if (!walk.ok) say(walk.problem?.reason ?? 'Part of that line could not be played.', 'warn')
  }, [say])

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await work()
      await load()
    } catch (err) {
      say(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work.', 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Saving the line on the board as a repertoire line.
   *
   * It is created, its moves are written, and then it is tagged -- three steps because that is what the store offers,
   * and the tag is what makes it a repertoire line rather than a game.
   */
  const save = (name: string): void => {
    const made = makeLine({ id: 'new', side, name, moves: boardSans, now: Date.now() })
    if (!made.ok) {
      say(made.reason, 'warn')
      return
    }
    const payload = lineToStored(made.line)
    void run(async () => {
      const game = await window.api.chessCreate({ source: payload.source, startFen: payload.startFen, meta: { ...payload.meta } })
      await window.api.chessSaveMoves(game.id, made.line.moves, { ...payload.meta })
      await window.api.chessUpdate(game.id, { tags: payload.tags })
      say(`"${made.line.name}" is saved in your ${side === 'w' ? 'White' : 'Black'} repertoire.`)
    })
  }

  const rename = (line: RepertoireLine, name: string): void => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === line.name) return
    void run(async () => {
      await window.api.chessUpdate(line.id, {
        meta: { extra: { [SIDE_TAG]: line.side === 'w' ? 'white' : 'black', OrbisLineName: trimmed, ...(line.note ? { OrbisLineNote: line.note } : {}) } },
        tags: [REPERTOIRE_TAG, sideTag(line.side)]
      })
    })
  }

  const remove = (line: RepertoireLine): void => {
    void run(async () => {
      await window.api.chessRemove(line.id)
      if (drill?.lineIds.includes(line.id)) setDrill(null)
      say(`"${line.name}" is gone from your repertoire.`)
    })
  }

  /** The line on the board, replacing what a saved line holds now. */
  const replace = (line: RepertoireLine): void => {
    const made = makeLine({ id: line.id, side: line.side, name: line.name, moves: boardSans, now: Date.now() })
    if (!made.ok) {
      say(made.reason, 'warn')
      return
    }
    void run(async () => {
      await window.api.chessSaveMoves(line.id, made.line.moves, { ...lineToStored(made.line).meta })
      say(`"${line.name}" now follows the board.`)
    })
  }

  const exportLines = (): void => {
    const ids = lines.filter((one) => one.side === side).map((one) => one.id)
    if (!ids.length) {
      say('There is nothing in that repertoire to save yet.', 'warn')
      return
    }
    void run(async () => {
      const path = await window.api.chessExportPgn(ids)
      if (path) say(`Saved to ${path}`)
    })
  }

  /**
   * Bringing a repertoire in from a file.
   *
   * The file comes in as games, which is what the store does with a PGN. A game that carries Orbis's own side tag is
   * then tagged as a repertoire line; one that does not stays an ordinary game in the library, and the count of those
   * is reported rather than guessed at (a line whose colour nobody wrote down could belong to either book).
   */
  const importLines = (): void => {
    void run(async () => {
      const summary = await window.api.chessImportPgn()
      if (!summary) return
      let tagged = 0
      for (const id of summary.ids) {
        const game = await window.api.chessGame(id)
        const from = game?.meta.extra?.[SIDE_TAG]
        const which = from === 'white' || from === 'w' ? 'w' : from === 'black' || from === 'b' ? 'b' : null
        if (!game || !which) continue
        await window.api.chessUpdate(id, { tags: [REPERTOIRE_TAG, sideTag(which)] })
        tagged += 1
      }
      const rest = summary.imported - tagged
      say([
        `${tagged} repertoire ${tagged === 1 ? 'line' : 'lines'} brought in`,
        rest > 0 ? `${rest} ${rest === 1 ? 'game did' : 'games did'} not say which colour they are for, so they are in your library as games` : '',
        summary.skippedDuplicates ? `${summary.skippedDuplicates} were already here` : '',
        summary.failed.length ? `${summary.failed.length} could not be read` : ''
      ].filter(Boolean).join('; ') + '.')
    })
  }

  const begin = (order: DrillOrder): void => {
    const started = startDrill(lines, side, order)
    if (!started) {
      say(`There is nothing in your ${side === 'w' ? 'White' : 'Black'} repertoire to drill yet.`, 'warn')
      return
    }
    setDrill(started)
    setTab('recall')
    setOrientation(side)
  }

  const turn = sideToMove(fen)
  const drillRunning = Boolean(drill && !drill.done)

  /* What Orbis itself may do here: which part is open, whose repertoire it is, and which way up the board is. */
  useSurface(
    simpleAreaSurface({
      id: 'openings',
      name: 'Openings',
      about: 'Exploring the opening dataset, keeping a repertoire, and being asked to recall it.',
      keywords: ['openings', 'opening', 'repertoire', 'explorer', 'recall', 'eco'],
      controls: {
        tab: {
          name: 'What to show',
          spec: { type: 'string', description: TABS.map((one) => `${one.value} is ${one.label}`).join('; '), enum: TABS.map((one) => one.value) },
          get: () => tab,
          set: (value) => setTab(String(value) as Tab),
          default: 'explore'
        },
        side: {
          name: 'Whose repertoire',
          spec: { type: 'string', description: 'w for the White side of it, b for the Black side.', enum: ['w', 'b'] },
          get: () => side,
          set: (value) => {
            setSide(String(value) === 'b' ? 'b' : 'w')
            setDrill(null)
          },
          default: 'w'
        },
        orientation: {
          name: 'Which way up the board is',
          spec: { type: 'string', description: 'Whose pieces are at the bottom: w or b.', enum: ['w', 'b'] },
          get: () => orientation,
          set: (value) => setOrientation(String(value) === 'b' ? 'b' : 'w')
        }
      },
      state: () => ({
        tab,
        side,
        move: ply,
        // Null until the repertoire has been read: no lines and "not read yet" are different things.
        lines: loaded ? lines.length : null,
        couldNotBeRead: storeProblem,
        drillRunning
      })
    })
  )

  /*
   * The names this line passed through, as a row of crumbs above the board.
   *
   * It is worked out from the moves on the board by `openingTrail`, which plays them and keeps the positions the
   * dataset really names. Pressing one goes back to it. Nothing is counted: this dataset holds no games, so there
   * is no popularity here and the crumbs are names and move numbers only.
   */
  const trail = useMemo(() => (drillRunning ? null : openingTrail(boardSans)), [boardSans, drillRunning])

  const above = (
    <div className="cw-ol-strip">
      <span className="cw-ol-turnchip">
        {drillRunning ? `Your move as ${side === 'w' ? 'White' : 'Black'}` : `${turn === 'w' ? 'White' : 'Black'} to move`}
      </span>
      {trail && trail.stops.length > 0 && (
        <nav className="cw-ol-crumbs" aria-label={trailWords(trail)}>
          {trail.stops.map((stop) => (
            <button
              key={`${stop.ply}-${stop.record.key}`}
              type="button"
              className={`cw-ol-crumb${ply === stop.ply ? ' is-here' : ''}`}
              aria-current={ply === stop.ply ? 'true' : undefined}
              title={`${stop.record.eco} ${stop.record.name} — named at ${stopLabel(stop)}`}
              onClick={() => setPly(stop.ply)}
            >
              <span className="cw-ol-eco">{stop.record.eco}</span>
              <span className="cw-ol-crumbname">{stop.record.name}</span>
            </button>
          ))}
        </nav>
      )}
      {trail && trail.stops.length === 0 && trail.walked > 0 && (
        <span className="cw-ol-faintchip" title={trailWords(trail)}>No name for this line</span>
      )}
    </div>
  )

  const below = (
    <div className="cw-nav" role="group" aria-label="Walk the line">
      <button type="button" className="cw-nav-btn" title="Turn the board round" aria-label="Turn the board round" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>⇅</button>
      {!drillRunning && (
        <>
          <button type="button" className="cw-nav-btn" title="The starting position" aria-label="The starting position" disabled={ply === 0} onClick={() => setPly(0)}>⏮</button>
          <button type="button" className="cw-nav-btn" title="Back one move" aria-label="Back one move" disabled={ply === 0} onClick={() => setPly(ply - 1)}>◀</button>
          <button type="button" className="cw-nav-btn" title="Forward one move" aria-label="Forward one move" disabled={ply >= moves.length} onClick={() => setPly(ply + 1)}>▶</button>
          <button type="button" className="cw-nav-btn" title="The end of the line" aria-label="The end of the line" disabled={ply >= moves.length} onClick={() => setPly(moves.length)}>⏭</button>
          <button type="button" className="cw-nav-btn cw-ol-wide" disabled={!moves.length} onClick={() => { setMoves([]); setPly(0) }}>Clear the line</button>
        </>
      )}
    </div>
  )

  /* The line on the board, as a numbered move list rather than a run of words. */
  const left = drillRunning ? undefined : (
    <MoveList
      moves={moves.map((one) => one.san)}
      ply={ply}
      onJump={setPly}
      className="cw-ol-movelist"
      empty="No moves yet. Play one on the board, or pick a continuation."
    />
  )

  const panel = (
    <div className="cw-ol-panel">
      <div className="cw-ol-head">
        <Segmented<Tab>
          value={tab}
          options={TABS}
          onChange={setTab}
          label="What to do in the Opening Lab"
          className="cw-ol-tabs"
          optionClass="cw-ol-tab"
        />
        <Segmented<'w' | 'b'>
          value={side}
          options={SIDES}
          onChange={(next) => { setSide(next); setDrill(null) }}
          label="Which repertoire"
          className="cw-ol-sides"
          optionClass="cw-ol-sidebtn"
        />
      </div>

      {storeProblem && (
        <p className="cw-ol-problem" role="alert">
          Your saved lines could not be read, so this list may be incomplete: {storeProblem}
        </p>
      )}

      {tab === 'explore' && (
        <OpeningExplorer
          fen={fen}
          // While a drill is running the board is showing the drill's position, which the explore line did not
          // reach. Handing over a line that does not lead to this position would name the wrong opening, so the
          // explorer is given the position alone and says what it can from that.
          playedLine={drillRunning ? [] : boardSans}
          onPlay={(san) => {
            const walk = walkLine([...boardSans, san])
            if (!walk.ok) return
            setMoves(walk.steps.map((step) => ({ san: step.san, uci: step.uci, fen: step.fen })))
            setPly(walk.steps.length)
          }}
          onLoadLine={loadSans}
          busy={busy}
        />
      )}

      {tab === 'repertoire' && (
        <RepertoireEditor
          side={side}
          lines={lines}
          loaded={loaded}
          boardLine={boardSans}
          busy={busy}
          onSave={save}
          onRename={rename}
          onRemove={remove}
          onReplace={replace}
          onOpen={(line) => loadSans(line.moves.map((m) => m.san), line.side)}
          onExport={exportLines}
          onImport={importLines}
        />
      )}

      {tab === 'recall' && (
        <RecallTrainer
          side={side}
          lines={lines}
          book={book}
          fen={fen}
          drill={drill}
          drillLineName={drillLine?.name ?? null}
          onStart={begin}
          onStop={() => setDrill(null)}
          onReveal={() => { if (drill) setDrill(drillReveal(drill, lines).drill) }}
          onSkip={() => { if (drill) setDrill(drillSkipLine(drill, lines)) }}
        />
      )}
    </div>
  )

  /*
   * The board, as large as the room allows.
   *
   * This screen used to draw the board itself in a column that also held the nav and the line, so the board was
   * sized by the text under it. `ChessStage` measures the room and hands it a pixel size: the move list is a column
   * of its own on the left, the panel is a column on the right, and what is left over is the board.
   */
  return (
    <ChessStage
      className="cw-ol-stage"
      label="Opening board"
      above={above}
      below={below}
      {...(left ? { left } : {})}
      right={panel}
      board={{
        fen,
        orientation,
        interactive: !drill || !drill.done,
        lastMove,
        onMove,
        label: drillRunning ? 'Recall board' : 'Opening Lab board'
      }}
    />
  )
}
