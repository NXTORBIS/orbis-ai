import { isOrbisPage, readBang, siteOf, tidyResults, VERTICALS, wantsAnswer } from '../../src/shared/orbisSearch.ts'
import type { SearchVertical } from '../../src/shared/orbisSearch.ts'
import { addSources, addTurn, buildAsk, changesTopic, constraintIn, isFollowUp, newSearchSession, referencedItems, wantsFreshResearch, withConstraint, withTopic } from '../../src/shared/orionSearch.ts'
import type { OrionSearchSession } from '../../src/shared/orionSearch.ts'
import { checkCitations, comparison, mergeResults, planQueries, rankSources } from '../../src/shared/researchPlan.ts'
import { resumeRequest } from '../../src/shared/searchSessions.ts'
import type { SavedSearchSummary } from '../../src/shared/searchSessions.ts'
import { saidCount, saidDuration } from '../../src/shared/searchProviders.ts'
// @ts-expect-error the helper client is plain JavaScript shared with the side panel
import { call, HelperDown } from '../panel/helper.js'
import { mountTray, pinButton, syncPins } from './tray.ts'
import { renderComposedPage } from './modules.ts'
import type { ComposedPage } from './modules.ts'

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
const LABEL: Record<SearchVertical, string> = { orion: 'Orion', all: 'All', images: 'Images', videos: 'Videos', pages: 'Pages', news: 'News', maps: 'Maps', music: 'Music', science: 'Science', files: 'Files', social: 'Social' }
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
  lens: 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3',
  more: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
  bookmark: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z',
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

// The space beside the verticals is the one part of this page that outlives the vertical you are looking at, which is
// exactly what a tray holding results from several of them needs.
// The tray is an extra; searching is what this page is for. Kept apart on purpose: a throw in here used to stop the
// script before `search()` at the foot of this file ever ran, and the page sat on its placeholder "Searching…" for
// every query, on every vertical, with nothing said about why.
try {
  mountTray($('verticals').parentElement ?? $('verticals'), toast)
} catch (err) {
  console.error('The comparison tray could not be set up; searching is unaffected.', err)
}

function status(text: string, retry?: () => void): void {
  const p = el('p', retry ? 'status problem' : 'status', text)
  if (retry) p.append(button('retry', 'Try again', retry))
  $('body').replaceChildren(p)
}
/**
 * How long the page will wait in silence before it says the search is not coming.
 *
 * `call` waits for the helper, and the helper waits for whatever it asked. A source that accepts a connection and then
 * says nothing leaves both of them waiting for as long as the tab is open -- and the page sitting on "Searching the
 * web...", which is the one thing a status line must never do.
 *
 * The clock measures silence, not elapsed time: every status the search reports restarts it. A slow search that is
 * visibly getting on with something is never cut off; one that has stopped saying anything is given up on.
 */
const SILENCE_LIMIT_MS = 25_000

class WentQuiet extends Error {
  constructor() {
    super('The search stopped responding. The source may be unavailable.')
  }
}

interface Waiting<T> {
  /** The answer, or a rejection -- including `WentQuiet` when nothing was heard for long enough. */
  answer: Promise<T>
  /** Restarts the clock. Called whenever the search says something. */
  touch(): void
}

function waitWithLimit<T>(work: Promise<T>, ms = SILENCE_LIMIT_MS): Waiting<T> {
  let timer = 0
  let over = false
  let give: (() => void) | null = null
  const answer = new Promise<T>((resolve, reject) => {
    give = () => {
      over = true
      reject(new WentQuiet())
    }
    work.then(
      (value) => {
        if (over) return
        window.clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        // A late rejection from work that was already given up on is ignored, so the message the page settled on is
        // not replaced by a second one saying the same thing differently.
        if (over) return
        window.clearTimeout(timer)
        reject(err)
      }
    )
  })
  const touch = (): void => {
    window.clearTimeout(timer)
    if (!over) timer = window.setTimeout(() => give?.(), ms)
  }
  touch()
  return { answer, touch }
}

const downMessage = (err: unknown): string =>
  err instanceof HelperDown
    // The error's own words are a launcher diagnostic (a .bat filename); the page says the condition in its own.
    ? 'Orbis is not running yet. Orbis Search runs on this computer, so start Orbis and try again.'
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

