import { analysisExcerpt, type SelectionReading } from './selectionText.ts'
import { selectionAction } from './selectionActions.ts'

/**
 * What Orion is actually asked, when an action is chosen.
 *
 * Kept here, away from both the page and the helper, for two reasons. It is the part worth testing -- a prompt is the
 * difference between an answer about the selected sentence and an answer about the page it was on -- and it is the
 * one place that decides how much of the surroundings each action is given.
 *
 * That second part is the rule the whole file exists for: **each action is given the least it needs.** Explaining a
 * sentence needs the sentence. Checking a claim needs the sentence and where it was read, because a claim about "the
 * company" means nothing without knowing whose page it was on. Nothing needs the whole page, and nothing is sent the
 * page's address unless the answer depends on it.
 */

/** Where the selection was made. Only what the page already knows about itself. */
export interface SelectionPlace {
  readonly url: string
  readonly title: string
  /** A little of the text around the selection, where the page could provide it. */
  readonly around?: string
}

export interface SelectionRequest {
  /** The question for Orion. */
  readonly ask: string
  /** True when the page's address was included, so the person can be told. */
  readonly usedPage: boolean
}

/** What each action asks for, with `{text}` standing in for the selection. */
const ASKS: Readonly<Record<string, string>> = Object.freeze({
  explain: 'Explain what this means, in plain words. Be brief unless the thing itself is complicated.',
  define: 'What does this word or phrase mean? Give the meaning, how it is used, and one example sentence. If it has more than one common meaning, give the one that fits where it was read.',
  summarise: 'Summarise this. Keep the facts, the numbers and the names exactly as they are. Do not add anything that is not in the text.',
  check:
    'Check this claim. Look it up, say what the sources actually support, and say plainly if they do not support it or if you could not find out. Cite what you used. Never invent a source.',
  simplify: 'Say this again in plainer words, keeping the meaning exactly. Do not leave out anything that changes what it means.',
  rewrite: 'Rewrite this so it reads better, keeping the meaning and the facts. Give the rewritten version on its own, then one line on what you changed.',
  translate: 'Translate this. Give the translation on its own first. If anything does not carry over, say so underneath in one line.',
  'explain-code': 'Explain what this code does. Say what it is for first, then walk through the parts that are not obvious. Do not rewrite it unless asked.',
  'find-bug': 'Look for what is wrong with this code: bugs, cases it does not handle, things that will break. If you find nothing wrong, say so rather than inventing a problem.',
  solve: 'Work this out. Show the steps, then the answer on its own line. If it cannot be solved as written, say what is missing.',
  analyse: 'This is data. Say what it shows: the shape of it, anything that stands out, and anything that looks wrong. Use only the numbers given.'
})

/** The actions that are told where the text came from, and why each one needs it. */
const NEEDS_PAGE = new Set(['check', 'define', 'ask'])

const quoted = (text: string): string => `"""\n${text}\n"""`

/**
 * Builds the request for an action.
 *
 * `extra` is what the person typed, for Ask; for every other action it is the choice they made, such as the language
 * to translate into or the tone to rewrite in.
 */
export function selectionRequest(actionId: string, reading: SelectionReading, place: SelectionPlace, extra?: string): SelectionRequest {
  const action = selectionAction(actionId)
  if (!action) throw new Error(`There is no selection action called ${actionId}.`)
  if (!action.sends) throw new Error(`${action.label} does not send the selection anywhere, so it has nothing to ask.`)

  const { text, shortened } = analysisExcerpt(reading.raw)
  const parts: string[] = []

  if (actionId === 'ask') {
    const typed = (extra ?? '').trim()
    parts.push(typed === '' ? 'Answer this about the text below.' : typed)
  } else {
    const base = ASKS[actionId]
    if (!base) throw new Error(`There is nothing to ask for ${actionId}.`)
    parts.push(extra && extra.trim() !== '' ? `${base} ${extra.trim()}` : base)
  }

  const usedPage = NEEDS_PAGE.has(actionId) && place.url !== ''
  if (usedPage) {
    // Where, not what: the address and the title, so a claim about "the company" can be read in context. Never the page.
        parts.push(`It was read on ${place.title ? `${place.title} — ` : ''}${place.url}`)
  }

  if (shortened) parts.push('The selection is long, so the middle of it is left out below; answer about what is shown.')

  parts.push(`The selected text:\n${quoted(text)}`)

  return { ask: parts.join('\n\n'), usedPage }
}

/** The tones Rewrite offers. Nothing is applied until one is chosen. */
export const REWRITE_TONES: readonly { id: string; label: string; ask: string }[] = Object.freeze([
  { id: 'clear', label: 'Clearer', ask: 'Make it clearer.' },
  { id: 'short', label: 'Shorter', ask: 'Make it shorter without losing anything that matters.' },
  { id: 'formal', label: 'Formal', ask: 'Make it formal.' },
  { id: 'friendly', label: 'Friendly', ask: 'Make it warmer and less stiff.' },
  { id: 'professional', label: 'Professional', ask: 'Make it read as professional writing.' }
])

/**
 * The languages Translate offers.
 *
 * A short list rather than every language there is: the palette is small, and anything not here can be asked for in
 * words through Ask. The Indian languages are first because this build's people read them.
 */
export const TRANSLATE_INTO: readonly { id: string; label: string }[] = Object.freeze([
  { id: 'ta', label: 'Tamil' },
  { id: 'hi', label: 'Hindi' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'ja', label: 'Japanese' },
  { id: 'zh', label: 'Chinese' },
  { id: 'ar', label: 'Arabic' }
])

export function translateAsk(languageId: string): string {
  const found = TRANSLATE_INTO.find((one) => one.id === languageId)
  return `Translate it into ${found ? found.label : languageId}.`
}
