import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from '../Board'
import { Button, EmptyState, Field, Segmented } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import { START_FEN, checkFen, type ChessMove } from '../../../../../shared/chess/rules'
import type { StoredGame } from '../../../../../shared/chess/model'
import { draftToFen, readFen } from '../../../../../shared/chess/variants'
import { gameLine, gameTitle } from '../../../../../shared/chess/library'
import { recordFor } from '../../../../../shared/chess/openings'
import {
  DEFAULT_RULE, MATCH_RULES, MATERIAL_PATTERNS, materialWords, progressWords, resultWords, ruleWords, searchByKey,
  searchIndex, searchMaterial, skippedWords, startIndex, startOpeningSurvey, stepIndex, stepOpeningSurvey,
  type IndexProgress, type LibraryIndex, type MatchRuleId, type MaterialPattern, type MaterialSearchResult,
  type OpeningSurvey, type PositionSearchResult, type SearchHit
} from '../../../../../shared/chess/positionSearch'
import { useSurface } from '../../../lib/surfaces'
import { simpleAreaSurface } from '../chessSurfaces'
import './search.css'

/**
 * Position search: have I had this before, and where (Sections 181-186).
 *
 * Three questions, and they are kept apart because they have different answers:
 *
 *   - **By position.** Set a position up and find the games of yours that reached it. The rule is chosen by the
 *     person, the exact one is the default, and a structural result is labelled as one in the result's own words --
 *     not by a colour, and not by a tooltip somebody has to find.
 *   - **By material.** "Rook endings", "opposite-coloured bishops". A class of ending rather than a position.
 *   - **By opening.** The openings that really are in your library, counted, and then the games that reached one.
 *     An opening is one exact position, so this question is only ever asked of the exact index.
 *
 * ## Why the search is stepped rather than simply run
 *
 * The library is read into an index before the first search, and a big library takes long enough that doing it in
 * one go would stop the window answering. So it is read in chunks with a pause between them, the progress is shown
 * while it happens, and the finished index is kept for every later search of the same library. Changing the library
 * throws the kept indexes away rather than answering from a stale one.
 *
 * ## What this screen does not do
 *
 * It does not open a game. It says which game and which move, and hands both to whoever mounted it, because the
 * screen owns what is open on the board.
 */

type Mode = 'position' | 'material' | 'opening'

const MODES = [
  { value: 'position' as const, label: 'By position' },
  { value: 'material' as const, label: 'By material' },
  { value: 'opening' as const, label: 'By opening' }
]

const RULE_OPTIONS = MATCH_RULES.map((rule) => ({
  value: rule.id,
  label: rule.label,
  why: ruleWords(rule)
}))

/** How long to read before letting the window draw. A pause of nothing is still a turn of the event loop. */
const breathe = (): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, 0) })

