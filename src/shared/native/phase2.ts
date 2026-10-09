import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { CATALOGUE as ALGORITHMS } from '../algorithms/catalogue.ts'
import { SHAPES } from '../algorithms/inputs.ts'
import { CATALOGUE as STRUCTURES } from '../structures/catalogue.ts'

/**
 * The Phase 2 Native Apps: the computational environments, as against the Phase 1 laboratories.
 *
 * ## Why these are separate from `catalogue.ts`
 *
 * The Phase 1 catalogue registers thirty-seven surfaces that already existed and needed only a manifest. These are
 * new applications with their own engines, their own state and their own renderers, and they are the apps the
 * parameter system was built for — every control on them is a declared parameter that the engine actually reads.
 *
 * Keeping them in their own file means the Phase 1 list stays a record of what was adopted, and this one a record of
 * what was built. `allApps` in the service joins them, and the registry does not know or care which file an app came
 * from.
 *
 * ## Every entry here is a real environment
 *
 * No app appears in this file whose engine does not exist. There is no Python runner, no debugger and no profiler,
 * because Orbis ships no language runtime and no process sandbox — and §316 to §318 of the brief say plainly that a
 * runtime which cannot be packaged safely must not be advertised. What is here is what runs.
 *
 * Pure.
 */

const RECOMPUTE: readonly ActionDeclaration[] = [
  { id: 'run', summary: 'Run it with the current values', takes: [], idempotent: true, destructive: false },
  { id: 'reset', summary: 'Go back to the first step', takes: [], idempotent: true, destructive: false }
]

const STEPPING: readonly ActionDeclaration[] = [
  ...RECOMPUTE,
  { id: 'stepForward', summary: 'Go one step forward', takes: [], idempotent: false, destructive: false },
  { id: 'stepBack', summary: 'Go one step back', takes: [], idempotent: false, destructive: false },
  { id: 'toEnd', summary: 'Jump to the last step', takes: [], idempotent: true, destructive: false }
]

// ---------------------------------------------------------------- parameters

/** Every algorithm id the engine really has, so the choice cannot offer one that does not exist. */
const ALGORITHM_OPTIONS = ALGORITHMS.map((one) => ({ id: one.id, label: `${one.name} — ${one.family}` }))

