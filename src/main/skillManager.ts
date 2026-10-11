import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { CapabilityDescriptor } from '../shared/browserControl.ts'
import { DEFAULT_PROFILE_ID, dataDirFor } from '../shared/profiles.ts'
import {
  candidateFromRun,
  canLearnFrom,
  goalKey,
  missingCapabilities,
  checkSkillImport,
  knownGoodVersion,
  normalizeSkillSettings,
  rankSkills,
  secretsIn,
  skillHealth,
  skillStats,
  SKILL_FORMAT
} from '../shared/skills.ts'
import type { SkillCandidate, SkillEdits, SkillExport, SkillMatch, SkillMeta, SkillSettings, SkillView } from '../shared/skills.ts'
export type { SkillEdits, SkillView }
import type { StepSession } from '../shared/stepPlan.ts'
import { exportWorkflow, importWorkflow, newWorkflow } from '../shared/workflows.ts'
import type { ActiveWorkflowRun, Workflow, WorkflowRunSummary, WorkflowVersion } from '../shared/workflows.ts'
import { damageNote, openStored, readStored, writeStored } from './storedFile.ts'

const ID = /^[A-Za-z0-9_-]{1,80}$/

/**
 * The store's own files, which live in the skills folder beside the skills and are not skills.
 *
 * `repeats.json` went through the loop that reads a skill file, did not look like a skill, and was put on the list of
 * files nothing may be written over. Every success after that was read from the disk, added to, and thrown away --
 * while the number handed back kept going up, so "you have done this before" quietly stopped counting and nothing
 * anywhere looked wrong. Anything new that lives in this folder belongs on this list too.
 */
const NOT_SKILLS = new Set(['settings.json', 'repeats.json'])

/**
 * How many times a goal has been reached, or nothing when the file is not that.
 *
 * It throws instead of shrugging, so a file that is there and makes no sense goes down the damaged path rather than
 * the missing one. `null` used to come back from here as a value and then crash the save that followed it.
 */
function asCounts(text: string): Record<string, number> {
  const raw = JSON.parse(text) as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a count of repeated goals')
  return raw as Record<string, number>
}

/** What skills need from the rest of Orbis, handed in so this file knows nothing about Electron. */
export interface SkillManagerOptions {
  userData: string
  profileId?: string
  capabilities(): CapabilityDescriptor[]
  workflows: {
    get(id: string): Promise<Workflow | null>
    save(workflow: Workflow, note?: string): Promise<Workflow>
    remove(id: string): Promise<void>
    history(id: string): Promise<WorkflowRunSummary[]>
    versions(id: string): Promise<WorkflowVersion[]>
    restoreVersion(id: string, version: number): Promise<Workflow>
    run(id: string, options: { inputs?: Record<string, unknown>; trigger?: 'orion' | 'manual' }): Promise<ActiveWorkflowRun>
  }
  announce(): void
}

/**
 * Learned skills, per profile, on this computer.
 *
 * A skill's procedure is an ordinary workflow, saved, versioned and run by the workflow engine. What is kept here is
 * only a skill's own details, one small file per skill beside the profile's workflows, and the profile's skill settings.
 * Nothing leaves the computer, and nothing is saved, changed or reused without somebody asking for it.
 */
export class SkillManager {
  private readonly o: SkillManagerOptions
  private profileId: string
  private cache: Map<string, SkillMeta> | null = null
  private settingsCache: SkillSettings | null = null
  private readonly queues = new Map<string, Promise<void>>()
  /** Files that are there and were not understood, by path. Nothing is ever written over one of these. */
  private readonly refuse = new Set<string>()
  /** What to tell the person about their settings file, when there is something to tell them. */
  private settingsNote: string | null = null

  constructor(options: SkillManagerOptions) {
    this.o = options
    this.profileId = options.profileId ?? DEFAULT_PROFILE_ID
  }

  useProfile(profileId: string): void {
    if (profileId === this.profileId) return
    this.profileId = profileId
    this.cache = null
    this.settingsCache = null
    this.settingsNote = null
  }

  private dir(): string {
    return join(this.o.userData, dataDirFor(this.profileId), 'skills')
  }

  /** Written whole to a temporary file and renamed into place, one write per file at a time, so a crash leaves the old one. */
  private write(path: string, data: unknown): Promise<void> {
    // Nothing goes over a file that is there and was not understood. A damaged one was moved aside by the read before
    // it reached here, so its place is free; what this stops is the one still sitting there holding the person's work.
    if (this.refuse.has(path)) return Promise.resolve()
    const run = (this.queues.get(path) ?? Promise.resolve()).then(() => writeStored(path, JSON.stringify(data, null, 1)))
    this.queues.set(path, run.catch(() => undefined))
    return run
  }

