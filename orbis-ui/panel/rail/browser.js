// Tabs, Tab groups, Media and Controls: the browser's own tabs and page, through the helper's browser:* channels (the Browser Control
// Layer, the same verbs Orion uses). What is shown is what the browser reports right now; while the view is on screen it is
// re-read every two seconds, and not at all while it is hidden or the page is not visible.
import { el, fill, icon, iconButton, labelButton, host, ask, state, favicon, registerView, poller } from './ui.js'
import { askBrowser, call } from '../helper.js'

const POLL_MS = 2000
export const GROUP_COLORS = { grey: '#9aa0a6', blue: '#5b9cf5', red: '#f2696b', yellow: '#e6b800', green: '#3fb56b', pink: '#f06db8', purple: '#a878f0', cyan: '#2cb8d0', orange: '#f0913a' }
const swatch = (name) => GROUP_COLORS[name] ?? name ?? GROUP_COLORS.grey

/** The browser's tabs and groups as one state object every view here shares, refreshed by whichever view is on screen. */
const shared = { tabs: [], groups: [], note: '', error: '', loaded: false, signature: '', listeners: new Set() }

/**
 * The browser's own answer, when the helper has nobody behind it.
 *
 * `browser:tabs` goes to the helper, and from there through the app's control layer and the extension, so the Tabs view only
 * works while the Orbis app is running. chrome://orbis is a page of the browser itself and can ask it directly, which is the
 * same tab strip with no round trip and no app. The browser knows the strip but not everything the control layer can do to it,
 * so this is the fallback and not the first choice: a tab read this way can be shown and closed, and says so for the rest.
 */
let browserCanAnswer = typeof chrome !== 'undefined' && typeof chrome.send === 'function'
const NATIVE = 'native:'

async function readTabs() {
  const viaApp = await ask('browser:tabs')
  if (viaApp.ok || !browserCanAnswer) return viaApp
  try {
    const rows = await askBrowser('orbis.tabs.list')
    if (!Array.isArray(rows) || !rows.length) return viaApp
    return { ok: true, value: rows.map((t) => ({ ...t, id: `${NATIVE}${t.index}` })) }
  } catch {
    browserCanAnswer = false // An older build with no such handler: stop asking.
    return viaApp
  }
}

async function refresh() {
  const [tabs, groups] = await Promise.all([readTabs(), ask('browser:groups')])
  let signature
  if (!tabs.ok) {
    shared.error = tabs.message
    signature = `e:${tabs.message}`
  } else {
    shared.error = ''
    shared.tabs = Array.isArray(tabs.value) ? tabs.value : []
    shared.groups = groups.ok && Array.isArray(groups.value) ? groups.value : []
    signature = JSON.stringify([shared.tabs, shared.groups])
  }
  shared.loaded = true
  // Redraw only when something changed, so a poll never steals focus or an open text box.
  if (signature !== shared.signature) {
    shared.signature = signature
    for (const fn of shared.listeners) fn()
  }
}

/** A tab the browser itself told us about: it can be shown and it can be closed, and the rest needs the app. */
async function actOnBrowserTab(action, args) {
  const index = Number(String(args.tabId).slice(NATIVE.length))
  const channel = action === 'activate' ? 'orbis.tabs.activate' : action === 'close' ? 'orbis.tabs.close' : null
  if (!channel) return { ok: false, message: 'Start Orbis to do that to a tab.' }
  try {
    await askBrowser(channel, index)
    return { ok: true }
  } catch {
    return { ok: false, message: 'That tab is no longer there.' }
  }
}

/** Does something in the browser, then re-reads. Returns the error text, or ''. */
async function act(action, args) {
  shared.note = ''
  const result = String(args?.tabId ?? '').startsWith(NATIVE) ? await actOnBrowserTab(action, args) : await ask('browser:do', [action, args])
  await refresh()
  shared.note = result.ok ? '' : result.message
  shared.signature = ''
  for (const fn of shared.listeners) fn()
  return shared.note
}

const tabTitle = (t) => t.title || (t.url ? host(t.url) : 'New tab')
const groupOf = (tab) => shared.groups.find((g) => Number(g.id) === Number(tab.groupId))

