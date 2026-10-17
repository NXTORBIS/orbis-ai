import { useMemo, useState } from 'react'
import { EmptyState, SearchBox } from '../../../ui'
import {
  OPENING_SOURCE, explore, identify, searchOpenings, transposition, type Identification
} from '../../../../../shared/chess/openings'
import { START_FEN } from '../../../../../shared/chess/rules'

/**
 * What the dataset knows about the position in front of you.
 *
 * Three honesty rules shape this panel, and they are the reason it looks plainer than an opening explorer usually
 * does (Sections 134-138):
 *
 *   - **The name always carries its source.** The dataset, its licence and the version it came from are on screen,
 *     because "the Italian Game" is a claim and a person is entitled to know who is making it.
 *   - **There are no numbers.** This dataset counts no games, so there is no popularity column, no win rate and no
 *     bar. The panel says so once, plainly, instead of showing a column of zeroes or a made-up ordering.
 *   - **Unknown is shown as unknown.** A position the dataset has never heard of says that, and says how many legal
 *     moves from here lead somewhere it has never heard of either.
 */

export interface OpeningExplorerProps {
  fen: string
  /** The moves that led here, so a name can come from an earlier position and a transposition can be explained. */
  playedLine: string[]
  onPlay: (san: string) => void
  onLoadLine: (sans: string[], turnTo?: 'w' | 'b') => void
  busy?: boolean
}

const shortVersion = (version: string): string => version.slice(0, 7)

function Named({ named, atStart }: { named: Identification; atStart: boolean }): React.JSX.Element {
  /**
   * Nothing has been played yet.
   *
   * The dataset has no entry for the starting position -- it lists openings, and no moves is not one -- so asking it
   * returns "not in the dataset", and this panel opened with that as its heading, in the styling meant for an
   * unnamed position, over a board nobody had touched. The explorer was working: the twenty continuations below it
   * were right. It was the first thing a person read that said the screen was broken. The refusal's second sentence
   * was worse, explaining that the moves leading here were not given, when there are none.
   */
  if (atStart && !named.known && named.problem === 'not-in-dataset') {
    return (
      <div className="cw-ol-named">
        <p className="cw-ol-name">The ordinary starting position</p>
        <p className="cw-ol-faint">Play a move, or pick a continuation below, and the dataset will name where you are.</p>
      </div>
    )
  }
  if (!named.known) {
    // "The dataset has no name for this" and "this is not a position" are different things and must not share a
    // heading: the first is ordinary, the second means the board is holding something impossible.
    const title = named.problem === 'not-in-dataset' ? 'Not in the dataset' : 'This position cannot be used'
    return (
      <div className="cw-ol-named is-unknown">
        <p className="cw-ol-name">{title}</p>
        <p className="cw-ol-faint">{named.reason}</p>
      </div>
    )
  }
  return (
    <div className="cw-ol-named">
      <p className="cw-ol-name">
        <span className="cw-ol-eco">{named.eco}</span> {named.name}
      </p>
      <p className="cw-ol-faint">
        {named.exact
          ? named.ply === undefined
            ? 'This exact position is the one the dataset names.'
            : `Named at move ${Math.floor((named.ply - 1) / 2) + 1}${named.ply % 2 === 0 ? '…' : ''}, which is the position in front of you.`
          : `The dataset stops naming positions after move ${Math.floor(((named.ply ?? 1) - 1) / 2) + 1}${(named.ply ?? 1) % 2 === 0 ? '…' : ''}, so this is still that opening but not the named position itself.`}
      </p>
    </div>
  )
}

