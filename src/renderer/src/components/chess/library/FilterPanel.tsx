import type { GameResult } from '../../../../../shared/chess/model'
import type { Facet, LibraryFacets, LibraryFilter, SourceKind } from '../../../../../shared/chess/library'
import './library.css'

/**
 * The controls that narrow the library.
 *
 * Every choice offered here is counted off the games that are actually there, which is the whole reason the counts
 * come in as `facets` rather than being a fixed list: a library with no broadcasts is not offered "a broadcast", and
 * a tag nobody has used is not offered at all. A filter that returns nothing because it was offering something
 * impossible looks exactly like a library that has lost its games.
 *
 * The one deliberate exception is the result row, which always shows all four including "no result recorded". The
 * fourth is not a gap in the data -- plenty of real games stop without one -- and it is the one people look for.
 */
export interface FilterPanelProps {
  filter: LibraryFilter
  facets: LibraryFacets
  onChange: (filter: LibraryFilter) => void
}

const RESULTS: GameResult[] = ['1-0', '1/2-1/2', '0-1', '*']
const RESULT_SHORT: Record<GameResult, string> = { '1-0': '1-0', '1/2-1/2': '½-½', '0-1': '0-1', '*': 'no result' }

/** Adding or removing one value from a list filter, and dropping the list entirely when it empties. */
function toggled<T>(list: T[] | undefined, value: T): T[] | undefined {
  const had = list ?? []
  const next = had.includes(value) ? had.filter((one) => one !== value) : [...had, value]
  return next.length ? next : undefined
}

