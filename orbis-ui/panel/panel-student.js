import { call } from './helper.js'

// Focus, in the browser.
//
// The part of Orbis Student that belongs where the reading happens: what is running, how long is left, keeping a card
// or a page, and the way out of a session. Everything else -- the plan, the mastery map, the reports -- is in the
// Orbis window, because two homes for one feature is how a thing ends up half-built in both.
//
// Nothing here reads the learning record. A page's process may ask whether a session is running; it may not ask what
// somebody is weak at. And nothing here can loosen a session's rules: there is no "allow this site" button, because
// a browser surface that could would turn the shield into a suggestion.
//
// Text from a page goes on screen as text only, never as markup.

const root = document.getElementById('student')

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v)
  }
  node.append(...children.filter((c) => c !== null && c !== undefined))
  return node
}

let state = null
let problem = ''
let said = ''
let ready = false
let keeping = null
let timer = null

async function run(channel, args) {
  problem = ''
  try {
    return await call(channel, args)
  } catch (err) {
    // "Orbis is not open" is a different thing from "nothing is running", and saying which is the difference between
    // a panel that looks closed and one that looks broken.
    problem = err?.message || 'That did not work.'
    return null
  }
}

async function load() {
  const out = await run('student:state', [])
  state = out ?? null
  ready = true
  draw()
}

/** The page in front of the student, asked of the browser rather than guessed at. */
async function page() {
  try {
    const listed = await call('browser:tabs', [])
    const rows = Array.isArray(listed) ? listed : (listed?.tabs ?? [])
    const active = rows.find((one) => one.active) ?? rows[0]
    if (!active || !/^https?:/i.test(active.url || '')) return null
    return { url: active.url, title: active.title || active.url }
  } catch {
    return null
  }
}

