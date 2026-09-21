// The rail's rows that keep things: Saved pages, Screenshots, Reminders, Clipboard, Whiteboard, Research, Sources and Workspaces.
// Each reads the app's real store through the helper. When a store is not there the view says so; nothing is ever drawn from made-up data.
import { el, fill, icon, iconButton, labelButton, host, when, ask, state, favicon, registerView, poller } from './ui.js'

/** Opens a web page in a new tab of the browser (through the control layer). Returns the error text, or ''. */
const openPage = async (url) => {
  const r = await ask('browser:do', ['open', { url }])
  return r.ok ? '' : r.message
}

const note = (text) => (text ? el('p', { class: 'rv-note', role: 'alert' }, text) : null)

/**
 * One list view: `load()` returns { ok, value } from the helper, `render(items, redraw, flash)` returns the list content, `empty` is the
 * sentence for an empty list. The view loads when shown, and again after any action that calls `redraw(true)`.
 */
function listView(id, title, iconName, { load, render, empty, loading, poll, head }) {
  registerView(id, {
    title,
    iconName,
    draw(body, ctx) {
      const model = { result: null, message: '', busy: false, query: '' }
      const flash = (text) => {
        model.message = text || ''
        paint()
      }
      async function reload() {
        model.result = await load(model)
        paint()
      }
      function paint() {
        const active = document.activeElement
        const key = body.contains(active) ? active.getAttribute?.('data-key') : null
        const typing = active instanceof HTMLInputElement && body.contains(active) && !active.hasAttribute('data-key') ? { name: active.name, value: active.value, at: active.selectionStart } : null
        const r = model.result
        fill(body, 
          head ? head(model, reload, flash) : null,
          note(model.message),
          !r ? state('loading', loading) : !r.ok ? state('error', r.message, labelButton('reload', 'Try again', () => void reload())) : Array.isArray(r.value) && !r.value.length && !r.keepEmpty ? state('empty', empty(model)) : render(r.value, reload, flash, model)
        )
        if (key) body.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus()
        else if (typing?.name) {
          const again = body.querySelector(`input[name="${CSS.escape(typing.name)}"]`)
          if (again) (again.focus(), again.setSelectionRange?.(typing.at, typing.at))
        }
      }
      ctx.onShow(() => void reload())
      if (poll) poller(ctx, reload, poll)
      paint()
    }
  })
}

const search = (model, placeholder, onChange) => {
  const i = el('input', { type: 'search', name: 'filter', class: 'rv-filter', 'aria-label': placeholder, placeholder, autocomplete: 'off', spellcheck: 'false' })
  i.value = model.query
  let timer = null
  i.addEventListener('input', () => {
    model.query = i.value
    clearTimeout(timer)
    timer = setTimeout(onChange, 200)
  })
  return el('div', { class: 'rv-tools' }, i)
}

/** A button that needs a second press to do something that cannot be undone. */
function confirmButton(iconName, label, doIt) {
  let armed = false
  const b = iconButton(iconName, label, () => {
    if (!armed) {
      armed = true
      b.classList.add('danger')
      b.setAttribute('aria-label', `Confirm: ${label}`)
      b.title = `Press again to confirm: ${label}`
      b.replaceChildren(icon('check', 15))
      setTimeout(() => {
        armed = false
        b.classList.remove('danger')
        b.setAttribute('aria-label', label)
        b.title = label
        b.replaceChildren(icon(iconName, 15))
      }, 4000)
      return
    }
    void doIt()
  })
  return b
}

// ---------------------------------------------------------------- Saved pages

listView('savedPages', 'Saved pages', 'savedPages', {
  loading: 'Reading the saved pages…',
  empty: () => 'No pages saved yet. Pages saved to this computer are listed here.',
  load: () => ask('library:saved-pages'),
  render: (pages, reload, flash) =>
    el(
      'ul',
      { class: 'rv-list', 'aria-label': 'Saved pages' },
      pages.map((p) =>
        el(
          'li',
          { class: 'rv-item' },
          el('button', { type: 'button', class: 'rv-main', 'data-key': `sp-${p.path}`, title: `Open the saved copy\n${p.path}`, onclick: async () => void flash((await ask('library:saved-page-open', [p.path])).message) }, icon('savedPages', 16), el('span', { class: 'rv-text' }, el('b', {}, p.title || host(p.url)), el('small', {}, `${host(p.url)} · ${when(p.savedAt)}`))),
          iconButton('external', `Open the original page of ${p.title || host(p.url)}`, async () => flash(await openPage(p.url))),
          iconButton('close', `Forget ${p.title || host(p.url)} here (the file stays where it is)`, async () => (await ask('library:saved-page-forget', [p.path]), void reload()))
        )
      )
    )
})

