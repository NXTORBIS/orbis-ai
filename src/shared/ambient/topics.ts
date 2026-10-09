/**
 * Working out what something is about, from its name and its address.
 *
 * ## Deterministic first, and usually only
 *
 * A page called "Projectile Motion — Kinematics | NCERT" says what it is about in plain words. Asking a model
 * costs a round trip, a token bill and a network connection to learn what a regular expression already knows, and
 * it would do it again for every tab. So this does the obvious part by itself, offline, instantly — and the
 * service may ask Orion afterwards only for the cases this returns nothing useful for.
 *
 * ## It is allowed to say it does not know
 *
 * `topicsOf` returning nothing is the expected outcome for a great deal of ordinary browsing, and it is the right
 * one. The alternative — a confident subject attached to every page somebody opens — is what makes a feature like
 * this feel like it is making things up, and one wrong guess costs more trust than ten useful ones earn.
 *
 * ## Web text is data
 *
 * Everything in here reads page titles and addresses, which are written by whoever made the page. Nothing read
 * here becomes an instruction: a title saying "ignore previous instructions" is a title about instructions, and
 * it is treated as six words.
 */

export interface Topic {
  /** The broad subject, as somebody would say it: "Physics", "Programming". */
  subject: string
  /** The specific thing within it, when there is one: "Kinematics", "React". */
  concept: string | null
  /** 0..1. How sure, from how it was found. */
  confidence: number
  /** What it was found in, for the evidence trail. */
  from: string
}

export interface Entity {
  id: string
  type: 'site' | 'product' | 'technology' | 'subject' | 'person' | 'organisation' | 'file' | 'place'
  name: string
  aliases: string[]
}

/**
 * Subjects, and the words that mean them.
 *
 * A deliberately small, hand-written table rather than a model. It covers what students and developers actually
 * open, it is instant, it is the same every time, and when it does not know something it says so — which is
 * exactly the behaviour wanted. Growing it is adding a line.
 */
const SUBJECTS: readonly { subject: string; concepts: Readonly<Record<string, readonly string[]>>; words: readonly string[] }[] = [
  {
    subject: 'Physics',
    words: ['physics', 'newton', 'quantum', 'thermodynamics', 'relativity', 'optics', 'electromagnet'],
    concepts: {
      Kinematics: ['kinematic', 'projectile', 'velocity', 'acceleration', 'displacement', 'free fall'],
      Mechanics: ['mechanic', 'newton', 'force', 'momentum', 'friction', 'torque'],
      Thermodynamics: ['thermodynamic', 'entropy', 'heat engine', 'carnot'],
      Optics: ['optic', 'refraction', 'lens', 'diffraction', 'interference'],
      Electromagnetism: ['electromagnet', 'magnetic field', 'faraday', 'maxwell', 'capacitor'],
      'Quantum mechanics': ['quantum', 'schrodinger', 'wave function', 'photoelectric']
    }
  },
  {
    subject: 'Chemistry',
    words: ['chemistry', 'chemical', 'molecule', 'periodic table', 'stoichiometry'],
    concepts: {
      'Organic chemistry': ['organic chem', 'alkane', 'alkene', 'benzene', 'hydrocarbon', 'isomer'],
      'The mole concept': ['mole concept', 'stoichiometr', 'molar mass', 'avogadro'],
      'Chemical bonding': ['bonding', 'covalent', 'ionic bond', 'hybridis', 'hybridiz'],
      Thermochemistry: ['enthalp', 'thermochem', 'calorimet']
    }
  },
  {
    subject: 'Mathematics',
    words: ['math', 'maths', 'mathematics', 'algebra', 'calculus', 'geometry', 'trigonometry'],
    concepts: {
      Calculus: ['calculus', 'derivative', 'integral', 'differentiat', 'limits'],
      Algebra: ['algebra', 'polynomial', 'quadratic', 'matrices', 'matrix'],
      Trigonometry: ['trigonometr', 'sine rule', 'cosine rule'],
      Probability: ['probabilit', 'permutation', 'combination', 'bayes']
    }
  },
  {
    subject: 'Biology',
    words: ['biology', 'cell', 'genetics', 'evolution', 'anatomy', 'photosynthesis'],
    concepts: {
      Genetics: ['genetic', 'dna', 'rna', 'chromosome', 'mendel'],
      'Cell biology': ['cell biolog', 'mitosis', 'meiosis', 'organelle'],
      Ecology: ['ecolog', 'ecosystem', 'food chain']
    }
  },
  {
    subject: 'Programming',
    words: ['programming', 'code', 'coding', 'developer', 'github', 'stack overflow', 'api', 'compiler'],
    concepts: {
      JavaScript: ['javascript', 'typescript', ' js ', 'node.js', 'nodejs'],
      React: ['react', 'jsx', 'usestate', 'useeffect', 'next.js'],
      Python: ['python', 'pandas', 'numpy', 'django', 'flask'],
      Rust: ['rust lang', 'rustlang', 'cargo crate'],
      Databases: ['sql', 'postgres', 'sqlite', 'database', 'mongodb'],
      'Machine learning': ['machine learning', 'neural network', 'pytorch', 'tensorflow', 'llm']
    }
  },
  {
    subject: 'History',
    words: ['history', 'historical', 'ancient', 'medieval', 'revolution', 'empire', 'world war'],
    concepts: {
      'World wars': ['world war', 'ww1', 'ww2'],
      'Indian history': ['mughal', 'maurya', 'indian independence', 'freedom struggle']
    }
  },
  {
    subject: 'Technology',
    words: ['gpu', 'cpu', 'laptop', 'smartphone', 'benchmark', 'hardware', 'processor', 'graphics card'],
    concepts: {
      'Graphics cards': ['gpu', 'rtx', 'radeon', 'geforce', 'graphics card'],
      Processors: ['cpu', 'ryzen', 'core i7', 'core i9', 'snapdragon'],
      Phones: ['smartphone', 'iphone', 'android phone', 'pixel ']
    }
  },
  { subject: 'Economics', words: ['economic', 'inflation', 'macroeconom', 'microeconom', 'gdp'], concepts: {} },
  { subject: 'Geography', words: ['geography', 'climate', 'tectonic', 'monsoon'], concepts: {} },
  { subject: 'English', words: ['grammar', 'literature', 'poetry', 'essay writing', 'shakespeare'], concepts: {} }
]

