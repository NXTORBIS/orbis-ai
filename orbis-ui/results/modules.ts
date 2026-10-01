import { NO_ANSWER } from '../../src/shared/searchModules.ts'
import type { AskedQuestion, KnowledgeEntity, NormalizedResult, RelatedEntity } from '../../src/shared/searchModules.ts'
// @ts-expect-error the helper client is plain JavaScript shared with the side panel
import { call } from '../panel/helper.js'

/**
 * Drawing a results page that is different for every query.
 *
 * The composer (src/helper/searchPage.ts) decides which sections a query earns and fills them from real pages. This
 * draws whatever came back, in the order it came back, and -- the part that matters -- draws nothing for a section
 * that came back empty. A heading with no content under it is a claim that Orbis looked and found nothing worth
 * showing, which is rarely what happened and is never what should be implied.
 *
 * Three rules run through all of it:
 *
 *   - A fact shows where it came from. Every knowledge row, every answer, every related entity links to its page.
 *   - A section that failed says so, with a way to try again (§64), instead of quietly not existing.
 *   - Nothing is drawn from nothing. "Information unavailable" is a real answer and appears as one (§18).
 */

export interface ComposedPage {
  query: string
  searched: string
  correction: { corrected: string; original: string; because: string; confidence: number } | null
  intent: string
  modules: { module: string; because: string }[]
  answer: { kind: string; expression: string; value: string } | null
  timeline: { when: string; what: string; year: number | null; provenance: { url: string; site: string } }[]
  comparison: {
    left: string
    right: string
    table: {
      columns: { key: string; label: string; filled: number }[]
      rows: { itemId: string; title: string; url: string; cells: Record<string, { value: string; quote: string; url: string } | null> }[]
    }
  } | null
  definition: {
    word: string
    language: string
    parts: { label: string; senses: { text: string; example?: string }[] }[]
    source: { url: string; site: string; licence: string }
  } | null
  weather: {
    place: string
    forecast: {
      place: string
      updatedAt: number
      now: { temperature: number; humidity?: number; windSpeed?: number; condition: string; symbol: string }
      high?: number
      low?: number
      hours: { at: number; temperature: number; symbol: string; condition: string }[]
      attribution: string
    }
  } | null
  knowledge: KnowledgeEntity | null
  web: NormalizedResult[]
  images: NormalizedResult[]
  videos: NormalizedResult[]
  news: NormalizedResult[]
  sports: NormalizedResult[]
  places: { name: string; address: string; kind: string; url: string; directions?: string }[]
  placesNote: string
  peopleAlsoAsk: AskedQuestion[]
  peopleAlsoSearchFor: RelatedEntity[]
  relatedSearches: string[]
  unavailable: { module: string; problem: string }[]
  tookMs: number
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const safe = (url: string): string | null => (/^https?:\/\//i.test(url) ? url : null)

/** A heading, in the one style every section uses, so the page reads as one page. */
const heading = (text: string): HTMLElement => el('h2', 'mod-h', text)

/** A link that says where it goes, because a source nobody can check is not a source. */
function sourceLink(url: string, label?: string): HTMLAnchorElement | null {
  const href = safe(url)
  if (!href) return null
  const a = el('a', 'mod-src')
  a.href = href
  a.rel = 'noreferrer'
  let site = href
  try {
    site = new URL(href).hostname.replace(/^www\./, '')
  } catch {
    // The address is what it is; showing it whole is better than showing nothing.
  }
  a.textContent = label ?? site
  a.title = href
  return a
}

// ---------------------------------------------------------------- the sections

/** "These are results for…", with the original one click away (§6, §8). */
function correctionNode(page: ComposedPage, onSearch: (query: string) => void): HTMLElement | null {
  if (!page.correction) return null
  const box = el('div', 'mod-correction')
  const showing = el('p', 'mod-showing')
  showing.append(document.createTextNode('These are results for '))
  const corrected = el('button', 'mod-link', page.correction.corrected)
  corrected.type = 'button'
  corrected.addEventListener('click', () => onSearch(page.correction!.corrected))
  showing.append(corrected)
  const instead = el('p', 'mod-instead')
  instead.append(document.createTextNode('Search instead for '))
  const original = el('button', 'mod-link', page.correction.original)
  original.type = 'button'
  original.addEventListener('click', () => onSearch(page.correction!.original))
  instead.append(original)
  box.append(showing, instead)
  return box
}

/** A sum or a conversion, worked out exactly rather than searched for (§38, §40, §41). */
function answerNode(page: ComposedPage): HTMLElement | null {
  if (!page.answer) return null
  const box = el('section', 'mod-answer')
  box.append(el('p', 'mod-expr', page.answer.expression), el('p', 'mod-value', page.answer.value))
  box.append(el('p', 'mod-note', page.answer.kind === 'calculation' ? 'Calculated by Orbis' : 'Converted by Orbis'))
  return box
}

/**
 * A life or a history, in order (§45). Every entry links to the page that says it.
 */
function timelineNode(entries: ComposedPage['timeline']): HTMLElement {
  const box = el('section', 'mod-timeline')
  box.append(heading('Timeline'))
  const list = el('ol', 'mod-times')
  for (const entry of entries) {
    const li = el('li')
    li.append(el('span', 'mod-when', entry.when), el('span', 'mod-what', entry.what))
    const where = sourceLink(entry.provenance.url)
    if (where) li.append(where)
    list.append(li)
  }
  box.append(list)
  return box
}

/**
 * Two things side by side (§46).
 *
 * The same table the comparison tray draws, and the same rule under it: a value is here because a page said it, and a
 * blank is here because no page did. "not stated" is a real result and is shown as one.
 */
function comparisonNode(comparison: NonNullable<ComposedPage['comparison']>): HTMLElement {
  const box = el('section', 'mod-vs')
  box.append(heading(`${comparison.left} vs ${comparison.right}`))
  const wrap = el('div', 'cmp-wrap')
  const table = el('table', 'cmp')

  const head = el('tr')
  head.append(el('th', 'what', ''))
  for (const row of comparison.table.rows) head.append(el('th', undefined, row.title))
  const thead = el('thead')
  thead.append(head)
  table.append(thead)

  const body = el('tbody')
  for (const column of comparison.table.columns) {
    const tr = el('tr')
    tr.append(el('th', 'what', column.label))
    for (const row of comparison.table.rows) {
      const cell = row.cells[column.key]
      const td = el('td')
      if (!cell) {
        td.append(el('span', 'unsaid', 'not stated'))
      } else {
        const value = el('span', 'val', cell.value)
        value.title = `"${cell.quote}"`
        td.append(value, el('span', 'why', cell.quote))
      }
      tr.append(td)
    }
    body.append(tr)
  }
  table.append(body)
  wrap.append(table)
  box.append(wrap)
  return box
}

/**
 * A dictionary entry (§39).
 *
 * Wiktionary's words, not Orbis's. The link and the licence are shown because Wiktionary's terms require them, and
 * because a definition nobody can trace is indistinguishable from one that was invented.
 */
function definitionNode(entry: NonNullable<ComposedPage['definition']>): HTMLElement {
  const box = el('section', 'mod-define')
  const head = el('div', 'mod-define-head')
  head.append(el('h2', 'mod-word', entry.word))
  head.append(el('span', 'mod-lang', entry.language))
  box.append(head)

  for (const part of entry.parts) {
    box.append(el('p', 'mod-pos', part.label))
    const list = el('ol', 'mod-senses')
    for (const sense of part.senses) {
      const li = el('li')
      li.append(document.createTextNode(sense.text))
      // An example is the entry's own, shown as a quotation rather than as part of the definition.
      if (sense.example) li.append(el('q', 'mod-example', sense.example))
      list.append(li)
    }
    box.append(list)
  }

  const source = el('p', 'mod-note')
  const link = el('a', 'mod-src')
  link.href = entry.source.url
  link.rel = 'noreferrer'
  link.textContent = entry.source.licence
  source.append(link)
  box.append(source)
  return box
}

/**
 * The forecast (§42).
 *
 * Real numbers from the real forecast service, with the attribution its licence requires and the time the forecast was
 * made -- not the time Orbis fetched it, because a forecast is only as fresh as when the meteorologists made it.
 */
function weatherNode(weather: NonNullable<ComposedPage['weather']>): HTMLElement {
  const f = weather.forecast
  const box = el('section', 'mod-weather')
  const head = el('div', 'mod-weather-head')
  head.append(el('h2', 'mod-weather-place', f.place || weather.place))
  box.append(head)

  const now = el('div', 'mod-weather-now')
  now.append(el('p', 'mod-temp', `${Math.round(f.now.temperature)}°`))
  const about = el('div', 'mod-weather-about')
  about.append(el('p', 'mod-cond', f.now.condition))
  const range = [f.high !== undefined ? `High ${Math.round(f.high)}°` : '', f.low !== undefined ? `Low ${Math.round(f.low)}°` : '']
    .filter(Boolean)
    .join(' · ')
  if (range) about.append(el('p', 'mod-range', range))
  const extra = [
    f.now.humidity !== undefined ? `Humidity ${Math.round(f.now.humidity)}%` : '',
    f.now.windSpeed !== undefined ? `Wind ${Math.round(f.now.windSpeed)} m/s` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  if (extra) about.append(el('p', 'mod-range', extra))
  now.append(about)
  box.append(now)

  if (f.hours.length) {
    const hours = el('div', 'mod-hours')
    for (const hour of f.hours.slice(0, 8)) {
      const cell = el('div', 'mod-hour')
      cell.append(
        el('span', 'mod-hour-at', new Date(hour.at).toLocaleTimeString([], { hour: 'numeric' })),
        el('span', 'mod-hour-t', `${Math.round(hour.temperature)}°`)
      )
      cell.title = hour.condition
      hours.append(cell)
    }
    box.append(hours)
  }

  // When the forecast was made, and who made it. Both are required, and both are true.
  box.append(el('p', 'mod-note', `${f.attribution} · forecast made ${new Date(f.updatedAt).toLocaleString()}`))
  return box
}

/** The About panel (§10, §25, §26). Every row carries the page it came from. */
function knowledgeNode(entity: KnowledgeEntity): HTMLElement {
  const box = el('aside', 'mod-know')
  box.setAttribute('aria-label', `About ${entity.name}`)
  const image = entity.image && safe(entity.image.url)
  if (image) {
    const img = el('img', 'mod-know-img')
    img.src = image
    img.alt = entity.name
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    img.addEventListener('error', () => img.remove())
    box.append(img)
  }
  box.append(el('h2', 'mod-know-name', entity.name))
  if (entity.description) box.append(el('p', 'mod-know-kind', entity.description))

  if (entity.about) {
    box.append(heading('About'))
    box.append(el('p', 'mod-know-about', entity.about.text))
    const where = sourceLink(entity.about.provenance.url)
    if (where) box.append(where)
  }

  if (entity.facts.length) {
    const list = el('dl', 'mod-facts')
    for (const fact of entity.facts) {
      list.append(el('dt', undefined, fact.label))
      const dd = el('dd')
      dd.append(document.createTextNode(fact.value))
      const where = sourceLink(fact.provenance.url)
      // Each row, not just the panel: a panel drawn from four pages should say which row came from which.
      if (where) dd.append(where)
      list.append(dd)
    }
    box.append(list)
  }

  if (entity.official.length) {
    box.append(heading('Official'))
    const links = el('ul', 'mod-official')
    for (const link of entity.official) {
      const li = el('li')
      const a = sourceLink(link.url, link.label)
      if (a) { li.append(a); links.append(li) }
    }
    if (links.childElementCount) box.append(links)
  }
  return box
}

/*
 * Every row wears its own site's icon.
 *
 * This page used to show one only when the search provider happened to supply a `favicon` field, and most do not --
 * so a page of results was a wall of plain blue links with nothing to tell one site from another at a glance.
 *
 * The helper asks each site for its own icon, once per host, the same way the older results page does. Until one
 * arrives -- and for a site that has none -- the tile carries the site's first letter, so a row is never a hole and
 * nothing moves when the real icon lands.
 */
const iconKnown = new Map<string, string | null>()
const iconTiles = new Map<string, HTMLElement[]>()
let iconsAsked = false

function hostOf(href: string): string {
  try {
    return new URL(href).host.toLowerCase()
  } catch {
    return ''
  }
}

function wearIcon(tile: HTMLElement, src: string): void {
  const img = el('img') as HTMLImageElement
  img.src = src
  img.alt = ''
  img.width = 16
  img.height = 16
  img.loading = 'lazy'
  // A broken icon falls back to the letter rather than leaving a gap where an icon was promised.
  img.addEventListener('error', () => {
    tile.classList.add('letter')
    tile.textContent = tile.dataset.letter ?? '?'
  })
  tile.classList.remove('letter')
  tile.replaceChildren(img)
}

function siteIcon(href: string, name: string): HTMLElement {
  const host = hostOf(href)
  const tile = el('span', 'mod-favicon letter')
  const letter = (name || host).replace(/^www\./, '').charAt(0).toUpperCase() || '?'
  tile.dataset.letter = letter
  tile.textContent = letter
  const known = host ? iconKnown.get(host) : undefined
  if (known) wearIcon(tile, known)
  else if (host) iconTiles.set(host, [...(iconTiles.get(host) ?? []), tile])
  return tile
}

/** Asks for every host on the page in one call and puts each icon in place as it arrives. */
async function paintIcons(): Promise<void> {
  const wanted = [...iconTiles.keys()].filter((host) => !iconKnown.has(host))
  if (!wanted.length) return
  let icons: Record<string, string | null> = {}
  try {
    /*
     * Addresses, not hosts.
     *
     * The channel parses each entry with `new URL` and keeps the host, so a bare "en.wikipedia.org" is not a URL,
     * parses to nothing, and is dropped -- which is why every row kept its stand-in letter and no icon ever arrived.
     */
    const answer = (await call('favicon:get', [wanted.slice(0, 60).map((host) => `https://${host}`)])) as {
      icons?: Record<string, string | null>
    }
    icons = answer?.icons ?? {}
  } catch {
    // No icons is a page of letters, which is the fallback working rather than a failure worth saying anything about.
    return
  }
  for (const [host, src] of Object.entries(icons)) {
    iconKnown.set(host, src)
    if (!src) continue
    for (const tile of iconTiles.get(host) ?? []) wearIcon(tile, src)
  }
}

/** Ordinary web results, with the site's identity rather than a number (§52, §53). */
function webNode(results: NormalizedResult[]): HTMLElement {
  const list = el('ol', 'mod-web')
  for (const result of results) {
    const href = safe(result.url)
    if (!href) continue
    const li = el('li')
    const site = el('div', 'mod-site')
    // The provider's own icon when it gave one; otherwise the site is asked for its own.
    const icon = safe(result.favicon ?? '')
    if (icon) {
      const tile = el('span', 'mod-favicon')
      wearIcon(tile, icon)
      site.append(tile)
    } else {
      site.append(siteIcon(href, result.domain))
    }
    site.append(el('span', undefined, result.domain))
    const link = el('a', 'mod-title')
    link.href = href
    link.rel = 'noreferrer'
    link.textContent = result.title
    li.append(site, link)
    if (result.description) li.append(el('p', 'mod-desc', result.description))
    list.append(li)
  }
  return list
}

/** A strip of pictures, only when the query was one pictures serve (§13, §14). */
function imageNode(results: NormalizedResult[], onMore: () => void): HTMLElement {
  const box = el('section', 'mod-pack')
  const head = el('div', 'mod-pack-head')
  head.append(heading('Images'))
  const more = el('button', 'mod-more', 'See all')
  more.type = 'button'
  more.addEventListener('click', onMore)
  head.append(more)
  box.append(head)
  const strip = el('div', 'mod-strip')
  for (const result of results.slice(0, 6)) {
    const src = safe(result.image ?? '')
    const href = safe(result.url)
    if (!src || !href) continue
    const a = el('a', 'mod-shot')
    a.href = href
    a.rel = 'noreferrer'
    a.title = `${result.title} — ${result.domain}`
    const img = el('img')
    img.src = src
    img.alt = result.title
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    img.addEventListener('error', () => a.remove())
    a.append(img)
    strip.append(a)
  }
  if (!strip.childElementCount) return el('div')
  box.append(strip)
  return box
}

/** Videos and news, which are the same shape with different words on them. */
function mediaNode(title: string, results: NormalizedResult[], onMore: () => void): HTMLElement {
  const box = el('section', 'mod-pack')
  const head = el('div', 'mod-pack-head')
  head.append(heading(title))
  const more = el('button', 'mod-more', 'See all')
  more.type = 'button'
  more.addEventListener('click', onMore)
  head.append(more)
  box.append(head)
  const row = el('div', 'mod-cards')
  for (const result of results.slice(0, 4)) {
    const href = safe(result.url)
    if (!href) continue
    const card = el('a', 'mod-card')
    card.href = href
    card.rel = 'noreferrer'
    const thumb = safe(result.image ?? '')
    if (thumb) {
      const img = el('img')
      img.src = thumb
      img.alt = ''
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      img.addEventListener('error', () => img.remove())
      card.append(img)
    }
    card.append(el('span', 'mod-card-title', result.title))
    const meta = [result.domain, typeof result.metadata.duration === 'string' ? result.metadata.duration : '', result.publishedAt ? new Date(result.publishedAt).toLocaleDateString() : '']
      .filter(Boolean)
      .join(' · ')
    card.append(el('small', undefined, meta))
    row.append(card)
  }
  if (!row.childElementCount) return el('div')
  box.append(row)
  return box
}

/**
 * Places (§37).
 *
 * What OpenStreetMap knows: the name, the kind of place, the address, and where it is on a map. No rating, no opening
 * hours, no telephone number -- the gazetteer does not hold them, so they are not shown, and the note underneath says
 * which are missing. An empty star rating would be a guess wearing the clothes of a fact.
 */
function placesNode(places: ComposedPage['places'], note: string): HTMLElement {
  const box = el('section', 'mod-places')
  box.append(heading('Places'))
  const list = el('ul', 'mod-place-list')
  for (const place of places.slice(0, 8)) {
    const href = safe(place.url)
    if (!href) continue
    const li = el('li')
    const link = el('a', 'mod-place-name')
    link.href = href
    link.rel = 'noreferrer'
    link.textContent = place.name
    li.append(link)
    if (place.kind) li.append(el('span', 'mod-place-kind', place.kind))
    if (place.address) li.append(el('p', 'mod-place-where', place.address))
    const directions = place.directions && safe(place.directions)
    if (directions) {
      const go = el('a', 'mod-place-go')
      go.href = directions
      go.rel = 'noreferrer'
      go.textContent = 'Directions'
      li.append(go)
    }
    list.append(li)
  }
  if (!list.childElementCount) return el('div')
  box.append(list)
  box.append(el('p', 'mod-note', note))
  return box
}

/**
 * Sports (§43), as coverage rather than as a scoreboard.
 *
 * Orbis has no scores feed, so there are no scores here. What there is, is the reporting: real articles from real
 * publications about the match. The line under the heading says so outright, because a section headed "Sports" that
 * showed no score would otherwise read as a section that failed rather than as the thing it is.
 */
function sportsNode(results: NormalizedResult[], onMore: () => void): HTMLElement {
  const box = mediaNode('Sports coverage', results, onMore)
  const note = el('p', 'mod-note', 'Reporting from news sources. Orbis has no live scores feed, so no scores are shown.')
  box.insertBefore(note, box.children[1] ?? null)
  return box
}

/**
 * People also ask (§15, §17).
 *
 * The questions come with the page; the answers do not. Opening one fetches it then, from pages that were really
 * read, and what comes back is kept so opening it twice costs nothing. An answer that could not be found says so.
 */
function askNode(questions: AskedQuestion[], results: NormalizedResult[]): HTMLElement {
  const box = el('section', 'mod-ask')
  box.append(heading('People also ask'))
  const list = el('div', 'mod-qs')
  const sources = results.slice(0, 5).map((r) => ({ url: r.url, title: r.title, snippet: r.description }))

  for (const question of questions) {
    const item = el('details', 'mod-q')
    const summary = el('summary', undefined, question.question)
    item.append(summary)
    const body = el('div', 'mod-a')
    item.append(body)
    let asked = false
    item.addEventListener('toggle', () => {
      if (!item.open || asked) return
      asked = true
      body.replaceChildren(el('p', 'mod-wait', 'Looking…'))
      void call('search:answer-question', [question.question, sources])
        .then((answered: AskedQuestion) => {
          body.replaceChildren()
          if (!answered?.answer) {
            /*
             * Nothing supported an answer, so the question goes.
             *
             * It used to say so and stay, which reads as a section of questions Orbis cannot answer -- and after two
             * or three of those the whole section is worth less than the space it takes. A question with no answer
             * behind it was never worth offering, so it is taken out, and when the last one goes the section goes
             * with it rather than leaving a heading over nothing.
             */
            const holder = item.parentElement
            item.remove()
            if (holder && holder.childElementCount === 0) box.remove()
            return
          }
          body.append(el('p', undefined, answered.answer.text))
          const where = sourceLink(answered.answer.provenance.url, answered.answer.provenance.title ?? undefined)
          if (where) body.append(where)
        })
        .catch(() => {
          body.replaceChildren(el('p', 'mod-none', NO_ANSWER))
        })
    })
    list.append(item)
  }
  box.append(list)
  return box
}

/** People also search for (§19). Each one says why it is here, and links to the page that says so. */
function relatedEntityNode(entities: RelatedEntity[], onSearch: (query: string) => void): HTMLElement {
  const box = el('section', 'mod-pasf')
  box.append(heading('People also search for'))
  const row = el('div', 'mod-ents')
  for (const entity of entities) {
    const card = el('div', 'mod-ent')
    const go = el('button', 'mod-ent-go')
    go.type = 'button'
    go.title = entity.relationship
    const image = entity.image && safe(entity.image.url)
    if (image) {
      const img = el('img')
      img.src = image
      img.alt = ''
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      img.addEventListener('error', () => img.remove())
      go.append(img)
    }
    const words = el('span', 'mod-ent-words')
    words.append(el('strong', undefined, entity.name), el('small', undefined, entity.description || entity.kind))
    go.append(words)
    go.addEventListener('click', () => onSearch(entity.searchQuery))
    card.append(go)
    const where = sourceLink(entity.provenance.url)
    if (where) card.append(where)
    row.append(card)
  }
  box.append(row)
  return box
}

/** Related searches (§23). Queries, so no sources: nothing here claims anything. */
function relatedSearchNode(queries: string[], onSearch: (query: string) => void): HTMLElement {
  const box = el('section', 'mod-rel')
  box.append(heading('Related searches'))
  const row = el('div', 'mod-chips')
  for (const query of queries) {
    const chip = el('button', 'mod-chip', query)
    chip.type = 'button'
    chip.addEventListener('click', () => onSearch(query))
    row.append(chip)
  }
  box.append(row)
  return box
}

/** A section that was wanted and could not be filled, said out loud with a way to try again (§64). */
function unavailableNode(problems: ComposedPage['unavailable'], onRetry: () => void): HTMLElement | null {
  if (!problems.length) return null
  const box = el('section', 'mod-unavailable')
  for (const problem of problems) {
    box.append(el('p', undefined, `${problem.module}: ${problem.problem}`))
  }
  const retry = el('button', 'mod-retry', 'Try again')
  retry.type = 'button'
  retry.addEventListener('click', onRetry)
  box.append(retry)
  return box
}

/**
 * Draws the page.
 *
 * The order comes from the composer, not from here, so the layout is the query's rather than this file's. Sections
 * with nothing in them are skipped entirely: the page is as long as there was something to say.
 */
export function renderComposedPage(
  root: HTMLElement,
  page: ComposedPage,
  actions: { onSearch(query: string): void; onVertical(vertical: string): void; onRetry(): void }
): void {
  root.replaceChildren()
  const main = el('div', 'mod-main')
  const side = el('div', 'mod-side')

  const correction = correctionNode(page, actions.onSearch)
  if (correction) main.append(correction)

  // The composer's order, with each section drawn only when it has something in it.
  for (const { module } of page.modules) {
    switch (module) {
      case 'calculator':
      case 'conversion':
      case 'answer': {
        const node = answerNode(page)
        if (node && !main.querySelector('.mod-answer')) main.append(node)
        break
      }
      case 'definition':
        if (page.definition) main.append(definitionNode(page.definition))
        break
      case 'comparison':
        if (page.comparison) main.append(comparisonNode(page.comparison))
        break
      case 'timeline':
        if (page.timeline?.length) main.append(timelineNode(page.timeline))
        break
      case 'weather':
        if (page.weather) main.append(weatherNode(page.weather))
        break
      case 'knowledge':
        if (page.knowledge) side.append(knowledgeNode(page.knowledge))
        break
      case 'web':
        if (page.web.length) main.append(webNode(page.web))
        break
      case 'images':
        if (page.images.length) main.append(imageNode(page.images, () => actions.onVertical('images')))
        break
      case 'videos':
        if (page.videos.length) main.append(mediaNode('Videos', page.videos, () => actions.onVertical('videos')))
        break
      case 'news':
        if (page.news.length) main.append(mediaNode('News', page.news, () => actions.onVertical('news')))
        break
      case 'sports':
        if (page.sports?.length) main.append(sportsNode(page.sports, () => actions.onVertical('news')))
        break
      case 'local':
        if (page.places?.length) main.append(placesNode(page.places, page.placesNote))
        break
      case 'peopleAlsoAsk':
        if (page.peopleAlsoAsk.length) main.append(askNode(page.peopleAlsoAsk, page.web))
        break
      case 'peopleAlsoSearchFor':
        if (page.peopleAlsoSearchFor.length) main.append(relatedEntityNode(page.peopleAlsoSearchFor, actions.onSearch))
        break
      case 'relatedSearches':
        if (page.relatedSearches.length) main.append(relatedSearchNode(page.relatedSearches, actions.onSearch))
        break
      default:
        // A module with no drawing yet is simply not drawn. Adding one is adding a case, not rearranging the page.
        break
    }
  }

  const problems = unavailableNode(page.unavailable, actions.onRetry)
  if (problems) main.append(problems)

  /*
   * Ask for the icons once the page exists.
   *
   * After the rows are built, so one call covers every host on the page rather than one call per row; and not awaited,
   * because a page of results should not wait on a row of 16-pixel pictures.
   */
  iconsAsked = true
  void paintIcons()

  root.append(main)
  // The panel only exists when there is something in it, so the page does not reserve a column for an absence.
  if (side.childElementCount) {
    root.classList.add('has-side')
    root.append(side)
  } else {
    root.classList.remove('has-side')
  }
}
