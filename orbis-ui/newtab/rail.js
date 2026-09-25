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
