import { readPage } from '../main/research.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'
import { MAX_TEXT, buildComparison, describeComparison } from '../shared/tray.ts'
import type { Comparison, Proposal, ProposedField, TrayItem } from '../shared/tray.ts'
import type { TrayStore } from '../main/personal/tray.ts'

/**
 * Comparing what was pinned.
 *
 * Two passes, because the hard part is not reading the pages -- it is knowing what to read them for. Nothing tells you
 * that three laptops should be compared on price, weight and battery while three papers should be compared on method,
 * sample size and year. That has to be worked out from the things themselves.
 *
 *   1. From the titles alone, decide what kind of things these are and what would actually distinguish them.
 *   2. Read each page and pull those fields out of it, quoting the words that say each one.
 *
 * The second pass is per page and independent, so one page that will not load, or one answer that comes back as
 * nonsense, costs that row and nothing else.
 *
 * Everything the model proposes is then checked against the page text before it can become a cell (src/shared/tray.ts).
 * This file can be wrong about what to look for; it cannot be wrong about what a page said.
 */

export interface TrayDeps {
  /** The pinned items, per profile. Null when Orbis has nowhere to keep them. */
  store(): TrayStore | null | undefined
  /** One question to Orion, answered in full. The same chat the rest of Orbis uses; this does not pick a model. */
  ask(prompt: string, signal: AbortSignal): Promise<string>
  /** Whether Orion can be asked at all. Only the comparison needs it; pinning does not. */
  hasModel(): boolean
  fetchFn: typeof fetch
}

/** Long enough for a specifications table, short enough that one page cannot eat the whole request. */
const MAX_BYTES = 2_000_000
const FETCH_MS = 15_000
const MAX_FIELDS = 8
/** How much of a page Orion is shown. The check afterwards is against the same text, so nothing outside it can pass. */
const SHOWN = 14_000

const no = (why: string): never => {
  throw new HelperError('bad-request', why)
}

const NEWLINE = String.fromCharCode(10)

/**
 * The page, as text.
 *
 * Fetched rather than opened in a tab: a pinned search result is usually an article or a product page, and asking the
 * browser to open twelve tabs to compare twelve things would cost more than it is worth. A page that only exists once
 * a script has run will come back thin, and thin is reported as a problem rather than compared as if it were the page.
 */
async function read(url: string, fetchFn: typeof fetch): Promise<{ text?: string; problem?: string }> {
  if (!/^https?:\/\//i.test(url)) return { problem: 'That is not a web page.' }
  const stop = AbortSignal.timeout(FETCH_MS)
  try {
    const response = await fetchFn(url, { signal: stop, redirect: 'follow', headers: { accept: 'text/html,*/*' } })
    if (!response.ok) return { problem: `The site answered ${response.status}.` }
    const type = response.headers.get('content-type') ?? ''
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      return { problem: `That is ${type.split(';')[0].trim()}, which Orbis cannot read as text.` }
    }
    const body = await response.arrayBuffer()
    if (body.byteLength > MAX_BYTES) return { problem: 'That page is too large to read.' }
    const text = readPage(new TextDecoder().decode(body)).text.slice(0, MAX_TEXT)
    // A page that yields almost nothing has not been read. Saying so is the honest outcome; comparing it is not.
    if (text.trim().length < 120) return { problem: 'There was almost no text on that page to compare.' }
    return { text }
  } catch (error) {
    const why = (error as Error)?.name === 'TimeoutError' ? 'That page took too long to answer.' : 'That page could not be reached.'
    return { problem: why }
  }
}

/** JSON from an answer that may have been wrapped in prose or a code fence. Null when there is none to be had. */
function jsonFrom(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer)?.[1]
  for (const candidate of [fenced, answer]) {
    if (!candidate) continue
    const start = candidate.search(/[[{]/)
    if (start < 0) continue
    const end = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'))
    if (end <= start) continue
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      // Not JSON after all; try the next candidate, and if none parse, this yields nothing rather than a guess.
    }
  }
  return null
}

/**
 * Pass one: what would actually tell these things apart.
 *
 * Given only the titles, because the point is to choose the axes before reading, not to be led by whichever page
 * happened to be read first. Returns an empty list rather than an invented one when it cannot tell.
 */
async function decideFields(items: TrayItem[], ask: TrayDeps['ask'], signal: AbortSignal): Promise<{ key: string; label: string }[]> {
  const list = items.map((i, n) => `${n + 1}. ${i.title} (${i.site})`).join(NEWLINE)
  const prompt = [
    'Someone has put these web pages side by side to compare them:',
    list,
    '',
    `Work out what kind of thing these are, then give at most ${MAX_FIELDS} things that would actually tell them apart.`,
    'Choose what someone deciding between these would want in a table. Prefer facts a page states outright.',
    'If they are not comparable things, reply with an empty array.',
    '',
    'Reply with only a JSON array, each entry {"key":"snake_case","label":"Short words"}. No other text.'
  ].join(NEWLINE)

  const parsed = jsonFrom(await ask(prompt, signal))
  if (!Array.isArray(parsed)) return []
  const fields: { key: string; label: string }[] = []
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const key = String((raw as Record<string, unknown>).key ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60)
    if (!key || fields.some((f) => f.key === key)) continue
    const label = String((raw as Record<string, unknown>).label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    fields.push({ key, label: label || key.replace(/_/g, ' ') })
    if (fields.length >= MAX_FIELDS) break
  }
  return fields
}