/** Keeps keyboard focus on the same control across a redraw (identified by data-key). */
function keepFocus(body, redraw) {
  const key = body.contains(document.activeElement) ? document.activeElement?.getAttribute?.('data-key') : null
  const typing = document.activeElement instanceof HTMLInputElement && body.contains(document.activeElement) && !document.activeElement.hasAttribute('data-key') ? { name: document.activeElement.name, value: document.activeElement.value, at: document.activeElement.selectionStart } : null
  redraw()
  if (key) body.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus()
  else if (typing?.name) {
    const again = body.querySelector(`input[name="${CSS.escape(typing.name)}"]`)
    if (again) {
      again.value = typing.value
      again.focus()
      again.setSelectionRange?.(typing.at, typing.at)
    }
  }
}

/** Arrow keys move between the rows' main buttons. */
function rowKeys(list) {
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const mains = [...list.querySelectorAll('.rv-main')]
    const at = mains.indexOf(document.activeElement)
    if (at < 0) return
    event.preventDefault()
    mains[Math.max(0, Math.min(mains.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  })
}

const filterBox = (value, placeholder, onInput) => {
  const input = el('input', { type: 'search', class: 'rv-filter', name: 'filter', 'aria-label': placeholder, placeholder, autocomplete: 'off', spellcheck: 'false' })
  input.value = value
  input.addEventListener('input', () => onInput(input.value))
  return input
}

// ---------------------------------------------------------------- Tabs

registerView('tabs', {
  title: 'Tabs',
  iconName: 'tabs',
  draw(body, ctx) {
    let query = ''
    let note = ''
    const selected = new Set()
    let groupName = ''
    // Two or three tabs, side by side: the pages are pinned to the comparison tray and compared from what they say.
    let compared = null
    let comparing = false
    // Frees the memory of tabs nobody is looking at. Never the tab in front, a pinned tab or one that is playing sound.
    const sleepBackground = async () => {
      const idle = shared.tabs.filter((t) => !t.active && !t.pinned && !t.audible && !t.discarded && /^https?:/i.test(t.url || ''))
      if (!idle.length) {
        note = 'No background tab is free to sleep.'
        return draw()
      }
      let slept = 0
      for (const t of idle) {
        const failed = await act('sleep', { tabId: t.id })
        if (!failed) slept++
      }
      note = slept ? `Put ${slept} tab${slept === 1 ? '' : 's'} to sleep.` : shared.note || 'The browser kept those tabs awake.'
      draw()
    }
    // Tabs of one site that are not in a group yet, grouped by that site: only where there are two or more of them.
    const groupBySite = async () => {
      const bySite = new Map()
      for (const t of shared.tabs) {
        if (groupOf(t) || t.pinned || !/^https?:/i.test(t.url || '')) continue
        const h = host(t.url)
        if (!bySite.has(h)) bySite.set(h, [])
        bySite.get(h).push(t.id)
      }
      let made = 0
      for (const [h, ids] of bySite) {
        if (ids.length < 2) continue
        const failed = await act('group-create', { tabIds: ids, name: h.slice(0, 40) })
        if (failed) break
        made++
      }
      note = made ? `Made ${made} group${made === 1 ? '' : 's'} by site.` : shared.note || 'No site has two or more ungrouped tabs.'
      draw()
    }
    const compareSelected = async () => {
      const chosen = shared.tabs.filter((t) => selected.has(t.id) && /^https?:/i.test(t.url || ''))
      if (chosen.length < 2 || chosen.length > 3) {
        note = 'Select two or three web pages to compare.'
        return draw()
      }
      comparing = true
      compared = null
      note = ''
      draw()
      try {
        await call('tray:clear', [])
        for (const t of chosen) await call('tray:add', [{ url: t.url, title: t.title || t.url, site: host(t.url), vertical: 'web' }])
        const out = await call('tray:compare', [])
        compared = { comparison: out.comparison, summary: out.summary || '' }
      } catch (err) {
        note = (err && err.message) || 'These could not be compared just now.'
      }
      comparing = false
      draw()
    }
    const comparedView = () => {
      if (comparing) return state('loading', 'Reading the pages and comparing them…')
      if (!compared) return null
      const { comparison, summary } = compared
      const cols = comparison.columns.filter((c) => c.filled > 0)
      if (!cols.length) return el('p', { class: 'rv-note' }, 'Nothing could be compared with confidence: no page said the same thing twice.')
      const table = el('table', { class: 'rv-compare' })
      table.append(el('thead', {}, el('tr', {}, el('th', {}, 'Page'), ...cols.map((c) => el('th', {}, c.label)))))
      table.append(
        el(
          'tbody',
          {},
          ...comparison.rows.map((r) =>
            el('tr', {}, el('th', { title: r.url }, r.title), ...cols.map((c) => el('td', { title: r.cells[c.key]?.quote || '' }, r.cells[c.key]?.value ?? '—')))
          )
        )
      )
      return el(
        'div',
        { class: 'rv-compared' },
        summary ? el('p', {}, summary) : null,
        table,
        comparison.unread.length ? el('p', { class: 'rv-note' }, `Could not read: ${comparison.unread.map((u) => u.title || u.url).join(', ')}`) : null,
        comparison.rejected ? el('p', { class: 'rv-note' }, `${comparison.rejected} value${comparison.rejected === 1 ? '' : 's'} left out because the page did not say it.`) : null
      )
    }

    const audioButton = (t) => {
      if (!t.audible && !t.muted) return null
      const label = t.muted ? `Unmute ${tabTitle(t)}` : `Mute ${tabTitle(t)}`
      return iconButton(t.muted ? 'mute' : 'volume', label, async () => void (note = await act('mute', { tabId: t.id, muted: !t.muted })), { class: t.audible ? 'live' : '' })
    }

    const draw = () => {
      const q = query.trim().toLowerCase()
      const shown = shared.tabs.filter((t) => !q || `${t.title} ${t.url}`.toLowerCase().includes(q))
      for (const id of [...selected]) if (!shared.tabs.some((t) => t.id === id)) selected.delete(id)
      const list = el('ul', { class: 'rv-list', 'aria-label': 'Open tabs' })
      shown.forEach((t) => {
        const g = groupOf(t)
        const position = shared.tabs.findIndex((x) => x.id === t.id)
        list.append(
          el(
            'li',
            { class: `rv-item${t.active ? ' on' : ''}`, ...(t.active ? { 'aria-current': 'true' } : {}) },
            el('input', { type: 'checkbox', class: 'rv-check', 'data-key': `sel-${t.id}`, 'aria-label': `Select ${tabTitle(t)}`, ...(selected.has(t.id) ? { checked: true } : {}), onchange: (e) => (e.target.checked ? selected.add(t.id) : selected.delete(t.id), draw()) }),
            el(
              'button',
              { type: 'button', class: 'rv-main', 'data-key': `open-${t.id}`, title: `${tabTitle(t)}\n${t.url}`, onclick: () => void act('activate', { tabId: t.id }) },
              favicon(t.url),
              el(
                'span',
                { class: 'rv-text' },
                el('b', {}, tabTitle(t)),
                el('small', {}, g ? el('span', { class: 'rv-chip', style: `--dot:${swatch(g.color)}` }, g.name || 'Group') : null, t.pinned ? 'Pinned · ' : '', t.loading ? 'Loading · ' : '', t.url ? host(t.url) : 'Empty tab')
              )
            ),
            audioButton(t),
            iconButton('pin', t.pinned ? `Unpin ${tabTitle(t)}` : `Pin ${tabTitle(t)}`, async () => void (note = await act('pin', { tabId: t.id, pinned: !t.pinned })), { pressed: t.pinned, class: t.pinned ? 'on' : '' }),
            iconButton('up', `Move ${tabTitle(t)} earlier`, async () => void (note = await act('move', { tabId: t.id, index: Math.max(0, position - 1) })), { disabled: position <= 0 || Boolean(q), class: 'secondary' }),
            iconButton('down', `Move ${tabTitle(t)} later`, async () => void (note = await act('move', { tabId: t.id, index: position + 1 })), { disabled: position >= shared.tabs.length - 1 || Boolean(q), class: 'secondary' }),
            iconButton('close', `Close ${tabTitle(t)}`, async () => void (note = await act('close', { tabId: t.id })))
          )
        )
      })
      rowKeys(list)
      const bar = selected.size
        ? el(
            'form',
            {
              class: 'rv-bar',
              onsubmit: async (e) => {
                e.preventDefault()
                const name = groupName.trim()
                if (!name) return
                note = await act('group-create', { tabIds: [...selected], name })
                if (!note) (selected.clear(), (groupName = ''))
                draw()
              }
            },
            el('span', {}, `${selected.size} selected`),
            (() => {
              const i = el('input', { type: 'text', name: 'groupname', class: 'rv-input', maxlength: '40', placeholder: 'Group name', 'aria-label': 'Name for the new group' })
              i.value = groupName
              i.addEventListener('input', () => (groupName = i.value))
              return i
            })(),
            labelButton('tabGroups', 'Group them', () => undefined, { class: 'primary' }),
            el('button', { type: 'button', class: 'labelbtn', onclick: () => void compareSelected(), ...(comparing ? { disabled: true } : {}) }, 'Compare'),
            iconButton('close', 'Clear the selection', () => (selected.clear(), draw()))
          )
        : null
      // The submit button above is a plain button in a form: make it submit.
      bar?.querySelector('.labelbtn.primary')?.setAttribute('type', 'submit')
      keepFocus(body, () =>
        fill(body, 
          el(
            'div',
            { class: 'rv-tools' },
            filterBox(query, `Search ${shared.tabs.length} tabs`, (v) => ((query = v), draw())),
            el('button', { type: 'button', class: 'labelbtn', title: 'Put tabs of the same site together in a group', onclick: () => void groupBySite() }, 'Group by site'),
            el('button', { type: 'button', class: 'labelbtn', title: 'Free the memory of tabs you are not looking at', onclick: () => void sleepBackground() }, 'Sleep background tabs')
          ),
          bar,
          comparedView(),
          shared.note ? el('p', { class: 'rv-note', role: 'alert' }, shared.note) : null,
          !shared.loaded ? state('loading', 'Reading the open tabs…') : shared.error ? state('error', shared.error) : shown.length ? list : state('empty', q ? 'No open tab matches that.' : 'No tabs are open.')
        )
      )
    }
    shared.listeners.add(() => ctx.active() && draw())
    ctx.onShow(() => draw())
    poller(ctx, refresh, POLL_MS)
    draw()
  }
})

// ---------------------------------------------------------------- Tab groups

registerView('tabGroups', {
  title: 'Tab groups',
  iconName: 'tabGroups',
  draw(body, ctx) {
    let note = ''
    let renaming = null
    let coloring = null
    let arming = null
    let newName = ''
    const picks = new Set()

    const draw = () => {
      for (const id of [...picks]) if (!shared.tabs.some((t) => t.id === id && Number(t.groupId) < 0)) picks.delete(id)
      const loose = shared.tabs.filter((t) => !groupOf(t))
      const create = el(
        'form',
        {
          class: 'rv-create',
          onsubmit: async (e) => {
            e.preventDefault()
            const name = newName.trim()
            if (!name || !picks.size) return
            note = await act('group-create', { tabIds: [...picks], name })
            if (!note) (picks.clear(), (newName = ''))
            draw()
          }
        },
        el('h3', {}, 'New group'),
        loose.length
          ? el(
              'ul',
              { class: 'rv-pick', 'aria-label': 'Tabs to put in the new group' },
              loose.slice(0, 60).map((t) => el('li', {}, el('label', {}, el('input', { type: 'checkbox', 'data-key': `pick-${t.id}`, ...(picks.has(t.id) ? { checked: true } : {}), onchange: (e) => (e.target.checked ? picks.add(t.id) : picks.delete(t.id), draw()) }), favicon(t.url), el('span', { class: 'rv-clip' }, tabTitle(t)))))
            )
          : el('p', { class: 'rv-muted' }, shared.loaded ? 'Every open tab is already in a group.' : 'Reading the open tabs…'),
        el('div', { class: 'rv-row' }, (() => {
          const i = el('input', { type: 'text', name: 'newgroup', class: 'rv-input', maxlength: '40', placeholder: 'Group name', 'aria-label': 'Name for the new group' })
          i.value = newName
          i.addEventListener('input', () => (newName = i.value))
          return i
        })(), labelButton('plus', picks.size ? `Create with ${picks.size}` : 'Create', () => undefined, { class: 'primary', disabled: !loose.length }))
      )
      create.querySelector('.rv-row .labelbtn')?.setAttribute('type', 'submit')

      const sections = shared.groups.map((g) => {
        const mine = shared.tabs.filter((t) => Number(t.groupId) === Number(g.id))
        const head = el('div', { class: 'rv-ghead', style: `--dot:${swatch(g.color)}` })
        if (renaming === g.id) {
          const i = el('input', { type: 'text', name: 'rename', class: 'rv-input', maxlength: '40', 'aria-label': `New name for ${g.name || 'the group'}` })
          i.value = g.name
          const done = async (save) => {
            const name = i.value.trim()
            renaming = null
            if (save && name && name !== g.name) note = await act('group-rename', { groupId: g.id, name })
            draw()
          }
          i.addEventListener('keydown', (e) => (e.key === 'Enter' ? void done(true) : e.key === 'Escape' ? void done(false) : undefined))
          i.addEventListener('blur', () => void done(true))
          head.append(el('span', { class: 'rv-dot', 'aria-hidden': 'true' }), i)
          queueMicrotask(() => (i.focus(), i.select()))
        } else {
          head.append(
            el('button', { type: 'button', class: 'rv-gname', 'data-key': `gname-${g.id}`, 'aria-expanded': String(!g.collapsed), title: g.collapsed ? 'Expand the group' : 'Collapse the group', onclick: async () => void (note = await act('group-collapse', { groupId: g.id, collapsed: !g.collapsed })) }, el('span', { class: 'rv-dot', 'aria-hidden': 'true' }), el('b', {}, g.name || 'Unnamed group'), el('small', {}, `${mine.length} tab${mine.length === 1 ? '' : 's'}${g.collapsed ? ' · collapsed' : ''}`)),
            iconButton('edit', `Rename ${g.name || 'the group'}`, () => ((renaming = g.id), draw())),
            iconButton('customize', `Colour of ${g.name || 'the group'}`, () => ((coloring = coloring === g.id ? null : g.id), draw()), { pressed: coloring === g.id }),
            iconButton(arming === g.id ? 'check' : 'trash', arming === g.id ? `Confirm: ungroup ${g.name || 'the group'} (its tabs stay open)` : `Ungroup ${g.name || 'the group'} (its tabs stay open)`, async () => {
              if (arming !== g.id) return void ((arming = g.id), draw())
              arming = null
              note = await act('group-delete', { groupId: g.id })
              draw()
            }, { class: arming === g.id ? 'danger' : '' })
          )
        }
        const swatches =
          coloring === g.id
            ? el('div', { class: 'rv-swatches', role: 'group', 'aria-label': `Colour of ${g.name || 'the group'}` }, Object.entries(GROUP_COLORS).map(([name, css]) => el('button', { type: 'button', class: `rv-sw${g.color === name ? ' on' : ''}`, style: `--dot:${css}`, 'aria-label': name, 'aria-pressed': String(g.color === name), title: name, onclick: async () => void ((coloring = null), (note = await act('group-rename', { groupId: g.id, name: g.name || 'Group', color: name }))) })))
            : null
        const members = g.collapsed
          ? null
          : el(
              'ul',
              { class: 'rv-list' },
              mine.map((t) => el('li', { class: `rv-item${t.active ? ' on' : ''}` }, el('button', { type: 'button', class: 'rv-main', 'data-key': `gopen-${t.id}`, title: t.url, onclick: () => void act('activate', { tabId: t.id }) }, favicon(t.url), el('span', { class: 'rv-text' }, el('b', {}, tabTitle(t)), el('small', {}, host(t.url) || 'Empty tab'))), iconButton('close', `Take ${tabTitle(t)} out of ${g.name || 'the group'}`, async () => void (note = await act('group-remove', { groupId: g.id, tabId: t.id })))))
            )
        const adder =
          !g.collapsed && loose.length
            ? (() => {
                const sel = el('select', { class: 'rv-input', 'aria-label': `Add a tab to ${g.name || 'the group'}` }, el('option', { value: '' }, 'Add a tab…'), loose.slice(0, 60).map((t) => el('option', { value: t.id }, tabTitle(t).slice(0, 60))))
                sel.addEventListener('change', async () => sel.value && void ((note = await act('group-add', { groupId: g.id, tabId: sel.value })), draw()))
                return sel
              })()
            : null
        return el('section', { class: 'rv-group' }, head, swatches, members, adder)
      })

      keepFocus(body, () =>
        fill(body, 
          shared.note ? el('p', { class: 'rv-note', role: 'alert' }, shared.note) : null,
          !shared.loaded ? state('loading', 'Reading the tab groups…') : shared.error ? state('error', shared.error) : null,
          !shared.error && shared.loaded ? (sections.length ? el('div', {}, sections) : state('empty', 'No tab groups yet. Pick tabs below and make the first one.')) : null,
          !shared.error && shared.loaded ? create : null
        )
      )
    }
    shared.listeners.add(() => ctx.active() && renaming === null && draw())
    ctx.onShow(() => draw())
    poller(ctx, refresh, POLL_MS)
    draw()
  }
})

// ---------------------------------------------------------------- Media

registerView('media', {
  title: 'Media',
  iconName: 'media',
  draw(body, ctx) {
    let note = ''
    const draw = () => {
      const playing = shared.tabs.filter((t) => t.audible || t.muted)
      const list = el(
        'ul',
        { class: 'rv-list', 'aria-label': 'Tabs making sound' },
        playing.map((t) =>
          el(
            'li',
            { class: 'rv-item' },
            el('button', { type: 'button', class: 'rv-main', 'data-key': `media-${t.id}`, title: 'Go to this tab', onclick: () => void act('activate', { tabId: t.id }) }, favicon(t.url), el('span', { class: 'rv-text' }, el('b', {}, tabTitle(t)), el('small', {}, `${host(t.url)} · ${t.muted ? 'Muted' : 'Playing'}`))),
            iconButton(t.muted ? 'mute' : 'volume', t.muted ? `Unmute ${tabTitle(t)}` : `Mute ${tabTitle(t)}`, async () => void (note = await act('mute', { tabId: t.id, muted: !t.muted })), { class: t.audible ? 'live' : '' })
          )
        )
      )
      rowKeys(list)
      keepFocus(body, () => fill(body, shared.note ? el('p', { class: 'rv-note', role: 'alert' }, shared.note) : null, !shared.loaded ? state('loading', 'Listening for tabs that make sound…') : shared.error ? state('error', shared.error) : playing.length ? list : state('empty', 'Nothing is playing. Tabs that make sound are listed here, with their controls.')))
    }
    shared.listeners.add(() => ctx.active() && draw())
    ctx.onShow(() => draw())
    poller(ctx, refresh, POLL_MS)
    draw()
  }
})

// ---------------------------------------------------------------- Downloads

/**
 * Find a download by what is inside it.
 *
 * Only finished downloads in the browser's own list are searched, and only plain-text files (notes, code, CSV, subtitles).
 * The answer says how many files could not be looked inside, so an empty result is not read as "nothing anywhere".
 */
registerView('downloads', {
  title: 'Downloads',
  iconName: 'downloads',
  draw(body) {
    let query = ''
    let result = null
    let busy = false
    let problem = ''
    const run = async () => {
      if (query.trim().length < 2 || busy) return
      busy = true
      problem = ''
      draw()
      try {
        result = await call('downloads:search', [query.trim()])
      } catch (err) {
        result = null
        problem = (err && err.message) || 'The downloads could not be searched.'
      }
      busy = false
      draw()
    }
    const draw = () => {
      const box = el('input', { type: 'search', name: 'dlquery', class: 'rv-input', placeholder: 'Words inside a downloaded file…', 'aria-label': 'Search inside downloaded files', maxlength: '200' })
      box.value = query
      box.addEventListener('input', () => (query = box.value))
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void run()
      })
      const form = el('div', { class: 'rv-tools' }, box, el('button', { type: 'button', class: 'labelbtn primary', ...(busy ? { disabled: true } : {}), onclick: () => void run() }, busy ? 'Searching…' : 'Search'))
      let content
      if (problem) content = state('error', problem)
      else if (busy) content = state('loading', 'Reading your downloaded files…')
      else if (!result) content = state('empty', 'Type a few words and press Search. Finished downloads that are plain text are looked through.')
      else if (!result.hits.length) content = state('empty', `Nothing matched "${result.query}" in ${result.searched} file${result.searched === 1 ? '' : 's'}.`)
      else {
        const list = el('ul', { class: 'rv-list', 'aria-label': 'Matching downloads' })
        for (const hit of result.hits) {
          list.append(
            el(
              'li',
              { class: 'rv-item' },
              el(
                'span',
                { class: 'rv-text' },
                el('b', {}, hit.name),
                el('small', {}, hit.kind === 'content' ? `Line ${hit.line}: ${hit.snippet}` : 'Matched by file name'),
                el('small', { title: hit.path }, hit.path)
              ),
              iconButton('copy', `Copy the location of ${hit.name}`, () => void navigator.clipboard?.writeText(hit.path))
            )
          )
        }
        content = list
      }
      const notes = []
      if (result && !busy) {
        if (result.skipped) notes.push(`${result.skipped} file${result.skipped === 1 ? '' : 's'} could not be looked inside (not plain text, or too large).`)
        if (result.missing) notes.push(`${result.missing} download${result.missing === 1 ? ' is' : 's are'} no longer on this computer.`)
        if (result.truncated) notes.push('Only the first matches are shown. Narrow the words to see others.')
      }
      keepFocus(body, () => fill(body, form, content, ...notes.map((n) => el('p', { class: 'rv-note' }, n))))
    }
    draw()
  }
})

