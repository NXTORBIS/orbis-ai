import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  CATALOGUED_OPERATIONS,
  catalogueForPrompt,
  CHOICE_OPTIONS,
  checkArguments,
  GENERATION_CATALOGUE,
  signatureOf,
  SPEC_SIGNATURES,
  type ArgumentKind
} from './generationCatalogue.ts'
import { KNOWN_OPERATIONS } from './service.ts'

/**
 * The catalogue, re-derived from the bridges that dispatch the operations.
 *
 * This is the whole point of the file. A catalogue written by hand drifts: somebody renames an argument in an engine,
 * the bridge follows, and every generated Page that used it starts being refused on the first keystroke -- with no
 * test failing anywhere, because the Page still compiles. So the catalogue is checked against the source it claims to
 * describe, by the same rules that produced it.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const BRIDGES = ['engines', 'mathEngines', 'studyEngines', 'reasoningEngines', 'scienceEngines', 'physicsEngines', 'emEngines', 'engineeringEngines', 'earthEngines', 'humanitiesEngines', 'studioEngines', 'modernPhysicsEngines', 'chemistryEngines', 'biologyEngines', 'planningEngines', 'knowledgeEngines']

/** Families that are Orbis's own plumbing rather than calculations somebody would want a Page for. */
const NOT_FOR_PAGES = new Set(['document', 'interchange', 'builder', 'data', 'learning', 'project', 'scenario', 'study', 'workspace'])

const KIND: Readonly<Record<string, ArgumentKind>> = {
  number: 'number',
  integer: 'number',
  optionalNumber: 'number?',
  text: 'text',
  optionalText: 'text?',
  choice: 'choice',
  numbers: 'numbers',
  strings: 'strings',
  list: 'list',
  rows: 'list',
  table: 'list',
  boolean: 'boolean?',
  flag: 'boolean',
  bigint: 'whole',
  value: 'value',
  object: 'value'
}