/**
 * Pass two: what this page says about them.
 *
 * The instruction to quote is not a formality. A quote is the only thing that makes the answer checkable, and the check
 * afterwards is unconditional -- a field that arrives without words from the page is discarded, so a model that
 * declines to quote simply produces nothing rather than producing something unfounded.
 */
async function extract(item: TrayItem, fields: { key: string; label: string }[], ask: TrayDeps['ask'], signal: AbortSignal): Promise<Proposal> {
  if (!item.text) return { itemId: item.id, fields: [] }
  const wanted = fields.length ? fields.map((f) => `- ${f.key}: ${f.label}`).join(NEWLINE) : '(decide for yourself what is worth pulling out)'
  const prompt = [
    `This is the text of ${item.title}:`,
    '"""',
    item.text.slice(0, SHOWN),
    '"""',
    '',
    'Pull out these, if the page states them:',
    wanted,
    '',
    'Rules:',
    '- Only what this page states. If it does not say, leave that one out entirely.',
    '- "quote" must be copied exactly from the text above, word for word, and must contain the value.',
    '- Do not calculate, convert, estimate or infer anything. Copy what is written.',
    '',
    'Reply with only a JSON array of {"key":"...","label":"...","value":"...","quote":"..."}. No other text.'
  ].join(NEWLINE)

  const parsed = jsonFrom(await ask(prompt, signal).catch(() => ''))
  if (!Array.isArray(parsed)) return { itemId: item.id, fields: [] }
  const out: ProposedField[] = []
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    out.push({
      key: String(o.key ?? ''),
      label: String(o.label ?? ''),
      value: String(o.value ?? ''),
      quote: String(o.quote ?? '')
    })
  }
  return { itemId: item.id, fields: out }
}

export function createTrayHandlers(deps: TrayDeps): Record<string, Handler> {
  const store = (): TrayStore => {
    const it = deps.store()
    if (!it) throw new HelperError('unavailable', 'Orbis has nowhere to keep pinned pages here.')
    return it
  }
  const id = (value: unknown): string => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : no('Which pinned page?'))

  return {
    'tray:list': async () => ({ items: (await store().all()).map(({ text, ...rest }) => ({ ...rest, read: Boolean(text) })) }),

    'tray:add': async ([raw]) => {
      const result = await store().add(raw)
      return {
        added: result.added,
        full: result.full,
        count: result.items.length,
        message: result.full ? 'The tray is full. Remove something to pin another.' : result.added ? null : 'That page is already pinned.'
      }
    },

    'tray:remove': async ([which]) => ({ count: (await store().remove(id(which))).length }),

    'tray:clear': async () => ({ count: (await store().clear()).length }),

    /**
     * The comparison. Reads whatever has not been read, works out what to compare on, pulls those out of each page,
     * and returns only what the pages were found to support.
     */
    'tray:compare': async (_args, { emit, signal }): Promise<{ comparison: Comparison; summary: string }> => {
      /*
       * The one part that needs a model.
       *
       * Reading the pinned pages and working out what they can be compared on is the whole job here, and there is no
       * doing it without Orion. Said plainly, at the moment somebody asks, rather than by the feature quietly not
       * existing -- which is what used to happen, and it took the pin button down with it.
       */
      if (!deps.hasModel()) {
        throw new HelperError(
          'unavailable',
          'Comparing pinned pages needs Orion, and there is no model key set. Pinning still works.'
        )
      }
      const it = store()
      let items = await it.all()
      if (!items.length) throw new HelperError('bad-request', 'Nothing is pinned yet.')

      // ---- read what has not been read. Each page stands alone: one failure is one row, not the whole table.
      const unread = items.filter((i) => !i.text && !i.problem)
      if (unread.length) {
        emit({ type: 'status', message: `Reading ${unread.length} page${unread.length === 1 ? '' : 's'}…` })
        for (const item of unread) {
          if (signal.aborted) break
          await it.recordRead(item.id, await read(item.url, deps.fetchFn))
        }
        items = await it.all()
      }
      if (signal.aborted) throw new HelperError('aborted', 'Stopped.')

      const readable = items.filter((i) => Boolean(i.text))
      if (!readable.length) {
        const comparison = buildComparison(items, [])
        return { comparison, summary: describeComparison(comparison) }
      }

      emit({ type: 'status', message: 'Working out what would tell them apart…' })
      const fields = await decideFields(readable, deps.ask, signal).catch(() => [])

      emit({ type: 'status', message: `Reading ${readable.length} page${readable.length === 1 ? '' : 's'} for those…` })
      const proposals: Proposal[] = []
      for (const item of readable) {
        if (signal.aborted) break
        proposals.push(await extract(item, fields, deps.ask, signal))
      }

      const comparison = buildComparison(items, proposals)
      return { comparison, summary: describeComparison(comparison) }
    }
  }
}
