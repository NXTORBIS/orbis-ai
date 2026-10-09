import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { BLUEPRINTS, BLUEPRINT_ABOUT } from '../compute/logic.ts'
import { SAMPLES, SAMPLE_ABOUT, REPLACEMENTS } from '../compute/processor.ts'
import { POLICIES, POLICY_FACTS, PAGE_REPLACEMENTS } from '../compute/scheduling.ts'
import { SHAPES, SHAPE_ABOUT } from '../compute/networking.ts'
import { ADJUSTMENTS, KNOWN_KERNELS, TEST_PICTURES, TEST_PICTURE_ABOUT } from '../compute/imaging.ts'
import { MODEL_KINDS, MODEL_FACTS, SAMPLE_DATASETS, SAMPLE_ABOUT as DATASET_ABOUT } from '../compute/learning.machine.ts'
import { ACTIVATIONS, ACTIVATION_FACTS, PROBLEMS, PROBLEM_ABOUT } from '../compute/neural.ts'

/**
 * The Phase 5 Native Apps: systems and intelligence.
 *
 * ## These are the seven engines Phase 4 said did not exist
 *
 * Digital logic, the processor, the operating system, the network, image processing, machine learning and neural
 * networks were all listed in `docs/phase4-engineering.md` as absent, with a test asserting their capabilities
 * resolved to nothing. They exist now, and this is what makes them reachable from a conversation.
 *
 * ## Every option list is read from its engine
 *
 * The blueprints, the sample programs, the scheduling policies, the kernels, the models, the activations — each is
 * imported rather than retyped. A choice offering something an engine does not have would be a dead control, and
 * reading the list makes that impossible rather than merely unlikely.
 *
 * Pure.
 */

const RECOMPUTE: readonly ActionDeclaration[] = [
  { id: 'run', summary: 'Work it out with the current values', takes: [], idempotent: true, destructive: false },
  { id: 'reset', summary: 'Go back to the starting values', takes: [], idempotent: true, destructive: false }
]

const STEPPING: readonly ActionDeclaration[] = [
  ...RECOMPUTE,
  { id: 'stepForward', summary: 'Go one step forward', takes: [], idempotent: false, destructive: false },
  { id: 'stepBack', summary: 'Go one step back', takes: [], idempotent: false, destructive: false },
  { id: 'toEnd', summary: 'Jump to the end', takes: [], idempotent: true, destructive: false }
]

type Declared = Omit<Parameter, 'value'> & { value?: Parameter['value'] }

// ---------------------------------------------------------------- digital logic

const LOGIC: readonly Declared[] = [
  {
    id: 'what',
    name: 'Show',
    kind: 'choice',
    initial: 'truth-table',
    about: 'What to work out about the circuit.',
    options: [
      { id: 'blueprint', label: 'the circuit, and whether it is wired properly' },
      { id: 'truth-table', label: 'its truth table, by running every combination' },
      { id: 'simplify', label: 'the smallest expression that does the same thing' },
      { id: 'clocked', label: 'a clocked circuit, tick by tick' }
    ],
    group: 'What to show'
  },
  {
    id: 'blueprint',
    name: 'Circuit',
    kind: 'choice',
    initial: 'half-adder',
    about: 'Which circuit to look at. Each one is built from real gates and evaluated rather than drawn.',
    options: BLUEPRINTS.map((one) => ({ id: one, label: `${one.replace(/-/g, ' ')} — ${BLUEPRINT_ABOUT[one].split('.')[0]}` })),
    shownWhen: [
      { id: 'what', is: 'blueprint' },
      { id: 'what', is: 'truth-table' },
      { id: 'what', is: 'simplify' }
    ],
    group: 'What to show'
  },
  {
    id: 'output',
    name: 'Reduce which output',
    kind: 'text',
    initial: 'sum',
    about: 'Which of the circuit’s outputs to find the smallest expression for.',
    shownWhen: [{ id: 'what', is: 'simplify' }],
    group: 'What to show'
  },
  {
    id: 'sequential',
    name: 'Clocked circuit',
    kind: 'choice',
    initial: 'counter',
    about: 'Which clocked circuit to run. A counter uses every state it has; a shift register moves a bit along one place a tick.',
    options: [
      { id: 'counter', label: 'a counter' },
      { id: 'shift-register', label: 'a shift register' }
    ],
    shownWhen: [{ id: 'what', is: 'clocked' }],
    group: 'Clocked'
  },
  {
    id: 'bits',
    name: 'How wide',
    kind: 'integer',
    initial: 4,
    about: 'How many flip-flops it has. A counter of n bits has 2ⁿ states.',
    least: 2,
    most: 8,
    shownWhen: [{ id: 'what', is: 'clocked' }],
    group: 'Clocked'
  },
  {
    id: 'ticks',
    name: 'For how many ticks',
    kind: 'integer',
    initial: 20,
    about: 'How many clock edges to simulate.',
    least: 1,
    most: 200,
    shownWhen: [{ id: 'what', is: 'clocked' }],
    group: 'Clocked'
  }
]

// ---------------------------------------------------------------- the processor

