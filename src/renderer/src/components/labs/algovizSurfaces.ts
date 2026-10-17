import type { ParamSpec } from '../../../../shared/browserControl.ts'
import type { ActionDeclaration, ControlDeclaration, StateDeclaration, SurfaceDeclaration } from '../../lib/surfaces/registry.ts'
import { settle } from '../../lib/surfaces/settle.ts'

/**
 * What the Algorithm Visualizer lets Orbis do, as data.
 *
 * Opening the laboratory is the first step of the job, not the job. What somebody actually asks for is "open the
 * Algorithm Visualizer, select Bubble Sort, set the speed to 0.5x, change the array to 9, 4, 7, 2, 1 and start it" --
 * which is one screen, five of its controls and two of its buttons. This file is that screen described: which
 * algorithm is chosen, what it runs on, the generator behind the random data, the playback, and what the run is
 * doing right now.
 *
 * ## Here rather than inside the component, for two reasons
 *
 * The laboratory is drawn in two places from one component -- the Toolkit's Algorithm Visualizer and the Computer
 * Science Studio's Algorithm Laboratory -- so a declaration written inside it would be written twice. And a
 * declaration inside a component can only be checked by drawing that component; there is no browser in the test
 * suite. As a function of the screen's own state and handlers, the whole chain is driven by
 * `src/main/browserControl/labSurfaces.test.ts` with no window at all.
 *
 * ## Nothing here computes anything
 *
 * Every value is read from the screen that passes itself in and every setter is a function that screen already calls
 * when somebody works the control by hand. The ranges are the laboratory's own: the thirteen speeds its buttons
 * offer, the 5-to-40 the grid editor clamps its size to, the ninety algorithms its registry holds. A range invented
 * here would be a second opinion about the laboratory, and the laboratory would win.
 */

// ---------------------------------------------------------------- what the screen hands over

/** One algorithm, as the laboratory's own registry describes it. */
export interface AlgovizAlgorithm {
  id: string
  name: string
  category: string
  /** `array`, `string` or `none` -- what its input is, which is what decides which input control is live. */
  inputType?: string
  /** `pathgrid` for the ones that run on a drawn board rather than on an input. */
  view?: string
  needsTarget?: boolean
  needsK?: boolean
  complexity?: { best?: string; avg?: string; worst?: string; space?: string }
}

/** One step of a computed run, as the laboratory's own generators produce it. */
export interface AlgovizStep {
  desc?: string
  stats?: Record<string, number>
  vars?: Record<string, unknown>
  codeLine?: number
}

/** The generator settings behind the random data. The laboratory keeps them in one object. */
export interface AlgovizOptions {
  size: number
  min: number
  max: number
  seed: number
  preset: string
  target?: number
  k?: number
}

/** The playback engine, exactly as `usePlayback` returns it. */
export interface AlgovizPlayback {
  idx: number
  playing: boolean
  speed: number
  total: number
  atEnd: boolean
  setSpeed(value: number): void
  play(): void
  pause(): void
  stop(): void
  restart(): void
  next(): void
  prev(): void
  toStart(): void
  toEnd(): void
  jump(index: number): void
}

export interface AlgovizScreen {
  /** The path of the screen this copy of the laboratory is inside, or null when it is on its own. */
  parent: string | null
  /** Every algorithm it can show, from its own registry. */
  algorithms: readonly AlgovizAlgorithm[]
  /** The category tabs, in the order they are drawn. */
  categories: readonly string[]
  algorithm(): string
  selectAlgorithm(id: string): void
  search(): string
  setSearch(text: string): void
  category(): string
  setCategory(name: string): void
  /** The input box, exactly as it reads on screen. */
  input(): string
  setInput(text: string): void
  /** The box read as numbers, the way the laboratory itself reads it before a run. */
  numbers(): number[]
  options(): AlgovizOptions
  setOptions(next: AlgovizOptions): void
  favourite(): boolean
  toggleFavourite(): void
  fullScreen(): boolean
  setFullScreen(on: boolean): void
  comparing(): boolean
  setComparing(on: boolean): void
  picked(): readonly string[]
  setPicked(ids: readonly string[]): void
  compare(): void
  /** What the last comparison produced, with the steps each algorithm took. */
  comparison(): readonly { id: string; name: string; steps: readonly AlgovizStep[] }[]
  /** The Run button: works out every step for what is set now. */
  run(): void
  /** Randomize & Run: a new seed, a new array, and a run. */
  randomizeAndRun(): void
  /** Null until a run has been worked out. */
  steps(): readonly AlgovizStep[] | null
  playback: AlgovizPlayback
  /** How many algorithms the search and the category leave showing. */
  listed(): number
}

