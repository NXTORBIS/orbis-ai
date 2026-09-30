/**
 * Two guards that came out of the final audit, both for defects that pass every other check.
 *
 * ## A module nothing imports
 *
 * A Pages module with a full test suite and no production importer looks finished from every angle: it compiles, its
 * tests pass, and the coverage number counts it. Nothing in the running application can reach it. That is the exact
 * shape of the "unfinished subsystem silently accepted" failure, and it is invisible unless something counts
 * importers — so this does, and every module that genuinely has no caller yet has to be listed below with a reason.
 *
 * The list is meant to shrink. Adding a name to it is a statement that the module is not wired yet, which is a
 * different thing from a module that is wired and idle.
 *
 * ## A frozen-write guard that never fires
 *
 * `assert.throws(() => { frozen.field = x })` is the usual way to assert immutability, and in this repository it is
 * wrong. There is no `"type": "module"` in package.json, so these files transpile to CommonJS and run in sloppy
 * mode, where writing to a frozen property is silently dropped rather than throwing. Four such guards existed and
 * all four were failing; the assertion was testing the module format rather than the invariant. The replacement
 * asserts `Object.isFrozen` and that the value did not change, which holds either way.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, it } from 'node:test'

const gitFiles = (pattern: string): string[] =>
  execFileSync('git', ['ls-files', pattern], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((one) => one !== '')

/**
 * Modules under `src/shared/pages` that no production code imports yet, each with why.
 *
 * Every one of these is a finished, tested engine with no bridge exposing it to a Page — the same gap each domain
 * engine had before its bridge was written. They are listed rather than deleted because the work they represent is
 * real and the wiring is the part that is missing.
 */
const NOT_WIRED_YET: Readonly<Record<string, string>> = Object.freeze({
  actions: 'Actions on a running Page. Needs a channel that resolves a request and hands it to the Page host.',
  analyzer: 'Analysis over a supplied dataset. Needs a bridge operation.',
  changes: 'Structured edits to a Page spec. Needs a channel for natural-language Page editing.',
  concepts: 'Concept and prerequisite graphs. Needs a bridge operation.',
  decision: 'Weighted decisions and sensitivity. Reached only by compare.test.ts.',
  experiments: 'Experiment definitions, sweeps and snapshots. Needs a bridge operation.',
  generator: 'Deterministic dataset and content generation, checked against what was asked for.',
  lab: 'Parameters, runs and comparisons for an experiment surface.',
  planner: 'Task graphs, critical path and derived schedules.',
  projects: 'Project structure, milestones and health computed from real state.',
  resources: 'Resource budgets and what happens when one is exceeded.',
  solution: 'Worked solutions with the steps stated.'
})

describe('every Pages module is reachable, or says why not', () => {
  it('has no unreachable module that is not on the list', () => {
    const modules = gitFiles('src/shared/pages/*.ts').filter((one) => !one.endsWith('.test.ts'))
    assert.ok(modules.length > 20, `only found ${modules.length} modules; the glob is probably wrong`)

    // Everything that could import one of them: the whole tree except the Pages tests themselves.
    const sources = [...gitFiles('src/*.ts'), ...gitFiles('src/**/*.ts')]
      .filter((one) => one.endsWith('.ts') && !one.endsWith('.test.ts'))
    const text = new Map(sources.map((one) => [one, readFileSync(one, 'utf8')]))

    const unreachable: string[] = []
    for (const path of modules) {
      const name = path.slice(path.lastIndexOf('/') + 1, -3)
      let importers = 0
      for (const [where, body] of text) {
        if (where === path) continue
        // Both spellings a real import uses: a sibling, and the full path from elsewhere.
        if (body.includes(`./${name}.ts`) || body.includes(`pages/${name}.ts`)) importers += 1
      }
      if (importers === 0) unreachable.push(name)
    }

    const unexplained = unreachable.filter((one) => !Object.prototype.hasOwnProperty.call(NOT_WIRED_YET, one))
    assert.deepEqual(
      unexplained,
      [],
      `these Pages modules have no production importer and are not on the not-wired-yet list:\n  ${unexplained.join('\n  ')}\nEither wire one up, or add it with the reason it is not wired.`
    )
  })

  it('has nothing on the list that is now wired, so the list shrinks rather than rots', () => {
    const sources = [...gitFiles('src/*.ts'), ...gitFiles('src/**/*.ts')].filter(
      (one) => one.endsWith('.ts') && !one.endsWith('.test.ts') && !one.startsWith('src/shared/pages/')
    )
    const text = sources.map((one) => readFileSync(one, 'utf8'))
    const nowWired = Object.keys(NOT_WIRED_YET).filter((name) =>
      text.some((body) => body.includes(`pages/${name}.ts`))
    )
    assert.deepEqual(
      nowWired,
      [],
      `these are wired now and should come off the not-wired-yet list: ${nowWired.join(', ')}`
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
    // These files run as CommonJS in sloppy mode, so such a write is dropped rather than throwing and the guard
    // passes vacuously -- or, as happened here, fails while looking like a real defect in the code under test.
    const tests = gitFiles('src/**/*.test.ts')
    const offenders: string[] = []
    for (const path of tests) {
      if (path === 'src/shared/pages/reach.test.ts') continue
      const body = readFileSync(path, 'utf8')
      // `assert.throws(() => {` followed within a few lines by an assignment to a cast expression.
      for (const match of body.matchAll(/assert\.throws\(\(\)\s*=>\s*\{([^}]{0,200})\}/g)) {
        if (/\)\s*\.\w+\s*=|\}\s*\)\s*\.\w+\s*=/.test(match[1]) || /as\s*\{[^}]*\}\s*\)\s*\.\w+\s*=/.test(match[1])) {
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
    // If this ever starts throwing, the package gained "type": "module" and the guard above can be relaxed.
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
      'writes to frozen objects now throw here, so the module mode changed and the reasoning above needs revisiting'
    )
    assert.equal(frozen.a, 1, 'the write was dropped, which is what makes the isFrozen assertion the right one')
  })
})