/** A number typed into a box, or nothing when the box is empty. A half-typed number is not a filter. */
function asCount(text: string): number | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const n = Number.parseInt(trimmed, 10)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function FilterPanel({ filter, facets, onChange }: FilterPanelProps): React.JSX.Element {
  const set = (patch: Partial<LibraryFilter>): void => {
    const next: LibraryFilter = { ...filter, ...patch }
    // An emptied box is not a filter for the empty string; it is no filter.
    for (const key of Object.keys(next) as (keyof LibraryFilter)[]) {
      const value = next[key]
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete next[key]
    }
    onChange(next)
  }

  const chipRow = (
    label: string,
    options: { value: string; label: string; count?: number }[],
    chosen: string[],
    onPick: (value: string) => void
  ): React.JSX.Element | null => {
    if (!options.length) return null
    return (
      <div className="cw-lb-field">
        <label>{label}</label>
        <div className="cw-lb-chips" role="group" aria-label={label}>
          {options.map((one) => (
            <button
              key={one.value}
              type="button"
              className="cw-lb-chip"
              aria-pressed={chosen.includes(one.value)}
              onClick={() => onPick(one.value)}
            >
              {one.label}
              {one.count === undefined ? null : <span className="cw-lb-chip-n"> {one.count}</span>}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="cw-lb-filters">
      <div className="cw-lb-field">
        <label htmlFor="cw-lb-player">Player, either side</label>
        <input
          id="cw-lb-player"
          className="cw-lb-input"
          type="text"
          value={filter.player ?? ''}
          aria-label="Player, either side"
          spellCheck={false}
          onChange={(event) => set({ player: event.target.value })}
        />
      </div>
      <div className="cw-lb-field">
        <label htmlFor="cw-lb-white">White</label>
        <input
          id="cw-lb-white"
          className="cw-lb-input"
          type="text"
          value={filter.white ?? ''}
          aria-label="White"
          spellCheck={false}
          onChange={(event) => set({ white: event.target.value })}
        />
      </div>
      <div className="cw-lb-field">
        <label htmlFor="cw-lb-black">Black</label>
        <input
          id="cw-lb-black"
          className="cw-lb-input"
          type="text"
          value={filter.black ?? ''}
          aria-label="Black"
          spellCheck={false}
          onChange={(event) => set({ black: event.target.value })}
        />
      </div>
      <div className="cw-lb-field">
        <label htmlFor="cw-lb-event">Event</label>
        <input
          id="cw-lb-event"
          className="cw-lb-input"
          type="text"
          value={filter.event ?? ''}
          aria-label="Event"
          spellCheck={false}
          onChange={(event) => set({ event: event.target.value })}
        />
      </div>
      <div className="cw-lb-field">
        <label htmlFor="cw-lb-site">Place</label>
        <input
          id="cw-lb-site"
          className="cw-lb-input"
          type="text"
          value={filter.site ?? ''}
          aria-label="Place"
          spellCheck={false}
          onChange={(event) => set({ site: event.target.value })}
        />
      </div>
      <div className="cw-lb-field">
        <label htmlFor="cw-lb-opening">Opening or ECO code</label>
        <input
          id="cw-lb-opening"
          className="cw-lb-input"
          type="text"
          value={filter.opening ?? ''}
          aria-label="Opening or ECO code"
          spellCheck={false}
          onChange={(event) => set({ opening: event.target.value })}
        />
      </div>

      <div className="cw-lb-field">
        <label htmlFor="cw-lb-from">Played between</label>
        <div className="cw-lb-two">
          <input
            id="cw-lb-from"
            className="cw-lb-input"
            type="text"
            value={filter.from ?? ''}
            placeholder="2021"
            aria-label="Played no earlier than"
            spellCheck={false}
            onChange={(event) => set({ from: event.target.value })}
          />
          <input
            className="cw-lb-input"
            type="text"
            value={filter.to ?? ''}
            placeholder="2024.06"
            aria-label="Played no later than"
            spellCheck={false}
            onChange={(event) => set({ to: event.target.value })}
          />
        </div>
      </div>

      <div className="cw-lb-field">
        <label htmlFor="cw-lb-minmoves">Number of moves</label>
        <div className="cw-lb-two">
          <input
            id="cw-lb-minmoves"
            className="cw-lb-input"
            type="number"
            min={0}
            value={filter.minMoves ?? ''}
            placeholder="at least"
            aria-label="At least this many moves"
            onChange={(event) => set({ minMoves: asCount(event.target.value) })}
          />
          <input
            className="cw-lb-input"
            type="number"
            min={0}
            value={filter.maxMoves ?? ''}
            placeholder="at most"
            aria-label="At most this many moves"
            onChange={(event) => set({ maxMoves: asCount(event.target.value) })}
          />
        </div>
      </div>

      {chipRow(
        'Result',
        RESULTS.map((result) => ({
          value: result,
          label: RESULT_SHORT[result],
          count: facets.results.find((one) => one.value === result)?.count ?? 0
        })),
        filter.results ?? [],
        (value) => set({ results: toggled(filter.results, value as GameResult) })
      )}

      {chipRow(
        'Where it came from',
        facets.sources.map((one: Facet) => ({ value: one.value, label: one.label, count: one.count })),
        filter.sources ?? [],
        (value) => set({ sources: toggled(filter.sources, value as SourceKind) })
      )}

      {/* Offered only when there is more than one, because "variant: standard" is not a choice anybody needs. */}
      {facets.variants.length > 1 && chipRow(
        'Variant',
        facets.variants.map((one) => ({ value: one.value, label: one.label, count: one.count })),
        filter.variants ?? [],
        (value) => set({ variants: toggled(filter.variants, value) })
      )}

      {chipRow(
        'Starred',
        [{ value: 'yes', label: 'starred', count: facets.favourites }, { value: 'no', label: 'not starred', count: facets.total - facets.favourites }],
        filter.favourite === undefined ? [] : [filter.favourite ? 'yes' : 'no'],
        (value) => {
          const want = value === 'yes'
          set({ favourite: filter.favourite === want ? undefined : want })
        }
      )}

      {chipRow(
        'Notes written on the moves',
        [{ value: 'yes', label: 'has notes', count: facets.annotated }, { value: 'no', label: 'no notes', count: facets.total - facets.annotated }],
        filter.annotated === undefined ? [] : [filter.annotated ? 'yes' : 'no'],
        (value) => {
          const want = value === 'yes'
          set({ annotated: filter.annotated === want ? undefined : want })
        }
      )}

      {chipRow(
        'Year',
        facets.years.slice(0, 24).map((one) => ({ value: one.value, label: one.label, count: one.count })),
        // A year chip is the date range set to that whole year, so it means the same thing as typing it.
        filter.from === filter.to && filter.from !== undefined ? [filter.from] : [],
        (value) => {
          const already = filter.from === value && filter.to === value
          set({ from: already ? undefined : value, to: already ? undefined : value })
        }
      )}
    </div>
  )
}