  // ---------------------------------------------------------------- settings

  async settings(): Promise<SkillSettings> {
    if (this.settingsCache) return { ...this.settingsCache }
    const path = join(this.dir(), 'settings.json')
    /**
     * The parse goes to `openStored` rather than into a `catch` here, and that is the whole point: a settings file
     * cut off halfway through a save reads perfectly and parses not at all. This used to answer that with the
     * defaults, and the next flick of any switch renamed the defaults over the rest -- learning back off, reuse back
     * to suggesting -- with no copy of the old file left anywhere. Now it is moved aside with its words intact
     * first, and one that is merely being held open is left exactly as it is and refuses the write.
     */
    const opened = await openStored(path, (text) => normalizeSkillSettings(JSON.parse(text)), () => normalizeSkillSettings(undefined))
    if (opened.mayWrite) this.refuse.delete(path)
    else this.refuse.add(path)
    this.settingsNote = opened.mayWrite ? null : damageNote(opened, 'skill settings')
    // An answer is only remembered when it was really read. Remembering the defaults from a file that could not be
    // read made the refusal last the whole session: the three lines above are the only ones that take a file back off
    // the refuse list and clear the note, and they never ran a second time. Somebody with learning switched on got no
    // suggestions and no offer to save a skill until they restarted Orbis, while the words on screen promised "try
    // again in a moment". Reading a small file again on each ask is what makes that promise true, and it only happens
    // in the case where reading it failed.
    if (opened.mayWrite) this.settingsCache = opened.value
    return { ...opened.value }
  }

  async setSettings(next: Partial<SkillSettings>): Promise<SkillSettings> {
    const current = await this.settings()
    // Said, not done quietly. The switch in front of the person must not move when the file it belongs to could not be
    // read, because nothing has been saved and it would be back where it was the next time Orbis started.
    if (this.settingsNote) throw new Error(this.settingsNote)
    const merged = normalizeSkillSettings({ ...current, ...next })
    // Remembered only once it is written, and the write is awaited first. It used to be the other way round, which
    // is the mirror image of the fault above: with the cache warm from an earlier good read, a file that had SINCE
    // been taken hold of gave a failed write -- and the panel, re-reading from the cache, showed the new position
    // of a switch that was still the old position on disk and would be again after a restart.
    //
    // A refused write is not a failure: `write` returns quietly when the path is on the refuse list, and the throw
    // above has already covered the case where this read could not be done at all.
    try {
      await this.write(join(this.dir(), 'settings.json'), merged)
    } catch (err) {
      this.refuse.add(join(this.dir(), 'settings.json'))
      this.settingsCache = null
      throw new Error('Orbis could not save that just now, so nothing has changed. This is usually another program holding the file; try again in a moment.')
    }
    this.settingsCache = merged
    this.o.announce()
    return merged
  }

  // ---------------------------------------------------------------- the library

  /** Every skill's details. A damaged file is left out rather than stopping the rest from loading. */
  private async all(): Promise<Map<string, SkillMeta>> {
    if (!this.cache) {
      const found = new Map<string, SkillMeta>()
      let names: string[] = []
      try {
        names = await fs.readdir(this.dir())
      } catch (err) {
        // No folder means no skills have been saved yet, and that is remembered. A folder that is there and could not
        // be listed is not: a moment of something holding it would otherwise leave the library looking empty until
        // Orbis was restarted.
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') return found
      }
      for (const name of names) {
        if (!name.endsWith('.json') || NOT_SKILLS.has(name)) continue
        const path = join(this.dir(), name)
        const opened = await openStored(path, (text) => JSON.parse(text) as SkillMeta | null, () => null)
        const meta = opened.value
        if (meta && meta.format === SKILL_FORMAT && typeof meta.workflowId === 'string' && ID.test(meta.workflowId)) {
          found.set(meta.workflowId, meta)
          this.refuse.delete(path)
          continue
        }
        // Left out of the library either way, but not written over either. A file that parsed and still made no sense
        // is most likely a skill saved by a newer Orbis, so it is left exactly where it is rather than moved aside: it
        // has to still be a skill after the next update. Only a file whose bytes are already safe elsewhere is free.
        if (opened.movedTo) this.refuse.delete(path)
        else this.refuse.add(path)
      }
      this.cache = found
    }
    return this.cache
  }

  private async put(meta: SkillMeta): Promise<void> {
    const all = await this.all()
    all.set(meta.workflowId, meta)
    await this.write(join(this.dir(), `${meta.workflowId}.json`), meta)
    this.o.announce()
  }

