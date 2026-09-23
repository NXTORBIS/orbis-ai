import { readBang, siteOf, tidyResults, VERTICALS, wantsAnswer } from '../../src/shared/orbisSearch.ts'
import type { SearchVertical } from '../../src/shared/orbisSearch.ts'
import { addSources, addTurn, buildAsk, changesTopic, constraintIn, isFollowUp, newSearchSession, referencedItems, wantsFreshResearch, withConstraint, withTopic } from '../../src/shared/orionSearch.ts'
import type { OrionSearchSession } from '../../src/shared/orionSearch.ts'
import { checkCitations, comparison, mergeResults, planQueries, rankSources } from '../../src/shared/researchPlan.ts'
import { resumeRequest } from '../../src/shared/searchSessions.ts'
import type { SavedSearchSummary } from '../../src/shared/searchSessions.ts'
import { saidCount, saidDuration } from '../../src/shared/searchProviders.ts'
// @ts-expect-error the helper client is plain JavaScript shared with the side panel
import { call, HelperDown } from '../panel/helper.js'
// @ts-expect-error the orb is plain JavaScript shared with the new tab page
import { mountOrb } from '../panel/orb.js'

/**
 * Orbis Search, as the page a search in the Orbis browser lands on. It is the browser's default search engine (`chrome://orbis-search/#q=…`),
 * so typing in the address bar, the new-tab search box and "search for …" in a context menu all arrive here, and nothing is sent to
 * Google, or anywhere else, until the web is actually searched.
 *
 * The same search Orbis has always had, minus a search box of its own (the address bar is the one search box): the verticals (Orion, All, Images, Videos, News, Maps, Music,
 * Science, Files, Social), each result drawn as the kind of thing it is, pictures and videos looked at in a viewer, Orion's answers in
 * a saved session with numbered sources, and a plain link to search Google instead. Results are the providers' real results; a field
 * that did not arrive is not drawn. Nothing untrusted is ever put into the page as markup: every node is built with textContent.
 */

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const LABEL: Record<SearchVertical, string> = { orion: 'Orion', all: 'All', images: 'Images', videos: 'Videos', news: 'News', maps: 'Maps', music: 'Music', science: 'Science', files: 'Files', social: 'Social' }
const AUTO_MODEL = 'orion/auto'

interface Result {
  kind?: string; title: string; url: string; snippet?: string; site: string; thumbnail?: string; image?: string; width?: number; height?: number
  durationSec?: number; embed?: string; audio?: string; author?: string; publisher?: string; published?: string; address?: string
  latitude?: number; longitude?: number; views?: number
}
interface Outcome { results?: Result[]; problem?: string | null; tookMs?: number; unavailable?: string[]; query?: string }

// The query travels in the fragment, not in a query string: the browser's first navigation to an extension page fails when the address
// has a query string (found by testing this build), and a fragment loads reliably. A query string is still read, for old links.
const params = new URLSearchParams(location.hash ? location.hash.slice(1) : location.search)
const query = (params.get('q') ?? '').trim()
const wanted = params.get('in') as SearchVertical | null
const vertical: SearchVertical = wanted && VERTICALS.includes(wanted) ? wanted : 'all'
const sessionParam = params.get('s')

const safeUrl = (value: unknown): string | null => {
  try {
    const u = new URL(String(value))
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
const button = (className: string, text: string, onClick: () => void, label?: string): HTMLButtonElement => {
  const b = el('button', className, text)
  b.type = 'button'
  if (label) b.setAttribute('aria-label', label)
  b.addEventListener('click', onClick)
  return b
}
const PATHS: Record<string, string> = {
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13',
  external: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  close: 'M18 6L6 18M6 6l12 12',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  prev: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  play: 'M7 4l13 8-13 8z',
  up: 'M12 19V5M5 12l7-7 7 7',
  stop: 'M6 6h12v12H6z'
}
/** A small drawn icon, made as SVG nodes (never as markup from a string). */
function icon(name: keyof typeof PATHS, size = 16): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', name === 'play' || name === 'stop' ? 'currentColor' : 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', PATHS[name])
  svg.append(path)
  return svg
}
const iconButton = (className: string, name: keyof typeof PATHS, onClick: () => void, label: string, size = 16): HTMLButtonElement => {
  const b = button(className, '', onClick, label)
  b.title = label
  b.append(icon(name, size))
  return b
}
const pageHash = (q: string, v: SearchVertical, extra: Record<string, string> = {}): string => {
  const p = new URLSearchParams({ q })
  if (v !== 'all') p.set('in', v)
  for (const [k, val] of Object.entries(extra)) p.set(k, val)
  return `#${p.toString()}`
}
const pageUrl = (q: string, v: SearchVertical): string => `chrome://orbis-search/${pageHash(q, v)}`

