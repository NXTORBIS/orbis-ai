// The Orbis Orb, over every page.
//
// This is the Electron Orb's interface, carried across: the same 30px mark, the same float, the same panel with its
// steps, approvals and Pause/Stop/Resume, the same prompt asking what Orbis should do on this page. The parts that had
// to change are the parts that were Electron's: React became plain DOM, and the window it lives in is now the browser's
// own overlay rather than a layer inside a page.
//
// Two things are split between here and the browser, and the split is deliberate:
//   - the page draws the Orb and takes the pointer, because that is what a renderer is for;
//   - the browser decides where the Orb is and how big this window must be (orbis_orb_web_view.cc), because a page that
//     placed itself could put the Orb off-screen, under the toolbar, or over something it should not cover.
// So a drag reports movement, never a position, and the page asks the browser where the Orb ended up.
//
// Nothing here is faked. A task runs against the real browser through the Browser Control Layer, the steps shown are the
// steps that happened, and when the helper is not running the Orb says so instead of pretending.

import { call, askBrowser, HelperDown } from './helper.js'
import { mountControls } from './controls.js'

/**
 * What the Orb says when Orbis itself is not there.
 *
 * Never the error's own words. `HelperDown` carries `Orbis is not running. Start it from run-orbis-chromium.bat.`,
 * which is a launcher instruction with a batch filename in it, and it was being printed into the Orb as though the
 * assistant had said it. The condition is real and is still reported; the sentence is written here, for a person,
 * rather than lifted from a diagnostic meant for whoever is debugging the launcher.
 */
const ORBIS_UNAVAILABLE = 'Orbis is not running yet, so there is nothing to ask. This connects by itself once Orbis starts.'

const DRAG_THRESHOLD = 5

/** The microphone, drawn rather than written, so it is the same mark at any size and needs no font. */
function micMark() {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of ['M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3']) {
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }

// ---------------------------------------------------------------- the mark

const SVG = 'http://www.w3.org/2000/svg'

/** A namespaced element with its attributes, because `setAttribute` eleven times in a row reads as nothing at all. */
function svg(tag, attrs) {
  const node = document.createElementNS(SVG, tag)
  for (const name of Object.keys(attrs)) node.setAttribute(name, String(attrs[name]))
  return node
}

/**
 * The Orbis mark, drawn rather than photographed.
 *
 * It was `orbis-ring.png` -- 549 pixels of artwork handed to a 22px box, which is a downscale large enough that
 * the browser picks a cheap filter and the edges come out soft. Worse than soft: it was a *picture*, so it could
 * not be lit by the same light as the glass it sits in, could not turn with it, and arrived over the network like
 * any other resource, which is a mark that is briefly absent every time the Orb is built.
 *
 * Two rings, tilted against each other, which is what the mark is: a band that crosses itself. Each is an ellipse
 * stroked with its own gradient running white -> steel -> black along the direction the light falls, so the near
 * edge is lit and the far edge falls away. A cyan pass over the top catches where the two cross, which is the part
 * of the real artwork the eye actually remembers.
 *
 * Drawn once per Orb and never replaced, so nothing here runs again after the first build.
 *
 * `id` has to be unique per mark: two marks on one page -- the Orb and the panel's heading -- would otherwise
 * share one set of gradient definitions, and the second would take the first's.
 */
let marksMade = 0

/** The original Orbis ring: one decoded image, shared by every mark on the page, instead of a drawing rebuilt each time. */
const RING = 'data:image/webp;base64,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'
function orbisMark(size) {
  const img = document.createElement('img')
  img.className = 'orbis-mark'
  img.src = RING
  img.alt = ''
  img.width = size
  img.height = Math.round(size * 0.89)
  img.draggable = false
  img.setAttribute('aria-hidden', 'true')
  return img
}

/**
 * The Orb itself: the mark, and the glass around it.
 *
 * The mark is the real artwork and stays that way -- it is a rendered ring with its own shading, and a hand-drawn
 * approximation of it would be the lookalike nobody notices rather than an improvement. What was missing is
 * everything around it. A flat disc with a picture centred in it reads as a picture on a circle, so the body is
 * built from layers that behave like a sphere: a lit face, a rim that catches light from behind, a specular
 * highlight that sits above the mark, and a shadow under the whole thing.
 *
 * All of it is drawn by CSS on elements that are created once and never replaced, so it stays crisp at any zoom and
 * the animation never restarts.
 */
