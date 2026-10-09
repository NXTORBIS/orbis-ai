/**
 * The 3D pipeline, one matrix at a time.
 *
 * ## Why every stage is returned
 *
 * A renderer that takes a shape and gives back a picture teaches nothing. The interesting part is that a point
 * passes through four different spaces on its way to the screen — model, world, camera, clip — and that the
 * perspective divide at the end is the single step that makes distant things small. So each stage hands back the
 * points as they stood, and the laboratory can show the same cube in all four.
 *
 * ## The projection is the lesson
 *
 * Orthographic and perspective differ by one thing: whether x and y are divided by depth. Showing both from the
 * same matrix stack, with a switch, is the only way that stops being a sentence people repeat.
 *
 * ## What is not here
 *
 * No lighting model worth the name, no textures, no shaders, no rasteriser. This draws wireframes, and the
 * back-face test is the one piece of hidden-surface work it does. Saying so matters: a laboratory that implied it
 * was a renderer would be claiming something Orbis has not got.
 *
 * Pure. No clock, no randomness.
 */

export interface GraphicsError {
  error: 'input' | 'too-big' | 'degenerate'
  message: string
  fix: string
}

export const isGraphicsError = (value: unknown): value is GraphicsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>) && 'fix' in (value as Record<string, unknown>)

const fail = (error: GraphicsError['error'], message: string, fix: string): GraphicsError => ({ error, message, fix })

export const LIMITS = Object.freeze({ vertices: 4_000, faces: 4_000, subdivisions: 4 })

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface Shape {
  name: string
  vertices: readonly Point3[]
  /** Each face as the vertex numbers around it, anticlockwise seen from outside. */
  faces: readonly (readonly number[])[]
  /** Pairs of vertex numbers, for drawing the wireframe. Worked out from the faces. */
  edges: readonly (readonly [number, number])[]
}

/** A 4×4 matrix, row-major. Sixteen numbers, because that is what a matrix is. */
export type Matrix = readonly number[]

export const identity = (): Matrix => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** a then b. The order matters and this is the one people get backwards: `multiply(a, b)` applies a first. */
export function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0)
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0
      for (let k = 0; k < 4; k += 1) sum += b[row * 4 + k] * a[k * 4 + column]
      out[row * 4 + column] = sum
    }
  }
  return out
}

export const translation = (x: number, y: number, z: number): Matrix => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]

export const scaling = (x: number, y: number, z: number): Matrix => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]

export function rotationX(radians: number): Matrix {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
}

export function rotationY(radians: number): Matrix {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]
}

export function rotationZ(radians: number): Matrix {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/**
 * The perspective matrix.
 *
 * It does not divide — it puts the depth into the fourth component, and the divide happens afterwards. That
 * separation is why it can be a matrix at all, and it is the part that surprises people.
 */
export function perspective(fieldOfView: number, aspect: number, near: number, far: number): Matrix | GraphicsError {
  if (!(fieldOfView > 1 && fieldOfView < 179)) return fail('input', `A field of view of ${fieldOfView}° does not make a picture.`, 'Use something between 1 and 179 degrees.')
  if (!(near > 0 && far > near)) return fail('input', 'The near plane has to be in front of the camera and the far plane beyond it.', 'Try near 0.1 and far 100.')
  const f = 1 / Math.tan((fieldOfView * Math.PI) / 360)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), (2 * far * near) / (near - far), 0, 0, -1, 0]
}

/** The orthographic matrix: the same stack with the depth left out of the fourth component, so nothing shrinks. */
export function orthographic(size: number, aspect: number, near: number, far: number): Matrix {
  const right = size * aspect
  return [1 / right, 0, 0, 0, 0, 1 / size, 0, 0, 0, 0, -2 / (far - near), -(far + near) / (far - near), 0, 0, 0, 1]
}

