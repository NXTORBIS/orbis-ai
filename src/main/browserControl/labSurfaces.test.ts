import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CommandResult } from '../../shared/browserControl.ts'
import type { SurfaceDescriptor, SurfaceOutcome } from '../../shared/surfaces.ts'
import { answerSurfaceCall } from '../../renderer/src/lib/surfaces/answer.ts'
import { forgetSurfaces, registerSurface, surfacesDrawn } from '../../renderer/src/lib/surfaces/registry.ts'
import { algovizAnimationSurface, algovizSurface, type AlgovizAlgorithm, type AlgovizOptions, type AlgovizPlayback, type AlgovizScreen, type AlgovizStep } from '../../renderer/src/components/labs/algovizSurfaces.ts'
import { toolkitSurface } from '../../renderer/src/components/toolkit/toolkitSurface.ts'
import { labViewSurface, nativeAppSurface, type LabParameter, type NativeInstance } from '../../renderer/src/components/native/labSurfaces.ts'
import { labsCatalogueSurface, type LabsEntry } from '../../renderer/src/components/labs/labsSurfaces.ts'
import { shellSurface, WINDOW_SCREENS } from '../../renderer/src/components/shellSurfaces.ts'
import { CHAT, type NavState } from '../../shared/navigation.ts'
import { BrowserControl } from './registry.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'

/**
 * The laboratories, driven end to end: a capability in the main process, the bridge, the register in the window, and
 * each laboratory's own getters, setters and handlers.
 *
 * The one hop that needs a running application -- `control:window-run` between the two processes -- is replaced by a
 * function that turns everything into text and back, which is what that hop does to a value. Everything else is the
 * real thing, including **the real algorithms**: the ninety-two generators the Algorithm Visualizer ships with are
 * imported and run, so the steps, the counts and the descriptions in these assertions are the laboratory's own and
 * not a fixture's idea of them.
 *
 * React is not here, so each screen is stood up the way React stands it up: state in a variable, setters that change
 * it and then say the screen has drawn, and a page that is registered while it is open and taken away when it is not.
 */

/** Everything over the wire is text and back, because that is what the hop between the two processes does to it. */
const overTheWire = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T

interface Registry {
  ALL_ALGORITHMS: AlgovizAlgorithm[]
  ALGO_MAP: Record<string, AlgovizAlgorithm & { generate(data: unknown, options: AlgovizOptions): { steps: AlgovizStep[]; code: string[] } }>
  CATEGORIES: string[]
}

/*
 * The laboratory's own registry, imported through a path in a variable.
 *
 * It is JavaScript -- the laboratory was written that way and this does not rewrite it -- and the type checker is not
 * set up to read JavaScript. A specifier it cannot see at compile time keeps that true while the test still runs the
 * real thing, which is the whole point of importing it rather than writing a pretend bubble sort here.
 */
const WHERE_THE_ALGORITHMS_ARE = '../../renderer/src/cs/algoviz/registry.js'
const registry = (await import(WHERE_THE_ALGORITHMS_ARE)) as Registry

// ---------------------------------------------------------------- the Algorithm Visualizer, as React holds it

/** The laboratory's playback engine, standing in for `usePlayback` with the same rules. */
function playback(steps: () => readonly AlgovizStep[] | null, drawn: () => void): AlgovizPlayback {
  const held = { idx: 0, playing: false, speed: 1 }
  const total = (): number => steps()?.length ?? 0
  const change = (next: Partial<typeof held>): void => {
    Object.assign(held, next)
    drawn()
  }
  return {
    get idx() {
      return held.idx
    },
    get playing() {
      return held.playing
    },
    get speed() {
      return held.speed
    },
    get total() {
      return total()
    },
    get atEnd() {
      return held.idx >= total() - 1
    },
    // Changing the speed while it is playing never restarts the run, which is the laboratory's own behaviour.
    setSpeed: (value) => change({ speed: value }),
    play: () => change({ playing: true }),
    pause: () => change({ playing: false }),
    stop: () => change({ playing: false, idx: 0 }),
    restart: () => change({ playing: false, idx: 0 }),
    toStart: () => change({ idx: 0 }),
    toEnd: () => change({ playing: false, idx: Math.max(0, total() - 1) }),
    next: () => change({ playing: false, idx: Math.min(total() - 1, held.idx + 1) }),
    prev: () => change({ playing: false, idx: Math.max(0, held.idx - 1) }),
    jump: (index) => change({ idx: Math.max(0, Math.min(total() - 1, index)) })
  }
}

/** How the laboratory reads its input box before a run. The same two lines it uses itself. */
const readInput = (text: string, inputType: string | undefined): unknown => {
  if (inputType === 'string') return text
  if (inputType === 'none') return []
  return text
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
}

interface Lab {
  screen: AlgovizScreen
  held: { algorithm: string; category: string; search: string; input: string; options: AlgovizOptions; run: { steps: AlgovizStep[]; code: string[] } | null; favourite: boolean; fullScreen: boolean; comparing: boolean; picked: string[]; comparison: { id: string; name: string; steps: AlgovizStep[] }[] }
}

/** The Algorithm Visualizer's own state and handlers, with the real generators behind them. */
function visualizer(parent: string | null): Lab {
  const held: Lab['held'] = {
    algorithm: 'bubbleSort',
    category: 'All',
    search: '',
    input: '5,3,8,1,9,2,7,4,6',
    options: { size: 10, min: 1, max: 99, seed: 1, preset: 'random' },
    run: null,
    favourite: false,
    fullScreen: false,
    comparing: false,
    picked: [],
    comparison: []
  }
  const drawn = (): void => surfacesDrawn()
  const chosen = (): Registry['ALGO_MAP'][string] => registry.ALGO_MAP[held.algorithm]

  /** The Run button: the laboratory works out every step, or puts the fault in the only step there is. */
  const run = (data?: unknown, options?: AlgovizOptions): void => {
    const algorithm = chosen()
    const input = data === undefined ? readInput(held.input, algorithm.inputType) : data
    try {
      held.run = algorithm.generate(input, options ?? held.options)
    } catch (err) {
      held.run = { steps: [{ desc: `Error: ${err instanceof Error ? err.message : String(err)}`, stats: {} }], code: [] }
    }
    // The playback puts itself back to the first step whenever the steps are replaced.
    pb.stop()
    drawn()
  }

  const pb = playback(() => held.run?.steps ?? null, drawn)

  const screen: AlgovizScreen = {
    parent,
    algorithms: registry.ALL_ALGORITHMS,
    categories: registry.CATEGORIES,
    algorithm: () => held.algorithm,
    selectAlgorithm: (id) => {
      held.algorithm = id
      held.comparing = false
      held.comparison = []
      drawn()
    },
    search: () => held.search,
    setSearch: (text) => {
      held.search = text
      drawn()
    },
    category: () => held.category,
    setCategory: (name) => {
      held.category = name
      drawn()
    },
    input: () => held.input,
    setInput: (text) => {
      held.input = text
      drawn()
    },
    numbers: () => readInput(held.input, 'array') as number[],
    options: () => held.options,
    setOptions: (next) => {
      held.options = next
      // The laboratory rewrites the box whenever a generator setting changes.
      if (chosen().inputType === 'array') {
        const rng = (seed: number): (() => number) => {
          let s = seed
          return () => {
            s = (s * 1664525 + 1013904223) | 0
            return ((s >>> 0) % 100000) / 100000
          }
        }
        const roll = rng(next.seed)
        held.input = Array.from({ length: next.size }, () => next.min + Math.floor(roll() * Math.max(1, next.max - next.min))).join(',')
      }
      drawn()
    },
    favourite: () => held.favourite,
    toggleFavourite: () => {
      held.favourite = !held.favourite
      drawn()
    },
    fullScreen: () => held.fullScreen,
    setFullScreen: (on) => {
      held.fullScreen = on
      drawn()
    },
    comparing: () => held.comparing,
    setComparing: (on) => {
      held.comparing = on
      drawn()
    },
    picked: () => held.picked,
    setPicked: (ids) => {
      held.picked = [...ids]
      drawn()
    },
    compare: () => {
      const data = readInput(held.input, chosen().inputType)
      held.comparison = held.picked.map((id) => {
        const one = registry.ALGO_MAP[id]
        return { id, name: one.name, steps: one.generate(data, held.options).steps }
      })
      drawn()
    },
    comparison: () => held.comparison,
    run: () => run(),
    randomizeAndRun: () => {
      const next = { ...held.options, seed: 4242, preset: 'random' }
      screen.setOptions(next)
      run(readInput(held.input, 'array'), next)
    },
    steps: () => held.run?.steps ?? null,
    playback: pb,
    listed: () => registry.ALL_ALGORITHMS.filter((one) => held.category === 'All' || one.category === held.category).length
  }
  return { screen, held }
}

