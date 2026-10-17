import { useMemo, useState } from 'react'
import { Button, Modal } from '../../../ui'
import type { StoredGame } from '../../../../../shared/chess/model'
import { collectionName, collectionTag, collectionsOf, fold, gameTitle, isCollectionTag, plainTags, tagProblem } from '../../../../../shared/chess/library'
import './library.css'

/**
 * Tagging games, and putting them in collections.
 *
 * It works the same for one game and for four hundred, and the difference is said out loud rather than hidden: a tag
 * that is on some of the selection but not all of it is shown as "on 3 of 5", so pressing it is a decision about
 * what to do with the other two rather than a guess.
 *
 * Nothing is applied until Apply. That matters most for the remove side: a bulk change that happened as you clicked
 * would have no way back, because the tags it took off are not written down anywhere else.
 */
export interface TagSheetProps {
  games: StoredGame[]
  /** Every tag and collection already in the library, so an existing one can be picked rather than retyped. */
  knownTags: string[]
  knownCollections: string[]
  onApply: (change: { add: string[]; remove: string[] }) => void
  onClose: () => void
  busy: boolean
}

export function TagSheet({ games, knownTags, knownCollections, onApply, onClose, busy }: TagSheetProps): React.JSX.Element {
  const [add, setAdd] = useState<string[]>([])
  const [remove, setRemove] = useState<string[]>([])
  const [typed, setTyped] = useState('')
  const [typedCollection, setTypedCollection] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  /** How many of the selected games already carry each tag, and each collection. */
  const standing = useMemo(() => {
    const tags = new Map<string, number>()
    const collections = new Map<string, number>()
    for (const game of games) {
      for (const tag of plainTags(game)) tags.set(fold(tag), (tags.get(fold(tag)) ?? 0) + 1)
      for (const name of collectionsOf(game)) collections.set(fold(name), (collections.get(fold(name)) ?? 0) + 1)
    }
    return { tags, collections }
  }, [games])

  /** How a name stands across the selection, said rather than implied: "on 3 of 5" is a decision, "on" is not. */
  const words = (counts: Map<string, number>, name: string): string => {
    const n = counts.get(fold(name)) ?? 0
    if (games.length === 1) return n ? 'on this game' : ''
    if (n === 0) return ''
    return n === games.length ? `on all ${games.length}` : `on ${n} of ${games.length}`
  }

  /** Pressing a name cycles through the three things it can mean: leave alone, put on everything, take off everything. */
  const cycle = (name: string): void => {
    const key = fold(name)
    const without = <T extends string>(list: T[]): T[] => list.filter((one) => fold(one) !== key)
    const isAdding = add.some((one) => fold(one) === key)
    const isRemoving = remove.some((one) => fold(one) === key)
    if (isAdding) {
      setAdd(without(add))
      setRemove([...without(remove), name])
      return
    }
    if (isRemoving) {
      setAdd(without(add))
      setRemove(without(remove))
      return
    }
    setAdd([...without(add), name])
    setRemove(without(remove))
  }

  const state = (name: string): { pressed: boolean; what: string } => {
    if (add.some((one) => fold(one) === fold(name))) return { pressed: true, what: 'will be added' }
    if (remove.some((one) => fold(one) === fold(name))) return { pressed: false, what: 'will be taken off' }
    return { pressed: false, what: '' }
  }

  const put = (name: string, kind: 'tag' | 'collection'): void => {
    const trouble = tagProblem(name, kind)
    if (trouble) { setProblem(trouble); return }
    setProblem(null)
    const value = kind === 'collection' ? collectionTag(name) : name.trim()
    setAdd([...add.filter((one) => fold(one) !== fold(value)), value])
    setRemove(remove.filter((one) => fold(one) !== fold(value)))
    if (kind === 'collection') setTypedCollection('')
    else setTyped('')
  }

  const nothingToDo = add.length === 0 && remove.length === 0

  return (
    <Modal
      label="Tags and collections"
      title={games.length === 1 ? `Tags for ${gameTitle(games[0])}` : `Tags for ${games.length} games`}
      onClose={onClose}
      outsideCloses={nothingToDo}
      canClose={!busy}
    >
      <div className="cw-lb-sheet">
        <div className="cw-lb-field">
          <label htmlFor="cw-lb-newtag">Add a tag</label>
          <div className="cw-lb-two">
            <input
              id="cw-lb-newtag"
              className="cw-lb-input"
              type="text"
              value={typed}
              aria-label="Add a tag"
              spellCheck={false}
              onChange={(event) => { setTyped(event.target.value); setProblem(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); put(typed, 'tag') } }}
            />
            <Button size="tiny" disabled={busy || typed.trim() === ''} onClick={() => put(typed, 'tag')}>Add</Button>
          </div>
        </div>

        <div className="cw-lb-field">
          <label htmlFor="cw-lb-newcollection">Put into a collection</label>
          <div className="cw-lb-two">
            <input
              id="cw-lb-newcollection"
              className="cw-lb-input"
              type="text"
              value={typedCollection}
              aria-label="Put into a collection"
              spellCheck={false}
              onChange={(event) => { setTypedCollection(event.target.value); setProblem(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); put(typedCollection, 'collection') } }}
            />
            <Button size="tiny" disabled={busy || typedCollection.trim() === ''} onClick={() => put(typedCollection, 'collection')}>Add</Button>
          </div>
        </div>

        {problem === null ? null : <p className="cw-lb-bad" role="alert">{problem}</p>}

        {knownCollections.length === 0 ? null : (
          <div className="cw-lb-field">
            <label>Collections already in your library</label>
            <div className="cw-lb-chips" role="group" aria-label="Collections already in your library">
              {knownCollections.map((name) => {
                const tag = collectionTag(name)
                const look = state(tag)
                return (
                  <button
                    key={name}
                    type="button"
                    className="cw-lb-chip"
                    aria-pressed={look.pressed}
                    aria-label={`${name}${look.what ? `, ${look.what}` : ''}`}
                    onClick={() => cycle(tag)}
                  >
                    {name}
                    <span className="cw-lb-chip-n"> {look.what || words(standing.collections, name)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {knownTags.length === 0 ? null : (
          <div className="cw-lb-field">
            <label>Tags already in your library</label>
            <div className="cw-lb-chips" role="group" aria-label="Tags already in your library">
              {knownTags.map((tag) => {
                const look = state(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className="cw-lb-chip"
                    aria-pressed={look.pressed}
                    aria-label={`${tag}${look.what ? `, ${look.what}` : ''}`}
                    onClick={() => cycle(tag)}
                  >
                    {tag}
                    <span className="cw-lb-chip-n"> {look.what || words(standing.tags, tag)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <p className="cw-lb-sheet-faint">
          {nothingToDo
            ? 'Nothing will change until you add or remove something.'
            : `${add.length ? `Adding ${add.map((one) => plainName(one)).join(', ')}. ` : ''}${remove.length ? `Taking off ${remove.map((one) => plainName(one)).join(', ')}.` : ''}`}
        </p>
        <p className="cw-lb-sheet-faint">
          A tag stays with the game inside Orbis. PGN has no tag for one, so saving games to a file does not carry
          the tags or the collections, and bringing that file back will not restore them.
        </p>

        <div className="cw-lb-sheet-actions">
          <Button size="small" kind="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            size="small"
            kind="primary"
            busy={busy}
            busyLabel="Applying…"
            disabled={nothingToDo}
            onClick={() => onApply({ add, remove })}
          >
            Apply to {games.length === 1 ? 'this game' : `${games.length} games`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** A collection is stored as a tag with a reserved beginning; a person should never be shown that beginning. */
const plainName = (tag: string): string => (isCollectionTag(tag) ? collectionName(tag) : tag)