/*
 * Exported so the Orb's body can be built and photographed without a browser, a helper or a page behind it.
 *
 * Nothing else imports it, and that is the point: the layers below are the whole of what the Orb looks like, and
 * a check on them should not need the rest of the application running to see them.
 */
export function buildOrbBody() {
  const body = el('span', 'orb-body')
  /*
   * Six layers, outside in, and the order is the thing that makes it a sphere rather than a stack of circles:
   *
   *   orb-halo     the light it throws past its own edge, which is what sets it off the page
   *   orb-face     the lit body, dark glass with the light falling away to a dark limb
   *   orb-depth    an inner shadow around the inside of the edge, so the face is a surface curving away
   *   orb-rim      the bright hairline where the light grazes the edge, turning slowly
   *   the mark     drawn, not a photograph
   *   orb-refract  a bent band of light across the glass, in `screen`, which is what glass does to what is behind it
   *   orb-gloss    the specular highlight, small and off-centre, above everything
   *
   * All of them are created once here and never replaced, so the animation never restarts and nothing re-renders
   * when the Orb's state changes.
   */
  body.append(el('span', 'orb-halo'))
  body.append(el('span', 'orb-face'))
  body.append(el('span', 'orb-depth'))
  body.append(el('span', 'orb-rim'))
  body.append(orbisMark(22))
  body.append(el('span', 'orb-refract'))
  body.append(el('span', 'orb-gloss'))
  return body
}

// ---------------------------------------------------------------- state

/** Everything the panel shows. Set in one place, drawn in one place; nothing is written straight into the DOM. */
const state = {
  open: false,
  working: false,
  /** Whether the controls are showing instead of the conversation. One panel, two things it can be. */
  controls: false,
  /** An approval the controls are waiting on, kept apart from the agent's so one cannot answer the other. */
  controlAsk: null,
  /** 'idle' | 'reading' | 'thinking' | 'streaming' | 'done' | 'error' | 'cancelled' */
  phase: 'idle',
  status: '',
  /** What was asked, shown above the steps so a list of actions has a question over it. */
  request: '',
  /** Which step's detail is open, if any. One at a time: this is a panel, not a report. */
  openStep: null,
  steps: [],
  automation: null,
  confirmation: null,
  summary: '',
  /** A picture Orbis made, when it made one. */
  image: null,
  /** The seed of the last picture, so "make it darker" changes that picture rather than making another. */
  lastSeed: null,
  /** The pages an answer was read from, when it was read from pages. */
  sources: [],
  error: ''
}

let controller = null

const HEADLINE = {
  idle: 'Ready',
  reading: 'Reading the page',
  thinking: 'Thinking',
  streaming: 'Working',
  done: 'Done',
  error: 'Stopped',
  cancelled: 'Stopped'
}

// ---------------------------------------------------------------- placement
//
// The browser owns the position. After every resize of this window -- which is what happens when the browser moves or
// resizes the Orb -- the page asks where the Orb now is and draws it there.

let place = { x: 12, y: 12, size: 48, open: false, up: false }

async function refreshPlacement() {
  /**
   * Nothing is asked while a drag is under way.
   *
   * Every step of a drag moves the Orb, moving the Orb resizes this window, and a resize lands here -- so this ran
   * sixty times a second during a drag, each time asking the browser where the Orb was and then throwing the answer
   * away because a drag was in progress. The position that matters is the one read when the drag ends, and the
   * browser sends a resize then too.
   */
  if (gesture !== null) return
  try {
    const p = await askBrowser('orbis.orb.placement')
    if (p && typeof p.x === 'number') place = { ...place, ...p }
  } catch { /* the browser will ask again on the next resize */ }
  // The drag may have started while that was in flight, and laying a stale position over a moving Orb would fight it.
  if (gesture !== null) return
  draw()
}

// ---------------------------------------------------------------- drawing

const layer = () => $('layer')

