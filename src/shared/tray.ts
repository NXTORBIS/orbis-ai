/**
 * The comparison tray: search results kept side by side, and compared from what their pages actually say.
 *
 * A search gives you a list. Deciding something from that list means opening six tabs, reading six pages, and holding
 * six half-remembered numbers in your head while you scroll. The tray is the other half of that job: pin what looks
 * relevant, and Orbis reads the pinned pages and lays out what they say against each other.
 *
 * The whole risk of a feature like this is that a table looks finished. A grid of numbers reads as fact, so a model
 * that guesses one cell has done more damage than one that refuses the whole table -- the guess is indistinguishable
 * from the nine values that were real. So the rule here is not "try to be accurate". It is:
 *
 *   A cell exists only if the words that say it are present in the page it claims to come from.
 *
 * That is `verifyCell`, and every value goes through it. A cell whose quote is not in the page is dropped, not
 * softened, not marked uncertain, not kept with a lower score. There is no path through this file that puts a value in
 * a table without the page's own words behind it, which means the table cannot say anything the web did not.
 *
 * Nothing here talks to a model or to the network. Extraction happens elsewhere and arrives as a proposal; this decides
 * what survives it.
 */

/** A result somebody pinned. What was pinned, and what was read from it -- which are different things. */
export interface TrayItem {
  id: string
  url: string
  title: string
  /** The site, as the results page showed it. */
  site: string
  /** The vertical it was pinned from, so a tray holding a video and a paper can say what it is holding. */
  vertical: string
  addedAt: number
  /**
   * The page's text as it was actually read. Kept because it is what every quote is checked against: a table built
   * against text Orbis no longer has is a table nobody can check.
   */
  text?: string
  readAt?: number
  /** Why it could not be read. Absent means it has not been tried; a problem means it was tried and failed. */
  problem?: string
}

/** One value in the table, and the words on the page that say it. There is no way to have the first without the second. */
export interface Cell {
  value: string
  /** Text copied from the page. Verified to be there; a cell is discarded rather than kept with a quote that is not. */
  quote: string
  /** The page it came from, so a cell can be followed back without working out which row it was in. */
  url: string
}

/** A column, worked out from the items rather than chosen in advance. */
export interface Column {
  key: string
  label: string
  /** How many of the pinned items have a verified value here. Used to order columns, and shown so gaps are visible. */
  filled: number
}

export interface Row {
  itemId: string
  title: string
  url: string
  /** Null where this page did not say. Missing and unknown are the same thing here, and both are worth showing. */
  cells: Record<string, Cell | null>
  /**
   * Where this page said two different things for one column. Both are kept: a page that gives two prices is telling
   * you something, and picking one of them silently is the thing this file exists to prevent.
   */
  disagreements: Record<string, Cell[]>
}

export interface Comparison {
  columns: Column[]
  rows: Row[]
  /** Items that could not be read at all, and why. Listed, never quietly dropped from the table. */
  unread: { itemId: string; title: string; url: string; problem: string }[]
  /** Values the model proposed that no page supported. Counted so the table can say it refused them. */
  rejected: number
}

/** One field a model proposed for one item, before anything has been checked. */
export interface ProposedField {
  key: string
  label: string
  value: string
  quote: string
}

export interface Proposal {
  itemId: string
  fields: ProposedField[]
}

export const MAX_TRAY = 12
export const MAX_TEXT = 40_000
const MAX_VALUE = 200
const MAX_QUOTE = 400
const MAX_COLUMNS = 10

/** A column has to be shared to be a column: one page mentioning something is a fact about that page, not an axis. */
const MIN_ITEMS_FOR_COLUMN = 2

const clean = (value: unknown, limit: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '')

/**
 * The form a quote is compared in.
 *
 * A page's text and a model's copy of it differ in ways that are not disagreements: runs of whitespace, the kind of
 * quote mark or dash a site uses, capitals at the start of a sentence. Normalising those is not loosening the check --
 * the words still have to be the page's words, in the page's order. What it prevents is a true quote being thrown away
 * because the site used a curly apostrophe.
 */
const forCompare = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Whether a page really says this.
 *
 * The quote must appear in the page's text, and the value must appear in the quote -- both, because either alone lets
 * something through. A real quote paired with an invented value would pass the first check; a value lifted from the
 * page but attached to a quote from somewhere else would pass the second. Requiring both means the value is in the
 * page, in the context the cell claims for it.
 */
export function verifyCell(field: { value: string; quote: string }, pageText: string): boolean {
  const value = forCompare(field.value)
  const quote = forCompare(field.quote)
  if (!value || !quote || !pageText) return false
  // A quote short enough to appear anywhere proves nothing: "1" is in every page that has a 1 in it.
  if (quote.length < 8) return false
  if (!forCompare(pageText).includes(quote)) return false
  return quote.includes(value)
}

/** A pinned item, in the shape the store keeps. Anything unrecognisable is refused rather than repaired into nonsense. */
export function normalizeTrayItem(raw: unknown): TrayItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const url = typeof o.url === 'string' ? o.url.trim() : ''
  if (!/^https?:\/\//i.test(url)) return null
  const id = typeof o.id === 'string' && o.id ? o.id.slice(0, 80) : url
  const text = typeof o.text === 'string' ? o.text.slice(0, MAX_TEXT) : undefined
  return {
    id,
    url,
    title: clean(o.title, 300) || url,
    site: clean(o.site, 120),
    vertical: clean(o.vertical, 40) || 'all',
    addedAt: typeof o.addedAt === 'number' && Number.isFinite(o.addedAt) ? o.addedAt : 0,
    ...(text ? { text } : {}),
    ...(typeof o.readAt === 'number' && Number.isFinite(o.readAt) ? { readAt: o.readAt } : {}),
    ...(typeof o.problem === 'string' && o.problem ? { problem: clean(o.problem, 300) } : {})
  }
}