const PROCESSOR: readonly Declared[] = [
  {
    id: 'useSample',
    name: 'Program',
    kind: 'choice',
    initial: 'sum-array',
    about: 'Which program to run. Each one is assembled and executed; the registers and memory shown are what it actually produced.',
    options: SAMPLES.map((one) => ({ id: one, label: `${one.replace(/-/g, ' ')} — ${SAMPLE_ABOUT[one].split('.')[0]}` })),
    group: 'Program'
  },
  {
    id: 'forwarding',
    name: 'Pass results straight on',
    kind: 'boolean',
    initial: true,
    about: 'Hand a result from the stage that produced it to the stage that needs it, instead of waiting for it to be written back. Turn it off and compare the cycle count.',
    group: 'Pipeline'
  },
  {
    id: 'predictTaken',
    name: 'Guess that branches are taken',
    kind: 'boolean',
    initial: false,
    about: 'A taken branch throws away the two instructions behind it. Guessing right avoids that.',
    group: 'Pipeline'
  },
  {
    id: 'cacheSize',
    name: 'Cache size',
    kind: 'integer',
    initial: 64,
    about: 'How many words the cache holds in total.',
    least: 4,
    most: 4_096,
    group: 'Cache'
  },
  {
    id: 'lineSize',
    name: 'Words per line',
    kind: 'integer',
    initial: 4,
    about: 'A bigger line helps a program that reads in order and wastes space on one that jumps about.',
    least: 1,
    most: 64,
    group: 'Cache'
  },
  {
    id: 'ways',
    name: 'Lines per set',
    kind: 'integer',
    initial: 1,
    about: 'One is direct-mapped, where two addresses landing in the same set evict each other however much room there is elsewhere.',
    least: 1,
    most: 16,
    group: 'Cache'
  },
  {
    id: 'replacement',
    name: 'What to evict',
    kind: 'choice',
    initial: 'lru',
    about: 'Which line to throw out when a set is full.',
    options: REPLACEMENTS.map((one) => ({ id: one, label: one === 'lru' ? 'least recently used' : one === 'fifo' ? 'whatever arrived first' : 'at random' })),
    group: 'Cache'
  }
]

// ---------------------------------------------------------------- the operating system

const SCHEDULING: readonly Declared[] = [
  {
    id: 'what',
    name: 'Show',
    kind: 'choice',
    initial: 'processes',
    about: 'Which part of an operating system to look at.',
    options: [
      { id: 'processes', label: 'scheduling — who gets the processor, and when' },
      { id: 'paging', label: 'memory — which pages are kept and which are thrown out' },
      { id: 'deadlock', label: 'deadlock — a circular wait, and whether a state is safe' },
      { id: 'race', label: 'a race — what happens without a lock, and with one' }
    ],
    group: 'What to show'
  },
  {
    id: 'policy',
    name: 'Scheduling policy',
    kind: 'choice',
    initial: 'round-robin',
    about: 'How the processor is handed out. Every one of these has something it is bad at, and the panel says what.',
    options: POLICIES.map((one) => ({ id: one, label: POLICY_FACTS[one].label })),
    shownWhen: [{ id: 'what', is: 'processes' }],
    group: 'Scheduling'
  },
  {
    id: 'quantum',
    name: 'Slice length',
    kind: 'integer',
    initial: 4,
    about: 'How long a process may hold the processor before it is taken away. The whole decision in round robin.',
    least: 1,
    most: 64,
    shownWhen: [{ id: 'what', is: 'processes' }],
    group: 'Scheduling'
  },
  {
    id: 'processes',
    name: 'Processes',
    kind: 'text',
    initial: 'A 0 6 2; B 0 8 1; C 0 7 3; D 0 3 4',
    about: 'One per line or separated by semicolons: a name, when it arrives, how long it needs, and how urgent it is.',
    shownWhen: [{ id: 'what', is: 'processes' }],
    group: 'Scheduling'
  },
  {
    id: 'compare',
    name: 'Compare against',
    kind: 'text',
    initial: 'first-come,shortest-job',
    about: 'Other policies to run the same processes through, separated by commas. Leave empty for just the one.',
    shownWhen: [{ id: 'what', is: 'processes' }],
    group: 'Scheduling'
  },
  {
    id: 'references',
    name: 'Pages asked for',
    kind: 'text',
    initial: '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1',
    about: 'The order the pages are referenced in, separated by spaces.',
    shownWhen: [{ id: 'what', is: 'paging' }],
    group: 'Memory'
  },
  {
    id: 'frames',
    name: 'Frames of memory',
    kind: 'integer',
    initial: 3,
    about: 'How many pages fit in memory at once.',
    least: 1,
    most: 32,
    shownWhen: [{ id: 'what', is: 'paging' }],
    group: 'Memory'
  },
  {
    id: 'pagePolicy',
    name: 'What to throw out',
    kind: 'choice',
    initial: 'lru',
    about: 'Which page to evict. The optimal one needs to know the future and cannot be built — it is here as the floor the others are measured against.',
    options: PAGE_REPLACEMENTS.map((one) => ({
      id: one,
      label:
        one === 'lru'
          ? 'least recently used'
          : one === 'fifo'
            ? 'whatever arrived first'
            : one === 'optimal'
              ? 'optimal (needs the future; impossible in reality)'
              : one === 'clock'
                ? 'clock — what real systems do'
                : 'least often used'
    })),
    shownWhen: [{ id: 'what', is: 'paging' }],
    group: 'Memory'
  },
  {
    id: 'locked',
    name: 'Use a lock',
    kind: 'boolean',
    initial: false,
    about: 'Without one, two processes read the same value and one increment is simply lost.',
    shownWhen: [{ id: 'what', is: 'race' }],
    group: 'Sharing'
  },
  {
    id: 'rounds',
    name: 'Increments each',
    kind: 'integer',
    initial: 10,
    about: 'How many times each process adds one.',
    least: 1,
    most: 500,
    shownWhen: [{ id: 'what', is: 'race' }],
    group: 'Sharing'
  },
  {
    id: 'workers',
    name: 'How many processes',
    kind: 'integer',
    initial: 2,
    about: 'More of them lose more.',
    least: 2,
    most: 8,
    shownWhen: [{ id: 'what', is: 'race' }],
    group: 'Sharing'
  }
]