/**
 * The Orb element, built once and kept.
 *
 * This is the fix for a drag that stopped after a single pixel. The Orb used to be rebuilt by `draw`, and dragging
 * it makes the browser resize this window, and a resize calls `draw` -- so the very first movement destroyed the
 * button that had captured the pointer, taking the capture and the gesture with it. Every later move landed on an
 * element that no longer existed, and the Orb sat still while the pointer went on moving.
 *
 * So the button and everything inside it are created once. `draw` updates its position and its classes and never
 * replaces it, which also ends the flicker: the artwork is decoded once instead of on every state change, and the
 * float animation runs continuously instead of restarting from zero each time a step arrives.
 */
let orbEl = null
let gesture = null

function buildOrb() {
  const orb = el('button', 'browser-orb')
  orb.type = 'button'
  orb.title = 'Orbis: click to open, drag to move'
  orb.append(buildOrbBody())
  orb.append(el('span', 'browser-orb-dot'))

  /**
   * The pointer is followed in **screen** coordinates, never in the page's own.
   *
   * This is the fix for a drag that moved a pixel and then sat there shaking.
   *
   * The window this page is drawn in is only as big as the Orb, and dragging moves that window. So the page's own
   * viewport chases the pointer: move the Orb ten pixels right and `clientX` -- which is measured from the left edge
   * of a viewport that has itself just moved ten pixels right -- reads almost exactly what it read before. The
   * measured movement collapsed to nothing after the first step, and what was left was rounding noise, which is
   * precisely what "it jitters and goes nowhere" looks like.
   *
   * `screenX` and `screenY` are absolute to the display and do not move when the Orb does, so the difference between
   * two of them is the distance the pointer actually travelled. Nothing else here changed: it is still movement being
   * reported rather than a position, and the browser still decides where the Orb may go.
   */
  orb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    gesture = { id: e.pointerId, x: e.screenX, y: e.screenY, lastX: e.screenX, lastY: e.screenY, moved: false }
    orb.setPointerCapture(e.pointerId)
  })

  orb.addEventListener('pointermove', (e) => {
    if (!gesture || e.pointerId !== gesture.id) return
    if (!gesture.moved && Math.hypot(e.screenX - gesture.x, e.screenY - gesture.y) < DRAG_THRESHOLD) return
    if (!gesture.moved) { gesture.moved = true; orb.classList.add('dragging') }
    e.preventDefault()
    // Movement, not a position: the browser places the Orb, and clamps it where it must.
    const dx = Math.round(e.screenX - gesture.lastX)
    const dy = Math.round(e.screenY - gesture.lastY)
    /**
     * The anchor only advances by what was actually sent.
     *
     * Rounding a fractional movement to nothing and then throwing that fraction away loses it, so a slow drag across
     * the window arrives several pixels short of the pointer. Keeping the remainder means every pixel the pointer
     * travels is eventually a pixel the Orb travels.
     */
    if (dx || dy) {
      gesture.lastX += dx
      gesture.lastY += dy
      chrome.send('orbis.orb.drag', ['orbDrag', dx, dy])
    }
  })

  const end = (e) => {
    if (!gesture || (e && e.pointerId !== gesture.id)) return
    const moved = gesture.moved
    gesture = null
    orb.classList.remove('dragging')
    // The click that follows a drag is the end of the drag, not a request to open.
    if (moved) orb.dataset.justDragged = '1'
    // Telling the browser the drag is over is what stops the Orb leaning towards an edge and what saves where it was
    // left. A drag that ends without this would keep its assistance and be forgotten by the next launch.
    if (moved) chrome.send('orbis.orb.dragend', ['orbDragEnd'])
  }
  orb.addEventListener('pointerup', end)
  orb.addEventListener('pointercancel', end)
  orb.addEventListener('lostpointercapture', end)

  orb.addEventListener('click', () => {
    if (orb.dataset.justDragged) { delete orb.dataset.justDragged; return }
    toggle()
  })
  return orb
}