/** Sites that say what somebody is doing more clearly than the page title does. */
const SITE_MEANING: Readonly<Record<string, { subject?: string; doing: string }>> = {
  'github.com': { subject: 'Programming', doing: 'code' },
  'stackoverflow.com': { subject: 'Programming', doing: 'code' },
  'developer.mozilla.org': { subject: 'Programming', doing: 'code' },
  'npmjs.com': { subject: 'Programming', doing: 'code' },
  'youtube.com': { doing: 'watch' },
  'wikipedia.org': { doing: 'read' },
  'scholar.google.com': { doing: 'research' },
  'arxiv.org': { doing: 'research' },
  'amazon.com': { doing: 'shop' },
  'amazon.in': { doing: 'shop' },
  'flipkart.com': { doing: 'shop' },
  'docs.google.com': { doing: 'write' },
  'notion.so': { doing: 'write' },
  'khanacademy.org': { doing: 'learn' },
  'coursera.org': { doing: 'learn' },
  'byjus.com': { doing: 'learn' },
  'ncert.nic.in': { doing: 'learn' }
}

const plain = (text: string): string => ` ${text.toLowerCase().replace(/[_\-/.]+/g, ' ').replace(/\s+/g, ' ')} `

/**
 * What a piece of text is about.
 *
 * Returns every subject it can justify, best first, rather than one — a page can genuinely be about two things,
 * and the aggregator upstream is better placed than this is to decide which matters.
 */
export function topicsOf(text: string, where = 'title'): Topic[] {
  const hay = plain(text)
  if (hay.trim().length < 3) return []
  const found: Topic[] = []

  for (const one of SUBJECTS) {
    let concept: string | null = null
    let conceptHit = false
    for (const [name, words] of Object.entries(one.concepts)) {
      if (words.some((word) => hay.includes(word))) {
        concept = name
        conceptHit = true
        break
      }
    }
    const subjectHit = one.words.some((word) => hay.includes(word))
    if (!subjectHit && !conceptHit) continue
    /*
     * A named concept is far better evidence than a subject word.
     *
     * "Physics" in a title could be a news story about a physicist. "Projectile motion" is somebody studying
     * kinematics, and almost nothing else -- and since every concept belongs to exactly one subject here, naming
     * the concept names the subject too, whether or not the subject's own word appears anywhere.
     */
    const confidence = conceptHit && subjectHit ? 0.94 : conceptHit ? 0.88 : 0.55
    found.push({ subject: one.subject, concept, confidence, from: where })
  }

  return found.sort((a, b) => b.confidence - a.confidence)
}