/**
 * Every result wears its own site's icon.
 *
 * `chrome://favicon2` only knows sites this browser has already been to, and a page of results is mostly sites it has not,
 * so asking it leaves nearly every row with the same blank globe. The helper asks each site for its own icon instead
 * (`favicon:get`), once per host. Until one arrives — and for a site that has none — the tile carries the site's first
 * letter, so a row is never a hole and nothing moves when the real icon lands.
 */
const iconKnown = new Map<string, string | null>()
const iconTiles = new Map<string, HTMLElement[]>()

function wearIcon(tile: HTMLElement, src: string): void {
  const img = el('img') as HTMLImageElement
  img.src = src
  img.alt = ''
  img.width = 16
  img.height = 16
  img.addEventListener('error', () => tile.classList.add('letter'))
  tile.classList.remove('letter')
  tile.replaceChildren(img)
}

/**
 * A site's own icon, or its first letter until the icon arrives.
 *
 * Pulled out of `siteLine` so the Sources list can wear the same icons the results do -- they are the same sites, and
 * a row of numbered boxes says nothing about where a citation goes while a row of icons says it at a glance.
 *
 * Null for an Orbis Page, and the absence is the honest thing rather than a gap: a Page is not a site, has no icon to
 * fetch, and the letter that stands in while one loads would here be a letter that never becomes anything.
 */
function faviconTile(href: string, name: string): HTMLElement | null {
  if (isOrbisPage(href)) return null
  let host = ''
  try {
    host = new URL(href).host.toLowerCase()
  } catch {
    host = ''
  }
  const tile = el('span', 'favicon letter')
  tile.textContent = (name || host).replace(/^www\./, '').charAt(0).toUpperCase() || '?'
  const known = host ? iconKnown.get(host) : undefined
  if (known) wearIcon(tile, known)
  else if (host) iconTiles.set(host, [...(iconTiles.get(host) ?? []), tile])
  return tile
}

function siteLine(href: string, name: string): HTMLElement {
  const site = el('span', 'site')
  const tile = faviconTile(href, name)
  if (tile) site.append(tile)
  site.append(el('span', undefined, name))
  return site
}

/** Asks for every host on the page in one call and puts each icon in place as it comes back. A letter stands in meanwhile. */
async function paintIcons(): Promise<void> {
  const wanted = [...iconTiles.keys()].filter((host) => !iconKnown.has(host))
  if (!wanted.length) return
  let icons: Record<string, string | null> = {}
  try {
    ;({ icons } = (await call('favicon:get', [wanted.map((host) => `https://${host}`)])) as { icons: Record<string, string | null> })
  } catch {
    return // An icon is never worth a visible failure: the letters stay.
  }
  for (const host of wanted) {
    const src = icons?.[host] ?? null
    iconKnown.set(host, src)
    if (!src) continue
    for (const tile of iconTiles.get(host) ?? []) wearIcon(tile, src)
  }
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
  // Pictures get a board rather than a list: see renderImageBoard for why that is a different thing and not a style.
  if (category === 'images') {
    const host = el('div', 'imgboard')
    renderImageBoard(results, host)
    const body = $('body')
    body.replaceChildren(host, footLine(results.length, outcome.tookMs ?? 0, false))
    // The same honesty the lists get: a source that could not be reached is said, not silently missing.
    if (outcome.unavailable?.length) {
      body.append(el('p', 'foot', `${outcome.unavailable.length === 1 ? 'One source' : `${outcome.unavailable.length} sources`} could not be reached: ${outcome.unavailable.join(', ')}.`))
    }
    void paintIcons()
    void addRelatedChips(host)
    return
  }
  // Pictures never reach here -- they returned above, into the wall. Videos are the only vertical left whose rows open
  // something rather than going somewhere, which is what `viewable` means from here down.
  const viewable = category === 'videos'
  const listEl = el('ol', 'results')
  listEl.setAttribute('aria-label', `${LABEL[category]} results`)
  results.forEach((r, i) => {
    const href = safeUrl(r.url)
    if (!href) return
    const li = el('li')
    const thumb = safeUrl(r.thumbnail ?? r.image)
    {
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
      li.append(pinButton({ url: href, title: r.title, site: r.site || siteOf(href) }, category), shareButton(r))
    }
    listEl.append(li)
  })
  const body = $('body')
  body.replaceChildren(listEl, footLine(listEl.children.length, outcome.tookMs ?? 0, category === 'all'))
  // The pins have just been made; this makes the ones for pages already in the tray show it.
  syncPins()
  if (outcome.unavailable?.length) body.append(el('p', 'foot', `${outcome.unavailable.length === 1 ? 'One source' : `${outcome.unavailable.length} sources`} could not be reached: ${outcome.unavailable.join(', ')}.`))
  void paintIcons()
}

