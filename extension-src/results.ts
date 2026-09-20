import { readBang, siteOf, tidyResults, VERTICALS, wantsAnswer } from '../src/shared/orbisSearch.ts'
import type { SearchVertical } from '../src/shared/orbisSearch.ts'
// @ts-expect-error the helper client is plain JavaScript shared with the side panel
import { call, HelperDown } from '../extension/helper.js'

/**
 * Orbis Search, as the page a search in the Chromium browser lands on. It is Chromium's own default search engine (Orbis Search,
 * `results.html?q=…`), so typing in the address bar, the new-tab search box and "search for …" in a context menu all arrive here, and
 * nothing is sent to Google, or anywhere else, until the web is actually searched.
 *
 * It mirrors the Electron build's results page: a search box, the verticals (Orion, All, Images, …), results shown with the site
 * they really came from, and a plain link to search Google instead for when that is what someone wants. Results are the search
 * provider's real results; nothing here is invented. Orion's answer is written from real pages, with the pages it used listed.
 */

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const LABEL: Record<SearchVertical, string> = { orion: 'Orion', all: 'All', images: 'Images', videos: 'Videos', news: 'News', maps: 'Maps', music: 'Music', science: 'Science', files: 'Files', social: 'Social' }

interface Result { title: string; url: string; snippet?: string; site: string; thumbnail?: string; image?: string; durationSec?: number }
interface Source { n: number; title: string; url: string; domain: string; published?: string }

// The query travels in the fragment, not in a query string: the browser's first navigation to an extension page fails when the address
// has a query string (found by testing this build), and a fragment loads reliably. A query string is still read, for old links.
const params = new URLSearchParams(location.hash ? location.hash.slice(1) : location.search)
const query = (params.get('q') ?? '').trim()
const wanted = params.get('in') as SearchVertical | null
const vertical: SearchVertical = wanted && VERTICALS.includes(wanted) ? wanted : 'all'

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
const pageUrl = (q: string, v: SearchVertical): string => `results.html#q=${encodeURIComponent(q)}${v === 'all' ? '' : `&in=${v}`}`

// A bang asks for a particular site (`!g cats`): that is the person's explicit choice, so it goes there.
const bang = readBang(query)
if (bang) location.replace(`${bang.site.url}${encodeURIComponent(bang.query)}`)

document.title = query ? `${query} · Orbis Search` : 'Orbis Search'
;($('q') as HTMLInputElement).value = query

$('search').addEventListener('submit', (e) => {
  e.preventDefault()
  const typed = ($('q') as HTMLInputElement).value.trim()
  if (typed) location.href = pageUrl(typed, vertical)
})

// ---------------------------------------------------------------- the verticals

const nav = $('verticals')
for (const name of VERTICALS) {
  const a = el('a', `vertical${name === 'orion' ? ' orion' : ''}${name === vertical ? ' on' : ''}`, LABEL[name])
  a.href = pageUrl(query, name)
  if (name === vertical) a.setAttribute('aria-current', 'page')
  nav.append(a)
}

const status = (text: string): void => {
  const p = el('p', 'status', text)
  $('body').replaceChildren(p)
}

// ---------------------------------------------------------------- results