let toastTimer = 0
function toast(message: string): void {
  const t = $('toast')
  t.textContent = message
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (t.hidden = true), 2200)
}

/** Where a typed search goes: another site when a bang asked for one (an explicit choice), otherwise a new Orbis Search. */
function go(text: string, v: SearchVertical): void {
  const typed = text.trim()
  if (!typed) return
  const bang = readBang(typed)
  if (bang) location.href = `${bang.site.url}${encodeURIComponent(bang.query)}`
  else location.href = pageUrl(typed, v)
}

// A bang in the address bar (`!g cats`) is the person's explicit choice, so it goes there.
const arrived = readBang(query)
if (arrived) location.replace(`${arrived.site.url}${encodeURIComponent(arrived.query)}`)

document.title = query ? `${query} · Orbis Search` : 'Orbis Search'

// The page keeps no list of recent searches: it has no search box of its own to offer them in, and the address bar the
// search came from keeps its own history.

// ---------------------------------------------------------------- the verticals

const nav = $('verticals')
for (const name of VERTICALS) {
  const a = el('a', `vertical${name === 'orion' ? ' orion' : ''}${name === vertical ? ' on' : ''}`, LABEL[name])
  a.href = pageUrl(query, name)
  if (name === vertical) a.setAttribute('aria-current', 'page')
  nav.append(a)
}

function status(text: string, retry?: () => void): void {
  const p = el('p', retry ? 'status problem' : 'status', text)
  if (retry) p.append(button('retry', 'Try again', retry))
  $('body').replaceChildren(p)
}
const downMessage = (err: unknown): string =>
  err instanceof HelperDown
    ? `${(err as Error).message} Orbis Search runs on this computer: start Orbis, then try again.`
    : !navigator.onLine
      ? 'You are offline. Orbis Search needs the internet; it will try again when you are back online.'
      : (err as { message?: string })?.message || 'The search did not work.'

// ---------------------------------------------------------------- results

function shareButton(result: { url: string; title: string }): HTMLButtonElement {
  const b = iconButton('share', 'share', async () => {
    try {
      const nav = navigator as Navigator & { share?: (data: { title?: string; url: string }) => Promise<void> }
      if (nav.share) await nav.share({ url: result.url, title: result.title })
      else {
        await navigator.clipboard.writeText(result.url)
        toast('Link copied.')
      }
    } catch {
      // Closing the share sheet is not a failure worth saying anything about.
    }
  }, `Share ${result.title}`, 15)
  b.title = 'Share this link'
  return b
}

function siteLine(href: string, name: string): HTMLElement {
  const site = el('span', 'site')
  const icon = el('img', 'favicon')
  icon.alt = ''
  icon.width = 16
  icon.height = 16
  icon.src = `chrome://favicon2/?size=16&scaleFactor=2x&pageUrl=${encodeURIComponent(href)}`
  site.append(icon, el('span', undefined, name))
  return site
}

const factsOf = (r: Result): string =>
  [
    r.author,
    saidCount(r.views) ? `${saidCount(r.views)} views` : undefined,
    r.publisher,
    r.address,
    r.published,
    r.kind !== 'videos' && r.durationSec ? saidDuration(r.durationSec) : undefined,
    r.latitude !== undefined && r.longitude !== undefined ? `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}` : undefined
  ]
    .filter(Boolean)
    .join(' · ')

