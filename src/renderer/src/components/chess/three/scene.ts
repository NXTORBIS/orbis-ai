/**
 * The scene: a board, the pieces on it, and the marks that say what is going on.
 *
 * Two things about this file are deliberate and worth knowing before changing it.
 *
 * **It is given three.js rather than importing it.** Nothing here has a static import of the graphics library, so
 * the whole 3D board stays out of the application's start-up: it is fetched the first time somebody asks for it and
 * never otherwise. The happy side effect is that this file runs under `node --test`, which is how the mesh and
 * triangle counts in the report are measured rather than guessed.
 *
 * **It knows nothing about chess.** It is told which pieces are on which squares and which squares to mark. It
 * never works out a legal move, never holds a position, and never decides what a click means. All of that is the
 * rules and `selection.ts`.
 *
 * The one thing it does care about is being cheap to redraw: geometry is built once per kind of piece and shared by
 * every copy of it, the sixty-four squares are two meshes rather than sixty-four, and showing a different position
 * moves meshes that already exist instead of building new ones.
 */

import type { BoardSquare, PieceLetter } from '../../../../../shared/chess/rules.ts'
import {
  ALL_SQUARES, FRAME, HALF, OUTER, SLAB, isDarkSquare, squareToWorld, type Orientation, type Vec3
} from './boardGeometry.ts'
import { allShapes, pieceYaw, shapeFor, type Part } from './pieces.ts'
import { DEFAULT_PALETTE, type Palette } from './palette.ts'
import { LIFT_HEIGHT } from './support.ts'
import { cameraPosition, TARGET, type View } from './camera.ts'

type Three = typeof import('three')
/** The one addon used: joining several shapes into one so a piece is one thing to draw rather than five. */
export type MergeGeometries = (
  geometries: import('three').BufferGeometry[],
  useGroups?: boolean
) => import('three').BufferGeometry | null

export interface SceneDeps { T: Three; mergeGeometries: MergeGeometries }

/** How smoothly the turned bodies are revolved. Enough to look round, few enough to stay cheap. */
const LATHE_SEGMENTS = 28

/** How high above the squares each kind of mark floats, so they never fight each other for the same pixels. */
const LAYER = {
  check: 0.004,
  last: 0.006,
  noted: 0.008,
  reach: 0.010,
  selected: 0.012,
  cursor: 0.014
} as const

export interface Marks {
  selected: string | null
  /** Squares the held piece can move to that are empty. */
  legal: string[]
  /** Squares the held piece can move to that have something to take. */
  captures: string[]
  lastFrom: string | null
  lastTo: string | null
  /** Squares a lesson or a puzzle is pointing at. */
  noted: string[]
  check: string | null
  /** Where the keyboard is, or an empty string when the keyboard is not being used. */
  cursor: string
}

export function noMarks(): Marks {
  return { selected: null, legal: [], captures: [], lastFrom: null, lastTo: null, noted: [], check: null, cursor: '' }
}

export interface SceneStats {
  /** Things the renderer has to draw. One per mesh, because none of this is batched beyond what is merged. */
  meshes: number
  /** The coordinate labels, which are drawn too and cost the same as a mesh each. */
  sprites: number
  triangles: number
  /** Distinct shapes held in memory, and distinct materials. Shared, so far fewer than there are meshes. */
  geometries: number
  materials: number
}

export interface BoardScene {
  scene: import('three').Scene
  camera: import('three').PerspectiveCamera
  /** Sprites for the coordinates go in here, which is the only part the browser-facing code adds to. */
  labels: import('three').Group
  setViewport(width: number, height: number): void
  applyView(view: View): void
  setPosition(pieces: BoardSquare[], orientation: Orientation): void
  setMarks(marks: Marks, orientation: Orientation): void
  /** Lifts the held piece off its square. `amount` runs 0 to 1 so the component can ease it, or not. */
  setLift(square: string | null, amount: number, orientation: Orientation): void
  setLabelsVisible(visible: boolean): void
  stats(): SceneStats
  dispose(): void
}

