import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { PRESETS } from '../cs/automata.ts'
import { SHAPES } from '../cs/graphics3d.ts'

/**
 * The Phase 7 Native Apps: computer science.
 *
 * ## Five laboratories where the working is the subject
 *
 * Each of these shows a thing most courses describe and almost nobody sees. A compiler's tree, where precedence
 * actually lives. The subset construction, which is the only proof that two kinds of machine are equally powerful.
 * A query plan, which is why `WHERE` cannot use an alias. The perspective divide, which is the one step that makes
 * distant things small. And a cluster that really cannot elect a leader when it is split, because two is not three.
 *
 * ## Every option list is read from its engine
 *
 * The machines, the shapes and the example queries all come from the engines that run them, so a control cannot
 * offer something that does not exist and cannot fall behind when one is added.
 *
 * Pure.
 */

const RECOMPUTE: readonly ActionDeclaration[] = [
  { id: 'run', summary: 'Work it out with the current values', takes: [], idempotent: true, destructive: false },
  { id: 'reset', summary: 'Go back to the starting values', takes: [], idempotent: true, destructive: false }
]

type Declared = Omit<Parameter, 'value'> & { value?: Parameter['value'] }

// ---------------------------------------------------------------- the compiler

const COMPILER: readonly Declared[] = [
  {
    id: 'source',
    name: 'Program',
    kind: 'text',
    initial:
      '// precedence: the multiplication happens first\nlet x = 3 + 4 * 2;\nlet y = x - 1;\n\nif x > y {\n  print x;\n} else {\n  print y;\n}\n\n// a loop, to show the step count climb\nlet total = 0;\nlet n = 1;\nwhile n <= 10 {\n  total = total + n;\n  n = n + 1;\n}\nprint total;\n',
    about: 'Numbers, names, + - * / %, comparison, if/else, while and print. A mistake is reported with the stage it came from and where.',
    group: 'What to compile'
  }
]

// ---------------------------------------------------------------- the automaton

const AUTOMATA: readonly Declared[] = [
  {
    id: 'preset',
    name: 'Machine',
    kind: 'choice',
    initial: 'ends-00',
    about: 'Which machine to run. Two of them are non-deterministic, which is what the conversion tab is for.',
    // Read from the engine, so a machine cannot be offered that does not exist.
    options: PRESETS.map((one) => ({ id: one.id, label: one.name })),
    group: 'The machine'
  },
  {
    id: 'input',
    name: 'String to test',
    kind: 'text',
    initial: '0100',
    about: 'Fed to the machine one symbol at a time. A symbol outside the alphabet is refused, which is a different rejection from finishing in the wrong state.',
    group: 'The machine'
  },
  {
    id: 'upTo',
    name: 'Explore up to',
    kind: 'number',
    initial: 3,
    about: 'How long the strings are that the explore tab tries, so you can see what the machine accepts rather than guessing.',
    least: 1,
    most: 5,
    step: 1,
    group: 'The machine'
  }
]

// ---------------------------------------------------------------- cryptography

const CRYPTO: readonly Declared[] = [
  {
    id: 'text',
    name: 'Message',
    kind: 'text',
    initial: 'The quick brown fox jumps over the lazy dog',
    about: 'What to hash, encode or encipher.',
    group: 'The message'
  },
  {
    id: 'compareWith',
    name: 'Compare with',
    kind: 'text',
    initial: 'The quick brown fox jumps over the lazy cog',
    about: 'A second message, so the laboratory can count how many of the 256 bits change when one character does.',
    group: 'The message'
  },
  {
    id: 'shift',
    name: 'Caesar shift',
    kind: 'number',
    initial: 3,
    about: 'How far along the alphabet to move each letter. Thirteen gives ROT13, which is its own inverse.',
    least: -25,
    most: 25,
    step: 1,
    group: 'Ciphers'
  },
  {
    id: 'key',
    name: 'XOR key',
    kind: 'text',
    initial: 'orbis',
    about: 'Repeated along the message. A repeating key leaves a repeating pattern, which is why this is a demonstration rather than protection.',
    group: 'Ciphers'
  }
]

// ---------------------------------------------------------------- graphics

