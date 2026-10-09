/**
 * The problem library: the sixteen written ones, and whatever Orion has made since.
 *
 * NOT the user's file. Theirs has `problems.js` and nothing else, because its sixteen were the whole library —
 * run out of them and the studio is finished. This sits in front of it so the written ones stay exactly as they
 * are while generated ones join the same list, the same filters and the same pages.
 *
 * `problems.js` is untouched. Every screen that used to import it imports this instead, and the exports keep
 * their names and shapes, so nothing downstream changes.
 *
 * ## Generated problems live in this browser
 *
 * They are kept in local storage rather than sent anywhere, because they belong to whoever asked for them.
 * Storage can be denied outright, which is why every read is wrapped: the written sixteen must work even when
 * nothing can be saved, and they do.
 *
 * ## Written and generated never pretend to be each other
 *
 * A generated problem carries `generated: true` and `acceptance: null`. The list shows a mark, Progress counts
 * them apart, and `acceptance` is read as "not known" rather than printed as a number -- an invented percentage
 * being the easiest thing in the studio to fake.
 */
import { PROBLEMS as WRITTEN, DIFFICULTY_XP } from './problems.js'

export { DIFFICULTY_XP }
/** The sixteen somebody wrote, on their own, for anything that needs to tell them apart. */
export const WRITTEN_PROBLEMS = WRITTEN

const KEY = 'orbis:cs:generated-problems'

let made = readStored()
const listeners = new Set()

function readStored() {
  try {
    const held = localStorage.getItem(KEY)
    if (!held) return []
    const rows = JSON.parse(held)
    if (!Array.isArray(rows)) return []
    // Anything that is not a problem is dropped rather than rendered as one.
    return rows.filter((one) => one && typeof one === 'object' && typeof one.slug === 'string' && Array.isArray(one.tests))
  } catch {
    // Unreadable is not the same as missing -- but there is nothing to recover here, and an empty extra list
    // still leaves the written sixteen working.
    return []
  }
}

function writeStored(rows) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows))
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Every problem, written ones first and generated ones after, in number order. */
export function allProblems() {
  return [...WRITTEN, ...made]
}

/** Only the ones Orion made. */
export function generatedProblems() {
  return made
}

/**
 * Keeps a new one.
 *
 * Refuses a slug or title that is already taken, because two problems at one address means the second is
 * unreachable and the first looks wrong.
 */
export function keepProblem(problem) {
  const already = allProblems()
  if (already.some((one) => one.slug === problem.slug)) {
    return { ok: false, says: 'There is already a problem at that address.' }
  }
  if (already.some((one) => one.title.toLowerCase() === String(problem.title).toLowerCase())) {
    return { ok: false, says: `"${problem.title}" is already in the library.` }
  }
  const next = [...made, problem]
  const broke = writeStored(next)
  if (broke) return { ok: false, says: `It could not be saved: ${broke}` }
  made = next
  announce()
  return { ok: true, problem }
}

/** Removes one Orion made. The written sixteen cannot be removed. */
export function dropProblem(slug) {
  const next = made.filter((one) => one.slug !== slug)
  if (next.length === made.length) return { ok: false, says: 'That is not a generated problem.' }
  const broke = writeStored(next)
  if (broke) return { ok: false, says: `It could not be removed: ${broke}` }
  made = next
  announce()
  return { ok: true }
}

/** The number the next generated problem follows. */
export function highestNumber() {
  return allProblems().reduce((most, one) => Math.max(most, Number(one.number) || 0), 0)
}

/** Every title in the library, so Orion is not asked to write one of them again. */
export function everyTitle() {
  return allProblems().map((one) => one.title)
}

function announce() {
  for (const one of listeners) {
    try {
      one()
    } catch {
      // One listener throwing must not stop the others from hearing about it.
    }
  }
}

/** Hear about a problem being kept or removed. Returns the way to stop hearing. */
export function onLibraryChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------------------------------------------------------------- the shape their pages already read

export let ALL_TOPICS = Array.from(new Set(allProblems().flatMap((one) => one.topics))).sort()

export function getProblem(slug) {
  return allProblems().find((one) => one.slug === slug)
}

export function getProblemById(id) {
  return allProblems().find((one) => one.id === id)
}

export function filterProblems(opts) {
  const q = (opts.q || '').trim().toLowerCase()
  return allProblems().filter((one) => {
    if (q && !`${one.title} ${one.id} ${one.topics.join(' ')}`.toLowerCase().includes(q)) return false
    if (opts.difficulty && opts.difficulty !== 'All' && one.difficulty !== opts.difficulty) return false
    if (opts.topic && opts.topic !== 'All' && !one.topics.includes(opts.topic)) return false
    if (opts.origin === 'Written' && one.generated) return false
    if (opts.origin === 'Generated' && !one.generated) return false
    return true
  })
}

/**
 * `PROBLEMS`, for the pages that only want a list.
 *
 * Rebound whenever the library changes rather than fixed when this module loaded, so a page that reads
 * `PROBLEMS.length` after a problem is generated sees the new number. A module export of a `let` is a live
 * binding, which is what makes that work without every page subscribing.
 */
export let PROBLEMS = allProblems()

onLibraryChange(() => {
  PROBLEMS = allProblems()
  ALL_TOPICS = Array.from(new Set(PROBLEMS.flatMap((one) => one.topics))).sort()
})
