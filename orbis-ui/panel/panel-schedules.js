import { call } from './helper.js'

/**
 * Schedules, in the Orbis panel.
 *
 * Things Orbis does at a time somebody chose, seen and made from the browser rather than only from the chat window.
 * The same store on both sides: the helper hands this the app's own schedules, so what is listed here is what is
 * listed there, and pausing one here pauses it everywhere.
 *
 * ## What it will not do
 *
 * **It never shows an empty list when it does not know.** All of this needs the Orbis window's store, and when that
 * is not running this says so -- an empty list reads as "you have no schedules", which is a lie somebody would only
 * discover when a reminder never arrived.
 *
 * **It never switches on keeping Orbis running, or waking the computer.** Those are decisions made in Settings with
 * the wording in front of the person. A page in a browser changing how a computer behaves is not offered here.
 *
 * **Text from a schedule goes on screen as text.** Never as markup: a name can contain anything somebody typed.
 */

const root = document.getElementById('schedules')

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

let jobs = []
let coming = []
let problem = ''
let reading = null
let phrase = ''
let ready = false
let timer = null

async function run(channel, args) {
  problem = ''
  try {
    return await call(channel, args)
  } catch (err) {
    // Orbis not running is a different thing from nothing scheduled, and saying which is the whole point.
    problem = err?.message || 'That did not work.'
    return null
  }
}

/** A moment, as somebody would say it. */
const when = (at) => {
  if (at === null || at === undefined) return 'nothing more due'
  const gap = at - Date.now()
  if (gap < 0) return 'due now'
  const minutes = Math.round(gap / 60000)
  if (minutes < 1) return 'in under a minute'
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
  const date = new Date(at)
  const clock = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `at ${clock}, in ${hours} hour${hours === 1 ? '' : 's'}`
  return `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} at ${clock}`
}

/** What a state means, in words rather than in the word the code uses. */
const stateText = (job) => {
  switch (job.state) {
    case 'scheduled':
      return { text: when(job.nextRunAt), tone: 'ok' }
    case 'ready':
    case 'running':
      return { text: 'running now', tone: 'ok' }
    case 'retrying':
      return { text: 'it did not work — trying again', tone: 'wait' }
    case 'waitingForDevice':
      return { text: 'waiting for the browser', tone: 'wait' }
    case 'waitingForCondition':
      return { text: 'waiting for the conditions you set', tone: 'wait' }
    case 'blocked':
      return { text: 'needs you — what it opens is gone, or a key is missing', tone: 'bad' }
    case 'completed':
      return { text: 'done', tone: 'ok' }
    case 'failed':
      return { text: 'it did not work', tone: 'bad' }
    case 'missed':
      return { text: 'its moment passed', tone: 'bad' }
    case 'paused':
      return { text: 'paused', tone: 'wait' }
    default:
      return { text: job.state, tone: 'wait' }
  }
}

const EXAMPLES = [
  'remind me to stretch every hour',
  'open news.ycombinator.com every weekday at 8am',
  'refresh status.example every 30 minutes'
]

async function load() {
  const listed = await run('schedules:list', [{}])
  jobs = listed?.jobs ?? []
  const soon = await run('schedules:upcoming', [{ days: 7 }])
  coming = soon?.upcoming ?? []
  ready = true
  draw()
}

async function readPhrase() {
  reading = null
  if (phrase.trim().length < 6) {
    draw()
    return
  }
  const answer = await run('schedules:read', [{ phrase: phrase.trim() }])
  reading = answer ?? null
  draw()
}

async function keep() {
  if (!reading || reading.ok === false) return
  const kept = await run('schedules:add', [{ phrase: phrase.trim() }])
  if (!kept) {
    draw()
    return
  }
  if (kept.ok === false) {
    problem = (kept.problems && kept.problems[0]) || kept.why || 'Orbis could not keep that.'
    draw()
    return
  }
  phrase = ''
  reading = null
  await load()
}

