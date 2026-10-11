import { call } from './helper.js'

// Galaxy, in the Orbis panel: the same map Electron Orbis draws, from the same source. Every dot is something that exists in an
// Orbis store (research, a page it used, a note, a task, a memory, a skill, a workflow…) and every line is either written in the
// data or drawn by the person; selecting a dot says why each of its lines is there. Links can be made and removed here, and a selection
// can be taken to Orion Search. The layout is a small force simulation of its own (no library).

const root = document.getElementById('galaxy')
const view = document.getElementById('view-galaxy')

// Kept identical to src/shared/galaxy.ts.
const TYPES = ['project', 'search', 'page', 'site', 'note', 'task', 'memory', 'skill', 'workflow', 'workspace', 'whiteboard', 'bookmark']
const LABELS = { project: 'Project', memory: 'Memory', search: 'Research', page: 'Page', site: 'Site', note: 'Note', task: 'Task', skill: 'Skill', workflow: 'Workflow', workspace: 'Workspace', whiteboard: 'Whiteboard', bookmark: 'Bookmark' }
const COLORS = { project: '#ffd24d', search: '#3fd8ff', page: '#a2a6ae', site: '#6e727b', note: '#ffbe4d', task: '#3ee58a', memory: '#b58cff', skill: '#ff8197', workflow: '#7aa2ff', workspace: '#cbced4', whiteboard: '#e0a458', bookmark: '#8fe3ff' }
const RELATIONS = { used_source: 'used as a source', saved_from: 'saved from', links_to: 'links to', on_site: 'is on', made_on: 'was made on', calls: 'runs', contains: 'contains', bookmarked: 'is a bookmark of', part_of: 'is part of', connected: 'connected by you to' }
const RANGES = [['Any time', 0], ['Past week', 7], ['Past month', 30], ['Past year', 365]]

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v)
  }
  node.append(...children.filter((c) => c !== null && c !== undefined))
  return node
}

let graph = null
let types = []
let query = ''
let range = 0
let problem = ''
let loading = false
let selected = null
let details = null
let nodes = []
let links = []
let alpha = 0
let frame = 0
let hover = null
let canvas = null
let detailBox = null
const cam = { x: 0, y: 0, k: 1 }
let stars = null

const radius = (n) => Math.min(18, 4 + Math.sqrt(n.degree) * 2.2 + (n.type === 'search' || n.type === 'site' ? 2 : 0))

async function load() {
  loading = true
  problem = ''
  drawShell()
  const v = { limit: 400, ...(types.length ? { types } : {}), ...(query.trim() ? { query: query.trim() } : {}), ...(range ? { from: Date.now() - range * 86_400_000 } : {}) }
  try {
    graph = await call('galaxy:view', [v])
  } catch (err) {
    problem = err?.message || 'Galaxy could not be loaded.'
  }
  loading = false
  drawShell()
  if (graph) layout()
}

function layout() {
  const old = new Map(nodes.map((n) => [n.id, n]))
  const degree = new Map()
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  const count = graph.nodes.length
  nodes = graph.nodes.map((n, i) => {
    const was = old.get(n.id)
    const angle = i * 2.399963
    const r = 12 * Math.sqrt(i + 1)
    return { ...n, degree: degree.get(n.id) ?? 0, x: was?.x ?? Math.cos(angle) * r, y: was?.y ?? Math.sin(angle) * r, vx: 0, vy: 0, phase: (i * 0.7) % (Math.PI * 2) }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  links = graph.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((edge) => ({ a: byId.get(edge.from), b: byId.get(edge.to), edge }))
  alpha = count ? 1 : 0
  if (selected && !byId.has(selected)) selected = null
  fit()
  kick()
}

// One step of a force layout: every star pushes the others away, every line pulls its two ends together, and everything is drawn to the middle.
function tick() {
  const n = nodes.length
  for (let i = 0; i < n; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d2 = dx * dx + dy * dy
      if (d2 > 90000) continue
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1 }
      const d = Math.sqrt(d2)
      const push = ((40 + (a.degree + b.degree) * 3) / d2) * alpha * 40
      a.vx -= dx * push; a.vy -= dy * push
      b.vx += dx * push; b.vy += dy * push
      const min = radius(a) + radius(b) + 4
      if (d < min) {
        const shove = ((min - d) / d) * 0.5
        a.vx -= dx * shove; a.vy -= dy * shove
        b.vx += dx * shove; b.vy += dy * shove
      }
    }
  }
  for (const l of links) {
    const dx = l.b.x - l.a.x
    const dy = l.b.y - l.a.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const want = l.edge.relation === 'on_site' ? 40 : 70
    const pull = ((d - want) / d) * 0.06 * alpha * 4
    l.a.vx += dx * pull; l.a.vy += dy * pull
    l.b.vx -= dx * pull; l.b.vy -= dy * pull
  }
  for (const s of nodes) {
    s.vx -= s.x * 0.012 * alpha
    s.vy -= s.y * 0.012 * alpha
    s.vx *= 0.6; s.vy *= 0.6
    if (!s.fixed) { s.x += s.vx; s.y += s.vy }
  }
  alpha *= 0.985
}