/** The Orb, updated in place. Never a new element, because a gesture may be in progress on this one. */
function drawOrb() {
  if (orbEl === null) orbEl = buildOrb()
  const size = place.size || 48
  orbEl.style.left = `${place.x}px`
  orbEl.style.top = `${place.y}px`
  orbEl.style.width = `${size}px`
  orbEl.style.height = `${size}px`
  orbEl.classList.toggle('working', state.working)
  orbEl.classList.toggle('attention', Boolean(state.confirmation))
  orbEl.classList.toggle('open', state.open)
  // The dot is always present and hidden by CSS, so showing it cannot disturb a drag by changing the child list.
  orbEl.classList.toggle('marked', state.working || Boolean(state.confirmation))
  /*
   * How far through, drawn as a ring round the Orb while it is collapsed.
   *
   * A conic gradient on a pseudo-element: no extra elements to disturb a drag in progress, and nothing animating
   * when nothing is running. Set as a variable rather than a class so it moves smoothly rather than in steps.
   */
  const total = state.steps.length
  const finished = state.steps.filter((x) => x.status === 'done').length
  orbEl.style.setProperty('--orb-progress', total ? String(finished / total) : '0')
  orbEl.classList.toggle('running', state.working && !state.open && total > 0)
  /*
   * Waiting for you looks different from working, and must.
   *
   * A task that has stopped to ask something is not making progress, and showing it as progress is how somebody
   * leaves it sitting there. This is the one state that stays loud while the Orb is put away.
   */
  orbEl.classList.toggle('attention', Boolean(state.confirmation) && !state.open)
  orbEl.setAttribute('aria-label', state.open ? 'Collapse Orbis assistant' : 'Open Orbis assistant')
  orbEl.setAttribute('aria-expanded', String(state.open))
  return orbEl
}

/** One labelled line of a step's detail. */
function line(label, value) {
  const row = el('div', 'orb-step-line')
  row.append(el('span', 'orb-step-label', label), el('span', 'orb-step-value', value))
  return row
}

