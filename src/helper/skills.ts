import { SkillManager } from '../main/skillManager.ts'
import type { CapabilityDescriptor } from '../shared/browserControl.ts'
import type { SkillEdits, SkillSettings } from '../shared/skills.ts'
import type { StepSession } from '../shared/stepPlan.ts'
import type { WorkflowEngineLike, WorkflowsDeps } from './workflows.ts'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * Learned skills for the panel: the same SkillManager Electron Orbis uses, over the same files in this profile's own
 * folder, so a skill kept in one place is the same skill in the other.
 *
 * A skill's procedure is an ordinary workflow, saved, versioned and run by the workflow engine. That is why everything
 * here is read through the deps on every call: without a workflow engine this helper has no skills, and says so,
 * rather than answering with a skills surface that cannot do anything. When the helper runs inside Orbis the app lends
 * its own manager, so the two never keep separate ideas of the library.
 *
 * Every channel the Orbis window has is here, and each is backed by a real SkillManager method, with one condition:
 * `skills:preview` and `skills:save` learn from a finished step-by-step run, and this helper runs none itself, so they
 * exist only when the app lends its runs through `finishedRun`. Nothing here stubs a channel: if it is present it
 * works, and if it cannot work it says why.
 *
 * `skills:run` hands the workflow to the engine as automation (trigger `orion`), which is what makes it ask before
 * anything consequential, every time. Nothing in this file confirms anything on the person's behalf, and a run's own
 * variables never come back through here: the panel follows a run through `workflows:status`, which already decides
 * how much of a run may be seen.
 */

export interface SkillsDeps {
  /** The app's own manager when the helper runs inside Orbis; without it the helper makes one over the same files. */
  manager?(): SkillManager | null | undefined
  /** The folder the app's other stores are given, with this profile's own folder inside it. Needed to make a manager. */
  userData?: string
  profileId?: string
  /** The workflow engine, read at call time: it may come into being, or be replaced, under a running helper. */
  workflows(): WorkflowsDeps | null | undefined
  /**
   * What the browser can do right now. Null means there is no browser to ask, which is a different answer from a
   * browser that can do nothing, and a skill cannot be judged against a browser that is not there.
   */
  capabilities(): CapabilityDescriptor[] | null | undefined
  /** The address of the page in front, read here rather than taken from the page, so a skill matches the real site. */
  currentUrl?(): string | null | undefined
  /** Told when the library changes, so whatever shows skills can reload them. */
  announce?(): void
  /** A finished step-by-step run, when the app lends its runs. Without it there is nothing to learn a skill from. */
  finishedRun?(runId: string): Promise<StepSession | null | undefined> | StepSession | null | undefined
}

const ID = /^[A-Za-z0-9_-]{1,80}$/
const MAX_REQUEST = 2000
const MAX_IMPORT = 2_000_000

const bad = (message: string): HelperError => new HelperError('bad-request', message)

function line(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw bad(`${field} must be text of at most ${max} characters.`)
  return value
}

function identifier(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw bad(`Expected ${what}.`)
  return value
}

function readEdits(value: unknown): SkillEdits {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw bad('The changes must be an object.')
  const v = value as Record<string, unknown>
  if (v.domains !== undefined && (!Array.isArray(v.domains) || v.domains.length > 20)) throw bad('domains must be a list of at most 20 sites.')
  return {
    ...(v.name !== undefined ? { name: line(v.name, 'name', 80) } : {}),
    ...(v.whenToUse !== undefined ? { whenToUse: line(v.whenToUse, 'whenToUse', 300) } : {}),
    ...(v.category !== undefined ? { category: line(v.category, 'category', 40) } : {}),
    ...(Array.isArray(v.domains) ? { domains: v.domains.map((d) => line(d, 'a site', 100)) } : {})
  }
}