/** What a site suggests somebody is doing, when the site is one whose purpose is unambiguous. */
export function meaningOfSite(host: string): { subject?: string; doing: string } | null {
  const bare = host.replace(/^www\./, '').toLowerCase()
  if (SITE_MEANING[bare]) return SITE_MEANING[bare]
  for (const [known, meaning] of Object.entries(SITE_MEANING)) {
    if (bare === known || bare.endsWith(`.${known}`)) return meaning
  }
  return null
}

/**
 * What a search was really asking.
 *
 * Searches are the single best signal there is, because they are somebody stating their intent in their own
 * words. Site names and stop words are stripped so "best way to solve projectile motion" becomes the part that
 * means something.
 */
const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'for', 'and', 'or', 'is', 'are', 'what', 'how', 'why', 'best', 'top',
  'with', 'without', 'my', 'me', 'i', 'on', 'at', 'from', 'by', 'about', 'vs', 'versus', 'can', 'do', 'does',
  'solve', 'solving', 'explain', 'example', 'examples', 'tutorial', 'guide', 'way', 'ways', 'methods', 'method'
])

export function keywordsOf(text: string, most = 8): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]+/g, ' ')
    .split(/\s+/)
    .map((one) => one.replace(/^\.+|\.+$/g, ''))
    .filter((one) => one.length > 2 && !STOP.has(one))
  const seen = new Set<string>()
  const out: string[] = []
  for (const one of words) {
    if (seen.has(one)) continue
    seen.add(one)
    out.push(one)
    if (out.length >= most) break
  }
  return out
}

/**
 * The things named in a piece of text.
 *
 * Conservative on purpose: a capitalised word is only a name when it is not at the start of the sentence and not
 * a word the table already knows as a subject. Over-eager entity extraction produces a graph full of "The" and
 * "Monday", which is worse than an empty one because it looks like it is working.
 */
export function entitiesOf(text: string, host?: string): Entity[] {
  const out: Entity[] = []
  const add = (type: Entity['type'], name: string): void => {
    const id = `${type}:${name.toLowerCase()}`
    if (!out.some((one) => one.id === id)) out.push({ id, type, name, aliases: [] })
  }

  if (host) {
    const bare = host.replace(/^www\./, '')
    const label = bare.split('.')[0]
    add('site', label.charAt(0).toUpperCase() + label.slice(1))
  }

  for (const one of topicsOf(text)) {
    add('subject', one.concept ?? one.subject)
  }

  // Product-shaped names: letters and digits together, like RTX 4090 or GPT-4.
  for (const match of text.matchAll(/\b([A-Z][A-Za-z]{1,12})[\s-]?(\d{2,5})\b/g)) {
    add('product', `${match[1]} ${match[2]}`)
  }

  // Proper nouns, but never the first word of the text, which is capitalised for being first.
  const words = text.split(/\s+/)
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i].replace(/[^A-Za-z]/g, '')
    if (word.length < 3 || word.length > 20) continue
    if (word[0] !== word[0].toUpperCase()) continue
    if (word === word.toUpperCase() && word.length <= 4) continue
    if (STOP.has(word.toLowerCase())) continue
    add('organisation', word)
    if (out.length > 12) break
  }

  return out.slice(0, 12)
}

/**
 * Whether two names are the same thing.
 *
 * Only on exact or containment matches, never on a loose similarity. Merging "React" with "Reactor" because they
 * share four letters produces a graph that confidently relates two unrelated things, and nothing downstream can
 * tell that happened.
 */
export function sameEntity(a: Entity, b: Entity): boolean {
  if (a.id === b.id) return true
  if (a.type !== b.type) return false
  const left = a.name.toLowerCase()
  const right = b.name.toLowerCase()
  if (left === right) return true
  if (a.aliases.includes(right) || b.aliases.includes(left)) return true
  return false
}

/** A title turned into something sayable: a subject, a concept, or the title cleaned up. */
export function nameFor(topics: readonly Topic[], fallbackTitle: string): string {
  const best = topics[0]
  if (best?.concept) return best.concept
  if (best) return best.subject
  // Site names and separators out of the title, so "Thing — Site | Other" becomes "Thing".
  const cut = fallbackTitle.split(/\s[—|·–-]\s/)[0].trim()
  return cut.slice(0, 60) || fallbackTitle.slice(0, 60)
}