function drawPanel() {
  const panel = el('section', 'browser-orb-panel')
  panel.setAttribute('aria-label', 'Orbis browser assistant')
  // The browser has already made room on whichever side had it; the panel fills that room.
  const orbBottom = place.y + (place.size || 48)
  if (place.up) { panel.style.bottom = `${(layer().clientHeight - place.y) + 8}px` } else { panel.style.top = `${orbBottom + 8}px` }
  panel.style.left = '12px'
  panel.style.right = '12px'

  const head = el('header', 'orb-panel-head')
  head.append(orbisMark(18), el('b', '', 'Orbis'))
  head.append(el('span', `orb-panel-state${state.working ? ' live' : ''}`, state.status || HEADLINE[state.phase]))
  const controls = el('button', `b-icon${state.controls ? ' on' : ''}`)
  controls.type = 'button'
  controls.title = state.controls ? 'Back to asking' : 'Everything the browser can do'
  controls.setAttribute('aria-label', controls.title)
  controls.setAttribute('aria-pressed', String(state.controls))
  controls.textContent = state.controls ? '←' : '⚙'
  controls.addEventListener('click', () => { state.controls = !state.controls; draw() })
  head.append(controls)

  const close = el('button', 'b-icon', '×'); close.type = 'button'; close.title = 'Collapse (Esc)'
  close.setAttribute('aria-label', 'Collapse assistant')
  close.addEventListener('click', toggle)
  head.append(close)

  const body = el('div', 'orb-panel-body')

  if (state.controls) {
    // An approval raised by a control is the Orb's own approval box, so approving a click from here looks exactly
    // like approving one the agent asked for -- and is answered on its own channel, never the agent's.
    if (state.controlAsk) {
      const c = state.controlAsk
      const box = el('div', 'orb-confirm')
      box.setAttribute('role', 'alertdialog')
      box.setAttribute('aria-label', 'Approve this action')
      box.append(el('div', 'orb-confirm-head', 'Orbis wants to:'))
      box.append(el('p', 'orb-confirm-action', c.action || ''))
      box.append(el('p', 'orb-confirm-reason', `${c.reason || ''} Nothing happens until you approve.`))
      const acts = el('div', 'orb-actions')
      const no = el('button', 'text-btn', 'Cancel'); no.type = 'button'
      const yes = el('button', 'primary-btn', 'Approve'); yes.type = 'button'
      no.addEventListener('click', () => { const settle = c.settle; state.controlAsk = null; draw(); settle(false) })
      yes.addEventListener('click', () => { const settle = c.settle; state.controlAsk = null; draw(); settle(true) })
      acts.append(no, yes)
      box.append(acts)
      body.append(box)
    }
    const host = el('div', 'orb-controls')
    body.append(host)
    panel.append(head, body)
    // Mounted after the panel is in the document so the search box can take focus.
    queueMicrotask(() => mountControls(host, {
      ask: (confirmation) => new Promise((settle) => { state.controlAsk = { ...confirmation, settle }; draw() }),
      say: (message) => { state.status = message; const line = document.querySelector('.orb-panel-state'); if (line) line.textContent = message }
    }))
    return panel
  }

  if (state.automation) {
    const a = state.automation
    const box = el('div', `orb-progress ${a.status || 'running'}`)
    box.append(el('span', 'orb-progress-text', a.text || a.status || ''))
    if (a.total) {
      const meter = el('span', 'orb-meter')
      const bar = el('span')
      bar.style.width = `${Math.min(100, ((a.completed || 0) / a.total) * 100)}%`
      meter.append(bar)
      box.append(meter)
    }
    if (a.objective) box.append(el('span', 'orb-progress-meta', `Goal: ${a.objective}`))
    if (a.current) box.append(el('span', 'orb-progress-meta', `Now: ${a.current}`))
    if (a.reason) box.append(el('span', 'orb-progress-meta', a.reason))
    body.append(box)
  }

  if (state.confirmation) {
    const c = state.confirmation
    const box = el('div', 'orb-confirm')
    box.setAttribute('role', 'alertdialog')
    box.setAttribute('aria-label', 'Approve this action')
    box.append(el('div', 'orb-confirm-head', 'Orbis wants to:'))
    box.append(el('p', 'orb-confirm-action', c.action || ''))
    box.append(el('p', 'orb-confirm-reason', `${c.reason || ''} Nothing happens until you approve.`))
    const acts = el('div', 'orb-actions')
    const no = el('button', 'text-btn', 'Cancel'); no.type = 'button'
    const yes = el('button', 'primary-btn', 'Approve'); yes.type = 'button'
    no.addEventListener('click', () => answer(false))
    yes.addEventListener('click', () => answer(true))
    acts.append(no, yes)
    box.append(acts)
    body.append(box)
  }

  /*
   * The task, and every step of it.
   *
   * This is the part of the Orb that has to be true. A step is drawn from what the control loop actually reported --
   * `done` only once the browser confirmed it -- so a tick here means the browser agrees, and nothing is marked
   * finished because a command was sent.
   *
   * Completed steps stay, and steps not reached yet are shown too. Somebody watching should be able to see where they
   * are in something, which a list that only shows the last few cannot tell them.
   */
  if (state.request || state.steps.length) {
    const run = el('section', 'orb-run')
    run.setAttribute('aria-label', 'What Orbis is doing')

    if (state.request) run.append(el('p', 'orb-run-ask', state.request))

    if (state.steps.length) {
      const done = state.steps.filter((x) => x.status === 'done').length
      const head = el('div', 'orb-run-count')
      head.append(el('span', '', `${done} of ${state.steps.length} done`))
      if (state.working) head.append(el('span', 'orb-run-now', state.status || ''))
      run.append(head)

      const ol = el('ol', 'orb-steps')
      for (const step of state.steps) {
        const status = step.status || 'planned'
        const li = el('li', `orb-step ${status}`)

        const row = el('button', 'orb-step-row')
        row.type = 'button'
        /*
         * The mark is the state, and the four states are four different things: confirmed, happening, not reached,
         * and did not work. A spinner on everything would say none of them.
         */
        const MARK = { done: '✓', running: '●', failed: '✕', planned: '○', waiting: '⏸' }
        row.append(el('span', 'orb-step-mark', MARK[status] || '○'))
        row.append(el('span', 'orb-step-name', step.text || step.name || ''))
        const detail = step.capability || (step.result && step.result.verification && step.result.verification.detail) || ''
        if (detail) row.append(el('span', 'orb-step-more', state.openStep === step.id ? '−' : '+'))
        row.addEventListener('click', () => {
          state.openStep = state.openStep === step.id ? null : step.id
          draw()
        })
        li.append(row)

        /*
         * What a step actually did, when somebody asks.
         *
         * The capability it used, what it was given, and how the browser confirmed it -- which is the reason to
         * believe the tick. Never the reasoning behind the plan: that is not execution metadata.
         */
        if (state.openStep === step.id) {
          const box = el('div', 'orb-step-detail')
          if (step.capability) box.append(line('Action', step.capability))
          if (step.params && typeof step.params === 'object') {
            const shown = Object.entries(step.params)
              .filter(([, v]) => v !== undefined && v !== null && v !== '')
              .slice(0, 4)
              .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
              .join('  ·  ')
            if (shown) box.append(line('With', shown))
          }
          const verified = step.result && step.result.verification
          if (verified && verified.detail) box.append(line(verified.verified ? 'Confirmed' : 'Not confirmed', verified.detail))
          const failed = step.failure || (step.result && step.result.error)
          if (failed && failed.message) box.append(line('Why not', failed.message))
          if (step.tries > 1) box.append(line('Tries', String(step.tries)))
          li.append(box)
        }

        ol.append(li)
      }
      run.append(ol)
    } else if (state.working) {
      // Before a plan exists there is still something happening, and saying so beats an empty box.
      run.append(el('p', 'orb-run-now', state.status || 'Working out what to do…'))
    }

    body.append(run)
  }

  if (state.image) {
    const figure = el('figure', 'orb-image')
    const img = el('img'); img.src = state.image.url; img.alt = state.image.prompt || 'The picture Orbis made'
    figure.append(img)
    if (state.image.prompt) figure.append(el('figcaption', '', state.image.prompt))
    body.append(figure)
  }

  if (state.sources.length) {
    body.append(el('div', 'orb-sources-head', 'Read from'))
    const list = el('ol', 'orb-sources')
    for (const source of state.sources) {
      const li = el('li')
      const a = el('a', '', source.title || source.url || 'Source')
      a.href = source.url || '#'
      a.target = '_blank'
      li.append(a)
      list.append(li)
    }
    body.append(list)
  }

  if (state.summary && !state.working) {
    body.append(el('p', 'orb-summary', state.summary.length > 320 ? `${state.summary.slice(0, 317)}…` : state.summary))
  }
  if (state.error) body.append(el('p', 'orb-summary', state.error))

  if (state.working) {
    const acts = el('div', 'orb-actions orb-stop-row')
    const stop = el('button', 'orb-stop', 'Stop'); stop.type = 'button'
    stop.addEventListener('click', () => {
      controller?.abort()
      // Stopping the stream would leave the browser mid-task; the task itself is told to stop.
      void call('browser:task-stop').catch(() => { /* the stream is already gone */ })
    })
    acts.append(stop)
    body.append(acts)
  }

  const form = el('form', 'orb-prompt')
  const box = el('textarea')
  box.rows = 2
  box.placeholder = state.working ? 'Tell Orbis to stop, pause, or change the task…' : 'What should Orbis do on this page?'
  box.setAttribute('aria-label', 'Tell Orbis what to do on this page')
  box.value = draft
  box.addEventListener('input', () => { draft = box.value })
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit() }
    if (e.key === 'Escape') { e.stopPropagation(); toggle() }
  })
  const send = el('button', 'orb-send', '↑'); send.type = 'submit'
  send.setAttribute('aria-label', 'Send to Orbis')
  /*
   * The microphone, as the Electron Orb had it.
   *
   * Drawn only when there really is one to use: `orbisPromptVoice` is the page's own voice module, and it says
   * whether this window can open a microphone at all. A button that cannot record is not a button.
   *
   * What it records goes into the box, not into a task. Speaking is a way of typing; what to do with the words is
   * still the person's to decide, and they can read them before pressing send.
   */
  const voice = window.orbisPromptVoice
  if (voice && voice.available()) {
    const mic = el('button', 'orb-mic', '🎙')
    mic.type = 'button'
    mic.textContent = ''
    mic.append(micMark())
    const label = (state) => {
      mic.setAttribute('aria-label', state === 'listening' ? 'Stop recording' : state === 'transcribing' ? 'Writing down what you said' : 'Speak instead of typing')
      mic.title = mic.getAttribute('aria-label')
      mic.classList.toggle('recording', state === 'listening')
      mic.classList.toggle('transcribing', state === 'transcribing')
      mic.disabled = state === 'transcribing'
    }
    label(voice.state())
    mic.addEventListener('click', () => {
      void voice.toggle((update) => {
        label(update.state)
        if (update.state === 'done' && update.text) {
          // Added to whatever is already typed, because speaking after typing is adding to the sentence.
          draft = draft ? `${draft.trimEnd()} ${update.text}` : update.text
          box.value = draft
          box.focus()
          box.setSelectionRange(box.value.length, box.value.length)
        }
        if (update.state === 'error' && update.error) { state.error = update.error.message; draw() }
      })
    })
    form.append(box, mic, send)
  } else {
    form.append(box, send)
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); void submit() })

  panel.append(head, body, form)
  return panel
}