/** Where the camera is and what it is looking at, as a matrix that moves the world instead of the camera. */
export function lookAt(from: Point3, to: Point3, up: Point3 = { x: 0, y: 1, z: 0 }): Matrix | GraphicsError {
  const forward = normalise({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z })
  if (forward === null) return fail('degenerate', 'The camera is at the point it is looking at.', 'Move the camera, or look somewhere else.')
  const right = normalise(cross(forward, up))
  if (right === null) return fail('degenerate', 'The camera is looking straight along its own up direction.', 'Change the up direction, or look somewhere else.')
  const trueUp = cross(right, forward)
  return [
    right.x, right.y, right.z, -(right.x * from.x + right.y * from.y + right.z * from.z),
    trueUp.x, trueUp.y, trueUp.z, -(trueUp.x * from.x + trueUp.y * from.y + trueUp.z * from.z),
    -forward.x, -forward.y, -forward.z, forward.x * from.x + forward.y * from.y + forward.z * from.z,
    0, 0, 0, 1
  ]
}

const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })

const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z

function normalise(one: Point3): Point3 | null {
  const length = Math.hypot(one.x, one.y, one.z)
  if (!(length > 1e-12)) return null
  return { x: one.x / length, y: one.y / length, z: one.z / length }
}

/** A point through a matrix, keeping w so the divide can be shown separately. */
export function apply(matrix: Matrix, point: Point3): { x: number; y: number; z: number; w: number } {
  return {
    x: matrix[0] * point.x + matrix[1] * point.y + matrix[2] * point.z + matrix[3],
    y: matrix[4] * point.x + matrix[5] * point.y + matrix[6] * point.z + matrix[7],
    z: matrix[8] * point.x + matrix[9] * point.y + matrix[10] * point.z + matrix[11],
    w: matrix[12] * point.x + matrix[13] * point.y + matrix[14] * point.z + matrix[15]
  }
}

// ---------------------------------------------------------------- shapes

/** Edges from faces, each pair once, lower number first. */
function edgesOf(faces: readonly (readonly number[])[]): [number, number][] {
  const seen = new Set<string>()
  const out: [number, number][] = []
  for (const face of faces) {
    for (let at = 0; at < face.length; at += 1) {
      const a = face[at]
      const b = face[(at + 1) % face.length]
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(a < b ? [a, b] : [b, a])
    }
  }
  return out
}

const shape = (name: string, vertices: Point3[], faces: number[][]): Shape => ({ name, vertices, faces, edges: edgesOf(faces) })

export function cube(size = 1): Shape {
  const h = size / 2
  return shape(
    'Cube',
    [
      { x: -h, y: -h, z: -h }, { x: h, y: -h, z: -h }, { x: h, y: h, z: -h }, { x: -h, y: h, z: -h },
      { x: -h, y: -h, z: h }, { x: h, y: -h, z: h }, { x: h, y: h, z: h }, { x: -h, y: h, z: h }
    ],
    [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5]]
  )
}

export function tetrahedron(size = 1): Shape {
  const h = size / 2
  return shape(
    'Tetrahedron',
    [{ x: h, y: h, z: h }, { x: -h, y: -h, z: h }, { x: -h, y: h, z: -h }, { x: h, y: -h, z: -h }],
    [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
  )
}

export function octahedron(size = 1): Shape {
  const h = size / 2
  return shape(
    'Octahedron',
    [{ x: h, y: 0, z: 0 }, { x: -h, y: 0, z: 0 }, { x: 0, y: h, z: 0 }, { x: 0, y: -h, z: 0 }, { x: 0, y: 0, z: h }, { x: 0, y: 0, z: -h }],
    [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]
  )
}

/** A sphere built from rings of quads. More bands means rounder and slower, which is the trade worth seeing. */
export function sphere(size = 1, bands = 12): Shape {
  const radius = size / 2
  const rings = Math.max(3, Math.min(40, Math.floor(bands)))
  const vertices: Point3[] = []
  const faces: number[][] = []
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * Math.PI
    for (let segment = 0; segment <= rings; segment += 1) {
      const theta = (segment / rings) * Math.PI * 2
      vertices.push({ x: radius * Math.sin(phi) * Math.cos(theta), y: radius * Math.cos(phi), z: radius * Math.sin(phi) * Math.sin(theta) })
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < rings; segment += 1) {
      const a = ring * (rings + 1) + segment
      const b = a + rings + 1
      faces.push([a, b, b + 1, a + 1])
    }
  }
  return shape('Sphere', vertices, faces)
}

