import type { ParamSpec } from '../../../../shared/browserControl.ts'
import type { ActionDeclaration, ControlDeclaration, StateDeclaration, SurfaceDeclaration } from '../../lib/surfaces/registry.ts'
import { settle } from '../../lib/surfaces/settle.ts'

/**
 * What a laboratory, studio or simulation lets Orbis do -- built from the one the app itself declares.
 *
 * ## Why there is one of these rather than fifty
 *
 * Every Native App's controls are its **declared parameters**: an id, a name, a kind, a unit, a least and a most, a
 * list of options, whether it is worked out from the others. The panel on screen is drawn from that list, and so is
 * this. So a laboratory becomes controllable down to the parameter -- "set the launch speed to 25 m/s", "set the
 * field to gravitational" -- without anybody describing it twice, and an app added tomorrow is controllable the day
 * it registers.
 *
 * That is also why nothing here invents a range. A velocity of 25 m/s is valid and 25,000 may not be, and which it is
 * belongs to the simulation: `least` and `most` come from the app's own declaration and are passed straight through
 * to the `ParamSpec` the control layer checks a write against. A number outside them is refused with the range before
 * the runtime is touched.
 *
 * ## Setting goes through the runtime, never around it
 *
 * Every write calls `configure`, which is the same function the panel's own fields call. The runtime checks the range,
 * the unit and the dimension, and a value it refuses never reaches the engine -- it comes back as a sentence, which is
 * then what the write failed with. A setter that wrote into the component's own state would be a second way of
 * changing a parameter, and the two would disagree the first time the runtime refused something.
 *
 * ## An adopted Page's parameters are reported as unsettable, and that is the honest answer
 *
 * The thirty-odd laboratories adopted from Pages keep their values in their own text boxes and read the runtime's
 * values only when they first open. Setting one of those through the runtime therefore changes what Orbis holds and
 * **not what is on the screen** -- and the reading afterwards would come back as the new value, so it would be
 * reported as done. It says so instead.
 */

// ---------------------------------------------------------------- what the card hands over

/**
 * One declared parameter, as the live instance carries it to the panel.
 *
 * Written out here rather than imported from the panel, for one reason: the panel is a React file and this has to be
 * testable without one. It is the same shape (`LiveInstance['definitions'][number]`), and the card hands the real
 * thing straight in, so a field added there would be a type error here rather than a surprise.
 */
export interface LabParameter {
  id: string
  name: string
  /** One of the parameter system's kinds: number, integer, boolean, text, choice, vector, numbers, expression… */
  kind: string
  about: string
  unit?: string
  least?: number
  most?: number
  step?: number
  places?: number
  options?: readonly { id: string; label: string }[]
  group?: string
  /** Worked out from the others, so it cannot be set. */
  derived: boolean
}

/** The live instance as the card holds it. The same shape `surfaces.tsx` hands to every app. */
export interface NativeInstance {
  id: string
  appId: string
  appName: string
  /** `page` for a laboratory adopted from Pages, `native` for one built for this platform. */
  surface: { kind: string; ref: string }
  phase: string
  generation: number
  size: string
  values: Record<string, string | number | boolean | number[]>
  /** Each value as the app describes it, with its unit. For reading, never for setting. */
  described: Record<string, string>
  /** Which parameters are on screen now. The runtime works this out from each one's conditions. */
  shown: string[]
  definitions: readonly LabParameter[]
}

/** What the card has to hand over: live readers and the handlers its own buttons call. */
export interface NativeAppScreen {
  /** The app's id, from the pointer in the message. Known before the card has loaded anything. */
  appId: string
  /** What the card calls it. */
  name(): string
  /** The live instance, or null while the card is loading or when there is no app to show. */
  instance(): NativeInstance | null
  /** Why there is no app on screen -- closed, failed, gone, retired -- or null when there is one. */
  why(): string | null
  /** Whether the card is waiting for the runtime. */
  busy(): boolean
  /** Sets declared parameters through the runtime. Answers with the refusals by parameter id, or nothing. */
  configure(values: Record<string, unknown>): Promise<Readonly<Record<string, string>> | null>
  /** One of the runtime's own operations: run, pause, reset, resize, close. Answers with the instance it gave back. */
  act(operation: string, argument?: unknown): Promise<NativeInstance | null>
  /** Whether it is filling the window rather than sitting in the conversation. */
  fullPage(): boolean
  setFullPage(on: boolean): void
  /** The sizes it may be, from the manifest. */
  sizes: readonly string[]
}

