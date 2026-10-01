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

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }

// ---------------------------------------------------------------- the mark

/**
 * The Orbis mark: the real logo, not a drawing of it.
 *
 * This used to be two SVG ellipses -- an approximation of the ring, good enough at 20px and wrong everywhere else. The
 * actual artwork ships with the browser (orbis-ring.png, the same file the new tab page and the Command Center use),
 * so the Orb wears the real mark and there is one logo in Orbis rather than one logo and a sketch of it.
 *
 * If the image cannot be loaded the element is left empty rather than falling back to a drawing: an Orb with nothing
 * in it is a loading problem somebody can see, while a lookalike is one nobody would ever notice.
 */
function orbisMark(size) {
  const img = document.createElement('img')
  img.className = 'orbis-mark'
  img.src = 'orbis-ring.png'
  img.alt = ''
  // Asked for at the size it is actually drawn, in device pixels. The artwork is 549px wide and was being handed to
  // a 26px box with no guidance, which is where the softness came from: the browser picks a cheap filter when it is
  // downscaling that far in one step. Telling it the real box lets it pick the right one.
  img.width = size
  img.height = size
  img.decoding = 'async'
  img.draggable = false
  img.addEventListener('error', () => img.remove())
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
function buildOrbBody() {
  const body = el('span', 'orb-body')
  body.append(el('span', 'orb-face'))
  body.append(el('span', 'orb-rim'))
  body.append(orbisMark(22))
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

let place = { x: 12, y: 12, size: 30, open: false, up: false }

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
  const size = place.size || 30
  orbEl.style.left = `${place.x}px`
  orbEl.style.top = `${place.y}px`
  orbEl.style.width = `${size}px`
  orbEl.style.height = `${size}px`
  orbEl.classList.toggle('working', state.working)
  orbEl.classList.toggle('attention', Boolean(state.confirmation))
  orbEl.classList.toggle('open', state.open)
  // The dot is always present and hidden by CSS, so showing it cannot disturb a drag by changing the child list.
  orbEl.classList.toggle('marked', state.working || Boolean(state.confirmation))
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
  const orbBottom = place.y + (place.size || 30)
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
  form.append(box, send)
  form.addEventListener('submit', (e) => { e.preventDefault(); void submit() })

  panel.append(head, body, form)
  return panel
}

let draft = ''
let focusPrompt = false

function draw() {
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