export function OpeningExplorer({ fen, playedLine, onPlay, onLoadLine, busy }: OpeningExplorerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const result = useMemo(() => explore(fen), [fen])
  /**
   * The name, asked for in the better of the two ways available.
   *
   * With the moves, an opening can keep its name past the last position the dataset lists, which is how a chess
   * player names one. With only the position -- which is all there is when the board came from somewhere else -- the
   * answer can only be exact, and `identify` says as much in its refusal rather than pretending otherwise.
   */
  const named = useMemo(
    () => (playedLine.length ? identify({ moves: playedLine }) : result.position),
    [result, playedLine]
  )
  const found = useMemo(() => (query.trim() ? searchOpenings(query, 12) : []), [query])
  /** A position a game could not be in has no continuations to list, and a count of zero would read as an answer. */
  const refused = !result.position.known && result.position.problem !== 'not-in-dataset'

  /**
   * Why the move order you played and the dataset's own order meet.
   *
   * Only asked when they really differ. The answer comes from `transposition`, which compares position keys, so what
   * is shown is the reason the two orders are the same position rather than a guess that they probably are.
   */
  const meeting = useMemo(() => {
    if (!named.known || !named.transposedFrom || named.ply === undefined) return null
    return { check: transposition(playedLine.slice(0, named.ply), named.record.line), order: named.transposedFrom }
  }, [named, playedLine])

  return (
    <div className="cw-ol-pane">
      <Named named={named} atStart={playedLine.length === 0 && fen === START_FEN} />

      {meeting?.check.same && (
        <details className="cw-ol-trans">
          <summary>You reached this by a different move order</summary>
          <p className="cw-ol-faint">{meeting.check.reason}</p>
          <p className="cw-ol-faint">The dataset's own order: {meeting.order.join(' ')}</p>
        </details>
      )}

      <section aria-label="Continuations the dataset knows">
        <h4 className="cw-ol-h">From here</h4>
        {refused
          ? <p className="cw-ol-faint">There is nothing to explore from a position a game could not be in.</p>
          : result.moves.length === 0
          ? (
            <EmptyState>
              No named continuation. None of the {result.legal} legal moves reaches a named position.
            </EmptyState>
          )
          : (
            <>
              <ul className="cw-ol-moves">
                {result.moves.map((move) => (
                  <li key={move.uci}>
                    <button type="button" className="cw-ol-move" onClick={() => onPlay(move.san)} disabled={busy}>
                      <span className="cw-ol-movesan">{move.san}</span>
                      <span className="cw-ol-moveeco">{move.record.eco}</span>
                      <span className="cw-ol-movename">{move.record.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="cw-ol-count">
                <span>{result.moves.length} named</span>
                {result.unnamed > 0 && <span className="cw-ol-count-rest"> · {result.unnamed} unnamed</span>}
                <span className="cw-ol-count-rest"> of {result.legal} legal</span>
              </p>
            </>
          )}
        {/*
          * Why there is no popularity column, said once as a mark you can read rather than as a line of body text
          * under the moves. The full sentence is the tooltip and the screen-reader name, so nothing is lost.
          */}
        {!refused && (
          <span className="cw-ol-order" title={result.statistics.why} aria-label={result.statistics.why}>
            Alphabetical — this dataset counts no games
          </span>
        )}
      </section>

      <section aria-label="Find an opening by name">
        <h4 className="cw-ol-h">Find an opening</h4>
        <SearchBox value={query} onChange={setQuery} label="Find an opening by name or ECO code" small />
        {query.trim() && (
          found.length === 0
            ? <EmptyState>Nothing in the dataset is called that. Try part of a name, or an ECO code such as B90.</EmptyState>
            : (
              <ul className="cw-ol-found">
                {found.map((one) => (
                  <li key={`${one.record.eco}-${one.record.key}`}>
                    <button
                      type="button"
                      className="cw-ol-founditem"
                      onClick={() => onLoadLine(one.record.line)}
                      disabled={busy}
                    >
                      <strong><span className="cw-ol-eco">{one.record.eco}</span> {one.record.name}</strong>
                      <small>{one.record.line.join(' ')}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )
        )}
      </section>

      {/*
        * Who is making the claim, behind a disclosure.
        *
        * It used to be four lines of small print under every position, which is a paragraph where a board should
        * be. It is still here in full, and still one press away, because "the Italian Game" is a claim and a person
        * is entitled to know who is making it -- but the summary says the dataset's name and the count, which is
        * what a reader wants at a glance.
        */}
      <details className="cw-ol-source">
        <summary>
          Named by {OPENING_SOURCE.dataset} — {OPENING_SOURCE.entries.toLocaleString()} named positions, no game counts
        </summary>
        <p className="cw-ol-faint">
          {OPENING_SOURCE.licence}, version {shortVersion(OPENING_SOURCE.version)} of {OPENING_SOURCE.versionDate},
          fetched {OPENING_SOURCE.retrieved}. It carries no game counts, so nothing here is ordered by how often it is
          played.
        </p>
      </details>
    </div>
  )
}
