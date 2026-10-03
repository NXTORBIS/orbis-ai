/**
 * Finding something by typing what you call it.
 *
 * Kept apart from the list it searches, and from the screen that draws the results, for two reasons.
 *
 * The first is that a search is the one part of a settings screen that can be wrong without looking wrong. It returns
 * a list either way, and nobody reading the list can tell that the thing they wanted was ranked fourth. So this is
 * pure, and it is tested against the words people actually type rather than the words the interface uses.
 *
 * The second is that the Orbis window and the browser's own panel both have to offer this over the same list of
 * sections. The moment each wrote its own matching, the two would start disagreeing about what "password" means.
 *
 * Nothing here knows about Settings in particular. It ranks anything with a name, a line about it, and the other
 * words somebody might look for it by -- which is the shape `commandCenter.ts` already uses for the places you can go
 * to, so there is one way of describing a list of destinations and not two.
 */

/** A name, a line about it, and the other words somebody might look for it by. */
export interface Findable {
  label: string
  blurb: string
  keywords: string[]
}

/** What one kind of text is worth when it is typed in full, when it begins with what was typed, and when it merely contains it. */
interface Weights {
  whole: number
  starts: number
  part: number
}

/**
 * The ladder, and the reason there is one.
 *
 * The name typed in full beats the name that merely begins with it, which beats a word the thing is also known by,
 * which beats a mention in its blurb. Flatten any of that and the obvious answer stops coming first: typing
 * "password" would put every section whose description happens to say the word level with the one that is about
 * passwords.
 */
const LABEL: Weights = { whole: 100, starts: 80, part: 60 }
const KEYWORD: Weights = { whole: 50, starts: 40, part: 20 }
/**
 * A blurb is prose. A hit in it means the word turns up somewhere in a sentence about the thing, which is worth
 * something and worth very little -- so all three cases are the same small number rather than a ladder of their own.
 */
const BLURB: Weights = { whole: 10, starts: 10, part: 10 }

/** One word of a longer phrase rather than the whole of it: "dark mode" should find whatever "dark" finds. */
const PER_WORD = 0.7
/** A plural folded to its singular, which is a guess at what was meant rather than what was typed. */
const PLURAL = 0.5
/** Both at once -- one word of a phrase, and that word folded. The faintest kind of match there is. */
const PLURAL_PER_WORD = 0.35

/**
 * A word with a trailing "s" taken off, so "passwords" finds the password settings and "updates" finds Updates.
 *
 * One letter, and only a plain "s". Taking "es" off as well sounds more thorough and is exactly where the rule starts
 * disagreeing with itself: "licences" would fold to "licenc" while "licence" stayed whole, and the two would stop
 * matching each other -- which is worse than not folding at all, because it breaks a search that used to work. A
 * double "s" is left alone so "address" does not become "addres", and a stem of fewer than three letters is left
 * alone so "as" does not become "a".
 */
export function singular(word: string): string {
  if (!word.endsWith('s') || word.endsWith('ss')) return word
  const stem = word.slice(0, -1)
  return stem.length >= 3 ? stem : word
}

/**
 * A phrase with its punctuation gone and its plurals folded.
 *
 * The punctuation has to go first. A blurb reads "Passwords, locks, and moving a profile between computers." and its
 * first word ends in a comma rather than an "s", so folding the words without clearing the punctuation does nothing
 * at all -- which is how a plural search can look implemented and match nothing.
 */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map(singular)
    .join(' ')
}

/** How well one piece of text answers one piece of what was typed. */
function hit(text: string, wanted: string, weights: Weights): number {
  if (!text || !wanted) return 0
  if (text === wanted) return weights.whole
  if (text.startsWith(wanted)) return weights.starts
  if (text.includes(wanted)) return weights.part
  return 0
}

/**
 * How well something answers what was typed, or 0 for not at all.
 *
 * Four passes over each piece of text, in descending order of how sure they are: the whole phrase as typed, then each
 * word of it, then the whole phrase with plurals folded, then each folded word. The best of them wins, so a search
 * that matched exactly is never beaten by a guess about what it might have meant.
 */
export function scoreFindable(item: Findable, query: string): number {
  const wanted = String(query ?? '').trim().toLowerCase()
  if (!wanted) return 0

  /**
   * The separate words, for somebody who typed more than they needed to.
   *
   * Single letters are dropped: a stray "a" matches almost everything, and a match that means nothing is worse than
   * no match, because it fills the list with sections that have nothing to do with the question.
   */
  const words = wanted.split(/\s+/).filter((word) => word.length > 1 && word !== wanted)
  const folded = fold(wanted)
  const foldedWords = words.map(fold).filter((word) => word !== folded)

  let score = 0
  const against = (text: string, weights: Weights): void => {
    const lower = text.toLowerCase()
    score = Math.max(score, hit(lower, wanted, weights))
    for (const word of words) score = Math.max(score, Math.round(hit(lower, word, weights) * PER_WORD))

    const stem = fold(text)
    score = Math.max(score, Math.round(hit(stem, folded, weights) * PLURAL))
    for (const word of foldedWords) score = Math.max(score, Math.round(hit(stem, word, weights) * PLURAL_PER_WORD))
  }

  against(item.label, LABEL)
  for (const keyword of item.keywords) against(keyword, KEYWORD)
  against(item.blurb, BLURB)
  return score
}

/**
 * What matches, best first. An empty search offers everything, in the order it was declared.
 *
 * A search matching nothing returns nothing, rather than falling back to the whole list. Offering all of it for a
 * word that matches none of it reads as "here is everything you asked for", which is a lie, and it hides the one
 * thing the person needs to know: that what they typed is not in here under that name.
 */
export function rankFindables<T extends Findable>(items: readonly T[], query: string): T[] {
  if (!String(query ?? '').trim()) return [...items]
  return items
    .map((item, at) => ({ item, at, score: scoreFindable(item, query) }))
    .filter((one) => one.score > 0)
    // Equal scores fall back to the order they were declared in, so the list under somebody's cursor does not
    // rearrange itself between keystrokes while they are still typing.
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((one) => one.item)
}