let draft = ''
let focusPrompt = false

let drawQueued = false
function draw() {
  if (drawQueued) return
  drawQueued = true
  requestAnimationFrame(() => {
    drawQueued = false
    drawNow()
  })
}

function drawNow() {
  const host = layer()
  if (!host) return
  /**
   * The Orb is never taken out of the page, not even for a moment.
   *
   * Keeping the same element was not enough. Taking it out and putting it back kept the *object* but not its pointer
   * capture: removing a captured element from the document releases the capture, by specification. So any status
   * arriving mid-drag -- and one arrives whenever Orbis is doing anything at all -- silently ended the drag, and the
   * Orb stopped following the pointer for no reason a person could see.
   *
   * So everything except the Orb is cleared, and the panel is put in front of it. The Orb itself is attached once and
   * stays attached for the life of the page.
   */
  const orb = drawOrb()
  for (const child of [...host.children]) {
    if (child !== orb) child.remove()
  }
  if (!orb.isConnected) host.append(orb)
  if (state.open) host.insertBefore(drawPanel(), orb)
  if (state.open && focusPrompt) {
    focusPrompt = false
    host.querySelector('.orb-prompt textarea')?.focus()
  }
}

// ---------------------------------------------------------------- behaviour

/**
 * What Orbis can actually do right now, asked when the panel opens rather than discovered when a task fails. A prompt
 * that cannot go anywhere is worse than a sentence saying why.
 */