// ---------------------------------------------------------------- a world with the Toolkit in it

interface World {
  control: BrowserControl
  toolkit: { open: string | null; search: string; category: string; closed: boolean }
  lab(): Lab | null
  asks: string[]
  approve: boolean
}

/** The Toolkit, with the Algorithm Visualizer registering itself when it is the tool that is open. */
function toolkitWorld(): World {
  forgetSurfaces()
  const toolkit = { open: null as string | null, search: '', category: 'all', closed: false }
  const tools = [
    { id: 'algorithm', label: 'Algorithm Visualizer', desc: 'Step-by-step sorting visualizations.', categoryId: 'dev' },
    { id: 'base64', label: 'Base64 Encoder', categoryId: 'dev' },
    { id: 'colour', label: 'Colour Converter', categoryId: 'design' }
  ]
  let lab: Lab | null = null
  let takeAway: (() => void) | null = null

  const openLab = (): void => {
    if (takeAway) return
    const made = visualizer('toolkit')
    lab = made
    takeAway = registerSurface(() => algovizSurface(made.screen))
    const alsoTheAnimation = registerSurface(() => algovizAnimationSurface(made.screen, 'toolkit/algorithm-visualizer'))
    const both = takeAway
    takeAway = () => {
      both()
      alsoTheAnimation()
    }
    surfacesDrawn()
  }
  const closeLab = (): void => {
    takeAway?.()
    takeAway = null
    lab = null
    surfacesDrawn()
  }

  registerSurface(() =>
    toolkitSurface({
      tools,
      categories: [
        { id: 'dev', label: 'Developer' },
        { id: 'design', label: 'Design' }
      ],
      loaded: () => true,
      failed: () => '',
      open: () => toolkit.open,
      openTool: (id) => {
        toolkit.open = id
        if (id === 'algorithm') openLab()
        else closeLab()
        surfacesDrawn()
      },
      search: () => toolkit.search,
      setSearch: (text) => {
        toolkit.search = text
        surfacesDrawn()
      },
      category: () => toolkit.category,
      setCategory: (id) => {
        toolkit.category = id
        surfacesDrawn()
      },
      favourites: () => [],
      showing: () => tools.length,
      close: () => {
        toolkit.closed = true
        closeLab()
      }
    })
  )

  const asks: string[] = []
  const state = { approve: true }
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })

  return {
    control,
    toolkit,
    lab: () => lab,
    asks,
    get approve() {
      return state.approve
    },
    set approve(value: boolean) {
      state.approve = value
    }
  }
}

const run = (world: { control: BrowserControl; asks: string[]; approve: boolean }, capability: string, params: Record<string, unknown>, source: 'user' | 'orion' = 'user'): Promise<CommandResult> =>
  world.control.execute(
    { capability, params, source },
    {
      confirm: async (request) => {
        world.asks.push(request.action)
        return world.approve
      }
    }
  )

const outcome = (result: CommandResult): SurfaceOutcome => result.data as SurfaceOutcome

// ---------------------------------------------------------------- the sentence this was built for

test('the whole sentence: open the visualizer, choose Sorting and Bubble Sort, set the speed and the array, and start it', async () => {
  const world = toolkitWorld()

  // Nothing is open inside the Toolkit yet, and the Toolkit says which of its tools can be reached.
  const shelf = await run(world, 'screen.tree', { depth: 0 })
  assert.deepEqual((shelf.data as { surfaces: SurfaceDescriptor[] }).surfaces.map((one) => one.path), ['toolkit'])
  assert.deepEqual((shelf.data as { surfaces: SurfaceDescriptor[] }).surfaces[0].possibleChildren?.map((one) => one.id), ['algorithm-visualizer'])

  // "enter Algorithm Visualizer" -- the walk opens the tool nobody named by its id.
  const entered = await run(world, 'screen.goTo', { path: 'toolkit/Algorithm Visualizer' })
  assert.equal(entered.ok, true, entered.error?.message)
  assert.deepEqual((entered.data as { opened: string[] }).opened, ['toolkit/algorithm-visualizer'])
  assert.equal(world.toolkit.open, 'algorithm')

  // "open Sorting Algorithms" -- the category tab, by the word on it.
  const sorting = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/category', value: 'Sorting' })
  assert.equal(sorting.ok, true, sorting.error?.message)
  assert.equal(world.lab()?.held.category, 'Sorting')

  // "select Bubble Sort" -- by the name on screen, not the id in the code.
  const chosen = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/algorithm', value: 'Bubble Sort' })
  assert.equal(chosen.ok, true, chosen.error?.message)
  assert.equal(world.lab()?.held.algorithm, 'bubbleSort')

  // "open its animation settings" -- a panel inside the tool, reached by what it is called.
  const animation = await run(world, 'screen.goTo', { path: 'toolkit/algorithm-visualizer/animation settings' })
  assert.equal(animation.ok, true, animation.error?.message)
  assert.deepEqual(animation.data, { path: 'toolkit/algorithm-visualizer/animation', opened: [], alreadyThere: true })

  // "set the speed to 0.5x"
  const speed = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/animation/speed', value: 0.5 })
  assert.equal(speed.ok, true, speed.error?.message)
  assert.equal(world.lab()?.screen.playback.speed, 0.5)
  assert.match(speed.verification?.detail ?? '', /Speed is now 0\.5/)

  // "change the array to [9, 4, 7, 2, 1]" -- a list, written into the box the way the laboratory writes one.
  const array = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/array', value: [9, 4, 7, 2, 1] })
  assert.equal(array.ok, true, array.error?.message)
  assert.equal(world.lab()?.held.input, '9,4,7,2,1')
  assert.equal(outcome(array).status, 'completed')

  // "and start the visualization" -- the Run button and then Play, with the real generator behind it.
  const started = await run(world, 'screen.do', { path: 'toolkit/algorithm-visualizer/start' })
  assert.equal(started.ok, true, started.error?.message)
  assert.equal(outcome(started).status, 'completed')
  assert.equal(world.lab()?.screen.playback.playing, true)
  assert.equal(world.lab()?.held.run?.steps.length, 20, 'the real Bubble Sort takes twenty steps over five numbers')
  assert.match(started.verification?.detail ?? '', /Bubble Sort is running: step 1 of 20, at 0\.5× speed\./)

  // And the laboratory says what it is doing, with the counts its own statistics panel shows.
  const doing = await run(world, 'screen.state', { path: 'toolkit/algorithm-visualizer' })
  const said = (doing.data as { state: { activity: string; detail: string; progress?: number; values: Record<string, unknown> } }).state
  assert.equal(said.activity, 'running')
  assert.equal(said.detail, 'Compare A[0]=9 and A[1]=4')
  assert.equal(said.progress, 0)
  assert.equal(said.values.steps, 20)
  assert.equal(said.values.algorithm, 'Bubble Sort')
  assert.deepEqual(said.values.counts, { comparisons: 1, swaps: 0, assignments: 0, accesses: 2, reads: 2, writes: 0, recursiveCalls: 0, queueOps: 0, stackOps: 0, nodeVisits: 0, edgeTraversals: 0, heapOps: 0 })
})