const READS = /read\.(has|text|number|optionalNumber|numbers|strings|list|boolean|flag|choice|integer|bigint|optionalText|value|object|table|rows)\(\s*'([A-Za-z0-9_]+)'/g
const CHOICES = /read\.choice\(\s*'([A-Za-z0-9_]+)'\s*,\s*\[([^\]]*)\]/g
/** A helper handed the whole reader, or the whole input, reads arguments this cannot see. */
const HIDES = /\b[A-Za-z_][A-Za-z0-9_]*\(\s*(?:read|input)\s*[,)]/
const CASE = /^\s*case '([a-z]+\.[a-z-]+)':/

interface Derived {
  args: [string, string][]
  hidden: boolean
  /** The closed set each choice argument accepts, as the bridge writes it. */
  choices: Record<string, string[]>
}

function derive(): Map<string, Derived> {
  const out = new Map<string, Derived>()
  for (const bridge of BRIDGES) {
    const source = readFileSync(join(HERE, `${bridge}.ts`), 'utf8').split('\n')
    let current: string[] = []
    let body: string[] = []
    const flush = (): void => {
      if (current.length === 0) return
      const text = body.join('\n')
      const args: [string, string][] = []
      for (const match of text.matchAll(READS)) {
        if (!args.some(([name]) => name === match[2])) args.push([match[2], match[1]])
      }
      const hidden = HIDES.test(text)
      const choices: Record<string, string[]> = {}
      for (const match of text.matchAll(CHOICES)) {
        const options = match[2]
          .split(',')
          .map((one) => one.trim().replace(/^['"]|['"]$/g, ''))
          .filter((one) => one.length > 0)
        if (options.length > 0) choices[match[1]] = options
      }
      for (const operation of current) out.set(operation, { args, hidden, choices })
    }
    for (const line of source) {
      const match = CASE.exec(line)
      if (match !== null) {
        if (body.length > 0) {
          flush()
          current = []
          body = []
        }
        current.push(match[1])
        continue
      }
      if (current.length > 0) body.push(line)
    }
    flush()
  }
  return out
}

/** The catalogue the rules say should exist, from the source as it is now. */
function expected(): Map<string, Record<string, ArgumentKind>> {
  const out = new Map<string, Record<string, ArgumentKind>>()
  for (const [operation, found] of derive()) {
    if (NOT_FOR_PAGES.has(operation.slice(0, operation.indexOf('.')))) continue
    if (found.hidden) continue
    const args = found.args.filter(([, kind]) => kind !== 'has')
    if (args.length === 0) continue
    if (args.some(([, kind]) => !Object.prototype.hasOwnProperty.call(KIND, kind))) continue
    out.set(operation, Object.fromEntries(args.map(([name, kind]) => [name, KIND[kind]])))
  }
  return out
}

describe('the catalogue matches the bridges it describes', () => {
  it('lists exactly the operations whose arguments can be read from their own case', () => {
    const should = expected()
    assert.deepEqual(CATALOGUED_OPERATIONS, [...should.keys()].sort())
  })

  it('gives each one exactly the arguments its bridge reads, with the same kinds', () => {
    const should = expected()
    for (const [operation, signature] of should) {
      assert.deepEqual(GENERATION_CATALOGUE[operation], signature, operation)
    }
  })

  it('derived something at all, so a broken extractor cannot pass by finding nothing', () => {
    // Without this, a regex that stopped matching would make `expected()` empty and the first test would pass by
    // agreeing that the catalogue should be empty too.
    assert.ok(derive().size > 200, `only found ${derive().size} operations in the bridges`)
    assert.ok(CATALOGUED_OPERATIONS.length > 50)
  })

  it('only catalogues operations the service will actually dispatch', () => {
    const known = new Set(KNOWN_OPERATIONS)
    for (const operation of CATALOGUED_OPERATIONS) {
      assert.ok(known.has(operation), `${operation} is catalogued and the service does not know it`)
    }
  })

  it('catalogues a small enough part of what exists that the exclusion is doing something', () => {
    // If this ever reached everything, the rule that keeps guessed argument names out would have stopped working.
    assert.ok(CATALOGUED_OPERATIONS.length < KNOWN_OPERATIONS.length, 'the catalogue is the whole engine set')
  })
})

describe('checkArguments', () => {
  it('accepts a step that gives exactly what an operation needs', () => {
    assert.deepEqual(checkArguments('motion.projectile', ['speed', 'angle']), [])
    assert.deepEqual(checkArguments('motion.projectile', ['speed', 'angle', 'gravity', 'height']), [])
  })

  it('names a required argument that was left out', () => {
    const problems = checkArguments('motion.projectile', ['speed'])
    assert.equal(problems.length, 1)
    assert.equal(problems[0].argument, 'angle')
    assert.equal(problems[0].trouble, 'missing')
  })

  it('names an argument the operation does not take, and says what it does take', () => {
    const problems = checkArguments('motion.projectile', ['speed', 'angle', 'velocity'])
    assert.equal(problems.length, 1)
    assert.equal(problems[0].trouble, 'unknown')
    assert.ok(problems[0].message.includes('It takes speed, angle'))
  })

  it('refuses an operation that is not catalogued rather than letting anything through', () => {
    const problems = checkArguments('markets.quote', ['symbol'])
    assert.equal(problems.length, 1)
    assert.ok(problems[0].message.includes('may not use'))
  })

  it('does not find an operation on Object.prototype', () => {
    for (const sneaky of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      assert.equal(signatureOf(sneaky), undefined, sneaky)
      assert.equal(checkArguments(sneaky, []).length, 1, sneaky)
    }
  })
})

describe('the choices a catalogued operation accepts', () => {
  it('lists exactly what each bridge accepts', () => {
    const derived = derive()
    for (const operation of CATALOGUED_OPERATIONS) {
      const should = derived.get(operation)?.choices ?? {}
      const has = Object.prototype.hasOwnProperty.call(CHOICE_OPTIONS, operation) ? CHOICE_OPTIONS[operation] : {}
      assert.deepEqual(
        Object.fromEntries(Object.entries(has).map(([k, v]) => [k, [...v]])),
        Object.keys(should).length === 0 ? {} : should,
        operation
      )
    }
  })

  it('knows what combinatorics.count actually does', () => {
    // The concrete case this exists for: without the options, a model asked for the number of five-card hands
    // decided no operation could do it, while `what: 'combinations'` was in the bridge the whole time.
    assert.ok(CHOICE_OPTIONS['combinatorics.count'].what.includes('combinations'))
  })

  it('puts them in front of the model rather than leaving it to guess', () => {
    assert.ok(catalogueForPrompt().includes('what: factorial|combinations|permutations'))
  })

  it('found choices at all, so a broken extractor cannot pass by finding none', () => {
    assert.ok(Object.keys(CHOICE_OPTIONS).length > 10, `only ${Object.keys(CHOICE_OPTIONS).length}`)
  })
})

describe('SPEC_SIGNATURES', () => {
  it('accepts every argument and requires none, on purpose', () => {
    // Requiredness is a thing this file cannot honestly know: one operation reads different arguments for different
    // modes, and the bridge reads all of them somewhere in its case. The check that matters is the other direction.
    for (const [operation, signature] of Object.entries(SPEC_SIGNATURES)) {
      assert.deepEqual(Object.keys(signature), Object.keys(GENERATION_CATALOGUE[operation]), operation)
      for (const [argument, about] of Object.entries(signature)) {
        assert.equal(about.optional, true, `${operation}.${argument}`)
      }
    }
  })

  it('lets a mode-dependent operation through with only the arguments its mode uses', () => {
    // `combinatorics.count` reads n and r for a combination and parts and total for a partition. Requiring all four
    // refused every correct specification for it, which is what this test is here to stop coming back.
    const signature = SPEC_SIGNATURES['combinatorics.count']
    assert.ok(signature !== undefined)
    assert.ok(Object.keys(signature).length >= 4)
    assert.ok(Object.values(signature).every((one) => one.optional))
  })
})

describe('catalogueForPrompt', () => {
  it('writes every operation once, grouped by family', () => {
    const text = catalogueForPrompt()
    for (const operation of CATALOGUED_OPERATIONS) {
      assert.equal(text.split(`  ${operation}(`).length, 2, operation)
    }
  })

  it('marks which arguments may be left out', () => {
    const text = catalogueForPrompt()
    assert.ok(text.includes('motion.projectile(speed: number, angle: number, height?: number, gravity?: number)'))
  })

  it('stays small enough to put in front of a model', () => {
    // Not a style rule. A catalogue long enough to crowd out the request is one the model answers less well.
    assert.ok(catalogueForPrompt().length < 20_000, `${catalogueForPrompt().length} characters`)
  })
})