// ---------------------------------------------------------------- the network

const NETWORKING: readonly Declared[] = [
  {
    id: 'what',
    name: 'Show',
    kind: 'choice',
    // The map, because a laboratory should open on the thing it draws. Subnetting is a table of bits, which is
    // useful and is not what anybody opens a network laboratory to look at first.
    initial: 'topology',
    about: 'Which part of networking to look at.',
    options: [
      { id: 'subnet', label: 'addresses — what a prefix actually means' },
      { id: 'topology', label: 'a network, and the route a packet takes through it' },
      { id: 'protocol', label: 'a protocol exchange, message by message' },
      { id: 'congestion', label: 'congestion control, and the sawtooth it produces' },
      { id: 'firewall', label: 'firewall rules, and which of them can never match' }
    ],
    group: 'What to show'
  },
  {
    id: 'address',
    name: 'Address',
    kind: 'text',
    initial: '192.168.1.10',
    about: 'The address to work out the arithmetic for.',
    shownWhen: [{ id: 'what', is: 'subnet' }],
    group: 'Addresses'
  },
  {
    id: 'prefix',
    name: 'Prefix length',
    kind: 'integer',
    initial: 24,
    about: 'How many leading bits are the network. A /31 and a /32 behave differently from everything else, and this will show how.',
    least: 0,
    most: 32,
    shownWhen: [{ id: 'what', is: 'subnet' }],
    group: 'Addresses'
  },
  {
    id: 'splitInto',
    name: 'Split into',
    kind: 'integer',
    initial: 4,
    about: 'How many equal smaller networks to divide the block into. One for no split.',
    least: 1,
    most: 64,
    shownWhen: [{ id: 'what', is: 'subnet' }],
    group: 'Addresses'
  },
  {
    id: 'topology',
    name: 'Network',
    kind: 'choice',
    initial: 'small-office',
    about: 'Which arrangement of machines to look at.',
    options: SHAPES.map((one) => ({ id: one, label: `${one.replace(/-/g, ' ')} — ${SHAPE_ABOUT[one].split('.')[0]}` })),
    shownWhen: [{ id: 'what', is: 'topology' }],
    group: 'Network'
  },
  { id: 'from', name: 'From', kind: 'text', initial: 'pc1', about: 'Which machine the packet starts at.', shownWhen: [{ id: 'what', is: 'topology' }], group: 'Network' },
  { id: 'to', name: 'To', kind: 'text', initial: 'printer', about: 'Where it is going.', shownWhen: [{ id: 'what', is: 'topology' }], group: 'Network' },
  {
    id: 'unplug',
    name: 'Unplug',
    kind: 'text',
    initial: '',
    about: 'Name a device to pull every cable from, and watch the route change — or fail.',
    shownWhen: [{ id: 'what', is: 'topology' }],
    group: 'Network'
  },
  {
    id: 'protocol',
    name: 'Exchange',
    kind: 'choice',
    initial: 'name',
    about: 'Which exchange to follow, message by message.',
    options: [
      { id: 'address', label: 'getting an address — four messages, two round trips' },
      { id: 'name', label: 'looking a name up — the walk down from the root' },
      { id: 'handshake', label: 'opening and closing a connection' },
      { id: 'translation', label: 'many machines sharing one public address' }
    ],
    shownWhen: [{ id: 'what', is: 'protocol' }],
    group: 'Protocols'
  },
  {
    id: 'cached',
    name: 'Already cached',
    kind: 'boolean',
    initial: false,
    about: 'A cached answer takes one step instead of four, which is why the second visit to a site is faster.',
    shownWhen: [{ id: 'what', is: 'protocol' }],
    group: 'Protocols'
  },
  {
    id: 'capacity',
    name: 'What the path holds',
    kind: 'integer',
    initial: 24,
    about: 'How many packets can be in flight before something is dropped.',
    least: 2,
    most: 500,
    shownWhen: [{ id: 'what', is: 'congestion' }],
    group: 'Congestion'
  },
  {
    id: 'congestionRounds',
    name: 'Rounds',
    kind: 'integer',
    initial: 60,
    about: 'How many round trips to simulate.',
    least: 4,
    most: 500,
    shownWhen: [{ id: 'what', is: 'congestion' }],
    group: 'Congestion'
  },
  {
    id: 'randomLoss',
    name: 'Random loss',
    kind: 'number',
    initial: 0,
    about: 'Loss that is nothing to do with congestion, as a wireless link has. The sender cannot tell the difference, which is its central weakness.',
    least: 0,
    most: 0.5,
    step: 0.01,
    places: 2,
    shownWhen: [{ id: 'what', is: 'congestion' }],
    group: 'Congestion'
  }
]

// ---------------------------------------------------------------- images