// ---------------------------------------------------------------- the laboratory's own numbers

/** The thirteen speeds the buttons offer. The slider between them goes from the first to the last. */
export const ALGOVIZ_SPEEDS: readonly number[] = Object.freeze([0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8, 16, 32, 64, 128])

/** The five shapes of random data its buttons make. */
export const ALGOVIZ_PRESETS: readonly string[] = Object.freeze(['random', 'sorted', 'reverse', 'nearly', 'dups'])

/** What the last step counted: comparisons, swaps, node visits -- whatever this algorithm counts. */
const countsOf = (step: AlgovizStep | undefined): Record<string, number> => {
  const stats = step?.stats ?? {}
  return Object.fromEntries(Object.entries(stats).filter(([, value]) => typeof value === 'number'))
}

/** A run that could not be worked out says so in its only step, and that is not a run. */
const brokeWith = (steps: readonly AlgovizStep[] | null): string | null => {
  if (!steps || steps.length !== 1) return null
  const said = steps[0]?.desc ?? ''
  return said.startsWith('Error:') ? said.slice('Error:'.length).trim() : null
}

// ---------------------------------------------------------------- the laboratory

/**
 * The Algorithm Visualizer: which algorithm, what it runs on, and the generator behind the random data.
 *
 * The playback is a screen of its own (`algovizAnimationSurface`), because "open its animation settings and set the
 * speed" is how it is asked for and because the panel is a real part of the screen rather than a heading.
 */
