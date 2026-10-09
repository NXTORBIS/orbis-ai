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

const ID = /^[A-Za-z0-9_-]{1,80}$/

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

  constructor(options: SkillManagerOptions) {
    this.o = options
    this.profileId = options.profileId ?? DEFAULT_PROFILE_ID
  }

  useProfile(profileId: string): void {
    if (profileId === this.profileId) return
    this.profileId = profileId
    this.cache = null
    this.settingsCache = null
  }

  private dir(): string {
    return join(this.o.userData, dataDirFor(this.profileId), 'skills')
  }

  /** Written whole to a temporary file and renamed into place, one write per file at a time, so a crash leaves the old one. */
  private write(path: string, data: unknown): Promise<void> {
    const run = (this.queues.get(path) ?? Promise.resolve()).then(async () => {
      await fs.mkdir(join(path, '..'), { recursive: true })
      await fs.writeFile(`${path}.tmp`, JSON.stringify(data, null, 1), { mode: 0o600 })
      await fs.rename(`${path}.tmp`, path)
    })
    this.queues.set(path, run.catch(() => undefined))
    return run
  }

  // ---------------------------------------------------------------- settings

  async settings(): Promise<SkillSettings> {
    if (!this.settingsCache) {
      const raw = await fs.readFile(join(this.dir(), 'settings.json'), 'utf8').then(JSON.parse).catch(() => undefined)
      this.settingsCache = normalizeSkillSettings(raw)
    }
    return { ...this.settingsCache }
  }

  async setSettings(next: Partial<SkillSettings>): Promise<SkillSettings> {
    const merged = normalizeSkillSettings({ ...(await this.settings()), ...next })
    this.settingsCache = merged
    await this.write(join(this.dir(), 'settings.json'), merged)
    this.o.announce()
    return merged
  }

  // ---------------------------------------------------------------- the library

  /** Every skill's details. A damaged file is left out rather than stopping the rest from loading. */
  private async all(): Promise<Map<string, SkillMeta>> {
    if (!this.cache) {
      const found = new Map<string, SkillMeta>()
      const names = await fs.readdir(this.dir()).catch(() => [] as string[])
      for (const name of names) {
        if (!name.endsWith('.json') || name === 'settings.json') continue
        const meta = (await fs.readFile(join(this.dir(), name), 'utf8').then(JSON.parse).catch(() => null)) as SkillMeta | null
        if (meta && meta.format === SKILL_FORMAT && typeof meta.workflowId === 'string' && ID.test(meta.workflowId)) found.set(meta.workflowId, meta)
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
    const counts = (await fs.readFile(path, 'utf8').then(JSON.parse).catch(() => ({}))) as Record<string, number>
    counts[key] = (counts[key] ?? 0) + 1
    const kept = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 500))
    await this.write(path, kept)
    return counts[key]
  }

  async timesDone(goal: string): Promise<number> {
    const counts = (await fs.readFile(join(this.dir(), 'repeats.json'), 'utf8').then(JSON.parse).catch(() => ({}))) as Record<string, number>
    return counts[goalKey(goal)] ?? 0
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
    const all = await this.all()
    all.delete(workflowId)
    await fs.rm(join(this.dir(), `${workflowId}.json`), { force: true })
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
