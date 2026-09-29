/**
 * The engines a Page is built by, what each one needs, and what each one produces.
 *
 * Generation used to be a fixed sequence written into one function: resolve, ask, compile, validate, run. That works
 * until the pipeline has to differ per Page -- a stopwatch needs nothing a chemistry simulator needs -- and until
 * something has to say *which* stage was responsible when a Page comes out wrong. A sequence cannot answer either
 * question, because a sequence has no parts.
 *
 * So the stages are declared rather than written down in order, and the order is *derived* from what each one reads
 * and writes.
 *
 * ## The contract is the input and output schema, and it is checked
 *
 * Every engine declares `reads` and `writes` as fields of the build that flows between them. That is the whole
 * contract, and it makes two things possible that a call sequence cannot:
 *
 * - **A selected pipeline can be proved runnable before it runs.** `planRun` refuses a set of engines where something
 *   reads a field nothing earlier produces. A mis-wired pipeline becomes a refusal with the field named, rather than
 *   an `undefined` three stages later wearing the wrong engine's name.
 * - **A defect can be attributed.** When validation says the layout is wrong, the engine that wrote `layout` is the
 *   one to repair it. `healing.ts` uses exactly this.
 *
 * ## Why engines are selected rather than all run
 *
 * Most Pages need a handful. Running a domain engine for a stopwatch costs time and can only make the result worse,
 * because a stage that has nothing to do either does nothing -- in which case it was latency -- or finds something to
 * do, which is a Page doing what nobody asked for. `selectEngines` picks from what the request actually needs.
 *
 * ## What this file deliberately is not
 *
 * It is not an execution engine. Nothing here calls anything: it decides *what* should run, in what order, and what
 * each one is allowed to touch. The running is done in the main process, where the models and the real engines are,
 * and it is done against this plan. Keeping the deciding pure is what lets all of it be tested without a model, a
 * network, or a window.
 */

/** A field of the build. The unit of the contract between engines. */
export type BuildField =
  /** What was asked for, in the person's words. Always present; nothing writes it. */
  | 'request'
  /** What the request turns out to be for. */
  | 'intent'
  /** What already exists that might answer it. */
  | 'discovery'
  /** The structured description of the Page to build. */
  | 'plan'
  /** The implementation-independent representation: inputs, steps, outputs. */
  | 'ir'
  /** Which components show which parts of it. */
  | 'components'
  /** Where they sit, at each width. */
  | 'layout'
  /** What the Page holds and how long it holds it. */
  | 'data'
  /** What happens when somebody does something. */
  | 'interaction'
  /** What the Page is allowed to do. */
  | 'permissions'
  /** What it is checked for being usable by everybody. */
  | 'accessibility'
  /** What it costs to run. */
  | 'performance'
  /** The compiled Page: a document and a manifest. */
  | 'page'
  /** What happened when it was really run. */
  | 'evidence'
  /** Whether it is fit to offer. */
  | 'verdict'

export type EngineId =
  | 'intent'
  | 'discovery'
  | 'planner'
  | 'ir'
  | 'component'
  | 'layout'
  | 'data'
  | 'interaction'
  | 'domain'
  | 'computation'
  | 'visualisation'
  | 'security'
  | 'accessibility'
  | 'performance'
  | 'compiler'
  | 'runtime'
  | 'visual'
  | 'validation'

/**
 * How much a Page needs, which decides which engines run.
 *
 * Read from the request and the plan rather than asked of anybody. A Page that shows a chart needs the visualisation
 * engine whether or not the request said the word "chart".
 */
export interface Needs {
  /** It computes something with a deterministic engine. Almost always true; a Page that does not is not a Page. */
  computes: boolean
  /** It belongs to a subject with its own rules -- physics, chemistry, finance. */
  domain: string | null
  /** It draws something. */
  visualises: boolean
  /** It keeps what somebody typed. */
  persists: boolean
  /** It has more than a handful of things on screen, so where they sit stops being obvious. */
  substantial: boolean
  /** It was built from a template, so most of the shape is already decided. */
  fromTemplate: boolean
}

export const SIMPLE: Needs = Object.freeze({
  computes: true,
  domain: null,
  visualises: false,
  persists: false,
  substantial: false,
  fromTemplate: false
})