export function algovizSurface(screen: AlgovizScreen): SurfaceDeclaration {
  const chosen = (): AlgovizAlgorithm => {
    const found = screen.algorithms.find((one) => one.id === screen.algorithm())
    // The laboratory cannot draw an algorithm it does not have, so this is a fault rather than an empty screen.
    if (!found) throw new Error(`The laboratory has no algorithm called “${screen.algorithm()}”.`)
    return found
  }
  const takes = (): string => chosen().inputType ?? 'array'
  const onBoard = (): boolean => chosen().view === 'pathgrid'

  /** Why the input controls are not live, or true. Said as a sentence: a bare "no" has no fix in it. */
  const inputIs = (kind: 'array' | 'string'): true | string => {
    const algorithm = chosen()
    if (onBoard()) return `${algorithm.name} runs on the board that is drawn under it, not on an input. Draw the walls, the start and the end on the grid.`
    const is = takes()
    if (is === 'none') return `${algorithm.name} takes no input: it makes its own.`
    if (is === kind) return true
    return kind === 'array'
      ? `${algorithm.name} works on text, so there is no list of numbers to set. Set “text” instead.`
      : `${algorithm.name} works on a list of numbers, so there is no text to set. Set “array” instead.`
  }

  /** The generator row, which is only on screen for the algorithms that run on an input. */
  const generatorIs = (): true | string =>
    onBoard() ? `${chosen().name} runs on a drawn board, so there is nothing to generate.` : takes() === 'array' ? true : `${chosen().name} does not run on generated numbers.`

  const option = (id: keyof AlgovizOptions, name: string, spec: ParamSpec, about: string, when?: () => true | string): ControlDeclaration => ({
    name,
    about,
    spec,
    get: () => {
      /*
       * A setting that is not on screen cannot be read off it.
       *
       * The laboratory keeps these in its own state whether or not it draws them, so there would always be a number
       * to hand back -- a number nobody can see, for a control that is not there. The sentence that says why it
       * cannot be set is the same sentence that says why it cannot be read.
       */
      const why = when ? when() : generatorIs()
      if (why !== true) throw new Error(why)
      const held = screen.options()[id]
      if (held === undefined) throw new Error(`The ${name} box is empty.`)
      return held
    },
    writable: when ?? generatorIs,
    // Through the one object the laboratory keeps them in, so the array is regenerated exactly as it is when
    // somebody types in the box themselves.
    set: (value) => screen.setOptions({ ...screen.options(), [id]: typeof value === 'string' ? value : Number(value) })
  })

  const needsTarget = (): true | string => (chosen().needsTarget === true ? true : `${chosen().name} does not search for a target.`)
  const needsK = (): true | string => (chosen().needsK === true ? true : `${chosen().name} has no k to set.`)

  return {
    id: 'algorithm-visualizer',
    parent: screen.parent,
    name: 'Algorithm Visualizer',
    about: 'Ninety algorithms, run step by step, with the variables, the counts and the source line at every step.',
    kind: 'tool',
    keywords: ['algorithm', 'algorithms', 'visualizer', 'visualiser', 'sorting', 'sort', 'searching', 'laboratory', 'algoviz', 'animation'],
    controls: {
      algorithm: {
        name: 'Algorithm',
        about: 'Which of the ninety is shown. Choosing one puts the laboratory back to its first step.',
        spec: { type: 'string', description: 'The algorithm to show, by its id or by the name on screen.', enum: screen.algorithms.map((one) => one.id) },
        get: () => screen.algorithm(),
        set: (value) => screen.selectAlgorithm(String(value))
      },
      category: {
        name: 'Category',
        about: 'Which group of algorithms the grid shows. “All” shows every one of them.',
        spec: { type: 'string', description: 'One of the category tabs.', enum: ['All', ...screen.categories] },
        get: () => screen.category(),
        set: (value) => screen.setCategory(String(value)),
        default: 'All'
      },
      search: {
        name: 'Search',
        about: 'Narrows the grid by name, category or complexity.',
        spec: { type: 'string', description: 'What to look for. Empty shows everything.' },
        get: () => screen.search(),
        set: (value) => screen.setSearch(String(value ?? '')),
        default: ''
      },
      /*
       * One box on screen, two controls -- and exactly one of them is live.
       *
       * The box holds a list of numbers for the eighty algorithms that sort, search and traverse, and text for the
       * ones that match strings. Which it is, is the algorithm's own `inputType`, so neither control guesses: the one
       * that does not apply refuses to be read and says which one to use instead.
       */
      array: {
        name: 'Array',
        about: 'The numbers it runs on, as the input box holds them.',
        spec: { type: 'array', description: 'The numbers to run on, for example [9, 4, 7, 2, 1].' },
        get: () => {
          const why = inputIs('array')
          if (why !== true) throw new Error(why)
          return screen.numbers()
        },
        writable: () => inputIs('array'),
        // Joined the way the laboratory's own Randomize button writes a generated array into the box.
        set: (value) => screen.setInput((Array.isArray(value) ? value : [value]).map((one) => Number(one)).join(','))
      },
      text: {
        name: 'Text',
        about: 'The text it runs on, for the algorithms that match strings.',
        spec: { type: 'string', description: 'The text to run on, for example AABAACAADAABAABA.' },
        get: () => {
          const why = inputIs('string')
          if (why !== true) throw new Error(why)
          return screen.input()
        },
        writable: () => inputIs('string'),
        set: (value) => screen.setInput(String(value ?? ''))
      },
      size: option('size', 'Size', { type: 'integer', description: 'How many numbers the generator makes.', min: 1 }, 'How many numbers Randomize puts in the box. Above two hundred the laboratory warns that the run will be slow.'),
      min: option('min', 'Min', { type: 'integer', description: 'The smallest number the generator may make.' }, 'The bottom of the range the generated numbers come from.'),
      max: option('max', 'Max', { type: 'integer', description: 'The largest number the generator may make.' }, 'The top of the range the generated numbers come from.'),
      seed: option('seed', 'Seed', { type: 'integer', description: 'The seed the generator starts from.' }, 'The same seed makes the same numbers, so a run can be repeated exactly.'),
      preset: option(
        'preset',
        'Shape',
        { type: 'string', description: 'What shape of data to generate.', enum: [...ALGOVIZ_PRESETS] },
        'Random, already sorted, reversed, nearly sorted or full of duplicates — the five the buttons offer.'
      ),
      target: option('target', 'Target', { type: 'integer', description: 'The number to search for.' }, 'What a searching algorithm is looking for.', needsTarget),
      k: option('k', 'k', { type: 'integer', description: 'The k this algorithm needs.' }, 'The k for an algorithm that wants one, such as the kth largest.', needsK),
      favourite: {
        name: 'Favourite',
        about: 'Keeps this algorithm in the row of favourites, on this computer.',
        spec: { type: 'boolean', description: 'Whether this algorithm is a favourite.' },
        get: () => screen.favourite(),
        // The screen's own button toggles, so this only presses it when the answer would change.
        set: (on) => {
          if ((on === true) !== screen.favourite()) screen.toggleFavourite()
        }
      },
      fullScreen: {
        name: 'Full screen',
        about: 'Opens the drawing over the whole window, or closes it again.',
        spec: { type: 'boolean', description: 'Whether the visualisation fills the window.' },
        get: () => screen.fullScreen(),
        set: (on) => screen.setFullScreen(on === true),
        default: false
      },
      compare: {
        name: 'Compare',
        about: 'Shows the comparison strip, where several algorithms can be run on the same input.',
        spec: { type: 'boolean', description: 'Whether the comparison strip is showing.' },
        get: () => screen.comparing(),
        set: (on) => screen.setComparing(on === true),
        default: false
      },
      comparing: {
        name: 'Algorithms to compare',
        about: 'Which algorithms the comparison runs on the same input.',
        spec: { type: 'array', description: 'The ids of the algorithms to compare.' },
        get: () => [...screen.picked()],
        writable: () => (screen.comparing() ? true : 'The comparison strip is not showing. Turn compare on first.'),
        set: (value) => screen.setPicked((Array.isArray(value) ? value : [value]).map((one) => String(one)))
      }
    },
    actions: {
      run: {
        name: 'Run',
        about: 'Works out every step for the algorithm and the input that are set now. Nothing is animated until this has been done.',
        run: () => {
          screen.run()
          return { algorithm: chosen().name }
        },
        verify: async () => {
          await settle(() => (screen.steps()?.length ?? 0) > 0)
          const steps = screen.steps()
          const broke = brokeWith(steps)
          if (broke) return { done: false, detail: `the laboratory could not run it: ${broke}` }
          if (!steps?.length) return { done: false, detail: 'nothing was worked out.' }
          return { done: true, detail: `${chosen().name} worked out ${steps.length} steps.` }
        }
      },
      randomize: {
        name: 'Randomize and run',
        about: 'A new seed, a new array in the box, and a run — the laboratory’s own Randomize & Run button.',
        run: () => {
          screen.randomizeAndRun()
          return { seed: screen.options().seed }
        },
        verify: async () => {
          await settle(() => (screen.steps()?.length ?? 0) > 0)
          const steps = screen.steps()
          const broke = brokeWith(steps)
          if (broke) return { done: false, detail: `the laboratory could not run it: ${broke}` }
          return { done: Boolean(steps?.length), detail: steps?.length ? `${chosen().name} worked out ${steps.length} steps on ${screen.input()}.` : 'nothing was worked out.' }
        }
      },
      /*
       * Run and then play, because that is what "start the visualization" means here.
       *
       * Two of the laboratory's own buttons in the order a person presses them, and the order matters: the playback
       * puts itself back to the first step whenever the steps are replaced, so playing before the new steps have
       * arrived would be undone by the laboratory a moment later. It waits for them instead.
       */
      start: {
        name: 'Run and start the animation',
        about: 'Works out the steps for what is set now and starts playing them: the Run button followed by Play.',
        run: async () => {
          screen.run()
          const ready = await settle(() => (screen.steps()?.length ?? 0) > 0)
          if (!ready) return { started: false, why: 'The steps were not worked out.' }
          const broke = brokeWith(screen.steps())
          if (broke) return { started: false, why: broke }
          screen.playback.play()
          return { started: true, steps: screen.steps()?.length ?? 0 }
        },
        verify: async (data) => {
          const got = data as { started: boolean; why?: string; steps?: number }
          if (!got.started) return { done: false, detail: got.why ?? 'it did not start.' }
          await settle(() => screen.playback.playing || screen.playback.atEnd)
          const pb = screen.playback
          return {
            done: pb.playing || pb.atEnd,
            detail: pb.playing
              ? `${chosen().name} is running: step ${pb.idx + 1} of ${pb.total}, at ${pb.speed}× speed.`
              : pb.atEnd
                ? `${chosen().name} ran to the end of its ${pb.total} steps.`
                : 'the animation is not running.'
          }
        }
      },
      /*
       * `runComparison` rather than `compare`, because `compare` is already the switch that shows the strip.
       *
       * Two things on one screen answering to one name is not ambiguity the path resolver can report: it prefers a
       * control, so the button would simply never be reachable. The test caught it, and the ids are kept apart here.
       */
      runComparison: {
        name: 'Run the comparison',
        about: 'Runs every picked algorithm on the same input and fills in the comparison table.',
        unavailable: () => {
          if (!screen.comparing()) return 'The comparison strip is not showing. Turn compare on first.'
          if (screen.picked().length === 0) return 'Nothing is picked to compare. Set “comparing” to the algorithms to run.'
          return null
        },
        run: () => {
          screen.compare()
          return { picked: screen.picked().length }
        },
        verify: async (data) => {
          const want = (data as { picked: number }).picked
          await settle(() => screen.comparison().length >= want)
          const got = screen.comparison()
          return {
            done: got.length >= want && want > 0,
            detail: got.length ? `${got.length} algorithms ran on the same input: ${got.map((one) => `${one.name} in ${one.steps.length} steps`).join(', ')}.` : 'the comparison produced nothing.'
          }
        }
      }
    },
    state: (): StateDeclaration => {
      const steps = screen.steps()
      const pb = screen.playback
      const algorithm = chosen()
      const broke = brokeWith(steps)
      const shared = {
        algorithm: algorithm.name,
        category: algorithm.category,
        listed: screen.listed(),
        runsOn: onBoard() ? 'a board drawn under it' : takes() === 'string' ? 'text' : takes() === 'none' ? 'nothing it is given' : 'a list of numbers',
        input: screen.input(),
        averageComplexity: algorithm.complexity?.avg ?? 'not stated'
      }
      if (broke) return { activity: 'failed', detail: `${algorithm.name} could not be run: ${broke}`, values: shared }
      if (!steps?.length) {
        return { activity: 'idle', detail: `${algorithm.name} is chosen and nothing has been worked out yet. Run it.`, values: shared }
      }
      const at = steps[Math.min(pb.idx, steps.length - 1)]
      return {
        activity: pb.playing ? 'running' : pb.atEnd ? 'finished' : 'paused',
        detail: at?.desc ?? `Step ${pb.idx + 1} of ${steps.length}.`,
        // Only when there is more than one step to be between: one step is not nought per cent done.
        ...(steps.length > 1 ? { progress: pb.idx / (steps.length - 1) } : {}),
        values: { ...shared, steps: steps.length, step: pb.idx + 1, speed: pb.speed, playing: pb.playing, counts: countsOf(at), variables: at?.vars ?? {} }
      }
    }
  }
}

