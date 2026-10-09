import { useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Sparkles } from 'lucide-react'
import { RoomPiece } from './roomArt'
import Orbi, { wearable } from './Orbi'
import Constellation from './Constellation'
import { nextTier, tierFor, type Star } from '../../../../shared/student/orbiAnim'
import { count, type Call, type Catalogue } from './useStudent'
import type { StudentSnapshot } from '../../../../shared/student/types'
import type { NoticeKind } from '../../lib/notices'

/**
 * Orbi's room, and the collection.
 *
 * Everything here is cosmetic, and that is the whole design. A student who never opens this page loses nothing: the
 * timer, the blocking, Orion and the learning all work the same at level one as at level fifty. The room exists
 * because progress is easier to feel than to read, not because it is a thing to grind.
 *
 * Which is also why there is nothing to buy and nothing to spend. Items arrive from levels and achievements, and the
 * only way to get one is to have studied.
 */

export default function OrbiRoom({
  snapshot,
  catalogue,
  call,
  onNotify
}: {
  snapshot: StudentSnapshot
  catalogue: Catalogue | null
  call: Call
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [tab, setTab] = useState<'room' | 'sky' | 'collection'>('room')
  /**
   * The thing being dragged, and where in it the pointer took hold.
   *
   * Positions are kept as a share of the room, not pixels, so a room arranged in a wide window is the same room in
   * a narrow one. Saved when the pointer is let go rather than on every movement: a store write per mouse move is
   * how a room becomes slow.
   */
  const [dragging, setDragging] = useState<{ itemId: string; dx: number; dy: number } | null>(null)
  const roomRef = useRef<HTMLDivElement>(null)
  const [sky, setSky] = useState<Star[]>([])
  const orbi = snapshot.orbi
  const prefs = snapshot.preferences

  const items = useMemo(() => catalogue?.cosmetics ?? [], [catalogue])
  const tier = tierFor(snapshot.level.level)
  const coming = nextTier(snapshot.level.level)

  useEffect(() => {
    // The sky is derived from the goals and the subjects, so it is asked for rather than kept.
    void call<{ sky?: Star[] }>('progress').then((one) => setSky(Array.isArray(one?.sky) ? one.sky : []))
  }, [call])
  const roomItems = useMemo(() => items.filter((one) => one.kind === 'room'), [items])
  const inRoom = useMemo(() => roomItems.filter((one) => orbi.unlocked.includes(one.id)), [roomItems, orbi.unlocked])
  const byKind = useMemo(() => {
    const out = new Map<string, typeof items>()
    for (const one of items) out.set(one.kind, [...(out.get(one.kind) ?? []), one])
    return [...out.entries()]
  }, [items])

  /** Where a pointer is, as a share of the room, clamped so nothing can be dragged out of sight. */
  const spotFor = (event: { clientX: number; clientY: number }, grab: { dx: number; dy: number }): { x: number; y: number } => {
    const box = roomRef.current?.getBoundingClientRect()
    if (!box) return { x: 50, y: 50 }
    const x = ((event.clientX - box.left) / box.width) * 100 - grab.dx
    const y = ((box.bottom - event.clientY) / box.height) * 100 - grab.dy
    return { x: Math.max(2, Math.min(88, x)), y: Math.max(4, Math.min(78, y)) }
  }

  const moveTo = async (itemId: string, spot: { x: number; y: number }): Promise<void> => {
    const next = orbi.room.map((one) => (one.itemId === itemId ? { ...one, x: spot.x, y: spot.y } : one))
    await call('save-orbi', { room: next })
  }

  const place = async (id: string): Promise<void> => {
    const held = orbi.room.some((one) => one.itemId === id)
    const next = held
      ? orbi.room.filter((one) => one.itemId !== id)
      : [...orbi.room, { itemId: id, x: 10 + ((orbi.room.length * 17) % 70), y: 55 + ((orbi.room.length * 11) % 25) }]
    await call('save-orbi', { room: next })
    onNotify(held ? 'Put away.' : 'Placed in the room.')
  }

  const wear = async (id: string): Promise<void> => {
    const on = orbi.worn.includes(id)
    await call('save-orbi', { worn: on ? orbi.worn.filter((one) => one !== id) : [...orbi.worn, id] })
  }

  const KIND_NAMES: Record<string, string> = { orbi: 'Orbi', accessory: 'To wear', room: 'For the room', atmosphere: 'Atmospheres', theme: 'Looks', animation: 'Movement' }

  return (
    <div className="st-orbi-page">
      <header className="st-section-head">
        <div>
          <h2>{orbi.name}</h2>
          <p className="st-faint">
            {tier.name} · level {orbi.level} · {orbi.unlocked.length} of {items.length} unlocked
          </p>
        </div>
        <div className="st-tabs">
          <button type="button" className={`st-tab${tab === 'room' ? ' on' : ''}`} aria-pressed={tab === 'room'} onClick={() => setTab('room')}>
            Room
          </button>
          <button type="button" className={`st-tab${tab === 'sky' ? ' on' : ''}`} aria-pressed={tab === 'sky'} onClick={() => setTab('sky')}>
            Sky
          </button>
          <button type="button" className={`st-tab${tab === 'collection' ? ' on' : ''}`} aria-pressed={tab === 'collection'} onClick={() => setTab('collection')}>
            Collection
          </button>
        </div>
      </header>

      {tab === 'room' ? (
        <>
          <div
            ref={roomRef}
            className={`st-room${prefs.reducedMotion ? ' still' : ''}`}
            aria-label={`${orbi.name}'s room, with ${orbi.room.length} things in it. Drag a thing to move it.`}
            onPointerMove={(event) => {
              if (!dragging) return
              const spot = spotFor(event, dragging)
              // Moved on screen immediately; written down when the pointer is let go.
              const node = event.currentTarget.querySelector<HTMLElement>(`[data-item="${dragging.itemId}"]`)
              if (node) {
                node.style.left = `${spot.x}%`
                node.style.bottom = `${spot.y}%`
              }
            }}
            onPointerUp={(event) => {
              if (!dragging) return
              const spot = spotFor(event, dragging)
              const held = dragging
              setDragging(null)
              void moveTo(held.itemId, spot)
            }}
            onPointerLeave={() => setDragging(null)}
          >
            <div className="st-room-desk" aria-hidden />
            {orbi.room.map((one) => {
              const item = items.find((x) => x.id === one.itemId)
              if (!item) return null
              return (
                <button
                  key={one.itemId}
                  type="button"
                  data-item={one.itemId}
                  className={`st-room-item${dragging?.itemId === one.itemId ? ' moving' : ''}`}
                  style={{ left: `${one.x}%`, bottom: `${one.y}%` }}
                  title={`${item.label} — drag to move, press to put away`}
                  aria-label={`${item.label}. Drag to move it, or press to put it away.`}
                  onPointerDown={(event) => {
                    event.currentTarget.releasePointerCapture?.(event.pointerId)
                    const box = event.currentTarget.getBoundingClientRect()
                    const room = roomRef.current?.getBoundingClientRect()
                    if (!room) return
                    setDragging({
                      itemId: one.itemId,
                      dx: ((event.clientX - box.left) / room.width) * 100,
                      dy: ((box.bottom - event.clientY) / room.height) * 100
                    })
                  }}
                  onClick={() => {
                    // A press with no drag puts it away; a drag ends on pointerup and never reaches here.
                    if (!dragging) void place(one.itemId)
                  }}
                >
                  <RoomPiece id={one.itemId} label={item.label} />
                </button>
              )
            })}
            <div className="st-room-orbi">
              <Orbi state="ready" behaviour={prefs.orbi} reducedMotion={prefs.reducedMotion} worn={orbi.worn} level={snapshot.level.level} size={120} />
            </div>
          </div>

          <div className="st-level-strip">
            <div className="st-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snapshot.level.through * 100)} aria-label="Level progress">
              <span style={{ width: `${snapshot.level.through * 100}%` }} />
            </div>
            <span className="st-faint">
              {count(snapshot.level.xp - snapshot.level.from)} / {count(snapshot.level.to - snapshot.level.from)} XP to level {snapshot.level.level + 1}
              {coming ? ` · ${coming.name} at level ${coming.from}` : ''}
            </span>
          </div>

          <h3>Things for the room</h3>
          {inRoom.length === 0 ? (
            <p className="st-empty">Nothing unlocked for the room yet. Finishing sessions and reaching milestones brings things in.</p>
          ) : (
            <div className="st-pills">
              {inRoom.map((one) => {
                const placed = orbi.room.some((x) => x.itemId === one.id)
                return (
                  <button key={one.id} type="button" className={`st-pill${placed ? ' on' : ''}`} aria-pressed={placed} onClick={() => void place(one.id)}>
                    {one.label}
                  </button>
                )
              })}
            </div>
          )}

          {wearable(orbi.unlocked).length > 0 ? (
            <>
              <h3>What Orbi is wearing</h3>
              <div className="st-pills">
                {wearable(orbi.unlocked).map((id) => {
                  const on = orbi.worn.includes(id)
                  return (
                    <button key={id} type="button" className={`st-pill${on ? ' on' : ''}`} aria-pressed={on} onClick={() => void wear(id)}>
                      {items.find((one) => one.id === id)?.label ?? id}
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}
        </>
      ) : tab === 'sky' ? (
        <>
          <Constellation stars={sky} reducedMotion={prefs.reducedMotion} />
          <p className="st-faint small">
            Every goal is a star and every stage beside it is a smaller one. A star lights up when the thing it stands
            for is actually finished — not when it is started.
          </p>
        </>
      ) : (
        <div className="st-collection">
          {byKind.map(([kind, list]) => (
            <section key={kind} aria-label={KIND_NAMES[kind] ?? kind}>
              <h3>{KIND_NAMES[kind] ?? kind}</h3>
              <div className="st-grid tight">
                {list.map((one) => {
                  const got = orbi.unlocked.includes(one.id)
                  return (
                    <article key={one.id} className={`st-collect${got ? ' on' : ''}`}>
                      {got ? <Sparkles size={14} aria-hidden /> : <Lock size={14} aria-hidden />}
                      <strong>{one.label}</strong>
                      <span className="st-faint small">
                        {got ? 'Unlocked' : one.level !== null ? `At level ${one.level}` : 'From an achievement'}
                      </span>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
          <p className="st-faint small">
            Nothing here can be bought, and nothing here is needed to study. Items arrive from levels and achievements only.
          </p>
        </div>
      )}
    </div>
  )
}