export interface EngineContract {
  id: EngineId
  /**
   * The engine's own version.
   *
   * Recorded on a Page when it is built, so a Page can say which version of which stage produced it. That is what
   * makes a regression traceable: a Page that was fine and is now wrong was built by a different layout engine, and
   * the version says which.
   */
  version: number
  /** One sentence, for a screen that shows what is happening. */
  does: string
  /** Fields it needs. Every one must be written by something earlier, or be an initial field. */
  reads: readonly BuildField[]
  /** Fields it produces. Two engines may not write the same field. */
  writes: readonly BuildField[]
  /**
   * Whether it runs for every Page.
   *
   * The ones that do are the ones whose absence is a Page that cannot exist: nothing can be built without knowing
   * what was asked for, and nothing may be offered without being checked.
   */
  always: boolean
  /** When it is not always, what makes it necessary. */
  needed?(needs: Needs): boolean
  /**
   * How long it may take, in milliseconds.
   *
   * A budget rather than a timeout: exceeding it is reported and the run continues, because stopping a Page halfway
   * through to save a second produces nothing. The budgets exist so a slow stage can be found.
   */
  budgetMs: number
  /**
   * Whether the answer may be reused for an identical request.
   *
   * False for anything that reads the world -- what Pages exist changes between one request and the next, so a cached
   * discovery would offer a Page that has since been deleted.
   */
  cacheable: boolean
}

/**
 * Every engine.
 *
 * The order in this object is documentation only; the order things run in is computed from `reads` and `writes`. If
 * the two ever disagree it is this list that is wrong, and the test says so.
 */
export const ENGINES: Readonly<Record<EngineId, EngineContract>> = Object.freeze({
  intent: {
    id: 'intent',
    version: 1,
    does: 'Works out what the request is actually for.',
    reads: ['request'],
    writes: ['intent'],
    always: true,
    budgetMs: 50,
    cacheable: true
  },
  discovery: {
    id: 'discovery',
    version: 1,
    does: 'Looks for a Page that already does this.',
    reads: ['request', 'intent'],
    writes: ['discovery'],
    always: true,
    budgetMs: 200,
    // What exists changes between one request and the next. A cached answer would offer a deleted Page.
    cacheable: false
  },
  planner: {
    id: 'planner',
    version: 1,
    does: 'Describes the Page that should be built.',
    reads: ['request', 'intent', 'discovery'],
    writes: ['plan'],
    always: true,
    budgetMs: 60_000,
    cacheable: false
  },
  ir: {
    id: 'ir',
    version: 1,
    does: 'Turns the plan into inputs, steps and outputs that can be checked.',
    reads: ['plan'],
    writes: ['ir'],
    always: true,
    budgetMs: 100,
    cacheable: true
  },
  component: {
    id: 'component',
    version: 1,
    does: 'Chooses which Orbis component shows each part.',
    reads: ['ir'],
    writes: ['components'],
    always: true,
    budgetMs: 50,
    cacheable: true
  },
  layout: {
    id: 'layout',
    version: 1,
    does: 'Decides where everything sits, at every width.',
    reads: ['ir', 'components'],
    writes: ['layout'],
    always: true,
    budgetMs: 100,
    cacheable: true
  },
  data: {
    id: 'data',
    version: 1,
    does: 'Decides what the Page holds and how long it holds it.',
    reads: ['ir'],
    writes: ['data'],
    always: false,
    needed: (needs) => needs.persists,
    budgetMs: 50,
    cacheable: true
  },
  interaction: {
    id: 'interaction',
    version: 1,
    does: 'Works out what happens when somebody does something.',
    reads: ['ir', 'components'],
    writes: ['interaction'],
    always: true,
    budgetMs: 50,
    cacheable: true
  },
  domain: {
    id: 'domain',
    version: 1,
    does: 'Applies the rules of the subject the Page belongs to.',
    reads: ['ir', 'intent'],
    writes: [],
    always: false,
    needed: (needs) => needs.domain !== null,
    budgetMs: 200,
    cacheable: true
  },
  computation: {
    id: 'computation',
    version: 1,
    does: 'Binds each step to a real Orbis calculation.',
    reads: ['ir'],
    writes: [],
    always: false,
    needed: (needs) => needs.computes,
    budgetMs: 100,
    cacheable: true
  },
  visualisation: {
    id: 'visualisation',
    version: 1,
    does: 'Decides how anything drawn is drawn.',
    reads: ['ir', 'components'],
    writes: [],
    always: false,
    needed: (needs) => needs.visualises,
    budgetMs: 100,
    cacheable: true
  },
  security: {
    id: 'security',
    version: 1,
    does: 'Works out what the Page is allowed to do, from what it does.',
    reads: ['ir'],
    writes: ['permissions'],
    always: true,
    budgetMs: 50,
    cacheable: true
  },
  accessibility: {
    id: 'accessibility',
    version: 1,
    does: 'Checks it can be used by everybody.',
    reads: ['ir', 'components', 'layout'],
    writes: ['accessibility'],
    always: true,
    budgetMs: 100,
    cacheable: true
  },
  performance: {
    id: 'performance',
    version: 1,
    does: 'Works out what it costs to run.',
    reads: ['ir', 'interaction'],
    writes: ['performance'],
    always: true,
    budgetMs: 50,
    cacheable: true
  },
  compiler: {
    id: 'compiler',
    version: 1,
    does: 'Builds the Page the runtime will run.',
    reads: ['ir', 'components', 'layout', 'permissions'],
    writes: ['page'],
    always: true,
    budgetMs: 200,
    cacheable: true
  },
  runtime: {
    id: 'runtime',
    version: 1,
    does: 'Runs it for real and records what came back.',
    reads: ['page'],
    writes: ['evidence'],
    always: true,
    budgetMs: 10_000,
    cacheable: false
  },
  visual: {
    id: 'visual',
    version: 1,
    does: 'Looks at what it renders as, and finds what is clipped, overlapping or unreadable.',
    reads: ['page', 'layout', 'components'],
    writes: [],
    always: false,
    needed: (needs) => needs.substantial,
    budgetMs: 2000,
    cacheable: false
  },
  validation: {
    id: 'validation',
    version: 1,
    does: 'Decides whether it is fit to offer.',
    reads: ['page', 'evidence', 'permissions', 'accessibility', 'performance'],
    writes: ['verdict'],
    always: true,
    budgetMs: 200,
    cacheable: false
  }
})