test('a speed the laboratory does not have is refused with the range, and nothing is touched', async () => {
  const world = toolkitWorld()
  await run(world, 'screen.goTo', { path: 'toolkit/algorithm-visualizer' })

  const tooFast = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/animation/speed', value: 500 })
  assert.equal(tooFast.ok, false)
  assert.equal(tooFast.error?.code, 'invalid-params')
  assert.match(tooFast.error?.message ?? '', /at most 128/)
  assert.equal(world.lab()?.screen.playback.speed, 1, 'nothing was set')

  // The range came from the laboratory's own speeds rather than from anything written here.
  const reading = await run(world, 'screen.read', { path: 'toolkit/algorithm-visualizer/animation/speed' })
  assert.deepEqual(
    { min: (reading.data as { min: number }).min, max: (reading.data as { max: number }).max },
    { min: 0.1, max: 128 }
  )
})

test('the step and the playing switch say what has to happen first, until something has been worked out', async () => {
  const world = toolkitWorld()
  await run(world, 'screen.goTo', { path: 'toolkit/algorithm-visualizer' })

  const tooSoon = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/animation/step', value: 4 })
  assert.equal(tooSoon.ok, false)
  assert.match(tooSoon.error?.message ?? '', /Run the algorithm first/)

  // The reading says it could not be read, with the reason -- never a 0 that nobody chose.
  const reading = await run(world, 'screen.read', { path: 'toolkit/algorithm-visualizer/animation/step' })
  assert.equal((reading.data as { readable: boolean }).readable, false)
  assert.equal((reading.data as { value: unknown }).value, null)
  assert.match((reading.data as { note?: string }).note ?? '', /no step to show/)

  // Run it, and the same two work.
  const ran = await run(world, 'screen.do', { path: 'toolkit/algorithm-visualizer/run' })
  assert.equal(ran.ok, true, ran.error?.message)
  assert.match(ran.verification?.detail ?? '', /Bubble Sort worked out \d+ steps\./)

  const stepped = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/animation/step', value: 4 })
  assert.equal(stepped.ok, true, stepped.error?.message)
  assert.equal(world.lab()?.screen.playback.idx, 3, 'the fourth step, counted the way the timeline counts it')
})

test('the input control that does not apply to this algorithm says which one does', async () => {
  const world = toolkitWorld()
  await run(world, 'screen.goTo', { path: 'toolkit/algorithm-visualizer' })

  // Bubble Sort runs on numbers, so there is no text to set.
  const asText = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/text', value: 'AABAA' })
  assert.equal(asText.ok, false)
  assert.match(asText.error?.message ?? '', /works on a list of numbers.*Set “array” instead/s)

  // A string algorithm, and the two swap over.
  const matcher = registry.ALL_ALGORITHMS.find((one) => one.inputType === 'string')
  assert.ok(matcher, 'the laboratory has an algorithm that works on text')
  await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/algorithm', value: matcher.id })

  const text = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/text', value: 'AABAACAADAABAABA' })
  assert.equal(text.ok, true, text.error?.message)
  assert.equal(world.lab()?.held.input, 'AABAACAADAABAABA')

  const asArray = await run(world, 'screen.read', { path: 'toolkit/algorithm-visualizer/array' })
  assert.equal((asArray.data as { readable: boolean }).readable, false)
  assert.match((asArray.data as { note?: string }).note ?? '', /works on text/)
})

test('a control on a laboratory that has been closed is not offered, and says so', async () => {
  const world = toolkitWorld()
  await run(world, 'screen.goTo', { path: 'toolkit/algorithm-visualizer' })
  assert.equal((await run(world, 'screen.read', { path: 'toolkit/algorithm-visualizer/animation/speed' })).ok, true)

  // Back to the shelf: the tool unmounts, and with it everything it offered.
  const back = await run(world, 'screen.do', { path: 'toolkit/back' })
  assert.equal(back.ok, true, back.error?.message)
  assert.equal(back.verification?.detail, 'The shelf is showing.')

  const gone = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/animation/speed', value: 2 })
  assert.equal(gone.ok, false)
  assert.match(gone.error?.message ?? '', /Toolkit has nothing called “algorithm-visualizer”/)

  const read = await run(world, 'screen.read', { path: 'toolkit/algorithm-visualizer/animation/speed' })
  assert.equal(read.ok, false)
  assert.equal(read.error?.code, 'not-found')
})

test('a comparison runs every picked algorithm on the same input, and will not run with nothing picked', async () => {
  const world = toolkitWorld()
  await run(world, 'screen.goTo', { path: 'toolkit/algorithm-visualizer' })

  const tooSoon = await run(world, 'screen.do', { path: 'toolkit/algorithm-visualizer/runComparison' })
  assert.equal(tooSoon.ok, false)
  assert.match(tooSoon.error?.message ?? '', /comparison strip is not showing/)

  await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/compare', value: true })
  const picked = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/comparing', value: ['bubbleSort', 'insertionSort'] })
  assert.equal(picked.ok, true, picked.error?.message)

  const compared = await run(world, 'screen.do', { path: 'toolkit/algorithm-visualizer/Run the comparison' })
  assert.equal(compared.ok, true, compared.error?.message)
  assert.match(compared.verification?.detail ?? '', /Bubble Sort in \d+ steps, Insertion Sort in \d+ steps/)
})