// ---------------------------------------------------------------- Screenshots

listView('screenshots', 'Screenshots', 'screenshots', {
  loading: 'Reading the pictures kept…',
  empty: () => 'No pictures kept yet. Pictures taken of pages are kept here.',
  load: () => ask('library:screenshots'),
  render: (shots, reload, flash) => {
    const view = el('div', { class: 'rv-shotview', role: 'dialog', 'aria-label': 'Picture', hidden: true }, el('img', { alt: '' }), iconButton('close', 'Close the picture', () => (view.hidden = true)))
    view.addEventListener('click', (e) => e.target === view && (view.hidden = true))
    view.addEventListener('keydown', (e) => e.key === 'Escape' && (view.hidden = true))
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer.unobserve(entry.target)
        const id = entry.target.getAttribute('data-shot')
        void ask('library:screenshot-image', [id]).then((r) => {
          if (r.ok && r.value) entry.target.replaceChildren(el('img', { src: r.value, alt: '', loading: 'lazy' }))
          else entry.target.replaceChildren(icon('alert', 18), el('small', {}, 'File missing'))
        })
      }
    })
    const grid = el(
      'div',
      { class: 'rv-shots' },
      shots.map((s) => {
        const thumb = el('span', { class: 'rv-thumb', 'data-shot': s.id }, icon('screenshots', 18))
        observer.observe(thumb)
        return el(
          'figure',
          { class: 'rv-shot' },
          el(
            'button',
            {
              type: 'button',
              class: 'rv-thumbbtn',
              'data-key': `shot-${s.id}`,
              title: s.title || s.url,
              'aria-label': `View the picture of ${s.title || host(s.url) || 'a page'}`,
              onclick: async () => {
                const r = await ask('library:screenshot-image', [s.id])
                if (r.ok && r.value) {
                  view.querySelector('img').src = r.value
                  view.querySelector('img').alt = s.title || 'A picture of a page'
                  view.hidden = false
                  view.querySelector('button').focus()
                } else flash('That picture is no longer on disk.')
              }
            },
            thumb
          ),
          el('figcaption', {}, el('span', { class: 'rv-clip' }, s.title || host(s.url) || 'Picture'), el('small', {}, `${when(s.at)}${s.width ? ` · ${s.width}×${s.height}` : ''}`), el('span', { class: 'rv-acts' }, s.url ? iconButton('external', `Open the page of ${s.title || host(s.url)}`, async () => flash(await openPage(s.url))) : null, confirmButton('trash', `Delete the picture of ${s.title || host(s.url) || 'a page'} and its file`, async () => (await ask('library:screenshot-remove', [s.id]), void reload()))))
        )
      })
    )
    return el('div', {}, grid, view)
  }
})

// ---------------------------------------------------------------- Reminders

const dtLocal = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