  private async view(meta: SkillMeta): Promise<SkillView | null> {
    const workflow = await this.o.workflows.get(meta.workflowId)
    if (!workflow) return null
    const runs = await this.o.workflows.history(meta.workflowId)
    const stats = skillStats(runs, workflow.version)
    return {
      meta,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        steps: workflow.steps.length,
        inputs: workflow.inputs.map((input) => ({ name: input.name, label: input.label || input.name, hasDefault: input.default !== undefined && input.default !== '' })),
        permissions: workflow.settings.permissions
      },
      stats,
      health: skillHealth(meta, stats),
      knownGoodVersion: knownGoodVersion(runs)
    }
  }

  async list(): Promise<SkillView[]> {
    const views: SkillView[] = []
    for (const meta of (await this.all()).values()) {
      const view = await this.view(meta)
      if (view) views.push(view)
    }
    return views.sort((a, b) => (b.stats.lastUsedAt ?? b.meta.updatedAt) - (a.stats.lastUsedAt ?? a.meta.updatedAt))
  }

  async get(workflowId: string): Promise<SkillView | null> {
    const meta = (await this.all()).get(workflowId)
    return meta ? this.view(meta) : null
  }

  // ---------------------------------------------------------------- learning from a run

  /**
   * Counts a finished, successful step-by-step goal, so a repeated one can be pointed out. Only the goal's wording is
   * kept, per profile, and only a count — never what the run did or saw.
   */
  async countSuccess(goal: string): Promise<number> {
    const key = goalKey(goal)
    if (!key) return 0
    const path = join(this.dir(), 'repeats.json')
    const opened = await openStored(path, asCounts, (): Record<string, number> => ({}))
    // A count cut off halfway through a save used to read as "nothing has ever been repeated", and this line then
    // renamed one count over every count the person had built up. Damaged, it has been moved aside by now and a fresh
    // one is right; unreadable, this success goes uncounted rather than counted on top of nothing.
    if (!opened.mayWrite) return 0
    const counts = opened.value
    counts[key] = (counts[key] ?? 0) + 1
    const kept = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 500))
    await this.write(path, kept)
    return counts[key]
  }

  async timesDone(goal: string): Promise<number> {
    // A question moves nothing aside, so this reads rather than opens: a file that makes no sense is left for the
    // next success to deal with, and until then Orbis says it does not know of any rather than inventing a number.
    const stored = await readStored(join(this.dir(), 'repeats.json'))
    if (stored.kind !== 'read') return 0
    try {
      return asCounts(stored.text)[goalKey(goal)] ?? 0
    } catch {
      return 0
    }
  }

  /** What saving this run would make, for the person to look at first. Nothing is written. */
  preview(session: StepSession): { candidate: SkillCandidate | null; why?: string } {
    const eligible = canLearnFrom(session)
    if (!eligible.ok) return { candidate: null, why: eligible.why }
    const candidate = candidateFromRun(session, this.o.capabilities())
    return candidate ? { candidate } : { candidate: null, why: 'Nothing in this run can be repeated as a skill.' }
  }

  /**
   * Saves a finished run as a skill, because the person said to.
   *
   * The candidate is worked out again here from the run itself, never taken from the window, so what is saved is what
   * the browser confirmed. The person's edits change only its name, what it is for, its category and its sites.
   */
  async saveFromRun(session: StepSession, edits: SkillEdits = {}): Promise<SkillView> {
    const { candidate, why } = this.preview(session)
    if (!candidate) throw new Error(why ?? 'This run cannot be saved as a skill.')
    if (secretsIn({ steps: candidate.workflow.steps, inputs: candidate.workflow.inputs, variables: {} }).length) throw new Error('This run contains something private, so it was not saved.')

    const created = newWorkflow(clean(edits.name, 80) || candidate.workflow.name, crypto.randomUUID())
    const workflow = await this.o.workflows.save(
      {
        ...created,
        titleSource: 'user',
        description: candidate.workflow.description,
        steps: candidate.workflow.steps,
        inputs: candidate.workflow.inputs,
        tags: candidate.workflow.tags,
        status: 'ready',
        createdBy: 'orion',
        settings: { ...created.settings, ...candidate.workflow.settings }
      },
      'Learned from a step-by-step run'
    )
    const now = Date.now()
    const meta: SkillMeta = {
      ...candidate.meta,
      workflowId: workflow.id,
      whenToUse: clean(edits.whenToUse, 300) || candidate.meta.whenToUse,
      category: clean(edits.category, 40) || candidate.meta.category,
      domains: edits.domains ? cleanDomains(edits.domains) : candidate.meta.domains,
      createdAt: now,
      updatedAt: now
    }
    await this.put(meta)
    return (await this.view(meta))!
  }

  // ---------------------------------------------------------------- using one

  /** Skills that might do what was asked, if the person uses skills at all. */
  async match(request: string, currentUrl?: string): Promise<{ matches: SkillMatch[]; reuse: SkillSettings['reuse'] }> {
    const settings = await this.settings()
    // Nothing offered while the settings file could not be read. The defaults say learning is on and skills may be
    // suggested, which is the right answer for somebody who has never touched the switches and the wrong one for
    // somebody who turned them off: their file says `enabled: false` and Orbis would go on suggesting, because it
    // could not read the file that says not to. "Orbis does not know what you chose" has to behave as no, not as
    // whatever the default happens to be.
    if (this.settingsNote) return { matches: [], reuse: 'never' }
    if (!settings.enabled || settings.reuse === 'never') return { matches: [], reuse: settings.reuse }
    const skills: { meta: SkillMeta; workflow: Pick<Workflow, 'id' | 'name' | 'description'> }[] = []
    for (const meta of (await this.all()).values()) {
      const workflow = await this.o.workflows.get(meta.workflowId)
      if (workflow) skills.push({ meta, workflow: { id: workflow.id, name: workflow.name, description: workflow.description } })
    }
    return { matches: rankSkills(request, skills, currentUrl).filter((m) => m.level !== 'low').slice(0, 3), reuse: settings.reuse }
  }

  /**
   * Runs a skill through the workflow engine, which treats it as automation: anything consequential asks, every time.
   * When a request is given, it is remembered as another way of asking for this skill, so it is recognised next time.
   */
  async run(workflowId: string, inputs: Record<string, unknown> = {}, request?: string): Promise<ActiveWorkflowRun> {
    const meta = (await this.all()).get(workflowId)
    if (!meta) throw new Error('That skill does not exist.')
    if (!meta.enabled) throw new Error('That skill is switched off.')
    if (meta.trust === 'untrusted') throw new Error('Look through this imported skill and switch it on before running it.')
    const workflow = await this.o.workflows.get(workflowId)
    const missing = workflow ? missingCapabilities(workflow.steps, this.o.capabilities()) : []
    if (missing.length) throw new Error(`This skill needs ${missing.map((m) => `${m.id} (${m.why.replace(/\.$/, '')})`).join(', ')}, so it cannot run now.`)
    const started = await this.o.workflows.run(workflowId, { inputs, trigger: 'orion' })
    const asked = clean(request, 200)
    if (asked && !meta.examples.includes(asked) && asked.toLowerCase() !== meta.whenToUse.toLowerCase()) {
      await this.put({ ...meta, examples: [asked, ...meta.examples].slice(0, 10), updatedAt: Date.now() })
    }
    return started
  }

  // ---------------------------------------------------------------- looking after them

  async edit(workflowId: string, edits: SkillEdits): Promise<SkillView> {
    const meta = (await this.all()).get(workflowId)
    if (!meta) throw new Error('That skill does not exist.')
    if (edits.name !== undefined) {
      const workflow = await this.o.workflows.get(workflowId)
      const name = clean(edits.name, 80)
      if (workflow && name) await this.o.workflows.save({ ...workflow, name, titleSource: 'user' })
    }
    const next: SkillMeta = {
      ...meta,
      ...(edits.whenToUse !== undefined ? { whenToUse: clean(edits.whenToUse, 300) || meta.whenToUse } : {}),
      ...(edits.category !== undefined ? { category: clean(edits.category, 40) || 'Custom' } : {}),
      ...(edits.domains !== undefined ? { domains: cleanDomains(edits.domains) } : {}),
      updatedAt: Date.now()
    }
    await this.put(next)
    return (await this.view(next))!
  }

  /** Switching an imported skill on is the person saying they have looked at it, so it stops being untrusted. */
  async setEnabled(workflowId: string, enabled: boolean): Promise<SkillView> {
    const meta = (await this.all()).get(workflowId)
    if (!meta) throw new Error('That skill does not exist.')
    const next: SkillMeta = { ...meta, enabled, ...(enabled && meta.trust === 'untrusted' ? { trust: 'approved' as const } : {}), updatedAt: Date.now() }
    await this.put(next)
    return (await this.view(next))!
  }

  /** Forgets the skill. Its workflow is kept unless the person asks for that to go too. */
  async remove(workflowId: string, removeWorkflow = false): Promise<void> {
    if (!ID.test(workflowId)) return
    // `settings` and `repeats` are valid ids by that test, and this folder holds `settings.json` and `repeats.json`.
    // `remove('settings')` deleted the person's skill settings and `remove('repeats')` deleted every "you have done
    // this before" count -- silently, because `force: true`, and unrecoverably, because nothing is moved aside.
    // Both are reachable from Orion: "forget the skill called settings" passes the same id test on the way in.
    if (NOT_SKILLS.has(`${workflowId}.json`)) return
    const all = await this.all()
    all.delete(workflowId)
    const path = join(this.dir(), `${workflowId}.json`)
    // Deleting is the one thing in here that cannot be undone, so it does not happen to a file Orbis does not
    // understand: one that merely could not be read may be perfectly good a second later, and one that parsed and is
    // not a skill is most likely a skill a newer Orbis understands.
    //
    // The file is asked about NOW rather than taken from `refuse`. That list is filled only by reading the library,
    // which caches and never runs again for the life of the profile -- so a file that appeared after the one read,
    // from a newer Orbis or held open by something, was not on it and was deleted. Measured both ways: the file the
    // test protects survived only because the library read happened to have seen it.
    const opened = await openStored(path, (text) => JSON.parse(text) as SkillMeta | null, () => null)
    const meta = opened.value
    const isSkill = Boolean(meta) && meta!.format === SKILL_FORMAT && typeof meta!.workflowId === 'string'
    if (!opened.mayWrite || !isSkill) {
      this.refuse.add(path)
      if (opened.wasDamaged) this.o.announce()
      return
    }
    // `force: true` only swallows "it is not there". A file genuinely held open gives EPERM or EBUSY, and that used
    // to come out of here as a raw Windows errno carrying the person's profile path -- which `removeAll` then let
    // abort the whole loop, so "forget every skill" half-finished without saying so.
    try {
      await fs.rm(path, { force: true })
    } catch {
      this.refuse.add(path)
      this.o.announce()
      return
    }
    if (removeWorkflow) await this.o.workflows.remove(workflowId)
    this.o.announce()
  }

  async removeAll(): Promise<void> {
    for (const workflowId of [...(await this.all()).keys()]) await this.remove(workflowId, false)
  }

  /** Goes back to the last version that completed a run. The version being left is kept, so this can be undone. */
  async rollBack(workflowId: string): Promise<SkillView> {
    const meta = (await this.all()).get(workflowId)
    if (!meta) throw new Error('That skill does not exist.')
    const good = knownGoodVersion(await this.o.workflows.history(workflowId))
    const current = await this.o.workflows.get(workflowId)
    if (!good || !current || good >= current.version) throw new Error('There is no earlier version of this skill that is known to work.')
    await this.o.workflows.restoreVersion(workflowId, good)
    const next = { ...meta, knownGoodVersion: good, updatedAt: Date.now() }
    await this.put(next)
    return (await this.view(next))!
  }

  // ---------------------------------------------------------------- sharing

  async exportSkill(workflowId: string): Promise<string> {
    const meta = (await this.all()).get(workflowId)
    const workflow = await this.o.workflows.get(workflowId)
    if (!meta || !workflow) throw new Error('That skill does not exist.')
    const { workflowId: _id, knownGoodVersion: _good, ...rest } = meta
    const data: SkillExport = { format: SKILL_FORMAT, kind: 'orbis-skill', exportedAt: Date.now(), meta: rest, workflow: exportWorkflow(workflow) }
    return JSON.stringify(data, null, 2)
  }

  /** An imported skill is saved switched off and untrusted, and never run until the person switches it on. */
  async importSkill(json: string): Promise<{ skill: SkillView; warnings: string[] }> {
    let raw: unknown
    try {
      raw = JSON.parse(json)
    } catch {
      throw new Error('That file is not an Orbis skill.')
    }
    const checked = checkSkillImport(raw, this.o.capabilities())
    if (!checked.ok) throw new Error(checked.why)
    const imported = importWorkflow(checked.workflow, () => crypto.randomUUID())
    const workflow = await this.o.workflows.save({ ...imported, titleSource: 'user', createdBy: 'import', trigger: { type: 'manual' }, schedule: undefined }, 'Imported skill')
    const meta: SkillMeta = { ...checked.meta, workflowId: workflow.id }
    await this.put(meta)
    return { skill: (await this.view(meta))!, warnings: checked.warnings }
  }
}

function clean(text: unknown, max: number): string {
  return typeof text === 'string' ? text.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function cleanDomains(domains: unknown[]): string[] {
  return [...new Set(domains.map((d) => clean(d, 100).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')).filter((d) => /^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))].slice(0, 20)
}