// ---------------------------------------------------------------- a laboratory with declared parameters

/** A laboratory's card, as the card holds it: an instance, the runtime behind it, and the buttons on the frame. */
function card(options: { kind?: string; phase?: string; parameters?: LabParameter[]; values?: Record<string, string | number | boolean | number[]>; shown?: string[] } = {}): {
  world: World
  instance(): NativeInstance | null
  configured: Record<string, unknown>[]
  operations: string[]
} {
  forgetSurfaces()
  const parameters: LabParameter[] = options.parameters ?? [
    { id: 'speed', name: 'Launch speed', kind: 'number', about: 'How fast it leaves the launch point.', unit: 'm/s', least: 0, most: 100, step: 1, derived: false },
    { id: 'angle', name: 'Angle above horizontal', kind: 'number', about: 'Zero is flat; ninety is straight up.', unit: 'deg', least: -90, most: 90, derived: false },
    { id: 'drag', name: 'Air resistance', kind: 'choice', about: 'Which drag model to use.', options: [{ id: 'none', label: 'none — a vacuum' }, { id: 'quadratic', label: 'quadratic — ordinary speeds in air' }], derived: false },
    { id: 'coefficient', name: 'Drag coefficient', kind: 'number', about: 'How draggy it is.', least: 0, most: 2, derived: false },
    { id: 'range', name: 'Range', kind: 'number', about: 'How far it goes.', unit: 'm', derived: true }
  ]
  const held = {
    id: 'instance-1',
    appId: 'projectile-lab',
    appName: 'Projectile Lab',
    surface: { kind: options.kind ?? 'native', ref: 'projectile-lab' },
    phase: options.phase ?? 'ready',
    generation: 3,
    size: 'expanded',
    values: options.values ?? { speed: 40, angle: 45, drag: 'none', coefficient: 0.3, range: 163.1 },
    described: { speed: '40 m/s', angle: '45 deg', drag: 'none — a vacuum', range: '163.1 m' },
    // Progressive disclosure: the coefficient is only on screen once a drag model has been chosen.
    shown: options.shown ?? ['speed', 'angle', 'drag', 'range'],
    definitions: parameters
  } as NativeInstance

  const configured: Record<string, unknown>[] = []
  const operations: string[] = []
  let gone = false

  registerSurface(() =>
    nativeAppSurface({
      appId: 'projectile-lab',
      name: () => 'Projectile Lab',
      instance: () => (gone ? null : held),
      why: () => (gone ? 'Projectile Lab was closed. Open it again to carry on.' : null),
      busy: () => false,
      configure: async (values) => {
        configured.push(values)
        const out: Record<string, string> = {}
        for (const [id, value] of Object.entries(values)) {
          const one = parameters.find((p) => p.id === id)
          // The runtime's own check, standing in for the real one: a unit it cannot read is a refusal, not a crash.
          if (one && (one.kind === 'number' || one.kind === 'integer') && typeof value === 'string') {
            out[id] = `“${value}” is not a number ${one.name} can be set to.`
            continue
          }
          held.values = { ...held.values, [id]: value as string | number | boolean | number[] }
          held.generation += 1
          if (id === 'drag' && value !== 'none') held.shown = [...held.shown, 'coefficient']
        }
        surfacesDrawn()
        return Object.keys(out).length ? out : null
      },
      act: async (operation, argument) => {
        operations.push(argument === undefined ? operation : `${operation}:${String(argument)}`)
        if (operation === 'run') held.phase = 'running'
        if (operation === 'pause') held.phase = 'paused'
        if (operation === 'resize') held.size = String(argument)
        if (operation === 'reset') {
          held.values = { speed: 40, angle: 45, drag: 'none', coefficient: 0.3, range: 163.1 }
          held.generation += 1
        }
        if (operation === 'close') gone = true
        surfacesDrawn()
        return gone ? null : held
      },
      fullPage: () => false,
      setFullPage: () => undefined,
      sizes: ['compact', 'expanded', 'workspace']
    })
  )

  const asks: string[] = []
  const state = { approve: true }
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })

  return {
    world: {
      control,
      toolkit: { open: null, search: '', category: 'all', closed: false },
      lab: () => null,
      asks,
      get approve() {
        return state.approve
      },
      set approve(value: boolean) {
        state.approve = value
      }
    },
    instance: () => (gone ? null : held),
    configured,
    operations
  }
}

test('a simulation’s parameters come with its own units and its own limits, and a value outside them is refused with the range', async () => {
  const { world, instance } = card()

  const reading = await run(world, 'screen.read', { path: 'projectile-lab/Launch speed' })
  assert.equal(reading.ok, true, reading.error?.message)
  assert.deepEqual(
    { value: (reading.data as { value: unknown }).value, min: (reading.data as { min: number }).min, max: (reading.data as { max: number }).max, type: (reading.data as { type: string }).type },
    { value: 40, min: 0, max: 100, type: 'number' }
  )

  const good = await run(world, 'screen.write', { path: 'projectile-lab/speed', value: 25 })
  assert.equal(good.ok, true, good.error?.message)
  assert.equal(instance()?.values.speed, 25)
  assert.match(good.verification?.detail ?? '', /Launch speed is now 25/)

  // The limit is the simulation's, not a guess: 25 m/s is a launch speed and 25,000 is not.
  const silly = await run(world, 'screen.write', { path: 'projectile-lab/speed', value: 25000 })
  assert.equal(silly.ok, false)
  assert.equal(silly.error?.code, 'invalid-params')
  assert.match(silly.error?.message ?? '', /at most 100/)
  assert.equal(instance()?.values.speed, 25, 'nothing was sent to the runtime')
})

test('a parameter the simulation works out for itself cannot be set, and says what to set instead', async () => {
  const { world, configured } = card()
  const derived = await run(world, 'screen.write', { path: 'projectile-lab/range', value: 200 })
  assert.equal(derived.ok, false)
  assert.match(derived.error?.message ?? '', /works Range out from its other settings/)
  assert.deepEqual(configured, [], 'the runtime was never asked')
})

test('a parameter that is not on screen yet says what has to be set first, and becomes settable when it is', async () => {
  const { world, instance } = card()

  const hidden = await run(world, 'screen.write', { path: 'projectile-lab/coefficient', value: 0.5 })
  assert.equal(hidden.ok, false)
  assert.match(hidden.error?.message ?? '', /not on screen at the moment/)

  // Choosing a drag model is what puts it on screen, which is the simulation's own rule rather than this one's.
  const drag = await run(world, 'screen.write', { path: 'projectile-lab/Air resistance', value: 'quadratic' })
  assert.equal(drag.ok, true, drag.error?.message)

  const now = await run(world, 'screen.write', { path: 'projectile-lab/coefficient', value: 0.5 })
  assert.equal(now.ok, true, now.error?.message)
  assert.equal(instance()?.values.coefficient, 0.5)
})