const IMAGING: readonly Declared[] = [
  {
    id: 'source',
    name: 'Picture',
    kind: 'choice',
    initial: 'checkerboard',
    about: 'Which picture to work on. Each is built to show something particular.',
    options: TEST_PICTURES.map((one) => ({ id: one, label: `${one.replace(/-/g, ' ')} — ${TEST_PICTURE_ABOUT[one].split('.')[0]}` })),
    group: 'Picture'
  },
  { id: 'size', name: 'Size', kind: 'integer', initial: 128, about: 'How many pixels across and down.', least: 16, most: 512, group: 'Picture' },
  {
    id: 'what',
    name: 'Do',
    kind: 'choice',
    initial: 'filter',
    about: 'Which operation to apply. Every one of these is the real arithmetic over the pixels.',
    options: [
      { id: 'filter', label: 'a filter — a real convolution' },
      { id: 'adjust', label: 'an adjustment to every pixel' },
      { id: 'threshold', label: 'a threshold, with the level chosen from the histogram' },
      { id: 'edges', label: 'find the edges' },
      { id: 'regions', label: 'find the separate shapes' }
    ],
    group: 'What to do'
  },
  {
    id: 'filter',
    name: 'Filter',
    kind: 'choice',
    initial: 'gaussian-blur',
    about: 'Which kernel to apply.',
    options: [...KNOWN_KERNELS.map((one) => ({ id: one, label: one.replace(/-/g, ' ') })), { id: 'gaussian', label: 'gaussian blur, of a chosen radius' }],
    shownWhen: [{ id: 'what', is: 'filter' }],
    group: 'Filter'
  },
  {
    id: 'radius',
    name: 'Blur radius',
    kind: 'integer',
    initial: 2,
    about: 'How far the blur reaches. Doubling it costs four times as much.',
    least: 1,
    most: 15,
    shownWhen: [{ id: 'filter', is: 'gaussian' }],
    group: 'Filter'
  },
  {
    id: 'edgeHandling',
    name: 'At the edges',
    kind: 'choice',
    initial: 'extend',
    about: 'What to pretend is outside the picture.',
    options: [
      { id: 'extend', label: 'the edge pixel repeats' },
      { id: 'mirror', label: 'the picture reflects' },
      { id: 'wrap', label: 'the far side wraps round' },
      { id: 'crop', label: 'black, which darkens the border' }
    ],
    shownWhen: [{ id: 'what', is: 'filter' }],
    group: 'Filter'
  },
  {
    id: 'adjustment',
    name: 'Adjustment',
    kind: 'choice',
    initial: 'contrast',
    about: 'What to do to every pixel. The panel counts how much detail was flattened against the ends.',
    options: ADJUSTMENTS.map((one) => ({ id: one, label: one })),
    shownWhen: [{ id: 'what', is: 'adjust' }],
    group: 'Adjust'
  },
  {
    id: 'amount',
    name: 'By how much',
    kind: 'number',
    initial: 1.5,
    about: 'The strength. For posterising it is the number of levels; for a threshold it is the level.',
    least: -255,
    most: 255,
    step: 0.1,
    places: 2,
    shownWhen: [{ id: 'what', is: 'adjust' }],
    group: 'Adjust'
  },
  {
    id: 'thresholdMethod',
    name: 'Choose the level',
    kind: 'choice',
    initial: 'otsu',
    about: 'How to decide where to split. The first finds the split that separates the two groups best, over this image’s own histogram.',
    options: [
      { id: 'otsu', label: 'from the histogram, by separating the groups' },
      { id: 'mean', label: 'the average brightness' },
      { id: 'given', label: 'a level I choose' }
    ],
    shownWhen: [
      { id: 'what', is: 'threshold' },
      { id: 'what', is: 'regions' }
    ],
    group: 'Threshold'
  },
  {
    id: 'level',
    name: 'Level',
    kind: 'integer',
    initial: 128,
    about: 'Everything brighter than this becomes white.',
    least: 0,
    most: 255,
    shownWhen: [{ id: 'thresholdMethod', is: 'given' }],
    group: 'Threshold'
  },
  {
    id: 'connectivity',
    name: 'Shapes touching at a corner',
    kind: 'choice',
    initial: '8',
    about: 'Whether two shapes meeting only at a corner count as one or as two. Neither is right in general, so it is a choice.',
    options: [
      { id: '8', label: 'count as one' },
      { id: '4', label: 'count as two' }
    ],
    shownWhen: [{ id: 'what', is: 'regions' }],
    group: 'Shapes'
  },
  {
    id: 'smallest',
    name: 'Ignore shapes under',
    kind: 'integer',
    initial: 8,
    about: 'Shapes smaller than this many pixels are left out, and the panel says how many were.',
    least: 1,
    most: 10_000,
    shownWhen: [{ id: 'what', is: 'regions' }],
    group: 'Shapes'
  },
  {
    id: 'blurFirst',
    name: 'Blur before finding edges',
    kind: 'boolean',
    initial: true,
    about: 'The gradient of a noisy image is mostly noise. Turn this off on the noise picture and see.',
    shownWhen: [{ id: 'what', is: 'edges' }],
    group: 'Edges'
  },
  {
    id: 'edgeThreshold',
    name: 'Edge threshold',
    kind: 'integer',
    initial: 0,
    about: 'How strong a gradient counts as an edge. Zero works it out from the image, which can mark a whole smooth ramp.',
    least: 0,
    most: 1_000,
    shownWhen: [{ id: 'what', is: 'edges' }],
    group: 'Edges'
  }
]

// ---------------------------------------------------------------- machine learning

