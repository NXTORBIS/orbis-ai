import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from '../Board'
import { Piece } from '../pieces'
import { boardSquares, type ChessMove, type PieceLetter } from '../../../../../shared/chess/rules.ts'
import { isSquare, squareFromRay, type Orientation } from './boardGeometry.ts'
import {
  blendViews, canPick, cameraPosition, clampView, defaultView, presetView, rotateByDrag, rotateBySteps,
  sameView, wheelSteps, zoomBySteps, type View, type ViewPreset
} from './camera.ts'
import {
  beginGesture, endGesture, keyAction, moveGesture, ownsPointer, pointerToNdc, wheelZooms, type Gesture
} from './interaction.ts'
import {
  cancelPromotion, choosePromotion, clickSquare, describeSquare, emptyHolding, marksFor, release, takeAtCursor,
  walk, type Holding, type Result
} from './selection.ts'
import { PIECE_NAME } from './pieces.ts'
import { createLabels, paletteFrom, probeWebgl, type LabelSet } from './labels.ts'
import { createBoardScene, noMarks, type BoardScene, type SceneStats } from './scene.ts'
import {
  decide, drawScale, liftDuration, resetDuration, shouldDraw,
  type Diagnostic, type Route, type Trouble
} from './support.ts'
import './board3d.css'

/**
 * The board, in three dimensions, when somebody wants it.
 *
 * ## What this is
 *
 * The same board. It takes a position and asks for moves with exactly the contract `Board.tsx` has, and it keeps no
 * position and no history of its own -- what is on screen is the `fen` it was handed, and every move it sends
 * upward came out of `rules.ts` for that exact position. So switching between the flat board and this one cannot
 * change the position, the variation being looked at, or anything else: there is nothing here that could hold a
 * different answer.
 *
 * ## What it refuses to do
 *
 * - **It never decides a move.** Every square it offers is a square the rules offered, and `selection.ts` is the
 *   whole of its opinion about chess.
 * - **It never turns a look into a move.** The button that turns the camera is the button that picks a piece up, so
 *   a press that travelled more than four pixels becomes a look and plays nothing, for ever. That rule lives in
 *   `interaction.ts` with its own tests, because it is the one way an interface like this could lose somebody a
 *   game.
 * - **It never pretends.** If a graphics context cannot be had -- no driver, a blacklisted card, a context lost to
 *   a driver restart -- it says so in one sentence and shows the flat board with the position untouched. There is
 *   no blank rectangle and no guessing.
 * - **It never draws when nobody is looking.** A frame happens when something has changed and the board is both on
 *   screen and in the window being looked at. Otherwise nothing is scheduled at all.
 *
 * ## Why three.js
 *
 * Because it was already here. `three` is a dependency of the application and is already loaded, on demand, by the
 * 3D model viewer in Orbis Files, so nothing new was added and no new licence is involved. It is loaded the same
 * way: the first time somebody opens the 3D board, and never otherwise.
 */

export interface Board3DProps {
  /** The position. The only source of truth about what is on the board. */
  fen: string
  orientation?: Orientation
  interactive?: boolean
  lastMove?: { from: string; to: string } | null
  /** Called with a move that is already legal in this position, exactly as the flat board calls it. */
  onMove?: (move: ChessMove) => void
  showCoordinates?: boolean
  showLegal?: boolean
  /** Squares to mark, for lessons and puzzles. */
  highlight?: string[]
  label?: string
  /** 'flat' shows the flat board. The 3D view is an extra and never the only way in. */
  view?: Route
  /** Offered so whoever mounts this can put the 2D/3D switch wherever it belongs on their screen. */
  onViewChange?: (view: Route) => void
  /** What really happened: which board is on screen, what went wrong if anything, and what the scene costs. */
  onDiagnostic?: (diagnostic: Diagnostic) => void
}