test('a laboratory that keeps its values in its own boxes says that, rather than changing something nobody can see', async () => {
  const { world, configured } = card({ kind: 'page' })
  const typed = await run(world, 'screen.write', { path: 'projectile-lab/speed', value: 25 })
  assert.equal(typed.ok, false)
  assert.match(typed.error?.message ?? '', /keeps its values in its own boxes/)
  assert.match(typed.error?.message ?? '', /Type it into the laboratory/)
  assert.deepEqual(configured, [], 'nothing was changed behind the screen')

  // It can still be read, and what it is doing can still be asked.
  assert.equal((await run(world, 'screen.read', { path: 'projectile-lab/speed' })).ok, true)
})

test('the clock buttons are offered only to a laboratory that has a clock', async () => {
  const still = card()
  const no = await run(still.world, 'screen.do', { path: 'projectile-lab/run' })
  assert.equal(no.ok, false)
  assert.match(no.error?.message ?? '', /has no clock to start/)
  assert.deepEqual(still.operations, [])

  const ticking = card({ phase: 'paused' })
  const yes = await run(ticking.world, 'screen.do', { path: 'projectile-lab/run' })
  assert.equal(yes.ok, true, yes.error?.message)
  assert.equal(yes.verification?.detail, 'Projectile Lab is running.')

  const again = await run(ticking.world, 'screen.do', { path: 'projectile-lab/run' })
  assert.equal(again.ok, false)
  assert.match(again.error?.message ?? '', /already running/)

  const paused = await run(ticking.world, 'screen.do', { path: 'projectile-lab/pause' })
  assert.equal(paused.ok, true, paused.error?.message)
  assert.equal(paused.verification?.detail, 'Projectile Lab is paused.')
})

test('putting a simulation back to its starting values is confirmed by what the runtime counted, not by having asked', async () => {
  const { world, instance } = card()
  await run(world, 'screen.write', { path: 'projectile-lab/speed', value: 25 })
  assert.equal(instance()?.values.speed, 25)

  const back = await run(world, 'screen.do', { path: 'projectile-lab/reset' })
  assert.equal(back.ok, true, back.error?.message)
  assert.equal(instance()?.values.speed, 40)
  assert.match(back.verification?.detail ?? '', /back at its starting values: 1 of its 5 settings changed/)
})

test('closing a laboratory asks first, and afterwards nothing on it is offered', async () => {
  const { world, operations } = card()
  world.approve = false
  const declined = await run(world, 'screen.do', { path: 'projectile-lab/close' }, 'orion')
  assert.equal(declined.ok, false)
  assert.equal(declined.error?.code, 'declined')
  assert.deepEqual(operations, [], 'nothing was closed')

  world.approve = true
  const closed = await run(world, 'screen.do', { path: 'projectile-lab/close' }, 'orion')
  assert.equal(closed.ok, true, `${closed.error?.code}: ${closed.error?.message}`)
  assert.equal(closed.verification?.detail, 'Projectile Lab is closed.')

  // The settings go with it: the card now shows a sentence and a way to open it again, and so does the surface.
  const after = await run(world, 'screen.read', { path: 'projectile-lab/speed' })
  assert.equal(after.ok, false)
  assert.equal(after.error?.code, 'not-found')

  const state = await run(world, 'screen.state', { path: 'projectile-lab' })
  const said = (state.data as { state: { activity: string; detail: string } }).state
  assert.equal(said.activity, 'failed')
  assert.match(said.detail, /was closed\. Open it again/)
})

test('the size of the card is the runtime’s own operation, and an unknown size is refused', async () => {
  const { world, operations, instance } = card()
  const bigger = await run(world, 'screen.write', { path: 'projectile-lab/size', value: 'workspace' })
  assert.equal(bigger.ok, true, bigger.error?.message)
  assert.deepEqual(operations, ['resize:workspace'])
  assert.equal(instance()?.size, 'workspace')

  const nonsense = await run(world, 'screen.write', { path: 'projectile-lab/size', value: 'enormous' })
  assert.equal(nonsense.ok, false)
  assert.match(nonsense.error?.message ?? '', /must be one of: compact, expanded, workspace/)
})

// ---------------------------------------------------------------- the frame a laboratory wears

test('the views on a laboratory’s frame are switched by their own ids, and the engine’s refusal is what it reports', async () => {
  forgetSurfaces()
  const held = { showing: 'blueprint', refused: null as { says: string; fix: string } | null }
  registerSurface(() =>
    nativeAppSurface({
      appId: 'logic-lab',
      name: () => 'Logic Lab',
      instance: () => ({ id: 'one', appId: 'logic-lab', appName: 'Logic Lab', surface: { kind: 'native', ref: 'logic-lab' }, phase: 'ready', generation: 1, size: 'expanded', values: {}, described: {}, shown: [], definitions: [] }),
      why: () => null,
      busy: () => false,
      configure: async () => null,
      act: async () => null,
      fullPage: () => false,
      setFullPage: () => undefined,
      sizes: ['compact', 'expanded', 'workspace']
    })
  )
  registerSurface(() =>
    labViewSurface({
      appId: 'logic-lab',
      title: 'Logic Lab',
      tabs: [
        { id: 'blueprint', label: 'The circuit' },
        { id: 'truth-table', label: 'Its truth table' },
        { id: 'clocked', label: 'Tick by tick' }
      ],
      showing: () => held.showing,
      show: (id) => {
        held.showing = id
        surfacesDrawn()
      },
      busy: () => false,
      ready: () => true,
      refused: () => held.refused,
      broke: () => null,
      assumptions: () => ['Gates switch instantly.', 'Wires have no resistance.']
    })
  )

  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })
  const world = { control, asks: [] as string[], approve: true }

  // The view is a screen inside the laboratory's, so the laboratory's own path reaches the control on it.
  const nothing = await run(world, 'screen.write', { path: 'logic-lab/view/showing' })
  assert.equal(nothing.ok, false, 'a write with nothing to write is refused')
  assert.match(nothing.error?.message ?? '', /"value" is required/)

  // The words on the tab are not a value: the laboratory switches on the ids, so a label is refused with the list.
  const byLabel = await run(world, 'screen.write', { path: 'logic-lab/showing', value: 'Its truth table' })
  assert.equal(byLabel.ok, false)
  assert.match(byLabel.error?.message ?? '', /must be one of: blueprint, truth-table, clocked/)
  assert.equal(held.showing, 'blueprint', 'nothing was switched')

  // And the control says which words go with which id, so the next attempt is not another guess.
  const reading = await run(world, 'screen.read', { path: 'logic-lab/view/showing' })
  assert.deepEqual((reading.data as { values: string[] }).values, ['blueprint', 'truth-table', 'clocked'])

  const byId = await run(world, 'screen.write', { path: 'logic-lab/showing', value: 'truth-table' })
  assert.equal(byId.ok, true, byId.error?.message)
  assert.equal(held.showing, 'truth-table')

  // What the engine refused is what the screen reports, in the engine's own words.
  held.refused = { says: 'That is not a circuit.', fix: 'Join the output to something.' }
  const state = await run(world, 'screen.state', { path: 'logic-lab/view' })
  const said = (state.data as { state: { activity: string; detail: string; values: Record<string, unknown> } }).state
  assert.equal(said.activity, 'failed')
  assert.equal(said.detail, 'That is not a circuit. Join the output to something.')
  assert.deepEqual(said.values.doesNotModel, ['Gates switch instantly.', 'Wires have no resistance.'])
})

