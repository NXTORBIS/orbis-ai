import type { ControlSource, ControlTarget, ParamSpec, WindowRunResult } from '../../shared/browserControl.ts'
import type { SurfaceDescriptor, SurfaceLookup, SurfaceOutcome, SurfaceTree } from '../../shared/surfaces.ts'
import { coerceForSpec, joinPath, planNextStep, resolveSurfacePath, sayValue, SURFACE_CALLS } from '../../shared/surfaces.ts'
import { BrowserControl, fail } from './registry.ts'
import type { CapabilityDefinition, ControlContext } from './registry.ts'

/**
 * Reaching inside the Orbis window's own screens.
 *
 * The rest of the control layer drives the browser and the shell: open a module, change a setting, work a web page.
 * It stops at the outside of Orbis's own screens -- it can open Chess World and not reach the panel inside it, open a
 * simulation and not change a parameter in it. Opening something is the first step of the job, not the job.
 *
 * These six are the rest of it, and they are ordinary capabilities: registered on the same registry as the other
 * seventy-four, so the switches, the effect policy, the tab lock, the approval prompts, the retries, the undo journal
 * and the log all apply to them without a line of new code. What is new is only where the work happens -- in the
 * window, by the screens themselves, through the register in `src/renderer/src/lib/surfaces`.
 *
 * None of them knows the name of a single Orbis screen. A screen says what it can do and these pass the question on,
 * so a new module becomes controllable by registering itself rather than by anybody editing this file.
 */

/** How these capabilities reach the window. The real one is `WindowControl.ask`. */
export interface SurfaceBridge {
  /** Asks the window one of the screens questions (`SURFACE_CALLS`). */
  ask(call: string, params: Record<string, unknown>, ctx: { source: ControlSource; target?: ControlTarget; signal?: AbortSignal }): Promise<WindowRunResult>
  /** Whether there is a window to ask at all. */
  open(): boolean
  /**
   * Why a screen is not in this person's menu, in words, or null when it is.
   *
   * People choose which of Orbis's screens they see, so a screen that is switched off is not registered and is not
   * in the tree -- which looks exactly like a screen that does not exist. **Those are different answers.** "Orbis
   * cannot get to Markets" invites Orion to give up or to claim Orbis has no such thing; "Markets is switched off,
   * everything in it is still there, turn it on and it is back" is the truth and something somebody can act on.
   *
   * Optional, because the control layer works without it -- and when it is missing a hidden screen is reported the
   * old way rather than reported wrongly.
   */
  hidden?(path: string): Promise<string | null>
}

/** How many steps a walk to a screen may take before it is a loop rather than a route. */
const MAX_STEPS = 8

/**
 * How long a screen has to appear after Orbis has asked for it.
 *
 * Opening a page is not one change: the control changes, then the window draws, then the page that was drawn
 * registers itself. Reading the tree straight after the first of those finds nothing, which looks exactly like a step
 * that did not work. So the walk waits for the screen it asked for before deciding anything about it.
 */
const APPEAR_MS = 1500

/** What `surface.read` answers. Named here because two capabilities below read a control before touching it. */
interface Reading {
  name: string
  type: ParamSpec['type']
  value: unknown
  readable: boolean
  writable: boolean
  values?: string[]
  min?: number
  max?: number
}

const PATH: ParamSpec = {
  type: 'string',
  description: 'Where it is, as names separated by slashes: "settings/notifications/quietHours". Leaving a level out is fine when only one thing answers to the name, and so is saying what is on screen ("quiet hours") rather than what the code calls it.',
  required: true
}

/** A capability the Orbis window carries out, which is what all six of these are. */
type WindowCapability<S> = CapabilityDefinition<S> & { provider: 'window' }