const footLine = (count: number, tookMs: number, elsewhere: boolean): HTMLElement => {
  const foot = el('footer', 'foot')
  foot.append(document.createTextNode(`${count} results in ${(tookMs / 1000).toFixed(1)}s · searched by Orbis, not by anyone watching you`))
  if (elsewhere) {
    const a = el('a', 'elsewhere', 'try Google instead')
    a.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`
    foot.append(document.createTextNode(' · '), a)
  }
  return foot
}

let shown: Result[] = []

function renderResults(results: Result[], outcome: Outcome, category: SearchVertical): void {
  shown = results
  const viewable = category === 'images' || category === 'videos'
  const images = category === 'images'
  const listEl = el(images ? 'ul' : 'ol', images ? 'images' : 'results')
  listEl.setAttribute('aria-label', `${LABEL[category]} results`)
  results.forEach((r, i) => {
    const href = safeUrl(r.url)
    if (!href) return
    const li = el('li')
    const thumb = safeUrl(r.thumbnail ?? r.image)
    if (images) {
      const b = button('image', '', () => openViewer(i))
      b.title = `${r.title} - ${r.site}`
      if (thumb) {
        const img = el('img')
        img.src = thumb
        img.alt = r.title
        img.loading = 'lazy'
        img.referrerPolicy = 'no-referrer'
        img.addEventListener('error', () => li.remove())
        b.append(img)
      }
      const meta = el('span', 'meta')
      meta.append(el('b', undefined, r.title), el('small', undefined, `${r.site}${r.width && r.height ? ` · ${r.width}×${r.height}` : ''}`))
      b.append(meta)
      li.append(b)
    } else {
      const row: HTMLElement = viewable ? el('button', 'result') : el('a', 'result')
      if (viewable) {
        ;(row as HTMLButtonElement).type = 'button'
        row.addEventListener('click', () => openViewer(i))
      } else (row as HTMLAnchorElement).href = href
      if (thumb) {
        const tb = el('span', 'thumbbox')
        const img = el('img')
        img.src = thumb
        img.alt = ''
        img.loading = 'lazy'
        img.referrerPolicy = 'no-referrer'
        img.addEventListener('error', () => img.remove())
        tb.append(img)
        if (r.durationSec) tb.append(el('em', undefined, saidDuration(r.durationSec)))
        row.append(tb)
      }
      const text = el('span', 'text')
      text.append(siteLine(href, r.site || siteOf(href)), el('b', 'title', r.title))
      if (r.snippet) text.append(el('span', 'snippet', r.snippet))
      const facts = factsOf(r)
      if (facts) text.append(el('small', 'facts', facts))
      row.append(text)
      li.append(row)
      const audio = safeUrl(r.audio)
      if (audio) {
        const player = el('audio', 'preview')
        player.controls = true
        player.preload = 'none'
        player.src = audio
        text.append(player)
      }
      li.append(shareButton(r))
    }
    listEl.append(li)
  })
  const body = $('body')
  body.replaceChildren(listEl, footLine(listEl.children.length, outcome.tookMs ?? 0, category === 'all'))
  if (outcome.unavailable?.length) body.append(el('p', 'foot', `${outcome.unavailable.length === 1 ? 'One source' : `${outcome.unavailable.length} sources`} could not be reached: ${outcome.unavailable.join(', ')}.`))
}

async function search(): Promise<void> {
  if (!query) return status('Search the web with Orbis. Type in the address bar above.')
  if (vertical === 'orion') return void orion()
  if (!navigator.onLine) return status(downMessage(null), () => void search())
  status(vertical === 'all' ? 'Searching the web…' : `Searching ${LABEL[vertical].toLowerCase()}…`)
  try {
    const outcome = (await call('search:run', [query, vertical])) as Outcome
    const results = vertical === 'all' ? (tidyResults((outcome.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet ?? '' })), 12) as Result[]) : (outcome.results ?? [])
    if (!results.length) return status(outcome.problem || `Nothing was found for “${query}”.`, () => void search())
    renderResults(results, outcome, vertical)
    if (vertical === 'all' && wantsAnswer(query)) {
      const card = el('section', 'ask')
      const a = el('a', 'ask-link', 'Ask Orion about this, with sources')
      a.href = pageUrl(query, 'orion')
      card.append(a)
      $('body').prepend(card)
    }
    syncViewer()
  } catch (err) {
    status(downMessage(err), () => void search())
  }
}

// ---------------------------------------------------------------- the viewer (pictures and videos, without leaving the search)

let viewerIndex: number | null = null
let opener: HTMLElement | null = null

function openViewer(i: number): void {
  opener = document.activeElement as HTMLElement | null
  history.pushState(null, '', pageHash(query, vertical, { at: String(i) }))
  syncViewer()
}
function closeViewer(): void {
  if (new URLSearchParams(location.hash.slice(1)).get('at') !== null) history.back()
  else hideViewer()
}
function hideViewer(): void {
  viewerIndex = null
  $('viewer').hidden = true
  $('viewer').replaceChildren()
  document.body.style.overflow = ''
  opener?.focus?.()
}
function moveViewer(to: number): void {
  if (to < 0 || to >= shown.length) return
  history.replaceState(null, '', pageHash(query, vertical, { at: String(to) }))
  syncViewer()
}
/** The address says which one is open, so Back closes it and the results are exactly as they were. */
function syncViewer(): void {
  const at = new URLSearchParams(location.hash.slice(1)).get('at')
  const i = at === null ? NaN : Number(at)
  if (!Number.isInteger(i) || i < 0 || i >= shown.length || (vertical !== 'images' && vertical !== 'videos')) return hideViewer()
  viewerIndex = i
  drawViewer(i)
}

function drawViewer(i: number): void {
  const r = shown[i]
  const v = $('viewer')
  const href = safeUrl(r.url) ?? ''
  document.body.style.overflow = 'hidden'
  v.setAttribute('aria-label', r.title)
  const head = el('header', 'viewer-head')
  const title = el('span', 't', r.title)
  const src = el('span', 's')
  if (href) src.append(siteLine(href, r.site))
  const actions = el('span', 'viewer-actions')
  const link = (name: keyof typeof PATHS, url: string | null, label: string): HTMLElement => {
    if (!url) return el('span')
    const a = el('a')
    a.append(icon(name))
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.title = label
    a.setAttribute('aria-label', label)
    return a
  }
  actions.append(
    link('external', href, 'Open the page it came from'),
    ...(r.image ? [link('download', safeUrl(r.image), 'Open the full-size picture')] : []),
    iconButton('', 'link', async () => {
      try {
        await navigator.clipboard.writeText(r.url)
        toast('Link copied.')
      } catch {
        toast('The link could not be copied.')
      }
    }, 'Copy the link'),
    shareButton(r),
    iconButton('', 'close', closeViewer, 'Close (Esc)')
  )
  head.append(title, src, actions)

  const body = el('div', 'viewer-body')
  const prev = iconButton('step', 'prev', () => moveViewer(i - 1), 'Previous', 22)
  prev.disabled = i === 0
  const next = iconButton('step', 'next', () => moveViewer(i + 1), 'Next', 22)
  next.disabled = i === shown.length - 1
  const stage = el('div', 'stage')
  if (r.kind === 'videos') stage.append(videoStage(r, href))
  else stage.append(...imageStage(r))
  const rail = el('div', 'rail')
  shown.forEach((other, n) => {
    const b = button(n === i ? 'on' : '', '', () => moveViewer(n), other.title)
    if (n === i) b.setAttribute('aria-current', 'true')
    const t = safeUrl(other.thumbnail ?? other.image)
    if (t) {
      const img = el('img')
      img.src = t
      img.alt = ''
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      b.append(img)
    }
    rail.append(b)
  })
  body.append(prev, stage, next, rail)
  const foot = el('footer', 'viewer-foot')
  foot.append(el('span', undefined, [r.author, saidCount(r.views) ? `${saidCount(r.views)} views` : null, r.published, r.width && r.height ? `${r.width}×${r.height}` : null].filter(Boolean).join(' · ')), el('span', undefined, `${i + 1} of ${shown.length}`))
  v.replaceChildren(head, body, foot)
  v.hidden = false
  ;(rail.querySelector('.on') as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'center' })
  if (!v.contains(document.activeElement)) (v.querySelector('.viewer-actions button') as HTMLElement | null)?.focus()
}

function imageStage(r: Result): Node[] {
  const full = safeUrl(r.image ?? r.thumbnail)
  if (!full) return [el('p', 'status', 'There is no picture to show for this result.')]
  const img = el('img')
  img.alt = r.title
  img.referrerPolicy = 'no-referrer'
  const loading = el('p', 'status', 'Loading the picture…')
  img.hidden = true
  img.addEventListener('load', () => {
    img.hidden = false
    loading.remove()
  })
  img.addEventListener('error', () => {
    img.remove()
    loading.textContent = `The picture could not be loaded from ${r.site}. It may have been moved or may not allow being shown here.`
  })
  img.src = full
  return [loading, img]
}

function videoStage(r: Result, href: string): Node {
  const poster = el('div', 'poster')
  const embed = safeUrl(r.embed)
  const thumb = safeUrl(r.thumbnail)
  if (thumb) {
    const img = el('img')
    img.src = thumb
    img.alt = r.title
    img.referrerPolicy = 'no-referrer'
    poster.append(img)
  } else poster.append(el('span', 'muted', 'No picture for this video.'))
  if (embed) {
    poster.append(
      iconButton('play', 'play', () => {
        const frame = el('iframe')
        frame.src = embed
        frame.title = r.title
        frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'
        frame.allowFullscreen = true
        frame.referrerPolicy = 'no-referrer'
        poster.replaceWith(frame)
      }, `Play ${r.title}`, 28)
    )
  } else {
    const box2 = el('div', 'elsewhere-box')
    const a = el('a', undefined, `Watch on ${r.site}`)
    a.href = href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    box2.append(el('p', undefined, `${r.site} does not offer a player Orbis can use, so this one plays on its own site.`), a)
    poster.append(box2)
  }
  const cap = [r.author, saidDuration(r.durationSec)].filter(Boolean).join(' · ')
  if (cap) poster.append(el('span', 'muted', cap))
  return poster
}

document.addEventListener(
  'keydown',
  (e) => {
    if (viewerIndex === null) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeViewer()
    } else if (e.key === 'ArrowRight') moveViewer(viewerIndex + 1)
    else if (e.key === 'ArrowLeft') moveViewer(viewerIndex - 1)
  },
  true
)

// ---------------------------------------------------------------- Orion: a search session, saved like the app's own

interface Source { n?: number; title: string; url: string; site: string; snippet: string }
let session: OrionSearchSession | null = null
let busy = false
let controller: AbortController | null = null
let asking: { question: string; text: string; researched: boolean } | null = null
let followups: string[] = []
let draft = ''

const cited = (text: string, sources: Source[], target: HTMLElement): void => {
  target.replaceChildren()
  for (const paragraph of text.split(/\n{2,}/)) {
    const p = el('p')
    for (const part of paragraph.split(/(\[\d{1,2}\]|\*\*[^*]+\*\*)/g)) {
      const cite = /^\[(\d{1,2})\]$/.exec(part)
      const source = cite && sources[Number(cite[1]) - 1]
      const href = source && safeUrl(source.url)
      if (cite && source && href) {
        const a = el('a', 'cite', part)
        a.href = href
        a.title = `${source.title} — ${source.site}`
        a.addEventListener('click', (e) => {
          const row = document.getElementById(`src${cite[1]}`)
          if (!row) return
          e.preventDefault()
          row.scrollIntoView({ block: 'center' })
          row.classList.add('flash')
          setTimeout(() => row.classList.remove('flash'), 1400)
        })
        p.append(a)
      } else if (/^\*\*[^*]+\*\*$/.test(part)) p.append(el('strong', undefined, part.slice(2, -2)))
      else p.append(document.createTextNode(part))
    }
    target.append(p)
  }
}

function drawOrion(): void {
  const body = $('body')
  const turns = session?.turns ?? []
  const nodes: Node[] = []
  const head = el('div', 'orion-head')
  head.append(el('span', 'orion-topic', session?.topic ?? ''))
  head.append(button('chip', 'Earlier research', () => void showEarlier()))
  if (turns.length) head.append(button('chip', 'New search', () => (location.href = 'chrome://orbis-newtab/')))
  nodes.push(head, earlierBox)
  const thread = el('ol', 'thread')
  for (const turn of turns) {
    const li = el('li')
    li.append(el('p', 'q', turn.question))
    const a = el('div', 'answer')
    const h = el('h3', undefined, 'Orion')
    if (turn.researched) h.append(el('small', undefined, 'searched the web'))
    const text = el('div')
    cited(turn.answer, session?.sources ?? [], text)
    a.append(h, text)
    if (turn.queries && turn.queries.length > 1) a.append(el('p', 'searched', `Searched: ${turn.queries.join(' · ')}`))
    if (turn.invalidCitations?.length) a.append(el('p', 'warning', `Cites ${turn.invalidCitations.map((n) => `[${n}]`).join(', ')}, which ${turn.invalidCitations.length === 1 ? 'is not a source' : 'are not sources'} found in this search. Treat that part with care.`))
    if (turn.uncited) a.append(el('p', 'warning', 'This answer does not cite any of the sources found.'))
    li.append(a)
    thread.append(li)
  }
  if (asking) {
    const li = el('li')
    li.append(el('p', 'q', asking.question))
    const a = el('div', 'answer')
    const h = el('h3', undefined, 'Orion')
    if (asking.researched && !asking.text) h.append(el('small', undefined, 'searching the web…'))
    const text = el('div')
    cited(asking.text, session?.sources ?? [], text)
    const last = text.lastElementChild ?? text.appendChild(el('p'))
    last.append(el('span', 'caret'))
    a.append(h, text)
    li.append(a)
    thread.append(li)
  }
  nodes.push(thread)
  if (!busy && followups.length) {
    const box2 = el('div', 'followups')
    for (const f of followups) box2.append(button('chip', f, () => void ask(f)))
    nodes.push(box2)
  }
  if (session?.sources.length) {
    const s = el('section', 'sources')
    s.setAttribute('aria-label', 'Sources in this search')
    s.append(el('h4', undefined, 'Sources'))
    const ol = el('ol')
    session.sources.forEach((source, i) => {
      const href = safeUrl(source.url)
      if (!href) return
      const li = el('li')
      const a = el('a', 'source')
      a.id = `src${i + 1}`
      a.href = href
      a.title = source.snippet
      const st = el('span', 'st')
      st.append(el('b', undefined, source.title), el('small', undefined, source.site))
      a.append(el('span', 'n', String(i + 1)), st)
      li.append(a)
      ol.append(li)
    })
    s.append(ol)
    nodes.push(s)
  }
  const form = el('form', 'follow')
  const ta = el('textarea')
  ta.rows = 1
  ta.placeholder = turns.length ? 'Ask a follow-up…' : 'Ask Orion…'
  ta.setAttribute('aria-label', 'Ask Orion a follow-up in this search')
  ta.value = draft
  const sendBtn = el('button', 'send')
  sendBtn.append(icon(busy ? 'stop' : 'up', 16))
  sendBtn.type = busy ? 'button' : 'submit'
  sendBtn.setAttribute('aria-label', busy ? 'Stop' : 'Ask')
  sendBtn.disabled = !busy && !draft.trim()
  ta.addEventListener('input', () => {
    draft = ta.value
    if (!busy) sendBtn.disabled = !draft.trim()
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`
  })
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      form.requestSubmit()
    }
  })
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (busy) return
    const text = draft.trim()
    if (!text) return
    draft = ''
    void ask(text)
  })
  sendBtn.addEventListener('click', () => {
    if (busy) controller?.abort()
  })
  form.append(ta, sendBtn)
  nodes.push(form)
  const hadFocus = document.activeElement?.tagName === 'TEXTAREA'
  body.replaceChildren(...nodes)
  if (hadFocus || !turns.length) ta.focus()
  if (asking) window.scrollTo({ top: document.body.scrollHeight })
}