// ---------------------------------------------------------------- from the first word of the sentence

test('from the window itself: open the Toolkit, enter the visualizer, and reach the speed inside it', async () => {
  forgetSurfaces()
  /*
   * The whole of the owner's sentence, including the word it starts with.
   *
   * The window shell is a screen too (`shellSurfaces.ts`), and in Orbis a module is a screen in its own right once it
   * is open rather than something inside the shell -- so opening the Toolkit is setting what is on screen, and
   * everything after it is the Toolkit's own and the laboratory's own. This drives both halves, because "the AI can
   * open its main page" is the first step and this is the rest of it.
   */
  const where = { showing: 'chat' as string, toolkit: null as (() => void) | null, lab: null as Lab | null }
  const nav = (): NavState => ({ surface: where.showing === 'chat' ? CHAT : { kind: 'feature', id: where.showing as 'toolkit' }, browserLaunched: false, behind: CHAT })

  const openToolkit = (): void => {
    if (where.toolkit) return
    const toolkit = { open: null as string | null, search: '', category: 'all' }
    let labOff: (() => void) | null = null
    const off = registerSurface(() =>
      toolkitSurface({
        tools: [{ id: 'algorithm', label: 'Algorithm Visualizer', categoryId: 'dev' }],
        categories: [{ id: 'dev', label: 'Developer' }],
        loaded: () => true,
        failed: () => '',
        open: () => toolkit.open,
        openTool: (id) => {
          toolkit.open = id
          if (id === 'algorithm' && !labOff) {
            const made = visualizer('toolkit')
            where.lab = made
            const one = registerSurface(() => algovizSurface(made.screen))
            const two = registerSurface(() => algovizAnimationSurface(made.screen, 'toolkit/algorithm-visualizer'))
            labOff = () => {
              one()
              two()
            }
          }
          surfacesDrawn()
        },
        search: () => toolkit.search,
        setSearch: (text) => {
          toolkit.search = text
          surfacesDrawn()
        },
        category: () => toolkit.category,
        setCategory: (id) => {
          toolkit.category = id
          surfacesDrawn()
        },
        favourites: () => [],
        showing: () => 1,
        close: () => undefined
      })
    )
    where.toolkit = () => {
      labOff?.()
      off()
      where.lab = null
    }
    surfacesDrawn()
  }

  registerSurface(() =>
    shellSurface({
      nav,
      // The window's own switch, which mounts the screen that was asked for -- what `App.tsx` does with one value.
      show: (what) => {
        where.showing = what
        if (what === 'toolkit') openToolkit()
        else {
          where.toolkit?.()
          where.toolkit = null
        }
        surfacesDrawn()
      },
      browserRunning: () => false,
      sidebar: () => true,
      setSidebar: () => undefined,
      settings: () => null,
      openSettings: () => undefined,
      activity: () => false,
      setActivity: () => undefined,
      activityCount: () => ({ total: 0, unread: 0 }),
      clearActivity: () => undefined,
      palette: () => false,
      setPalette: () => undefined,
      shortcuts: () => false,
      setShortcuts: () => undefined,
      back: () => {
        where.showing = 'chat'
        where.toolkit?.()
        where.toolkit = null
        surfacesDrawn()
      },
      chats: () => 2
    })
  )

  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })
  const world = { control, asks: [] as string[], approve: true }

  // The Toolkit is one of the window's screens, and it is in that list because it is in the capability registry.
  assert.ok(WINDOW_SCREENS.includes('toolkit'))

  const opened = await run(world, 'screen.write', { path: 'shell/screen', value: 'toolkit' })
  assert.equal(opened.ok, true, opened.error?.message)
  assert.match(opened.verification?.detail ?? '', /What is on screen is now “toolkit”/)

  const entered = await run(world, 'screen.goTo', { path: 'toolkit/Algorithm Visualizer' })
  assert.equal(entered.ok, true, entered.error?.message)
  assert.deepEqual((entered.data as { opened: string[] }).opened, ['toolkit/algorithm-visualizer'])

  const speed = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/animation/speed', value: 0.5 })
  assert.equal(speed.ok, true, speed.error?.message)
  assert.equal(where.lab?.screen.playback.speed, 0.5)

  const array = await run(world, 'screen.write', { path: 'toolkit/algorithm-visualizer/array', value: [9, 4, 7, 2, 1] })
  assert.equal(array.ok, true, array.error?.message)

  const started = await run(world, 'screen.do', { path: 'toolkit/algorithm-visualizer/start' })
  assert.equal(started.ok, true, started.error?.message)
  assert.match(started.verification?.detail ?? '', /Bubble Sort is running: step 1 of 20, at 0\.5× speed\./)

  // And leaving takes the whole of it away rather than leaving controls that answer for a screen nobody can see.
  await run(world, 'screen.write', { path: 'shell/screen', value: 'chat' })
  const gone = await run(world, 'screen.read', { path: 'toolkit/algorithm-visualizer/animation/speed' })
  assert.equal(gone.ok, false)
  assert.match(gone.error?.message ?? '', /Nothing on screen is called “toolkit”/)
})

// ---------------------------------------------------------------- finding one in the first place

/**
 * The Laboratories screen, driven with Orbis's own catalogue.
 *
 * The list, the subjects and the Projectile Lab's parameters below are the real ones, imported from
 * `shared/native/catalogue.ts`. That matters for the thing this is meant to prove: a launch speed of 25 m/s is
 * allowed and 250,000 is not, and which it is comes from the simulation's own declaration rather than from anything
 * written in this test or in the surface.
 */
const realCatalogue = (await import('../../shared/native/catalogue.ts')) as {
  CATALOGUE: readonly { id: string; name: string; summary: string; domain: string; aliases: readonly string[]; tags: readonly string[]; limitations: readonly string[] }[]
  parametersFor(appId: string): Record<string, { id: string; name: string; kind: string; about: string; unit?: string; least?: number; most?: number; options?: readonly { id: string; label: string }[]; from?: readonly string[]; initial: unknown }>
}

/** Every laboratory, as the catalogue screen is given them by the main process. */
const catalogueRows = (): LabsEntry[] =>
  realCatalogue.CATALOGUE.map((one) => ({
    id: one.id,
    name: one.name,
    summary: one.summary,
    domain: one.domain,
    aliases: [...one.aliases],
    tags: [...one.tags],
    limitations: [...one.limitations],
    blocked: null
  }))