function drawSay() {
  const input = el('input', {
    class: 'o-input',
    value: phrase,
    placeholder: 'Say when, and what',
    'aria-label': 'What Orbis should do, and when',
    oninput: (event) => {
      phrase = event.target.value
      // Read as it is typed, but not on every keystroke: a half-written sentence is refused for the wrong reason.
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void readPhrase(), 350)
    },
    onkeydown: (event) => {
      if (event.key === 'Enter') void keep()
    }
  })

  const rows = [
    el('div', { class: 'schedp-say' }, input, el('button', { class: 'o-btn primary', onclick: () => void keep() }, 'Keep this'))
  ]

  if (!phrase) {
    rows.push(
      el(
        'div',
        { class: 'schedp-hints' },
        ...EXAMPLES.map((example) =>
          el(
            'button',
            {
              class: 'o-btn small',
              onclick: () => {
                phrase = example
                void readPhrase()
              }
            },
            example
          )
        )
      )
    )
  }

  // What Orbis understood, before anything is kept. A refusal shows why rather than leaving an unusable box.
  if (reading && reading.ok === false) {
    rows.push(el('p', { class: 'schedp-read bad' }, reading.why || 'Orbis did not understand that.'))
  } else if (reading && reading.ok) {
    rows.push(
      el(
        'p',
        { class: 'schedp-read good' },
        reading.assumedTime ? `${reading.said} — no time was given, so Orbis chose one.` : reading.said
      )
    )
  }

  return rows
}

function drawJob(job) {
  const state = stateText(job)
  const paused = job.state === 'paused'
  return el(
    'li',
    { class: `schedp-row tone-${state.tone}` },
    el('div', { class: 'schedp-main' }, el('span', { class: 'schedp-name' }, job.name), el('span', { class: 'schedp-state' }, state.text)),
    el(
      'div',
      { class: 'schedp-tools' },
      el(
        'button',
        {
          class: 'o-btn small',
          'aria-label': `${paused ? 'Resume' : 'Pause'} ${job.name}`,
          onclick: async () => {
            await run(paused ? 'schedules:resume' : 'schedules:pause', [{ jobId: job.jobId, until: null }])
            await load()
          }
        },
        paused ? 'Resume' : 'Pause'
      ),
      el(
        'button',
        {
          class: 'o-btn small danger',
          'aria-label': `Delete ${job.name}`,
          onclick: async () => {
            await run('schedules:remove', [{ jobId: job.jobId }])
            await load()
          }
        },
        'Delete'
      )
    )
  )
}

function draw() {
  if (!root) return
  const live = jobs.filter((job) => job.state !== 'cancelled')

  const parts = [
    /*
     * Said once, at the top, rather than in small print.
     *
     * Somebody who thinks a reminder will arrive with the machine shut only finds out otherwise after the moment has
     * gone, and that is not recoverable.
     */
    el(
      'p',
      { class: 'schedp-truth' },
      'These run on this computer, with Orbis open. If it is closed when one is due, Orbis does it the next time you open it and says how late it was.'
    ),
    ...drawSay()
  ]

  if (problem) parts.push(el('p', { class: 'o-state' }, problem))
  else if (ready && live.length === 0) parts.push(el('p', { class: 'o-state' }, 'Nothing is scheduled yet.'))

  if (live.length > 0) parts.push(el('ul', { class: 'schedp-list' }, ...live.map(drawJob)))

  if (coming.length > 0) {
    parts.push(
      el('h3', { class: 'schedp-heading' }, 'The next seven days'),
      el(
        'ol',
        { class: 'schedp-coming' },
        ...coming.slice(0, 12).map((one) =>
          el(
            'li',
            { class: one.paused ? 'paused' : '' },
            el(
              'span',
              { class: 'schedp-when' },
              new Date(one.at).toLocaleString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit'
              })
            ),
            el('span', { class: 'schedp-coming-name' }, one.name),
            one.resolution === 'skipped'
              ? el('span', { class: 'schedp-tag' }, 'clocks go forward')
              : one.resolution === 'ambiguous'
                ? el('span', { class: 'schedp-tag' }, 'clocks go back')
                : null
          )
        )
      )
    )
  }

  root.replaceChildren(...parts)

  // Focus is left alone on a redraw: stealing it while somebody is typing in a tab is worse than a lost caret here.
}

if (root) {
  draw()
  void load()
  // Reloaded when the view is shown again, because a schedule may have run or been changed from the other side.
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').replace(/^#\/?/, '').toLowerCase() === 'schedules') void load()
  })
}