const ALGORITHM_LAB: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'algorithm',
    name: 'Algorithm',
    kind: 'choice',
    initial: 'binary',
    about: 'Which algorithm to run. Each one records every comparison and every swap as it goes.',
    options: ALGORITHM_OPTIONS,
    group: 'What to run'
  },
  {
    id: 'values',
    name: 'Values',
    kind: 'numbers',
    initial: [2, 7, 11, 19, 24, 31, 48],
    about: 'The list to work on. Separated by commas or spaces.',
    mostValues: 20_000,
    group: 'What to run'
  },
  {
    id: 'target',
    name: 'Looking for',
    kind: 'number',
    initial: 31,
    about: 'The value a search should look for.',
    least: -1e12,
    most: 1e12,
    group: 'What to run'
  },
  {
    id: 'shape',
    name: 'Generate input',
    kind: 'choice',
    initial: 'random',
    about: 'Make a list of a particular shape instead of typing one. The adversarial shapes are where algorithms differ most.',
    options: SHAPES.map((one) => ({ id: one, label: one.replace(/-/g, ' ') })),
    group: 'Generated input'
  },
  {
    id: 'size',
    name: 'How many',
    kind: 'integer',
    initial: 20,
    about: 'How many values to generate.',
    least: 1,
    most: 20_000,
    group: 'Generated input'
  },
  {
    id: 'seed',
    name: 'Seed',
    kind: 'integer',
    initial: 1,
    about: 'The same seed gives the same list, so a comparison is a comparison and not a coincidence.',
    least: 0,
    most: 2_147_483_647,
    group: 'Generated input'
  },
  {
    id: 'pivot',
    name: 'Quicksort pivot',
    kind: 'choice',
    initial: 'median-of-three',
    about: 'Which element quicksort partitions around. Last-element on sorted input is its worst case.',
    options: [
      { id: 'last', label: 'last element' },
      { id: 'first', label: 'first element' },
      { id: 'middle', label: 'middle element' },
      { id: 'random', label: 'random (uses the seed)' },
      { id: 'median-of-three', label: 'median of three' }
    ],
    // Only means anything for quicksort, so it is hidden otherwise rather than sitting there doing nothing.
    shownWhen: [{ id: 'algorithm', is: 'quick' }],
    group: 'What to run'
  },
  {
    id: 'text',
    name: 'Text to search',
    kind: 'text',
    initial: 'abacabadabacaba',
    about: 'What the matchers look through. Something with a near-match everywhere shows the difference between them best.',
    shownWhen: [{ id: 'algorithm', is: 'naive-match' }],
    group: 'What to run'
  },
  {
    id: 'pattern',
    name: 'Pattern to find',
    kind: 'text',
    initial: 'abacaba',
    about: 'What to look for in it.',
    shownWhen: [{ id: 'algorithm', is: 'naive-match' }],
    group: 'What to run'
  },
  {
    id: 'puzzleSize',
    name: 'How many',
    kind: 'number',
    initial: 4,
    about: 'Discs for Hanoi, queens for the board. Both grow explosively, so each refuses past its own limit and says so.',
    least: 1,
    most: 12,
    step: 1,
    shownWhen: [{ id: 'algorithm', is: 'hanoi' }],
    group: 'What to run'
  },
  {
    id: 'capacity',
    name: 'Capacity',
    kind: 'number',
    initial: 10,
    about: 'How much the knapsack holds.',
    least: 1,
    most: 60,
    step: 1,
    shownWhen: [{ id: 'algorithm', is: 'knapsack' }],
    group: 'What to run'
  },
  {
    id: 'graphShape',
    name: 'Graph',
    kind: 'choice',
    initial: 'grid',
    about: 'The shape of graph to build for a graph algorithm.',
    options: [
      { id: 'random', label: 'random' },
      { id: 'grid', label: 'grid — has positions, so A* works' },
      { id: 'tree', label: 'tree' },
      { id: 'cycle', label: 'cycle' },
      { id: 'bipartite', label: 'bipartite' },
      { id: 'dag', label: 'directed, no cycles' },
      { id: 'disconnected', label: 'in separate pieces' }
    ],
    group: 'Graph'
  },
  {
    id: 'graphSize',
    name: 'Graph nodes',
    kind: 'integer',
    initial: 16,
    about: 'How many nodes the graph should have.',
    least: 1,
    most: 400,
    group: 'Graph'
  }
]

const GROWTH_LAB: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'algorithms',
    name: 'Algorithms',
    kind: 'text',
    initial: 'bubble,insertion,merge,quick,heap',
    // The ids are listed from the catalogue, so this cannot name an algorithm that was removed or miss one added.
    about: `Which to compare, by id, separated by commas. Between two and six. The sorts are: ${ALGORITHMS.filter(
      (one) => one.family === 'sorting'
    )
      .map((one) => one.id)
      .join(', ')}.`,
    group: 'Comparison'
  },
  {
    id: 'shape',
    name: 'Input shape',
    kind: 'choice',
    initial: 'random',
    about: 'The same input goes to every algorithm, which is what makes it a comparison.',
    options: SHAPES.map((one) => ({ id: one, label: one.replace(/-/g, ' ') })),
    group: 'Comparison'
  },
  {
    id: 'size',
    name: 'How many values',
    kind: 'integer',
    initial: 200,
    about: 'The size each algorithm is run at.',
    least: 2,
    most: 20_000,
    group: 'Comparison'
  },
  {
    id: 'seed',
    name: 'Seed',
    kind: 'integer',
    initial: 1,
    about: 'The same seed gives the same list to all of them.',
    least: 0,
    most: 2_147_483_647,
    group: 'Comparison'
  },
  {
    id: 'curve',
    name: 'Also measure growth',
    kind: 'boolean',
    initial: true,
    about: 'Run each one at several sizes and show how its work grows, beside the complexity the textbook states.',
    group: 'Comparison'
  }
]










// ---------------------------------------------------------------- data structures

/*
 * The structures and their operations are gathered from the engine, so the choices can never offer one that does not
 * exist — and adding an operation to the engine makes it appear here without this file being touched.
 */
const STRUCTURE_OPTIONS = STRUCTURES.map((one) => ({ id: one.id, label: one.name }))
const OPERATION_OPTIONS = (() => {
  const seen = new Map<string, string>()
  for (const entry of STRUCTURES) for (const one of entry.operations) if (!seen.has(one.id)) seen.set(one.id, one.name)
  return [...seen].map(([id, label]) => ({ id, label }))
})()