const LEARNING: readonly Declared[] = [
  {
    id: 'dataset',
    name: 'Data',
    kind: 'choice',
    initial: 'two-blobs',
    about: 'Which set to learn from. Every one of these is made up, and shaped to show something particular.',
    options: SAMPLE_DATASETS.map((one) => ({ id: one, label: `${one.replace(/-/g, ' ')} — ${DATASET_ABOUT[one].split('.')[0]}` })),
    group: 'Data'
  },
  { id: 'rows', name: 'How many rows', kind: 'integer', initial: 200, about: 'How many examples to generate.', least: 20, most: 5_000, group: 'Data' },
  {
    id: 'holdBack',
    name: 'Hold back',
    kind: 'number',
    initial: 0.25,
    about: 'What fraction to keep out of training and judge the model on. A score on the training data measures memory, not learning.',
    least: 0.05,
    most: 0.9,
    step: 0.05,
    places: 2,
    group: 'Data'
  },
  {
    id: 'model',
    name: 'Model',
    kind: 'choice',
    initial: 'nearest-neighbours',
    about: 'Which model to fit. Each one has something it is bad at, and the panel says what.',
    options: MODEL_KINDS.map((one) => ({ id: one, label: MODEL_FACTS[one].label })),
    group: 'Model'
  },
  {
    id: 'neighbours',
    name: 'How many neighbours',
    kind: 'integer',
    initial: 5,
    about: 'How many of the closest examples get a vote. One means every training row predicts itself perfectly, which is not learning.',
    least: 1,
    most: 50,
    shownWhen: [{ id: 'model', is: 'nearest-neighbours' }],
    group: 'Model'
  },
  {
    id: 'depth',
    name: 'Tree depth',
    kind: 'integer',
    initial: 4,
    about: 'How many questions deep the tree may go. Unlimited, it memorises the training data.',
    least: 1,
    most: 20,
    shownWhen: [{ id: 'model', is: 'decision-tree' }],
    group: 'Model'
  },
  {
    id: 'groups',
    name: 'How many groups',
    kind: 'integer',
    initial: 3,
    about: 'It will find this many whether or not they exist, which is why the number is yours to choose.',
    least: 2,
    most: 20,
    shownWhen: [{ id: 'model', is: 'k-means' }],
    group: 'Model'
  },
  {
    id: 'degree',
    name: 'Curve degree',
    kind: 'integer',
    initial: 1,
    about: 'One is a straight line. A degree close to the number of points fits the noise rather than the data.',
    least: 1,
    most: 8,
    shownWhen: [{ id: 'model', is: 'linear' }],
    group: 'Model'
  },
  {
    id: 'rate',
    name: 'Learning rate',
    kind: 'number',
    initial: 0.1,
    about: 'How large a step each round takes. Too large and the loss goes up instead of down.',
    least: 0.0001,
    most: 10,
    step: 0.01,
    places: 4,
    shownWhen: [{ id: 'model', is: 'logistic' }],
    group: 'Model'
  },
  {
    id: 'iterations',
    name: 'Rounds',
    kind: 'integer',
    initial: 500,
    about: 'How many times to adjust the weights.',
    least: 1,
    most: 5_000,
    shownWhen: [{ id: 'model', is: 'logistic' }],
    group: 'Model'
  },
  {
    id: 'folds',
    name: 'Check over how many splits',
    kind: 'integer',
    initial: 5,
    about: 'Train and score several times over different splits. The spread matters more than the average. Nought to skip it.',
    least: 0,
    most: 20,
    group: 'Checking'
  },
  {
    id: 'alsoComponents',
    name: 'Also show the main directions of variation',
    kind: 'boolean',
    initial: false,
    about: 'Finds the directions the data varies in most, which says whether it is really as many-dimensional as it looks.',
    group: 'Checking'
  },
  { id: 'seed', name: 'Seed', kind: 'integer', initial: 7, about: 'The same seed gives the same data and the same fit.', least: 0, most: 2_147_483_647, group: 'Checking' }
]

// ---------------------------------------------------------------- neural networks