function kick() {
  cancelAnimationFrame(frame)
  const step = () => {
    if (view.hidden || !canvas?.isConnected) return
    // A big map is settled in bigger steps so it is not slow to appear.
    for (let i = 0; i < (nodes.length > 200 ? 3 : 1) && alpha > 0.02; i++) tick()
    if (alpha > 0.02 && !fitted) fit()
    paint()
    if (alpha > 0.02) frame = requestAnimationFrame(step)
  }
  fitted = false
  // Settled at once for the first look (so the map is there even before the browser paints a frame), then eased on.
  for (let i = 0; i < 150 && alpha > 0.02; i++) tick()
  fit()
  paint()
  if (alpha > 0.02) frame = requestAnimationFrame(step)
}
let fitted = false

function fit() {
  if (!nodes.length || !canvas) return
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y) }
  const w = Math.max(60, x1 - x0 + 80)
  const h = Math.max(60, y1 - y0 + 80)
  cam.k = Math.max(0.15, Math.min(3, Math.min(canvas.clientWidth / w, canvas.clientHeight / h)))
  cam.x = -((x0 + x1) / 2) * cam.k
  cam.y = -((y0 + y1) / 2) * cam.k
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const nebulae = [[0.25, 0.3, 0.55, '110, 90, 255'], [0.75, 0.7, 0.5, '63, 216, 255'], [0.6, 0.2, 0.35, '255, 129, 151']]
let meteors = []
let meteorTimer = 0