listView('reminders', 'Reminders', 'reminders', {
  loading: 'Reading the reminders…',
  empty: () => 'No reminders yet. A reminder is a task with a time on it; add one below.',
  load: async () => {
    const r = await ask('reminders:list')
    return r.ok ? { ...r, keepEmpty: true } : r
  },
  render: (items, reload, flash) => {
    let title = ''
    let due = dtLocal(Date.now() + 3_600_000)
    const form = el(
      'form',
      {
        class: 'rv-create',
        onsubmit: async (e) => {
          e.preventDefault()
          const at = new Date(due).getTime()
          if (!title.trim() || !Number.isFinite(at)) return flash('Give the reminder a name and a time.')
          const r = await ask('reminders:add', [title.trim(), at, true])
          if (!r.ok) return flash(r.message)
          title = ''
          await reload()
        }
      },
      el('h3', {}, 'New reminder'),
      (() => {
        const i = el('input', { type: 'text', name: 'title', class: 'rv-input', maxlength: '200', placeholder: 'Remind me to…', 'aria-label': 'What to be reminded of' })
        i.value = title
        i.addEventListener('input', () => (title = i.value))
        return i
      })(),
      el('div', { class: 'rv-row' }, (() => {
        const i = el('input', { type: 'datetime-local', name: 'due', class: 'rv-input grow', 'aria-label': 'When' })
        i.value = due
        i.addEventListener('input', () => (due = i.value))
        return i
      })(), labelButton('plus', 'Add', () => undefined, { class: 'primary' }))
    )
    form.querySelector('.labelbtn').setAttribute('type', 'submit')
    const list = items.length
      ? el(
          'ul',
          { class: 'rv-list', 'aria-label': 'Reminders' },
          items.map((r) => {
            const late = !r.done && r.due !== undefined && r.due < Date.now()
            return el(
              'li',
              { class: `rv-item${r.done ? ' done' : ''}` },
              el('input', { type: 'checkbox', class: 'rv-check', 'data-key': `rm-${r.id}`, 'aria-label': `${r.title}: done`, ...(r.done ? { checked: true } : {}), onchange: async (e) => (await ask('reminders:done', [r.id, e.target.checked]), void reload()) }),
              el('span', { class: 'rv-text' }, el('b', {}, r.title), el('small', { class: late ? 'late' : '' }, `${late ? 'Overdue · ' : ''}${new Date(r.due).toLocaleString(undefined, { dateStyle: 'medium', ...(r.hasTime ? { timeStyle: 'short' } : {}) })}`)),
              iconButton('trash', `Delete the reminder ${r.title}`, async () => (await ask('reminders:remove', [r.id]), void reload()))
            )
          })
        )
      : state('empty', 'No reminders yet. A reminder is a task with a time on it.')
    return el('div', {}, list, form)
  }
})

// ---------------------------------------------------------------- Clipboard

const KIND_LABEL = { text: 'Text', link: 'Links', image: 'Images', color: 'Colours', code: 'Code', pinned: 'Pinned' }
const revealed = new Map()

listView('clipboard', 'Clipboard', 'clipboard', {
  loading: 'Reading the clipboard history…',
  poll: 3000,
  empty: (m) => (m.query ? 'Nothing in the history matches that.' : 'Nothing has been copied yet. What you copy while Orbis is running is remembered here.'),
  load: async (m) => {
    const r = await ask('clipboard:list', [m.query, m.kind ?? 'all'])
    if (!r.ok) return r
    m.paused = r.value.paused
    m.skipped = r.value.lastSkipped
    return { ok: true, value: r.value.items }
  },
  head: (m, reload) => {
    const kind = el('select', { class: 'rv-input', name: 'kind', 'aria-label': 'Kind of entry' }, ['all', ...Object.keys(KIND_LABEL)].map((k) => el('option', { value: k, ...(k === (m.kind ?? 'all') ? { selected: true } : {}) }, k === 'all' ? 'Everything' : KIND_LABEL[k])))
    kind.addEventListener('change', () => ((m.kind = kind.value), void reload()))
    const tools = search(m, 'Search the clipboard history', () => void reload())
    tools.append(kind)
    return el('div', {}, tools, m.paused ? el('p', { class: 'rv-muted' }, 'Recording is paused.') : null, m.skipped ? el('p', { class: 'rv-muted' }, `The last copy was not kept: ${m.skipped}`) : null)
  },
  render: (items, reload, flash) => {
    const list = el(
      'ul',
      { class: 'rv-list', 'aria-label': 'Clipboard history' },
      items.map((c) => {
        const shownText = revealed.get(c.id)
        const preview = c.kind === 'image' ? null : el('span', { class: `rv-preview${c.masked && shownText === undefined ? ' masked' : ''}` }, shownText ?? c.preview)
        const thumb = c.kind === 'image' ? el('span', { class: 'rv-cliimg' }, icon('screenshots', 16)) : null
        if (thumb) void ask('clipboard:image', [c.id]).then((r) => r.ok && r.value && thumb.replaceChildren(el('img', { src: r.value, alt: '' })))
        const label = c.kind === 'image' ? 'an image' : c.masked && shownText === undefined ? 'a hidden entry' : c.preview.slice(0, 40)
        return el(
          'li',
          { class: `rv-item${c.pinned ? ' on' : ''}` },
          el('button', { type: 'button', class: 'rv-main', 'data-key': `clip-${c.id}`, title: 'Copy this back to the clipboard', onclick: async () => flash((await ask('clipboard:copy', [c.id])).message ?? '') }, thumb, el('span', { class: 'rv-text' }, preview ?? el('b', {}, c.size ? `Image ${c.size.width}×${c.size.height}` : 'Image'), el('small', {}, `${KIND_LABEL[c.kind] ?? c.kind} · ${when(c.copiedAt)}${c.times > 1 ? ` · ×${c.times}` : ''}${c.source?.url ? ` · ${host(c.source.url)}` : ''}`))),
          c.masked
            ? iconButton(shownText === undefined ? 'eye' : 'eyeOff', shownText === undefined ? `Show ${label}` : 'Hide it again', async () => {
                if (shownText !== undefined) revealed.delete(c.id)
                else {
                  const r = await ask('clipboard:reveal', [c.id])
                  if (!r.ok) return flash(r.message)
                  revealed.set(c.id, r.value.text)
                  setTimeout(() => (revealed.delete(c.id), void reload()), 15_000)
                }
                void reload()
              })
            : null,
          iconButton('pin', c.pinned ? `Unpin ${label}` : `Keep ${label}`, async () => (await ask('clipboard:pin', [c.id, !c.pinned]), void reload()), { pressed: c.pinned }),
          iconButton('trash', `Delete ${label}`, async () => (revealed.delete(c.id), await ask('clipboard:remove', [c.id]), void reload()))
        )
      })
    )
    const clear = el('div', { class: 'rv-row' }, confirmButton('trash', 'Clear the history (pinned entries stay)', async () => (revealed.clear(), await ask('clipboard:clear', [false]), void reload())), el('small', { class: 'rv-muted' }, 'Clear the history (pinned entries stay)'))
    return el('div', {}, list, clear)
  }
})