export function torus(size = 1, ringRadius = 0.3, bands = 16): Shape {
  const big = size / 2
  const rings = Math.max(3, Math.min(32, Math.floor(bands)))
  const vertices: Point3[] = []
  const faces: number[][] = []
  for (let one = 0; one < rings; one += 1) {
    const u = (one / rings) * Math.PI * 2
    for (let two = 0; two < rings; two += 1) {
      const v = (two / rings) * Math.PI * 2
      vertices.push({
        x: (big + ringRadius * Math.cos(v)) * Math.cos(u),
        y: ringRadius * Math.sin(v),
        z: (big + ringRadius * Math.cos(v)) * Math.sin(u)
      })
    }
  }
  for (let one = 0; one < rings; one += 1) {
    for (let two = 0; two < rings; two += 1) {
      const a = one * rings + two
      const b = ((one + 1) % rings) * rings + two
      const c = ((one + 1) % rings) * rings + ((two + 1) % rings)
      const d = one * rings + ((two + 1) % rings)
      faces.push([a, b, c, d])
    }
  }
  return shape('Torus', vertices, faces)
}

export function pyramid(size = 1): Shape {
  const h = size / 2
  return shape(
    'Pyramid',
    [{ x: -h, y: -h, z: -h }, { x: h, y: -h, z: -h }, { x: h, y: -h, z: h }, { x: -h, y: -h, z: h }, { x: 0, y: h, z: 0 }],
    [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
  )
}

export const SHAPES: readonly { id: string; name: string; make: (size: number, detail: number) => Shape }[] = Object.freeze([
  { id: 'cube', name: 'Cube', make: (size) => cube(size) },
  { id: 'tetrahedron', name: 'Tetrahedron', make: (size) => tetrahedron(size) },
  { id: 'octahedron', name: 'Octahedron', make: (size) => octahedron(size) },
  { id: 'pyramid', name: 'Pyramid', make: (size) => pyramid(size) },
  { id: 'sphere', name: 'Sphere', make: (size, detail) => sphere(size, detail) },
  { id: 'torus', name: 'Torus', make: (size, detail) => torus(size, 0.3, detail) }
])

// ---------------------------------------------------------------- the pipeline

export interface Stage {
  name: string
  what: string
  /** The first few points as they stood after this stage, for the table that shows them changing. */
  sample: readonly { x: number; y: number; z: number; w?: number }[]
}

export interface RenderReport {
  /** Where every vertex lands on screen, in pixels. Null for the ones behind the camera. */
  screen: readonly ({ x: number; y: number; depth: number } | null)[]
  /** Which edges to draw, after the ones with a vertex behind the camera are dropped. */
  edges: readonly (readonly [number, number])[]
  /** Each face with its depth and whether it faces away, so the drawing can hide the back ones. */
  faces: readonly { points: readonly number[]; depth: number; facingAway: boolean; shade: number }[]
  stages: readonly Stage[]
  /** What the four matrices came out as, for the panel that shows them. */
  matrices: Readonly<Record<string, Matrix>>
  visible: number
  hidden: number
  says: string
  notes: readonly string[]
}

export interface RenderOptions {
  shape: Shape
  rotateX: number
  rotateY: number
  rotateZ: number
  distance: number
  fieldOfView: number
  projection: 'perspective' | 'orthographic'
  width: number
  height: number
  backFaceCulling: boolean
}

/**
 * Put a shape through the whole pipeline and say what happened at each stage.
 *
 * The order is model → world → camera → clip → divide → screen, and it is the order the matrices multiply in. The
 * perspective divide is kept as its own stage because it is the only step that is not a matrix, and the only one
 * that makes distant things small.
 */
export function render(options: RenderOptions): RenderReport | GraphicsError {
  const { shape: solid, width, height } = options
  if (solid.vertices.length === 0) return fail('input', 'The shape has no points.', 'Pick a shape.')
  if (solid.vertices.length > LIMITS.vertices) return fail('too-big', `${solid.vertices.length} points is more than this traces.`, `Use at most ${LIMITS.vertices}.`)
  if (!(width > 0 && height > 0)) return fail('input', 'The picture has no size.', 'Give a width and a height.')
  if (!(options.distance > 0)) return fail('input', 'The camera is at or behind the shape.', 'Move it further away.')

  const model = multiply(multiply(rotationX(options.rotateX), rotationY(options.rotateY)), rotationZ(options.rotateZ))
  const view = lookAt({ x: 0, y: 0, z: options.distance }, { x: 0, y: 0, z: 0 })
  if (isGraphicsError(view)) return view
  const aspect = width / height
  const projection =
    options.projection === 'perspective' ? perspective(options.fieldOfView, aspect, 0.1, 1000) : orthographic(1.2, aspect, 0.1, 1000)
  if (isGraphicsError(projection)) return projection

  const world = solid.vertices.map((one) => {
    const made = apply(model, one)
    return { x: made.x, y: made.y, z: made.z }
  })
  const camera = world.map((one) => {
    const made = apply(view, one)
    return { x: made.x, y: made.y, z: made.z }
  })
  const clip = camera.map((one) => apply(projection, one))

  const screen = clip.map((one) => {
    // The divide. Everything before this was linear; this is where depth starts to matter.
    if (options.projection === 'perspective' && one.w <= 0.0001) return null
    const w = options.projection === 'perspective' ? one.w : 1
    const ndcX = one.x / w
    const ndcY = one.y / w
    const ndcZ = one.z / w
    if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return null
    return { x: ((ndcX + 1) / 2) * width, y: ((1 - ndcY) / 2) * height, depth: ndcZ }
  })

  const edges = solid.edges.filter(([a, b]) => screen[a] !== null && screen[b] !== null)

  const faces = solid.faces.map((face) => {
    const points = face.map((one) => camera[one])
    // The face normal in camera space. Facing away means its normal points along the view direction.
    const a = points[0]
    const b = points[1]
    const c = points[2]
    const normal = cross({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z })
    const unit = normalise(normal) ?? { x: 0, y: 0, z: 1 }
    const facingAway = dot(unit, a) > 0
    const depth = points.reduce((out, one) => out + one.z, 0) / points.length
    // A flat shade from how square-on the face is to the camera. Not a lighting model, and the notes say so.
    const shade = Math.max(0, Math.min(1, Math.abs(unit.z)))
    return { points: face, depth, facingAway, shade }
  })

  const visible = options.backFaceCulling ? faces.filter((one) => !one.facingAway).length : faces.length
  const show = (one: { x: number; y: number; z: number; w?: number }) => ({
    x: Number(one.x.toFixed(3)),
    y: Number(one.y.toFixed(3)),
    z: Number(one.z.toFixed(3)),
    ...(one.w !== undefined ? { w: Number(one.w.toFixed(3)) } : {})
  })

  return {
    screen: Object.freeze(screen),
    edges: Object.freeze(edges),
    faces: Object.freeze(faces),
    stages: Object.freeze([
      { name: 'model', what: 'the shape as it was built, before anything moved it', sample: solid.vertices.slice(0, 4).map(show) },
      { name: 'world', what: 'after the rotations — the shape has turned, the camera has not moved', sample: world.slice(0, 4).map(show) },
      { name: 'camera', what: 'the same points seen from where the camera is, looking down −z', sample: camera.slice(0, 4).map(show) },
      { name: 'clip', what: 'after the projection matrix. The depth is now in w and nothing has been divided yet', sample: clip.slice(0, 4).map(show) },
      {
        name: 'screen',
        what: options.projection === 'perspective' ? 'after dividing by w — this is the step that makes distant things small' : 'no divide: orthographic keeps everything the same size whatever its depth',
        sample: screen.slice(0, 4).map((one) => (one === null ? { x: NaN, y: NaN, z: NaN } : { x: Number(one.x.toFixed(1)), y: Number(one.y.toFixed(1)), z: Number(one.depth.toFixed(3)) }))
      }
    ]),
    matrices: Object.freeze({ model, view, projection }),
    visible,
    hidden: faces.length - visible,
    says: `${solid.vertices.length} points, ${solid.edges.length} edges, ${faces.length} faces — ${visible} facing the camera.`,
    notes: Object.freeze([
      options.projection === 'perspective'
        ? 'Perspective divides x and y by depth. That one division is the whole difference between the two projections, and it happens after the matrix rather than inside it.'
        : 'Orthographic does not divide by depth, so a far face is exactly the size of a near one. Switch to perspective and watch the back of the shape shrink.',
      'The back-face test compares each face’s normal with the direction to the camera. It is the cheapest hidden-surface method there is and it only works on a closed shape.',
      'The shading is how square-on a face is to the camera. It is not a lighting model — there is no light in this scene.'
    ])
  }
}