export function registerSurfaceCapabilities(control: BrowserControl, bridge: SurfaceBridge): void {
  const unavailable = (): string | null => (bridge.open() ? null : 'The Orbis window is not open, so none of its screens exist to be used.')
  const common = { domain: 'screens' as const, provider: 'window' as const, unavailable }
  /*
   * `provider` says the work happens in the window rather than here, and the registry carries it through to the
   * descriptor. It is not part of what a capability must declare, which is why this is one helper rather than a cast
   * at each of the six.
   */
  const add = <S>(definition: WindowCapability<S>): void => control.register(definition)

  /** Asks the window, and turns a refusal into the failure the control layer understands. */
  const ask = async <T>(call: string, params: Record<string, unknown>, ctx: ControlContext): Promise<T> => {
    const result = await bridge.ask(call, params, ctx)
    if (!result.ok) fail(result.error?.code ?? 'failed', result.error?.message ?? 'The Orbis window did not say what went wrong.', result.error?.recoverable ?? false)
    return result.data as T
  }

  const treeNow = async (ctx: ControlContext, path?: string): Promise<SurfaceTree> => {
    const got = await ask<{ surfaces: SurfaceDescriptor[] }>(SURFACE_CALLS.tree, path ? { path } : {}, ctx)
    return got.surfaces ?? []
  }

  /** Waits for a screen to turn up after Orbis has asked for it, and gives up saying so rather than waiting for ever. */
  const waitFor = async (ctx: ControlContext, path: string): Promise<boolean> => {
    const end = Date.now() + APPEAR_MS
    for (;;) {
      if ((await treeNow(ctx)).some((one) => one.path === path)) return true
      if (ctx.signal?.aborted || Date.now() >= end) return false
      await new Promise((wake) => setTimeout(wake, 60))
    }
  }

  /*
   * What the window said about whether something worked, kept until `verify` is asked.
   *
   * By context object, which is this call's own: the same way the window's other capabilities carry their
   * verification back in `window.ts`. A field on the layer would be shared between calls, and two writes at once
   * would confirm each other.
   */
  const answers = new WeakMap<ControlContext, { verified: boolean; detail: string }>()

  const perform = async (call: string, params: Record<string, unknown>, ctx: ControlContext): Promise<SurfaceOutcome> => {
    const result = await bridge.ask(call, params, ctx)
    if (!result.ok) fail(result.error?.code ?? 'failed', result.error?.message ?? 'The Orbis window did not say what went wrong.', result.error?.recoverable ?? false)
    answers.set(ctx, result.verification ?? { verified: false, detail: 'The window did not say whether it worked.' })
    return result.data as SurfaceOutcome
  }

  // ---------------------------------------------------------------- looking

  add({
    ...common,
    id: 'screen.tree',
    name: 'What is on the Orbis screens',
    description:
      'Lists what Orbis has on screen that can be used: every module, page, panel and dialog that is open, with the controls on each (type, value, range, whether it can be set), what can be done there, and what it is doing now. Start here: nothing else needs a list of Orbis features, because this is read from the screens themselves.',
    keywords: ['screen', 'screens', 'panel', 'panels', 'page', 'module', 'dialog', 'control', 'controls', 'setting', 'inside', 'what is open', 'what can i change'],
    params: {
      path: { type: 'string', description: 'Only this screen and what is inside it. Leave out for everything.' },
      depth: { type: 'integer', description: 'How many levels below the starting point: 0 for just that screen. Leave out for all of it.', min: 0, max: 10 }
    },
    mutates: false,
    confirmation: 'none',
    returns: {
      surfaces: { type: 'array', description: 'The screens, flat, each with its path and its parent’s.', required: true },
      count: { type: 'integer', description: 'How many came back.', required: true },
      registered: { type: 'integer', description: 'How many screens are registered altogether, so an empty answer can be told from no screens at all.', required: true },
      wiring: {
        type: 'array',
        description:
          'Places where Orbis’s own screens disagree with each other: a way into a screen that names a control the screen has not got, two screens claiming one path, a button whose name a setting has already taken. Absent when there are none. These are faults in Orbis rather than anything the person did, and a screen named here may be impossible to open until it is fixed — so say so plainly instead of trying the same route again.'
      }
    },
    run: (p, ctx) => ask(SURFACE_CALLS.tree, { ...(p.path ? { path: String(p.path) } : {}), ...(p.depth === undefined ? {} : { depth: Number(p.depth) }) }, ctx)
  })

  add({
    ...common,
    id: 'screen.state',
    name: 'What an Orbis screen is doing',
    description:
      'What one screen reports about itself right now: whether it is in front of you, whether something is running, paused, finished or failed, how far along it is when it really measures that, and whatever else that screen reports.',
    keywords: ['state', 'status', 'running', 'busy', 'progress', 'finished', 'failed', 'what is it doing'],
    params: { path: PATH },
    mutates: false,
    confirmation: 'none',
    returns: {
      path: { type: 'string', description: 'The screen this is about.', required: true },
      name: { type: 'string', description: 'What it is called on screen.', required: true },
      state: { type: 'object', description: 'present, activity, and whatever else it reports.', required: true }
    },
    run: (p, ctx) => ask(SURFACE_CALLS.state, { path: String(p.path) }, ctx)
  })

  add({
    ...common,
    id: 'screen.read',
    name: 'Read a control on an Orbis screen',
    description:
      'One control on one screen: what it is set to, what it may be set to (its type, its range or its list of values), and whether it can be set at all right now. A value that could not be read says so rather than coming back as nothing.',
    keywords: ['read', 'value', 'what is it set to', 'setting', 'slider', 'switch', 'checkbox', 'field'],
    params: { path: PATH },
    mutates: false,
    confirmation: 'none',
    returns: {
      path: { type: 'string', description: 'The control this is about.', required: true },
      name: { type: 'string', description: 'What it is called on screen.', required: true },
      on: { type: 'string', description: 'The screen it is on.', required: true },
      type: { type: 'string', description: 'What kind of value it holds.', required: true },
      value: { type: 'any', description: 'What it is set to. Only a reading when `readable` is true.' },
      readable: { type: 'boolean', description: 'Whether the value above was really read.', required: true },
      writable: { type: 'boolean', description: 'Whether it can be set right now.', required: true }
    },
    run: (p, ctx) => ask(SURFACE_CALLS.read, { path: String(p.path) }, ctx)
  })

  // ---------------------------------------------------------------- changing

  add({
    ...common,
    id: 'screen.write',
    name: 'Set a control on an Orbis screen',
    description:
      "Sets one control on one screen -- a switch, a slider, a box, a chooser -- checked against that control's own type, range and list of values before anything is touched, and read back afterwards. The answer says what the value actually became, which is not always what was asked for: a screen may round it, clamp it or refuse it.",
    // "on" and "off" on their own as well as the phrases: "turn it on" is how this is asked for, and the two little
    // words are the only part of that sentence which says what was wanted.
    keywords: ['set', 'change', 'turn on', 'turn off', 'on', 'off', 'slider', 'switch', 'value', 'adjust', 'depth', 'speed'],
    params: {
      path: PATH,
      value: { type: 'any', description: "What to set it to. It is checked against the control's own spec first, so a number outside the range is refused with the range rather than quietly clamped.", required: true }
    },
    mutates: true,
    /*
     * A control that does more than change what is on screen asks first.
     *
     * The capability can only declare one kind of effect, and the honest one for "set a control" is a write. A
     * control that deletes something or sends something declares that for itself, and `assess` below turns that into
     * an approval. Said here because the effect policy is checked against the line above, not against the control.
     */
    effects: ['write'],
    confirmation: 'when-consequential',
    describe: (p) => `Set ${String(p.path)} to ${typeof p.value === 'object' ? JSON.stringify(p.value) : String(p.value)}`,
    assess: async (p, ctx) => {
      if (ctx.source === 'user') return { decision: 'run', reason: '' }
      const found = await ask<SurfaceLookup>(SURFACE_CALLS.lookup, { path: String(p.path) }, ctx).catch(() => null)
      if (!found) return { decision: 'run', reason: '' }
      if (found.confirmation === 'always') return { decision: 'confirm', reason: `${found.name} always asks first.` }
      const beyond = (found.effects ?? []).filter((one) => one !== 'read' && one !== 'write')
      return beyond.length ? { decision: 'confirm', reason: `Setting ${found.name} does more than change what is on screen: it would ${beyond.join(' and ')}.` } : { decision: 'run', reason: '' }
    },
    /*
     * A control that already holds this value is not set again.
     *
     * Checked by reading it, not assumed. The reading is a moment old either way -- it is the same reading a write
     * would be confirmed against -- and the sentence that comes back says "already", which is a different and more
     * useful thing for somebody to read than "now".
     */
    already: async (p, ctx) => {
      const got = await ask<Reading>(SURFACE_CALLS.read, { path: String(p.path) }, ctx).catch(() => null)
      if (!got?.readable) return null
      const wanted = coerceForSpec({ type: got.type, description: '', ...(got.values ? { enum: got.values } : {}), ...(got.min === undefined ? {} : { min: got.min }), ...(got.max === undefined ? {} : { max: got.max }) }, p.value)
      return JSON.stringify(wanted.value ?? null) === JSON.stringify(got.value ?? null) ? `${got.name} is already ${sayValue(got.value)}.` : null
    },
    observe: (p, ctx) => ask<Reading>(SURFACE_CALLS.read, { path: String(p.path) }, ctx).catch(() => null),
    run: (p, ctx) => perform(SURFACE_CALLS.write, { path: String(p.path), value: p.value }, ctx),
    /*
     * A write is confirmed only when the control reads back as what it was set to.
     *
     * Strict on purpose, and safe to be strict about: setting the same control to the same value twice is the same as
     * setting it once, so a retry costs nothing and a quiet no-op -- a disabled control, a setter that saved nothing,
     * a screen that took the value and went away -- is caught here instead of being reported as done.
     */
    verify: (data, _p, ctx) => {
      const said = answers.get(ctx)
      const outcome = data as SurfaceOutcome
      return { verified: outcome?.status === 'completed', detail: said?.detail ?? outcome?.detail ?? 'The window did not say whether it worked.' }
    },
    undo: (record) => {
      const before = record.before as { value: unknown; readable: boolean; writable: boolean } | null
      const outcome = record.data as SurfaceOutcome
      // Only when there is a value to go back to that was really read, and the control could be set at the time.
      if (!before?.readable || !before.writable || outcome?.status !== 'completed') return null
      return { capability: 'screen.write', params: { path: String(record.params.path), value: before.value } }
    }
  })

  add({
    ...common,
    id: 'screen.do',
    name: 'Do something on an Orbis screen',
    description:
      'Does one of the things a screen says can be done there -- press its button, start its tool, reset it. The answer says what really happened: confirmed when the screen checked it afterwards, and carried out but unconfirmed when the screen has nothing to check against.',
    keywords: ['do', 'press', 'run', 'start', 'reset', 'button', 'action', 'send', 'clear'],
    params: { path: PATH, params: { type: 'object', description: 'What it needs, when it needs anything. Each one is checked against what the screen says it takes.' } },
    mutates: true,
    /*
     * Pressing a button on an Orbis screen is a write, not a run.
     *
     * "Run things" in the effect switches means starting another program or running a query on a page, and classing
     * every button in Orbis as that would mean being asked before any of them could be pressed. An action that really
     * does more -- removes something, sends something, unlocks something -- declares that for itself, and `assess`
     * below turns it into an approval.
     */
    effects: ['write'],
    confirmation: 'when-consequential',
    describe: (p) => `Do ${String(p.path)} in Orbis`,
    assess: async (p, ctx) => {
      if (ctx.source === 'user') return { decision: 'run', reason: '' }
      const found = await ask<SurfaceLookup>(SURFACE_CALLS.lookup, { path: String(p.path) }, ctx).catch(() => null)
      if (!found) return { decision: 'run', reason: '' }
      if (found.unavailableReason) return { decision: 'block', reason: `${found.name} cannot be done right now. ${found.unavailableReason}` }
      if (found.confirmation === 'always') return { decision: 'confirm', reason: `${found.name} always asks first.` }
      const beyond = (found.effects ?? []).filter((one) => one === 'delete' || one === 'communicate' || one === 'authenticate')
      return beyond.length ? { decision: 'confirm', reason: `${found.name} would ${beyond.join(' and ')}.` } : { decision: 'run', reason: '' }
    },
    run: (p, ctx) => perform(SURFACE_CALLS.run, { path: String(p.path), params: (p.params ?? {}) as Record<string, unknown> }, ctx),
    /*
     * An action that was carried out is reported as carried out, and the detail says whether anything confirmed it.
     *
     * Unlike a write, this cannot be strict. A retry is what a caller does with a failure, and an action tried twice
     * is a message sent twice or a game started twice -- so an action the screen cannot check is reported with those
     * words in `verification.detail` and `status: "attempted"` in the data, rather than as a failure that invites
     * somebody to do it again.
     */
    verify: (data, _p, ctx) => {
      const said = answers.get(ctx)
      const outcome = data as SurfaceOutcome
      return { verified: outcome?.status === 'completed' || outcome?.status === 'attempted', detail: said?.detail ?? outcome?.detail ?? 'The window did not say whether it worked.' }
    }
  })

  // ---------------------------------------------------------------- getting there

  add({
    ...common,
    id: 'screen.goTo',
    name: 'Open an Orbis screen',
    description:
      'Opens a screen, and whatever has to be opened on the way. Reaching a panel inside a game inside a module may mean opening the module, going to one of its pages, opening a game and expanding a panel -- none of which anybody asked for by name. Each step is taken on the real screen and checked before the next one, and a step that cannot be taken is reported as that rather than as the whole thing failing silently.',
    keywords: ['open', 'go to', 'show', 'navigate', 'switch to', 'reach', 'expand', 'panel'],
    params: { path: PATH },
    mutates: true,
    effects: ['write'],
    confirmation: 'none',
    describe: (p) => `Open ${String(p.path)} in Orbis`,
    returns: {
      path: { type: 'string', description: 'Where it got to.', required: true },
      opened: { type: 'array', description: 'What had to be opened on the way, in the order it was opened.', required: true },
      alreadyThere: { type: 'boolean', description: 'True when nothing had to be opened.', required: true }
    },
    run: async (p, ctx) => {
      const wanted = String(p.path)
      const opened: string[] = []
      const tried = new Set<string>()
      for (let step = 0; step <= MAX_STEPS; step++) {
        const tree = await treeNow(ctx)
        /*
         * Already there is asked the forgiving way, and the route the strict way.
         *
         * They are different questions. Whether somebody is already looking at a thing can be answered however they
         * named it -- a level left out, the words on screen. A route cannot: a step through a level nobody mentioned
         * would be Orbis opening something on a guess, so the walk only follows what a parent says it can open.
         */
        const already = resolveSurfacePath(tree, wanted)
        if (already.kind !== 'miss') return { path: already.surface.path, opened, alreadyThere: opened.length === 0 }
        const plan = planNextStep(tree, wanted)
        if (plan.arrived) return { path: plan.target, opened, alreadyThere: opened.length === 0 }
        if (!plan.next) {
          /*
           * Switched off is not missing.
           *
           * A screen somebody has taken out of their menu is not mounted, so it is in no tree and the walk cannot
           * reach it. Asked before giving up, because the two answers lead somewhere different: this one says what
           * is true and what to do about it, and it is recoverable -- turning the screen on is a thing that can be
           * done -- where "there is no such screen" is not.
           */
          const why = (await bridge.hidden?.(wanted)) ?? null
          if (why !== null) fail('unavailable', why, true)
          fail('not-found', plan.stuck ?? `Orbis cannot get to “${wanted}” from what is on screen.`, false)
        }
        const next = plan.next!
        /*
         * The same step twice means the step did not do what the screen said it would.
         *
         * Without this the walk goes round for ever on a tab that will not switch or a panel that will not expand,
         * and the person is told nothing at all. Said once, with the step that failed named, it is something somebody
         * can act on.
         */
        const key = `${next.on} → ${next.path}`
        if (tried.has(key))
          fail(
            'failed',
            next.reach.kind === 'always'
              ? `${next.name} says it is there as soon as ${next.on} is, and after waiting it has not said what can be done on it. Either it does not register itself, or it could not load. Nothing further was tried.`
              : `Orbis asked ${next.on} to open ${next.name}, waited, and it did not appear. Either it does not open that way, or nothing on it has said what can be done there. Nothing further was tried.`,
            false
          )
        tried.add(key)

        if (next.reach.kind === 'control') {
          await perform(SURFACE_CALLS.write, { path: joinPath(next.on, next.reach.control), value: next.reach.value }, ctx)
          opened.push(next.path)
        } else if (next.reach.kind === 'action') {
          await perform(SURFACE_CALLS.run, { path: joinPath(next.on, next.reach.action), params: next.reach.params ?? {} }, ctx)
          opened.push(next.path)
        } else if (next.reach.kind !== 'always') {
          fail('blocked', `${next.name} cannot be opened by Orbis: ${next.reach.kind === 'manual' ? next.reach.how : 'it does not say how.'}`, false)
        }
        /*
         * A child that is simply there once its parent is has nothing to press -- only to wait for.
         *
         * Opening a page is three changes and the third is the page saying what is on it; a part of that page which
         * is loaded with it (the Customize centre inside Settings → Appearance) is a fourth, a moment later. Treating
         * that as "it does not say how to open it" made a step that only needed waiting for into a dead end, and
         * nothing is added to `opened` for it because nothing was opened.
         */
        // Given its moment to turn up. Not waited on as a condition of going on: if it has not appeared the loop
        // comes round, finds the same step again and says so, which is the message somebody can act on.
        await waitFor(ctx, next.path)
      }
      return fail('failed', `Orbis took ${MAX_STEPS} steps towards “${wanted}” and did not get there. It stopped rather than going on.`, false)
    },
    verify: async (data, _p, ctx) => {
      const got = data as { path: string; opened: string[] }
      const again = resolveSurfacePath(await treeNow(ctx), got.path, { skipLevels: false })
      if (again.kind === 'miss') return { verified: false, detail: `${got.path} is still not on screen: ${again.message}` }
      const where = again.surface
      return {
        verified: true,
        detail: got.opened.length ? `${where.name} is open. Orbis opened ${got.opened.join(', then ')} to get there.` : `${where.name} was already open.`
      }
    }
  })

  /*
   * The screens, in the state Orion is given with a question.
   *
   * Shallow on purpose -- the roots and what is directly inside them -- because this is read whenever the state is
   * taken and the whole tree of every control is far more than a sentence about what is on screen needs. Anything
   * deeper is one `screen.tree` away, which is what the description of that capability is for.
   */
  control.registerState('screens', async () => {
    if (!bridge.open()) return { unavailable: 'The Orbis window is not open.' }
    const result = await bridge.ask(SURFACE_CALLS.tree, { depth: 1 }, { source: 'user' })
    if (!result.ok) return { unavailable: result.error?.message ?? 'The Orbis window did not answer about its screens.' }
    const got = result.data as { surfaces: SurfaceDescriptor[]; registered: number }
    return {
      registered: got.registered,
      screens: (got.surfaces ?? []).map((one) => ({
        path: one.path,
        name: one.name,
        kind: one.kind,
        activity: one.state.activity,
        controls: one.controls.length,
        actions: one.actions.length,
        canOpen: (one.possibleChildren ?? []).map((child) => child.id)
      }))
    }
  })
}