/** Turns one part of a piece into a shape, placed and turned where the piece description says. */
function partGeometry(T: Three, part: Part): import('three').BufferGeometry {
  if (part.kind === 'sphere') {
    const g = new T.SphereGeometry(part.r, 18, 12)
    g.translate(part.at[0], part.at[1], part.at[2])
    return g
  }
  if (part.kind === 'torus') {
    const g = new T.TorusGeometry(part.r, part.tube, 10, 28)
    g.rotateX(-Math.PI / 2)
    g.translate(part.at[0], part.at[1], part.at[2])
    return g
  }
  if (part.kind === 'cylinder') {
    const g = new T.CylinderGeometry(part.rTop, part.rBottom, part.h, 20)
    if (part.pitch) g.rotateX(part.pitch)
    g.translate(part.at[0], part.at[1], part.at[2])
    return g
  }
  const g = new T.BoxGeometry(part.size[0], part.size[1], part.size[2])
  if (part.pitch) g.rotateX(part.pitch)
  if (part.yaw) g.rotateY(part.yaw)
  g.translate(part.at[0], part.at[1], part.at[2])
  return g
}

/** The three colours a piece can be made of: its own, the accent grey, and the band at its foot. */
export interface PieceGeometry {
  body: import('three').BufferGeometry
  accent: import('three').BufferGeometry | null
  rim: import('three').BufferGeometry | null
}

/**
 * One kind of piece, built once and shared by every copy of it.
 *
 * Joined into one shape per colour, so a piece made of a turned body and five solid parts is one thing to draw
 * rather than six. There are three shapes at most and usually two: the body, the band at the foot, and -- for the
 * bishop alone -- the slot in its mitre.
 */
function pieceGeometry(deps: SceneDeps, type: PieceLetter): PieceGeometry {
  const { T, mergeGeometries } = deps
  const shape = shapeFor(type)
  const profile = shape.profile.map((point) => new T.Vector2(point.r, point.y))
  const groups: Record<'body' | 'accent' | 'rim', import('three').BufferGeometry[]> = {
    body: [new T.LatheGeometry(profile, LATHE_SEGMENTS)],
    accent: [],
    rim: []
  }
  for (const part of shape.parts) groups[part.tone ?? 'body'].push(partGeometry(T, part))

  const join = (parts: import('three').BufferGeometry[]): import('three').BufferGeometry | null => {
    if (parts.length === 0) return null
    if (parts.length === 1) return parts[0]
    const joined = mergeGeometries(parts, false)
    // Merging makes a new shape; the parts that went into it are no use to anybody now.
    if (joined) for (const one of parts) one.dispose()
    return joined
  }
  const body = join(groups.body)
  if (!body) throw new Error(`the ${shape.name} could not be built`)
  const accent = join(groups.accent)
  const rim = join(groups.rim)
  body.computeBoundingSphere()
  accent?.computeBoundingSphere()
  rim?.computeBoundingSphere()
  return { body, accent, rim }
}

/** The sixty-four squares as two shapes: all the light ones, and all the dark ones. */
function checkerGeometry(
  deps: SceneDeps
): { light: import('three').BufferGeometry; dark: import('three').BufferGeometry } {
  const { T, mergeGeometries } = deps
  const light: import('three').BufferGeometry[] = []
  const dark: import('three').BufferGeometry[] = []
  for (const square of ALL_SQUARES) {
    /*
     * The orientation does not matter here, and that is a fact about chessboards rather than a shortcut: turning the
     * board round moves every square to the one diagonally opposite, which has the same colour. So the checkerboard
     * is built once and never rebuilt, and only the pieces and the coordinates move when the board is turned.
     */
    const spot = squareToWorld(square, 'w')
    if (!spot) continue
    const tile = new T.PlaneGeometry(1, 1)
    tile.rotateX(-Math.PI / 2)
    tile.translate(spot.x, 0, spot.z)
    ;(isDarkSquare(square) ? dark : light).push(tile)
  }
  const joinedLight = mergeGeometries(light, false)
  const joinedDark = mergeGeometries(dark, false)
  for (const one of [...light, ...dark]) one.dispose()
  if (!joinedLight || !joinedDark) throw new Error('the squares could not be built')
  return { light: joinedLight, dark: joinedDark }
}

