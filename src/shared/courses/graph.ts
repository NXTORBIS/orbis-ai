/**
 * What has to come before what, and what to do when it has not.
 *
 * ## The point of the graph is remediation, not decoration
 *
 * Somebody stuck on quadratics usually does not have a quadratics problem — they have a factorisation problem
 * that quadratics is the first thing to expose. Telling them to re-read the quadratics lesson sends them back
 * over the one page that cannot help. The graph exists so Orbis can say *which earlier thing* is actually in the
 * way, and offer that instead.
 *
 * Nobody is ever shown the graph. It is a tool for choosing what to offer next.
 *
 * ## It is honest about cycles
 *
 * A course written by hand, or imported, can easily declare a loop. Rather than hanging or recursing for ever,
 * everything here walks with a visited set and a depth limit, and `cyclesIn` reports them so validation can
 * refuse the course.
 */

import { faded, NEEDS } from './mastery.ts'
import type { Concept, Course, Lesson, MasteryRecord } from './types.ts'

export interface Graph {
  concepts: Map<string, Concept>
  /** Concept id to the concepts it needs. */
  requires: Map<string, string[]>
  /** Concept id to the concepts that need it. */
  unlocks: Map<string, string[]>
  /** Concept id to the lessons that teach it, in course order. */
  taughtBy: Map<string, string[]>
}

export function buildGraph(course: Course): Graph {
  const concepts = new Map<string, Concept>()
  const requires = new Map<string, string[]>()
  const unlocks = new Map<string, string[]>()
  const taughtBy = new Map<string, string[]>()

  for (const one of course.concepts) {
    concepts.set(one.id, one)
    // Only edges to concepts the course actually declares: a dangling edge would make a gap nobody can fill.
    requires.set(one.id, one.requires.filter((two) => course.concepts.some((three) => three.id === two)))
  }
  for (const [id, needs] of requires) {
    for (const one of needs) unlocks.set(one, [...(unlocks.get(one) ?? []), id])
  }
  for (const module of course.modules) {
    for (const lesson of module.lessons) {
      for (const concept of lesson.concepts) taughtBy.set(concept, [...(taughtBy.get(concept) ?? []), lesson.id])
    }
  }

  return { concepts, requires, unlocks, taughtBy }
}

/**
 * Everything a concept rests on, nearest first.
 *
 * Breadth-first with a visited set, so a loop costs one pass rather than the stack.
 */
export function ancestorsOf(graph: Graph, concept: string, depth = 4): string[] {
  const out: string[] = []
  const seen = new Set<string>([concept])
  let layer = [concept]
  for (let level = 0; level < depth && layer.length > 0; level += 1) {
    const next: string[] = []
    for (const one of layer) {
      for (const need of graph.requires.get(one) ?? []) {
        if (seen.has(need)) continue
        seen.add(need)
        out.push(need)
        next.push(need)
      }
    }
    layer = next
  }
  return out
}

/** Loops in the course's own prerequisites. A course with one of these cannot be taught in order. */
export function cyclesIn(graph: Graph): string[][] {
  const found: string[][] = []
  const colour = new Map<string, 'grey' | 'black'>()
  const stack: string[] = []

  const walk = (id: string): void => {
    const seen = colour.get(id)
    if (seen === 'black') return
    if (seen === 'grey') {
      const from = stack.indexOf(id)
      if (from >= 0) found.push([...stack.slice(from), id])
      return
    }
    colour.set(id, 'grey')
    stack.push(id)
    for (const need of graph.requires.get(id) ?? []) walk(need)
    stack.pop()
    colour.set(id, 'black')
  }

  for (const id of graph.concepts.keys()) walk(id)
  return found
}

/**
 * The earlier concept actually standing in the way.
 *
 * Returns the weakest thing the struggling concept rests on — and null when the prerequisites are all solid,
 * because then the problem really is this concept and sending somebody backwards would waste their time.
 */
export function blockedBy(
  graph: Graph,
  concept: string,
  mastery: Readonly<Record<string, MasteryRecord>>,
  now: number
): { concept: Concept; score: number; says: string } | null {
  const below = ancestorsOf(graph, concept)
  let worst: { id: string; score: number } | null = null
  for (const one of below) {
    const record = mastery[one]
    // Never met is not a weakness; it is simply further back in the course.
    if (!record || record.seen === 0) continue
    const score = faded(record, now)
    if (score >= NEEDS.applied.score) continue
    if (!worst || score < worst.score) worst = { id: one, score }
  }
  if (!worst) return null
  const found = graph.concepts.get(worst.id)
  if (!found) return null
  return {
    concept: found,
    score: worst.score,
    says: `This leans on ${found.name}, and that one is shaky. Worth five minutes there first.`
  }
}

/** Whether somebody is ready for a lesson, and what is missing if not. */
export function readyFor(
  graph: Graph,
  lesson: Lesson,
  mastery: Readonly<Record<string, MasteryRecord>>,
  now: number
): { ready: boolean; missing: Concept[]; says: string } {
  const missing: Concept[] = []
  for (const one of lesson.requires) {
    const record = mastery[one]
    const score = record ? faded(record, now) : 0
    if (score < NEEDS.practised.score) {
      const found = graph.concepts.get(one)
      if (found) missing.push(found)
    }
  }
  if (missing.length === 0) return { ready: true, missing: [], says: '' }
  /*
   * Ready is still true.
   *
   * A missing prerequisite is worth saying and never worth blocking on: people skip around, revisit, and learn
   * perfectly well out of order, and a course that locks its own lessons is a course people abandon.
   */
  return {
    ready: true,
    missing,
    says: missing.length === 1 ? `This builds on ${missing[0].name}.` : `This builds on ${missing.map((one) => one.name).join(' and ')}.`
  }
}

/**
 * The order concepts can actually be learned in.
 *
 * A plain topological sort, falling back to course order for anything caught in a loop, so an imported course
 * with a bad edge still produces a usable order rather than nothing.
 */
export function teachingOrder(graph: Graph): string[] {
  const out: string[] = []
  const done = new Set<string>()
  const visiting = new Set<string>()

  const visit = (id: string): void => {
    if (done.has(id) || visiting.has(id)) return
    visiting.add(id)
    for (const need of graph.requires.get(id) ?? []) visit(need)
    visiting.delete(id)
    done.add(id)
    out.push(id)
  }

  for (const id of graph.concepts.keys()) visit(id)
  return out
}

/** What a concept opens up, for "worth doing because three later things need it". */
export function worthOf(graph: Graph, concept: string): number {
  const found = graph.concepts.get(concept)
  const opens = (graph.unlocks.get(concept) ?? []).length
  return Math.min(1, (found?.weight ?? 0.5) * 0.6 + Math.min(0.4, opens * 0.1))
}

/** Where to go to learn a concept: the first lesson that teaches it. */
export function lessonFor(graph: Graph, concept: string): string | null {
  return graph.taughtBy.get(concept)?.[0] ?? null
}