function readSettings(value: unknown): Partial<SkillSettings> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw bad('The settings must be an object.')
  const v = value as Record<string, unknown>
  const flag = (x: unknown, field: string): boolean => {
    if (typeof x !== 'boolean') throw bad(`${field} must be true or false.`)
    return x
  }
  if (v.reuse !== undefined && v.reuse !== 'never' && v.reuse !== 'suggest' && v.reuse !== 'auto') throw bad('reuse must be never, suggest or auto.')
  return {
    ...(v.enabled !== undefined ? { enabled: flag(v.enabled, 'enabled') } : {}),
    ...(v.learnFromRuns !== undefined ? { learnFromRuns: flag(v.learnFromRuns, 'learnFromRuns') } : {}),
    ...(v.reuse !== undefined ? { reuse: v.reuse as SkillSettings['reuse'] } : {})
  }
}

/** A skill's inputs are what somebody typed, so text is all they ever are; anything else is a mistake worth naming. */
function readInputs(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw bad('inputs must be an object.')
  const out: Record<string, unknown> = {}
  for (const [name, given] of Object.entries(value as Record<string, unknown>)) {
    if (!name || name.length > 100 || name === '__proto__') throw bad('An input is not named properly.')
    out[name] = line(given, `input ${name}`, 2000)
  }
  return out
}