const earlierBox = el('section', 'earlier')
earlierBox.hidden = true
async function showEarlier(): Promise<void> {
  earlierBox.hidden = false
  earlierBox.replaceChildren(el('p', 'muted', 'Loading…'))
  try {
    const saved = (await call('search-sessions:list', [])) as SavedSearchSummary[]
    const top = el('div', 'earlier-top')
    top.append(el('h4', undefined, 'Earlier research'), button('chip', 'Close', () => (earlierBox.hidden = true)))
    earlierBox.replaceChildren(top)
    if (!saved.length) return void earlierBox.append(el('p', 'muted', 'Nothing saved yet. Research is saved here as you ask.'))
    const ul = el('ul')
    for (const item of saved) {
      const li = el('li')
      const open = el('button', 'open')
      open.type = 'button'
      open.append(el('b', undefined, item.title), el('small', undefined, `${item.turns} ${item.turns === 1 ? 'question' : 'questions'} · ${item.sources} sources · ${new Date(item.updatedAt).toLocaleDateString()}`))
      open.addEventListener('click', () => void reopen(item.id))
      const del = iconButton('del', 'trash', async () => {
        await call('search-sessions:remove', [item.id]).catch(() => undefined)
        void showEarlier()
      }, `Delete saved research: ${item.title}`, 14)
      li.append(open, del)
      ul.append(li)
    }
    earlierBox.append(ul)
  } catch (err) {
    earlierBox.replaceChildren(el('p', 'muted', downMessage(err)))
  }
}