const STRUCTURE_LAB: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'structure',
    name: 'Structure',
    kind: 'choice',
    initial: 'binary-search-tree',
    about: 'Which structure to work with. Each one records every comparison, pointer change and bucket it touches.',
    options: STRUCTURE_OPTIONS,
    group: 'What to build'
  },
  {
    id: 'keys',
    name: 'Keys',
    kind: 'text',
    initial: '50 30 70 20 40 60 80',
    about: 'The values to put in, separated by spaces or commas. For a trie, type words instead.',
    group: 'What to build'
  },
  {
    id: 'operation',
    name: 'Operation',
    kind: 'choice',
    initial: 'find',
    about: 'What to do next. An operation the chosen structure does not have is refused rather than ignored.',
    options: OPERATION_OPTIONS,
    group: 'What to do'
  },
  {
    id: 'argument',
    name: 'Value',
    kind: 'text',
    initial: '80',
    about: 'What the operation works on — the key to find, insert or remove.',
    group: 'What to do'
  },
  {
    id: 'walk',
    name: 'Walk order',
    kind: 'choice',
    initial: 'in-order',
    about: 'Which order to visit the nodes in. In-order on a search tree gives the keys sorted.',
    options: [
      { id: 'in-order', label: 'in-order (gives them sorted)' },
      { id: 'pre-order', label: 'pre-order' },
      { id: 'post-order', label: 'post-order' },
      { id: 'level-order', label: 'level by level' }
    ],
    // Only a tree can be walked, so this is hidden for everything else.
    shownWhen: [
      { id: 'structure', is: 'binary-search-tree' },
      { id: 'structure', is: 'avl-tree' }
    ],
    group: 'What to do'
  },
  {
    id: 'collisions',
    name: 'When two keys collide',
    kind: 'choice',
    initial: 'chaining',
    about:
      'Chaining lets a bucket hold a list. Probing walks on to the next free slot, which is why removing from it leaves a tombstone.',
    options: [
      { id: 'chaining', label: 'chaining — the bucket holds a list' },
      { id: 'linear-probing', label: 'probing — walk on to the next slot' }
    ],
    shownWhen: [{ id: 'structure', is: 'hash-table' }],
    group: 'Hash table'
  },
  {
    id: 'buckets',
    name: 'Buckets to start with',
    kind: 'integer',
    initial: 8,
    about: 'A small table collides sooner, which makes the behaviour easier to see.',
    least: 2,
    most: 1024,
    shownWhen: [{ id: 'structure', is: 'hash-table' }],
    group: 'Hash table'
  },
  {
    id: 'compress',
    name: 'Flatten paths on lookup',
    kind: 'boolean',
    initial: true,
    about:
      'With this on, looking something up shortens the path it walked, so the structure gets faster from being used. Turn it off to see what that is worth.',
    shownWhen: [{ id: 'structure', is: 'union-find' }],
    group: 'Union-find'
  },
  {
    id: 'compareWith',
    name: 'Compare against',
    kind: 'text',
    initial: '',
    about: 'Other structures to run the same work on, by id, separated by commas. Leave empty for just the one.',
    group: 'Comparison'
  }
]

// ---------------------------------------------------------------- SQL

const SQL_LAB: readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[] = [
  {
    id: 'dataset',
    name: 'Practice database',
    kind: 'choice',
    initial: 'shop',
    about: 'Which set of tables to start with. All of them hold made-up data.',
    options: [
      { id: 'shop', label: 'A small shop — customers, products and orders' },
      { id: 'library', label: 'A library — books, borrowers and loans' },
      { id: 'weather', label: 'Weather readings — 360 rows, for window functions' },
      { id: 'empty', label: 'Nothing — I will make my own tables' }
    ],
    group: 'Database'
  },
  {
    id: 'query',
    name: 'Query',
    kind: 'text',
    initial: 'SELECT name, city FROM customers ORDER BY name',
    about: 'The SQL to run. Several statements separated by semicolons are allowed.',
    group: 'Query'
  },
  {
    id: 'showPlan',
    name: 'Show how the database did it',
    kind: 'boolean',
    initial: true,
    about: 'The database engine reports its own plan, which says whether it used an index or read a whole table.',
    group: 'Query'
  }
]