function spell(minutes) {
  if (minutes === null || minutes === undefined) return ''
  if (minutes < 1) return 'less than a minute left'
  if (minutes < 60) return `${minutes} min left`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h left` : `${hours} h ${rest} min left`
}

function keepForm() {
  if (!keeping) return null

  if (keeping.kind === 'drafts') {
    /*
     * Drafts from the page, ticked here before any of them become cards.
     *
     * Each one is kept through `student:saveCard`, the same channel a hand-written card uses -- so there is one
     * path into somebody's deck and it is the one that has always been there.
     */
    const chosen = new Set(keeping.cards.map((_, index) => index))
    const list = el('div', { class: 'st-keep' })
    keeping.cards.forEach((card, index) => {
      const box = el('input', { type: 'checkbox' })
      box.checked = true
      box.addEventListener('change', () => (box.checked ? chosen.add(index) : chosen.delete(index)))
      list.append(el('label', { class: 'row' }, box, el('span', {}, el('strong', {}, card.front), el('span', { class: 'muted' }, card.back))))
    })
    list.append(
      el(
        'div',
        { class: 'row' },
        el(
          'button',
          {
            class: 'o-btn primary',
            onclick: async () => {
              let kept = 0
              for (const index of chosen) {
                const card = keeping.cards[index]
                const out = await run('student:saveCard', [card.front, card.back, state?.subject ?? null])
                if (out?.ok) kept += 1
              }
              said = kept > 0 ? `${kept} kept. They say Orion wrote them.` : problem || 'Nothing was kept.'
              keeping = null
              draw()
            }
          },
          'Keep the ticked ones'
        ),
        el('button', { class: 'o-btn', onclick: () => ((keeping = null), draw()) }, 'None of these')
      )
    )
    return list
  }

  if (keeping.kind === 'page') {
    return el(
      'div',
      { class: 'st-keep' },
      el('p', { class: 'muted' }, keeping.title),
      el(
        'div',
        { class: 'row' },
        el(
          'button',
          {
            class: 'o-btn primary',
            onclick: async () => {
              const out = await run('student:saveResource', [keeping.url, keeping.title, state?.subject ?? null])
              said = out?.duplicate ? 'Already in your study library.' : out?.ok ? 'Saved to your study library.' : problem || 'That did not save.'
              keeping = null
              draw()
            }
          },
          'Save it'
        ),
        el('button', { class: 'o-btn', onclick: () => ((keeping = null), draw()) }, 'Cancel')
      )
    )
  }

  const front = el('textarea', { class: 'o-input', rows: '2', 'aria-label': keeping.kind === 'card' ? 'The question' : 'What it was about' })
  const back = el('textarea', { class: 'o-input', rows: '3', 'aria-label': keeping.kind === 'card' ? 'The answer' : 'What went wrong' })
  front.value = keeping.front ?? ''
  back.value = keeping.back ?? ''

  return el(
    'div',
    { class: 'st-keep' },
    el('label', { class: 'muted' }, keeping.kind === 'card' ? 'Question' : 'What it was about'),
    front,
    el('label', { class: 'muted' }, keeping.kind === 'card' ? 'Answer' : 'What went wrong'),
    back,
    el(
      'div',
      { class: 'row' },
      el(
        'button',
        {
          class: 'o-btn primary',
          onclick: async () => {
            const a = front.value.trim()
            const b = back.value.trim()
            if (!a || !b) {
              said = 'Both halves are needed.'
              draw()
              return
            }
            const channel = keeping.kind === 'card' ? 'student:saveCard' : 'student:saveMistake'
            const out = await run(channel, [a, b, state?.subject ?? null])
            said = out?.ok ? (keeping.kind === 'card' ? 'Card saved.' : 'Written in your mistake book.') : problem || 'That did not save.'
            keeping = null
            draw()
          }
        },
        'Keep it'
      ),
      el('button', { class: 'o-btn', onclick: () => ((keeping = null), draw()) }, 'Cancel')
    )
  )
}

function draw() {
  if (!root) return
  root.textContent = ''

  if (!ready) {
    root.append(el('p', { class: 'muted' }, 'Looking…'))
    return
  }

  if (!state) {
    // Honest about which thing is missing.
    root.append(
      el('p', { class: 'empty' }, problem || 'Open Orbis to use Focus from here.'),
      el('p', { class: 'muted' }, 'Your sessions, goals and what you have learned all live in the Orbis window.')
    )
    return
  }

  if (state.running) {
    root.append(
      el(
        'div',
        { class: 'st-now' },
        el('strong', {}, state.title || 'Focus'),
        el(
          'p',
          { class: 'muted' },
          [state.subject, state.paused ? 'paused' : spell(state.minutesLeft)].filter(Boolean).join(' · '),
          state.level === 'deep' ? ' · deep focus' : ''
        )
      )
    )
  } else {
    root.append(el('p', { class: 'muted' }, 'No session running.'))
  }

  const actions = el('div', { class: 'row wrap' })

  if (state.running) {
    /*
     * The way out, here, always.
     *
     * The one rule above all the others in Student: a session may be hard to leave by accident and must never be
     * impossible to leave on purpose. The student may be mid-page with the Orbis window behind twelve others.
     */
    actions.append(
      el(
        'button',
        {
          class: 'o-btn',
          onclick: async () => {
            const out = await run('student:endFocus', [])
            said = out?.ok ? 'Session finished.' : out?.why || problem || 'That did not work.'
            await load()
          }
        },
        'Finish the session'
      )
    )
  } else {
    for (const minutes of [15, 25, 50]) {
      actions.append(
        el(
          'button',
          {
            class: minutes === 25 ? 'o-btn primary' : 'o-btn',
            onclick: async () => {
              const out = await run('student:startFocus', [minutes, null])
              said = out?.ok ? `${minutes} minutes started.` : out?.why || problem || 'That did not start.'
              await load()
            }
          },
          `${minutes} min`
        )
      )
    }
  }

  root.append(actions)

  root.append(
    el('h3', {}, 'Keep something from this page'),
    el(
      'div',
      { class: 'row wrap' },
      el(
        'button',
        {
          class: 'o-btn',
          onclick: async () => {
            const found = await page()
            if (!found) {
              said = 'There is no web page open to save.'
              draw()
              return
            }
            keeping = { kind: 'page', url: found.url, title: found.title }
            said = ''
            draw()
          }
        },
        'This page'
      ),
      el('button', { class: 'o-btn', onclick: () => ((keeping = { kind: 'card', front: '', back: '' }), (said = ''), draw()) }, 'A card'),
      /*
       * Cards drafted from what is on the page.
       *
       * The page's text goes to Orion and comes back as drafts; nothing is saved here. Keeping them is done in the
       * Orbis window, where they can be read and ticked -- a browser surface that wrote into somebody's deck would
       * be a web page's process putting things into their revision.
       */
      el(
        'button',
        {
          class: 'o-btn',
          onclick: async () => {
            said = 'Reading the page…'
            draw()
            // Nothing is sent: Orbis reads the real tab itself, so a page cannot post its own text here.
            const out = await run('student:draftFromPage', [])
            if (!out || out.ok !== true) {
              said = out?.why || problem || 'Orion could not make cards from this page.'
              draw()
              return
            }
            keeping = { kind: 'drafts', cards: out.cards.slice(0, 8) }
            said = ''
            draw()
          }
        },
        'Cards from this page'
      ),
      el('button', { class: 'o-btn', onclick: () => ((keeping = { kind: 'mistake', front: '', back: '' }), (said = ''), draw()) }, 'A mistake')
    )
  )

  const form = keepForm()
  if (form) root.append(form)

  if (said) root.append(el('p', { class: 'muted', role: 'status' }, said))
}

/*
 * Only while this view is actually open.
 *
 * A timer reading the session every few seconds behind a hidden panel is a timer spending somebody's battery to
 * update nothing.
 */
function watch() {
  const view = document.getElementById('view-student')
  const open = view && !view.hasAttribute('hidden')
  if (open && !timer) {
    void load()
    timer = setInterval(() => void load(), 5000)
  }
  if (!open && timer) {
    clearInterval(timer)
    timer = null
  }
}

if (root) {
  const view = document.getElementById('view-student')
  if (view) {
    new MutationObserver(watch).observe(view, { attributes: true, attributeFilter: ['hidden'] })
  }
  watch()
  window.addEventListener('beforeunload', () => {
    if (timer) clearInterval(timer)
  })
}