/** The screen's own filter, which is what the surface reports as matching. */
const rowMatches = (one: LabsEntry, want: string): boolean => {
  const q = want.trim().toLowerCase()
  if (q === '') return true
  return (
    one.name.toLowerCase().includes(q) ||
    one.summary.toLowerCase().includes(q) ||
    (one.aliases ?? []).some((alias) => alias.toLowerCase().includes(q)) ||
    (one.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
  )
}

/** What the Laboratories screen holds, as React holds it. */
interface LabsHeld {
  query: string
  catalogue: LabsEntry[] | null
  refused: string | null
  openHere: string[]
  closed: boolean
}

/**
 * The Projectile Lab's card, registered the way the conversation registers it.
 *
 * Its parameters are `parametersFor('projectile-lab')` rather than a list written here, because what these tests are
 * for is that the unit and the limits a write is checked against are the simulation's own.
 */
function openProjectileCard(): void {
  const declared = realCatalogue.parametersFor('projectile-lab')
  const definitions: LabParameter[] = Object.values(declared).map((one) => ({
    id: one.id,
    name: one.name,
    kind: one.kind,
    about: one.about,
    ...(one.unit ? { unit: one.unit } : {}),
    ...(typeof one.least === 'number' ? { least: one.least } : {}),
    ...(typeof one.most === 'number' ? { most: one.most } : {}),
    ...(one.options ? { options: one.options } : {}),
    derived: Array.isArray(one.from) && one.from.length > 0
  }))
  const values: Record<string, unknown> = {}
  for (const one of Object.values(declared)) values[one.id] = one.initial

  const instance = {
    id: 'instance-labs',
    appId: 'projectile-lab',
    appName: 'Projectile Lab',
    surface: { kind: 'native', ref: 'projectile-lab' },
    phase: 'ready',
    generation: 1,
    size: 'expanded',
    values,
    described: {},
    shown: definitions.filter((one) => !one.derived).map((one) => one.id),
    definitions
  } as unknown as NativeInstance

  registerSurface(() =>
    nativeAppSurface({
      appId: 'projectile-lab',
      name: () => 'Projectile Lab',
      instance: () => instance,
      why: () => null,
      busy: () => false,
      configure: async (next) => {
        for (const [id, value] of Object.entries(next)) instance.values = { ...instance.values, [id]: value as never }
        instance.generation += 1
        surfacesDrawn()
        return null
      },
      act: async () => instance,
      fullPage: () => false,
      setFullPage: () => undefined,
      sizes: ['compact', 'expanded', 'workspace']
    })
  )
  surfacesDrawn()
}

/**
 * The Laboratories screen's own state and handlers.
 *
 * Opening one is not a step inside this screen: the card goes into the conversation and registers a screen of its
 * own at the top level, which is why the catalogue declares no children. This stands that up the way the window does
 * it, so the walk from "which laboratories are there" to "set the launch angle" is the real one.
 */
function labsScreen(held: LabsHeld): Parameters<typeof labsCatalogueSurface>[0] {
  return {
    catalogue: () => held.catalogue,
    refused: () => held.refused,
    search: () => held.query,
    setSearch: (text) => {
      held.query = text
      surfacesDrawn()
    },
    matching: () => (held.catalogue ?? []).filter((one) => rowMatches(one, held.query)),
    open: (appId) => {
      // What the card's own button does: the shell adds the card to the conversation, and the card registers.
      if (!held.openHere.includes(appId)) held.openHere.push(appId)
      if (appId === 'projectile-lab') openProjectileCard()
      surfacesDrawn()
    },
    openHere: () => [...held.openHere],
    close: () => {
      held.closed = true
      surfacesDrawn()
    }
  }
}

function labsWorld(options: { catalogue?: LabsEntry[] | null; refused?: string | null } = {}): {
  control: BrowserControl
  asks: string[]
  approve: boolean
  held: LabsHeld
  arrive(): void
} {
  forgetSurfaces()
  const held: LabsHeld = {
    query: '',
    catalogue: options.catalogue === undefined ? catalogueRows() : options.catalogue,
    refused: options.refused ?? null,
    openHere: [],
    closed: false
  }
  registerSurface(() => labsCatalogueSurface(labsScreen(held)))

  const asks: string[] = []
  const state = { approve: true }
  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })
  return {
    control,
    asks,
    get approve() {
      return state.approve
    },
    set approve(value: boolean) {
      state.approve = value
    },
    held,
    arrive: () => {
      held.catalogue = catalogueRows()
      surfacesDrawn()
    }
  }
}

test('the catalogue says how many laboratories there are and which subjects they are in, and searching it is a control', async () => {
  const world = labsWorld()

  const state = await run(world, 'screen.state', { path: 'labs' })
  assert.equal(state.ok, true, state.error?.message)
  const said = (state.data as { state: { activity: string; detail: string; values: Record<string, unknown> } }).state
  assert.equal(said.activity, 'idle')
  assert.equal(said.values.laboratories, realCatalogue.CATALOGUE.length)
  // The subjects are the ones the registry really used, counted, rather than a list written in the surface.
  const subjects = said.values.subjects as Record<string, number>
  assert.ok(subjects.physics > 0, 'the catalogue has physics laboratories in it')
  assert.equal(
    Object.values(subjects).reduce((sum, one) => sum + one, 0),
    realCatalogue.CATALOGUE.length
  )

  const searched = await run(world, 'screen.write', { path: 'labs/search', value: 'trajectory' })
  assert.equal(searched.ok, true, searched.error?.message)
  const after = (await run(world, 'screen.state', { path: 'labs' })).data as { state: { detail: string; values: Record<string, unknown> } }
  assert.equal(after.state.values.matching, (world.held.catalogue ?? []).filter((one) => rowMatches(one, 'trajectory')).length)
  assert.match(after.state.detail, /match/)
})

test('a catalogue that has not been read yet is unreadable rather than empty, and says what to wait for', async () => {
  const world = labsWorld({ catalogue: null })

  // Nothing has been read, so nothing can be opened -- and the refusal says why rather than "no such laboratory".
  const tooSoon = await run(world, 'screen.do', { path: 'labs/open', params: { lab: 'projectile' } })
  assert.equal(tooSoon.ok, false)
  assert.match(tooSoon.error?.message ?? '', /The catalogue has not been read yet/)

  const state = (await run(world, 'screen.state', { path: 'labs' })).data as { state: { activity: string; detail: string } }
  assert.equal(state.state.activity, 'running')
  assert.equal(state.state.detail, 'Reading the catalogue of laboratories.')

  // And once it has arrived the same request works, which is what makes the sentence above a wait and not a refusal.
  world.arrive()
  const opened = await run(world, 'screen.do', { path: 'labs/open', params: { lab: 'projectile' } })
  assert.equal(opened.ok, true, opened.error?.message)
})

test('a catalogue that could not be read says so, and does not report an Orbis with no laboratories in it', async () => {
  const world = labsWorld({ catalogue: null, refused: 'The laboratories cannot be listed from here.' })

  const state = (await run(world, 'screen.state', { path: 'labs' })).data as { state: { activity: string; detail: string; values: Record<string, unknown> } }
  assert.equal(state.state.activity, 'failed')
  assert.match(state.state.detail, /could not be read: The laboratories cannot be listed from here\./)
  // Not nought: a number that was never read is not a measurement of nothing.
  assert.equal(state.state.values.laboratories, undefined)
})