export function createSkillHandlers(deps: SkillsDeps): Record<string, Handler> {
  let own: SkillManager | null = null

  const engine = (): WorkflowEngineLike => {
    const workflows = deps.workflows()
    if (!workflows) throw new HelperError('unavailable', 'Workflows are not running here, and a skill is run as a workflow, so there are no skills.')
    return workflows.engine
  }

  const capabilities = (): CapabilityDescriptor[] => {
    const list = deps.capabilities()
    if (!list) throw new HelperError('no-browser', 'There is no browser to ask what it can do, so a skill cannot be checked before it is used.')
    return list
  }

  const skills = (): SkillManager => {
    const lent = deps.manager?.()
    if (lent) return lent
    // Reached only once the engine is there, so a helper without one has no skills at all.
    engine()
    if (!deps.userData) throw new HelperError('unavailable', 'This helper has no data folder, so it has nowhere to keep skills.')
    own ??= new SkillManager({
      userData: deps.userData,
      profileId: deps.profileId,
      capabilities,
      // Each call goes back through the deps, so the manager outlives an engine being replaced.
      workflows: {
        get: (id) => engine().get(id),
        save: (workflow, note) => engine().save(workflow, note),
        remove: (id) => engine().remove(id),
        history: (id) => engine().history(id),
        versions: (id) => engine().versions(id),
        restoreVersion: (id, version) => engine().restoreVersion(id, version),
        run: (id, options) => engine().run(id, options)
      },
      announce: () => deps.announce?.()
    })
    return own
  }

  /**
   * The manager refuses in sentences meant for the person ("That skill is switched off."), so those are passed on. A
   * failure from the file system is not: it carries a system code and a path, and its detail stays in the helper.
   */
  const said = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (err) {
      if (err instanceof HelperError || !(err instanceof Error)) throw err
      if ('code' in err || 'path' in err || 'syscall' in err) throw err
      throw new HelperError(/does not exist/.test(err.message) ? 'not-found' : 'failed', err.message)
    }
  }

  /** The run the panel names, from the app's own runs; the app decides whether that run is the person's to use. */
  const finishedRun = async (value: unknown): Promise<StepSession> => {
    const lend = deps.finishedRun
    if (!lend) throw new HelperError('unavailable', 'This helper runs nothing step by step, so there is no run to learn a skill from.')
    const session = await lend(identifier(value, 'a run'))
    if (!session) throw new HelperError('not-found', 'That run is no longer available.')
    return session
  }

  const site = (): string | undefined => {
    const url = deps.currentUrl?.()
    return typeof url === 'string' && url.length <= 2000 ? url : undefined
  }

  const learning: Record<string, Handler> = {
    /** What saving this run would make, for the person to look at first. Nothing is written. */
    'skills:preview': async (a) => {
      const manager = skills()
      const session = await finishedRun(a[0])
      const settings = await said(() => manager.settings())
      const { candidate, why } = manager.preview(session)
      return {
        offer: settings.learnFromRuns && Boolean(candidate),
        timesDone: await said(() => manager.timesDone(session.goal)),
        why,
        candidate: candidate && {
          name: candidate.workflow.name,
          whenToUse: candidate.meta.whenToUse,
          category: candidate.meta.category,
          domains: candidate.meta.domains,
          steps: candidate.workflow.steps.map((step) => ({ name: step.name, byYou: step.type === 'userAction' })),
          inputs: candidate.workflow.inputs.map((input) => ({ label: input.label || input.name, asked: input.default === undefined })),
          permissions: candidate.workflow.settings.permissions,
          notes: candidate.notes
        }
      }
    },
    'skills:save': async (a) => {
      const manager = skills()
      const session = await finishedRun(a[0])
      const edits = readEdits(a[1])
      return said(() => manager.saveFromRun(session, edits))
    }
  }

  return {
    'skills:list': () => said(() => skills().list()),
    /** The page in front comes from this side, not from the panel, so a skill is matched against the real address. */
    'skills:match': (a) => said(() => skills().match(line(a[0] ?? '', 'the request', MAX_REQUEST), site())),
    'skills:settings': () => said(() => skills().settings()),
    'skills:set-settings': (a) => {
      const next = readSettings(a[0])
      return said(() => skills().setSettings(next))
    },
    'skills:edit': (a) => {
      const workflowId = identifier(a[0], 'a skill')
      const edits = readEdits(a[1])
      return said(() => skills().edit(workflowId, edits))
    },
    'skills:set-enabled': (a) => {
      const workflowId = identifier(a[0], 'a skill')
      if (typeof a[1] !== 'boolean') throw bad('enabled must be true or false.')
      return said(() => skills().setEnabled(workflowId, a[1] as boolean))
    },
    /** The skill is forgotten; its workflow stays unless the person asked for that to go with it. */
    'skills:remove': async (a) => {
      const workflowId = identifier(a[0], 'a skill')
      if (a[1] !== undefined && typeof a[1] !== 'boolean') throw bad('alsoWorkflow must be true or false.')
      await said(() => skills().remove(workflowId, a[1] === true))
      return { removed: true, workflowId, workflowRemoved: a[1] === true }
    },
    'skills:remove-all': async () => {
      await said(() => skills().removeAll())
      return { removed: true }
    },
    'skills:roll-back': (a) => {
      const workflowId = identifier(a[0], 'a skill')
      return said(() => skills().rollBack(workflowId))
    },
    /**
     * Runs the skill through the workflow engine, which treats it as automation: it asks before anything consequential
     * and this side answers none of that. Only that it started comes back; its progress is `workflows:status`.
     */
    'skills:run': async (a) => {
      const workflowId = identifier(a[0], 'a skill')
      const inputs = readInputs(a[1])
      const request = a[2] === undefined || a[2] === null ? undefined : line(a[2], 'the request', MAX_REQUEST)
      const started = await said(() => skills().run(workflowId, inputs, request))
      return { runId: started.runId, workflowId: started.workflowId, workflow: started.workflowName, status: started.state.status, startedAt: started.state.startedAt }
    },
    /** The skill as a file to keep or pass on. It holds the procedure, not anything a run of it ever saw. */
    'skills:export': (a) => {
      const workflowId = identifier(a[0], 'a skill')
      return said(() => skills().exportSkill(workflowId))
    },
    /** An imported skill arrives switched off and untrusted, and runs only once the person has looked at it. */
    'skills:import': (a) => {
      const json = line(a[0], 'the skill', MAX_IMPORT)
      return said(() => skills().importSkill(json))
    },
    ...(deps.finishedRun ? learning : {})
  }
}