/** A surface id from an app id: the app ids are already letters, digits and dashes, and this holds that true. */
export const surfaceIdFor = (appId: string): string => {
  const made = String(appId ?? '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^[a-zA-Z]/.test(made) ? made : `app-${made}`
}

// ---------------------------------------------------------------- a parameter as a control

/**
 * One declared parameter as a `ParamSpec`.
 *
 * The kinds are the parameter system's own (`src/shared/native/parameters.ts`) and each maps onto the one vocabulary
 * the control layer checks a value against. The unit goes in the description rather than being dropped: "25" means
 * nothing without "m/s", and the description is what somebody reads before setting it.
 */
export function specFor(one: LabParameter): ParamSpec {
  const about = one.unit !== undefined && one.unit !== '' ? `${one.about} In ${one.unit}.` : one.about
  const range = { ...(typeof one.least === 'number' ? { min: one.least } : {}), ...(typeof one.most === 'number' ? { max: one.most } : {}) }
  switch (one.kind) {
    case 'integer':
      return { type: 'integer', description: about, ...range }
    case 'number':
      return { type: 'number', description: about, ...range }
    case 'boolean':
      return { type: 'boolean', description: about }
    case 'choice':
      return { type: 'string', description: about, enum: (one.options ?? []).map((option) => option.id) }
    case 'vector':
    case 'numbers':
      return { type: 'array', description: `${about} A list of numbers.` }
    default:
      // text, expression, colour, a reference to something else: all of them are typed in.
      return { type: 'string', description: about }
  }
}

/**
 * Every declared parameter as a control, with the reason any of them cannot be set right now.
 *
 * Built from the declarations, so a parameter added to an app appears here in the same change -- which is the whole
 * point of the parameter system and the reason this file does not name a single laboratory.
 */
export function parameterControls(screen: NativeAppScreen): Record<string, ControlDeclaration> {
  const live = (): NativeInstance => {
    const held = screen.instance()
    if (!held) throw new Error(screen.why() ?? `${screen.name()} has not finished opening.`)
    return held
  }

  const out: Record<string, ControlDeclaration> = {}
  for (const one of screen.instance()?.definitions ?? []) {
    out[one.id] = {
      name: one.name,
      about: one.unit !== undefined && one.unit !== '' ? `${one.about} In ${one.unit}.` : one.about,
      spec: specFor(one),
      get: () => {
        const held = live()
        if (!(one.id in held.values)) throw new Error(`${one.name} has no value in ${held.appName} at the moment.`)
        return held.values[one.id]
      },
      /*
       * Said as a sentence with the fix in it, every time. A bare "it cannot be set" is a dead end, and each of these
       * three has something a caller can do about it.
       */
      writable: () => {
        const held = screen.instance()
        if (!held) return screen.why() ?? `${screen.name()} has not finished opening.`
        if (one.derived) return `${held.appName} works ${one.name} out from its other settings, so it cannot be set directly. Set those instead.`
        if (held.surface.kind === 'page') {
          return `${held.appName} keeps its values in its own boxes on screen. Setting ${one.name} here would change what Orbis holds and not what the laboratory shows, so it is not offered. Type it into the laboratory, or open it again to start from a new value.`
        }
        if (!held.shown.includes(one.id)) return `${one.name} is not on screen at the moment: ${held.appName} shows it only once its other settings call for it. Set those first.`
        return true
      },
      set: async (value) => {
        const refused = await screen.configure({ [one.id]: value })
        // The runtime's own sentence about why it would not take the value, which is the one worth reading.
        if (refused && refused[one.id]) throw new Error(refused[one.id])
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- the laboratory

/** Whether an app has a clock at all. `running` and `paused` mean nothing to a plotter. */
const hasClock = (phase: string): boolean => phase === 'running' || phase === 'paused'

/**
 * A Native App on screen: its parameters, its lifecycle buttons, how big it is, and what it is doing.
 *
 * Registered as a screen of its own rather than inside anything, because a card lives in a conversation and the
 * conversation does not describe itself. Opening a laboratory is asked for in the chat; once it is open, this is
 * everything that can be read, set and done on it.
 */
export function nativeAppSurface(screen: NativeAppScreen): SurfaceDeclaration {
  const instance = (): NativeInstance | null => screen.instance()
  const phase = (): string => instance()?.phase ?? 'loading'
  const named = (): string => instance()?.appName ?? screen.name()

  /** What the app was before an action, so what it is afterwards can be compared with something. */
  interface Before {
    phase: string
    generation: number
    values: Record<string, unknown>
  }
  const nowAt = (): Before => {
    const held = instance()
    return { phase: held?.phase ?? 'none', generation: held?.generation ?? -1, values: { ...(held?.values ?? {}) } }
  }

  /**
   * An action the runtime carries out, with the reading afterwards that says what it really did.
   *
   * `wanted` is asked of the app again after the runtime has answered, and it is given what the app was before --
   * because "it reset" is a change rather than a state, and an answer that cannot tell the two apart would report
   * every reset as done whether anything happened or not.
   */
  const operation = (
    name: string,
    about: string,
    input: {
      operation: string
      argument?: unknown
      stop?: () => string | null
      wanted: (before: Before) => boolean
      said: (before: Before) => string
      effects?: ActionDeclaration['effects']
      confirmation?: ActionDeclaration['confirmation']
    }
  ): ActionDeclaration => ({
    name,
    about,
    ...(input.effects ? { effects: input.effects } : {}),
    ...(input.confirmation ? { confirmation: input.confirmation } : {}),
    unavailable: () => {
      const held = instance()
      if (!held) return screen.why() ?? `${screen.name()} has not finished opening.`
      return input.stop ? input.stop() : null
    },
    run: async () => {
      const before = nowAt()
      const got = await screen.act(input.operation, input.argument)
      // What the runtime gave back, which is a reading of the app and not an echo of the request.
      return { before, after: got ? { phase: got.phase, generation: got.generation, size: got.size } : null }
    },
    verify: async (data) => {
      const before = (data as { before: Before }).before
      await settle(() => input.wanted(before))
      return { done: input.wanted(before), detail: input.said(before) }
    }
  })

  /** How many of the app's values are different from what they were. For saying what a reset actually did. */
  const changedSince = (before: Before): number => {
    const held = instance()
    if (!held) return 0
    return Object.keys(held.values).filter((id) => JSON.stringify(held.values[id] ?? null) !== JSON.stringify(before.values[id] ?? null)).length
  }

  return {
    id: surfaceIdFor(screen.appId),
    parent: null,
    name: named(),
    about: 'A laboratory open in the conversation: its settings, what it is doing, and the buttons on its card.',
    kind: 'tool',
    keywords: ['laboratory', 'lab', 'simulation', 'studio', 'experiment', 'app', screen.appId],
    controls: {
      ...parameterControls(screen),
      size: {
        name: 'Size',
        about: 'How much room the card takes: in the conversation, larger, or the whole workspace.',
        spec: { type: 'string', description: 'The size of the card.', enum: [...screen.sizes] },
        get: () => {
          const held = instance()
          if (!held) throw new Error(screen.why() ?? `${screen.name()} has not finished opening.`)
          return held.size
        },
        writable: () => (instance() ? true : (screen.why() ?? `${screen.name()} has not finished opening.`)),
        set: async (value) => void (await screen.act('resize', String(value)))
      },
      fullScreen: {
        name: 'Full screen',
        about: 'Opens the laboratory over the whole window, away from the conversation, or puts it back.',
        spec: { type: 'boolean', description: 'Whether it fills the window.' },
        get: () => screen.fullPage(),
        set: (on) => screen.setFullPage(on === true),
        default: false
      }
    },
    actions: {
      run: operation('Run', 'Starts the clock, for a laboratory that has one.', {
        operation: 'run',
        stop: () => {
          if (phase() === 'running') return `${named()} is already running. Pause it instead.`
          return hasClock(phase()) ? null : `${named()} has no clock to start: it works its answer out as soon as its settings change.`
        },
        wanted: () => phase() === 'running',
        said: () => (phase() === 'running' ? `${named()} is running.` : `${named()} is ${phase()}.`)
      }),
      pause: operation('Pause', 'Stops the clock where it is, for a laboratory that has one.', {
        operation: 'pause',
        stop: () => (phase() === 'running' ? null : `${named()} is not running, so there is nothing to pause.`),
        wanted: () => phase() === 'paused',
        said: () => (phase() === 'paused' ? `${named()} is paused.` : `${named()} is ${phase()}.`)
      }),
      reset: operation('Put back to its starting values', 'Every setting back to the value the app opened with.', {
        operation: 'reset',
        /*
         * The runtime counts a change on the instance, so a reset that was really applied is one the app now counts
         * higher than it did. Without that there is nothing to tell a reset from a request that went nowhere.
         */
        wanted: (before) => (instance()?.generation ?? -1) > before.generation,
        said: (before) => {
          const held = instance()
          if (!held) return `${named()} did not answer, so nothing can be said about its values.`
          if (held.generation <= before.generation) return `${held.appName} did not report any change, so it may not have been put back.`
          const changed = changedSince(before)
          return changed === 0
            ? `${held.appName} is back at its starting values, and nothing was different from them.`
            : `${held.appName} is back at its starting values: ${changed} of its ${Object.keys(held.values).length} settings changed.`
        }
      }),
      close: operation('Close', 'Ends this laboratory. What it was showing is gone, and the card says so.', {
        operation: 'close',
        // Closing ends the app and what it held, which is more than changing what is on screen.
        effects: ['delete'],
        confirmation: 'always',
        wanted: () => instance() === null || phase() === 'closed',
        said: () => (instance() === null || phase() === 'closed' ? `${named()} is closed.` : `${named()} is still ${phase()}.`)
      })
    },
    state: (): StateDeclaration => {
      const held = instance()
      const why = screen.why()
      if (!held) return { activity: why === null ? 'idle' : 'failed', detail: why ?? `${screen.name()} has not finished opening.` }
      const hidden = held.definitions.filter((one) => !held.shown.includes(one.id)).map((one) => one.id)
      /*
       * What the app says about its own values, with their units, rather than the raw numbers.
       *
       * The described form is the app's: "9.81 m/s²", "quadratic -- ordinary speeds in air". It is right for reading
       * and wrong for setting, which is why the controls above use `values` and this does not.
       */
      const reports = Object.fromEntries(held.shown.map((id) => [id, held.described[id] ?? held.values[id]]).filter(([, value]) => value !== undefined))
      return {
        activity: screen.busy() ? 'running' : held.phase === 'running' ? 'running' : held.phase === 'paused' ? 'paused' : held.phase === 'error' ? 'failed' : held.phase === 'closed' ? 'finished' : 'idle',
        detail: screen.busy() ? `${held.appName} is working something out.` : `${held.appName} is ${held.phase}.`,
        values: {
          app: held.appId,
          /* Which copy, so two cards of the same laboratory in one conversation can be told apart. */
          instance: held.id,
          phase: held.phase,
          size: held.size,
          settings: held.definitions.length,
          onScreen: held.shown.length,
          ...(hidden.length ? { notOnScreen: hidden } : {}),
          ...(held.surface.kind === 'page' ? { valuesAreTypedIn: true } : {}),
          reports
        }
      }
    }
  }
}

// ---------------------------------------------------------------- the frame a laboratory wears

/** What the shared laboratory frame has to hand over: the view it is showing and what the engine said. */
export interface LabViewScreen {
  /** The app the frame belongs to, so this is registered inside it rather than on its own. */
  appId: string | null
  title: string
  tabs: readonly { id: string; label: string }[]
  showing(): string | null
  show(id: string): void
  busy(): boolean
  ready(): boolean
  /** The engine's own refusal: a sentence about what was asked for, not a fault. */
  refused(): { says: string; fix: string } | null
  /** A fault in Orbis rather than in what was asked. */
  broke(): string | null
  /** What the engine says it does not model. From the engine, never written by the screen. */
  assumptions(): readonly string[]
}

/**
 * The view chooser on a laboratory's own frame, and what the engine said about the last answer.
 *
 * A screen of its own, inside the app's, because the tabs are the laboratory's own state rather than one of its
 * declared parameters -- so the parameter panel cannot describe them and nothing else could reach them. "Show me its
 * truth table" is a tab, not a setting.
 */
export function labViewSurface(screen: LabViewScreen): SurfaceDeclaration {
  const chosen = (): string | null => screen.showing()
  const labelOf = (id: string | null): string => screen.tabs.find((one) => one.id === id)?.label ?? ''

  return {
    /*
     * Inside the app's own screen, by its id.
     *
     * A frame drawn without a live app has nothing to be inside, so it takes a name of its own instead of claiming
     * `view` at the top level, where a second one would collide with it and both would be reported as a clash.
     */
    id: screen.appId === null ? `${surfaceIdFor(screen.title)}-view` : 'view',
    parent: screen.appId === null ? null : surfaceIdFor(screen.appId),
    name: 'What to show',
    about: 'Which of the laboratory’s views is on screen, and what its engine said about the last answer.',
    kind: 'panel',
    /*
     * Not `showing`, which is the control on it.
     *
     * A surface is matched before a control at every level, so a keyword here that is also a control's id would take
     * the path -- and a write would be refused with "that is a screen, not something that holds a value" about a
     * control that was there all along. The test found exactly that.
     */
    keywords: ['view', 'views', 'tab', 'tabs', 'panel'],
    controls: {
      showing: {
        name: 'Showing',
        about: 'Which view the laboratory is on.',
        spec: {
          type: 'string',
          /*
           * The ids are what may be written, and the words on each tab are named beside them.
           *
           * A value has to be one of the ids -- that is what the laboratory switches on -- and "Its truth table" is
           * what somebody reads on screen. Saying both here is what lets whoever is choosing pick the right id first
           * time instead of being refused once and told the list.
           */
          description: `One of the laboratory’s views: ${screen.tabs.map((one) => `${one.id} (${one.label})`).join(', ')}.`,
          enum: screen.tabs.map((one) => one.id)
        },
        get: () => {
          const now = chosen()
          if (now === null) throw new Error(`${screen.title} is not on any of its views yet.`)
          return now
        },
        writable: () => (screen.tabs.length > 0 ? true : `${screen.title} has only one view, so there is nothing to switch.`),
        set: (value) => screen.show(String(value))
      }
    },
    actions: {},
    state: (): StateDeclaration => {
      const broke = screen.broke()
      const refused = screen.refused()
      const shared = {
        view: chosen() ?? 'none',
        views: screen.tabs.map((one) => one.id),
        /* The engine's own list of what it does not model, which is often the most useful thing on the screen. */
        ...(screen.assumptions().length ? { doesNotModel: [...screen.assumptions()] } : {})
      }
      if (broke !== null && broke !== '') return { activity: 'failed', detail: broke, values: shared }
      if (refused !== null) return { activity: 'failed', detail: `${refused.says} ${refused.fix}`, values: shared }
      if (screen.busy()) return { activity: 'running', detail: `${screen.title} is working it out.`, values: shared }
      if (!screen.ready()) return { activity: 'idle', detail: `${screen.title} has not worked anything out yet.`, values: shared }
      return { activity: 'finished', detail: `${screen.title} is showing ${labelOf(chosen()) || 'its answer'}.`, values: shared }
    }
  }
}