function message(error: unknown): string {
  if (!(error instanceof Error)) return 'that did not work'
  return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * A move written the way a move list writes it.
 *
 * Worked out from the game's own starting position rather than from the ply alone, because a game that starts from a
 * set-up position can start at move 24 and with Black to play, and "move 1" would be wrong in a way nobody would
 * think to check.
 */
function plyLabel(game: StoredGame, ply: number): string {
  if (ply === 0) return 'the position it starts from'
  const fields = game.startFen.trim().split(/\s+/)
  const firstNumber = Number.parseInt(fields[5] ?? '1', 10) || 1
  const index = ply - 1 + (fields[1] === 'b' ? 1 : 0)
  const number = firstNumber + Math.floor(index / 2)
  const san = game.moves[ply - 1]?.san ?? ''
  return `${number}${index % 2 === 0 ? '.' : '…'} ${san}`.trim()
}

/** The parts of a position that decide what is legal, said in words rather than left as a FEN field. */
function positionFacts(fen: string): string[] {
  const f = fen.trim().split(/\s+/)
  if (f.length < 4) return []
  const out = [f[1] === 'w' ? 'White to move' : 'Black to move']
  if (f[2] === '-' || f[2] === '') out.push('neither side may castle')
  else {
    const bits: string[] = []
    if (f[2].includes('K')) bits.push('White short')
    if (f[2].includes('Q')) bits.push('White long')
    if (f[2].includes('k')) bits.push('Black short')
    if (f[2].includes('q')) bits.push('Black long')
    out.push(`castling: ${bits.join(', ')}`)
  }
  out.push(f[3] === '-' ? 'no en passant square' : `en passant on ${f[3]}`)
  return out
}

export interface PositionSearchProps {
  /**
   * The person's games. When this is left out the component asks for them itself, so it can be mounted on its own.
   */
  games?: readonly StoredGame[]
  /** A position to start from -- the one on the screen's board, when there is one. */
  startFen?: string
  /** Open a game at a move. The ply is 0 for the position the game starts from. */
  onOpen?: (gameId: string, ply: number) => void
  onNotify?: (text: string, kind?: NoticeKind) => void
}

export function PositionSearch({ games: given, startFen, onOpen, onNotify }: PositionSearchProps): React.JSX.Element {
  const [loaded, setLoaded] = useState<readonly StoredGame[] | null>(null)
  const games = given ?? loaded ?? []
  const owns = given === undefined

  const [mode, setMode] = useState<Mode>('position')
  const [rule, setRule] = useState<MatchRuleId>(DEFAULT_RULE)
  const [boardFen, setBoardFen] = useState(startFen && checkFen(startFen).ok ? startFen : START_FEN)
  const [back, setBack] = useState<string[]>([])
  const [orientation, setOrientation] = useState<'w' | 'b'>('w')
  const [pasted, setPasted] = useState('')
  const [fenProblem, setFenProblem] = useState<string | null>(null)
  const [fenNotes, setFenNotes] = useState<string[]>([])

  const [progress, setProgress] = useState<IndexProgress | null>(null)
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<PositionSearchResult | null>(null)
  const [material, setMaterial] = useState<MaterialSearchResult | null>(null)
  const [survey, setSurvey] = useState<OpeningSurvey | null>(null)
  const [openingChosen, setOpeningChosen] = useState<{ key: string; name: string; eco: string } | null>(null)

  /** Finished indexes, one per rule, for the library as it is now. */
  const indexes = useRef(new Map<MatchRuleId, LibraryIndex>())
  /** Bumped to abandon a read that is still going when the library changes or the component goes away. */
  const run = useRef(0)

  /**
   * The notifier, held in a ref.
   *
   * A screen nearly always passes a fresh arrow function, so putting it in an effect's dependencies would make the
   * effect run again on every render of the parent -- and that effect asks for the whole library.
   */
  const notifier = useRef(onNotify)
  useEffect(() => { notifier.current = onNotify }, [onNotify])

  // The component can be mounted on its own, so it can fetch the list itself when nobody hands it one.
  useEffect(() => {
    if (!owns) return
    let alive = true
    void window.api.chessGames()
      .then((all) => { if (alive) setLoaded(all) })
      .catch((error: unknown) => {
        if (!alive) return
        setLoaded([])
        notifier.current?.(`Your games could not be read: ${message(error)}.`, 'error')
      })
    return () => { alive = false }
  }, [owns])

  /**
   * A cheap stamp of the library.
   *
   * Every record's `updatedAt` added up, with how many there are. A game changing, being added or being removed all
   * change it, which is exactly when a kept index stops being an answer about this library.
   */
  const stamp = useMemo(
    () => `${games.length}:${games.reduce((sum, game) => sum + game.updatedAt, 0)}`,
    [games]
  )

  useEffect(() => {
    run.current += 1
    indexes.current.clear()
    setResult(null)
    setMaterial(null)
    setSurvey(null)
    setOpeningChosen(null)
    setProgress(null)
  }, [stamp])

  useEffect(() => () => { run.current += 1 }, [])

  /** The position the board is showing changed, so an answer about the old one is no longer an answer. */
  useEffect(() => { setResult(null); setOpeningChosen(null) }, [boardFen, rule])

  /** A different question. Keeping the old answer under a new heading is how a screen comes to lie. */
  useEffect(() => { setResult(null); setMaterial(null); setOpeningChosen(null) }, [mode])

  const ensureIndex = useCallback(async (wanted: MatchRuleId): Promise<LibraryIndex | null> => {
    const kept = indexes.current.get(wanted)
    if (kept) return kept
    const token = ++run.current
    let build = startIndex(games, wanted)
    setProgress(build.progress)
    while (!build.progress.done) {
      build = stepIndex(build, 150)
      setProgress(build.progress)
      await breathe()
      // The library changed, or this screen went away, while it was being read.
      if (token !== run.current) return null
    }
    indexes.current.set(wanted, build.index)
    setProgress(build.progress)
    return build.index
  }, [games])

  const searchPosition = async (): Promise<void> => {
    if (!games.length) return
    setWorking(true)
    try {
      const index = await ensureIndex(rule)
      if (!index) return
      setOpeningChosen(null)
      setResult(searchIndex(index, boardFen))
    } finally {
      setWorking(false)
    }
  }

  const searchByPattern = async (pattern: MaterialPattern): Promise<void> => {
    if (!games.length) return
    setWorking(true)
    try {
      // Material is counted in the same pass as the positions, so any index will do; the exact one is the one most
      // likely to be kept already.
      const index = await ensureIndex('exact')
      if (!index) return
      setMaterial(searchMaterial(index, pattern))
    } finally {
      setWorking(false)
    }
  }

  const runSurvey = async (): Promise<void> => {
    if (!games.length) return
    setWorking(true)
    const token = ++run.current
    try {
      let build = startOpeningSurvey(games)
      setProgress(build.progress)
      while (!build.progress.done) {
        build = stepOpeningSurvey(build, 50)
        setProgress(build.progress)
        await breathe()
        if (token !== run.current) return
      }
      setSurvey(build.survey)
    } finally {
      setWorking(false)
    }
  }

  const openOpening = async (chosen: { key: string; name: string; eco: string }): Promise<void> => {
    setWorking(true)
    try {
      const index = await ensureIndex('exact')
      if (!index) return
      setOpeningChosen(chosen)
      setResult(searchByKey(index, chosen.key))
    } finally {
      setWorking(false)
    }
  }

  const onMove = (move: ChessMove): void => {
    setBack((was) => [...was, boardFen])
    setBoardFen(move.after)
    setFenNotes([])
    setFenProblem(null)
  }

  const usePasted = (): void => {
    const reading = readFen(pasted)
    if (!reading.ok) {
      setFenProblem(reading.reason ?? 'That is not a position.')
      setFenNotes([])
      return
    }
    const fen = draftToFen(reading.draft)
    const check = checkFen(fen)
    if (!check.ok) {
      // A search does not need a legal position, but a board can only draw one, so this is refused with the reason
      // rather than shown as an empty board.
      setFenProblem(`${check.reason ?? 'That position is not legal.'} The board can only show a legal position.`)
      setFenNotes([])
      return
    }
    setBack((was) => [...was, boardFen])
    setBoardFen(fen)
    setFenProblem(null)
    setFenNotes(reading.notes)
  }

  const copyFen = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(boardFen)
      onNotify?.('The position was copied.')
    } catch {
      onNotify?.('The position could not be copied. It is in the box, ready to select.', 'warn')
    }
  }

  const named = useMemo(() => recordFor(boardFen), [boardFen])
  const facts = useMemo(() => positionFacts(boardFen), [boardFen])
  const chosenRule = MATCH_RULES.find((one) => one.id === rule) ?? MATCH_RULES[0]
  const reading = progress !== null && !progress.done

  const rows = (hits: readonly SearchHit[]): React.JSX.Element => (
    <ul className="cw-search-results">
      {hits.map((hit) => (
        <li key={hit.gameId} className="cw-search-row">
          <div className="cw-search-row-main">
            <strong className="cw-search-row-title">{gameTitle(hit.game)}</strong>
            <small className="cw-search-row-sub">{gameLine(hit.game)}</small>
          </div>
          <div className="cw-search-plies" role="group" aria-label={`Where it happened in ${gameTitle(hit.game)}`}>
            {hit.plies.map((ply) => (
              <button
                key={ply}
                type="button"
                className="cw-search-ply"
                disabled={!onOpen}
                title={onOpen ? undefined : 'This panel was mounted without a way to open a game.'}
                onClick={() => onOpen?.(hit.gameId, ply)}
              >
                {plyLabel(hit.game, ply)}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )

  /*
   * What Orbis itself may do here.
   *
   * The position looked for is a reading rather than a setting: it is built on the board, and nothing on this screen
   * takes one from text in a single step, so a control for it would be a second way of doing it.
   */
  useSurface(
    simpleAreaSurface({
      id: 'find',
      name: 'Find a position',
      about: 'A position, a material pattern or an opening, looked for across your own games.',
      keywords: ['find', 'search', 'position', 'material', 'opening', 'survey', 'look for'],
      controls: {
        mode: {
          name: 'What to look for',
          spec: { type: 'string', description: MODES.map((one) => `${one.value} is ${one.label}`).join('; '), enum: MODES.map((one) => one.value) },
          get: () => mode,
          set: (value) => setMode(String(value) as Mode),
          default: 'position'
        },
        rule: {
          name: 'What counts as the same position',
          spec: { type: 'string', description: RULE_OPTIONS.map((one) => `${one.value} is ${one.label}: ${one.why}`).join('; '), enum: RULE_OPTIONS.map((one) => one.value) },
          get: () => rule,
          set: (value) => setRule(String(value) as MatchRuleId),
          default: DEFAULT_RULE
        },
        position: {
          name: 'The position looked for',
          about: 'The position on the board here, as a FEN. It is built on the board; this is a reading of it.',
          spec: { type: 'string', description: 'The position the search would look for.' },
          get: () => boardFen
        }
      },
      state: () => ({
        mode,
        rule,
        position: boardFen,
        working,
        // Null until the games have been read: nought games and "not read yet" are different things.
        games: loaded === null ? null : loaded.length
      })
    })
  )

  return (
    <div className="cw-search">
      <Segmented
        value={mode}
        options={MODES}
        onChange={setMode}
        label="What to search by"
        className="cw-search-seg"
        optionClass="cw-search-seg-btn"
      />

      <div className="cw-search-cols">
        <section className="cw-search-left" aria-label="The position to look for">
          <Board
            fen={boardFen}
            orientation={orientation}
            interactive
            onMove={onMove}
            label="The position to look for"
          />
          <div className="cw-search-setup">
            <Button size="tiny" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>Turn the board</Button>
            <Button
              size="tiny"
              disabled={back.length === 0}
              onClick={() => {
                setBoardFen(back[back.length - 1])
                setBack((was) => was.slice(0, -1))
              }}
            >
              Back one step
            </Button>
            <Button size="tiny" disabled={boardFen === START_FEN} onClick={() => { setBack((was) => [...was, boardFen]); setBoardFen(START_FEN) }}>
              The usual starting position
            </Button>
            {startFen && checkFen(startFen).ok && startFen !== boardFen && (
              <Button size="tiny" onClick={() => { setBack((was) => [...was, boardFen]); setBoardFen(startFen) }}>
                The position on the board
              </Button>
            )}
          </div>

          <p className="cw-search-faint">{facts.join(' · ')}</p>
          {named
            ? <p className="cw-search-named">The opening dataset calls this {named.name} ({named.eco}).</p>
            : <p className="cw-search-faint">The opening dataset does not name this exact position.</p>}

          <Field
            label="Or paste a position"
            className="cw-search-fen"
            hintClassName="cw-search-faint"
            problem={fenProblem ?? undefined}
            hint="A FEN, as a database or a website writes it. Four parts are enough; the clocks are filled in and you are told when they were."
          >
            {(wiring) => (
              <div className="cw-search-fen-row">
                <input
                  {...wiring}
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  className="cw-search-fen-input"
                  value={pasted}
                  placeholder={START_FEN}
                  onChange={(event) => setPasted(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); usePasted() } }}
                />
                <Button size="tiny" disabled={pasted.trim() === ''} onClick={usePasted}>Use it</Button>
              </div>
            )}
          </Field>
          {fenNotes.map((note) => <p key={note} className="cw-search-note">{note}</p>)}

          <div className="cw-search-fen-row">
            <input
              type="text"
              readOnly
              className="cw-search-fen-input"
              aria-label="The position on this board, as a FEN"
              value={boardFen}
            />
            <Button size="tiny" onClick={() => void copyFen()}>Copy</Button>
          </div>
        </section>

        <section className="cw-search-right" aria-label="The search">
          {mode === 'position' && (
            <>
              <h3 className="cw-search-heading">What counts as the same position</h3>
              <Segmented
                value={rule}
                options={RULE_OPTIONS}
                onChange={setRule}
                label="What counts as the same position"
                className="cw-search-seg"
                optionClass="cw-search-seg-btn"
              />
              <p className="cw-search-faint">{ruleWords(chosenRule)}</p>
              <p className={chosenRule.exact ? 'cw-search-faint' : 'cw-search-caution'}>{chosenRule.caution}</p>
              <div className="cw-search-run">
                <Button
                  kind="primary"
                  size="small"
                  busy={working}
                  busyLabel="Searching…"
                  disabled={games.length === 0}
                  onClick={() => void searchPosition()}
                >
                  Search my games
                </Button>
                {owns && (
                  <Button size="tiny" onClick={() => void window.api.chessGames().then(setLoaded).catch(() => undefined)}>
                    Look for new games
                  </Button>
                )}
              </div>
            </>
          )}

          {mode === 'material' && (
            <>
              <h3 className="cw-search-heading">A class of ending</h3>
              <p className="cw-search-faint">
                These match what is on the board rather than a position, so a result is never an exact match. Each
                one says exactly what it asks for.
              </p>
              <ul className="cw-search-patterns">
                {MATERIAL_PATTERNS.map((pattern) => (
                  <li key={pattern.id}>
                    <button
                      type="button"
                      className={`cw-search-pattern${material?.pattern.id === pattern.id ? ' on' : ''}`}
                      disabled={working || games.length === 0}
                      onClick={() => void searchByPattern(pattern)}
                    >
                      <strong>{pattern.label}</strong>
                      <small>{pattern.says}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {mode === 'opening' && (
            <>
              <h3 className="cw-search-heading">The openings in your library</h3>
              <p className="cw-search-faint">
                Each game is named by the deepest position in it that the opening dataset knows. A game whose
                positions are all outside the dataset is counted as unnamed rather than guessed at.
              </p>
              <div className="cw-search-run">
                <Button
                  kind="primary"
                  size="small"
                  busy={working}
                  busyLabel="Reading…"
                  disabled={games.length === 0}
                  onClick={() => void runSurvey()}
                >
                  {survey ? 'Count them again' : 'Count them'}
                </Button>
                {named && (
                  <Button size="small" busy={working} onClick={() => void openOpening({ key: named.key, name: named.name, eco: named.eco })}>
                    Games that reached {named.name}
                  </Button>
                )}
              </div>
              {survey && (
                <>
                  <p className="cw-search-faint" role="status">
                    {survey.counts.length.toLocaleString()} openings across {survey.games.toLocaleString()} games
                    {survey.unnamed > 0 ? `, and ${survey.unnamed.toLocaleString()} with no opening the dataset knows` : ''}.
                    {' '}Named by {survey.source.dataset}, looking at the first {survey.maxPly} positions of each game.
                  </p>
                  <ul className="cw-search-openings">
                    {survey.counts.map((one) => (
                      <li key={one.key}>
                        <button
                          type="button"
                          className={`cw-search-opening${openingChosen?.key === one.key ? ' on' : ''}`}
                          disabled={working}
                          onClick={() => void openOpening(one)}
                        >
                          <span className="cw-search-eco">{one.eco}</span>
                          <span className="cw-search-opening-name">{one.name}</span>
                          <span className="cw-search-count">{one.games.toLocaleString()}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {reading && progress && (
            <div className="cw-search-reading">
              <p className="cw-search-faint" role="status">{progressWords(progress)}</p>
              <span
                className="cw-search-bar"
                role="progressbar"
                aria-label="Reading your games"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.games}
              >
                <span className="cw-search-bar-fill" style={{ width: `${Math.round((progress.fraction ?? 0) * 100)}%` }} />
              </span>
            </div>
          )}

          {games.length === 0 && (
            <EmptyState>
              There are no games to search yet. Bring in a PGN file, or play one, and the search will have something
              to look through.
            </EmptyState>
          )}

          {mode !== 'material' && result && (
            <div className="cw-search-answer">
              <h3 className="cw-search-heading">
                {openingChosen ? `Games that reached ${openingChosen.name} (${openingChosen.eco})` : 'What was found'}
              </h3>
              <p className={result.exact ? 'cw-search-says' : 'cw-search-caution'} role="status">{resultWords(result)}</p>
              {!result.exact && <p className="cw-search-caution">{result.caution}</p>}
              {skippedWords(result.skipped) && <p className="cw-search-note">{skippedWords(result.skipped)}</p>}
              {result.hits.length > 0
                ? rows(result.hits)
                : !result.problem && <EmptyState>Nothing in your library reached this.</EmptyState>}
            </div>
          )}

          {mode === 'material' && material && (
            <div className="cw-search-answer">
              <h3 className="cw-search-heading">{material.pattern.label}</h3>
              <p className="cw-search-caution" role="status">
                {materialWords(material)} This matches what is on the board, not a position, so it is not an exact match.
              </p>
              <p className="cw-search-faint">
                {material.matched.toLocaleString()} of {material.tested.toLocaleString()} different sets of men in
                your library match it.
              </p>
              {skippedWords(material.skipped) && <p className="cw-search-note">{skippedWords(material.skipped)}</p>}
              {material.hits.length > 0
                ? rows(material.hits)
                : <EmptyState>No game of yours reached this kind of ending.</EmptyState>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default PositionSearch