// ---------------------------------------------------------------- Whiteboard

listView('whiteboard', 'Whiteboard', 'whiteboard', {
  loading: 'Reading the boards…',
  empty: () => 'No boards yet. Make one below; the current page can be added to it.',
  load: async () => {
    const r = await ask('whiteboard:list')
    return r.ok ? { ...r, keepEmpty: true } : r
  },
  render: (boards, reload, flash) => {
    let name = ''
    const create = el(
      'form',
      {
        class: 'rv-row',
        onsubmit: async (e) => {
          e.preventDefault()
          const r = await ask('whiteboard:create', [name.trim() || 'New board'])
          if (!r.ok) return flash(r.message)
          name = ''
          await reload()
        }
      },
      (() => {
        const i = el('input', { type: 'text', name: 'board', class: 'rv-input grow', maxlength: '80', placeholder: 'Name for a new board', 'aria-label': 'Name for a new board' })
        i.value = name
        i.addEventListener('input', () => (name = i.value))
        return i
      })(),
      labelButton('plus', 'New board', () => undefined, { class: 'primary' })
    )
    create.querySelector('.labelbtn').setAttribute('type', 'submit')
    const cards = boards.map((b) => {
      const detail = el('div', { class: 'rv-detail', hidden: true })
      const toggle = el('button', { type: 'button', class: 'rv-main', 'data-key': `wb-${b.id}`, 'aria-expanded': 'false', onclick: async () => {
        if (!detail.hidden) return (detail.hidden = true), toggle.setAttribute('aria-expanded', 'false')
        detail.replaceChildren(state('loading', 'Opening the board…'))
        detail.hidden = false
        toggle.setAttribute('aria-expanded', 'true')
        const r = await ask('whiteboard:get', [b.id])
        if (!r.ok) return detail.replaceChildren(state('error', r.message))
        const items = r.value.items
        detail.replaceChildren(
          items.length ? el('ul', { class: 'rv-notes' }, items.map((n) => el('li', {}, n.text || '(empty)'))) : el('p', { class: 'rv-muted' }, r.value.total ? `${r.value.total} drawn item${r.value.total === 1 ? '' : 's'}, no notes or text. Drawings open in the Orbis window.` : 'This board is empty.'),
          items.length && r.value.total > items.length ? el('p', { class: 'rv-muted' }, `${r.value.total - items.length} more item${r.value.total - items.length === 1 ? '' : 's'} not shown here.`) : null
        )
      } }, icon('whiteboard', 16), el('span', { class: 'rv-text' }, el('b', {}, b.name), el('small', {}, `${b.count} item${b.count === 1 ? '' : 's'} · ${when(b.updatedAt)}`)))
      const rename = iconButton('edit', `Rename ${b.name}`, () => {
        const i = el('input', { type: 'text', name: 'rename', class: 'rv-input grow', maxlength: '80', 'aria-label': `New name for ${b.name}` })
        i.value = b.name
        const done = async (save) => {
          if (save && i.value.trim() && i.value.trim() !== b.name) flash((await ask('whiteboard:rename', [b.id, i.value.trim()])).message ?? '')
          void reload()
        }
        i.addEventListener('keydown', (e) => (e.key === 'Enter' ? void done(true) : e.key === 'Escape' ? void done(false) : undefined))
        i.addEventListener('blur', () => void done(true))
        toggle.replaceWith(i)
        i.focus()
        i.select()
      })
      return el('li', { class: 'rv-card' }, el('div', { class: 'rv-item' }, toggle, iconButton('plus', `Add the page in front to ${b.name}`, async () => {
        const r = await ask('whiteboard:add-page', [b.id])
        flash(r.ok ? `Added the page to ${b.name}.` : r.message)
        if (r.ok) void reload()
      }), rename, confirmButton('trash', `Delete the board ${b.name}`, async () => (await ask('whiteboard:remove', [b.id]), void reload()))), detail)
    })
    return el('div', {}, boards.length ? el('ul', { class: 'rv-list', 'aria-label': 'Boards' }, cards) : state('empty', 'No boards yet. Make one below.'), create)
  }
})