// ---------------------------------------------------------------- Controls

registerView('controls', {
  title: 'Controls',
  iconName: 'controls',
  draw(body, ctx) {
    const info = { nav: null, zoom: null, error: '', note: '' }
    let address = ''
    const load = async () => {
      const [nav, zoom] = await Promise.all([ask('browser:do', ['nav-info', {}]), ask('browser:do', ['zoom-get', {}])])
      info.error = nav.ok ? '' : nav.message
      info.nav = nav.ok ? nav.value : null
      info.zoom = zoom.ok ? zoom.value?.factor : null
      draw()
    }
    const run = async (action, args = {}) => {
      const result = await ask('browser:do', [action, args])
      info.note = result.ok ? '' : result.message
      await load()
    }
    function draw() {
      const percent = typeof info.zoom === 'number' ? `${Math.round(info.zoom * 100)}%` : '—'
      const nav = info.nav
      const form = el(
        'form',
        {
          class: 'rv-row',
          onsubmit: async (e) => {
            e.preventDefault()
            const url = address.trim()
            if (!url) return
            const result = await ask('browser:do', ['open', { url }])
            info.note = result.ok ? '' : result.message
            if (result.ok) address = ''
            await load()
          }
        },
        (() => {
          const i = el('input', { type: 'text', name: 'address', class: 'rv-input grow', 'aria-label': 'Web address to open in a new tab', placeholder: 'Open a web address in a new tab', autocomplete: 'off', spellcheck: 'false' })
          i.value = address
          i.addEventListener('input', () => (address = i.value))
          return i
        })(),
        labelButton('plus', 'Open', () => undefined, { class: 'primary' })
      )
      form.querySelector('.labelbtn')?.setAttribute('type', 'submit')
      keepFocus(body, () =>
        fill(body, 
          info.error ? state('error', info.error) : null,
          nav ? el('p', { class: 'rv-page', title: nav.url }, el('b', {}, nav.title || host(nav.url) || 'This tab'), el('small', {}, nav.url ? host(nav.url) : '')) : !info.error ? state('loading', 'Reading the page in front…') : null,
          el('div', { class: 'rv-group', role: 'group', 'aria-label': 'Navigation' }, el('h3', {}, 'Navigation'), el('div', { class: 'rv-row' }, labelButton('back', 'Back', () => void run('back'), { disabled: !nav || !nav.canGoBack }), labelButton('forward', 'Forward', () => void run('forward'), { disabled: !nav || !nav.canGoForward }), nav?.loading ? labelButton('stop', 'Stop', () => void run('stop')) : labelButton('reload', 'Reload', () => void run('reload'), { disabled: !nav }))),
          el('div', { class: 'rv-group', role: 'group', 'aria-label': 'Zoom' }, el('h3', {}, 'Zoom'), el('div', { class: 'rv-row' }, iconButton('zoomOut', 'Zoom out', () => void run('zoom', { action: 'out' })), el('output', { class: 'rv-zoom', 'aria-live': 'polite', 'aria-label': 'Current zoom' }, percent), iconButton('zoomIn', 'Zoom in', () => void run('zoom', { action: 'in' })), labelButton('reload', 'Reset', () => void run('zoom', { action: 'reset' }), { title: 'Back to 100%' }))),
          el('div', { class: 'rv-group', role: 'group', 'aria-label': 'Open a page' }, el('h3', {}, 'Open a page'), form),
          info.note ? el('p', { class: 'rv-note', role: 'alert' }, info.note) : null
        )
      )
    }
    ctx.onShow(() => void load())
    draw()
  }
})

export { icon }