async function checkReady() {
  try {
    const ready = await call('browser:task-ready')
    if (!ready.browser) state.error = 'The Orbis browser is not connected, so Orbis cannot act on this page.'
    else if (!ready.key) state.error = 'Orion is not available on this installation.'
    else if (ready.busy) state.error = 'Orbis is already working in the browser.'
    else state.error = ''
  } catch (err) {
    state.error = err instanceof HelperDown ? ORBIS_UNAVAILABLE : 'Orbis is not answering.'
  }
  draw()
}

function toggle() {
  state.open = !state.open
  if (state.open && !state.working) void checkReady()
  focusPrompt = state.open
  // The browser resizes this window to fit, and the resize brings the new placement back.
  chrome.send('orbis.orb.open', ['orbOpen', state.open])
  draw()
}

function answer(approved) {
  const waiting = state.confirmation
  state.confirmation = null
  draw()
  if (!waiting) return
  // The answer goes back to whichever asked. A step the Orb's own loop is running answers on its channel; one the
  // browser agent raised answers on the agent's. Sending it to the wrong one would leave the action waiting forever
  // for an answer that had already been given.
  const channel = String(waiting.id ?? '').startsWith('orb-') ? 'orb:answer' : 'browser:task-answer'
  // The task is streaming on another request, so the answer travels on its own. Until it arrives, the action waits;
  // if this fails, nothing was approved, which is the safe way for an approval to fail.
  call(channel, [waiting.id, approved === true]).catch(() => {
    state.error = 'Orbis could not be told your answer, so nothing was done.'
    setPhase('error')
  })
}

function setPhase(phase, status = '') {
  state.phase = phase
  state.status = status || HEADLINE[phase]
  state.working = phase === 'reading' || phase === 'thinking' || phase === 'streaming'
  draw()
}

/**
 * Sends the task. Everything it shows comes back from the helper: the steps are the steps the browser took, the
 * approvals are real approvals, and an answer that never arrived is reported as an error rather than as silence.
 */