// ---------------------------------------------------------------- Research

const sessionUrl = (s) => `chrome://orbis-search/#q=${encodeURIComponent((s.topic || s.title || 'research').slice(0, 200))}&in=orion&s=${encodeURIComponent(s.id)}`

listView('research', 'Research', 'research', {
  loading: 'Reading the saved research…',
  empty: (m) => (m.query ? 'No saved research matches that.' : 'Nothing has been researched yet. Research done in Orbis Search is saved here.'),
  load: (m) => ask('search-sessions:list', [m.query || undefined]),
  head: (m, reload) => search(m, 'Search saved research', () => void reload()),
  render: (sessions, reload) =>
    el(
      'ul',
      { class: 'rv-list', 'aria-label': 'Saved research' },
      sessions.map((s) =>
        el(
          'li',
          { class: 'rv-item' },
          el('button', { type: 'button', class: 'rv-main', 'data-key': `rs-${s.id}`, title: 'Open it in Orbis Search', onclick: () => window.open(sessionUrl(s), '_blank') }, icon('research', 16), el('span', { class: 'rv-text' }, el('b', {}, s.title || s.topic), el('small', {}, `${s.turns} question${s.turns === 1 ? '' : 's'} · ${s.sources} source${s.sources === 1 ? '' : 's'} · ${when(s.updatedAt)}`))),
          confirmButton('trash', `Delete the research ${s.title || s.topic}`, async () => (await ask('search-sessions:remove', [s.id]), void reload()))
        )
      )
    )
})

// ---------------------------------------------------------------- Sources

listView('sources', 'Sources', 'sources', {
  loading: 'Reading the sources…',
  empty: (m) => (m.query ? 'No source matches that.' : 'No sources yet. These are the pages saved research actually used.'),
  load: async (m) => {
    const r = await ask('research:sources')
    if (!r.ok) return r
    const q = (m.query || '').trim().toLowerCase()
    return { ok: true, value: q ? r.value.filter((s) => `${s.title} ${s.url}`.toLowerCase().includes(q)) : r.value }
  },
  head: (m, reload) => search(m, 'Search sources', () => void reload()),
  render: (sources, _reload, flash) =>
    el(
      'ul',
      { class: 'rv-list', 'aria-label': 'Sources' },
      sources.map((s) =>
        el(
          'li',
          { class: 'rv-item' },
          el('button', { type: 'button', class: 'rv-main', 'data-key': `src-${s.url}`, title: s.url, onclick: async () => flash(await openPage(s.url)) }, favicon(s.url), el('span', { class: 'rv-text' }, el('b', {}, s.title || host(s.url)), el('small', {}, `${host(s.url)} · from ${s.sessionTitle}`))),
          iconButton('research', `Open the research ${s.sessionTitle} in Orbis Search`, () => window.open(sessionUrl({ id: s.sessionId, topic: s.sessionTitle }), '_blank'))
        )
      )
    )
})