/** A square outline, as one shape: four thin bars round the edge of a square. */
function outlineGeometry(deps: SceneDeps, thickness: number, inset: number): import('three').BufferGeometry {
  const { T, mergeGeometries } = deps
  const side = 1 - inset * 2
  const bars: import('three').BufferGeometry[] = []
  for (const [dx, dz, w, d] of [
    [0, -(side - thickness) / 2, side, thickness],
    [0, (side - thickness) / 2, side, thickness],
    [-(side - thickness) / 2, 0, thickness, side - thickness * 2],
    [(side - thickness) / 2, 0, thickness, side - thickness * 2]
  ] as [number, number, number, number][]) {
    const bar = new T.PlaneGeometry(w, d)
    bar.rotateX(-Math.PI / 2)
    bar.translate(dx, 0, dz)
    bars.push(bar)
  }
  const joined = mergeGeometries(bars, false)
  for (const one of bars) one.dispose()
  if (!joined) throw new Error('an outline could not be built')
  return joined
}

/** A dashed square outline, for the keyboard cursor: eight short bars with gaps between them. */
function dashGeometry(deps: SceneDeps): import('three').BufferGeometry {
  const { T, mergeGeometries } = deps
  const thickness = 0.045
  const side = 0.94
  const dash = side / 3
  const bars: import('three').BufferGeometry[] = []
  const half = side / 2
  for (const edge of [-1, 1]) {
    for (const along of [-1, 1]) {
      // Two dashes along the top and bottom edges, and two along the left and right, leaving the corners open.
      const across = new T.PlaneGeometry(dash, thickness)
      across.rotateX(-Math.PI / 2)
      across.translate((along * side) / 4, 0, edge * half)
      bars.push(across)
      const down = new T.PlaneGeometry(thickness, dash)
      down.rotateX(-Math.PI / 2)
      down.translate(edge * half, 0, (along * side) / 4)
      bars.push(down)
    }
  }
  const joined = mergeGeometries(bars, false)
  for (const one of bars) one.dispose()
  if (!joined) throw new Error('the cursor could not be built')
  return joined
}

type MarkKind = 'check' | 'last' | 'noted' | 'reach' | 'capture' | 'selected' | 'cursor'

/**
 * Builds the whole scene.
 *
 * Throws if a shape cannot be built, which the component catches and turns into the flat board with a plain
 * message. It never half-builds: anything already made is thrown away before the error leaves.
 */
