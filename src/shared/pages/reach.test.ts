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

/** The Pages modules one file imports, by module name. */
const pagesImportsOf = (body: string): string[] => {
  const names = new Set<string>()
  // Both spellings a real import uses: a sibling inside the folder, and the full path from anywhere else.
  for (const match of body.matchAll(/(?:\.\/|pages\/)([a-zA-Z][a-zA-Z0-9]*)\.ts/g)) names.add(match[1])
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
  analyzer: 'Analysis over a supplied dataset, with freshness and cache keys. Needs a bridge operation.',
  generator: 'Deterministic dataset, schedule and identifier generation, checked against what was asked for.',
  projects: 'Project saves, checkpoints, undo history and autosave decisions.',
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
      for (const name of pagesImportsOf(body)) {
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
      for (const next of pagesImportsOf(body)) {
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
      for (const name of pagesImportsOf(body)) {
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
      for (const next of pagesImportsOf(body)) {
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
    // Such a write is dropped rather than thrown here, so the guard either passes vacuously or -- as happened --
    // fails while looking like a real defect in the code under test.
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

  it('confirms the sloppy-mode behaviour this guard exists for', () => {
    // If this starts throwing, the package gained "type": "module" and the reasoning above needs revisiting.
    const frozen = Object.freeze({ a: 1 })
    let threw = false
    try {
      ;(frozen as { a: number }).a = 2
    } catch {
      threw = true
    }
    assert.equal(
      threw,
      false,
      'writes to frozen objects now throw here, so the module mode changed and this guard should be relaxed'
    )
    assert.equal(frozen.a, 1, 'the write was dropped, which is what makes the isFrozen assertion the right one')
  })
})