/**
 * Adds a pin. The same page pinned twice is one pin -- somebody who pins a result they already have meant to keep it,
 * not to have it twice -- and the tray has a ceiling, because a comparison of forty things is a list again.
 */
export function addToTray(items: TrayItem[], item: TrayItem): { items: TrayItem[]; added: boolean; full: boolean } {
  const already = items.some((i) => i.url === item.url)
  if (already) return { items, added: false, full: false }
  if (items.length >= MAX_TRAY) return { items, added: false, full: true }
  return { items: [...items, item], added: true, full: false }
}

export const removeFromTray = (items: TrayItem[], id: string): TrayItem[] => items.filter((i) => i.id !== id)

export const inTray = (items: TrayItem[], url: string): boolean => items.some((i) => i.url === url)

/**
 * Builds the table.
 *
 * Every proposed value is checked against the text of the page it claims to come from, and only what survives is
 * arranged. Columns are then worked out from what survived rather than decided beforehand: three laptops produce a
 * price column because three pages said a price, and a column nothing supports does not exist to be empty.
 */
export function buildComparison(items: TrayItem[], proposals: Proposal[]): Comparison {
  const byId = new Map(items.map((i) => [i.id, i]))
  const unread = items
    .filter((i) => !i.text)
    .map((i) => ({ itemId: i.id, title: i.title, url: i.url, problem: i.problem || 'This page was not read.' }))

  let rejected = 0
  /** key -> label, taking the first readable label offered for a key so the header is words rather than a field name. */
  const labels = new Map<string, string>()
  /** itemId -> key -> the verified cells for it, in the order they were proposed. */
  const kept = new Map<string, Map<string, Cell[]>>()

  for (const proposal of proposals) {
    const item = byId.get(proposal?.itemId ?? '')
    if (!item?.text) continue
    const forItem = new Map<string, Cell[]>()
    for (const raw of Array.isArray(proposal.fields) ? proposal.fields : []) {
      const key = clean(raw?.key, 60).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      const value = clean(raw?.value, MAX_VALUE)
      const quote = clean(raw?.quote, MAX_QUOTE)
      if (!key || !value) { rejected += 1; continue }
      if (!verifyCell({ value, quote }, item.text)) { rejected += 1; continue }
      if (!labels.has(key)) labels.set(key, clean(raw?.label, 60) || key.replace(/_/g, ' '))
      const cell: Cell = { value, quote, url: item.url }
      const existing = forItem.get(key)
      // The same value twice is one value; a different one is a disagreement, and both are kept.
      if (!existing) forItem.set(key, [cell])
      else if (!existing.some((c) => forCompare(c.value) === forCompare(value))) existing.push(cell)
    }
    kept.set(item.id, forItem)
  }

  const readable = items.filter((i) => Boolean(i.text))
  const counts = new Map<string, number>()
  for (const forItem of kept.values()) {
    for (const [key, cells] of forItem) if (cells.length) counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  // A column needs to be shared, unless there is only one page, in which case everything it said is worth showing.
  const floor = readable.length <= 1 ? 1 : MIN_ITEMS_FOR_COLUMN
  const columns: Column[] = [...counts.entries()]
    .filter(([, filled]) => filled >= floor)
    // Fullest first: the axis that most of the pinned pages agree is an axis is the one to lead with. Ties keep a
    // stable order by name so the table does not rearrange itself between two runs that found the same things.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_COLUMNS)
    .map(([key, filled]) => ({ key, label: labels.get(key) ?? key, filled }))

  const rows: Row[] = readable.map((item) => {
    const forItem = kept.get(item.id) ?? new Map<string, Cell[]>()
    const cells: Record<string, Cell | null> = {}
    const disagreements: Record<string, Cell[]> = {}
    for (const column of columns) {
      const found = forItem.get(column.key) ?? []
      cells[column.key] = found[0] ?? null
      if (found.length > 1) disagreements[column.key] = found
    }
    return { itemId: item.id, title: item.title, url: item.url, cells, disagreements }
  })

  return { columns, rows, unread, rejected }
}

/**
 * What the table amounts to, in a sentence. Said plainly, including when it amounts to nothing: a comparison that found
 * no shared ground should say so rather than show an empty grid and let it read as "these are all the same".
 */
export function describeComparison(comparison: Comparison): string {
  const { columns, rows, unread, rejected } = comparison
  if (!rows.length) return unread.length ? 'None of the pinned pages could be read.' : 'Nothing is pinned yet.'
  if (!columns.length) {
    return rows.length === 1
      ? 'Only one page could be read, so there is nothing to compare it with.'
      : 'These pages had nothing in common to compare. They may be about different kinds of thing.'
  }
  const parts = [`${columns.length} thing${columns.length === 1 ? '' : 's'} compared across ${rows.length} page${rows.length === 1 ? '' : 's'}.`]
  if (unread.length) parts.push(`${unread.length} could not be read.`)
  if (rejected) parts.push(`${rejected} value${rejected === 1 ? '' : 's'} left out: the page did not say ${rejected === 1 ? 'it' : 'them'}.`)
  return parts.join(' ')
}