/** Fields nothing writes, because they are what a run starts with. */
export const INITIAL_FIELDS: readonly BuildField[] = Object.freeze(['request'])

export const ALL_ENGINES: readonly EngineId[] = Object.freeze(Object.keys(ENGINES) as EngineId[])

/**
 * Which engines a Page needs.
 *
 * Always the ones without which a Page cannot exist, plus the ones its own requirements call for. Nothing is added
 * because it might help: a stage with nothing to do is either latency or a Page doing something nobody asked for.
 */
export function selectEngines(needs: Needs): EngineId[] {
  return ALL_ENGINES.filter((id) => {
    const engine = ENGINES[id]
    if (engine.always) return true
    return engine.needed?.(needs) === true
  })
}

export interface RunPlan {
  /**
   * The engines to run, in groups.
   *
   * Everything in one group may run at once: nothing in it reads anything another in it writes. The groups run one
   * after another. That is where the parallelism is, and it falls out of the contract rather than being decided.
   */
  stages: readonly (readonly EngineId[])[]
  /** The longest any run of this pipeline should take, from the budgets, taking each group's slowest. */
  budgetMs: number
  /** Every engine in the plan with its version, to record on the Page. */
  versions: Readonly<Record<string, number>>
}

export interface PlanProblem {
  error: 'unknown-engine' | 'missing-input' | 'written-twice' | 'circular'
  message: string
  /** What is wrong, named, so the message is not the only way to act on it. */
  at: string
}

/**
 * A set of engines put in an order that works, or a reason there is not one.
 *
 * This is the check that makes the contract worth declaring. Every `reads` has to be satisfied by something earlier,
 * and a field two engines both write has no defined value -- both are refused here rather than becoming an
 * `undefined` several stages downstream, wearing the name of whichever engine happened to touch it last.
 */
