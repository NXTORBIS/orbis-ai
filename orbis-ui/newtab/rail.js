// The Orbis rail down the left of the new tab page: every Orbis feature, one click away, in the margin that was empty.
//
// It is the same set the panel holds and the same icons it draws (orbis-icons.js, shared rather than copied), so a
// feature is named the same thing wherever somebody meets it. Each one opens its own address — chrome://orbis/#notes and
// the rest — which means these are ordinary links: middle-click opens one in a new tab, and the browser's back button
// works afterwards, neither of which is true of a button that swaps a panel underneath you.
//
// The rail is the person's to hide (Customize → Show the Orbis rail); it is not the only way to any of these.

import { icon } from './orbis-icons.js'

/** The Orbis panel's own views, in the order the panel lists them. `icon` names an icon in orbis-icons.js. */
export const RAIL = [
  { view: 'ask', label: 'Ask Orion', icon: 'orion' },
  { view: 'search', label: 'Search', icon: 'search' },
  { view: 'galaxy', label: 'Galaxy', icon: 'galaxy' },
  { view: 'workflows', label: 'Workflows', icon: 'workflows' },
  { view: 'notes', label: 'Notes', icon: 'notes' },
  { view: 'tasks', label: 'Tasks', icon: 'tasks' },
  { view: 'block', label: 'Ad blocking', icon: 'adblock' },
  { view: 'music', label: 'Music', icon: 'media' },
  { view: 'secrets', label: 'Secrets', icon: 'secrets' },
  { view: 'account', label: 'Account', icon: 'account' }
]

export const railAddress = (view) => `chrome://orbis/#${view}`

/** Draws the rail into `host`. Returns nothing; the rail has no state of its own to keep. */
export function mountRail(host, shown = true) {
  if (!host) return
  host.replaceChildren()
  host.hidden = !shown
  if (!shown) return
  for (const item of RAIL) {
    const a = document.createElement('a')
    a.className = 'rail-item'
    a.href = railAddress(item.view)
    // The name is the accessible name and the tooltip both: the icon beside it is decorative.
    a.title = item.label
    a.setAttribute('aria-label', item.label)
    a.append(icon(item.icon, 20))
    const label = document.createElement('span')
    label.className = 'rail-label'
    label.textContent = item.label
    a.append(label)
    host.append(a)
  }
}

/**
 * The Music entry under the search box.
 *
 * One line. When nothing is playing it says "Music"; when something is, it says what, and the same press opens Orbis
 * Music where it can be worked properly. It is here rather than in a file of its own because every page file has to
 * be registered in the browser, and this page already registers this one.
 *
 * Two rules: it is the same state as everywhere else (the name comes from the player, so this and the panel can never
 * disagree), and it never says anything it does not know -- with the Orbis window closed it says "Music" and opens
 * the panel, which explains properly, rather than showing a stopped player as though that were the answer.
 */
export async function mountMusicEntry(host, call) {
  if (!host) return
  const NS = 'http://www.w3.org/2000/svg'
  const glyph = (d, size = 18) => {
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))
    svg.setAttribute('fill', 'currentColor')
    svg.setAttribute('aria-hidden', 'true')
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', d)
    svg.append(p)
    return svg
  }
  const PATHS = {
    note: 'M9 3v11.3A3.5 3.5 0 1 0 11 17.5V8h6V3z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
    prev: 'M6 5h2v14H6zM20 5v14L9 12z',
    next: 'M16 5h2v14h-2zM4 5v14l11-7z'
  }
  const hue = (text) => [...String(text || '?')].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 11)
  const control = (name, label, onActivate, big) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'music-entry-btn' + (big ? ' big' : '')
    button.title = label
    button.setAttribute('aria-label', label)
    button.append(glyph(PATHS[name], big ? 20 : 16))
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      try {
        await onActivate()
      } catch {
        // Orbis is not there. The card still opens the panel, which says so properly.
      }
      void refresh()
    })
    return button
  }
  const draw = (state) => {
    const track = state && state.track
    const playing = Boolean(state && state.playback && state.playback.playing && track)
    const paused = Boolean(track && !playing)
    host.replaceChildren()
    host.classList.toggle('is-playing', playing)

    const open = document.createElement('a')
    open.className = 'music-entry-open'
    open.href = railAddress('music')
    open.title = 'Open Orbis Music'

    const art = document.createElement('span')
    art.className = 'music-entry-art'
    art.style.setProperty('--h', String(hue(track ? track.album + track.artist + track.title : 'orbis')))
    if (track) {
      art.textContent = (track.title || '?').trim().charAt(0).toUpperCase()
      if (playing) {
        const eq = document.createElement('span')
        eq.className = 'music-entry-eq'
        for (let i = 0; i < 4; i++) eq.append(document.createElement('i'))
        art.append(eq)
      }
    } else {
      art.append(glyph(PATHS.note, 20))
    }

    const text = document.createElement('span')
    text.className = 'music-entry-text'
    const title = document.createElement('span')
    title.className = 'music-entry-title'
    title.textContent = track ? track.title : 'Orbis Music'
    const sub = document.createElement('span')
    sub.className = 'music-entry-sub'
    sub.textContent = track ? (track.artist || 'Unknown artist') + (playing ? ' \u00b7 playing' : ' \u00b7 paused') : 'Your songs, playlists and what you are hearing'
    text.append(title, sub)
    open.append(art, text)
    host.append(open)

    if (playing || paused) {
      const controls = document.createElement('span')
      controls.className = 'music-entry-controls'
      controls.append(
        control('prev', 'Previous', () => call('music:previous')),
        control(playing ? 'pause' : 'play', playing ? 'Pause' : 'Play', () => call(playing ? 'music:pause' : 'music:resume'), true),
        control('next', 'Next', () => call('music:next'))
      )
      host.append(controls)
    } else {
      const go = document.createElement('span')
      go.className = 'music-entry-go'
      go.textContent = 'Open'
      host.append(go)
    }
    host.hidden = false
  }
  const refresh = async () => {
    try {
      draw(await call('music:state'))
    } catch {
      draw(null)
    }
  }
  await refresh()
  // Slow on purpose: this is a label, not a progress bar, and a new tab page should ask for almost nothing.
  const timer = window.setInterval(() => {
    if (!document.hidden) void refresh()
  }, 5000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh()
  })
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true })
}