test('a laboratory nobody has is not opened, and what comes back is how to find the right one', async () => {
  const world = labsWorld()

  const nope = await run(world, 'screen.do', { path: 'labs/open', params: { lab: 'quidditch' } })
  assert.equal(nope.ok, false)
  assert.match(nope.error?.message ?? '', /No laboratory is called/)
  assert.match(nope.error?.message ?? '', /physics/)
  assert.deepEqual(world.held.openHere, [])
})

test('the whole sentence: find the projectile laboratory, open it, and set the launch speed the simulation’s own way', async () => {
  const world = labsWorld()

  const opened = await run(world, 'screen.do', { path: 'labs/open', params: { lab: 'projectile motion' } })
  assert.equal(opened.ok, true, opened.error?.message)
  // Confirmed by the card turning up in the conversation, and it says where everything on it now is.
  assert.equal(opened.verification?.verified, true)
  assert.match(opened.verification?.detail ?? '', /Projectile Lab is open in the conversation/)

  // The range is the simulation's, passed straight through.
  const reading = await run(world, 'screen.read', { path: 'projectile-lab/Launch speed' })
  assert.equal(reading.ok, true, reading.error?.message)
  const speed = reading.data as { value: number; min: number; max: number; note?: string }
  assert.equal(speed.min, 0)
  assert.equal(speed.max, 100_000)

  const set = await run(world, 'screen.write', { path: 'projectile-lab/Launch speed', value: 25 })
  assert.equal(set.ok, true, set.error?.message)
  assert.match(set.verification?.detail ?? '', /Launch speed is now 25/)

  // And a speed the simulation does not allow is refused with the range rather than quietly becoming the nearest one.
  const silly = await run(world, 'screen.write', { path: 'projectile-lab/Launch speed', value: 250_000 })
  assert.equal(silly.ok, false)
  assert.equal(silly.error?.code, 'invalid-params')
  assert.match(silly.error?.message ?? '', /100000/)
  const stillTwentyFive = await run(world, 'screen.read', { path: 'projectile-lab/Launch speed' })
  assert.equal((stillTwentyFive.data as { value: number }).value, 25)
})

test('opening one that is already open says it is still open rather than claiming it opened again', async () => {
  const world = labsWorld()

  await run(world, 'screen.do', { path: 'labs/open', params: { lab: 'projectile-lab' } })
  const again = await run(world, 'screen.do', { path: 'labs/open', params: { lab: 'projectile-lab' } })
  assert.equal(again.ok, true, again.error?.message)
  assert.match(again.verification?.detail ?? '', /was already open in this conversation, and still is/)
})

test('a laboratory the registry says cannot open here is refused with the registry’s own sentence', async () => {
  const world = labsWorld()
  const blocked = (world.held.catalogue ?? []).find((one) => one.id === 'projectile-lab')
  assert.ok(blocked)
  blocked.blocked = 'It needs the simulation engine, which has not been set up on this computer.'

  const nope = await run(world, 'screen.do', { path: 'labs/open', params: { lab: 'projectile-lab' } })
  assert.equal(nope.ok, false)
  assert.match(nope.error?.message ?? '', /Projectile Lab cannot open here: It needs the simulation engine/)
  // Nothing was opened, so nothing is in the conversation that cannot do anything.
  assert.deepEqual(world.held.openHere, [])
})

test('from the window itself: show the laboratories, find one by what it does, open it and set a parameter', async () => {
  forgetSurfaces()
  /*
   * The whole way in, which is the step the control engine stopped at: the window shows the Laboratories screen, that
   * screen says what is in the catalogue, one of them is opened by a word from what it does, and the parameter inside
   * it is then set with the simulation's own unit and the simulation's own limits.
   */
  const held = {
    query: '',
    catalogue: catalogueRows() as LabsEntry[] | null,
    refused: null as string | null,
    openHere: [] as string[],
    closed: false
  }
  const where = { showing: 'chat' as string, off: null as (() => void) | null }

  registerSurface(() =>
    shellSurface({
      nav: () => ({ surface: where.showing === 'chat' ? CHAT : { kind: 'feature', id: where.showing as 'labs' }, browserLaunched: false, behind: CHAT }),
      show: (what) => {
        where.showing = what
        if (what === 'labs' && !where.off) where.off = registerSurface(() => labsCatalogueSurface(labsScreen(held)))
        if (what !== 'labs' && where.off) {
          where.off()
          where.off = null
        }
        surfacesDrawn()
      },
      browserRunning: () => false,
      sidebar: () => true,
      setSidebar: () => undefined,
      settings: () => null,
      openSettings: () => undefined,
      activity: () => false,
      setActivity: () => undefined,
      activityCount: () => ({ total: 0, unread: 0 }),
      clearActivity: () => undefined,
      palette: () => false,
      setPalette: () => undefined,
      shortcuts: () => false,
      setShortcuts: () => undefined,
      back: () => {
        where.showing = 'chat'
        where.off?.()
        where.off = null
        surfacesDrawn()
      },
      chats: () => 1
    })
  )

  const control = new BrowserControl()
  registerSurfaceCapabilities(control, {
    ask: async (call, params) => overTheWire(await answerSurfaceCall(call, overTheWire(params))),
    open: () => true
  })
  const world = { control, asks: [] as string[], approve: true }

  // Laboratories is one of the window's screens because it is in the capability registry, like every other module.
  assert.ok(WINDOW_SCREENS.includes('labs'))

  const shown = await run(world, 'screen.write', { path: 'shell/screen', value: 'labs' })
  assert.equal(shown.ok, true, shown.error?.message)

  const searched = await run(world, 'screen.write', { path: 'labs/search', value: 'air resistance' })
  assert.equal(searched.ok, true, searched.error?.message)
  const state = (await run(world, 'screen.state', { path: 'labs' })).data as { state: { values: { matches?: { id: string }[] } } }
  assert.ok((state.state.values.matches ?? []).some((one) => one.id === 'projectile-lab'))

  const opened = await run(world, 'screen.do', { path: 'labs/open', params: { lab: 'trajectory' } })
  assert.equal(opened.ok, true, opened.error?.message)
  assert.equal(opened.verification?.verified, true)

  const angle = await run(world, 'screen.write', { path: 'projectile-lab/Angle above horizontal', value: 30 })
  assert.equal(angle.ok, true, angle.error?.message)
  assert.match(angle.verification?.detail ?? '', /Angle above horizontal is now 30/)

  // Leaving takes the catalogue away; the laboratory stays, because it is open in the conversation and not in here.
  await run(world, 'screen.write', { path: 'shell/screen', value: 'chat' })
  const gone = await run(world, 'screen.read', { path: 'labs/search' })
  assert.equal(gone.ok, false)
  const still = await run(world, 'screen.read', { path: 'projectile-lab/Angle above horizontal' })
  assert.equal(still.ok, true, still.error?.message)
  assert.equal((still.data as { value: number }).value, 30)
})
