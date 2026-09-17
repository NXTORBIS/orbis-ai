import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { ArrowLeft, Crosshair, Link2, Maximize2, NotebookPen, Orbit, PenLine, Sparkles, Unlink, X } from 'lucide-react'
import { GALAXY_RELATION_LABELS, GALAXY_TYPE_COLORS, GALAXY_TYPE_LABELS, GALAXY_TYPES } from '../../../shared/galaxy'
import type { GalaxyEdge, GalaxyGraph, GalaxyNode, GalaxyNodeType, GalaxyView as View } from '../../../shared/galaxy'
import type { GalaxyDescription } from '../../../shared/types'
import { newWorkspace, withProjectItem } from '../../../shared/workspaces'
import type { Workspace } from '../../../shared/workspaces'
import { openInOrbisBrowser } from '../lib/openInBrowser'
import type { NoticeKind } from '../App'

/**
 * Galaxy: what this profile has kept in Orbis, and how it is really connected.
 *
 * Every dot is something that exists — research, a page it used, a note, a task, a memory, a skill — and every line is
 * either written in the data or drawn by the person. Selecting a dot says, in words, why each of its lines is there.
 * Nothing is sent anywhere unless the person asks Orion about a selection, and then only that selection.
 */

interface Props {
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
  /** Starts a new chat with this message, as if the person had typed it. */
  onAsk(message: string): void
}

type SimNode = GalaxyNode & SimulationNodeDatum & {
  degree: number
  /** Its own place in the twinkle, so the sky does not blink as one. */
  phase: number
  /** Where it was last actually drawn, which is what a click is measured against. */
  px?: number
  py?: number
}
type SimLink = SimulationLinkDatum<SimNode> & { edge: GalaxyEdge }

const COLORS = GALAXY_TYPE_COLORS

/** A speck of far-off sky. Kept in fractions of the canvas so it survives the window changing size. */
interface Star {
  x: number
  y: number
  size: number
  /** How near it is: near specks drift further as the map is moved, which is what makes the sky feel deep. */
  depth: number
  phase: number
}

/** A slow wash of colour behind everything, so the dark is not flat. */
interface Nebula {
  x: number
  y: number
  radius: number
  color: string
  phase: number
}

/** One streak across the sky, alive for about a second. */
interface Meteor {
  x: number
  y: number
  vx: number
  vy: number
  life: number
}

/** The same number every time for the same thing, so a star twinkles the same way each time the map is drawn. */
function phaseOf(id: string): number {
  let h = 7
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003
  return (h / 100003) * Math.PI * 2
}

/** How far the whole field has turned by now. One turn takes about nine minutes: motion you feel rather than watch. */
const spinAt = (t: number): number => t * 0.000012

/** How far a star wanders from its settled place. The busier it is, the steadier it holds. */
const wanderOf = (degree: number): number => 4 + 7 / (1 + degree)

const RANGES: [string, number | null][] = [
  ['Any time', null],
  ['Past week', 7],
  ['Past month', 30],
  ['Past year', 365]
]

const said = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work.')