const NEURAL: readonly Declared[] = [
  {
    id: 'task',
    name: 'Problem',
    kind: 'choice',
    initial: 'xor',
    about: 'What to learn. Exclusive-or is the one that cannot be learned without a hidden layer, however long it trains.',
    options: PROBLEMS.map((one) => ({ id: one, label: `${one} — ${PROBLEM_ABOUT[one].replace(/\*\*/g, '').split('.')[0]}` })),
    group: 'Problem'
  },
  { id: 'rows', name: 'How many examples', kind: 'integer', initial: 200, about: 'How many points to learn from.', least: 4, most: 2_000, group: 'Problem' },
  {
    id: 'hidden',
    name: 'Hidden layers',
    kind: 'text',
    initial: '6',
    about: 'Neurons in each hidden layer, separated by commas. Empty means none at all, which is what cannot learn exclusive-or.',
    group: 'Network'
  },
  {
    id: 'activation',
    name: 'Hidden activation',
    kind: 'choice',
    initial: 'tanh',
    about: 'The curve between the layers. Without one, depth buys nothing whatever.',
    options: ACTIVATIONS.map((one) => ({ id: one, label: `${ACTIVATION_FACTS[one].label} — ${ACTIVATION_FACTS[one].about.split('.')[0]}` })),
    group: 'Network'
  },
  {
    id: 'outputActivation',
    name: 'Output activation',
    kind: 'choice',
    initial: 'sigmoid',
    about: 'Sigmoid for a class, none for a number.',
    options: ACTIVATIONS.map((one) => ({ id: one, label: ACTIVATION_FACTS[one].label })),
    group: 'Network'
  },
  {
    id: 'rate',
    name: 'Learning rate',
    kind: 'number',
    initial: 0.1,
    about: 'How large a step each update takes. Too large and the gradients explode; too small and nothing moves.',
    least: 0.00001,
    most: 10,
    step: 0.01,
    places: 5,
    group: 'Training'
  },
  { id: 'steps', name: 'Steps', kind: 'integer', initial: 1_000, about: 'How many updates to make.', least: 1, most: 20_000, group: 'Training' },
  {
    id: 'batch',
    name: 'Examples per step',
    kind: 'integer',
    initial: 32,
    about: 'A small batch gives a noisy loss curve that often ends up lower; a large one a smooth curve that can stall.',
    least: 1,
    most: 512,
    group: 'Training'
  },
  {
    id: 'momentum',
    name: 'Momentum',
    kind: 'number',
    initial: 0.9,
    about: 'How much of the last step to carry into the next. Helps it through a flat patch.',
    least: 0,
    most: 0.99,
    step: 0.01,
    places: 2,
    group: 'Training'
  },
  {
    id: 'checkTheGradients',
    name: 'Prove the gradients are right',
    kind: 'boolean',
    initial: false,
    about: 'Nudges every weight and measures how the loss moves, then compares. Slow, and the only way to know a gradient is correct.',
    group: 'Training'
  },
  { id: 'seed', name: 'Seed', kind: 'integer', initial: 3, about: 'The same seed gives the same starting weights and the same run.', least: 0, most: 2_147_483_647, group: 'Training' }
]