/** Soft nebula glows, and (unless the person asks for less motion) an occasional meteor across the sky. */
function drawSky(ctx, w, h) {
  for (const [x, y, r, rgb] of nebulae) {
    const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * Math.max(w, h))
    g.addColorStop(0, `rgba(${rgb}, 0.16)`)
    g.addColorStop(1, `rgba(${rgb}, 0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  if (reduceMotion.matches) return
  const now = performance.now()
  for (const m of meteors) {
    const t = (now - m.born) / m.life
    if (t >= 1) continue
    const x = m.x + m.dx * t, y = m.y + m.dy * t
    const g = ctx.createLinearGradient(x, y, x - m.dx * 0.12, y - m.dy * 0.12)
    g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - t)})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.strokeStyle = g
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x - m.dx * 0.12, y - m.dy * 0.12)
    ctx.stroke()
  }
  meteors = meteors.filter((m) => now - m.born < m.life)
}

function startMeteors() {
  clearInterval(meteorTimer)
  meteorTimer = setInterval(() => {
    if (reduceMotion.matches || document.hidden || !canvas || !canvas.isConnected) return
    const w = canvas.clientWidth, h = canvas.clientHeight
    meteors.push({ x: Math.random() * w * 0.7, y: Math.random() * h * 0.4, dx: w * 0.5, dy: h * 0.35, born: performance.now(), life: 900 })
    const tick = () => { paint(); if (meteors.length && !reduceMotion.matches) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  }, 4000)
}

function paint() {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio) }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  const deep = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.8)
  deep.addColorStop(0, 'rgba(26, 33, 60, 0.9)')
  deep.addColorStop(1, 'rgba(5, 7, 14, 1)')
  ctx.fillStyle = deep
  ctx.fillRect(0, 0, w, h)
  if (!stars) stars = Array.from({ length: 120 }, () => ({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 1.4, a: 0.15 + Math.random() * 0.5 }))
  ctx.fillStyle = '#fff'
  for (const s of stars) { ctx.globalAlpha = s.a; ctx.fillRect(s.x * w, s.y * h, s.s, s.s) }
  ctx.globalAlpha = 1
  drawSky(ctx, w, h)

  ctx.save()
  ctx.translate(w / 2 + cam.x, h / 2 + cam.y)
  ctx.scale(cam.k, cam.k)
  const chosen = selected
  const near = new Set()
  for (const l of links) {
    if (l.a.id === chosen || l.a.id === hover) near.add(l.b.id)
    if (l.b.id === chosen || l.b.id === hover) near.add(l.a.id)
  }
  const focused = Boolean(chosen || hover)
  ctx.lineCap = 'round'
  for (const l of links) {
    const lit = l.a.id === chosen || l.b.id === chosen || l.a.id === hover || l.b.id === hover
    ctx.globalAlpha = focused && !lit ? 0.07 : lit ? 0.95 : 0.3
    ctx.strokeStyle = lit ? COLORS[l.a.type] : 'rgba(160, 175, 210, 0.7)'
    ctx.lineWidth = (lit ? 1.5 : 0.7) / cam.k
    // A line somebody drew themselves is dashed, so it is never taken for a fact.
    ctx.setLineDash(l.edge.origin === 'user' ? [5 / cam.k, 5 / cam.k] : [])
    ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke()
  }
  ctx.setLineDash([])
  for (const n of nodes) {
    const r = radius(n)
    const lit = n.id === chosen || n.id === hover || near.has(n.id)
    const dim = focused && !lit ? 0.22 : 1
    const color = COLORS[n.type] || '#a2a6ae'
    const glow = r * (lit ? 3.4 : 2.4)
    ctx.globalAlpha = dim * (lit ? 0.85 : 0.5)
    const halo = ctx.createRadialGradient(n.x, n.y, r * 0.3, n.x, n.y, glow)
    halo.addColorStop(0, color); halo.addColorStop(0.45, `${color}55`); halo.addColorStop(1, `${color}00`)
    ctx.fillStyle = halo
    ctx.beginPath(); ctx.arc(n.x, n.y, glow, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = dim
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = dim * 0.85
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.38, 0, Math.PI * 2); ctx.fill()
    if (n.id === chosen || extra.has(n.id)) {
      ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / cam.k
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2); ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
  // Names only on what is being looked at (and on the busiest stars), so the map stays readable.
  ctx.font = `${12 / cam.k}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  for (const n of nodes) {
    if (!(n.id === chosen || n.id === hover || (near.has(n.id) && nodes.length < 40 && cam.k > 1.6) || (!focused && n.degree >= 6 && cam.k > 0.5))) continue
    const text = n.label.length > 32 ? `${n.label.slice(0, 31)}…` : n.label
    ctx.fillStyle = 'rgba(5, 7, 14, 0.7)'
    ctx.fillText(text, n.x + 0.6 / cam.k, n.y + radius(n) + 14 / cam.k + 0.6 / cam.k)
    ctx.fillStyle = '#e8ecf4'
    ctx.fillText(text, n.x, n.y + radius(n) + 14 / cam.k)
  }
  ctx.restore()
}

const toWorld = (e) => {
  const rect = canvas.getBoundingClientRect()
  return { x: (e.clientX - rect.left - rect.width / 2 - cam.x) / cam.k, y: (e.clientY - rect.top - rect.height / 2 - cam.y) / cam.k }
}
function hit(e) {
  const p = toWorld(e)
  let best = null
  let bestD = Infinity
  for (const n of nodes) {
    const d = Math.hypot(n.x - p.x, n.y - p.y)
    if (d <= radius(n) + 5 / cam.k && d < bestD) { best = n; bestD = d }
  }
  return best
}

function wireCanvas() {
  let drag = null
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    drag = { node: hit(e), sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false }
  })
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.sx
      const dy = e.clientY - drag.sy
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
      if (drag.node && drag.moved) {
        const p = toWorld(e)
        drag.node.x = p.x; drag.node.y = p.y; drag.node.fixed = true
        alpha = Math.max(alpha, 0.05)
        if (!frame || alpha > 0.02) kick()
      } else if (!drag.node) { cam.x = drag.cx + dx; cam.y = drag.cy + dy }
      paint()
      return
    }
    const over = hit(e)
    if ((over?.id ?? null) !== hover) { hover = over?.id ?? null; canvas.style.cursor = over ? 'pointer' : 'grab'; paint() }
  })
  canvas.addEventListener('pointerup', async (e) => {
    const d = drag
    drag = null
    if (d?.node) d.node.fixed = false
    if (d && !d.moved) {
      const n = hit(e)
      if (e.shiftKey && n && selected && n.id !== selected) extra.has(n.id) ? extra.delete(n.id) : extra.add(n.id)
      else { selected = n?.id ?? null; extra.clear() }
      paint()
      await describe()
    }
  })
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const before = toWorld(e)
    cam.k = Math.max(0.1, Math.min(4, cam.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
    const rect = canvas.getBoundingClientRect()
    cam.x = e.clientX - rect.left - rect.width / 2 - before.x * cam.k
    cam.y = e.clientY - rect.top - rect.height / 2 - before.y * cam.k
    paint()
  }, { passive: false })
  canvas.addEventListener('dblclick', () => { fit(); paint() })
}