function renderWeb(results: Result[], tookMs: number): void {
  const list = el('ol', 'results')
  for (const r of results) {
    const href = safeUrl(r.url)
    if (!href) continue
    const li = el('li')
    const a = el('a', 'result')
    a.href = href
    const site = el('span', 'site')
    const icon = el('img', 'favicon')
    icon.alt = ''
    icon.width = 16
    icon.height = 16
    icon.src = `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(href)}&size=16`
    site.append(icon, el('span', 'site-name', r.site || siteOf(href)))
    a.append(site, el('b', 'title', r.title), ...(r.snippet ? [el('span', 'snippet', r.snippet)] : []))
    li.append(a)
    list.append(li)
  }
  const foot = el('footer', 'foot')
  foot.append(document.createTextNode(`${list.children.length} results in ${(tookMs / 1000).toFixed(1)}s · searched by Orbis, not by anyone watching you · `))
  const elsewhere = el('a', 'elsewhere', 'try Google instead')
  elsewhere.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`
  foot.append(elsewhere)
  $('body').replaceChildren(list, foot)
}

function renderGrid(results: Result[], tookMs: number, category: SearchVertical): void {
  const images = category === 'images'
  const list = el('ul', images ? 'images' : 'results')
  for (const r of results) {
    const href = safeUrl(r.url)
    if (!href) continue
    const li = el('li')
    const a = el('a', images ? 'image' : 'result')
    a.href = href
    const thumb = safeUrl(r.thumbnail ?? r.image)
    if (thumb) {
      const img = el('img', 'thumb')
      img.src = thumb
      img.alt = r.title
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      a.append(img)
    }
    if (!images) a.append(el('span', 'site', r.site || siteOf(href)), el('b', 'title', r.title), ...(r.snippet ? [el('span', 'snippet', r.snippet)] : []))
    else a.append(el('span', 'caption', r.title))
    li.append(a)
    list.append(li)
  }
  $('body').replaceChildren(list, el('footer', 'foot', `${list.children.length} results in ${(tookMs / 1000).toFixed(1)}s · searched by Orbis, not by anyone watching you`))
}

async function search(): Promise<void> {
  if (!query) return status('Search the web with Orbis.')
  if (vertical === 'orion') return void askOrion()
  status(vertical === 'all' ? 'Searching the web…' : `Searching ${LABEL[vertical].toLowerCase()}…`)
  try {
    const outcome = (await call('search:run', [query, vertical])) as { results?: Result[]; problem?: string | null; tookMs?: number; unavailable?: string[] }
    const results = vertical === 'all' ? tidyResults((outcome.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet ?? '' })), 12) : (outcome.results ?? [])
    if (!results.length) return status(outcome.problem || 'Nothing was found.')
    if (vertical === 'all') renderWeb(results, outcome.tookMs ?? 0)
    else renderGrid(results, outcome.tookMs ?? 0, vertical)
    if (outcome.unavailable?.length) $('body').append(el('p', 'foot', `${outcome.unavailable.length === 1 ? 'One source' : `${outcome.unavailable.length} sources`} could not be reached: ${outcome.unavailable.join(', ')}.`))
    if (vertical === 'all' && wantsAnswer(query)) $('body').prepend(orionCard())
  } catch (err) {
    status(err instanceof HelperDown ? `${(err as Error).message} Orbis Search runs on this computer; start Orbis and reload.` : (err as Error).message || 'The search did not work.')
  }
}

// ---------------------------------------------------------------- Orion

/** A prompt on the web results, when the question looks like one Orion could answer: it asks, it never answers unasked. */
function orionCard(): HTMLElement {
  const card = el('section', 'ask')
  const a = el('a', 'ask-link', 'Ask Orion about this, with sources')
  a.href = pageUrl(query, 'orion')
  card.append(a)
  return card
}

function renderAnswer(target: HTMLElement, text: string, sources: Source[]): void {
  const byNumber = new Map(sources.map((s) => [s.n, s]))
  const nodes = text.split(/(\[\d{1,2}\])/g).map((part): Node => {
    const m = /^\[(\d{1,2})\]$/.exec(part)
    const source = m && byNumber.get(Number(m[1]))
    const href = source && safeUrl(source.url)
    if (!href || !source) return document.createTextNode(part)
    const a = el('a', 'cite', part)
    a.href = href
    a.title = source.title
    return a
  })
  target.replaceChildren(...nodes)
}

async function askOrion(): Promise<void> {
  status('Asking Orion…')
  const answer = el('div', 'answer')
  answer.setAttribute('aria-live', 'polite')
  const sourcesBox = el('div', 'sources')
  let text = ''
  let sources: Source[] = []
  try {
    const models = (await call('models:list')) as { default: string }
    await call('chat:send', [{ model: models.default, webSearch: true, messages: [{ role: 'user', content: query }] }], {
      onEvent: (event: { type: string; content?: string; research?: { sources?: Source[] }; message?: string }) => {
        if (event.type === 'research') {
          sources = event.research?.sources ?? []
          sourcesBox.replaceChildren(...sourcesList(sources))
        } else if (event.type === 'delta' && typeof event.content === 'string') {
          if (!text) $('body').replaceChildren(answer, sourcesBox)
          text += event.content
          renderAnswer(answer, text, sources)
        } else if (event.type === 'status' && !text) status(event.message ?? 'Orion is reading the web…')
        else if (event.type === 'error') $('body').append(el('p', 'status', event.message ?? 'Orion could not answer.'))
      }
    })
    if (!text) status('Orion did not write an answer.')
    else answer.after(el('small', 'muted', 'Written from the pages listed, read just now. The numbers say which page.'))
  } catch (err) {
    status(err instanceof HelperDown ? (err as Error).message : (err as Error).message || 'Orion could not answer.')
  }
}

function sourcesList(sources: Source[]): Node[] {
  const out: Node[] = [el('h2', 'sources-title', 'Sources')]
  for (const s of sources) {
    const href = safeUrl(s.url)
    const row = el('div', 'source')
    row.append(el('span', 'n', `[${s.n}]`))
    if (href) {
      const a = el('a', undefined, s.title || s.domain)
      a.href = href
      row.append(a)
    } else row.append(document.createTextNode(s.title || s.domain))
    row.append(el('span', 'muted', ` — ${s.domain}${s.published ? `, ${s.published}` : ''}`))
    out.push(row)
  }
  return out
}

// The address only changes after the #, so the page does not reload by itself: a new search or another vertical asks for a fresh page.
window.addEventListener('hashchange', () => location.reload())

void search()