async function submit() {
  const text = draft.trim()
  if (!text || controller) return
  draft = ''
  // What was asked, kept above the steps: a list of actions with no question over it is a list of actions.
  state.request = text
  state.openStep = null
  state.steps = []
  state.automation = null
  state.confirmation = null
  state.summary = ''
  state.image = null
  state.sources = []
  state.error = ''
  controller = new AbortController()
  setPhase('thinking')

  try {
    // One way in, and it is the control loop: Orbis looks at the real browser, works out what would have to happen,
    // plans it against the capabilities the browser actually has, carries it out, and checks each step against what
    // the browser says afterwards. Anything that is not browser work -- a picture, a question, research, a look at the
    // page -- it hands to the router Orbis already has, so there is one answer to a question rather than two.
    await call('orb:ask', [text], {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'step' && event.step) {
          const at = state.steps.findIndex((s) => s.id === event.step.id)
          if (at >= 0) state.steps[at] = event.step
          else state.steps.push(event.step)
          setPhase('streaming')
        } else if (event.type === 'automation') {
          state.automation = event.automation ?? null
          setPhase('streaming')
        } else if (event.type === 'confirm' && event.confirmation) {
          state.confirmation = event.confirmation
          setPhase('streaming', 'Waiting for your approval')
        } else if (event.type === 'confirm-done') {
          state.confirmation = null
          draw()
        } else if (event.type === 'delta' && typeof event.content === 'string') {
          state.summary += event.content
          setPhase('streaming')
        } else if (event.type === 'status' && typeof event.message === 'string') {
          setPhase('streaming', event.message)
        } else if (event.type === 'image' && event.url) {
          state.image = { url: event.url, prompt: event.prompt || '' }
          state.lastSeed = typeof event.seed === 'number' ? event.seed : null
          setPhase('streaming')
        } else if (event.type === 'research' && event.research) {
          state.sources = Array.isArray(event.research.sources) ? event.research.sources.slice(0, 6) : []
          setPhase('streaming')
        } else if (event.type === 'plan' && Array.isArray(event.steps)) {
          // The plan, before anything runs: what Orbis worked out it would have to do.
          state.steps = event.steps.map((s) => ({ ...s, id: s.id, text: s.name, status: 'planned' }))
          setPhase('streaming', `${event.steps.length} step${event.steps.length === 1 ? '' : 's'} planned`)
        } else if (event.type === 'context' && event.because) {
          setPhase('streaming', `Using ${event.because}`)
        } else if (event.type === 'refused-step' && event.why) {
          // Something Orbis cannot do, said rather than silently left out of the plan.
          state.steps.push({ id: `x${state.steps.length}`, text: `${event.name}: ${event.why}`, status: 'failed' })
          draw()
        } else if (event.type === 'refused' && event.why) {
          state.error = event.why
          setPhase('error')
        } else if (event.type === 'recovery') {
          const said = { retry: 'trying again', 're-perceive': 'looking again', 're-plan': 'finding another way', 'ask-user': 'needs you', 'give-up': 'cannot go on' }[event.decision] || event.decision
          setPhase('streaming', `${event.step}: ${said}`)
        } else if (event.type === 'ask-user' && event.question) {
          state.error = event.question
          setPhase('done')
        } else if (event.type === 'outcome') {
          // What really happened, verified or not. Never a cheerful ending over a failed step.
          state.summary = event.text || ''
          setPhase(event.status === 'done' ? 'done' : 'error')
          if (event.status !== 'done') state.error = event.text || ''
        } else if (event.type === 'answer' && typeof event.text === 'string') {
          state.summary = event.text
          setPhase('streaming')
        } else if (event.type === 'error') {
          state.error = event.message || 'Orbis could not do that.'
          setPhase('error')
        }
      },
    })
    if (state.phase !== 'error') setPhase(state.summary || state.steps.length ? 'done' : 'error')
    if (state.phase === 'error' && !state.error) state.error = 'Orbis did nothing and said nothing. Nothing was changed.'
  } catch (err) {
    if (controller?.signal.aborted) setPhase('cancelled')
    else {
      state.error = err instanceof HelperDown ? ORBIS_UNAVAILABLE : (err?.message || 'That did not work.')
      setPhase('error')
    }
  } finally {
    controller = null
    if (!state.working) draw()
  }
}

// ---------------------------------------------------------------- start

// The way back to the chat.
//
// The button is on the browser's toolbar, in C++, and the chat belongs to the Orbis app, which the browser can only
// reach through the helper. This page may call the helper and is in every window already, so the button asks it to.
window.orbisShowChat = () => {
  call('app:show-chat').catch(() => {
    // Running on its own there is no chat to go back to, and no channel either. Nothing happens, and nothing pretends to.
  })
}

// The browser resizes this window whenever it moves or opens the Orb, so a resize is the signal to ask where it is now.
window.addEventListener('resize', () => { void refreshPlacement() })
document.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'o') { e.preventDefault(); toggle() }
  else if (e.key === 'Escape' && state.open) toggle()
})
void refreshPlacement()