const GRAPHICS: readonly Declared[] = [
  {
    id: 'shape',
    name: 'Shape',
    kind: 'choice',
    initial: 'cube',
    about: 'What to put through the pipeline.',
    options: SHAPES.map((one) => ({ id: one.id, label: one.name })),
    group: 'The shape'
  },
  { id: 'rotateX', name: 'Turn about x', kind: 'number', initial: 0.5, about: 'In radians.', unit: 'rad', least: -6.3, most: 6.3, step: 0.05, group: 'The shape' },
  { id: 'rotateY', name: 'Turn about y', kind: 'number', initial: 0.7, about: 'In radians.', unit: 'rad', least: -6.3, most: 6.3, step: 0.05, group: 'The shape' },
  { id: 'rotateZ', name: 'Turn about z', kind: 'number', initial: 0, about: 'In radians.', unit: 'rad', least: -6.3, most: 6.3, step: 0.05, group: 'The shape' },
  {
    id: 'detail',
    name: 'Detail',
    kind: 'number',
    initial: 12,
    about: 'How many bands a sphere or torus is built from. More is rounder and slower, which is the trade worth seeing.',
    least: 3,
    most: 32,
    step: 1,
    shownWhen: [{ id: 'shape', is: 'sphere' }],
    group: 'The shape'
  },
  { id: 'distance', name: 'Camera distance', kind: 'number', initial: 3, about: 'How far back the camera sits.', least: 1.2, most: 12, step: 0.1, group: 'The camera' },
  {
    id: 'fieldOfView',
    name: 'Field of view',
    kind: 'number',
    initial: 60,
    about: 'How wide the camera sees, in degrees. Wide makes near things loom; narrow flattens everything.',
    unit: '°',
    least: 10,
    most: 150,
    step: 1,
    group: 'The camera'
  },
  {
    id: 'orthographic',
    name: 'No perspective',
    kind: 'boolean',
    initial: false,
    about: 'Stop dividing by depth. The far side of the shape then comes out exactly the size of the near side — which is the whole difference between the two projections.',
    group: 'The camera'
  },
  {
    id: 'backFaceCulling',
    name: 'Hide the back faces',
    kind: 'boolean',
    initial: true,
    about: 'Leave out any face pointing away from the camera. The cheapest hidden-surface method there is, and it only works on a closed shape.',
    group: 'The camera'
  }
]

// ---------------------------------------------------------------- consensus

const CONSENSUS: readonly Declared[] = [
  { id: 'nodes', name: 'Nodes', kind: 'number', initial: 5, about: 'How many machines are in the cluster. A majority of five is three, so it survives two failures.', least: 1, most: 9, step: 1, group: 'The cluster' },
  { id: 'seed', name: 'Seed', kind: 'number', initial: 1, about: 'Decides which node times out first. The same seed gives exactly the same run.', least: 1, most: 9999, step: 1, group: 'The cluster' },
  {
    id: 'action',
    name: 'Do this',
    kind: 'choice',
    initial: 'settle',
    about: 'Break it on purpose — that is where everything interesting about consensus is.',
    options: [
      { id: 'settle', label: 'run until a leader is elected' },
      { id: 'step', label: 'one tick' },
      { id: 'crash', label: 'crash a node' },
      { id: 'recover', label: 'bring one back' },
      { id: 'partition', label: 'split the cluster' },
      { id: 'heal', label: 'heal the split' },
      { id: 'propose', label: 'propose a value' },
      { id: 'make', label: 'start again' }
    ],
    group: 'What to do'
  },
  {
    id: 'node',
    name: 'Which node',
    kind: 'text',
    initial: 'A',
    about: 'The node to crash or bring back.',
    shownWhen: [{ id: 'action', is: 'crash' }],
    group: 'What to do'
  },
  {
    id: 'sideB',
    name: 'Split off',
    kind: 'text',
    initial: 'D,E',
    about: 'Which nodes end up on the other side of the split. They can still talk to each other and to nobody else.',
    shownWhen: [{ id: 'action', is: 'partition' }],
    group: 'What to do'
  },
  {
    id: 'value',
    name: 'Value to agree',
    kind: 'text',
    initial: 'x = 1',
    about: 'What the leader should replicate. It is committed only once a majority holds it.',
    shownWhen: [{ id: 'action', is: 'propose' }],
    group: 'What to do'
  }
]