export default function GalaxyView({ onClose, onNotify, onAsk }: Props): React.JSX.Element {
  const [graph, setGraph] = useState<GalaxyGraph | null>(null)
  const [view, setView] = useState<View>({})
  const [history, setHistory] = useState<View[]>([])
  const [query, setQuery] = useState('')
  const [types, setTypes] = useState<GalaxyNodeType[]>([])
  const [range, setRange] = useState<number | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [details, setDetails] = useState<GalaxyDescription | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  /** A connection waiting for its optional reason. */
  const [linkDraft, setLinkDraft] = useState<{ from: string; to: string; note: string } | null>(null)
  /** The question for Orion about the selection, while it is being written. */
  const [question, setQuestion] = useState<string | null>(null)
  const [projects, setProjects] = useState<Workspace[]>([])
  const [projectName, setProjectName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sim = useRef<Simulation<SimNode, SimLink> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const camera = useRef({ x: 0, y: 0, k: 1 })
  const hover = useRef<string | null>(null)
  const draw = useRef<() => void>(() => undefined)
  /** The sky is made once and kept, so it does not re-scatter itself on every frame. */
  const skyRef = useRef<{ stars: Star[]; nebulae: Nebula[] } | null>(null)
  const meteorsRef = useRef<Meteor[]>([])
  /** How long the map has been moving, and whether it is moving at all. */
  const clock = useRef(0)
  const last = useRef(0)
  const moving = useRef(false)

  // ---------------------------------------------------------------- data

  const effective = useMemo<View>(() => ({ ...view, ...(types.length ? { types } : {}), ...(range ? { from: Date.now() - range * 86_400_000 } : {}) }), [view, types, range])

  const load = useCallback(() => {
    setLoading(true)
    void window.api
      .galaxyView({ ...effective, limit: 400 })
      .then((g) => setGraph(g))
      .catch((err: unknown) => onNotify(`Galaxy could not be loaded: ${said(err)}`, 'warn'))
      .finally(() => setLoading(false))
  }, [effective, onNotify])

  useEffect(() => load(), [load])
  useEffect(() => {
    const refresh = (): void => void window.api.listWorkspaces().then((r) => setProjects(r.workspaces.filter((w) => w.project)))
    refresh()
    return window.api.onWorkspacesChanged(refresh)
  }, [])
  useEffect(() => window.api.onGalaxyChanged(() => load()), [load])

  useEffect(() => {
    const only = selected.length === 1 ? selected[0] : null
    if (!only) return setDetails(null)
    void window.api.galaxyDescribe(only).then(setDetails).catch(() => setDetails(null))
  }, [selected, graph])

  const go = (next: View): void => {
    setHistory((h) => [...h.slice(-20), view])
    setView(next)
    setSelected([])
  }
  const back = (): void => {
    const previous = history.at(-1)
    if (!previous) return
    setHistory((h) => h.slice(0, -1))
    setView(previous)
    setSelected([])
  }

  // ---------------------------------------------------------------- layout and drawing

  useEffect(() => {
    if (!graph) return undefined
    const old = new Map(nodesRef.current.map((n) => [n.id, n]))
    const degree = new Map<string, number>()
    for (const e of graph.edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
    }
    const nodes: SimNode[] = graph.nodes.map((n) => {
      const was = old.get(n.id)
      return { ...n, degree: degree.get(n.id) ?? 0, phase: phaseOf(n.id), x: was?.x, y: was?.y, vx: was?.vx, vy: was?.vy }
    })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const links: SimLink[] = graph.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((edge) => ({ source: byId.get(edge.from)!, target: byId.get(edge.to)!, edge }))
    nodesRef.current = nodes
    linksRef.current = links

    sim.current?.stop()
    const s = forceSimulation(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).distance((l) => (l.edge.relation === 'on_site' ? 40 : 70)).strength(0.6))
      .force('charge', forceManyBody<SimNode>().strength((n) => -40 - n.degree * 6))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<SimNode>((n) => radius(n) + 4))
      .alphaDecay(0.035)
      .on('tick', () => draw.current())
    sim.current = s
    return () => {
      s.stop()
    }
  }, [graph])

  const radius = (n: SimNode): number => Math.min(22, 5 + Math.sqrt(n.degree) * 2.5 + (n.type === 'search' || n.type === 'site' ? 2 : 0))

  /**
   * Where a star is at this moment: the place the layout settled on, turned slowly about the centre and breathing a
   * little on its own. Only the drawing moves; the layout underneath is untouched, so nothing shifts meaning.
   */
  const place = (n: SimNode, t: number): { x: number; y: number } => {
    const x = n.x ?? 0
    const y = n.y ?? 0
    if (!t) return { x, y }
    const a = spinAt(t)
    const w = wanderOf(n.degree)
    return {
      x: x * Math.cos(a) - y * Math.sin(a) + Math.sin(t * 0.00037 + n.phase) * w,
      y: x * Math.sin(a) + y * Math.cos(a) + Math.cos(t * 0.00029 + n.phase * 1.3) * w
    }
  }

  /** The other way round: a point on screen, back to the settled place that would put a star there. For dragging. */
  const unplace = (at: { x: number; y: number }, n: SimNode, t: number): { x: number; y: number } => {
    if (!t) return at
    const a = spinAt(t)
    const w = wanderOf(n.degree)
    const x = at.x - Math.sin(t * 0.00037 + n.phase) * w
    const y = at.y - Math.cos(t * 0.00029 + n.phase * 1.3) * w
    return { x: x * Math.cos(a) + y * Math.sin(a), y: -x * Math.sin(a) + y * Math.cos(a) }
  }

  /** The sky behind the map: made once, then reused, so it is the same sky from frame to frame. */
  const sky = (): { stars: Star[]; nebulae: Nebula[] } => {
    if (!skyRef.current) {
      const stars: Star[] = []
      for (let i = 0; i < 240; i++) {
        stars.push({ x: Math.random(), y: Math.random(), size: 0.5 + Math.random() * 1.6, depth: 0.25 + Math.random() * 0.75, phase: Math.random() * Math.PI * 2 })
      }
      const nebulae: Nebula[] = [
        { x: 0.28, y: 0.32, radius: 0.45, color: '63, 216, 255', phase: 0 },
        { x: 0.72, y: 0.6, radius: 0.5, color: '181, 140, 255', phase: 1.9 },
        { x: 0.5, y: 0.85, radius: 0.4, color: '255, 190, 77', phase: 3.4 }
      ]
      skyRef.current = { stars, nebulae }
    }
    return skyRef.current
  }

  draw.current = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const { clientWidth: w, clientHeight: h } = canvas
    if (!w || !h) return
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio)
      canvas.height = Math.round(h * ratio)
    }
    const styles = getComputedStyle(document.documentElement)
    const text = styles.getPropertyValue('--text').trim() || '#ededef'
    const accent = styles.getPropertyValue('--cyan').trim() || '#3fd8ff'
    // Held still when the person has asked for less movement: the same map, simply not moving.
    const t = moving.current ? clock.current : 0
    const cam = camera.current
    const nodes = nodesRef.current
    const links = linksRef.current
    // A big map is drawn plainly: the flourishes are worth it up to a few hundred stars, not beyond.
    const rich = nodes.length <= 220
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // ---- the sky, in screen space, so it lies behind the map rather than being part of it
    const { stars, nebulae } = sky()
    const deep = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.8)
    deep.addColorStop(0, 'rgba(26, 33, 60, 0.55)')
    deep.addColorStop(1, 'rgba(5, 7, 14, 0.92)')
    ctx.fillStyle = deep
    ctx.fillRect(0, 0, w, h)
    for (const n of nebulae) {
      const cx = n.x * w + cam.x * 0.08 + Math.sin(t * 0.00005 + n.phase) * 40
      const cy = n.y * h + cam.y * 0.08 + Math.cos(t * 0.00004 + n.phase) * 30
      const r = n.radius * Math.max(w, h)
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      g.addColorStop(0, `rgba(${n.color}, ${0.07 + 0.02 * Math.sin(t * 0.00012 + n.phase)})`)
      g.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    ctx.fillStyle = '#ffffff'
    for (const s of stars) {
      // Nearer specks move further as the map is dragged, and the whole sky drifts on slowly for ever.
      const x = (((s.x * w + cam.x * s.depth * 0.25 + t * 0.004 * s.depth) % w) + w) % w
      const y = (((s.y * h + cam.y * s.depth * 0.25) % h) + h) % h
      ctx.globalAlpha = (0.2 + 0.5 * Math.abs(Math.sin(t * 0.0009 * s.depth + s.phase))) * s.depth
      ctx.fillRect(x, y, s.size, s.size)
    }
    ctx.globalAlpha = 1

    // ---- the rare streak across it
    if (t) {
      const meteors = meteorsRef.current
      if (meteors.length < 2 && Math.random() < 0.004) {
        const fromLeft = Math.random() < 0.5
        meteors.push({ x: fromLeft ? -40 : w + 40, y: Math.random() * h * 0.7, vx: (fromLeft ? 1 : -1) * (0.35 + Math.random() * 0.25), vy: 0.12 + Math.random() * 0.1, life: 1 })
      }
      const step = Math.min(64, t - (last.current || t))
      for (const m of meteors) {
        m.x += m.vx * step
        m.y += m.vy * step
        m.life -= step / 2600
      }
      meteorsRef.current = meteors.filter((m) => m.life > 0 && m.x > -80 && m.x < w + 80 && m.y < h + 80)
      for (const m of meteorsRef.current) {
        const tail = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 90, m.y - m.vy * 90)
        tail.addColorStop(0, `rgba(255, 255, 255, ${0.5 * m.life})`)
        tail.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.strokeStyle = tail
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(m.x, m.y)
        ctx.lineTo(m.x - m.vx * 90, m.y - m.vy * 90)
        ctx.stroke()
      }
    }
    last.current = t

    // ---- the map itself
    ctx.save()
    ctx.translate(w / 2 + cam.x, h / 2 + cam.y)
    ctx.scale(cam.k, cam.k)

    for (const n of nodes) {
      const at = place(n, t)
      n.px = at.x
      n.py = at.y
    }

    const chosen = new Set(selected)
    const near = new Set<string>()
    for (const l of links) {
      const a = (l.source as SimNode).id
      const b = (l.target as SimNode).id
      if (chosen.has(a) || hover.current === a) near.add(b)
      if (chosen.has(b) || hover.current === b) near.add(a)
    }
    const focused = chosen.size > 0 || Boolean(hover.current)

    // Constellation lines: each takes the colour of the two things it joins, so a line says what it joins at a glance.
    ctx.lineCap = 'round'
    for (const l of links) {
      const a = l.source as SimNode
      const b = l.target as SimNode
      if (a.px === undefined || b.px === undefined) continue
      const lit = chosen.has(a.id) || chosen.has(b.id) || hover.current === a.id || hover.current === b.id
      ctx.globalAlpha = focused && !lit ? 0.07 : lit ? 0.95 : 0.3
      if (rich || lit) {
        const g = ctx.createLinearGradient(a.px, a.py!, b.px, b.py!)
        g.addColorStop(0, COLORS[a.type])
        g.addColorStop(1, COLORS[b.type])
        ctx.strokeStyle = g
      } else ctx.strokeStyle = 'rgba(160, 175, 210, 0.7)'
      ctx.lineWidth = (lit ? 1.5 : 0.7) / cam.k
      // A line somebody drew themselves is dashed, and the dashes crawl along it, so it is never taken for a fact.
      ctx.setLineDash(l.edge.origin === 'user' ? [5 / cam.k, 5 / cam.k] : [])
      ctx.lineDashOffset = l.edge.origin === 'user' ? -(t * 0.01) / cam.k : 0
      ctx.shadowBlur = lit ? 8 / cam.k : 0
      ctx.shadowColor = lit ? accent : 'transparent'
      ctx.beginPath()
      ctx.moveTo(a.px, a.py!)
      ctx.lineTo(b.px, b.py!)
      ctx.stroke()
      // A spark travelling the line, on the ones being looked at, so a connection reads as something live.
      if (lit && t) {
        const along = (Math.sin(t * 0.0009 + phaseOf(l.edge.id)) + 1) / 2
        ctx.globalAlpha = 0.9
        ctx.fillStyle = l.edge.origin === 'user' ? accent : COLORS[b.type]
        ctx.beginPath()
        ctx.arc(a.px + (b.px - a.px) * along, a.py! + (b.py! - a.py!) * along, 1.8 / cam.k, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.setLineDash([])
    ctx.lineDashOffset = 0
    ctx.shadowBlur = 0

    for (const n of nodes) {
      if (n.px === undefined) continue
      const r = radius(n)
      const lit = chosen.has(n.id) || hover.current === n.id || near.has(n.id)
      const twinkle = t ? 0.78 + 0.22 * Math.sin(t * 0.0016 + n.phase) : 1
      const dim = focused && !lit ? 0.22 : 1
      const color = COLORS[n.type]

      // The glow around it, which is most of what makes it a star rather than a dot.
      ctx.globalAlpha = dim * twinkle * (lit ? 0.85 : 0.55)
      const halo = ctx.createRadialGradient(n.px, n.py!, r * 0.3, n.px, n.py!, r * (lit ? 3.6 : 2.6))
      halo.addColorStop(0, color)
      halo.addColorStop(0.45, `${color}55`)
      halo.addColorStop(1, `${color}00`)
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(n.px, n.py!, r * (lit ? 3.6 : 2.6), 0, Math.PI * 2)
      ctx.fill()

      // Its four points, on the ones with enough connections to carry them.
      if (rich && (n.degree >= 4 || lit)) {
        const reach = r * (lit ? 3.4 : 2.4) * twinkle
        ctx.globalAlpha = dim * 0.5 * twinkle
        ctx.strokeStyle = color
        ctx.lineWidth = 0.9 / cam.k
        ctx.beginPath()
        ctx.moveTo(n.px - reach, n.py!)
        ctx.lineTo(n.px + reach, n.py!)
        ctx.moveTo(n.px, n.py! - reach)
        ctx.lineTo(n.px, n.py! + reach)
        ctx.stroke()
      }

      // The body: its colour, with a white heart, the way a bright star actually looks.
      ctx.globalAlpha = dim
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(n.px, n.py!, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = dim * 0.85 * twinkle
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(n.px - r * 0.12, n.py! - r * 0.12, r * 0.42, 0, Math.PI * 2)
      ctx.fill()

      if (chosen.has(n.id) || linking === n.id) {
        // A ring that breathes, so what is selected is never in doubt.
        const pulse = t ? 4 + 2 * Math.sin(t * 0.004) : 4
        ctx.globalAlpha = 1
        ctx.strokeStyle = accent
        ctx.lineWidth = 2 / cam.k
        ctx.beginPath()
        ctx.arc(n.px, n.py!, r + pulse / cam.k, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Labels where they can be read: close up, on the busiest stars, and on whatever is being looked at.
      if (cam.k > 1.3 || n.degree >= 6 || lit) {
        ctx.globalAlpha = focused && !lit ? 0.3 : 1
        ctx.fillStyle = text
        ctx.font = `${12 / cam.k}px Inter Variable, Segoe UI, sans-serif`
        ctx.shadowBlur = 4 / cam.k
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)'
        const label = n.label.length > 42 ? `${n.label.slice(0, 40)}...` : n.label
        ctx.fillText(label, n.px + r + 5 / cam.k, n.py! + 4 / cam.k)
        ctx.shadowBlur = 0
      }
    }
    ctx.globalAlpha = 1
    ctx.restore()
  }

  useEffect(() => draw.current(), [selected, linking])

  /**
   * The sky keeps moving, because a galaxy that sits still is a diagram.
   *
   * It stops the moment nobody can see it, and it never starts at all where less movement has been asked for -- the
   * same setting that holds the rest of Orbis still.
   */
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const settle = (): void => {
      const still = document.documentElement.dataset.motion === 'reduced'
      moving.current = !still && !document.hidden
      cancelAnimationFrame(frame)
      if (moving.current) {
        const step = (ms: number): void => {
          clock.current = ms
          draw.current()
          frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
      } else {
        clock.current = 0
        draw.current()
      }
    }
    settle()
    const watch = new MutationObserver(settle)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] })
    query.addEventListener('change', settle)
    document.addEventListener('visibilitychange', settle)
    return () => {
      cancelAnimationFrame(frame)
      watch.disconnect()
      query.removeEventListener('change', settle)
      document.removeEventListener('visibilitychange', settle)
    }
  }, [])

  useEffect(() => {
    const resize = (): void => draw.current()
    window.addEventListener('resize', resize)
    // The layout is not worked on while nobody can see it.
    const visibility = (): void => {
      if (document.hidden) sim.current?.stop()
      else sim.current?.alpha(0.05).restart()
    }
    document.addEventListener('visibilitychange', visibility)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (linking) setLinking(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('keydown', onKey)
    }
  }, [linking, onClose])

  // ---------------------------------------------------------------- pointer

  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const cam = camera.current
    return { x: (e.clientX - rect.left - rect.width / 2 - cam.x) / cam.k, y: (e.clientY - rect.top - rect.height / 2 - cam.y) / cam.k }
  }
  const hit = (e: { clientX: number; clientY: number }): SimNode | null => {
    const p = toWorld(e)
    let best: SimNode | null = null
    let bestDistance = Infinity
    for (const n of nodesRef.current) {
      if (n.px === undefined) continue
      const d = Math.hypot(n.px - p.x, n.py! - p.y)
      if (d <= radius(n) + 6 / camera.current.k && d < bestDistance) {
        best = n
        bestDistance = d
      }
    }
    return best
  }

  const drag = useRef<{ node: SimNode | null; startX: number; startY: number; camX: number; camY: number; moved: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const node = hit(e)
    drag.current = { node, startX: e.clientX, startY: e.clientY, camX: camera.current.x, camY: camera.current.y, moved: false }
    if (node) {
      node.fx = node.x
      node.fy = node.y
    }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current
    if (!d) {
      const over = hit(e)?.id ?? null
      if (over !== hover.current) {
        hover.current = over
        e.currentTarget.style.cursor = over ? 'pointer' : 'grab'
        draw.current()
      }
      return
    }
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 3) d.moved = true
    if (d.node) {
      const p = unplace(toWorld(e), d.node, moving.current ? clock.current : 0)
      d.node.fx = p.x
      d.node.fy = p.y
      sim.current?.alpha(0.2).restart()
    } else {
      camera.current.x = d.camX + e.clientX - d.startX
      camera.current.y = d.camY + e.clientY - d.startY
      draw.current()
    }
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current
    drag.current = null
    if (d?.node) {
      d.node.fx = null
      d.node.fy = null
    }
    if (d?.moved) return
    const node = d?.node ?? null
    if (linking && node && node.id !== linking) {
      setLinkDraft({ from: linking, to: node.id, note: '' })
      setLinking(null)
      return
    }
    if (!node) return setSelected([])
    setSelected((now) => (e.shiftKey ? (now.includes(node.id) ? now.filter((id) => id !== node.id) : [...now, node.id]) : [node.id]))
  }
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const cam = camera.current
    const k = Math.max(0.2, Math.min(4, cam.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    const mx = e.clientX - rect.left - rect.width / 2
    const my = e.clientY - rect.top - rect.height / 2
    cam.x = mx - ((mx - cam.x) * k) / cam.k
    cam.y = my - ((my - cam.y) * k) / cam.k
    cam.k = k
    draw.current()
  }
  const fit = (): void => {
    const canvas = canvasRef.current
    const nodes = nodesRef.current.filter((n) => n.x !== undefined && Number.isFinite(n.x))
    if (!canvas || !nodes.length) return
    const xs = nodes.map((n) => n.px ?? n.x!)
    const ys = nodes.map((n) => n.py ?? n.y!)
    const width = Math.max(...xs) - Math.min(...xs) + 120
    const height = Math.max(...ys) - Math.min(...ys) + 120
    const k = Math.max(0.2, Math.min(2, Math.min(canvas.clientWidth / width, canvas.clientHeight / height)))
    camera.current = { k, x: -((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: -((Math.max(...ys) + Math.min(...ys)) / 2) * k }
    draw.current()
  }
  useEffect(() => {
    if (!graph) return undefined
    const t = setTimeout(fit, 900)
    return () => clearTimeout(t)
  }, [graph])

  // ---------------------------------------------------------------- actions, all through Orbis's own stores

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph])
  const selection = selected.map((id) => byId.get(id)).filter((n): n is GalaxyNode => Boolean(n))

  const open = (n: GalaxyNode): void => {
    if (n.type === 'search') return openInOrbisBrowser(`orbis://search?q=${encodeURIComponent(`continue my research on ${n.label}`)}&in=orion`)
    if (n.url) return openInOrbisBrowser(n.url)
    onNotify(`Open ${GALAXY_TYPE_LABELS[n.type].toLowerCase()}s from their own place in Orbis.`)
  }

  const askOrion = async (text: string): Promise<void> => {
    try {
      const message = await window.api.galaxyAsk(selected, text)
      setQuestion(null)
      onAsk(message)
    } catch (err) {
      onNotify(said(err), 'warn')
    }
  }

  /** Adds the selection to a project: an existing one, or a new one made here. The project refers to them; nothing is copied. */
  const addToProject = async (target: Workspace | 'new'): Promise<void> => {
    const refs = selected.filter((id) => !id.startsWith('workspace:'))
    if (!refs.length) return onNotify('Projects hold research, notes, tasks, memories, skills and pages, not other workspaces.', 'warn')
    try {
      let space: Workspace
      if (target === 'new') {
        const name = (projectName ?? '').trim()
        if (!name) return
        space = newWorkspace({ name, project: { goal: '', items: [] } })
      } else space = target
      for (const ref of refs) space = withProjectItem(space, ref)
      await window.api.saveWorkspace(space)
      setProjectName(null)
      onNotify(`Added ${refs.length} ${refs.length === 1 ? 'item' : 'items'} to the project “${space.name}”.`)
    } catch (err) {
      onNotify(said(err), 'warn')
    }
  }

  const saveLink = (): void => {
    if (!linkDraft) return
    const draft = linkDraft
    setLinkDraft(null)
    void window.api
      .galaxyLink(draft.from, draft.to, draft.note.trim() || undefined)
      .then(() => onNotify('Connected.'))
      .catch((err: unknown) => onNotify(said(err), 'warn'))
  }

  const makeNote = async (): Promise<void> => {
    const lines = selection.map((n) => `- ${GALAXY_TYPE_LABELS[n.type]}: ${n.label}${n.url ? ` (${n.url})` : ''}`)
    const first = selection[0]
    try {
      await window.api.createNote({
        title: selection.length === 1 ? first.label.slice(0, 120) : `Galaxy: ${selection.length} items`,
        body: `From Galaxy:\n\n${lines.join('\n')}`,
        ...(selection.length === 1 && first.url ? { source: { url: first.url, title: first.label, savedAt: Date.now() } } : {})
      })
      onNotify('Note created in Notes.')
    } catch (err) {
      onNotify(said(err), 'warn')
    }
  }

  const toWhiteboard = async (): Promise<void> => {
    try {
      const board = await window.api.createBoard({ name: `Galaxy — ${selection[0]?.label.slice(0, 40) ?? 'selection'}` })
      const elements = selection.map((n, i) => ({
        kind: 'note',
        at: { x: 60 + (i % 4) * 220, y: 60 + Math.floor(i / 4) * 180 },
        width: 200,
        height: 150,
        text: `${GALAXY_TYPE_LABELS[n.type]}\n${n.label}${n.detail ? `\n${n.detail}` : ''}${n.url ? `\n${n.url}` : ''}`
      }))
      await window.api.addToBoard(board.id, elements)
      onNotify(`Added ${elements.length} ${elements.length === 1 ? 'item' : 'items'} to the whiteboard “${board.name}”.`)
    } catch (err) {
      onNotify(said(err), 'warn')
    }
  }

  // ---------------------------------------------------------------- the page

  const shown = graph?.nodes.length ?? 0
  const total = Object.values(graph?.totals ?? {}).reduce((a, b) => a + (b ?? 0), 0)

  return (
    <section className="images-view galaxy-view galaxy-page" aria-label="Galaxy">
      <header className="images-head galaxy-head">
        <div>
          <h2>Galaxy</h2>
          <span className="hud-label">
            {loading ? 'Loading…' : total ? `${shown === total ? shown : `${shown} of ${total}`} things you keep in Orbis, and how they are connected` : 'Nothing here yet'}
          </span>
        </div>
        <button type="button" className="sb-icon" aria-label="Close Galaxy" title="Close (Esc)" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="galaxy-toolbar">
        <button type="button" className="galaxy-btn" onClick={back} disabled={!history.length} aria-label="Back" title="Back">
          <ArrowLeft size={14} />
        </button>
        <form
          className="galaxy-search"
          onSubmit={(e) => {
            e.preventDefault()
            go(query.trim() ? { query: query.trim() } : {})
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Show everything related to…" aria-label="Search Galaxy" />
        </form>
        <select value={range ?? ''} onChange={(e) => setRange(e.target.value ? Number(e.target.value) : null)} aria-label="When" className="galaxy-select">
          {RANGES.map(([label, days]) => (
            <option key={label} value={days ?? ''}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="galaxy-btn" onClick={fit} title="Fit everything in view">
          <Maximize2 size={14} /> Fit
        </button>
        <button
          type="button"
          className="galaxy-btn"
          onClick={() => {
            setQuery('')
            setTypes([])
            setRange(null)
            go({})
          }}
          title="Show everything again"
        >
          Reset
        </button>
      </div>
      <div className="galaxy-types" role="group" aria-label="Show only">
        {GALAXY_TYPES.filter((t) => graph?.totals[t]).map((t) => (
          <button
            key={t}
            type="button"
            className={`galaxy-chip${types.includes(t) ? ' on' : ''}`}
            aria-pressed={types.includes(t)}
            onClick={() => setTypes((now) => (now.includes(t) ? now.filter((x) => x !== t) : [...now, t]))}
          >
            <span className="galaxy-dot" style={{ background: COLORS[t] }} />
            {GALAXY_TYPE_LABELS[t]} {graph?.totals[t]}
          </button>
        ))}
      </div>

      <div className="galaxy-body">
        {!loading && total === 0 ? (
          <div className="images-empty">
            <Orbit size={30} />
            <p>Galaxy fills as you keep things in Orbis.</p>
            <small>Research in Orion Search, notes and tasks saved from pages, memories, skills, workspaces and bookmarks all appear here, with how they are connected.</small>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="galaxy-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            aria-label="Galaxy map. Click a dot to see what it is and why it is connected; shift-click to select several."
          />
        )}
        {linking && <div className="galaxy-linking">Click what to connect “{byId.get(linking)?.label}” to. Esc to cancel.</div>}
        {linkDraft && (
          <form
            className="galaxy-linking galaxy-form"
            onSubmit={(e) => {
              e.preventDefault()
              saveLink()
            }}
          >
            <span>
              Connect “{byId.get(linkDraft.from)?.label}” to “{byId.get(linkDraft.to)?.label}”
            </span>
            <input autoFocus value={linkDraft.note} maxLength={200} placeholder="Why? (optional)" onChange={(e) => setLinkDraft({ ...linkDraft, note: e.target.value })} aria-label="Why these are connected" />
            <button type="submit" className="galaxy-btn">
              Connect
            </button>
            <button type="button" className="galaxy-btn" onClick={() => setLinkDraft(null)}>
              Cancel
            </button>
          </form>
        )}

        {selection.length > 0 && (
          <aside className="galaxy-details" aria-label="Selected">
            {selection.length === 1 && details ? (
              <>
                <p className="galaxy-kind">
                  <span className="galaxy-dot" style={{ background: COLORS[details.node.type] }} />
                  {GALAXY_TYPE_LABELS[details.node.type]}
                </p>
                <h3>{details.node.label}</h3>
                {details.node.detail && <p className="skill-meta">{details.node.detail}</p>}
                {details.node.createdAt ? <p className="skill-meta">Added {new Date(details.node.createdAt).toLocaleDateString()}</p> : null}
                <p className="skill-meta">
                  {Object.entries(details.counts)
                    .map(([t, n]) => `${n} ${GALAXY_TYPE_LABELS[t as GalaxyNodeType].toLowerCase()}${n === 1 ? '' : 's'}`)
                    .join(' · ') || 'Not connected to anything yet'}
                </p>
                <ul className="galaxy-links">
                  {details.links.slice(0, 30).map(({ other, edge }) => (
                    <li key={edge.id}>
                      <button type="button" onClick={() => setSelected([other.id])}>
                        <span className="galaxy-dot" style={{ background: COLORS[other.type] }} />
                        <span className="truncate">
                          {edge.from === details.node.id ? GALAXY_RELATION_LABELS[edge.relation] : `← ${GALAXY_RELATION_LABELS[edge.relation]}`} {other.label}
                        </span>
                      </button>
                      <small title={edge.why}>{edge.why}</small>
                      {edge.origin === 'user' && (
                        <button
                          type="button"
                          className="galaxy-unlink"
                          aria-label="Remove this connection"
                          onClick={() => {
                            const id = graphLinkId(edge)
                            if (id) void window.api.galaxyUnlink(id).then(() => onNotify('Connection removed.'))
                          }}
                        >
                          <Unlink size={12} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h3>{selection.length} selected</h3>
                <ul className="galaxy-links">
                  {selection.map((n) => (
                    <li key={n.id}>
                      <span className="galaxy-dot" style={{ background: COLORS[n.type] }} /> <span className="truncate">{n.label}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="skill-actions">
              {selection.length === 1 && (
                <>
                  <button type="button" onClick={() => open(selection[0])}>
                    Open
                  </button>
                  <button type="button" onClick={() => go({ focus: selection[0].id, depth: 2 })}>
                    <Crosshair size={12} /> Focus
                  </button>
                  <button type="button" onClick={() => setLinking(selection[0].id)}>
                    <Link2 size={12} /> Connect to…
                  </button>
                </>
              )}
              <button type="button" className="primary" onClick={() => setQuestion(selection.length > 1 ? 'What connects these, and what is missing?' : 'Explain this and what it is connected to.')}>
                <Sparkles size={12} /> Ask Orion
              </button>
              <button type="button" onClick={() => void makeNote()}>
                <NotebookPen size={12} /> Make a note
              </button>
              <button type="button" onClick={() => void toWhiteboard()}>
                <PenLine size={12} /> To whiteboard
              </button>
            </div>
            <div className="galaxy-project">
              {projectName === null ? (
                <select
                  value=""
                  aria-label="Add to a project"
                  onChange={(e) => {
                    const value = e.target.value
                    if (value === '__new') setProjectName('')
                    else {
                      const target = projects.find((p) => p.id === value)
                      if (target) void addToProject(target)
                    }
                  }}
                >
                  <option value="">Add to a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="__new">New project…</option>
                </select>
              ) : (
                <form
                  className="galaxy-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void addToProject('new')
                  }}
                >
                  <input autoFocus value={projectName} maxLength={60} placeholder="Project name" onChange={(e) => setProjectName(e.target.value)} aria-label="New project name" />
                  <button type="submit" className="galaxy-btn" disabled={!projectName.trim()}>
                    Create
                  </button>
                  <button type="button" className="galaxy-btn" onClick={() => setProjectName(null)}>
                    Cancel
                  </button>
                </form>
              )}
            </div>
            {question !== null && (
              <form
                className="galaxy-ask"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (question.trim()) void askOrion(question)
                }}
              >
                <textarea autoFocus rows={2} value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} aria-label="Question for Orion about the selection" />
                <p className="skill-meta">Orion is given only what is selected here.</p>
                <div className="skill-actions">
                  <button type="submit" className="primary" disabled={!question.trim()}>
                    Ask
                  </button>
                  <button type="button" onClick={() => setQuestion(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </aside>
        )}
      </div>
    </section>
  )
}

/** Only a link the person made can be removed from Galaxy; links that come from the data belong to their stores. */
function graphLinkId(edge: GalaxyEdge): string | null {
  return edge.origin === 'user' && edge.linkId ? edge.linkId : null
}
