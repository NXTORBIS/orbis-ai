/**
 * Definitions (§39).
 *
 * From Wiktionary, which is a real dictionary with a real API and no key, rather than from a model asked what a word
 * means. A generated definition is the most convincing kind of wrong thing a search engine can show: it reads exactly
 * like a dictionary entry, and nobody looks up a word they already know well enough to catch the error.
 *
 * So this file does two small, checkable jobs -- work out which word is being asked about, and turn Wiktionary's
 * answer into something the page can draw -- and nothing else. Anything it cannot parse becomes no definition, and
 * the page shows search results instead.
 */

export interface Sense {
  /** The definition itself, with Wiktionary's markup taken out. */
  text: string
  /** An example of the word in use, when the entry gives one. */
  example?: string
}

export interface PartOfSpeech {
  /** "Noun", "Adjective", "Verb". Wiktionary's own word for it. */
  label: string
  senses: Sense[]
}

export interface Definition {
  word: string
  language: string
  parts: PartOfSpeech[]
  /** Where it came from. Wiktionary is CC BY-SA, so the link is required as well as right. */
  source: { url: string; site: string; licence: string }
}

const MAX_PARTS = 4
const MAX_SENSES = 3

/** Wiktionary is CC BY-SA 4.0, and saying so is part of using it. */
export const WIKTIONARY_LICENCE = 'Wiktionary, CC BY-SA 4.0'

/** Strips the markup out of an entry, leaving the words. */
function plain(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The word being asked about, or null.
 *
 * Only a single word, and only when the query is actually asking what it means. "define x" and "what does x mean" are
 * asking; "x" on its own is a search for x, and turning every one-word search into a dictionary entry would bury the
 * results somebody wanted under a definition they did not.
 */
export function wordToDefine(query: string): string | null {
  const raw = String(query ?? '').trim().replace(/[?.!]+$/, '')
  if (!raw) return null
  const patterns = [
    /^(?:define|definition of|meaning of|what(?:'s| is| does) the (?:meaning|definition) of)\s+(.+)$/i,
    /^what does\s+(.+?)\s+mean$/i,
    /^(.+?)\s+(?:definition|meaning)$/i
  ]
  for (const pattern of patterns) {
    const found = pattern.exec(raw)?.[1]?.trim()
    if (!found) continue
    const word = found.replace(/^["']|["']$/g, '').trim()
    // One word, letters and the marks that belong inside words. A phrase is not a dictionary lookup.
    if (/^[\p{L}][\p{L}’'-]{0,40}$/u.test(word)) return word.toLowerCase()
  }
  return null
}

/** The address a word's entry lives at. Also what the page links to, so the licence is honoured. */
export const wiktionaryUrl = (word: string): string => `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`

/**
 * Turns Wiktionary's answer into an entry, or returns null.
 *
 * Null when the shape is not what was expected, when the word has no English entry, or when nothing survives the
 * cleaning. Every one of those is "no definition", which is a fine thing for a search page to show.
 */
export function readDefinition(raw: unknown, word: string): Definition | null {
  if (!raw || typeof raw !== 'object') return null
  const byLanguage = raw as Record<string, unknown>
  // English first because this is the English Wiktionary; any other language only if English has nothing.
  const key = 'en' in byLanguage ? 'en' : Object.keys(byLanguage)[0]
  const entries = key ? byLanguage[key] : null
  if (!Array.isArray(entries) || !entries.length) return null

  const parts: PartOfSpeech[] = []
  let language = 'English'
  for (const entry of entries) {
    const e = (entry ?? {}) as Record<string, unknown>
    const label = plain(String(e.partOfSpeech ?? '')).slice(0, 40)
    if (typeof e.language === 'string' && e.language.trim()) language = plain(e.language).slice(0, 40)
    const senses: Sense[] = []
    for (const item of Array.isArray(e.definitions) ? e.definitions : []) {
      const d = (item ?? {}) as Record<string, unknown>
      const text = plain(String(d.definition ?? ''))
      // A definition that is empty once the markup is gone was never a definition.
      if (text.length < 2) continue
      const examples = Array.isArray(d.parsedExamples) ? d.parsedExamples : Array.isArray(d.examples) ? d.examples : []
      const first = examples[0]
      const example = plain(typeof first === 'string' ? first : String((first as Record<string, unknown>)?.example ?? ''))
      senses.push({ text, ...(example && example.length > 3 ? { example } : {}) })
      if (senses.length >= MAX_SENSES) break
    }
    if (!label || !senses.length) continue
    parts.push({ label, senses })
    if (parts.length >= MAX_PARTS) break
  }
  if (!parts.length) return null

  return {
    word,
    language,
    parts,
    source: { url: wiktionaryUrl(word), site: 'en.wiktionary.org', licence: WIKTIONARY_LICENCE }
  }
}