async function describe() {
  details = null
  drawDetails()
  if (!selected) return
  const id = selected
  try {
    const d = await call('galaxy:describe', [id])
    if (id === selected) details = d
  } catch {
    details = null
  }
  drawDetails()
}

function drawDetails() {
  if (!detailBox) return
  detailBox.replaceChildren()
  if (!selected) return void detailBox.append(el('p', { class: 'muted' }, 'Select a star to see what it is and why each line is there. Scroll to zoom, drag to move, double-click to fit.'))
  const n = nodes.find((x) => x.id === selected)
  if (!n) return
  detailBox.append(el('strong', {}, n.label), el('span', { class: 'muted' }, [LABELS[n.type] || n.type, n.detail].filter(Boolean).join(' · ')))
  if (n.url && /^https?:\/\//i.test(n.url)) detailBox.append(el('a', { href: n.url, target: '_blank', rel: 'noopener noreferrer', class: 'muted' }, n.url))
  detailBox.append(actions(n))
  if (!details) return
  if (!details.links.length) detailBox.append(el('span', { class: 'muted' }, 'Nothing is connected to this yet.'))
  for (const l of details.links.slice(0, 30)) {
    const outgoing = l.edge.from === n.id
    const rel = RELATIONS[l.edge.relation] || l.edge.relation
    detailBox.append(el('button', { type: 'button', class: 'link', title: l.edge.why, onclick: () => { if (nodes.some((x) => x.id === l.other.id)) { selected = l.other.id; paint(); void describe() } } },
      el('span', { class: 'dot', style: `background:${COLORS[l.other.type] || '#a2a6ae'}` }), `${outgoing ? rel : `${rel} (from)`}: ${l.other.label}${l.edge.origin === 'user' ? ' · yours' : ''}`))
 
    if (l.edge.origin === 'user' && l.edge.linkId) detailBox.append(el('button', { type: 'button', class: 'unlink', 'aria-label': `Remove the connection to ${l.other.label}`, onclick: () => void unlink(l.edge.linkId) }, 'Remove connection'))
  }
}

let note = ''
/** Stars added to the selection with shift-click, kept together with the selected one. */
const extra = new Set()
let projects = null
let noteBox = null
const say = (text) => { note = text; if (noteBox) noteBox.textContent = text }

async function unlink(id) {
  try {
    await call('galaxy:unlink', [id])
    say('Connection removed.')
    await load()
  } catch (err) { say(err?.message || 'Could not remove that.') }
}

/** Keep the selection (shift-click adds more): as a note, on a whiteboard, or in a project. Only ids are sent; the helper builds what is saved. */
function keepRow(n) {
  const ids = () => [n.id, ...[...extra].filter((x) => nodes.some((y) => y.id === x))]
  const count = ids().length
  const keep = (channel, args, done) => async () => {
    try { say(done(await call(channel, args()))) } catch (err) { say(err?.message || 'That could not be saved.') }
  }
  const project = el('select', { 'aria-label': 'Project' }, el('option', { value: '' }, 'Project…'), el('option', { value: '__new' }, 'New project…'))
  const name = el('input', { type: 'text', 'aria-label': 'New project name', placeholder: 'New project name', maxlength: '60', hidden: '' })
  const fill = async () => {
    if (!projects) { try { projects = await call('galaxy:projects') } catch { projects = [] } }
    for (const p of projects) project.append(el('option', { value: p.id }, `${p.name} (${p.items})`))
  }
  void fill()
  project.addEventListener('change', () => { name.hidden = project.value !== '__new' })
  const noun = count === 1 ? 'item' : 'items'
  return el('div', { class: 'row keep' }, el('span', { class: 'muted' }, `Keep ${count} ${noun} (shift-click adds more):`),
    el('button', { type: 'button', onclick: keep('galaxy:save-note', () => [ids()], () => 'Note created in Notes.') }, 'As a note'),
    el('button', { type: 'button', onclick: keep('galaxy:save-board', () => [ids()], (r) => `Put on the whiteboard \u201c${r.name}\u201d.`) }, 'On a whiteboard'),
    project, name,
    el('button', { type: 'button', onclick: async () => {
      if (!project.value) return say('Choose a project.')
      const target = project.value === '__new' ? { newName: name.value } : project.value
      await keep('galaxy:save-project', () => [target, ids()], (r) => `Added ${r.added} ${r.added === 1 ? 'item' : 'items'} to the project \u201c${r.name}\u201d.`)()
      projects = null
    } }, 'Add to project'))
}

/** Connect this item to another, and ask Orion about it: the same actions the Orbis window offers. */
function actions(n) {
  const box = el('div', { class: 'row' })
  const pick = el('select', { 'aria-label': 'Connect to' }, el('option', { value: '' }, 'Connect to…'), ...nodes.filter((x) => x.id !== n.id).slice(0, 300).map((x) => el('option', { value: x.id }, `${LABELS[x.type] || x.type}: ${x.label}`.slice(0, 80))))
  const why = el('input', { type: 'text', 'aria-label': 'Why (optional)', placeholder: 'Why (optional)', maxlength: '200' })
  const connect = el('button', { type: 'button', onclick: async () => {
    if (!pick.value) return say('Choose what to connect it to.')
    try { await call('galaxy:link', [n.id, pick.value, why.value.trim() || undefined]); say('Connected.'); await load() } catch (err) { say(err?.message || 'Could not connect those.') }
  } }, 'Connect')
  const ask = el('button', { type: 'button', onclick: async () => {
    try {
      const message = await call('galaxy:ask', [[n.id], 'What does this connect to, and what should I look at next?'])
      window.open(`orbis://search?q=${encodeURIComponent(String(message).slice(0, 1800))}&in=orion`, '_blank', 'noopener')
      say('Opened in Orion Search.')
    } catch (err) { say(err?.message || 'Could not ask Orion.') }
  } }, 'Ask Orion')
  noteBox = el('span', { class: 'muted', role: 'status' }, note)
  box.append(pick, why, connect, ask)
  return el('div', {}, box, keepRow(n), noteBox)
}

function drawShell() {
  root.replaceChildren()
  const search = el('input', { type: 'search', 'aria-label': 'Search Galaxy', placeholder: 'Search the map…', autocomplete: 'off', value: query, onchange: (e) => { query = e.target.value; void load() } })
  const ranges = el('select', { 'aria-label': 'Time range', onchange: (e) => { range = Number(e.target.value); void load() } }, ...RANGES.map(([label, days]) => el('option', { value: String(days) }, label)))
  ranges.value = String(range)
  root.append(el('div', { class: 'row' }, search, ranges, el('button', { type: 'button', onclick: () => void load() }, 'Refresh')))
  const chips = el('div', { class: 'row seg', role: 'group', 'aria-label': 'Show' })
  for (const t of TYPES) {
    const count = graph?.totals?.[t]
    if (!count && !types.includes(t)) continue
    chips.append(el('button', { type: 'button', 'aria-pressed': String(types.includes(t)), onclick: () => { types = types.includes(t) ? types.filter((x) => x !== t) : [...types, t]; void load() } },
      el('span', { class: 'dot', style: `background:${COLORS[t]}` }), `${LABELS[t]}${count ? ` ${count}` : ''}`))
  }
  root.append(chips)
  if (problem) root.append(el('div', { class: 'problem', role: 'alert' }, problem))
  if (loading && !graph) return void root.append(el('p', { class: 'empty' }, 'Drawing the map…'))
  if (graph && !graph.nodes.length) return void root.append(el('p', { class: 'empty' }, types.length || query || range ? 'Nothing matches that.' : 'Nothing on the map yet. Notes, tasks, research and workflows appear here as you make them.'))
  if (!graph) return
  canvas = el('canvas', { class: 'galaxy-canvas', role: 'img', 'aria-label': `Galaxy map with ${graph.nodes.length} items and ${graph.edges.length} connections` })
  detailBox = el('div', { class: 'galaxy-detail', 'aria-live': 'polite' })
  root.append(canvas, el('p', { class: 'muted' }, `${graph.nodes.length} items, ${graph.edges.length} connections`), detailBox)
  wireCanvas()
  startMeteors()
  drawDetails()
  requestAnimationFrame(() => { fit(); paint() })
}

document.addEventListener('orbis:galaxy-shown', () => void load())

/*
 * And once, now, if this is the view the panel opened at.
 *
 * The event above is dispatched by `showTab`, which runs as the page loads for whichever view the address names --
 * before this module has been evaluated, so there is nobody listening yet. Without this, landing straight on
 * #galaxy drew the frame and nothing in it, and going to another view and back filled it in: a fault that only
 * shows itself to somebody who opens the address directly and does not look twice.
 */
{
  const here = document.getElementById('view-galaxy')
  if (here && !here.hidden) void load()
}
