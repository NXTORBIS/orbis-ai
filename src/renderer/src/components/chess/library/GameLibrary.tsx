import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, FileDown, SlidersHorizontal, Star, Tag, Trash, Upload, X } from 'lucide-react'
import { Button, EmptyState, SearchBox, Segmented } from '../../../ui'
import type { NoticeKind } from '../../../lib/notices'
import { fenAt, type StoredGame } from '../../../../../shared/chess/model'
import {
  describeFilter, facetsOf, filterGames, nextTags, withoutPart,
  type LibraryFilter
} from '../../../../../shared/chess/library'
import {
  NOTHING_YET, WHO_ENGINE_GAMES, archiveNumbers, archiveRows, engineGameCount, namesIn, sortRows, suggestWho,
  type ArchiveColumn, type ArchiveRow, type Who
} from '../../../../../shared/chess/archive'
import { readSurfaceControl, writeSurfaceControl } from '../../../lib/surfaces'
import { ChessStage } from '../ChessStage'
import { MoveList, MoveNav } from '../MoveList'
import { ArchiveTable } from './ArchiveTable'
import { GameCard } from './GameCard'
import { NumbersPanel } from './NumbersPanel'
import { openingLookup } from './openingLookup'
import { FilterPanel } from './FilterPanel'
import { TagSheet } from './TagSheet'
import { DeleteSheet } from './DeleteSheet'
import { ImportSheet } from './ImportSheet'
import { DuplicateSheet } from './DuplicateSheet'
import { useSurface } from '../../../lib/surfaces'
import { simpleAreaSurface } from '../chessSurfaces'
import './library.css'

/**
 * Your games, and your numbers.
 *
 * Two screens over one archive: a table of every game you own with the board showing whichever one you are looking
 * at, and a page of figures counted off those same games.
 *
 * ## What changed, and why
 *
 * This area used to be rows of sentences with no chess board anywhere in it -- a page of text about chess, in the
 * part of Chess World that holds all of your chess. Now the board is the biggest thing on both screens, drawn by
 * the shared `ChessStage` which measures the room and hands it a pixel size, so it grows with the window instead of
 * settling at the old shrink-to-fit 357 pixels. The sentences became a sortable table: a sentence cannot be sorted,
 * scanned down or compared with the one above it, and this screen's whole job is finding one game among hundreds.
 *
 * ## Three things this file owns
 *
 * **Who "you" are.** A saved game names two players; it does not say which one is the person sitting here. So the
 * name is picked from the names that really appear in these games, and until it is settled nothing is attributed to
 * anybody: no colour split, no score, no mistake count. The picker is at the top of both screens and says which
 * name is in use, so no figure on either screen is anonymous.
 *
 * **What a press means.** The tick box, the star and the row are three controls. Pressing a row puts the game on
 * the board; pressing it twice opens it. A row where one press both picked and opened is how the wrong games get
 * deleted.
 *
 * **What it says when it has nothing.** A library with no games, a filter that matches nothing, and a library that
 * could not be read are three different situations, and none of them is shown as the same blank panel.
 *
 * The counting is all in `src/shared/chess/archive.ts` and `library.ts`, tested there without a window.
 */

/** How many rows are on screen at once. A thousand table rows is a screen that takes seconds to appear. */
const PAGE_SIZE = 100

/**
 * The columns of the table, in order. Every one of them is something a game record really carries, and a game that
 * does not carry one gets a dash with a title saying so. When the table has less room than the columns need the box
 * scrolls sideways rather than dropping a column quietly.
 */
const COLUMNS: ArchiveColumn[] = ['outcome', 'opponent', 'colour', 'opening', 'moves', 'ended', 'date', 'rating']

/** The path of Chess World's own "which area is open" control, which is how the report screen is reached. */
const AREA_CONTROL = 'chess/area'

