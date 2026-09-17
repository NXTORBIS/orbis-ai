import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { ArrowLeft, Crosshair, Link2, Maximize2, NotebookPen, Orbit, PenLine, Sparkles, Unlink, X } from 'lucide-react'
import { GALAXY_RELATION_LABELS, GALAXY_TYPE_LABELS, GALAXY_TYPES } from '../../../shared/galaxy'
import type { GalaxyEdge, GalaxyGraph, GalaxyNode, GalaxyNodeType, GalaxyView as View } from '../../../shared/galaxy'
import type { GalaxyDescription } from '../../../shared/types'
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

type SimNode = GalaxyNode & SimulationNodeDatum & { degree: number }
type SimLink = SimulationLinkDatum<SimNode> & { edge: GalaxyEdge }

const COLORS: Record<GalaxyNodeType, string> = {
  search: '#3fd8ff',
  page: '#a2a6ae',
  site: '#6e727b',
  note: '#ffbe4d',
  task: '#3ee58a',
  memory: '#b58cff',
  skill: '#ff8197',
  workflow: '#7aa2ff',
  workspace: '#cbced4',
  whiteboard: '#e0a458',
  bookmark: '#8fe3ff'
}

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
  const [loading, setLoading] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sim = useRef<Simulation<SimNode, SimLink> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const camera = useRef({ x: 0, y: 0, k: 1 })
  const hover = useRef<string | null>(null)
  const draw = useRef<() => void>(() => undefined)

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
      return { ...n, degree: degree.get(n.id) ?? 0, x: was?.x, y: was?.y, vx: was?.vx, vy: was?.vy }
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

  draw.current = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ratio = window.devicePixelRatio || 1
    const { clientWidth: w, clientHeight: h } = canvas
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio)
      canvas.height = Math.round(h * ratio)
    }
    const styles = getComputedStyle(document.documentElement)
    const text = styles.getPropertyValue('--text').trim() || '#ededef'
    const faint = styles.getPropertyValue('--faint').trim() || '#6e727b'
    const accent = styles.getPropertyValue('--cyan').trim() || '#3fd8ff'
    const cam = camera.current
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.translate(w / 2 + cam.x, h / 2 + cam.y)
    ctx.scale(cam.k, cam.k)

    const chosen = new Set(selected)
    const near = new Set<string>()
    for (const l of linksRef.current) {
      const a = (l.source as SimNode).id
      const b = (l.target as SimNode).id
      if (chosen.has(a) || hover.current === a) near.add(b)
      if (chosen.has(b) || hover.current === b) near.add(a)
    }
    const focused = chosen.size > 0 || Boolean(hover.current)

    for (const l of linksRef.current) {
      const a = l.source as SimNode
      const b = l.target as SimNode
      if (a.x === undefined || b.x === undefined) continue
      const lit = chosen.has(a.id) || chosen.has(b.id) || hover.current === a.id || hover.current === b.id
      ctx.globalAlpha = focused && !lit ? 0.12 : lit ? 0.9 : 0.35
      ctx.strokeStyle = l.edge.origin === 'user' ? accent : faint
      ctx.lineWidth = (lit ? 1.6 : 1) / cam.k
      ctx.setLineDash(l.edge.origin === 'user' ? [5 / cam.k, 4 / cam.k] : [])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y!)
      ctx.lineTo(b.x, b.y!)
      ctx.stroke()
    }
    ctx.setLineDash([])

    for (const n of nodesRef.current) {
      if (n.x === undefined) continue
      const r = radius(n)
      const lit = chosen.has(n.id) || hover.current === n.id || near.has(n.id)
      ctx.globalAlpha = focused && !lit ? 0.25 : 1
      ctx.fillStyle = COLORS[n.type]
      ctx.beginPath()
      ctx.arc(n.x, n.y!, r, 0, Math.PI * 2)
      ctx.fill()
      if (chosen.has(n.id) || linking === n.id) {
        ctx.strokeStyle = accent
        ctx.lineWidth = 2.5 / cam.k
        ctx.beginPath()
        ctx.arc(n.x, n.y!, r + 4 / cam.k, 0, Math.PI * 2)
        ctx.stroke()
      }
      // Labels where they can be read: close up, on the busiest dots, and on whatever is being looked at.
      if (cam.k > 1.3 || n.degree >= 6 || lit) {
        ctx.globalAlpha = focused && !lit ? 0.3 : 1
        ctx.fillStyle = text
        ctx.font = `${12 / cam.k}px Inter Variable, Segoe UI, sans-serif`
        const label = n.label.length > 42 ? `${n.label.slice(0, 40)}…` : n.label
        ctx.fillText(label, n.x + r + 4 / cam.k, n.y! + 4 / cam.k)
      }
    }
    ctx.globalAlpha = 1
  }

  useEffect(() => draw.current(), [selected, linking])

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
      if (n.x === undefined) continue
      const d = Math.hypot(n.x - p.x, n.y! - p.y)
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
      const p = toWorld(e)
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
    const nodes = nodesRef.current.filter((n) => n.x !== undefined)
    if (!canvas || !nodes.length) return
    const xs = nodes.map((n) => n.x!)
    const ys = nodes.map((n) => n.y!)
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
    <section className="images-view galaxy-view" aria-label="Galaxy">
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