// ---------------------------------------------------------------- the animation

/**
 * The playback panel: the speed, which step is showing, and the seven buttons around it.
 *
 * Its own screen because it is its own panel, and because "open its animation settings and set the speed to 0.5x"
 * reaches it by name without anybody knowing it is called playback.
 */
export function algovizAnimationSurface(screen: AlgovizScreen, parent: string): SurfaceDeclaration {
  const pb = (): AlgovizPlayback => screen.playback
  const hasRun = (): true | string => (pb().total > 0 ? true : 'Nothing has been worked out yet. Run the algorithm first.')

  /** An action that moves through the steps, with the reading afterwards that says where it got to. */
  const move = (name: string, about: string, go: () => void, wanted: (before: { idx: number; playing: boolean }) => boolean, said: (now: AlgovizPlayback) => string): ActionDeclaration => ({
    name,
    about,
    unavailable: () => {
      const why = hasRun()
      return why === true ? null : why
    },
    run: () => {
      const before = { idx: pb().idx, playing: pb().playing }
      go()
      return before
    },
    verify: async (data: unknown) => {
      const before = data as { idx: number; playing: boolean }
      await settle(() => wanted(before))
      return { done: wanted(before), detail: said(pb()) }
    }
  })

  return {
    id: 'animation',
    parent,
    name: 'Animation settings',
    about: 'How fast the steps play, which step is showing, and the buttons that move through them.',
    kind: 'panel',
    keywords: ['animation', 'animation settings', 'speed', 'playback', 'player', 'timeline', 'step', 'steps', 'play', 'pause'],
    controls: {
      speed: {
        name: 'Speed',
        about: 'How fast the steps play. One is a step every 450 milliseconds; a half is twice as slow.',
        // The range is the laboratory's own: its buttons offer thirteen speeds and its slider runs between the ends.
        spec: { type: 'number', description: `How many steps a second, relative to normal. Between ${ALGOVIZ_SPEEDS[0]} and ${ALGOVIZ_SPEEDS[ALGOVIZ_SPEEDS.length - 1]}.`, min: ALGOVIZ_SPEEDS[0], max: ALGOVIZ_SPEEDS[ALGOVIZ_SPEEDS.length - 1] },
        get: () => pb().speed,
        // Changing the speed while it is playing never restarts the run, which is the laboratory's own behaviour.
        set: (value) => pb().setSpeed(Number(value)),
        default: 1
      },
      step: {
        name: 'Step',
        about: 'Which step is showing, counted the way the timeline counts it: 1 is the first.',
        spec: { type: 'integer', description: 'The step to show, from 1 to however many the run has.', min: 1, max: Math.max(1, pb().total) },
        get: () => {
          if (pb().total === 0) throw new Error('Nothing has been worked out yet, so there is no step to show.')
          return pb().idx + 1
        },
        writable: hasRun,
        set: (value) => pb().jump(Number(value) - 1)
      },
      playing: {
        name: 'Playing',
        about: 'Whether the steps are playing. The same switch as the play and pause button.',
        spec: { type: 'boolean', description: 'On plays the steps; off holds where it is.' },
        get: () => pb().playing,
        writable: hasRun,
        set: (on) => (on === true ? pb().play() : pb().pause())
      }
    },
    actions: {
      stop: move(
        'Stop',
        'Stops playing and goes back to the first step.',
        () => pb().stop(),
        () => !pb().playing && pb().idx === 0,
        (now) => `Stopped at step ${now.idx + 1} of ${now.total}.`
      ),
      restart: move(
        'Restart',
        'Goes back to the first step, stopped, so the run can be watched again.',
        () => pb().restart(),
        () => !pb().playing && pb().idx === 0,
        (now) => `Back at step ${now.idx + 1} of ${now.total}.`
      ),
      next: move(
        'Next step',
        'One step forward, and stops playing.',
        () => pb().next(),
        (before) => pb().idx > before.idx || pb().atEnd,
        (now) => `Showing step ${now.idx + 1} of ${now.total}.`
      ),
      previous: move(
        'Previous step',
        'One step back, and stops playing.',
        () => pb().prev(),
        (before) => pb().idx < before.idx || pb().idx === 0,
        (now) => `Showing step ${now.idx + 1} of ${now.total}.`
      ),
      toStart: move(
        'Jump to the start',
        'Shows the first step.',
        () => pb().toStart(),
        () => pb().idx === 0,
        (now) => `Showing step ${now.idx + 1} of ${now.total}.`
      ),
      toEnd: move(
        'Jump to the end',
        'Shows the last step, which is the finished result.',
        () => pb().toEnd(),
        () => pb().atEnd,
        (now) => `Showing step ${now.idx + 1} of ${now.total}, which is the last.`
      )
    },
    state: (): StateDeclaration => {
      const now = pb()
      const steps = screen.steps()
      if (now.total === 0) return { activity: 'idle', detail: 'Nothing has been worked out yet, so there is nothing to play.', values: { speed: now.speed } }
      const at = steps?.[Math.min(now.idx, steps.length - 1)]
      return {
        activity: now.playing ? 'running' : now.atEnd ? 'finished' : 'paused',
        detail: at?.desc ?? `Step ${now.idx + 1} of ${now.total}.`,
        ...(now.total > 1 ? { progress: now.idx / (now.total - 1) } : {}),
        values: { step: now.idx + 1, steps: now.total, speed: now.speed, playing: now.playing, counts: countsOf(at) }
      }
    }
  }
}