export interface GameLibraryProps {
  /** Every game the profile has, as `window.api.chessGames()` gave them. */
  games: StoredGame[]
  /** True while that call is still out. Distinct from "there are none". */
  loading?: boolean
  /** Why the games could not be read, when they could not. Never a blank panel instead. */
  error?: string | null
  /** Read the games again. Called after anything in here changes them. */
  onReload: () => Promise<void> | void
  /** Open one on the analysis board, at a move when one is given. */
  onOpen: (id: string, ply?: number) => void
  /** Which one is open, so the list can mark it. */
  openId?: string | null
  onNotify: (text: string, kind?: NoticeKind) => void
}

export default function GameLibrary({ games, loading = false, error = null, onReload, onOpen, openId = null, onNotify }: GameLibraryProps): React.JSX.Element {
  const [tab, setTab] = useState<'games' | 'numbers'>('games')
  const [filter, setFilter] = useState<LibraryFilter>({})
  const [column, setColumn] = useState<ArchiveColumn>('date')
  const [direction, setDirection] = useState<'up' | 'down'>('down')
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(0)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<'tags' | 'delete' | 'import' | 'duplicates' | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [ply, setPly] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [who, setWho] = useState<Who | null>(null)
  const [whoSettled, setWhoSettled] = useState(false)
  const lastPicked = useRef<string | null>(null)

  // One lookup for the whole screen, so the openings dataset answers each game once however many lists ask.
  const lookup = useMemo(() => openingLookup(), [])

  const facets = useMemo(() => facetsOf(games), [games])
  const names = useMemo(() => namesIn(games), [games])
  const enginePlayed = useMemo(() => engineGameCount(games), [games])

  /*
   * The first guess at who you are, made once.
   *
   * Only once: after that the choice is the person's, and a reload of the games must not quietly change whose
   * numbers are on screen.
   */
  useEffect(() => {
    if (whoSettled || games.length === 0) return
    setWho(suggestWho(games))
    setWhoSettled(true)
  }, [games, whoSettled])

  const filtered = useMemo(() => filterGames(games, filter), [games, filter])
  const rows = useMemo(() => archiveRows(filtered, who, lookup), [filtered, who, lookup])
  const ordered = useMemo(() => sortRows(rows, column, direction), [rows, column, direction])
  const numbers = useMemo(() => archiveNumbers(archiveRows(games, who, lookup)), [games, who, lookup])

  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE))
  const here = Math.min(page, pages - 1)
  const shown = useMemo(() => ordered.slice(here * PAGE_SIZE, here * PAGE_SIZE + PAGE_SIZE), [ordered, here])

  // A changed filter or a changed order is a different list, so the place kept in the old one means nothing.
  const listSignature = `${JSON.stringify(filter)}|${column}|${direction}`
  useEffect(() => { setPage(0) }, [listSignature])

  // A selection may not outlive the games in it: a bulk action over ids that are gone would silently do less.
  useEffect(() => {
    setPicked((had) => {
      if (!had.length) return had
      const there = new Set(games.map((one) => one.id))
      const kept = had.filter((id) => there.has(id))
      return kept.length === had.length ? had : kept
    })
  }, [games])

  /** The row on the board. The newest matching game when nothing has been pressed, so the board is never empty. */
  const onBoard: ArchiveRow | null = useMemo(() => {
    const found = selected === null ? null : rows.find((one) => one.id === selected) ?? null
    return found ?? ordered[0] ?? null
  }, [selected, rows, ordered])

  // A different game is a different game: the move you were on in the last one means nothing in this one.
  const boardId = onBoard?.id ?? null
  useEffect(() => { setPly(onBoard ? onBoard.moves : 0) }, [boardId])

  const pickedSet = useMemo(() => new Set(picked), [picked])
  const pickedGames = useMemo(() => games.filter((one) => pickedSet.has(one.id)), [games, pickedSet])

  const run = useCallback(async (work: () => Promise<string | null>): Promise<void> => {
    setBusy(true)
    try {
      const said = await work()
      await onReload()
      if (said) onNotify(said)
    } catch (err) {
      const message = err instanceof Error
        ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        : 'That did not work.'
      onNotify(message, 'error')
    } finally {
      setBusy(false)
    }
  }, [onNotify, onReload])

  /** Picking a row, and picking a run of them with Shift. */
  const pick = (id: string, want: boolean, shiftHeld: boolean): void => {
    const visible = shown.map((one) => one.id)
    if (shiftHeld && lastPicked.current && visible.includes(lastPicked.current) && visible.includes(id)) {
      const from = visible.indexOf(lastPicked.current)
      const to = visible.indexOf(id)
      const stretch = visible.slice(Math.min(from, to), Math.max(from, to) + 1)
      setPicked((had) => (want ? [...new Set([...had, ...stretch])] : had.filter((one) => !stretch.includes(one))))
      lastPicked.current = id
      return
    }
    lastPicked.current = id
    setPicked((had) => (want ? [...new Set([...had, id])] : had.filter((one) => one !== id)))
  }

  const said = describeFilter(filter)
  const allPickedOnPage = shown.length > 0 && shown.every((one) => pickedSet.has(one.id))

  const star = (ids: string[], favourite: boolean): void => {
    void run(async () => {
      for (const id of ids) await window.api.chessUpdate(id, { favourite })
      return ids.length === 1
        ? favourite ? 'Starred.' : 'No longer starred.'
        : `${ids.length} games ${favourite ? 'starred' : 'no longer starred'}.`
    })
  }

  const exportGames = (ids: string[]): void => {
    void run(async () => {
      const path = await window.api.chessExportPgn(ids)
      // No path means the save was called off, which is not a failure and must not be reported as a success.
      return path ? `Saved ${ids.length === 1 ? 'the game' : `${ids.length} games`} to ${path}` : 'Nothing was saved.'
    })
  }

  const applyTags = (change: { add: string[]; remove: string[] }): void => {
    const ids = pickedGames.map((one) => one.id)
    void run(async () => {
      // Worked out per game: two games in a selection rarely have the same tags, and writing one list over all of
      // them would quietly throw away tags that were only on some.
      for (const game of pickedGames) {
        await window.api.chessUpdate(game.id, { tags: nextTags(game.tags, change.add, change.remove) })
      }
      setSheet(null)
      return `${ids.length === 1 ? 'The game has' : `${ids.length} games have`} been retagged.`
    })
  }

  const removePicked = (): void => {
    const ids = pickedGames.map((one) => one.id)
    void run(async () => {
      let gone = 0
      for (const id of ids) if (await window.api.chessRemove(id)) gone += 1
      setSheet(null)
      setPicked([])
      // What really went, not what was asked for: a record already removed elsewhere must not be counted.
      return gone === ids.length
        ? `${gone === 1 ? 'The game was' : `${gone} games were`} removed.`
        : `${gone} of ${ids.length} were removed; the rest were already gone.`
    })
  }

  /*
   * Opening the selected game in Game Review.
   *
   * The Library is handed one way out -- open a game on the analysis board -- and the report is a different screen
   * of Chess World. Rather than invent a second route, this asks Chess World's own "which area is open" control,
   * the same one Orion and the browser use. The button is only drawn when that control really exists and really
   * accepts `review`, so there is never a button here that looks live and does nothing.
   */
  const reviewReachable = useMemo(() => {
    const control = readSurfaceControl(AREA_CONTROL)
    return 'ok' in control && control.ok === true && control.writable && (control.values ?? []).includes('review')
  }, [tab, onBoard?.id])

  const openReport = (id: string, atPly: number): void => {
    onOpen(id, atPly)
    void writeSurfaceControl(AREA_CONTROL, 'review').then((outcome) => {
      // Said only when it did not happen. A screen that silently stayed put is the fault being fixed.
      if (outcome.status !== 'completed') onNotify(`The report screen did not open. ${outcome.detail}`, 'error')
    })
  }

  /** The table, the pager and the controls over them: the left column of the stage. */
  const tableSide = (): React.JSX.Element => {
    if (loading && games.length === 0) return <p className="cw-lb-count" role="status">Reading your games…</p>
    if (error !== null) {
      return (
        <EmptyState action={<Button size="small" onClick={() => void onReload()}>Try again</Button>}>
          Your games could not be read. {error} Nothing has been changed or lost; this is Orbis failing to read the
          file, not the file being empty.
        </EmptyState>
      )
    }
    if (games.length === 0) {
      return (
        <EmptyState action={<Button size="small" kind="primary" onClick={() => setSheet('import')}>Bring in games</Button>}>
          There are no games here yet. Bring in a PGN file, or play one on the board and it will appear here.
        </EmptyState>
      )
    }
    if (ordered.length === 0) {
      return (
        <EmptyState action={<Button size="small" onClick={() => setFilter({})}>Clear the filter</Button>}>
          None of your {facets.total} games match this. {said.map((one) => one.words).join(', ')}.
        </EmptyState>
      )
    }
    return (
      <>
        {/*
          * The groups, as a row of pills with their counts on them.
          *
          * They used to be a 216px column of names down the side of the area, which is a third of the room taken
          * from the thing this screen is about. Every count on a pill is a real count from `facetsOf`.
          */}
        <div className="cw-lb-pills" role="group" aria-label="Which games to show">
          <button type="button" className="cw-lb-pill" aria-pressed={said.length === 0} onClick={() => setFilter({})}>
            All games <span className="cw-lb-pill-n">{facets.total}</span>
          </button>
          <button
            type="button"
            className="cw-lb-pill"
            aria-pressed={filter.favourite === true}
            onClick={() => setFilter(filter.favourite === true ? withoutPart(filter, 'favourite') : { ...filter, favourite: true })}
          >
            Starred <span className="cw-lb-pill-n">{facets.favourites}</span>
          </button>
          <button
            type="button"
            className="cw-lb-pill"
            aria-pressed={filter.annotated === true}
            onClick={() => setFilter(filter.annotated === true ? withoutPart(filter, 'annotated') : { ...filter, annotated: true })}
          >
            With notes <span className="cw-lb-pill-n">{facets.annotated}</span>
          </button>
          {facets.collections.map((one) => (
            <button
              key={`c${one.value}`}
              type="button"
              className="cw-lb-pill is-collection"
              aria-pressed={(filter.collections ?? []).includes(one.label)}
              onClick={() => setFilter((filter.collections ?? []).includes(one.label)
                ? withoutPart(filter, 'collections')
                : { ...filter, collections: [one.label] })}
            >
              {one.label} <span className="cw-lb-pill-n">{one.count}</span>
            </button>
          ))}
          {facets.tags.slice(0, 12).map((one) => (
            <button
              key={`t${one.value}`}
              type="button"
              className="cw-lb-pill"
              aria-pressed={(filter.tags ?? []).includes(one.label)}
              onClick={() => setFilter((filter.tags ?? []).includes(one.label)
                ? withoutPart(filter, 'tags')
                : { ...filter, tags: [one.label] })}
            >
              {one.label} <span className="cw-lb-pill-n">{one.count}</span>
            </button>
          ))}
        </div>
        <ArchiveTable
          rows={shown}
          columns={COLUMNS}
          column={column}
          direction={direction}
          onSort={(next) => {
            if (next === column) setDirection(direction === 'up' ? 'down' : 'up')
            else { setColumn(next); setDirection(next === 'moves' || next === 'rating' ? 'down' : next === 'date' ? 'down' : 'up') }
          }}
          selected={onBoard?.id ?? null}
          onSelect={setSelected}
          onOpen={(id) => onOpen(id)}
          picked={pickedSet}
          onPick={pick}
          onStar={(id, favourite) => star([id], favourite)}
          busy={busy}
        />
        <div className="cw-lb-pager">
          <Button
            size="tiny"
            onClick={() => {
              const visible = shown.map((one) => one.id)
              setPicked((had) => (allPickedOnPage ? had.filter((one) => !visible.includes(one)) : [...new Set([...had, ...visible])]))
            }}
          >
            {allPickedOnPage ? 'Unpick this page' : 'Pick this page'}
          </Button>
          {ordered.length > shown.length && (
            <Button size="tiny" onClick={() => setPicked(ordered.map((one) => one.id))}>Pick all {ordered.length}</Button>
          )}
          <span className="cw-lb-pager-words" role="status">
            {ordered.length <= PAGE_SIZE
              ? `${ordered.length} ${ordered.length === 1 ? 'game' : 'games'}`
              : `${here * PAGE_SIZE + 1}–${here * PAGE_SIZE + shown.length} of ${ordered.length}`}
          </span>
          <Button
            size="tiny"
            icon={<ChevronLeft size={13} aria-hidden="true" />}
            disabled={here === 0}
            aria-label="The page before this one"
            onClick={() => setPage(here - 1)}
          >
            Back
          </Button>
          <Button
            size="tiny"
            icon={<ChevronRight size={13} aria-hidden="true" />}
            disabled={here >= pages - 1}
            aria-label="The next page"
            onClick={() => setPage(here + 1)}
          >
            Next
          </Button>
        </div>
      </>
    )
  }

  /** Who the numbers are about, said plainly, with the picker beside it. */
  const whoWords = who === null
    ? 'Nobody is picked yet, so nothing is counted. Pick which player in these games is you.'
    : who.name === null
      ? `Counted from the ${enginePlayed} ${enginePlayed === 1 ? 'game' : 'games'} Orbis played against the engine, where it knows which side you were.`
      : `Counted from the games where ${who.name} is one of the two players.`

  const whoPicker = (
    <div className="cw-lb-who">
      <label className="cw-lb-who-label" htmlFor="cw-lb-who-pick">You are</label>
      <select
        id="cw-lb-who-pick"
        className="cw-lb-pick"
        value={who === null ? '' : who.name === null ? '\u0000engine' : who.name}
        onChange={(event) => {
          const value = event.target.value
          setWhoSettled(true)
          setWho(value === '' ? null : value === '\u0000engine' ? WHO_ENGINE_GAMES : { name: value })
        }}
      >
        <option value="">nobody picked</option>
        {enginePlayed > 0 && <option value={'\u0000engine'}>whoever played the engine ({enginePlayed})</option>}
        {names.map((one) => (
          <option key={one.name} value={one.name}>
            {one.name} ({one.games}){one.isEngine ? ' — the engine' : ''}
          </option>
        ))}
      </select>
      <span className="cw-lb-faint">{who === null ? 'Nothing is attributed until this is set.' : `${numbers.counted} counted`}</span>
    </div>
  )

  /*
   * What Orbis itself may do here: which screen is open, the order the table is in, the filter panel.
   *
   * Opening a game is on Chess World itself rather than here, because the shell is what owns which game is open.
   * Two doors to one thing is what makes a screen hard to find the way around in.
   */
  useSurface(
    simpleAreaSurface({
      id: 'library',
      name: 'Library',
      about: 'Every game you own in a table with the board beside it, and your numbers counted off those games.',
      keywords: ['library', 'games', 'my games', 'archive', 'collection', 'numbers', 'statistics', 'sort', 'filter'],
      controls: {
        screen: {
          name: 'Screen',
          spec: { type: 'string', description: 'Which of the two screens is open.', enum: ['games', 'numbers'] },
          get: () => tab,
          set: (value) => setTab(String(value) === 'numbers' ? 'numbers' : 'games'),
          default: 'games'
        },
        sortBy: {
          name: 'Sort by',
          spec: { type: 'string', description: 'Which column the table is ordered by.', enum: COLUMNS as string[] },
          get: () => column,
          set: (value) => setColumn(String(value) as ArchiveColumn),
          default: 'date'
        },
        newestFirst: {
          name: 'Newest first',
          spec: { type: 'boolean', description: 'True counts down from the newest or the highest; false counts up.' },
          get: () => direction === 'down',
          set: (value) => setDirection(value === true ? 'down' : 'up'),
          default: true
        },
        showFilters: {
          name: 'The filters',
          spec: { type: 'boolean', description: 'Whether the filter panel is open.' },
          get: () => showFilters,
          set: (value) => setShowFilters(value === true),
          default: false
        }
      },
      state: () => ({
        // "Could not be read" is not "there are none", so both are said rather than one count standing for both.
        games: error === null && !loading ? games.length : null,
        couldNotBeRead: error,
        stillReading: loading,
        matching: ordered.length,
        onThisPage: shown.length,
        picked: picked.length,
        screen: tab,
        onTheBoard: onBoard?.id ?? null,
        countedFor: who === null ? null : who.name ?? 'the human side of the engine games',
        counted: numbers.counted,
        sortBy: column,
        newestFirst: direction === 'down'
      })
    })
  )

  const board = onBoard === null
    ? null
    : {
      fen: fenAt(onBoard.game, ply),
      orientation: (flipped ? (onBoard.side === 'w' ? 'b' : 'w') : onBoard.side ?? 'w') as 'w' | 'b',
      interactive: false,
      lastMove: ply > 0
        ? { from: onBoard.game.moves[ply - 1].uci.slice(0, 2), to: onBoard.game.moves[ply - 1].uci.slice(2, 4) }
        : null,
      label: 'The game on the board'
    }

  return (
    <div className="cw-lb">
      <div className="cw-lb-bar">
        <Segmented
          label="Which screen"
          value={tab}
          options={[{ value: 'games', label: 'Your games' }, { value: 'numbers', label: 'Your numbers' }]}
          onChange={(value) => setTab(value as 'games' | 'numbers')}
        />
        <div className="cw-lb-bar-grow">
          <SearchBox
            label="Search your games"
            placeholder="Player, event, place, opening, tag"
            value={filter.text ?? ''}
            onChange={(text) => setFilter(text ? { ...filter, text } : withoutPart(filter, 'text'))}
            small
          />
        </div>
        {whoPicker}
        <Button size="tiny" on={showFilters} icon={<SlidersHorizontal size={13} aria-hidden="true" />} onClick={() => setShowFilters(!showFilters)}>
          Filters
        </Button>
        <Button size="tiny" icon={<Upload size={13} aria-hidden="true" />} onClick={() => setSheet('import')}>Bring in games</Button>
        <Button size="tiny" icon={<Copy size={13} aria-hidden="true" />} disabled={games.length < 2} onClick={() => setSheet('duplicates')}>
          Find duplicates
        </Button>
      </div>

      {said.length > 0 && (
        <div className="cw-lb-said">
          <span>Showing games where:</span>
          {said.map((one) => (
            <button
              key={one.key}
              type="button"
              className="cw-lb-said-one"
              aria-label={`Stop filtering by ${one.words}`}
              onClick={() => setFilter(withoutPart(filter, one.key))}
            >
              {one.words}
              <X size={11} aria-hidden="true" />
            </button>
          ))}
          <Button size="tiny" kind="quiet" onClick={() => setFilter({})}>Clear all</Button>
        </div>
      )}

      {showFilters && <FilterPanel filter={filter} facets={facets} onChange={setFilter} />}

      {picked.length > 0 && (
        <div className="cw-lb-picked" role="group" aria-label="What to do with the games you have picked">
          <span className="cw-lb-picked-words">{picked.length === 1 ? '1 game picked' : `${picked.length} games picked`}</span>
          <Button size="tiny" icon={<FileDown size={13} aria-hidden="true" />} disabled={busy} onClick={() => exportGames(picked)}>
            Save as PGN
          </Button>
          <Button size="tiny" icon={<Tag size={13} aria-hidden="true" />} disabled={busy} onClick={() => setSheet('tags')}>Tags</Button>
          <Button size="tiny" icon={<Star size={13} aria-hidden="true" />} disabled={busy} onClick={() => star(picked, true)}>Star</Button>
          <Button size="tiny" disabled={busy} onClick={() => star(picked, false)}>Unstar</Button>
          <Button size="tiny" kind="danger" icon={<Trash size={13} aria-hidden="true" />} disabled={busy} onClick={() => setSheet('delete')}>
            Remove
          </Button>
          <Button size="tiny" kind="quiet" onClick={() => { setPicked([]); lastPicked.current = null }}>Pick none</Button>
        </div>
      )}

      {/*
        * The board is the biggest thing on both screens, and it is the same board on both: the position at the end
        * of whichever game you are looking at, walkable move by move. The stage measures the room and decides how
        * big the board is, so nothing here can draw a small one.
        */}
      {board === null
        ? (
          <div className="cw-lb-body">
            {tab === 'numbers' && games.length > 0
              ? <NumbersPanel numbers={numbers} whoWords={whoWords} onSelect={setSelected} />
              : tableSide()}
            {games.length === 0 && tab === 'numbers' && <p className="cw-lb-gap">{NOTHING_YET}</p>}
          </div>
        )
        : (
          <ChessStage
            className={`cw-lb-stage ${tab === 'numbers' ? 'is-numbers' : 'is-games'}`}
            label="The game you are looking at"
            board={board}
            left={tab === 'games'
              ? <div className="cw-lb-left">{tableSide()}</div>
              : <NumbersPanel numbers={numbers} whoWords={whoWords} onSelect={setSelected} />}
            above={
              <div className="cw-lb-strip">
                <span className="cw-lb-strip-name">
                  {onBoard.game.meta.white.name ?? 'Unnamed'} <span className="cw-lb-faint">vs</span> {onBoard.game.meta.black.name ?? 'Unnamed'}
                </span>
                <span className="cw-lb-faint">{onBoard.date.text || 'no date recorded'}</span>
                <span className="cw-lb-faint">{onBoard.moves} {onBoard.moves === 1 ? 'move' : 'moves'}</span>
                <span className="cw-lb-strip-result">{onBoard.game.meta.result === '*' ? 'no result recorded' : onBoard.game.meta.result}</span>
              </div>
            }
            below={
              <MoveNav ply={ply} total={onBoard.moves} onJump={setPly} onFlip={() => setFlipped(!flipped)}>
                <span className="cw-lb-faint">
                  {ply === 0 ? 'The starting position' : ply === onBoard.moves ? 'The final position' : `After ${ply} of ${onBoard.moves} moves`}
                </span>
              </MoveNav>
            }
            right={
              <div className="cw-lb-right">
                <GameCard
                  row={onBoard}
                  ply={ply}
                  onOpen={(at) => onOpen(onBoard.id, at)}
                  {...(reviewReachable ? { onReview: () => openReport(onBoard.id, ply) } : {})}
                  onStar={(favourite) => star([onBoard.id], favourite)}
                  onExport={() => exportGames([onBoard.id])}
                  onRemove={() => { setPicked([onBoard.id]); setSheet('delete') }}
                  busy={busy}
                />
                <MoveList
                  moves={onBoard.game.moves.map((one) => one.san)}
                  ply={ply}
                  onJump={setPly}
                  firstSide={onBoard.game.startFen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w'}
                  firstNumber={Number.parseInt(onBoard.game.startFen.trim().split(/\s+/)[5] ?? '1', 10) || 1}
                  empty="This game has no moves recorded."
                />
                {onBoard.id === openId && <p className="cw-lb-about">This is the game open on the analysis board.</p>}
              </div>
            }
          />
        )}

      {sheet === 'tags' && pickedGames.length > 0 && (
        <TagSheet
          games={pickedGames}
          knownTags={facets.tags.map((one) => one.label)}
          knownCollections={facets.collections.map((one) => one.label)}
          onApply={applyTags}
          onClose={() => setSheet(null)}
          busy={busy}
        />
      )}

      {sheet === 'delete' && pickedGames.length > 0 && (
        <DeleteSheet games={pickedGames} onConfirm={removePicked} onClose={() => setSheet(null)} busy={busy} />
      )}

      {sheet === 'import' && (
        <ImportSheet
          onPickFile={async () => {
            const summary = await window.api.chessImportPgn()
            if (summary) await onReload()
            return summary
          }}
          onPasteText={async (text) => {
            const summary = await window.api.chessImportPgnText(text, 'pasted text')
            await onReload()
            return summary
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === 'duplicates' && (
        <DuplicateSheet
          games={games}
          onPick={(ids) => {
            setPicked(ids)
            setSheet(null)
            onNotify(ids.length === 1 ? 'One extra copy is picked. Check it, then remove it.' : `${ids.length} extra copies are picked. Check them, then remove them.`)
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
