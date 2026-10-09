import { overall, type Mastery, type MasteryState } from './mastery.ts'

/**
 * What a subject is made of, and what has to come first.
 *
 * A flat list of topics cannot answer the question that matters most when somebody is stuck: *is this hard, or did
 * they skip the thing underneath it?* Projectile motion rests on vectors and on the equations of motion, and a
 * student failing at it may simply never have had velocity land. So the shape is a tree with prerequisites across
 * it:
 *
 *     Subject → Chapter → Concept, and Concept ──requires──▶ Concept
 *
 * ## The one thing this is for
 *
 * `blockedBy` -- given what somebody actually knows, which prerequisite is holding a concept up. Everything else
 * here exists to make that question answerable. Recommending a topic whose foundation is missing wastes the
 * session and teaches the student that the recommendations are not worth following.
 *
 * Pure. Cycles are tolerated rather than trusted: every walk is depth-bounded and visit-marked, because a
 * student-authored syllabus will eventually contain a loop and that must not hang the application.
 */

export interface Concept {
  id: string
  name: string
  chapterId: string
  /** Concept ids that should come first. */
  requires: readonly string[]
  /** How hard it is, 1 to 5, as the student or the syllabus said. Never guessed. */
  difficulty: number
  /** How much it matters for what they are working toward, 0..1. */
  importance: number
  order: number
}

export interface Chapter {
  id: string
  name: string
  subject: string
  order: number
}

export interface Graph {
  chapters: readonly Chapter[]
  concepts: readonly Concept[]
}

export function emptyGraph(): Graph {
  return { chapters: [], concepts: [] }
}

const MAX_WALK = 200

/** Every concept in a chapter, in order. */
export function conceptsIn(graph: Graph, chapterId: string): Concept[] {
  return graph.concepts.filter((one) => one.chapterId === chapterId).sort((a, b) => a.order - b.order)
}

/** Every chapter of a subject, in order. */
export function chaptersOf(graph: Graph, subject: string): Chapter[] {
  return graph.chapters.filter((one) => one.subject === subject).sort((a, b) => a.order - b.order)
}

export function subjectsOf(graph: Graph): string[] {
  return [...new Set(graph.chapters.map((one) => one.subject))].sort()
}

export function conceptById(graph: Graph, id: string): Concept | null {
  return graph.concepts.find((one) => one.id === id) ?? null
}

/**
 * Everything a concept rests on, however deep.
 *
 * Visit-marked and depth-bounded, so a syllabus with a loop in it returns a sensible answer instead of running for
 * ever.
 */
export function allPrerequisites(graph: Graph, conceptId: string): Concept[] {
  const seen = new Set<string>([conceptId])
  const out: Concept[] = []
  const queue = [...(conceptById(graph, conceptId)?.requires ?? [])]
  let steps = 0
  while (queue.length > 0 && steps < MAX_WALK) {
    steps += 1
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    const one = conceptById(graph, id)
    if (!one) continue
    out.push(one)
    queue.push(...one.requires)
  }
  return out
}

/** What rests on this one, so finishing it can be said to unlock something. */
export function unlockedBy(graph: Graph, conceptId: string): Concept[] {
  return graph.concepts.filter((one) => one.requires.includes(conceptId))
}

export interface Blocker {
  concept: Concept
  /** How well it is known, 0..1. */
  score: number
  state: MasteryState
}

/**
 * Which prerequisite is holding a concept up, if any.
 *
 * Returns the shallowest weak prerequisite first, because that is the one to fix: there is no point sending somebody
 * to the root of the tree when the thing directly underneath is the gap. Nothing is called a blocker on no
 * evidence -- a prerequisite nobody has ever attempted is reported as untouched rather than as weak, which is a
 * different sentence and a different fix.
 */
export function blockedBy(graph: Graph, conceptId: string, mastery: ReadonlyMap<string, Mastery>, floor = 0.45): { blockers: Blocker[]; untouched: Concept[] } {
  const direct = conceptById(graph, conceptId)?.requires ?? []
  const blockers: Blocker[] = []
  const untouched: Concept[] = []
  const seen = new Set<string>([conceptId])
  let layer = direct.map((id) => conceptById(graph, id)).filter((one): one is Concept => one !== null)
  let depth = 0

  while (layer.length > 0 && depth < 8) {
    const next: Concept[] = []
    for (const one of layer) {
      if (seen.has(one.id)) continue
      seen.add(one.id)
      const held = mastery.get(one.id)
      if (!held || (held.attempts === 0 && held.evidence.read === 0)) {
        untouched.push(one)
        continue
      }
      const score = overall(held)
      if (score < floor) {
        blockers.push({ concept: one, score, state: held.state })
        // A weak prerequisite is the thing to fix; what is under it is somebody else's problem for now.
        continue
      }
      next.push(...one.requires.map((id) => conceptById(graph, id)).filter((x): x is Concept => x !== null))
    }
    layer = next
    depth += 1
  }
  return { blockers: blockers.sort((a, b) => a.score - b.score), untouched }
}

