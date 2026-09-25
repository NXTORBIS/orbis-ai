// The Orbis rail: the panel's one navigation.
//
// What was here before was an inventory -- twenty-six rows in five groups, with the machinery to pin, hide, reorder and
// regroup them, because twenty-six rows in a column need managing. The Command Center made that arrangement redundant
// and, worse, doubled: the same features listed twice, in two places, each needing to be kept in step with the other.
//
// So this is the whole navigation now. Nine categories and a home, read from the capability registry, so it is not a
// list anybody maintains by hand. Everything the old rail could reach is still reachable -- through the category it
// belongs to, which is one step rather than a hunt down a column.
//
// At rest it is icons; reach for it and it gives you the words.

import './rail/index.js'
import { CATEGORIES } from './command-registry.js'
import { icon } from './rail/icons.js'

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }

/** Where the rail is pointing: 'home' for the Command Center, otherwise a category id. */
let here = 'home'
let onPick = () => {}

/** Marks the row the panel is actually showing. Called after every move, from either side. */
function markCurrent() {
  for (const button of document.querySelectorAll('.nav-item')) {
    button.setAttribute('aria-current', String(button.dataset.nav === here))
  }
}

function item(id, label, iconName, hint) {
  const b = el('button', 'nav-item')
  b.type = 'button'
  b.dataset.nav = id
  b.title = hint ? `${label} — ${hint}` : label
  b.setAttribute('aria-label', label)
  b.append(icon(iconName, 19), el('span', 'nav-label', label))
  b.addEventListener('click', () => {
    here = id
    markCurrent()
    onPick(id)
  })
  return b
}

/**
 * Draws the rail. `pickCategory` is called with 'home' or a category id; the Command Center does the rest, because the
 * rail's job is to say where to go, not to know what is there.
 */
export function mountRail(root, pickCategory) {
  onPick = pickCategory
  root.replaceChildren()
  root.classList.add('nav')

  const logo = el('img', 'nav-mark')
  logo.src = 'orbis-ring.png'
  logo.alt = 'Orbis'
  logo.width = 24
  logo.height = 24
  root.append(el('div', 'nav-top')).lastElementChild?.append(logo)

  const list = el('nav', 'nav-list')
  list.setAttribute('aria-label', 'Orbis')
  list.append(item('home', 'Command Center', 'panelIcons', 'Everything Orbis can do'))
  list.append(el('div', 'nav-rule'))
  for (const category of CATEGORIES) list.append(item(category.id, category.label, category.icon, category.blurb))
  root.append(list)

  const foot = el('div', 'nav-foot')
  const state = el('p', 'nav-state')
  state.id = 'nav-state'
  foot.append(state)
  root.append(foot)

  markCurrent()
  return {
    /** Moves the mark without calling back, for when something else changed the view. */
    pointAt: (id) => { here = id; markCurrent() },
    /** One short line at the foot: how Orbis is, right now. Empty when there is nothing worth saying. */
    say: (text) => { const n = document.getElementById('nav-state'); if (n) n.textContent = text || '' }
  }
}