/**
 * The ALL page, composed (§5, §57).
 *
 * One call does the understanding, the searching and the filling; this draws what came back. A section that could not
 * be filled reports itself rather than vanishing, and the whole page falls back to a plain list if the composer itself
 * fails -- a broken clever page should still be a working search.
 */
async function composed(): Promise<void> {
  try {
    const waiting = waitWithLimit(
      call('search:page', [query], {
        onEvent: (event: { type?: string; message?: string }) => {
          if (event?.type === 'status' && event.message) {
            // Still working, and saying so: the clock starts again rather than running out mid-search.
            waiting.touch()
            status(event.message)
          }
        }
      })
    )
    const page = (await waiting.answer) as ComposedPage
    if (!page?.web?.length && !page?.answer && !page?.knowledge) {
      return status(`Nothing was found for “${query}”.`, () => void search())
    }
    const body = $('body')
    body.replaceChildren()
    const holder = el('div', 'mod-page')
    body.append(holder)
    renderComposedPage(holder, page, {
      onSearch: (next) => { location.href = pageUrl(next, 'all') },
      onVertical: (next) => { location.href = pageUrl(query, next as SearchVertical) },
      onRetry: () => void composed()
    })
    body.append(footLine(page.web.length, page.tookMs, true))
    syncPins()
  } catch (err) {
    // The composer is the better page, not the only one: if it cannot run, the plain list still can.
    try {
      const outcome = (await waitWithLimit(call('search:run', [query, 'all'])).answer) as Outcome
      const results = tidyResults((outcome.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet ?? '' })), 12) as Result[]
      if (!results.length) return status(downMessage(err), () => void search())
      renderResults(results, outcome, 'all')
    } catch {
      status(downMessage(err), () => void search())
    }
  }
}