/**
 * Whether a concept is ready to be worked on.
 *
 * Ready means the things under it are good enough. A concept that is not ready is not a bad recommendation -- it is
 * the wrong recommendation, and the right one is sitting underneath it.
 */
export function readyFor(graph: Graph, conceptId: string, mastery: ReadonlyMap<string, Mastery>): { ready: boolean; instead: Concept | null; why: string } {
  const { blockers, untouched } = blockedBy(graph, conceptId, mastery)
  if (blockers.length === 0 && untouched.length === 0) return { ready: true, instead: null, why: '' }
  if (untouched.length > 0) {
    const one = untouched[0]
    return { ready: false, instead: one, why: `${one.name} comes first, and you have not started it.` }
  }
  const worst = blockers[0]
  return { ready: false, instead: worst.concept, why: `${worst.concept.name} needs shoring up first.` }
}

/** The order to work through a chapter, prerequisites before the things that need them. */
export function pathThrough(graph: Graph, chapterId: string): Concept[] {
  const inside = conceptsIn(graph, chapterId)
  const ids = new Set(inside.map((one) => one.id))
  const done = new Set<string>()
  const out: Concept[] = []
  let guard = 0
  while (out.length < inside.length && guard < MAX_WALK) {
    guard += 1
    let moved = false
    for (const one of inside) {
      if (done.has(one.id)) continue
      // Prerequisites from outside the chapter are somebody else's order to decide.
      const waiting = one.requires.filter((id) => ids.has(id) && !done.has(id))
      if (waiting.length > 0) continue
      done.add(one.id)
      out.push(one)
      moved = true
    }
    // A loop inside the chapter: the rest goes in its stated order rather than hanging.
    if (!moved) {
      for (const one of inside) if (!done.has(one.id)) out.push(one)
      break
    }
  }
  return out
}

// ---------------------------------------------------------------- progress across the tree

export interface Progress {
  /** 0..1, from the mastery of the concepts under it. */
  score: number
  concepts: number
  /** How many have real evidence behind them. */
  started: number
  mastered: number
  weak: number
  /** How many have never been touched. */
  untouched: number
  /** How sure the figure is, from the evidence underneath it. */
  confidence: number
}

function progressOver(concepts: readonly Concept[], mastery: ReadonlyMap<string, Mastery>): Progress {
  if (concepts.length === 0) return { score: 0, concepts: 0, started: 0, mastered: 0, weak: 0, untouched: 0, confidence: 0 }
  let sum = 0
  let confidence = 0
  let started = 0
  let masteredCount = 0
  let weak = 0
  let untouched = 0
  for (const one of concepts) {
    const held = mastery.get(one.id)
    if (!held || (held.attempts === 0 && held.evidence.read === 0)) {
      untouched += 1
      continue
    }
    started += 1
    const score = overall(held)
    sum += score
    confidence += held.confidence
    if (held.state === 'mastered') masteredCount += 1
    if (score < 0.45 || held.state === 'slipping') weak += 1
  }
  return {
    // Untouched concepts count as zero: a chapter is not 80% done because the one topic opened went well.
    score: sum / concepts.length,
    concepts: concepts.length,
    started,
    mastered: masteredCount,
    weak,
    untouched,
    confidence: started > 0 ? confidence / started : 0
  }
}

export function chapterProgress(graph: Graph, chapterId: string, mastery: ReadonlyMap<string, Mastery>): Progress {
  return progressOver(conceptsIn(graph, chapterId), mastery)
}

export function subjectProgress(graph: Graph, subject: string, mastery: ReadonlyMap<string, Mastery>): Progress {
  const chapters = new Set(chaptersOf(graph, subject).map((one) => one.id))
  return progressOver(
    graph.concepts.filter((one) => chapters.has(one.chapterId)),
    mastery
  )
}