export const PHASE5_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const out: Record<string, ParameterSet> = {}
    const sets: readonly (readonly [string, readonly Declared[]])[] = [
      ['logic-lab', LOGIC],
      ['processor-lab', PROCESSOR],
      ['os-lab', SCHEDULING],
      ['network-lab', NETWORKING],
      ['image-lab', IMAGING],
      ['learning-lab', LEARNING],
      ['neural-lab', NEURAL]
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

export const PHASE5_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  app({
    id: 'logic-lab',
    name: 'Digital Logic Laboratory',
    summary: 'Build a circuit from gates and watch the signals settle through it.',
    domain: 'computing',
    icon: 'toggle-left',
    aliases: ['logic gates', 'digital logic', 'truth table', 'adder', 'flip flop', 'latch', 'karnaugh', 'boolean'],
    tags: [
      'logic', 'gate', 'and', 'or', 'not', 'nand', 'nor', 'xor', 'truth table', 'boolean', 'adder', 'half adder',
      'full adder', 'multiplexer', 'decoder', 'latch', 'flip flop', 'counter', 'shift register', 'sequential',
      'combinational', 'propagation', 'karnaugh', 'minterm', 'simplify'
    ],
    capabilities: [
      { id: 'simulateLogicGate', summary: 'evaluate a circuit of gates and show what every wire settles to' },
      { id: 'buildTruthTable', summary: 'produce a truth table by running the circuit for every input combination' },
      { id: 'simplifyLogic', summary: 'reduce a function to the smallest expression that does the same thing' },
      { id: 'simulateSequential', summary: 'run a clocked circuit such as a counter or a shift register, tick by tick' }
    ],
    surface: { kind: 'native', ref: 'LogicLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE5_PARAMETERS['logic-lab']),
    actions: STEPPING,
    accepts: ['numbers'],
    produces: ['table', 'numbers'],
    permissions: ['compute'],
    persists: true,
    engine: 'logic',
    limitations: [
      'Gates are ideal: no delay in time, no rise or fall time, no fan-out limit and no power supply. Delay is counted in gate levels, not nanoseconds.',
      'Every wire is on or off. There is no high-impedance state and nothing analogue in between.',
      'Glitches are not shown. A network can momentarily output the wrong value while it settles, and only the settled value is reported.',
      'The circuits are the twelve it ships with. You cannot draw your own here.'
    ]
  }),
  app({
    id: 'processor-lab',
    name: 'Processor Laboratory',
    summary: 'Run a program and watch it move through a pipeline, with the stalls where they really are.',
    domain: 'computing',
    icon: 'cpu',
    aliases: ['cpu', 'processor', 'assembly', 'pipeline', 'cache', 'registers', 'instruction', 'computer architecture'],
    tags: [
      'cpu', 'processor', 'architecture', 'assembly', 'instruction', 'register', 'alu', 'pipeline', 'fetch', 'decode',
      'execute', 'writeback', 'hazard', 'stall', 'forwarding', 'branch', 'cache', 'hit rate', 'miss', 'associativity',
      'memory', 'opcode', 'trace'
    ],
    capabilities: [
      { id: 'simulateCpu', summary: 'assemble and run a program, showing the registers and memory at every step' },
      { id: 'tracePipeline', summary: 'schedule the instructions through five stages and show where each one stalled' },
      { id: 'simulateCache', summary: 'run the program’s memory accesses through a cache and report what it actually hit' }
    ],
    surface: { kind: 'native', ref: 'ProcessorLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE5_PARAMETERS['processor-lab']),
    actions: STEPPING,
    accepts: ['numbers'],
    produces: ['table', 'numbers'],
    permissions: ['compute'],
    persists: true,
    engine: 'processor',
    limitations: [
      'A teaching instruction set: small and regular, with no floating point and no privileged instructions. It is not any processor that shipped.',
      'Costs are in cycles, never nanoseconds. Turning cycles into time needs a clock rate and a memory latency, neither of which is modelled.',
      'The textbook five stages, in order, one instruction at a time. No out-of-order execution, no register renaming and no superscalar issue.',
      'Memory answers in one cycle whether the cache hit or missed. The cache reports what it would have done and the cycle count does not charge for a miss.',
      'There is no operating system, no interrupts and no virtual memory. A bad address stops the program rather than trapping.'
    ]
  }),
  app({
    id: 'os-lab',
    name: 'Operating System Laboratory',
    summary: 'Schedule processes, page memory in and out, and see a deadlock happen.',
    domain: 'computing',
    icon: 'layers',
    aliases: ['operating system', 'scheduler', 'scheduling', 'round robin', 'paging', 'deadlock', 'banker', 'mutex', 'race condition'],
    tags: [
      'operating system', 'process', 'scheduling', 'scheduler', 'round robin', 'first come', 'shortest job',
      'priority', 'preemptive', 'quantum', 'gantt', 'starvation', 'turnaround', 'waiting time', 'memory', 'paging',
      'page fault', 'page replacement', 'lru', 'fifo', 'belady', 'deadlock', 'banker', 'safe state', 'mutex', 'lock',
      'race condition', 'synchronisation'
    ],
    capabilities: [
      { id: 'scheduleProcesses', summary: 'run a scheduling policy over a set of processes and show who ran when' },
      { id: 'comparePolicies', summary: 'run several scheduling policies over identical work and compare what each cost' },
      { id: 'simulatePaging', summary: 'run a page-replacement policy over a reference string and count the faults' },
      { id: 'checkDeadlock', summary: 'look for a circular wait, and say whether a state can still finish safely' },
      { id: 'showRaceCondition', summary: 'show what two processes sharing a counter lose without a lock, and gain with one' }
    ],
    surface: { kind: 'native', ref: 'OsLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE5_PARAMETERS['os-lab']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['table', 'series'],
    permissions: ['compute'],
    persists: true,
    engine: 'scheduling',
    limitations: [
      'Time is in ticks, not seconds, and a context switch costs nothing. A real one costs microseconds, which makes a very small slice worse than it looks here.',
      'Processes use the processor and nothing else. Nothing ever blocks waiting for a disk or a network.',
      'Every process declares exactly how long it needs. Real schedulers do not know that, which is why shortest-job-first cannot actually be built.',
      'Memory is pages and frames with no translation cost: no translation cache, no multi-level page table, no copy-on-write.',
      'Starvation is shown rather than prevented. Real systems raise a waiting process’s priority over time and these policies deliberately do not.'
    ]
  }),
  app({
    id: 'network-lab',
    name: 'Network Laboratory',
    summary: 'Work out addresses, route a packet through a network, and follow a protocol message by message.',
    domain: 'computing',
    icon: 'network',
    aliases: ['networking', 'network', 'subnet', 'subnetting', 'ip address', 'router', 'packet', 'tcp', 'dns', 'dhcp', 'nat', 'firewall'],
    tags: [
      'network', 'networking', 'ip', 'ipv4', 'address', 'subnet', 'subnetting', 'mask', 'cidr', 'prefix', 'broadcast',
      'router', 'switch', 'topology', 'route', 'packet', 'latency', 'bandwidth', 'tcp', 'handshake', 'congestion',
      'window', 'dns', 'dhcp', 'nat', 'firewall', 'port', 'private address'
    ],
    capabilities: [
      { id: 'workOutSubnet', summary: 'work out the network, broadcast and host range for an address and prefix' },
      { id: 'simulateNetwork', summary: 'build a network and find the route a packet takes through it' },
      { id: 'followProtocol', summary: 'follow a protocol exchange message by message, with the fields that matter' },
      { id: 'showCongestion', summary: 'show how a sender finds out how much a path can carry, and the sawtooth that produces' },
      { id: 'checkFirewall', summary: 'apply firewall rules to packets and find the rules that can never match' }
    ],
    surface: { kind: 'native', ref: 'NetworkLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE5_PARAMETERS['network-lab']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['table', 'series'],
    permissions: ['compute'],
    persists: true,
    engine: 'networking',
    limitations: [
      'Nothing here touches a real network. Every address, route and packet is made up inside the model.',
      'IPv4 only. IPv6 addressing is a different arithmetic and is not modelled.',
      'Delay is the sum of the link delays. Real latency also includes time spent in queues, which grows sharply as a link fills, and that is not modelled.',
      'The congestion control is the textbook scheme, closest to TCP Tahoe. A modern stack recovers from a loss far better than this does.',
      'The protocol exchanges are the message sequences and the fields that matter, not the bytes on the wire.'
    ]
  }),
  app({
    id: 'image-lab',
    name: 'Image Laboratory',
    summary: 'Apply a real convolution to an image and see what each filter actually does to the pixels.',
    domain: 'computing',
    icon: 'image',
    aliases: ['image processing', 'image', 'filter', 'blur', 'convolution', 'edge detection', 'sobel', 'histogram', 'threshold'],
    tags: [
      'image', 'image processing', 'pixel', 'convolution', 'kernel', 'filter', 'blur', 'gaussian', 'sharpen',
      'edge detection', 'sobel', 'laplacian', 'gradient', 'histogram', 'brightness', 'contrast', 'gamma',
      'threshold', 'otsu', 'grayscale', 'segmentation', 'connected components', 'region'
    ],
    capabilities: [
      { id: 'processImage', summary: 'apply a real convolution or adjustment to an image, pixel by pixel' },
      { id: 'detectEdges', summary: 'find the edges in an image from the gradient, with their direction' },
      { id: 'findShapes', summary: 'find the separate shapes in an image and measure each one' },
      { id: 'showHistogram', summary: 'count the brightness of every pixel and say what the distribution means' }
    ],
    surface: { kind: 'native', ref: 'ImageLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE5_PARAMETERS['image-lab']),
    actions: RECOMPUTE,
    accepts: ['image'],
    produces: ['image', 'table'],
    permissions: ['compute'],
    persists: true,
    engine: 'imaging',
    limitations: [
      'No object recognition of any kind. Finding separate shapes is flood fill over a threshold, which says where things are and nothing about what they are.',
      'Eight bits per channel, worked on as stored rather than in linear light. Strictly a blur should be done on linearised values; almost no software does, and this does not either.',
      'Convolution is the straightforward sum, which is exact and gets slow for a large kernel. A real library would use a different method.',
      'Edge detection is a gradient and a threshold. A full detector also thins edges to one pixel and follows weak edges connected to strong ones, neither of which is done.'
    ]
  }),
  app({
    id: 'learning-lab',
    name: 'Machine Learning Laboratory',
    summary: 'Fit a model to data and find out how well it does on data it never saw.',
    domain: 'computing',
    icon: 'scatter-chart',
    aliases: ['machine learning', 'model', 'classifier', 'regression', 'clustering', 'k-means', 'decision tree', 'overfitting', 'training'],
    tags: [
      'machine learning', 'model', 'train', 'training', 'classifier', 'classification', 'regression', 'prediction',
      'nearest neighbours', 'knn', 'decision tree', 'logistic', 'linear regression', 'k-means', 'clustering',
      'accuracy', 'precision', 'recall', 'f1', 'confusion matrix', 'overfitting', 'cross validation', 'split',
      'feature', 'dataset', 'scaling', 'principal components', 'pca'
    ],
    capabilities: [
      { id: 'trainModel', summary: 'fit a model to data and report what it learned' },
      { id: 'evaluateModel', summary: 'score a model on data it never saw, with the baseline beside it' },
      { id: 'checkOverfitting', summary: 'compare how a model does on what it learned from against what it did not' },
      { id: 'findComponents', summary: 'find the directions the data varies in most' }
    ],
    surface: { kind: 'native', ref: 'LearningLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE5_PARAMETERS['learning-lab']),
    actions: RECOMPUTE,
    accepts: ['table', 'numbers'],
    produces: ['table', 'series'],
    permissions: ['compute'],
    persists: true,
    engine: 'learning',
    limitations: [
      'Nothing is pre-trained and nothing is downloaded. Every model here is fitted in this session on the data you give it.',
      'The classical models only: nearest neighbours, a decision tree, logistic and linear regression, and k-means. No ensemble, no gradient boosting, no support vector machine.',
      'The sample datasets are generated from a fixed sequence. They are shaped like real data so the methods have something to work on, and none of the numbers in them measures anything.',
      'Every score is measured on rows held back from training. A score on the training data is shown only beside the held-out one, to show the gap.'
    ]
  }),
  app({
    id: 'neural-lab',
    name: 'Neural Network Laboratory',
    summary: 'Build a network, train it, and watch the boundary it learns take shape.',
    domain: 'computing',
    icon: 'brain',
    aliases: ['neural network', 'neural net', 'deep learning', 'backpropagation', 'gradient descent', 'perceptron', 'activation', 'xor'],
    tags: [
      'neural network', 'neural', 'network', 'deep learning', 'layer', 'neuron', 'weight', 'bias', 'activation',
      'relu', 'sigmoid', 'tanh', 'backpropagation', 'gradient', 'gradient descent', 'loss', 'training', 'epoch',
      'batch', 'momentum', 'learning rate', 'overfitting', 'vanishing gradient', 'dead neuron', 'xor', 'decision boundary'
    ],
    capabilities: [
      { id: 'trainNeuralNetwork', summary: 'build a network and train it by gradient descent, recording every step' },
      { id: 'showDecisionBoundary', summary: 'draw the boundary a trained network learned' },
      { id: 'checkGradients', summary: 'prove the gradients are right by nudging every weight and measuring the loss' }
    ],
    surface: { kind: 'native', ref: 'NeuralLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'pause',
    parameters: Object.keys(PHASE5_PARAMETERS['neural-lab']),
    actions: STEPPING,
    accepts: ['table', 'numbers'],
    produces: ['series', 'numbers'],
    permissions: ['compute'],
    persists: true,
    engine: 'neural',
    limitations: [
      'A fully connected feed-forward network and nothing else. No convolution, no recurrence, no attention, no normalisation layers and no dropout.',
      'Trained by gradient descent with momentum. There is no adaptive optimiser, no learning-rate schedule and no weight decay.',
      'Everything runs on one thread in this process. The sizes allowed are enough to watch something learn and nowhere near enough to train anything useful.',
      'Nothing is pre-trained and nothing is downloaded. Every weight started as a small random number in this session.',
      'The loss is squared error throughout, including for classification, where cross-entropy would train faster.'
    ]
  })
])

export const PHASE5_BY_ID: Readonly<Record<string, NativeAppManifest>> = Object.freeze(
  Object.fromEntries(PHASE5_CATALOGUE.map((one) => [one.id, one]))
)
