import { call, HelperDown } from './helper.js'

/**
 * Who you are, in the browser.
 *
 * Orbis has no account and nothing to sign in to: no Google account, no Chromium account, no Orbis account. What this
 * shows is the name the person typed into the app, read from the same settings the Orbis window reads, so one person is
 * named the same way on both sides.
 *
 * That is the whole of it, and the wording says so. Nothing here claims a session, a sync, or a signed-in state, because
 * none of those exist. A panel that said "Signed in" over a local display name would be lying about the one thing this
 * view is for.
 */

const $ = (id) => document.getElementById(id)
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const button = (className, text, onClick) => {
  const b = el('button', className, text)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

let state = { phase: 'loading' }

async function read() {
  try {
    const who = await call('identity:get')
    if (!who || !String(who.name || '').trim()) return { phase: 'nameless' }
    return { phase: 'known', name: String(who.name).trim(), title: String(who.title || '').trim() }
  } catch (err) {
    // Orbis not running is a different thing from Orbis failing, and the person can act on the first.
    if (err instanceof HelperDown) return { phase: 'away' }
    return { phase: 'error' }
  }
}

/** The first letter of the name. Never a stock avatar standing in for a person who has no picture. */
function mark(name) {
  const box = el('div', 'acct-avatar')
  box.textContent = (name || '?').trim().charAt(0).toUpperCase()
  return box
}

const row = (label, value) => {
  const r = el('div', 'acct-row')
  r.append(el('span', 'acct-label', label), el('span', 'acct-value', value))
  return r
}

function draw() {
  const body = $('account-body')
  if (!body) return
  const parts = [el('h2', 'acct-title', 'You')]

  if (state.phase === 'loading') {
    parts.push(el('p', 'acct-note', 'Checking…'))
  } else if (state.phase === 'away') {
    parts.push(mark(null))
    parts.push(el('p', 'acct-lead', 'Orbis is not running'))
    parts.push(el('p', 'acct-note', 'Your name is kept by the Orbis app. Start it to see it here.'))
    parts.push(button('acct-go secondary', 'Try again', () => void refresh()))
  } else if (state.phase === 'error') {
    parts.push(el('p', 'acct-note error', 'Your name could not be read.'))
    parts.push(button('acct-go secondary', 'Try again', () => void refresh()))
  } else if (state.phase === 'nameless') {
    parts.push(mark(null))
    parts.push(el('p', 'acct-lead', 'No name yet'))
    parts.push(el('p', 'acct-note', 'Set a name in Orbis and it will be used here too.'))
  } else {
    parts.push(mark(state.name))
    parts.push(el('p', 'acct-lead', state.name))
    if (state.title) parts.push(el('p', 'acct-email', state.title))
    parts.push(row('Kept', 'On this computer'))
    parts.push(
      el(
        'p',
        'acct-note',
        'Orbis has no account. There is nothing to sign in to and nothing to sign out of: your name, your chats and your ' +
          'browsing stay on this computer. Change the name in Orbis and it changes here.'
      )
    )
  }

  body.replaceChildren(...parts)
}

async function refresh() {
  state = await read()
  draw()
}

export function showAccount() {
  void refresh()
}

document.addEventListener('orbis:account-shown', () => showAccount())
void refresh()

/*
 * And once, now, if this is the view the panel opened at.
 *
 * The event above is dispatched by `showTab`, which runs as the page loads for whichever view the address names --
 * before this module has been evaluated, so there is nobody listening yet. Without this, landing straight on
 * #account drew the frame and nothing in it, and going to another view and back filled it in: a fault that only
 * shows itself to somebody who opens the address directly and does not look twice.
 */
{
  const here = document.getElementById('view-account')
  if (here && !here.hidden) showAccount()
}
