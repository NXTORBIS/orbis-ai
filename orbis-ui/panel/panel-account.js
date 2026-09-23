import { askBrowser } from './helper.js'

/**
 * The browser account.
 *
 * This is the Chromium browser's own account and has nothing to do with the account Orbis Chat and Orion use. Signing in
 * here does not sign anyone into Chat; signing out here does not sign anyone out of it. They are separate identities
 * with separate stores, and the wording on screen says "browser account" everywhere so nobody has to guess which one
 * they are looking at.
 *
 * Everything shown is read from the browser at the moment it is drawn (orbis.signin.state, which reads Chromium's
 * IdentityManager). Nothing is cached and nothing is assumed, so this cannot show an account before Chromium has one —
 * including the state people actually hit, where a token has gone stale overnight and the account is signed in but
 * cannot act until it is renewed.
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

/** Whether this window is running inside the Orbis browser at all; outside it there is no browser account to show. */
const inBrowser = typeof chrome !== 'undefined' && typeof chrome.send === 'function'

let state = { phase: 'loading' }
let polling = null

async function read() {
  if (!inBrowser) return { phase: 'unavailable' }
  try {
    const s = await askBrowser('orbis.signin.state')
    if (!s || !s.available) return { phase: 'unavailable' }
    if (!s.signedIn) return { phase: 'signedOut' }
    if (s.needsReauth) return { phase: 'reauth', account: s }
    return { phase: 'signedIn', account: s }
  } catch {
    return { phase: 'error', message: 'The browser could not be asked about its account.' }
  }
}

/** The account picture, or the first letter of the name as a stand-in. Never a stock avatar pretending to be somebody. */
function avatar(account) {
  const box = el('div', 'acct-avatar')
  const initial = (account?.name || account?.email || '?').trim().charAt(0).toUpperCase()
  box.textContent = initial
  const url = account?.avatarUrl
  if (url && /^https:\/\//i.test(url)) {
    const img = document.createElement('img')
    img.alt = ''
    img.referrerPolicy = 'no-referrer'
    img.addEventListener('load', () => {
      box.textContent = ''
      box.append(img)
      box.classList.add('has-photo')
    })
    // A picture that will not load leaves the letter in place rather than a broken frame.
    img.src = url
  }
  return box
}

const row = (label, value, tone) => {
  const r = el('div', `acct-row${tone ? ` ${tone}` : ''}`)
  r.append(el('span', 'acct-label', label), el('span', 'acct-value', value))
  return r
}

function draw() {
  const body = $('account-body')
  if (!body) return
  const parts = []

  parts.push(el('h2', 'acct-title', 'Browser account'))

  if (state.phase === 'loading') {
    parts.push(el('p', 'acct-note', 'Checking…'))
  } else if (state.phase === 'unavailable') {
    parts.push(avatar(null))
    parts.push(el('p', 'acct-note', 'The browser account is only available inside the Orbis browser.'))
  } else if (state.phase === 'error') {
    parts.push(el('p', 'acct-note error', state.message))
    parts.push(button('acct-go secondary', 'Try again', () => void refresh()))
  } else if (state.phase === 'signedOut') {
    parts.push(avatar(null))
    parts.push(el('p', 'acct-lead', 'Sign in to your browser'))
    parts.push(el('p', 'acct-note', 'This signs in the browser only. Orbis Chat and Orion are a separate account and are not touched.'))
    parts.push(button('acct-go', 'Continue with Google', () => void start()))
  } else if (state.phase === 'connecting') {
    parts.push(avatar(null))
    parts.push(el('p', 'acct-lead', 'Connecting…'))
    parts.push(el('p', 'acct-note', 'Finish signing in on the page the browser opened. This panel updates when the browser has the account.'))
    parts.push(button('acct-go secondary', 'Cancel', () => void cancel()))
  } else if (state.phase === 'reauth') {
    parts.push(avatar(state.account))
    parts.push(el('p', 'acct-lead', state.account.email || 'Your browser account'))
    parts.push(el('p', 'acct-note', 'This account needs you to sign in again before the browser can use it.'))
    parts.push(button('acct-go', 'Sign in again', () => void start()))
    parts.push(button('acct-go secondary', 'Sign out of the browser', () => void signOut()))
  } else if (state.phase === 'signedIn') {
    const a = state.account
    parts.push(avatar(a))
    if (a.name) parts.push(el('p', 'acct-lead', a.name))
    if (a.email) parts.push(el('p', 'acct-email', a.email))
    parts.push(row('Browser', 'Signed in', 'good'))
    // Sync is a second consent in Chromium, not a consequence of signing in, so it is reported on its own terms.
    parts.push(row('Sync', a.syncing ? 'On' : 'Off', a.syncing ? 'good' : ''))
    parts.push(button('acct-go secondary', 'Browser settings', () => void openSettings()))
    parts.push(button('acct-go danger', 'Sign out of the browser', () => void signOut()))
    parts.push(el('p', 'acct-note', 'Signing out here leaves Orbis Chat and Orion signed in.'))
  }

  body.replaceChildren(...parts)
}

async function refresh() {
  state = await read()
  draw()
}

async function start() {
  state = { phase: 'connecting' }
  draw()
  try {
    await askBrowser('orbis.signin.start')
  } catch {
    state = { phase: 'error', message: 'The browser could not open sign-in.' }
    return draw()
  }
  // The browser opened its own sign-in. Nothing here knows whether it worked, so the account is read back until it
  // changes rather than assumed: this is the whole of why the panel never shows an account that does not exist.
  watch()
}

function cancel() {
  stopWatching()
  void refresh()
}

function watch() {
  stopWatching()
  let tries = 0
  polling = window.setInterval(async () => {
    tries++
    const next = await read()
    if (next.phase === 'signedIn' || next.phase === 'reauth') {
      stopWatching()
      state = next
      draw()
      // The one moment worth marking: an account that was not there is now there.
      $('account-body')?.classList.add('arrived')
      window.setTimeout(() => $('account-body')?.classList.remove('arrived'), 900)
    } else if (tries > 300) {
      // Five minutes without an account: stop asking rather than poll a window that was closed long ago.
      stopWatching()
      void refresh()
    }
  }, 1000)
}

function stopWatching() {
  if (polling) window.clearInterval(polling)
  polling = null
}

async function signOut() {
  try {
    await askBrowser('orbis.signin.signOut')
  } catch {
    // Refused, or nothing to sign out of: the state below says which.
  }
  await refresh()
}

async function openSettings() {
  try {
    await askBrowser('orbis.tabs.list')
  } catch {
    // Nothing: the settings link is a convenience, not a promise.
  }
}

export function showAccount() {
  void refresh()
}

document.addEventListener('orbis:account-shown', () => showAccount())
// Reading it once at start keeps the button honest before anyone opens the panel.
if (inBrowser) void refresh()
