/**
 * "These are results for…" -- and, much more often, deciding not to say it.
 *
 * Correcting a query is the easiest way for a search engine to insult somebody. Every real search engine has told a
 * developer that `Qwen` should be `Queen`, that `webkit` should be `web kit`, that their colleague's surname is a
 * typo. The cost is asymmetric: a missed correction is a slightly worse result page, while a wrong correction throws
 * away what the person actually asked for and then shows them results about something else.
 *
 * So the default is to leave the query alone, and the interesting logic here is all about refusing (§7):
 *
 *   - anything quoted is meant literally
 *   - anything with a search operator was typed by someone who knows what they are doing
 *   - addresses, identifiers, model numbers, versions, code: never
 *   - a word that is simply unfamiliar is not a misspelling; unfamiliar is the normal state of names
 *   - a correction must be a small edit away, and must be a word we have reason to believe in
 *
 * What remains is the narrow case worth acting on: a real typo in an ordinary word, or a name that is one obvious slip
 * from a name we were actually given by the search results (`suggest`). Both keep the original one click away (§8),
 * because the person is the authority on what they meant.
 */

export interface Correction {
  /** What Orbis will search instead. */
  corrected: string
  /** What was typed. Always kept, always offered back. */
  original: string
  /** Why, in words, for the page and for anybody debugging a correction that should not have happened. */
  because: string
  confidence: number
}

/** Never touched, whatever they look like. */
const NEVER = [
  /^(https?:\/\/|www\.)/i,
  /[a-z0-9-]+\.(com|org|net|io|dev|ai|co|edu|gov|app|sh|xyz|me|tv|uk|in|de|jp|cn)(\/|$)/i,
  /[_/\\<>{}[\]|`~@#$]/,
  /::|=>|->|\(\)|\{\}/,
  /\bv?\d+\.\d+(\.\d+)?\b/,
  /\b[a-z]+\d+[a-z]*\b/i,
  /\b\d+[a-z]{1,4}\b/i,
  /\b[a-z]+[A-Z]/,
  /\b(git|npm|pip|sudo|apt|curl|ssh|sql|regex|json|yaml|html|css|api|sdk|cli|http)\b/i,
  /\b[a-z0-9]+(-[a-z0-9]+){2,}\b/i
]

/** Words worth believing in, for the one case this file acts on without being told: a plain typo in a common word. */
const COMMON: Record<string, string> = {
  teh: 'the',
  adn: 'and',
  yuo: 'you',
  recieve: 'receive',
  seperate: 'separate',
  definately: 'definitely',
  occured: 'occurred',
  neccessary: 'necessary',
  accomodation: 'accommodation',
  tommorow: 'tomorrow',
  wierd: 'weird',
  acheive: 'achieve',
  begining: 'beginning',
  calender: 'calendar',
  cemetary: 'cemetery',
  concious: 'conscious',
  embarass: 'embarrass',
  enviroment: 'environment',
  existance: 'existence',
  goverment: 'government',
  independant: 'independent',
  liesure: 'leisure',
  maintainance: 'maintenance',
  occassion: 'occasion',
  persistant: 'persistent',
  priviledge: 'privilege',
  publically: 'publicly',
  recomend: 'recommend',
  refered: 'referred',
  relevent: 'relevant',
  succesful: 'successful',
  supercede: 'supersede',
  threshhold: 'threshold',
  untill: 'until',
  wich: 'which'
}

const clean = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()

/** Whether this query must be left exactly as typed. */
export function mustNotCorrect(query: string): boolean {
  const q = clean(query)
  if (!q) return true
  if (/"/.test(q)) return true
  if (/\b(site|filetype|ext|intitle|inurl|before|after|lang|loc):/i.test(q)) return true
  return NEVER.some((rule) => rule.test(q))
}

/** Edit distance, stopping once it is past what we would ever accept. Cheap because the cap keeps it small. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost)
      row.push(value)
      if (value < best) best = value
    }
    if (best > cap) return cap + 1
    previous = row
  }
  return previous[b.length]
}

/** Whether two strings differ only by two neighbours swapped -- the commonest slip of all, and worth treating gently. */
export function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const differ: number[] = []
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) differ.push(i)
  if (differ.length !== 2) return false
  const [x, y] = differ
  return y === x + 1 && a[x] === b[y] && a[y] === b[x]
}

/**
 * How far apart two whole queries are, ignoring where the spaces fell.
 *
 * "leec hong wei" and "lee chong wei" are one letter apart once the spaces are taken out, and a rule that compared
 * word by word would never see it. Comparing the letters alone catches the missing space, the extra space and the
 * slipped key in one measure.
 */
export function letterDistance(a: string, b: string, cap = 3): number {
  const strip = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return editDistance(strip(a), strip(b), cap)
}

/**
 * The correction, if there is one worth making.
 *
 * `candidates` are names the search itself produced -- titles of results, entity names, whatever the providers
 * actually returned. This is the evidence §7 asks for: Orbis does not invent a spelling, it recognises that what was
 * typed is a slip away from something real that came back from the web. With no candidates it will still fix a plain
 * typo in a common word, and nothing else.
 */
export function correctQuery(query: string, candidates: string[] = []): Correction | null {
  const original = clean(query)
  if (!original || mustNotCorrect(original)) return null

  // ---- a name that is one slip from something the web actually returned
  const seen = new Set<string>()
  let best: { text: string; distance: number } | null = null
  for (const raw of candidates) {
    const candidate = clean(raw)
    if (!candidate || candidate.length < 3 || candidate.length > 60) continue
    const key = candidate.toLowerCase()
    if (key === original.toLowerCase()) return null // what was typed is already one of the real answers
    if (seen.has(key)) continue
    seen.add(key)
    // Only a comparable number of words: "lee" should not be "corrected" to a sentence that happens to contain it.
    if (Math.abs(candidate.split(' ').length - original.split(' ').length) > 1) continue
    const distance = letterDistance(original, candidate)
    if (distance > 2) continue
    if (!best || distance < best.distance) best = { text: candidate, distance }
  }
  if (best) {
    const letters = original.replace(/[^a-z0-9]/gi, '').length
    // One slip in a short word is most of the word, and a short word is where a wrong correction is most insulting:
    // "Qwen" is one letter from "Queen" and is not a misspelling of it. So the edit must be small *and* the query long.
    if (letters >= 8 && letters >= best.distance * 4) {
      return {
        corrected: best.text,
        original,
        because: best.distance === 0 ? 'The same words, spaced the way the web spells them' : 'This is very close to something the web returned',
        confidence: best.distance <= 1 ? 0.8 : 0.6
      }
    }
  }

  // ---- a plain typo in an ordinary word, which needs no evidence beyond being a known misspelling
  const words = original.split(' ')
  let changed = false
  const fixed = words.map((word) => {
    const bare = word.toLowerCase().replace(/[^a-z]/g, '')
    const known = COMMON[bare]
    if (!known) return word
    changed = true
    return word.replace(new RegExp(bare, 'i'), (m) => (m[0] === m[0].toUpperCase() ? known[0].toUpperCase() + known.slice(1) : known))
  })
  if (changed) {
    return { corrected: fixed.join(' '), original, because: 'A common misspelling', confidence: 0.85 }
  }

  return null
}

/**
 * What the page says about it (§6). Never "did you mean" as a question Orbis leaves hanging: the corrected search has
 * already been run, and the original is one click away.
 */
export const correctionLines = (correction: Correction): { showing: string; instead: string } => ({
  showing: `These are results for ${correction.corrected}`,
  instead: `Search instead for ${correction.original}`
})