export function createBoardScene(deps: SceneDeps, palette: Palette = DEFAULT_PALETTE): BoardScene {
  const { T } = deps
  const geometries: import('three').BufferGeometry[] = []
  const materials: import('three').Material[] = []
  const keep = <G extends import('three').BufferGeometry>(g: G): G => { geometries.push(g); return g }
  const keepMaterial = <M extends import('three').Material>(m: M): M => { materials.push(m); return m }

  try {
    const scene = new T.Scene()
    const camera = new T.PerspectiveCamera(38, 1, 0.1, 120)
    camera.up.set(0, 1, 0)

    /*
     * The lights.
     *
     * Three of them, each doing a job that readability depends on. The strong one from above and the right is what
     * gives the pieces shape and casts the shadows that separate them from the squares they stand on. The cool one
     * from behind and the left puts an edge on the dark pieces, which would otherwise disappear against the dark
     * squares at this angle. The ambient one stops the unlit sides going to black, because a king you cannot see
     * the shape of is worse than a flat drawing of one.
     */
    scene.add(new T.AmbientLight(0xffffff, 0.52))
    const key = new T.DirectionalLight(0xffffff, 1.65)
    key.position.set(5.5, 11, 6.5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -OUTER - 1
    key.shadow.camera.right = OUTER + 1
    key.shadow.camera.top = OUTER + 1
    key.shadow.camera.bottom = -OUTER - 1
    key.shadow.camera.near = 1
    key.shadow.camera.far = 30
    // Lifts the shadow off the surface a touch, which is what stops a piece's own shadow striping its base.
    key.shadow.bias = -0.0012
    scene.add(key)
    const rim = new T.DirectionalLight(0xa8ccff, 0.5)
    rim.position.set(-7, 4.5, -6)
    scene.add(rim)

    // The board itself: a slab with a border, and the squares laid on top of it.
    const frameMaterial = keepMaterial(new T.MeshStandardMaterial({
      color: new T.Color(palette.frame), roughness: 0.78, metalness: 0.06
    }))
    const slab = keep(new T.BoxGeometry(OUTER * 2, SLAB, OUTER * 2))
    // The top of the slab sits a whisker under the squares so the two never argue about the same pixels.
    slab.translate(0, -SLAB / 2 - 0.002, 0)
    const slabMesh = new T.Mesh(slab, frameMaterial)
    slabMesh.receiveShadow = true
    scene.add(slabMesh)

    const checker = checkerGeometry(deps)
    keep(checker.light)
    keep(checker.dark)
    const lightMaterial = keepMaterial(new T.MeshStandardMaterial({
      color: new T.Color(palette.light), roughness: 0.62, metalness: 0.02
    }))
    const darkMaterial = keepMaterial(new T.MeshStandardMaterial({
      color: new T.Color(palette.dark), roughness: 0.62, metalness: 0.02
    }))
    for (const [geometry, material] of [[checker.light, lightMaterial], [checker.dark, darkMaterial]] as const) {
      const mesh = new T.Mesh(geometry, material)
      mesh.receiveShadow = true
      scene.add(mesh)
    }

    // The pieces. One shape per kind, shared by every copy of it; two materials for the whole set.
    const pieceMaterials: Record<'w' | 'b', import('three').MeshStandardMaterial> = {
      w: keepMaterial(new T.MeshStandardMaterial({ color: new T.Color(palette.whitePiece), roughness: 0.34, metalness: 0.04 })),
      b: keepMaterial(new T.MeshStandardMaterial({ color: new T.Color(palette.blackPiece), roughness: 0.42, metalness: 0.08 }))
    }
    const accentMaterial = keepMaterial(new T.MeshStandardMaterial({
      color: new T.Color(palette.accent), roughness: 0.5, metalness: 0.1
    }))
    /*
     * The bands at the foot of the pieces.
     *
     * Dark under a white piece and light under a black one, because a white piece barely separates from a light
     * square in flat colour and a black piece barely separates from a dark one. This is the one thing on the board
     * that is there for legibility and nothing else.
     */
    const rimMaterials: Record<'w' | 'b', import('three').MeshStandardMaterial> = {
      w: keepMaterial(new T.MeshStandardMaterial({ color: new T.Color(palette.rimOnWhite), roughness: 0.46, metalness: 0.12 })),
      b: keepMaterial(new T.MeshStandardMaterial({ color: new T.Color(palette.rimOnBlack), roughness: 0.46, metalness: 0.12 }))
    }
    const shapes = new Map<PieceLetter, PieceGeometry>()
    for (const { type } of allShapes()) {
      const built = pieceGeometry(deps, type)
      keep(built.body)
      if (built.accent) keep(built.accent)
      if (built.rim) keep(built.rim)
      shapes.set(type, built)
    }

    const pieceRoot = new T.Group()
    scene.add(pieceRoot)
    /** One copy of a piece. `kind` is its colour and letter together, which is what it can be reused for. */
    interface Slot { group: import('three').Group; kind: string }
    /** Spare pieces, by colour and kind. A promotion to a ninth queen builds one more and keeps it for next time. */
    const pool = new Map<string, Slot[]>()
    const inUse: Slot[] = []

    const makeSlot = (color: 'w' | 'b', type: PieceLetter): Slot => {
      const built = shapes.get(type)
      if (!built) throw new Error(`no shape for ${type}`)
      const group = new T.Group()
      const body = new T.Mesh(built.body, pieceMaterials[color])
      body.castShadow = true
      body.receiveShadow = true
      group.add(body)
      if (built.rim) {
        const rim = new T.Mesh(built.rim, rimMaterials[color])
        rim.castShadow = true
        group.add(rim)
      }
      if (built.accent) {
        const accent = new T.Mesh(built.accent, accentMaterial)
        accent.castShadow = true
        group.add(accent)
      }
      group.visible = false
      pieceRoot.add(group)
      return { group, kind: `${color}${type}` }
    }

    let liftedSquare: string | null = null
    let liftAmount = 0
    const placed = new Map<string, Slot>()

    const setPosition = (pieces: BoardSquare[], orientation: Orientation): void => {
      // Everything goes back in the pool first, so a piece that was taken cannot be left standing somewhere.
      for (const slot of inUse) {
        slot.group.visible = false
        const list = pool.get(slot.kind) ?? []
        list.push(slot)
        pool.set(slot.kind, list)
      }
      inUse.length = 0
      placed.clear()
      for (const piece of pieces) {
        const spot = squareToWorld(piece.square, orientation)
        // A piece on a square that is not a square is not drawn, and no copy is spent on it either.
        if (!spot) continue
        const kind = `${piece.color}${piece.type}`
        const list = pool.get(kind) ?? []
        const slot = list.pop() ?? makeSlot(piece.color, piece.type)
        pool.set(kind, list)
        slot.group.position.set(spot.x, 0, spot.z)
        slot.group.rotation.y = pieceYaw(piece.color, orientation)
        slot.group.visible = true
        inUse.push(slot)
        placed.set(piece.square, slot)
      }
      // A piece that was being held may have moved or been taken; re-apply the lift against the new position.
      applyLift(orientation)
    }

    function applyLift(orientation: Orientation): void {
      for (const [square, slot] of placed) {
        const spot = squareToWorld(square, orientation)
        const lift = square === liftedSquare ? LIFT_HEIGHT * liftAmount : 0
        slot.group.position.set(spot ? spot.x : 0, lift, spot ? spot.z : 0)
      }
    }

    const setLift = (square: string | null, amount: number, orientation: Orientation): void => {
      liftedSquare = square
      liftAmount = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0
      applyLift(orientation)
    }

    /*
     * The marks.
     *
     * Each kind is a flat shape floating a fraction above the squares, and each kind gets its own height so they
     * stack in a fixed order rather than flickering against each other. `depthWrite` is off because they are
     * see-through: a mark that wrote to the depth buffer would hide the mark above it.
     */
    const markGeometry: Record<MarkKind, import('three').BufferGeometry> = {
      check: keep(flatSquare(T, 0.995)),
      last: keep(flatSquare(T, 0.995)),
      noted: keep(outlineGeometry(deps, 0.07, 0.03)),
      reach: keep(new T.CircleGeometry(0.155, 26).rotateX(-Math.PI / 2)),
      capture: keep(outlineGeometry(deps, 0.1, 0.02)),
      selected: keep(outlineGeometry(deps, 0.075, 0.015)),
      cursor: keep(dashGeometry(deps))
    }
    const markMaterial: Record<MarkKind, import('three').Material> = {
      check: keepMaterial(flatMaterial(T, palette.danger, 0.62)),
      last: keepMaterial(flatMaterial(T, palette.mark, 0.26)),
      noted: keepMaterial(flatMaterial(T, palette.noted, 0.95)),
      reach: keepMaterial(flatMaterial(T, palette.mark, 0.78)),
      capture: keepMaterial(flatMaterial(T, palette.mark, 0.72)),
      selected: keepMaterial(flatMaterial(T, palette.mark, 1)),
      cursor: keepMaterial(flatMaterial(T, palette.mark, 0.85))
    }
    const markHeight: Record<MarkKind, number> = {
      check: LAYER.check,
      last: LAYER.last,
      noted: LAYER.noted,
      reach: LAYER.reach,
      capture: LAYER.reach,
      selected: LAYER.selected,
      cursor: LAYER.cursor
    }
    const markRoot = new T.Group()
    scene.add(markRoot)
    const markPool: Record<MarkKind, import('three').Mesh[]> = {
      check: [], last: [], noted: [], reach: [], capture: [], selected: [], cursor: []
    }
    const markUsed: Record<MarkKind, number> = {
      check: 0, last: 0, noted: 0, reach: 0, capture: 0, selected: 0, cursor: 0
    }

    const mark = (kind: MarkKind, square: string | null, orientation: Orientation): void => {
      if (!square) return
      const spot = squareToWorld(square, orientation)
      if (!spot) return
      const index = markUsed[kind]
      let mesh = markPool[kind][index]
      if (!mesh) {
        mesh = new T.Mesh(markGeometry[kind], markMaterial[kind])
        mesh.renderOrder = 2 + Math.round(markHeight[kind] * 1000)
        markPool[kind].push(mesh)
        markRoot.add(mesh)
      }
      mesh.position.set(spot.x, markHeight[kind], spot.z)
      mesh.visible = true
      markUsed[kind] = index + 1
    }

    const setMarks = (marks: Marks, orientation: Orientation): void => {
      for (const kind of Object.keys(markUsed) as MarkKind[]) markUsed[kind] = 0
      mark('check', marks.check, orientation)
      mark('last', marks.lastFrom, orientation)
      mark('last', marks.lastTo, orientation)
      for (const square of marks.noted) mark('noted', square, orientation)
      for (const square of marks.legal) mark('reach', square, orientation)
      for (const square of marks.captures) mark('capture', square, orientation)
      mark('selected', marks.selected, orientation)
      mark('cursor', marks.cursor || null, orientation)
      // Whatever was not needed this time is hidden rather than removed, so the next position costs nothing.
      for (const kind of Object.keys(markPool) as MarkKind[]) {
        for (let i = markUsed[kind]; i < markPool[kind].length; i += 1) markPool[kind][i].visible = false
      }
    }

    const labels = new T.Group()
    scene.add(labels)

    const setViewport = (width: number, height: number): void => {
      if (width <= 0 || height <= 0) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    const target = new T.Vector3(TARGET.x, TARGET.y, TARGET.z)
    const applyView = (view: View): void => {
      const spot: Vec3 = cameraPosition(view)
      camera.position.set(spot.x, spot.y, spot.z)
      camera.lookAt(target)
    }

    const stats = (): SceneStats => {
      let meshes = 0
      let sprites = 0
      let triangles = 0
      const shapesSeen = new Set<import('three').BufferGeometry>()
      const materialsSeen = new Set<import('three').Material>()
      // Only what is visible: a scene full of pooled pieces standing by costs nothing to draw.
      scene.traverseVisible((object) => {
        const asSprite = object as import('three').Sprite
        if (asSprite.isSprite) {
          sprites += 1
          if (asSprite.material) materialsSeen.add(asSprite.material)
          return
        }
        const asMesh = object as import('three').Mesh
        if (!asMesh.isMesh || !asMesh.geometry) return
        meshes += 1
        shapesSeen.add(asMesh.geometry)
        const material = asMesh.material
        for (const one of Array.isArray(material) ? material : [material]) materialsSeen.add(one)
        const geometry = asMesh.geometry
        const count = geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0)
        triangles += Math.floor(count / 3)
      })
      return { meshes, sprites, triangles, geometries: shapesSeen.size, materials: materialsSeen.size }
    }

    const dispose = (): void => {
      for (const one of geometries) one.dispose()
      for (const one of materials) one.dispose()
      // The sprites for the coordinates are made by the browser-facing code and carry textures of their own.
      labels.traverse((object) => {
        const sprite = object as import('three').Sprite
        const material = sprite.material as import('three').SpriteMaterial | undefined
        if (material) {
          material.map?.dispose()
          material.dispose()
        }
      })
      scene.clear()
    }

    return {
      scene,
      camera,
      labels,
      setViewport,
      applyView,
      setPosition,
      setMarks,
      setLift,
      setLabelsVisible: (visible: boolean) => { labels.visible = visible },
      stats,
      dispose
    }
  } catch (err) {
    for (const one of geometries) one.dispose()
    for (const one of materials) one.dispose()
    throw err
  }
}

/** A flat square lying on the board, used for the two marks that fill a whole square. */
function flatSquare(T: Three, side: number): import('three').BufferGeometry {
  const plane = new T.PlaneGeometry(side, side)
  plane.rotateX(-Math.PI / 2)
  return plane
}

/** A mark's material: an unlit colour, see-through, and never hiding what is above it. */
function flatMaterial(T: Three, colour: string, opacity: number): import('three').Material {
  return new T.MeshBasicMaterial({
    color: new T.Color(colour),
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: T.DoubleSide
  })
}

/** Where the coordinate labels go, worked out here so the browser-facing code only has to make the pictures. */
export const LABEL_INSET = FRAME / 2
export const LABEL_EDGE = HALF + LABEL_INSET