/** The parameter sets, built and checked at import. A bad list here is a programming error and fails loudly. */
export const PHASE2_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const out: Record<string, ParameterSet> = {}
    const sets: readonly (readonly [string, readonly (Omit<Parameter, 'value'> & { value?: Parameter['value'] })[]])[] = [
      ['algorithm-lab', ALGORITHM_LAB],
      ['algorithm-compare', GROWTH_LAB],
      ['structure-lab', STRUCTURE_LAB],
      ['sql-lab', SQL_LAB]
    ]
    for (const [id, list] of sets) {
      const made = declareAll(list)
      if (Array.isArray(made)) {
        const first = made.find(isParameterProblem)
        throw new Error(`Parameters for "${id}" are not valid: ${first ? `${first.id} — ${first.says}` : 'unknown problem'}`)
      }
      out[id] = made
    }
    return out
  })()
)

// ---------------------------------------------------------------- the manifests

const app = (one: Omit<NativeAppManifest, 'version' | 'aliases'> & { version?: number; aliases?: readonly string[] }): NativeAppManifest => ({
  version: 1,
  aliases: [],
  ...one
})

export const PHASE2_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  app({
    id: 'algorithm-lab',
    name: 'Algorithm Laboratory',
    summary: 'Watch an algorithm run, one recorded step at a time, with every comparison and swap counted.',
    domain: 'computing',
    icon: 'git-compare',
    aliases: ['algorithm visualizer', 'algorithm visualiser', 'binary search', 'quicksort', 'sorting', 'bfs', 'dijkstra', 'visualize an algorithm'],
    // Every algorithm's own name is a tag, taken from the catalogue rather than typed out — so registering a new
    // algorithm makes it searchable by name in the same commit, instead of the list here falling behind.
    /*
     * Every algorithm's own name, plus its id where that differs, deduplicated.
     *
     * Derived rather than typed out, so registering an algorithm makes it findable by name in the same commit.
     * Deduplicated because most ids are just the lower-case name, and the manifest has a limit worth respecting
     * rather than raising every time the catalogue grows.
     */
    tags: [
      ...new Set([
        'algorithm', 'sort', 'search', 'graph', 'trace', 'step', 'recursion', 'complexity', 'big o',
        'pseudocode', 'follow the code', 'variables', 'step through', 'data structure',
        // Ids first: they are the short forms people type, and the cap would otherwise cut them off the end.
        ...ALGORITHMS.map((one) => one.id),
        ...ALGORITHMS.map((one) => one.name.toLowerCase())
      ])
    ].slice(0, 118),
    capabilities: [
      { id: 'visualizeAlgorithm', summary: 'run an algorithm step by step and show what it does' },
      { id: 'traceExecution', summary: 'record every comparison, swap and recursive call an algorithm makes' },
      { id: 'measureComplexity', summary: 'measure how an algorithm’s work grows with the input size' }
    ],
    surface: { kind: 'native', ref: 'AlgorithmLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE2_PARAMETERS['algorithm-lab']),
    actions: STEPPING,
    accepts: ['numbers'],
    produces: ['numbers', 'series', 'table'],
    permissions: ['compute'],
    persists: true,
    engine: 'algorithms',
    limitations: [
      'Lists are capped at 20,000 values and graphs at 400 nodes, because a trace of a million steps is a hang rather than a lesson.',
      'A run that reaches the step ceiling says so, and its answer is shown as incomplete rather than as the result.',
      'It runs the algorithms it ships with. Writing your own is not yet possible here.'
    ],
    // Retired: the studio traces ninety-two algorithms in its Algorithms & DSA section.
    supersededBy: 'cs-studio'
  }),
  app({
    id: 'algorithm-compare',
    name: 'Algorithm Comparison',
    summary: 'Run several algorithms over the same input and see which did less work, measured rather than claimed.',
    domain: 'computing',
    icon: 'columns-3',
    aliases: ['compare algorithms', 'algorithm race', 'benchmark algorithms', 'quicksort vs merge sort'],
    tags: ['compare', 'benchmark', 'complexity', 'growth', 'comparisons', 'swaps', 'race'],
    capabilities: [
      { id: 'compareAlgorithms', summary: 'run several algorithms on identical input and compare what each did' },
      { id: 'measureGrowth', summary: 'show how each algorithm’s work grows with the input size' }
    ],
    surface: { kind: 'native', ref: 'AlgorithmCompare' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'throttle',
    parameters: Object.keys(PHASE2_PARAMETERS['algorithm-compare']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['table', 'series'],
    permissions: ['compute'],
    persists: true,
    engine: 'algorithms',
    limitations: [
      'It counts operations, not wall-clock time: a count is reproducible and a timing on one machine is not.',
      'Between two and six algorithms at once. More is unreadable.',
      'An algorithm that refuses the input — binary search on an unsorted list — is shown with its reason rather than left out.'
    ]
  }),
  app({
    id: 'structure-lab',
    name: 'Data Structures Laboratory',
    summary: 'Build a structure a key at a time and watch what each operation really costs.',
    domain: 'computing',
    icon: 'binary',
    aliases: [
      'data structures',
      'linked list',
      'binary search tree',
      'hash table',
      'stack',
      'queue',
      'heap',
      'trie',
      'avl tree'
    ],
    tags: [
      'data structure',
      'stack',
      'queue',
      'deque',
      'linked list',
      'tree',
      'binary search tree',
      'avl',
      'balanced',
      'heap',
      'priority queue',
      'hash',
      'hash table',
      'hashing',
      'collision',
      'trie',
      'prefix',
      'union find',
      'disjoint set',
      'rotation',
      'pointer'
    ],
    capabilities: [
      { id: 'exploreDataStructure', summary: 'build a data structure and run operations on it one step at a time' },
      { id: 'compareDataStructures', summary: 'run the same work on several structures and compare what each cost' }
    ],
    surface: { kind: 'native', ref: 'StructureLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE2_PARAMETERS['structure-lab']),
    actions: STEPPING,
    accepts: ['numbers'],
    produces: ['numbers', 'table'],
    permissions: ['compute'],
    persists: true,
    engine: 'structures',
    limitations: [
      'Up to 4,000 keys, because a picture of more is not a picture. The counts stay exact at that size.',
      'The structures are the twelve it ships with. Writing your own is not possible here.',
      'A deque and a queue are backed by a plain array, so working at the front shifts everything along. The counts show that rather than pretending both ends are free.'
    ]
  }),
  app({
    id: 'sql-lab',
    name: 'Database Laboratory',
    summary: 'Write real SQL against a practice database and see how the database chose to answer it.',
    domain: 'computing',
    icon: 'database',
    aliases: ['sql', 'database', 'query', 'join', 'select', 'practise sql'],
    tags: [
      'sql',
      'database',
      'query',
      'select',
      'join',
      'left join',
      'group by',
      'having',
      'index',
      'query plan',
      'primary key',
      'foreign key',
      'constraint',
      'window function',
      'schema',
      'aggregate'
    ],
    capabilities: [
      { id: 'runQuery', summary: 'run SQL against a practice database and show the rows it returns' },
      {
        id: 'explainQuery',
        summary: 'show how the database decided to answer a query, and whether it used an index'
      },
      { id: 'exploreSchema', summary: 'show the tables, columns, keys and indexes a database holds' }
    ],
    surface: { kind: 'native', ref: 'SqlLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    // A hidden database laboratory is doing nothing: it only works when a query is run, so there is nothing to pause
    // and nothing to throttle. 'continue' says that honestly.
    whenHidden: 'continue',
    parameters: Object.keys(PHASE2_PARAMETERS['sql-lab']),
    actions: RECOMPUTE,
    accepts: ['table'],
    produces: ['table'],
    permissions: ['compute'],
    persists: true,
    engine: 'sqlite',
    limitations: [
      'The practice data is made up. It is shaped like real data so that joins have something to join, and nothing in it is a measurement of anything.',
      'The database lives in memory only. Nothing is written to disk and nothing survives closing Orbis, which is also why it cannot reach your own data.',
      'Statements that could open a file are refused, with the reason. Everything else the engine does, this does.',
      'A query is stopped after five seconds, and a result is cut off after 2,000 rows with a note saying so.'
    ]
  })
])

export const PHASE2_BY_ID: Readonly<Record<string, NativeAppManifest>> = Object.freeze(
  Object.fromEntries(PHASE2_CATALOGUE.map((one) => [one.id, one]))
)
