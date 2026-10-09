/**
 * Two guards that came out of the final audit, both for defects that pass every other check.
 *
 * ## A module the running application cannot reach
 *
 * A Pages module with a full test suite and no caller looks finished from every angle: it compiles, its tests pass,
 * and coverage counts it. Nothing in the running application can reach it. That is the exact shape of the
 * "unfinished subsystem silently accepted" failure, and it is invisible unless something goes looking.
 *
 * Counting importers is not enough, and the first version of this guard made that mistake. `compare.ts` had an
 * importer — `decision.ts` — and passed, while `decision.ts` itself had no caller, so both were unreachable and one
 * of them looked fine. Two unwired modules importing each other vouch for each other forever.
 *
 * So this walks the import graph instead: start from every file the application actually loads, follow imports into
 * `shared/pages`, and see what is never arrived at. A module is reachable only if there is a real path to it from
 * outside, which is the thing that matters.
 *
 * The list below is meant to shrink. Adding a name to it says the module is not wired yet, which is a different
 * claim from a module that is wired and idle.
 *
 * ## A frozen-write guard that never fires
 *
 * `assert.throws(() => { frozen.field = x })` is the usual way to assert immutability, and here it is wrong. There
 * is no `"type": "module"` in package.json, so these files transpile to CommonJS and run in sloppy mode, where
 * writing to a frozen property is silently dropped rather than throwing. Four such guards existed and all four were
 * failing; the assertion was testing the module format rather than the invariant. The replacement asserts
 * `Object.isFrozen` and that the value did not change, which holds either way.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, it } from 'node:test'

/**
 * Every file git knows about, tracked or not.
 *
 * `--others --exclude-standard` matters: a plain `ls-files` shows only tracked files, so a bridge written but not
 * yet committed is invisible and the guard reports the engine it wires as still unreachable. That happened while
 * this was being written, and it is the failure mode where a guard is most annoying -- it argues with work already
 * done.
 */
const gitFiles = (pattern: string): string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', pattern], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((one) => one !== '')

const PAGES_DIR = 'src/shared/pages/'

/** Every source file the application could load: the whole tree, tests excluded. */
const productionFiles = (): string[] =>
  [...new Set([...gitFiles('src/*.ts'), ...gitFiles('src/**/*.ts'), ...gitFiles('src/**/*.tsx')])].filter(
    (one) => !one.endsWith('.test.ts') && !one.endsWith('.test.tsx')
  )

/**
 * The Pages modules one file imports, by module name.
 *
 * `./name.ts` only counts when the file doing the importing is itself inside the Pages folder. It used to count
 * from anywhere, so any file in the tree with a sibling of the same name vouched for a Pages module it had never
 * heard of -- `src/main/notifications/index.ts` importing its own `./actions.ts` made `pages/actions.ts` look
 * reachable, and this guard exists precisely to catch modules nothing reaches.
 */
const pagesImportsOf = (body: string, insidePages: boolean): string[] => {
  const names = new Set<string>()
  for (const match of body.matchAll(/pages\/([a-zA-Z][a-zA-Z0-9]*)\.ts/g)) names.add(match[1])
  if (insidePages) {
    for (const match of body.matchAll(/\.\/([a-zA-Z][a-zA-Z0-9]*)\.ts/g)) names.add(match[1])
  }
  return [...names]
}

/**
 * Pages modules the application cannot reach yet, each with why.
 *
 * Every one is a finished, tested engine with no bridge exposing it to a Page — the same gap each domain engine had
 * before its bridge was written. They are listed rather than deleted because the work they represent is real and
 * the wiring is what is missing.
 */
const NOT_WIRED_YET: Readonly<Record<string, string>> = Object.freeze({
  actions: 'Actions on a running Page. Needs a channel that checks a request and hands it to the Page host.',
  generator: 'Deterministic dataset, schedule and identifier generation, checked against what was asked for.',
  projects: 'Project saves, checkpoints, undo history and autosave decisions.',
  // It looked reachable only because the scanner counted a sibling `./research.ts` from anywhere in the tree, and
  // Orbis has several. Nothing has ever reached this one.
  research: 'Sources, claims and evidence, each weighed rather than asserted. Needs a bridge operation.',
  resources: 'A job queue with capacity, sweeping and pressure reporting.',
  solution: 'Problem formalisation, method choice and answers verified rather than asserted.'
})