async function search(): Promise<void> {
  if (!query) return status('Search the web with Orbis. Type in the address bar above.')
  if (vertical === 'orion') return void orion()
  // Pages are on this machine, so being offline is not a reason not to look. Every other vertical asks somebody.
  if (vertical !== 'pages' && !navigator.onLine) return status(downMessage(null), () => void search())
  status(vertical === 'all' ? 'Searching the web…' : `Searching ${LABEL[vertical].toLowerCase()}…`)

  // ALL is composed: the query is understood, and only the sections it earns are built, each from something real.
  // The other verticals are one list of one kind of thing, which is what they are for, and stay as they were.
  if (vertical === 'all') return void composed()

  try {
    const outcome = (await waitWithLimit(call('search:run', [query, vertical])).answer) as Outcome
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

// ---------------------------------------------------------------- pictures, as a board

/**
 * The Images board: a wall of pictures on the left, and one picture opened beside it on the right.
 *
 * Pictures are not a list. A list makes every result the same height and the same shape, which is exactly the
 * information a picture carries -- a tall portrait and a wide diagram are different things before you have read a word
 * of either. So the wall keeps each picture's own proportions and lets the columns fall where they fall, and choosing
 * one opens it *beside* the wall rather than on top of it, so the next picture is always one glance away.
 *
 * That is the whole argument for the shape. The rest of this is the detail that makes it usable: where the selection
 * goes, what the arrows do, what a picture will and will not claim about itself.
 *
 * What it refuses to do is invent. A picture's size badge appears when the result really carries a size, its site line
 * when the result really names a site, and the chips across the top only when Orbis really found related searches. A
 * board that fills its gaps with plausible-looking furniture is a board that lies about what was found.
 */

interface BoardState {
  /** Which picture is open beside the wall, or null when the wall has it to itself. */
  open: number | null
  /** The element the board lives in, which widens and narrows as the panel opens and closes. */
  host: HTMLElement | null
  /** The tiles, by index, so the selection can be moved without redrawing the wall. */
  tiles: HTMLElement[]
  panel: HTMLElement
}

const board: BoardState = { open: null, host: null, tiles: [], panel: el('aside', 'imgpanel') }

/** How many pictures of the wall the panel's own "more like this" strip shows. */
const RELATED_IN_PANEL = 10

/** A picture's real pixel size, or nothing. Never guessed from the thumbnail, which is not the picture. */
const sizeOf = (r: Result): string | null => (r.width && r.height ? `${r.width} × ${r.height}` : null)

/** One tile on the wall: the picture, what it is called, and where it came from. */
function imageTile(r: Result, i: number): HTMLElement {
  const b = button('imgtile', '', () => openBeside(i))
  b.setAttribute('aria-label', `${r.title} — ${r.site}`)
  b.title = `${r.title} — ${r.site}`
  const thumb = safeUrl(r.thumbnail ?? r.image)
  const frame = el('span', 'imgtile-frame')
  if (thumb) {
    const img = el('img')
    img.src = thumb
    img.alt = r.title
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    // The picture's own proportions, so the wall is a wall and not a grid of identical boxes. Known before it loads
    // where the result said so, which is what stops the columns jumping as pictures arrive.
    if (r.width && r.height) img.style.aspectRatio = `${r.width} / ${r.height}`
    img.addEventListener('error', () => b.remove())
    frame.append(img)
  }
  b.append(frame, el('span', 'imgtile-title', r.title))
  const href = safeUrl(r.url)
  if (href) b.append(siteLine(href, r.site))
  return b
}

/** The wall. Real masonry, so nothing is cropped to make the rows line up. */
function imageWall(results: Result[]): HTMLElement {
  const wall = el('div', 'imgwall')
  wall.setAttribute('role', 'listbox')
  wall.setAttribute('aria-label', 'Pictures')
  board.tiles = []
  results.forEach((r, i) => {
    const tile = imageTile(r, i)
    tile.setAttribute('role', 'option')
    tile.setAttribute('aria-selected', 'false')
    board.tiles[i] = tile
    wall.append(tile)
  })
  return wall
}

/** Marks which tile is open, and brings it into view when the arrows moved it off screen. */
function markOpen(i: number | null): void {
  board.tiles.forEach((tile, n) => {
    const on = n === i
    tile.classList.toggle('on', on)
    tile.setAttribute('aria-selected', String(on))
  })
  if (i !== null) board.tiles[i]?.scrollIntoView({ block: 'nearest' })
}

/** Closes the panel and gives the wall the width back. */
function closeBeside(): void {
  board.open = null
  board.panel.hidden = true
  board.host?.classList.remove('with-panel')
  markOpen(null)
}

/**
 * The overflow menu, with the things that can really be done to a result.
 *
 * Each entry does something. An entry that only looks like an option is worse than no menu: it teaches somebody that
 * the menu is decoration.
 */
function resultMenu(r: Result, anchor: HTMLElement): void {
  const existing = document.querySelector('.imgmenu')
  if (existing) {
    existing.remove()
    return
  }
  const menu = el('div', 'imgmenu')
  menu.setAttribute('role', 'menu')
  const item = (name: keyof typeof PATHS, label: string, act: () => void): HTMLElement => {
    const b = button('imgmenu-item', '', () => {
      menu.remove()
      act()
    })
    b.setAttribute('role', 'menuitem')
    b.append(icon(name, 16), el('span', undefined, label))
    return b
  }
  menu.append(
    item('bookmark', 'Save', () => void saveResult(r)),
    item('share', 'Share', async () => {
      try {
        await navigator.clipboard.writeText(r.url)
        toast('Link copied.')
      } catch {
        toast('The link could not be copied.')
      }
    }),
    item('external', 'Open the page it came from', () => window.open(safeUrl(r.url) ?? '', '_blank', 'noopener,noreferrer')),
    ...(r.image ? [item('download', 'Open the full-size picture', () => window.open(safeUrl(r.image) ?? '', '_blank', 'noopener,noreferrer'))] : []),
    item('trash', 'Hide this result', () => {
      // Hidden for this page only, and said out loud. Nothing is remembered about it, because nothing asked to be.
      const at = shown.indexOf(r)
      if (at >= 0) board.tiles[at]?.remove()
      closeBeside()
      toast('Hidden from these results.')
    })
  )
  document.body.append(menu)
  const box = anchor.getBoundingClientRect()
  menu.style.top = `${Math.round(box.bottom + 6)}px`
  menu.style.right = `${Math.round(window.innerWidth - box.right)}px`
  const away = (e: Event): void => {
    if (!menu.contains(e.target as Node)) {
      menu.remove()
      document.removeEventListener('pointerdown', away, true)
    }
  }
  document.addEventListener('pointerdown', away, true)
  ;(menu.firstElementChild as HTMLElement | null)?.focus()
}

/** Keeping a picture, through Orbis's own notes. Real, or it says it could not. */
async function saveResult(r: Result): Promise<void> {
  try {
    await call('notes:create', [{ title: r.title, body: `${r.url}${r.site ? `

From ${r.site}` : ''}` }])
    toast('Saved to your notes.')
  } catch {
    toast('That could not be saved.')
  }
}

/** Opens picture `i` beside the wall. */
function openBeside(i: number): void {
  const r = shown[i]
  if (!r) return
  board.open = i
  const href = safeUrl(r.url) ?? ''
  const full = safeUrl(r.image ?? r.thumbnail)
  const panel = board.panel
  panel.replaceChildren()
  panel.hidden = false
  board.host?.classList.add('with-panel')
  markOpen(i)

  // ---- who it belongs to, and the way through the set
  const head = el('header', 'imgpanel-head')
  if (href) head.append(siteLine(href, r.site))
  const nav = el('span', 'imgpanel-nav')
  const back = iconButton('', 'prev', () => openBeside(i - 1), 'Previous picture', 18)
  back.disabled = i === 0
  const on = iconButton('', 'next', () => openBeside(i + 1), 'Next picture', 18)
  on.disabled = i >= shown.length - 1
  const more = iconButton('', 'more', () => resultMenu(r, more), 'More', 18)
  nav.append(back, on, more, iconButton('', 'close', closeBeside, 'Close (Esc)', 18))
  head.append(nav)

  // ---- the picture itself
  const stage = el('div', 'imgpanel-stage')
  if (full) {
    const img = el('img')
    img.src = full
    img.alt = r.title
    img.referrerPolicy = 'no-referrer'
    img.addEventListener('error', () => {
      stage.replaceChildren(el('p', 'imgpanel-none', 'This picture could not be loaded.'))
    })
    stage.append(img)
    // Ask Orion about this picture: Orbis's own answer to the question a magnifier asks, and it goes to the same Orion
    // the rest of Orbis uses rather than to anybody else's service.
    stage.append(
      iconButton('imgpanel-lens', 'lens', () => {
        location.href = pageUrl(`${r.title} ${r.site}`, 'orion')
      }, 'Ask Orion about this picture', 18)
    )
    const size = sizeOf(r)
    // Only when the result really carries a size. A badge reading "unknown" is noise; an invented one is a lie.
    if (size) stage.append(el('span', 'imgpanel-size', size))
  } else {
    stage.append(el('p', 'imgpanel-none', 'There is no picture to show for this result.'))
  }

  // ---- what it is, and what can be done about it
  const title = el('h2', 'imgpanel-title', r.title)
  const visit = el('a', 'imgpanel-visit')
  visit.href = href
  visit.target = '_blank'
  visit.rel = 'noopener noreferrer'
  visit.append(el('span', undefined, 'Visit'), icon('next', 14))
  const titleRow = el('div', 'imgpanel-titlerow')
  titleRow.append(title, visit)

  const acts = el('div', 'imgpanel-acts')
  const share = button('imgpanel-act', '', async () => {
    try {
      const nav2 = navigator as Navigator & { share?: (d: { title?: string; url: string }) => Promise<void> }
      if (nav2.share) await nav2.share({ url: r.url, title: r.title })
      else {
        await navigator.clipboard.writeText(r.url)
        toast('Link copied.')
      }
    } catch {
      /* dismissed, or refused: nothing to say */
    }
  })
  share.append(icon('share', 15), el('span', undefined, 'Share'))
  const save = button('imgpanel-act', '', () => void saveResult(r))
  save.append(icon('bookmark', 15), el('span', undefined, 'Save'))
  acts.append(share, save)

  panel.append(head, stage, titleRow, acts)

  // ---- more of the same wall, so the panel is a place to keep looking rather than a dead end
  const others = shown.map((other, n) => ({ other, n })).filter(({ n }) => n !== i).slice(0, RELATED_IN_PANEL)
  if (others.length) {
    const strip = el('div', 'imgpanel-more')
    strip.setAttribute('aria-label', 'More pictures')
    for (const { other, n } of others) strip.append(imageTile(other, n))
    panel.append(strip)
  }
  panel.scrollTop = 0
}

/**
 * The chips across the top: other searches Orbis really found for this one.
 *
 * Only when there are some. An empty strip where chips would be is a promise the page did not keep, and it takes up
 * exactly as much room as a full one.
 */
function relatedChips(terms: string[], active: string | null): HTMLElement | null {
  if (!terms.length) return null
  const strip = el('div', 'imgchips')
  strip.setAttribute('role', 'list')
  const row = el('div', 'imgchips-row')
  if (active) {
    const off = button('imgchip on', '', () => {
      location.href = pageUrl(query, 'images')
    })
    off.append(icon('close', 13), el('span', undefined, active))
    off.setAttribute('aria-label', `Stop narrowing by ${active}`)
    row.append(off)
  }
  for (const term of terms) {
    const chip = el('a', 'imgchip')
    chip.href = pageUrl(`${query} ${term}`, 'images')
    chip.append(el('span', undefined, term))
    chip.setAttribute('role', 'listitem')
    row.append(chip)
  }
  const scroll = (by: number) => row.scrollBy({ left: by, behavior: 'smooth' })
  const left = iconButton('imgchips-step left', 'prev', () => scroll(-320), 'Scroll left', 16)
  const right = iconButton('imgchips-step right', 'next', () => scroll(320), 'Scroll right', 16)
  const ends = (): void => {
    left.hidden = row.scrollLeft < 8
    right.hidden = row.scrollLeft + row.clientWidth > row.scrollWidth - 8
  }
  row.addEventListener('scroll', ends, { passive: true })
  strip.append(left, row, right)
  requestAnimationFrame(ends)
  return strip
}

/**
 * Asks for the related searches and puts the chips up if there are any.
 *
 * After the wall, deliberately. The pictures are what somebody came for and they are already there; the chips are a
 * second thought that arrives from a slower place, and holding the pictures back for them would trade the thing that
 * matters for the thing that does not.
 */
async function addRelatedChips(host: HTMLElement): Promise<void> {
  let terms: string[] = []
  try {
    const got = (await call('search:related', [query])) as string[]
    terms = Array.isArray(got) ? got.filter((t) => typeof t === 'string' && t.trim()).slice(0, 12) : []
  } catch {
    return // No chips is a fine page. A failed strip is not worth saying anything about.
  }
  const strip = relatedChips(terms, null)
  if (strip) host.prepend(strip)
}

/** Draws the whole board. */
function renderImageBoard(results: Result[], host: HTMLElement): void {
  shown = results
  board.open = null
  board.host = host
  board.panel = el('aside', 'imgpanel')
  board.panel.hidden = true
  board.panel.setAttribute('aria-label', 'The picture you opened')
  const main = el('div', 'imgmain')
  main.append(imageWall(results), board.panel)
  host.append(main)

  // The arrows walk the wall, and Escape puts it away. On the document, because the panel is open whatever happens to
  // hold focus, and bound once per board rather than once per tile.
  document.addEventListener('keydown', (e) => {
    if (board.open === null || !document.body.contains(host)) return
    // Never steal a key from somebody typing in the search box above.
    const on = document.activeElement
    if (on instanceof HTMLInputElement || on instanceof HTMLTextAreaElement) return
    if (e.key === 'ArrowRight' && board.open < shown.length - 1) {
      e.preventDefault()
      openBeside(board.open + 1)
    } else if (e.key === 'ArrowLeft' && board.open > 0) {
      e.preventDefault()
      openBeside(board.open - 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeBeside()
    }
  })
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
      // The whole row on hover: the title, the site, and what the citation was about.
      a.title = `${source.title} — ${source.site}${source.snippet ? `\n\n${source.snippet}` : ''}`
      /*
       * Icon, title, number. In that order and that importance.
       *
       * It used to lead with a large numbered box, which is the least useful thing on the row: the number matters
       * when following a citation from the text, and the rest of the time it is a box of nothing. The site's own icon
       * says where the link goes before a word is read, so it goes first and the number shrinks to a quiet marker.
       */
      const tile = faviconTile(href, source.site)
      if (tile) a.append(tile)
      a.append(el('span', 'srct', source.title), el('span', 'n', String(i + 1)))
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
  void paintIcons()
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