/** The whole tree with its numbers, for the progress map. */
export function tree(
  graph: Graph,
  mastery: ReadonlyMap<string, Mastery>
): { subject: string; progress: Progress; chapters: { chapter: Chapter; progress: Progress; concepts: { concept: Concept; score: number; state: MasteryState; confidence: number }[] }[] }[] {
  return subjectsOf(graph).map((subject) => ({
    subject,
    progress: subjectProgress(graph, subject, mastery),
    chapters: chaptersOf(graph, subject).map((chapter) => ({
      chapter,
      progress: chapterProgress(graph, chapter.id, mastery),
      concepts: conceptsIn(graph, chapter.id).map((concept) => {
        const held = mastery.get(concept.id)
        return { concept, score: held ? overall(held) : 0, state: held?.state ?? ('new' as MasteryState), confidence: held?.confidence ?? 0 }
      })
    }))
  }))
}

// ---------------------------------------------------------------- building one

export interface SyllabusLine {
  /** Indentation decides the level: subject, then chapter, then concept. */
  depth: number
  text: string
}

/**
 * A syllabus typed or pasted in, read as a tree.
 *
 * Indentation decides the level, because that is how people already write a syllabus -- and anything that cannot
 * be read is reported rather than guessed at, so a student can fix their own list instead of wondering why half of
 * it vanished. Nothing is invented: no difficulty, no importance, no prerequisites. Those are the student's to say.
 */
export function readSyllabus(text: string, _now?: number): { graph: Graph; skipped: readonly string[] } {
  const lines: SyllabusLine[] = (text ?? '')
    .split('\n')
    .map((raw) => {
      const trimmed = raw.replace(/\t/g, '  ').replace(/^[\s>•*-]*/, (lead) => lead)
      if (!trimmed.trim()) return null
      const indent = (trimmed.match(/^\s*/)?.[0].length ?? 0) / 2
      const clean = trimmed.replace(/^[\s>•*\-\d.)]+/, '').trim()
      return clean ? { depth: Math.min(2, Math.floor(indent)), text: clean.slice(0, 120) } : null
    })
    .filter((one): one is SyllabusLine => one !== null)

  const chapters: Chapter[] = []
  const concepts: Concept[] = []
  const skipped: string[] = []
  let subject: string | null = null
  let chapter: Chapter | null = null
  let chapterOrder = 0
  let conceptOrder = 0

  /*
   * The id is worked out from the names alone, deliberately.
   *
   * Nothing about the clock goes into it, so importing the same syllabus again recognises every topic it already
   * has instead of making a second copy of all of them -- and a topic keeps its measured mastery when a student
   * re-pastes a syllabus with one line added.
   */
  const id = (kind: string, name: string): string => `${kind}:${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}`

  for (const line of lines) {
    if (line.depth === 0) {
      subject = line.text
      chapterOrder = 0
      chapter = null
      continue
    }
    if (!subject) {
      // A chapter before any subject has nothing to belong to. Said rather than dropped silently.
      skipped.push(line.text)
      continue
    }
    if (line.depth === 1) {
      chapter = { id: id('chapter', `${subject}-${line.text}`), name: line.text, subject, order: chapterOrder++ }
      chapters.push(chapter)
      conceptOrder = 0
      continue
    }
    if (!chapter) {
      // A concept with no chapter: given one named after the subject rather than thrown away.
      chapter = { id: id('chapter', `${subject}-general`), name: subject, subject, order: chapterOrder++ }
      chapters.push(chapter)
      conceptOrder = 0
    }
    concepts.push({ id: id('concept', `${chapter.name}-${line.text}`), name: line.text, chapterId: chapter.id, requires: [], difficulty: 3, importance: 0.5, order: conceptOrder++ })
  }

  return { graph: { chapters, concepts }, skipped }
}

/** Two graphs joined, keeping what was already there. For adding a subject without losing the rest. */
export function merge(held: Graph, added: Graph): Graph {
  const chapterNames = new Map(held.chapters.map((one) => [`${one.subject}|${one.name}`.toLowerCase(), one]))
  const chapters = [...held.chapters]
  const remap = new Map<string, string>()
  for (const one of added.chapters) {
    const key = `${one.subject}|${one.name}`.toLowerCase()
    const already = chapterNames.get(key)
    if (already) {
      remap.set(one.id, already.id)
      continue
    }
    chapters.push(one)
    chapterNames.set(key, one)
  }
  const conceptNames = new Set(held.concepts.map((one) => `${one.chapterId}|${one.name}`.toLowerCase()))
  const concepts = [...held.concepts]
  for (const one of added.concepts) {
    const chapterId = remap.get(one.chapterId) ?? one.chapterId
    const key = `${chapterId}|${one.name}`.toLowerCase()
    if (conceptNames.has(key)) continue
    conceptNames.add(key)
    concepts.push({ ...one, chapterId })
  }
  return { chapters, concepts }
}