async function reopen(id: string): Promise<void> {
  const found = (await call('search-sessions:get', [id]).catch(() => null)) as OrionSearchSession | null
  if (!found) {
    toast('That research is no longer saved.')
    return void showEarlier()
  }
  controller?.abort()
  earlierBox.hidden = true
  session = found
  asking = null
  busy = false
  followups = []
  history.replaceState(null, '', pageHash(found.topic || query, 'orion', { s: id }))
  document.title = `${found.topic} · Orbis Search`
  drawOrion()
}

const save = (next: OrionSearchSession): void => {
  session = next
  if (next.turns.length) void call('search-sessions:save', [next]).catch(() => undefined)
}

async function ask(question: string, options: { starting?: boolean } = {}): Promise<void> {
  const text = question.trim()
  if (!text || busy) return
  busy = true
  followups = []
  let current = session
  if (!current || options.starting) current = newSearchSession('default', text)
  else if (changesTopic(text)) current = withTopic(current, text)
  const constraint = constraintIn(text)
  if (constraint && current.turns.length) current = withConstraint(current, constraint)
  const fresh = !current.turns.length || wantsFreshResearch(text)
  session = current
  asking = { question: text, text: '', researched: fresh }
  controller = new AbortController()
  const signal = controller.signal
  drawOrion()
  let queries: string[] = []
  try {
    if (fresh) {
      queries = planQueries(text, current.topic, isFollowUp(text, current))
      const outcomes = await Promise.all(queries.map((q) => (call('search:run', [q, 'all'], { signal }) as Promise<Outcome>).catch(() => null)))
      const lists = outcomes.map((found) => (found?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet ?? '', site: r.site || siteOf(r.url) })))
      const compared = comparison(text)
      const about = [...current.entities, ...(compared ? [compared.a, compared.b] : [])]
      const merged = rankSources(mergeResults(lists, 12), about)
      if (merged.length) current = { ...current, sources: addSources(current, merged, current.turns.length).sources }
      session = current
      drawOrion()
    }
    const context = buildAsk(current, text, { fresh })
    const requestId = `os${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    let answer = ''
    let failure = ''
    await call('chat:send', [{ model: AUTO_MODEL, messages: [{ id: requestId, role: 'user', content: context.prompt, createdAt: Date.now() }] }], {
      signal,
      onEvent: (event: { type: string; content?: string; message?: string }) => {
        if (event.type === 'delta' && typeof event.content === 'string') {
          answer += event.content
          if (asking) asking.text = answer
          drawOrion()
        } else if (event.type === 'error') failure = event.message ?? ''
      }
    })
    const finished = answer.trim()
    asking = null
    busy = false
    if (!finished) {
      toast(failure || 'Orion could not answer just now.')
      drawOrion()
      return
    }
    const check = checkCitations(finished, current.sources.length)
    const used = [...new Set([...referencedItems(text, current.sources.length), ...check.cited.map((n) => n - 1)])]
    save(addTurn(current, { id: requestId, question: text, answer: finished, used, researched: fresh, at: Date.now(), ...(queries.length ? { queries } : {}), ...(check.invalid.length ? { invalidCitations: check.invalid } : {}), ...(check.uncited ? { uncited: true } : {}) }))
    history.replaceState(null, '', pageHash(session?.topic || query, 'orion', { s: session?.id ?? '' }))
    drawOrion()
    void suggest(text, finished)
  } catch (err) {
    const stopped = signal.aborted
    const partial = asking?.text.trim()
    asking = null
    busy = false
    if (stopped && partial) {
      save(addTurn(current, { id: `os${Date.now().toString(36)}`, question: text, answer: partial, used: [], researched: fresh, at: Date.now(), ...(queries.length ? { queries } : {}) }))
    } else if (!stopped) toast(downMessage(err))
    drawOrion()
  }
}

/** Questions worth asking next, made by the same code the Orbis window uses; shown only when they arrive. */
async function suggest(question: string, answer: string): Promise<void> {
  try {
    const out = (await call('chat:suggest', [[{ role: 'user', content: question }, { role: 'assistant', content: answer }]])) as { followups?: string[] }
    followups = (out.followups ?? []).filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
    if (!busy) drawOrion()
  } catch {
    followups = []
  }
}

async function orion(): Promise<void> {
  if (!navigator.onLine) return status(downMessage(null), () => void orion())
  const about = resumeRequest(query)
  const wantedSession = sessionParam && /^[A-Za-z0-9_-]{1,80}$/.test(sessionParam) ? sessionParam : null
  if (wantedSession) {
    try {
      const found = (await call('search-sessions:get', [wantedSession])) as OrionSearchSession | null
      if (found) {
        session = found
        return drawOrion()
      }
    } catch (err) {
      return status(downMessage(err), () => void orion())
    }
  }
  if (about) {
    try {
      const found = (await call('search-sessions:find', [about])) as OrionSearchSession | null
      if (found) {
        session = found
        drawOrion()
        return toast(`Picked up your research on ${found.topic}.`)
      }
      toast(`There is no saved research about ${about}, so this starts a new search.`)
    } catch (err) {
      return status(downMessage(err), () => void orion())
    }
    return void ask(about, { starting: true })
  }
  drawOrion()
  await ask(query, { starting: true })
}

// The address only changes after the #. A viewer change is handled in place; anything else asks for a fresh page.
const lastKey = `${query}|${vertical}`
window.addEventListener('hashchange', () => {
  const p = new URLSearchParams(location.hash.slice(1))
  const key = `${(p.get('q') ?? '').trim()}|${p.get('in') && VERTICALS.includes(p.get('in') as SearchVertical) ? p.get('in') : 'all'}`
  if (key !== lastKey) location.reload()
  else syncViewer()
})
window.addEventListener('popstate', syncViewer)
window.addEventListener('online', () => {
  if (document.querySelector('.status.problem')) void search()
})

void search()
mountOrb()