// ---------------------------------------------------------------- Workspaces

listView('workspaces', 'Workspaces', 'workspaces', {
  loading: 'Reading the workspaces…',
  empty: () => 'No workspaces yet.',
  load: async () => {
    const r = await ask('workspaces:list')
    return r.ok ? { ...r, keepEmpty: true } : r
  },
  render: (spaces, reload, flash) => {
    let name = ''
    const create = el(
      'form',
      {
        class: 'rv-create',
        onsubmit: async (e) => {
          e.preventDefault()
          if (!name.trim()) return flash('Give the workspace a name.')
          const r = await ask('workspaces:create', [name.trim()])
          if (!r.ok) return flash(r.message)
          name = ''
          await reload()
          flash(`Saved the open pages as ${r.value.name}.`)
        }
      },
      el('h3', {}, 'Save the open pages'),
      el('div', { class: 'rv-row' }, (() => {
        const i = el('input', { type: 'text', name: 'workspace', class: 'rv-input grow', maxlength: '60', placeholder: 'Name for this set of tabs', 'aria-label': 'Name for a new workspace' })
        i.value = name
        i.addEventListener('input', () => (name = i.value))
        return i
      })(), labelButton('plus', 'Save', () => undefined, { class: 'primary' }))
    )
    create.querySelector('.labelbtn').setAttribute('type', 'submit')
    const openIt = async (w, replace) => {
      const r = await ask('workspaces:open', [w.id, replace])
      flash(r.ok ? `Opened ${w.name}.` : r.message)
      if (r.ok) void reload()
    }
    const list = spaces.length
      ? el(
          'ul',
          { class: 'rv-list', 'aria-label': 'Workspaces' },
          spaces.map((w) =>
            el(
              'li',
              { class: `rv-item${w.current ? ' on' : ''}`, ...(w.current ? { 'aria-current': 'true' } : {}) },
              el('button', { type: 'button', class: 'rv-main', 'data-key': `ws-${w.id}`, title: `Open ${w.name} in addition to the open tabs`, onclick: () => void openIt(w, false) }, el('span', { class: 'rv-dot big', style: `--dot:${w.color}`, 'aria-hidden': 'true' }), el('span', { class: 'rv-text' }, el('b', {}, w.name), el('small', {}, `${w.tabs} tab${w.tabs === 1 ? '' : 's'}${w.groups ? ` · ${w.groups} group${w.groups === 1 ? '' : 's'}` : ''}${w.current ? ' · open now' : w.lastOpenedAt ? ` · opened ${when(w.lastOpenedAt)}` : ''}`))),
              iconButton('tabs', `Switch to ${w.name}: close the other tabs and open its pages`, () => void openIt(w, true)),
              iconButton('edit', `Rename ${w.name}`, (event) => {
                const row = event.currentTarget.closest('li')
                const i = el('input', { type: 'text', name: 'rename', class: 'rv-input grow', maxlength: '60', 'aria-label': `New name for ${w.name}` })
                i.value = w.name
                const done = async (save) => {
                  if (save && i.value.trim() && i.value.trim() !== w.name) flash((await ask('workspaces:rename', [w.id, i.value.trim()])).message ?? '')
                  void reload()
                }
                i.addEventListener('keydown', (e) => (e.key === 'Enter' ? void done(true) : e.key === 'Escape' ? void done(false) : undefined))
                i.addEventListener('blur', () => void done(true))
                row?.replaceChildren(i)
                i.focus()
                i.select()
              }),
              confirmButton('trash', `Delete the workspace ${w.name}`, async () => (await ask('workspaces:remove', [w.id]), void reload()))
            )
          )
        )
      : state('empty', 'No workspaces yet. Save the open pages below to make the first one.')
    return el('div', {}, list, create)
  }
})