/** Does this machine want less movement? Watched rather than read once, because it can be changed while running. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof matchMedia !== 'function') return false
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** Smooths the start and end of a movement. The only easing in the whole view. */
function easeOf(through: number): number {
  const t = Math.min(1, Math.max(0, through))
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

const now = (): number => (typeof performance === 'object' ? performance.now() : Date.now())

/* The promotion question used characters while the board itself was solid shapes. It uses the drawn pieces now,
   so the thing you are choosing looks like the thing that appears. */

export function Board3D({
  fen, orientation = 'w', interactive = true, lastMove = null, onMove,
  showCoordinates = true, showLegal = true, highlight = [], label = 'Chess board',
  view: wanted = '3d', onViewChange, onDiagnostic
}: Board3DProps): React.JSX.Element {
  const mount = useRef<HTMLDivElement>(null)
  const canvasHost = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

  const [trouble, setTrouble] = useState<Trouble>('none')
  const [api, setApi] = useState<'webgl2' | 'webgl' | 'none'>('none')
  const [ready, setReady] = useState(false)
  const [holding, setHolding] = useState<Holding>(() => emptyHolding())
  const [camera, setCamera] = useState<View>(() => defaultView())
  const [usingKeyboard, setUsingKeyboard] = useState(false)
  const [focused, setFocused] = useState(false)
  const [stats, setStats] = useState<SceneStats | null>(null)
  const [spoken, setSpoken] = useState('')

  const decision = useMemo(() => decide(wanted, trouble), [wanted, trouble])
  const marks = useMemo(
    () => marksFor(fen, holding, showLegal, usingKeyboard),
    [fen, holding, showLegal, usingKeyboard]
  )

  /*
   * Everything the drawing loop needs, in a box it can read without being rebuilt.
   *
   * React state is the right home for what the screen shows and the wrong home for what a frame needs: a loop that
   * closed over state would be rebuilt every time anything changed, and a frame already scheduled by the old one
   * would draw the old position. The loop reads this instead, and this is always current.
   */
  const live = useRef({
    three: null as typeof import('three') | null,
    scene: null as BoardScene | null,
    renderer: null as import('three').WebGLRenderer | null,
    labels: null as LabelSet | null,
    /** The frame that has been asked for and not yet drawn. */
    frame: 0,
    /** How many frames have been drawn since this view opened. */
    frames: 0,
    changed: true,
    onScreen: true,
    windowVisible: true,
    lost: false,
    gesture: null as Gesture | null,
    camera: defaultView(),
    orientation,
    /** The swing to a named view in progress, if any. */
    swing: null as { from: View; to: View; started: number; duration: number } | null,
    /** The lift of the held piece in progress. */
    lift: { square: null as string | null, from: 0, to: 0, started: 0, duration: 0 }
  })

  /** Draws one frame. Called by the browser; never called directly. */
  const draw = useCallback((): void => {
    const state = live.current
    state.frame = 0
    const { scene, renderer } = state
    if (!scene || !renderer) return
    const moment = now()

    // A swing to a named view moves the camera on and asks for another frame.
    if (state.swing) {
      const swing = state.swing
      const through = swing.duration <= 0 ? 1 : Math.min(1, (moment - swing.started) / swing.duration)
      const at = blendViews(swing.from, swing.to, easeOf(through))
      state.camera = at
      scene.applyView(at)
      if (through >= 1) {
        state.swing = null
        setCamera(swing.to)
      } else {
        state.changed = true
      }
    }

    // The same for a piece being picked up or put down.
    const lift = state.lift
    if (lift.from !== lift.to) {
      const through = lift.duration <= 0 ? 1 : Math.min(1, (moment - lift.started) / lift.duration)
      scene.setLift(lift.square, lift.from + (lift.to - lift.from) * easeOf(through), state.orientation)
      if (through >= 1) lift.from = lift.to
      else state.changed = true
    }

    try {
      renderer.render(scene.scene, scene.camera)
    } catch {
      // A context that dies mid-frame throws here. Stop, and say so, rather than looping on a dead canvas.
      state.lost = true
      setTrouble('context-lost')
      return
    }
    state.frames += 1
    if (state.changed) {
      state.changed = false
      if (!state.frame) state.frame = requestAnimationFrame(draw)
    }
  }, [])

  /** Says something has changed and asks for a frame, unless one is coming or there would be no point. */
  const nudge = useCallback((): void => {
    const state = live.current
    state.changed = true
    if (state.frame) return
    if (!shouldDraw({
      onScreen: state.onScreen, windowVisible: state.windowVisible, changed: true, lost: state.lost
    })) return
    state.frame = requestAnimationFrame(draw)
  }, [draw])

  // ---------------------------------------------------------------------------------------------------------------
  // Building the scene and taking it down again.
  // ---------------------------------------------------------------------------------------------------------------

  useEffect(() => {
    if (decision.route !== '3d') return
    const host = canvasHost.current
    if (!host) return
    let alive = true

    /*
     * Asked before the graphics library is fetched.
     *
     * A machine that cannot open a graphics context has no use for three.js, and finding that out first means it is
     * never downloaded there at all.
     */
    const probe = probeWebgl()
    setApi(probe.api)
    if (probe.api === 'none') {
      setTrouble('no-webgl')
      return
    }

    let renderer: import('three').WebGLRenderer | null = null
    let built: BoardScene | null = null
    let labelSet: LabelSet | null = null
    let canvas: HTMLCanvasElement | null = null

    const onContextLost = (event: Event): void => {
      // Stops the browser restoring it behind our back, so the message and the fallback agree with what is there.
      event.preventDefault()
      live.current.lost = true
      setTrouble('context-lost')
    }

    const teardown = (): void => {
      if (canvas) canvas.removeEventListener('webglcontextlost', onContextLost)
      labelSet?.dispose()
      built?.dispose()
      if (renderer) {
        renderer.dispose()
        // Hands the context back rather than waiting for the browser to notice. A browser only allows a few.
        renderer.forceContextLoss()
      }
      if (canvas?.parentElement) canvas.parentElement.removeChild(canvas)
      const state = live.current
      state.scene = null
      state.renderer = null
      state.labels = null
      state.three = null
      labelSet = null
      built = null
      renderer = null
      canvas = null
    }

    const fit = (): void => {
      const state = live.current
      if (!state.scene || !state.renderer) return
      const width = Math.max(1, Math.round(host.clientWidth))
      const height = Math.max(1, Math.round(host.clientHeight))
      state.renderer.setSize(width, height, false)
      state.scene.setViewport(width, height)
    }

    const start = async (): Promise<void> => {
      let T: typeof import('three')
      let mergeGeometries: (
        geometries: import('three').BufferGeometry[], useGroups?: boolean
      ) => import('three').BufferGeometry | null
      try {
        const [library, utils] = await Promise.all([
          import('three'),
          import('three/examples/jsm/utils/BufferGeometryUtils.js')
        ])
        T = library
        mergeGeometries = utils.mergeGeometries
      } catch {
        if (alive) setTrouble('no-library')
        return
      }
      if (!alive) return

      try {
        const palette = paletteFrom(mount.current)
        renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' })
        renderer.setPixelRatio(drawScale(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1))
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = T.PCFSoftShadowMap
        renderer.setClearAlpha(0)
        canvas = renderer.domElement
        canvas.className = 'cw-3d-canvas'
        // The canvas is a picture inside a control, not the control: the surrounding element takes the keyboard.
        canvas.setAttribute('aria-hidden', 'true')
        canvas.addEventListener('webglcontextlost', onContextLost, false)
        host.replaceChildren(canvas)
        built = createBoardScene({ T, mergeGeometries }, palette)
        try {
          labelSet = createLabels(T, built.labels, palette)
        } catch {
          // A board with no letters round the edge is a shame, not a failure. It must not take the view down.
          labelSet = null
        }
      } catch {
        if (alive) setTrouble('build-failed')
        teardown()
        return
      }
      if (!alive) {
        teardown()
        return
      }

      const state = live.current
      state.three = T
      state.scene = built
      state.renderer = renderer
      state.labels = labelSet
      state.lost = false
      state.frames = 0
      setTrouble('none')
      fit()
      setReady(true)
      nudge()
    }

    void start()

    const sizes = new ResizeObserver(() => { fit(); nudge() })
    sizes.observe(host)

    /*
     * Not on screen, not drawn.
     *
     * The chess screen has tabs and a part that scrolls, so the board can be behind another tab or scrolled away
     * while still mounted. When it is, no frame is asked for at all and a pending one is cancelled.
     */
    const seen = new IntersectionObserver((entries) => {
      const state = live.current
      state.onScreen = entries.some((entry) => entry.isIntersecting)
      if (!state.onScreen && state.frame) {
        cancelAnimationFrame(state.frame)
        state.frame = 0
      }
      if (state.onScreen) nudge()
    }, { threshold: 0 })
    seen.observe(host)

    const onWindowVisibility = (): void => {
      const state = live.current
      state.windowVisible = document.visibilityState !== 'hidden'
      if (!state.windowVisible && state.frame) {
        cancelAnimationFrame(state.frame)
        state.frame = 0
      }
      if (state.windowVisible) nudge()
    }
    document.addEventListener('visibilitychange', onWindowVisibility)
    onWindowVisibility()

    return () => {
      alive = false
      sizes.disconnect()
      seen.disconnect()
      document.removeEventListener('visibilitychange', onWindowVisibility)
      const state = live.current
      if (state.frame) {
        cancelAnimationFrame(state.frame)
        state.frame = 0
      }
      setReady(false)
      teardown()
    }
  }, [decision.route, nudge])

  // ---------------------------------------------------------------------------------------------------------------
  // Keeping the scene in step with the props. None of this holds anything; it copies.
  // ---------------------------------------------------------------------------------------------------------------

  useEffect(() => {
    const state = live.current
    state.orientation = orientation
    if (!state.scene || !ready) return
    // Straight out of the rules for the position on screen. Nothing is remembered between calls.
    state.scene.setPosition(boardSquares(fen), orientation)
    state.labels?.place(orientation)
    nudge()
  }, [fen, orientation, ready, nudge])

  useEffect(() => {
    const state = live.current
    if (!state.scene || !ready) return
    state.scene.setMarks({
      selected: marks.selected,
      legal: marks.legal,
      captures: marks.captures,
      lastFrom: lastMove ? lastMove.from : null,
      lastTo: lastMove ? lastMove.to : null,
      noted: highlight.filter(isSquare),
      check: marks.check,
      cursor: marks.cursor
    }, orientation)
    nudge()
  }, [marks, lastMove, highlight, orientation, ready, nudge])

  useEffect(() => {
    const state = live.current
    if (!state.scene || !ready) return
    state.scene.setLabelsVisible(showCoordinates)
    nudge()
  }, [showCoordinates, ready, nudge])

  /** The held piece rises; letting go puts it back down. Instant when the machine has asked for less movement. */
  useEffect(() => {
    const state = live.current
    const duration = liftDuration(reducedMotion)
    const to = holding.selected ? 1 : 0
    state.lift = {
      square: holding.selected ?? state.lift.square,
      from: duration <= 0 ? to : state.lift.from,
      to,
      started: now(),
      duration
    }
    if (duration <= 0 && state.scene) state.scene.setLift(holding.selected, to, orientation)
    nudge()
  }, [holding.selected, reducedMotion, orientation, nudge])

  useEffect(() => {
    const state = live.current
    if (!state.scene || !ready) return
    // While somebody is holding the camera, they own it: copying React's older value back would snap the view.
    if (state.gesture || state.swing) return
    state.camera = camera
    state.scene.applyView(camera)
    nudge()
  }, [camera, ready, nudge])

  // A new position means nothing is held any more, exactly as on the flat board.
  useEffect(() => { setHolding((was) => emptyHolding(was.cursor)) }, [fen])

  /** Counted once the scene is up, so what the view costs is measured rather than estimated. */
  useEffect(() => {
    const state = live.current
    setStats(ready && state.scene ? state.scene.stats() : null)
  }, [ready, fen, showCoordinates, marks])

  useEffect(() => {
    onDiagnostic?.({
      route: decision.route,
      trouble,
      api,
      meshes: stats ? stats.meshes + stats.sprites : 0,
      triangles: stats ? stats.triangles : 0,
      frames: live.current.frames
    })
  }, [decision.route, trouble, api, stats, onDiagnostic])

  // ---------------------------------------------------------------------------------------------------------------
  // What a move is.
  // ---------------------------------------------------------------------------------------------------------------

  /** The one place a move can leave this component. Everything that could produce one goes through here. */
  const settle = useCallback((result: Result): void => {
    setHolding(result.holding)
    if (result.kind === 'move') onMove?.(result.move)
  }, [onMove])

  /** The square under the pointer, worked out from the camera's own line rather than from anything on screen. */
  const squareUnder = useCallback((clientX: number, clientY: number): string | null => {
    const state = live.current
    const { scene, renderer, three: T } = state
    if (!scene || !renderer || !T) return null
    const ndc = pointerToNdc(clientX, clientY, renderer.domElement.getBoundingClientRect())
    if (!ndc) return null
    scene.camera.updateMatrixWorld()
    /*
     * A point on the far plane, pushed back out into the world.
     *
     * Subtracting the camera from it gives the line the pointer is looking along. Where that line meets the board
     * is arithmetic, and it lives in `boardGeometry.ts` so a test can check it without a graphics card.
     */
    const far = new T.Vector3(ndc.x, ndc.y, 1).unproject(scene.camera)
    if (!Number.isFinite(far.x) || !Number.isFinite(far.y) || !Number.isFinite(far.z)) return null
    const eye = scene.camera.position
    const direction = { x: far.x - eye.x, y: far.y - eye.y, z: far.z - eye.z }
    return squareFromRay({ x: eye.x, y: eye.y, z: eye.z }, direction, state.orientation)
  }, [])

  // ---------------------------------------------------------------------------------------------------------------
  // Pointer: one button both looks and plays, and which it was is decided by how far it moved.
  // ---------------------------------------------------------------------------------------------------------------

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = live.current
    if (!state.scene || state.lost) return
    const gesture = beginGesture(event.pointerId, event.button, event.clientX, event.clientY)
    if (!gesture) return
    state.gesture = gesture
    // A swing still in progress is abandoned the moment somebody takes hold of the camera themselves.
    state.swing = null
    // Captured so a drag that leaves the board keeps turning it rather than stopping dead at the edge.
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = live.current
    if (!ownsPointer(state.gesture, event.pointerId) || !state.gesture) return
    const moved = moveGesture(state.gesture, event.clientX, event.clientY)
    state.gesture = moved.gesture
    if (moved.dx === 0 && moved.dy === 0) return
    const next = rotateByDrag(state.camera, moved.dx, moved.dy)
    state.camera = next
    state.scene?.applyView(next)
    nudge()
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = live.current
    const gesture = state.gesture
    if (!ownsPointer(gesture, event.pointerId) || !gesture) return
    state.gesture = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    const what = endGesture(gesture)
    if (what === 'look') {
      // The camera moved without React. Catch it up, which draws nothing new.
      setCamera(state.camera)
      return
    }
    if (what !== 'click') return
    // Only ever a click that did not move, with the primary button, from somewhere the board can be seen from.
    if (!canPick(state.camera)) return
    const square = squareUnder(event.clientX, event.clientY)
    if (!square) {
      // Clicking past the edge of the board puts down whatever was held, as clicking off the board should.
      settle(release(holding))
      return
    }
    setUsingKeyboard(false)
    settle(clickSquare(fen, holding, square, interactive))
  }

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = live.current
    if (!ownsPointer(state.gesture, event.pointerId)) return
    // An interrupted gesture plays nothing, whatever it had become.
    if (state.gesture?.dragged) setCamera(state.camera)
    state.gesture = null
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Wheel and keyboard.
  // ---------------------------------------------------------------------------------------------------------------

  /*
   * The wheel is attached by hand.
   *
   * React's own wheel handler cannot stop the page scrolling: React listens once at the root, where the browser has
   * already treated the event as passive, so calling `preventDefault` there does nothing at all.
   */
  useEffect(() => {
    const host = canvasHost.current
    if (!host || decision.route !== '3d') return
    const onWheel = (event: WheelEvent): void => {
      const state = live.current
      if (!state.scene) return
      if (!wheelZooms({ focused, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey })) return
      event.preventDefault()
      const next = zoomBySteps(state.camera, wheelSteps(event.deltaY, event.deltaMode))
      if (sameView(next, state.camera)) return
      state.camera = next
      state.scene.applyView(next)
      setCamera(next)
      nudge()
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [decision.route, focused, nudge])

  /** Puts the camera somewhere named. Instant when the machine has asked for less movement. */
  const goToView = useCallback((preset: ViewPreset): void => {
    const state = live.current
    const to = presetView(preset)
    const duration = resetDuration(reducedMotion)
    if (duration <= 0 || !state.scene) {
      state.swing = null
      state.camera = to
      setCamera(to)
      state.scene?.applyView(to)
      nudge()
      return
    }
    state.swing = { from: state.camera, to, started: now(), duration }
    nudge()
  }, [reducedMotion, nudge])

  /** Moves the camera straight away and tells React afterwards, for the zoom buttons. */
  const zoomNow = useCallback((steps: number): void => {
    const state = live.current
    const next = zoomBySteps(state.camera, steps)
    state.swing = null
    state.camera = next
    state.scene?.applyView(next)
    setCamera(next)
    nudge()
  }, [nudge])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const action = keyAction({
      key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey
    })
    // Anything the application might want is left entirely alone, key and all.
    if (action.kind === 'pass') return
    event.preventDefault()
    const state = live.current
    if (action.kind === 'turn') {
      const next = rotateBySteps(state.camera, action.across, action.up)
      state.swing = null
      state.camera = next
      state.scene?.applyView(next)
      setCamera(next)
      nudge()
      return
    }
    if (action.kind === 'zoom') {
      zoomNow(action.steps)
      return
    }
    if (action.kind === 'view') {
      goToView(action.preset)
      return
    }
    if (action.kind === 'walk') {
      setUsingKeyboard(true)
      setHolding((was) => ({ ...was, cursor: walk(was.cursor, action.dFile, action.dRank, orientation) }))
      return
    }
    if (action.kind === 'release') {
      settle(release(holding))
      return
    }
    setUsingKeyboard(true)
    settle(takeAtCursor(fen, holding, interactive))
  }

  // What the keyboard is standing on, said out loud, so the picture is not the only way to know.
  useEffect(() => {
    if (!usingKeyboard || decision.route !== '3d') {
      setSpoken('')
      return
    }
    setSpoken(describeSquare(fen, holding.cursor, marks, lastMove, highlight))
  }, [usingKeyboard, decision.route, fen, holding.cursor, marks, lastMove, highlight])

  // ---------------------------------------------------------------------------------------------------------------
  // The flat board, whenever that is the honest answer.
  // ---------------------------------------------------------------------------------------------------------------

  if (decision.route === 'flat') {
    return (
      <div className="cw-3d-wrap" ref={mount}>
        {decision.message && (
          <p className="cw-3d-note" role="status">
            {decision.message}
            {decision.retryable && (
              <button
                type="button"
                className="cw-3d-link"
                onClick={() => { live.current.lost = false; setTrouble('none'); onViewChange?.('3d') }}
              >
                Try the 3D board again
              </button>
            )}
          </p>
        )}
        <Board
          fen={fen}
          orientation={orientation}
          interactive={interactive}
          lastMove={lastMove}
          onMove={onMove}
          showCoordinates={showCoordinates}
          showLegal={showLegal}
          highlight={highlight}
          label={label}
        />
        {wanted === '3d' && onViewChange && (
          <div className="cw-3d-tools">
            <button type="button" className="cw-3d-btn" onClick={() => onViewChange('flat')}>
              Keep the flat board
            </button>
          </div>
        )}
      </div>
    )
  }

  const turn = fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w'

  return (
    <div className="cw-3d-wrap" ref={mount}>
      <div
        className="cw-3d-stage"
        role="application"
        tabIndex={0}
        aria-label={`${label}, shown in three dimensions. ${turn === 'b' ? 'Black' : 'White'} to move. Drag to turn the board; the arrow keys walk the squares and Enter picks a piece up.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setUsingKeyboard(false) }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="cw-3d-canvas-host" ref={canvasHost} />
        {!ready && <p className="cw-3d-loading">Setting the 3D board up…</p>}
      </div>

      <p className="cw-3d-live" role="status" aria-live="polite">{spoken}</p>

      <div className="cw-3d-tools" role="group" aria-label="The view">
        <button type="button" className="cw-3d-btn" onClick={() => goToView('default')} title="Back to the starting view (0)">
          Reset view
        </button>
        <button type="button" className="cw-3d-btn" onClick={() => goToView('overhead')} title="Straight down (1)">
          From above
        </button>
        <button type="button" className="cw-3d-btn" onClick={() => goToView('side')} title="Low and to the side (2)">
          From the side
        </button>
        <button type="button" className="cw-3d-btn" aria-label="Closer" title="Closer (])" onClick={() => zoomNow(-1)}>+</button>
        <button type="button" className="cw-3d-btn" aria-label="Further away" title="Further away ([)" onClick={() => zoomNow(1)}>−</button>
        {onViewChange && (
          <button type="button" className="cw-3d-btn" onClick={() => onViewChange('flat')}>Flat board</button>
        )}
      </div>

      <p className="cw-3d-hint">
        Drag to turn the board. The arrow keys walk the squares and Enter picks a piece up; hold Shift and the arrows
        turn the camera instead.
        <span className="cw-3d-faint"> Click the board and the wheel zooms, or hold Shift with the wheel anywhere. [ and ] zoom, 0 resets the view.</span>
      </p>

      {holding.promotion && (
        <div className="cw-3d-promo" role="dialog" aria-label="Choose a piece">
          <p>Make it a</p>
          <div className="cw-3d-promo-row">
            {(['q', 'r', 'b', 'n'] as PieceLetter[]).map((piece) => (
              <button
                key={piece}
                type="button"
                className="cw-3d-promo-btn"
                aria-label={PIECE_NAME[piece]}
                onClick={() => settle(choosePromotion(fen, holding, piece))}
              >
                <Piece color={turn} type={piece} className="cw-3d-promo-piece" />
                <small>{PIECE_NAME[piece]}</small>
              </button>
            ))}
          </div>
          <button type="button" className="cw-3d-promo-cancel" onClick={() => settle(cancelPromotion(holding))}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

export default Board3D

/*
 * Re-exported so whoever mounts this can describe or check the view without reaching into the scene.
 */
export { noMarks, cameraPosition, clampView, defaultView }
export type { Diagnostic, Route } from './support.ts'