describe('every Pages module is reachable from the application, or says why not', () => {
  it('walks the import graph rather than trusting that something imports it', () => {
    const modules = gitFiles('src/shared/pages/*.ts')
      .filter((one) => !one.endsWith('.test.ts'))
      .map((one) => one.slice(PAGES_DIR.length, -3))
    assert.ok(modules.length > 20, `only found ${modules.length} Pages modules; the glob is probably wrong`)

    const files = productionFiles()
    const bodies = new Map(files.map((one) => [one, readFileSync(one, 'utf8')]))

    // Seeds: everything outside the Pages folder. Whatever those reach is reachable; the rest is not.
    const reached = new Set<string>()
    const queue: string[] = []
    for (const [path, body] of bodies) {
      if (path.startsWith(PAGES_DIR)) continue
      for (const name of pagesImportsOf(body, false)) {
        if (!modules.includes(name)) continue
        if (!reached.has(name)) {
          reached.add(name)
          queue.push(name)
        }
      }
    }
    // Then follow imports between Pages modules, but only outward from something already reached.
    while (queue.length > 0) {
      const name = queue.shift() as string
      const body = bodies.get(`${PAGES_DIR}${name}.ts`)
      if (body === undefined) continue
      for (const next of pagesImportsOf(body, true)) {
        if (!modules.includes(next) || reached.has(next)) continue
        reached.add(next)
        queue.push(next)
      }
    }

    assert.ok(reached.size > 10, `only ${reached.size} modules came out reachable; the walk is probably broken`)

    const unreachable = modules.filter((one) => !reached.has(one)).sort()
    const unexplained = unreachable.filter((one) => !Object.prototype.hasOwnProperty.call(NOT_WIRED_YET, one))
    assert.deepEqual(
      unexplained,
      [],
      `these Pages modules cannot be reached from anything the application loads, and are not on the not-wired-yet list:\n  ${unexplained.join('\n  ')}\nEither wire one up, or add it with the reason it is not wired.`
    )
  })

  it('has nothing on the list that is reachable now, so the list shrinks rather than rots', () => {
    const files = productionFiles()
    const bodies = new Map(files.map((one) => [one, readFileSync(one, 'utf8')]))
    const modules = gitFiles('src/shared/pages/*.ts')
      .filter((one) => !one.endsWith('.test.ts'))
      .map((one) => one.slice(PAGES_DIR.length, -3))

    const reached = new Set<string>()
    const queue: string[] = []
    for (const [path, body] of bodies) {
      if (path.startsWith(PAGES_DIR)) continue
      for (const name of pagesImportsOf(body, false)) {
        if (modules.includes(name) && !reached.has(name)) {
          reached.add(name)
          queue.push(name)
        }
      }
    }
    while (queue.length > 0) {
      const name = queue.shift() as string
      const body = bodies.get(`${PAGES_DIR}${name}.ts`)
      if (body === undefined) continue
      for (const next of pagesImportsOf(body, true)) {
        if (modules.includes(next) && !reached.has(next)) {
          reached.add(next)
          queue.push(next)
        }
      }
    }

    const nowWired = Object.keys(NOT_WIRED_YET).filter((one) => reached.has(one)).sort()
    assert.deepEqual(
      nowWired,
      [],
      `these are reachable now and should come off the not-wired-yet list: ${nowWired.join(', ')}`
    )
  })

  it('gives every unwired module a real reason rather than a word', () => {
    for (const [name, why] of Object.entries(NOT_WIRED_YET)) {
      assert.ok(why.length > 25, `${name} has no useful reason: "${why}"`)
    }
  })
})

describe('immutability guards actually fire', () => {
  it('finds no frozen-write guard written as a thrown error', () => {
    /*
     * Whether such a write throws depends on the module mode, not on the code under test.
     *
     * So a guard written as `assert.throws` passes vacuously in one mode and fails in the other while looking like a
     * real defect -- which is exactly what happened when these files stopped being CommonJS.
     */
    const tests = gitFiles('src/**/*.test.ts')
    const offenders: string[] = []
    for (const path of tests) {
      if (path === 'src/shared/pages/reach.test.ts') continue
      const body = readFileSync(path, 'utf8')
      for (const match of body.matchAll(/assert\.throws\(\(\)\s*=>\s*\{([^}]{0,200})\}/g)) {
        if (/\)\s*\.\w+\s*=/.test(match[1])) {
          offenders.push(path)
          break
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these tests assert immutability with a thrown error, which does not throw in this module mode:\n  ${offenders.join('\n  ')}\nAssert Object.isFrozen and that the value did not change instead.`
    )
  })

  it('holds whether or not a frozen write throws in this module mode', () => {
    /*
     * This used to assert that the write did *not* throw, and it was right at the time: the files ran as CommonJS in
     * sloppy mode. They now run as modules, so the same write throws -- and the guard failed, saying the module mode
     * had changed, while three real tests failed on objects that were correctly frozen.
     *
     * The invariant was never about throwing. It is that the value does not change, which is true in both modes. So
     * that is what is asserted, and the guard above stands either way: `assert.throws` around a frozen write is still
     * the wrong shape, because it passes or fails on the engine's mode rather than on the code under test.
     */
    const frozen = Object.freeze({ a: 1 })
    try {
      ;(frozen as { a: number }).a = 2
    } catch {
      // Strict mode refuses it outright. Sloppy mode drops it. Both leave the value alone, which is the point.
    }
    assert.equal(frozen.a, 1, 'a frozen value changed, which is what every isFrozen assertion here relies on')
  })
})