export function planRun(
  selected: readonly EngineId[],
  /**
   * The contracts to plan against.
   *
   * A parameter so the guards below can be tested. `ENGINES` satisfies all of them -- there are tests that say so --
   * which would leave the refusals here as code no test could ever reach, and a refusal nothing can reach is one
   * nobody knows still works.
   */
  registry: Readonly<Record<string, EngineContract>> = ENGINES
): RunPlan | PlanProblem {
  const chosen: EngineContract[] = []
  for (const id of selected) {
    if (!Object.prototype.hasOwnProperty.call(registry, id)) {
      return { error: 'unknown-engine', at: id, message: `There is no engine called "${id}".` }
    }
    chosen.push(registry[id])
  }

  const writer = new Map<BuildField, EngineId>()
  for (const engine of chosen) {
    for (const field of engine.writes) {
      const already = writer.get(field)
      if (already !== undefined) {
        return {
          error: 'written-twice',
          at: field,
          message: `"${field}" is written by both ${already} and ${engine.id}, so nothing can say what it holds.`
        }
      }
      writer.set(field, engine.id)
    }
  }

  const have = new Set<BuildField>(INITIAL_FIELDS)
  const left = new Map(chosen.map((one) => [one.id, one]))
  const stages: EngineId[][] = []
  let budgetMs = 0

  while (left.size > 0) {
    // Everything whose inputs are all present. They do not depend on each other, so they may run at once.
    const ready = [...left.values()].filter((engine) => engine.reads.every((field) => have.has(field)))
    if (ready.length === 0) {
      const stuck = [...left.values()][0]
      const missing = stuck.reads.filter((field) => !have.has(field))
      const nobodyWrites = missing.filter((field) => !writer.has(field))
      if (nobodyWrites.length > 0) {
        return {
          error: 'missing-input',
          at: nobodyWrites[0],
          message: `${stuck.id} needs "${nobodyWrites[0]}" and nothing in this pipeline produces it.`
        }
      }
      return {
        error: 'circular',
        at: stuck.id,
        message: `${stuck.id} and ${writer.get(missing[0]) ?? 'something'} each wait for the other, so neither can start.`
      }
    }
    stages.push(ready.map((one) => one.id))
    // A group takes as long as its slowest member, because they run together.
    budgetMs += Math.max(...ready.map((one) => one.budgetMs))
    for (const engine of ready) {
      left.delete(engine.id)
      for (const field of engine.writes) have.add(field)
    }
  }

  return {
    stages: Object.freeze(stages.map((one) => Object.freeze(one))),
    budgetMs,
    versions: Object.freeze(Object.fromEntries(chosen.map((one) => [one.id, one.version])))
  }
}

export const isPlanProblem = (value: RunPlan | PlanProblem): value is PlanProblem => 'error' in value

/**
 * Which engine is answerable for a field.
 *
 * The attribution `healing.ts` needs: a defect in the layout is the layout engine's to repair, and knowing that is
 * the difference between fixing what is wrong and asking for the whole Page again.
 */
export function engineFor(field: BuildField): EngineId | null {
  for (const id of ALL_ENGINES) {
    if (ENGINES[id].writes.includes(field)) return id
  }
  return null
}

/**
 * How much of the pipeline a request needs, read from the request and what it turns out to want.
 *
 * `fromTemplate` shortens it: a template has already decided the shape, so the stages that decide shape have less to
 * do -- but they still run, because a configured template is still a Page that has to be checked.
 */
export function needsFor(parts: {
  operations: readonly string[]
  outputs: readonly { display: string }[]
  inputs: readonly unknown[]
  allowStorage: boolean
  fromTemplate?: boolean
}): Needs {
  const families = new Set(parts.operations.map((one) => one.slice(0, one.indexOf('.'))))
  const SUBJECTS: Readonly<Record<string, string>> = {
    motion: 'physics',
    mechanics: 'physics',
    oscillator: 'physics',
    collision: 'physics',
    gravity: 'physics',
    rotation: 'physics',
    wave: 'physics',
    signal: 'science',
    precision: 'science',
    constants: 'science',
    frames: 'science',
    statistics: 'statistics',
    matrix: 'mathematics',
    algebra: 'mathematics',
    calculus: 'mathematics',
    geometry: 'mathematics',
    combinatorics: 'mathematics',
    number: 'mathematics'
  }
  let domain: string | null = null
  for (const family of families) {
    const subject = Object.prototype.hasOwnProperty.call(SUBJECTS, family) ? SUBJECTS[family] : null
    // Two subjects is no subject: a Page spanning them has no single set of rules to apply.
    if (subject === null) continue
    if (domain !== null && domain !== subject) {
      domain = null
      break
    }
    domain = subject
  }
  return {
    computes: parts.operations.length > 0,
    domain,
    visualises: parts.outputs.some((one) => one.display === 'plot' || one.display === 'table'),
    persists: parts.allowStorage,
    substantial: parts.inputs.length + parts.outputs.length > 6,
    fromTemplate: parts.fromTemplate === true
  }
}

export const PIPELINE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'The order engines run in is computed from what each reads and writes, never written down. A list that disagrees with the contracts is the list that is wrong.',
  'A pipeline is proved runnable before it runs. An engine reading something nothing produces is a refusal naming the field, not an undefined three stages later.',
  'Two engines may not write the same field, because then nothing can say what it holds.',
  'Engines are selected, not all run. A stage with nothing to do is either latency or a Page doing something nobody asked for.',
  'Everything in one group may run at once, and that falls out of the contract rather than being decided by anybody.',
  'A budget is not a timeout. Exceeding it is reported and the run continues, because stopping a Page halfway through to save a second produces nothing.',
  'Nothing here runs anything. It decides what should run and in what order, which is what lets all of it be tested without a model, a network or a window.'
])