export const PHASE7_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const out: Record<string, ParameterSet> = {}
    const sets: readonly (readonly [string, readonly Declared[]])[] = [
      ['compiler-lab', COMPILER],
      ['automata-lab', AUTOMATA],
      ['crypto-lab', CRYPTO],
      ['graphics-lab', GRAPHICS],
      ['consensus-lab', CONSENSUS]
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

const app = (
  one: Omit<NativeAppManifest, 'version' | 'aliases'> & { version?: number; aliases?: readonly string[] }
): NativeAppManifest => ({ version: 1, aliases: [], ...one })

export const PHASE7_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  app({
    id: 'compiler-lab',
    name: 'Compiler Laboratory',
    summary: 'Watch code become tokens, then a tree, then an answer — and see where precedence actually lives.',
    domain: 'computing',
    icon: 'git-merge',
    aliases: ['compiler', 'parser', 'lexer', 'abstract syntax tree', 'interpreter', 'tokeniser'],
    tags: [
      'compiler', 'compile', 'lexer', 'lexing', 'tokeniser', 'tokenizer', 'token', 'parser', 'parsing',
      'ast', 'abstract syntax tree', 'syntax tree', 'interpreter', 'precedence', 'grammar', 'recursive descent',
      'compiler design', 'how compilers work', 'parse a program'
    ],
    capabilities: [
      { id: 'tokeniseSource', summary: 'split a program into tokens and say what kind each one is' },
      { id: 'parseToTree', summary: 'build the tree, where precedence is decided' },
      { id: 'interpretTree', summary: 'run the tree and show what it printed, with the step count' }
    ],
    surface: { kind: 'native', ref: 'CompilerLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE7_PARAMETERS['compiler-lab']),
    actions: RECOMPUTE,
    accepts: ['text'],
    produces: ['table'],
    permissions: ['compute'],
    persists: true,
    engine: 'cs',
    limitations: [
      'A toy language on purpose: numbers, names, four operators, comparison, if/else, while and print. No functions, no strings, no types.',
      'It interprets the tree directly. There is no code generation, no machine code and no optimisation — the stages after the tree are not here.',
      'A program is stopped after 100,000 steps, so a loop that never ends comes back rather than hanging.',
      'The pseudocode shown is the shape of a compiler, not a language anybody should write anything real in.'
    ]
  }),
  app({
    id: 'automata-lab',
    name: 'Theory of Computation',
    summary: 'Run a finite machine on a string, and turn a non-deterministic one into a deterministic one.',
    domain: 'computing',
    icon: 'sigma',
    aliases: ['dfa', 'nfa', 'finite automaton', 'state machine', 'automata', 'theory of computation'],
    tags: [
      'dfa', 'nfa', 'finite automaton', 'finite state machine', 'state machine', 'automata', 'automaton',
      'theory of computation', 'subset construction', 'powerset construction', 'epsilon', 'regular language',
      'accept', 'reject', 'transition table', 'deterministic', 'non-deterministic', 'nondeterministic'
    ],
    capabilities: [
      { id: 'runMachine', summary: 'feed a string to a machine step by step and say why it accepted or rejected' },
      { id: 'convertToDeterministic', summary: 'build the deterministic machine a non-deterministic one is equivalent to' },
      { id: 'exploreLanguage', summary: 'test every string up to a length, to see what a machine really accepts' }
    ],
    surface: { kind: 'native', ref: 'AutomataLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE7_PARAMETERS['automata-lab']),
    actions: RECOMPUTE,
    accepts: ['text'],
    produces: ['table'],
    permissions: ['compute'],
    persists: true,
    engine: 'cs',
    limitations: [
      'Finite machines only. No pushdown automata, no Turing machines, and no regular expressions to convert from.',
      'The machines are the six built in; this does not yet let you draw your own from nothing.',
      'The subset construction stops at 256 states, because in the worst case it doubles with every state — which is the point of it.',
      'It says what a machine accepts for strings up to five symbols. That is evidence, never a proof.'
    ]
  }),
  app({
    id: 'crypto-lab',
    name: 'Cybersecurity Laboratory',
    summary: 'SHA-256 round by round, Base64, and the classical ciphers — broken in front of you.',
    domain: 'computing',
    icon: 'shield',
    aliases: ['hash', 'sha256', 'base64', 'caesar cipher', 'rot13', 'xor', 'encryption', 'cybersecurity'],
    tags: [
      'hash', 'hashing', 'sha', 'sha256', 'sha-256', 'digest', 'checksum', 'avalanche', 'base64', 'encoding',
      'hexadecimal', 'caesar', 'caesar cipher', 'rot13', 'xor', 'cipher', 'encrypt', 'decrypt', 'cryptography',
      'cybersecurity', 'break a cipher', 'frequency analysis'
    ],
    capabilities: [
      { id: 'hashMessage', summary: 'work out a SHA-256 digest and show the rounds that produced it' },
      { id: 'measureAvalanche', summary: 'count how many bits change when one character does' },
      { id: 'breakCaesarCipher', summary: 'break a Caesar cipher by trying every shift' }
    ],
    surface: { kind: 'native', ref: 'CryptoLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE7_PARAMETERS['crypto-lab']),
    actions: RECOMPUTE,
    accepts: ['text'],
    produces: ['table'],
    permissions: ['compute'],
    persists: true,
    engine: 'cs',
    limitations: [
      'Nothing here protects anything. Base64 and hexadecimal hide nothing at all, Caesar is broken by trying twenty-six keys, and XOR with a repeating key is broken by anybody who knows the method.',
      'No modern cipher, no password hashing and no key derivation. Real secrets belong in the Secrets Vault, which this laboratory cannot see and never touches.',
      'The SHA-256 here is written out so the rounds can be shown. It agrees with the published test vectors, and it is for learning rather than for securing anything.',
      'Breaking the Caesar cipher scores by English letter frequency, so it does worse on short text and on anything that is not English.'
    ],
    // Retired: the studio has Cybersecurity.
    supersededBy: 'cs-studio'
  }),
  app({
    id: 'graphics-lab',
    name: 'Computer Graphics',
    summary: 'A shape through the whole 3D pipeline — model, world, camera, clip, screen — with the numbers at each stage.',
    domain: 'computing',
    icon: 'box',
    aliases: ['3d', 'graphics', 'projection', 'perspective', 'wireframe', 'matrices'],
    tags: [
      '3d', 'graphics', 'computer graphics', 'wireframe', 'projection', 'perspective', 'orthographic',
      'matrix', 'matrices', 'transform', 'rotation', 'model view projection', 'mvp', 'clip space',
      'perspective divide', 'back face culling', 'hidden surface', 'field of view', 'render', 'rendering'
    ],
    capabilities: [
      { id: 'projectShape', summary: 'put a shape through the pipeline and give the points at every stage' },
      { id: 'compareProjections', summary: 'show perspective and orthographic from the same matrices' },
      { id: 'cullBackFaces', summary: 'work out which faces point away from the camera' }
    ],
    surface: { kind: 'native', ref: 'GraphicsLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE7_PARAMETERS['graphics-lab']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['image', 'table'],
    permissions: ['compute'],
    persists: true,
    engine: 'cs',
    limitations: [
      'Wireframes with flat shading. There is no light in this scene, no texture, no shader and no rasteriser — the shading is only how square-on a face is.',
      'Back-face culling is the only hidden-surface work it does, and that only works on a closed shape.',
      'Faces are drawn furthest first, which is enough here and is wrong for shapes that pass through each other.',
      'Four thousand points at most, because every stage is kept so the table can show them.'
    ]
  }),
  app({
    id: 'consensus-lab',
    name: 'Distributed Systems',
    summary: 'Elect a leader, crash it, split the network — and watch why a majority is the rule.',
    domain: 'computing',
    icon: 'share-2',
    aliases: ['consensus', 'raft', 'leader election', 'distributed', 'quorum', 'split brain'],
    tags: [
      'consensus', 'raft', 'paxos', 'leader election', 'distributed', 'distributed systems', 'quorum',
      'majority', 'split brain', 'partition', 'network partition', 'replication', 'replicated log',
      'fault tolerance', 'crash', 'term', 'heartbeat', 'commit'
    ],
    capabilities: [
      { id: 'electLeader', summary: 'run the cluster until a leader is elected, with every vote recorded' },
      { id: 'crashNode', summary: 'crash a node and watch what the rest do about it' },
      { id: 'partitionCluster', summary: 'split the network and show which side can still decide anything' },
      { id: 'replicateValue', summary: 'propose a value and commit it once a majority holds it' }
    ],
    surface: { kind: 'native', ref: 'ConsensusLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE7_PARAMETERS['consensus-lab']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['table'],
    permissions: ['compute'],
    persists: true,
    engine: 'cs',
    limitations: [
      'The parts of Raft that matter for the ideas: terms, votes, a majority, a log and commitment. Not log repair after a conflict, not snapshots, not membership changes.',
      'There is no clock. A tick is a step and timeouts are counted in ticks from a seeded generator, so a run can be repeated exactly.',
      'Messages are never lost or delayed — only a crash or a split stops them. Real networks are worse than this in ways that make consensus harder.',
      'Nine nodes at most.'
    ]
  })
])

export const PHASE7_BY_ID: Readonly<Record<string, NativeAppManifest>> = Object.freeze(
  Object.fromEntries(PHASE7_CATALOGUE.map((one) => [one.id, one]))
)
