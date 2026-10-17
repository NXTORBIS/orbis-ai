import { useMemo } from 'react'
import { Button, EmptyState } from '../../../ui'
import type { PuzzleStore, PuzzleTheme } from '../../../../../shared/chess/puzzles'
import {
  shelfShare, shelfWords, solveProgress, themeShelves, themeStrength, type ThemeShelf
} from '../../../../../shared/chess/puzzleThemes'

/**
 * The shelves: what kinds of puzzle somebody has, how many of each, and how far through each they are.
 *
 * ## Why this is a grid of cards and not a list of sentences
 *
 * Because the question it answers is "what shall I work on", and that is a looking question. Each card carries the
 * four numbers that answer it -- how many there are, how many solved, how many went wrong, how many never tried --
 * a bar for the share solved, and a button that opens the next one of that kind. Nothing on a card is a paragraph.
 *
 * ## Every shelf here exists because puzzles exist
 *
 * `themeShelves` only returns a theme at least one puzzle in the collection carries. There is no shelf for forks
 * sitting at nought waiting to be filled: a kind of puzzle nobody has is not a kind of puzzle Orbis pretends to
 * offer. So an empty collection shows the one honest thing -- there is nothing here -- and the way to fill it.
 *
 * ## The two kinds of number are drawn apart
 *
 * The share solved is about the collection. How somebody does at that kind of puzzle is about the person, is
 * counted over goes rather than over puzzles, and refuses to give any share until there have been enough of them.
 * A card with four goes behind it says how many goes there were and stops there.
 */

export interface ThemesProps {
  store: PuzzleStore
  /** Open one puzzle. The id is the shelf's own next one. */
  onOpen: (id: string) => void
  /** Narrow the solve list to this theme, for somebody who would rather pick from a list. */
  onFilter: (theme: PuzzleTheme) => void
  /** Offered when there is nothing here yet. */
  onMakePuzzles?: () => void
  /** Show a shelf's next puzzle on the board while it is pointed at, so the board is never idle. */
  onPreview?: (id: string) => void
}

function Shelf({ shelf, store, onOpen, onFilter, onPreview }: {
  shelf: ThemeShelf
  store: PuzzleStore
  onOpen: (id: string) => void
  onFilter: (theme: PuzzleTheme) => void
  onPreview?: (id: string) => void
}): React.JSX.Element {
  const strength = themeStrength(store, shelf.theme)
  const share = shelfShare(shelf)
  return (
    <li
      className="cw-pz-shelf"
      onMouseEnter={() => { if (shelf.nextId !== null) onPreview?.(shelf.nextId) }}
      onFocus={() => { if (shelf.nextId !== null) onPreview?.(shelf.nextId) }}
    >
      <div className="cw-pz-shelf-top">
        <strong className="cw-pz-shelf-name" title={shelf.meaning}>{shelf.label}</strong>
        <span className="cw-pz-shelf-total">{shelf.total}</span>
      </div>

      {/* The bar is never the only thing saying it: the counts under it say the same in figures and in words. */}
      <div
        className="cw-pz-shelf-bar"
        role="img"
        aria-label={`${shelf.label}: ${shelfWords(shelf)}`}
      >
        <span className="cw-pz-shelf-fill" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>

      <ul className="cw-pz-shelf-counts">
        <li className="is-solved"><b>{shelf.solved}</b> solved</li>
        {shelf.missed > 0 && <li className="is-missed"><b>{shelf.missed}</b> went wrong</li>}
        {shelf.untried > 0 && <li className="is-untried"><b>{shelf.untried}</b> not tried</li>}
      </ul>

      <p className={`cw-pz-shelf-strength is-${strength.kind}`}>{strength.says}</p>

      {/* Where the theme came from. A shelf Orbis proved and a shelf a source merely claimed must not look alike. */}
      <p className="cw-pz-shelf-proof" title={shelf.cannotProve ?? undefined}>
        {shelf.byConvention
          ? 'Counted off the board by a rule of Orbis’s own.'
          : shelf.proved === shelf.total
            ? 'Proved from the position.'
            : shelf.proved === 0
              ? 'Said by whoever these came from. Nothing here checked it.'
              : `${shelf.proved} of ${shelf.total} proved from the position.`}
      </p>

      <div className="cw-pz-shelf-row">
        {shelf.nextId !== null && (
          <Button size="tiny" kind="primary" onClick={() => onOpen(shelf.nextId as string)}>Solve one</Button>
        )}
        <Button size="tiny" kind="quiet" onClick={() => onFilter(shelf.theme)}>See all {shelf.total}</Button>
      </div>
    </li>
  )
}

export function Themes({ store, onOpen, onFilter, onMakePuzzles, onPreview }: ThemesProps): React.JSX.Element {
  const shelves = useMemo(() => themeShelves(store), [store])
  const progress = useMemo(() => solveProgress(store), [store])

  if (shelves.length === 0) {
    return (
      <EmptyState action={onMakePuzzles ? <Button size="small" kind="primary" onClick={onMakePuzzles}>Make some from my games</Button> : undefined}>
        There are no puzzles here yet, so there are no kinds to pick from. A shelf appears when a puzzle carrying
        that idea is in your collection.
      </EmptyState>
    )
  }

  return (
    <div className="cw-pz-themes-pane">
      {/* The whole collection in five figures, so the shelves below are read against something. */}
      <dl className="cw-pz-tally">
        <div><dt>Puzzles</dt><dd>{progress.puzzles}</dd></div>
        <div><dt>Solved</dt><dd>{progress.solved}</dd></div>
        <div><dt>Went wrong</dt><dd>{progress.missed}</dd></div>
        <div><dt>Not tried</dt><dd>{progress.untried}</dd></div>
        <div><dt>Clean solves</dt><dd>{progress.clean}</dd></div>
      </dl>

      <ul className="cw-pz-shelves">
        {shelves.map((shelf) => (
          <Shelf key={shelf.theme} shelf={shelf} store={store} onOpen={onOpen} onFilter={onFilter} onPreview={onPreview} />
        ))}
      </ul>
    </div>
  )
}

export default Themes
