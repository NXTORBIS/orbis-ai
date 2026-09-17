/**
 * Learned skills.
 *
 * A skill is a workflow Orbis learned from doing something successfully, plus what it takes to know when to use it
 * again. The procedure itself — its steps, variables, versions, run history and permissions — is an ordinary Orbis
 * workflow, carried out by the workflow engine and the Browser Control Layer exactly as any other workflow is. This
 * module holds only what a workflow does not already have, and the rules that are worth being strict about:
 *
 *   A skill is learned only from a run where every step kept in it was confirmed against the real page. A run that
 *   stumbled and recovered keeps only the steps that worked; a run whose last attempt failed teaches nothing.
 *
 *   A skill never stores a secret. What was typed into a sensitive field becomes a step that asks the person to do it
 *   themselves, and anything that looks like a key, token or card number is treated the same way wherever it appears.
 *
 *   Nothing is learned, changed or reused without the person saying so. This module proposes; it never saves.
 *
 *   How well a skill is doing is read from what actually happened when it ran, never from a counter kept on the side.
 *
 * Nothing here talks to a browser, a model or the disk.
 */
import type { CapabilityDescriptor, Condition } from './browserControl.ts'
import type { PlannedStep, StepSession } from './stepPlan.ts'
import type { ActionWorkflowStep, UserActionWorkflowStep, Workflow, WorkflowInput, WorkflowRunSummary, WorkflowStep } from './workflows.ts'

export const SKILL_FORMAT = 1

/** How much a skill is trusted to be used without being looked at first. Never a way past a confirmation. */
export type SkillTrust = 'untrusted' | 'approved' | 'verified'

export type SkillHealth = 'verified' | 'needs-review' | 'unstable' | 'disabled'

export interface SkillPrerequisite {
  /** Said to the person: "You need to be signed in to the site". */
  description: string
  /** Asked of the real browser before the skill runs, when there is something to ask. Otherwise shown, not assumed. */
  check?: Condition
}

/** What a skill has that its workflow does not. */
export interface SkillMeta {
  format: typeof SKILL_FORMAT
  /** The workflow that is this skill's procedure. */
  workflowId: string
  /** In the person's words, what the skill is for. What retrieval reads first. */
  whenToUse: string
  /** Other ways of asking for the same thing, to recognise it by. */
  examples: string[]
  /** Hostnames or "*.example.com" patterns the skill was made on. Empty means it is not tied to a site. */
  domains: string[]
  category: string
  prerequisites: SkillPrerequisite[]
  trust: SkillTrust
  enabled: boolean
  createdAt: number
  updatedAt: number
  createdFrom: { kind: 'step-run' | 'workflow' | 'manual' | 'import'; runId?: string; goal?: string }
  /** The newest version of the workflow with a run that completed. What to fall back to when a newer one breaks. */
  knownGoodVersion?: number
}

export interface SkillSettings {
  /** Orion looks for saved skills at all. Off keeps them stored and runnable by hand. */
  enabled: boolean
  /** Offer to save a successful step-by-step run as a skill. Off by default: learning is something a person turns on. */
  learnFromRuns: boolean
  /** What Orion does with a relevant skill. */
  reuse: 'never' | 'suggest' | 'auto'
}

export const DEFAULT_SKILL_SETTINGS: SkillSettings = { enabled: true, learnFromRuns: false, reuse: 'suggest' }

export const SKILL_CATEGORIES = ['Research', 'Browsing', 'Productivity', 'Shopping', 'Development', 'Study', 'Files', 'Downloads', 'Web apps', 'Communication', 'Custom']

// ---------------------------------------------------------------- whether a run taught anything

export interface Eligibility {
  ok: boolean
  /** Said plainly when it did not. */
  why?: string
}

/**
 * Whether a step-by-step run is worth learning from.
 *
 * Done, with something confirmed, and ending on a step that worked. A run that was stopped, failed, or is still waiting
 * for a person is not a procedure anybody should repeat.
 */
export function canLearnFrom(session: StepSession): Eligibility {
  if (session.status !== 'done') return { ok: false, why: 'Only a run that finished can be saved as a skill.' }
  const kept = session.steps.filter((step) => step.phase === 'success' && step.capability)
  if (!kept.length) return { ok: false, why: 'Nothing in this run was confirmed on the page, so there is nothing to learn.' }
  const attempted = session.steps.filter((step) => step.phase === 'success' || step.phase === 'failed')
  if (attempted[attempted.length - 1]?.phase !== 'success') return { ok: false, why: 'The last thing this run tried did not work.' }
  if (session.steps.some((step) => step.phase === 'waiting' || step.phase === 'executing' || step.phase === 'verifying')) {
    return { ok: false, why: 'Part of this run is still unfinished.' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------- keeping secrets out

/**
 * Shapes that are secrets whatever field they sit in: the key formats of the services people most often paste keys
 * from, private keys, long random tokens and card numbers. Each is specific enough not to catch ordinary things — a
 * UUID, an id like "skill-step-1", a millisecond timestamp — which a looser rule flagged. A skill covered in false
 * alarms is one whose real warnings nobody reads.
 */
const SECRET_SHAPED = [
  /\b(?:sk|pk|rk|gsk)[-_](?:live_|test_|proj-)?[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A long run of mixed letters and digits with no spaces: how tokens look, and how words, slugs and UUIDs do not. */
function looksLikeToken(value: string): boolean {
  return (value.match(/[A-Za-z0-9_-]{32,}/g) ?? []).some((run) => !UUID.test(run) && /[A-Za-z]/.test(run) && /\d/.test(run))
}

/** A payment card number: 15 to 19 digits from a card network, passing the Luhn check. A timestamp or an order number does not count. */
function looksLikeCard(value: string): boolean {
  for (const match of value.match(/\b(?:\d[ -]?){12,18}\d\b/g) ?? []) {
    const digits = match.replace(/\D/g, '')
    if (digits.length < 13 || digits.length > 19) continue
    // Card networks start with 3 (Amex, Diners, JCB), 4 (Visa), 5 (Mastercard) or 6 (Discover), and nearly every card
    // has 15 digits or more. A timestamp starts with 1, and a 13-digit run of anything is far more often not a card.
    if (!'3456'.includes(digits[0]) || digits.length < 15) continue
    let sum = 0
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i])
      if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2
      sum += d
    }
    if (sum % 10 === 0) return true
  }
  return false
}

const SECRET_NAMES = /pass(word|code|phrase)?|pin\b|otp|mfa|2fa|secret|token|api[-_ ]?key|cvv|cvc|card|ssn|security code/i
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i
const PHONE = /(?:\+?\d[\s-]?){9,}/

export function looksSecret(value: unknown): boolean {
  return typeof value === 'string' && (SECRET_SHAPED.some((pattern) => pattern.test(value)) || looksLikeToken(value) || looksLikeCard(value))
}

/** Personal enough that it should not become somebody's default: an address, a number, a long message. */
function looksPersonal(value: string): boolean {
  return EMAIL.test(value) || PHONE.test(value) || value.length > 80
}

/** Anything in a step's parameters that names or looks like a secret, by where it sits or what it is. */
function secretIn(step: PlannedStep, capability: CapabilityDescriptor | undefined): string | null {
  for (const [name, value] of Object.entries(step.params)) {
    if (capability?.params[name]?.sensitive) return name
    if (looksSecret(value)) return name
  }
  const locator = JSON.stringify(step.params.locator ?? '')
  if (SECRET_NAMES.test(locator) || SECRET_NAMES.test(step.intent)) {
    if (Object.keys(step.params).some((name) => ['text', 'value'].includes(name))) return 'text'
  }
  return null
}

// ---------------------------------------------------------------- a run, as a skill

export interface SkillCandidate {
  workflow: Pick<Workflow, 'name' | 'description' | 'steps' | 'inputs' | 'settings' | 'tags'>
  meta: Omit<SkillMeta, 'workflowId' | 'createdAt' | 'updatedAt'>
  /** What was left out or changed on the way, said out loud so the person sees it before saving. */
  notes: string[]
}

/** Where a typed value becomes a variable, what it is called. "Search for flights" → "search". */
function inputName(intent: string, taken: Set<string>): string {
  const words = intent
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !['type', 'enter', 'the', 'a', 'an', 'into', 'in', 'field', 'box', 'for', 'to', 'of', 'and', 'on'].includes(word))
  const base = (words.slice(0, 2).map((word, i) => (i ? word[0].toUpperCase() + word.slice(1) : word)).join('') || 'value').slice(0, 30)
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`
  taken.add(name)
  return name
}

const TEXT_CAPABILITIES = new Set(['page.type', 'page.paste', 'ui.type', 'addressBar.type', 'find.search'])

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

/**
 * Turns a finished, verified run into a skill ready for the person to look at.
 *
 * Only the steps that were confirmed are kept, in the order they worked. What was typed becomes a variable, because
 * the next time is a different search; what was typed into a sensitive field becomes a step that asks the person to
 * type it, because a skill is not a place to keep a password. Addresses stay as they were, and the sites they are on
 * become the places the skill belongs.
 *
 * Nothing is saved here. The candidate is shown, edited if the person wants, and saved only when they say so.
 */
export function candidateFromRun(session: StepSession, capabilities: CapabilityDescriptor[], title?: string): SkillCandidate | null {
  if (!canLearnFrom(session).ok) return null
  const byId = new Map(capabilities.map((c) => [c.id, c]))
  const notes: string[] = []
  const inputs: WorkflowInput[] = []
  const taken = new Set<string>()
  const domains = new Set<string>()
  const steps: WorkflowStep[] = []
  let counter = 0
  const id = (): string => `skill-step-${++counter}`

  const dropped = session.steps.filter((step) => step.phase !== 'success').length
  if (dropped) notes.push(`${dropped} step${dropped === 1 ? '' : 's'} that did not work ${dropped === 1 ? 'was' : 'were'} left out.`)

  for (const step of session.steps) {
    if (step.phase !== 'success' || !step.capability) continue
    const capability = byId.get(step.capability)
    const host = hostOf(step.params.url)
    if (host) domains.add(host)

    const secret = secretIn(step, capability)
    if (secret) {
      // The value is never looked at again, let alone kept: the person does this part themselves, every time.
      const ask: UserActionWorkflowStep = { id: id(), type: 'userAction', name: step.intent, message: `${step.intent} — do this on the page yourself, then continue.` }
      steps.push(ask)
      notes.push(`“${step.intent}” used something private, so the skill will ask you to do that step yourself.`)
      continue
    }

    const params: Record<string, unknown> = { ...step.params }
    if (TEXT_CAPABILITIES.has(step.capability) && typeof params.text === 'string' && params.text.trim()) {
      const name = inputName(step.intent, taken)
      const typed = params.text
      const personal = looksPersonal(typed)
      inputs.push({
        name,
        label: step.intent.slice(0, 60),
        type: 'string',
        required: true,
        // What was typed last time is a sensible starting point, unless it is somebody's address or a whole message.
        ...(personal ? {} : { default: typed }),
        description: personal ? 'Asked for each time, since what was typed before looked personal.' : undefined
      })
      params.text = `{{${name}}}`
      if (personal) notes.push(`What was typed for “${step.intent}” looked personal, so it is not kept as a default.`)
    }

    const action: ActionWorkflowStep = {
      id: id(),
      type: 'action',
      name: step.intent,
      capability: step.capability,
      params,
      ...(step.saveAs ? { saveAs: step.saveAs } : {}),
      ...(step.expect ? { expect: step.expect } : {}),
      retry: { attempts: Math.min(3, Math.max(2, step.maxAttempts)) }
    }
    if (!step.expect) notes.push(`“${step.intent}” had nothing to check afterwards beyond the action itself.`)
    steps.push(action)
  }

  if (!steps.some((step) => step.type === 'action')) return null
  const permissions = [...new Set(steps.flatMap((step) => (step.type === 'action' ? [step.capability.split('.')[0]] : [])))]
  const name = (title?.trim() || session.goal).replace(/\s+/g, ' ').slice(0, 80)

  return {
    workflow: {
      name,
      description: `Learned from: ${session.goal}`.slice(0, 300),
      steps,
      inputs,
      tags: ['skill'],
      settings: { onFailure: 'pause', maxIterations: 100, permissions }
    },
    meta: {
      format: SKILL_FORMAT,
      whenToUse: session.goal.slice(0, 300),
      examples: [],
      domains: [...domains],
      category: 'Custom',
      prerequisites: steps.some((step) => step.type === 'userAction')
        ? [{ description: 'Some steps need you: the skill will pause and ask when it gets there.' }]
        : [],
      trust: 'approved',
      enabled: true,
      createdFrom: { kind: 'step-run', runId: session.id, goal: session.goal }
    },
    notes
  }
}

// ---------------------------------------------------------------- is it safe to keep

/** Every secret-shaped value anywhere in a workflow's steps or defaults. Should always be empty for a skill. */
export function secretsIn(workflow: Pick<Workflow, 'steps' | 'inputs' | 'variables'>): string[] {
  const found: string[] = []
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (looksSecret(value)) found.push(path)
    } else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`))
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        // Ids are names Orbis gave things, never something anybody typed.
        if (key === 'id' || key === 'workflowId') continue
        walk(item, path ? `${path}.${key}` : key)
      }
    }
  }
  walk(workflow.steps, 'steps')
  walk(workflow.inputs.map((input) => input.default), 'inputs')
  walk(workflow.variables, 'variables')
  return found
}

// ---------------------------------------------------------------- finding the right one

export interface SkillMatch {
  meta: SkillMeta
  workflow: Pick<Workflow, 'id' | 'name' | 'description'>
  score: number
  level: 'high' | 'medium' | 'low'
  /** Short, for diagnostics: why this skill came up. Never model reasoning. */
  reasons: string[]
}

const STOP = new Set('a an the this that these those my me i to of for on in at from with and or please can you could would get grab find show open go it its is be do make'.split(' '))

/** Words, lowercased, with the commonest endings taken off so "downloads" finds "download". */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map((word) => word.replace(/(ing|ed|es|s)$/, '').replace(/(.)\1$/, '$1'))
    .filter(Boolean)
}

/** Some words mean the same thing to someone asking for a task. Kept small and plain, not a thesaurus. */
const SAME: string[][] = [
  ['newest', 'latest', 'recent', 'new', 'last'],
  ['download', 'save', 'fetch', 'grab'],
  ['paper', 'article', 'document', 'pdf', 'report'],
  ['search', 'look', 'find', 'query'],
  ['buy', 'purchase', 'order'],
  ['email', 'mail', 'message']
]
const CANON = new Map(SAME.flatMap((group) => group.map((word) => [words(word)[0] ?? word, group[0]] as const)))
const canon = (word: string): string => CANON.get(word) ?? word

/** Whether a site pattern covers a hostname: "example.com" covers "example.com" and "www.example.com"; "*.example.com" covers its subdomains. */
export function domainCovers(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase().replace(/^www\./, '')
  const h = host.toLowerCase().replace(/^www\./, '')
  if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1))
  return h === p
}

/**
 * Skills that might do what was asked, best first, without a model.
 *
 * Words in common with what the skill is for and how it has been asked for, with a few everyday synonyms folded
 * together; a real boost when the page being looked at is a site the skill belongs to; and a skill tied to other sites
 * is kept out of the high band, because a procedure for one site run on another is how things go wrong. Disabled and
 * untrusted skills are never offered. It works offline; when Orion can be asked, it gets the final say among these.
 */
export function rankSkills(request: string, skills: { meta: SkillMeta; workflow: Pick<Workflow, 'id' | 'name' | 'description'> }[], currentUrl?: string): SkillMatch[] {
  const asked = new Set(words(request).map(canon))
  if (!asked.size) return []
  const host = hostOf(currentUrl)
  const out: SkillMatch[] = []

  for (const skill of skills) {
    if (!skill.meta.enabled || skill.meta.trust === 'untrusted') continue
    const reasons: string[] = []
    const known = new Set([skill.workflow.name, skill.meta.whenToUse, ...skill.meta.examples].flatMap(words).map(canon))
    const shared = [...asked].filter((word) => known.has(word))
    let score = shared.length / asked.size
    if (shared.length) reasons.push(`shares “${shared.slice(0, 4).join('”, “')}”`)

    const tied = skill.meta.domains.length > 0
    const onSite = Boolean(host && skill.meta.domains.some((pattern) => domainCovers(pattern, host)))
    const named = skill.meta.domains.some((pattern) => request.toLowerCase().includes(pattern.replace(/^\*\./, '')))
    if (onSite || named) {
      score += 0.25
      reasons.push(onSite ? 'you are on its site' : 'you named its site')
    }
    score = Math.min(1, Math.round(score * 100) / 100)

    let level: SkillMatch['level'] = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low'
    if (tied && !onSite && !named && level === 'high') {
      level = 'medium'
      reasons.push('it was made for another site')
    }
    if (score > 0) out.push({ ...skill, score, level, reasons })
  }
  return out.sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------- how it is doing

export interface SkillStats {
  runs: number
  succeeded: number
  failed: number
  averageMs?: number
  lastUsedAt?: number
  lastSucceededAt?: number
  /** Failures in a row on the current version, newest first. */
  failingStreak: number
}

/** Read from the workflow's real run history, and nothing else. */
export function skillStats(runs: WorkflowRunSummary[], currentVersion?: number): SkillStats {
  const sorted = [...runs].sort((a, b) => b.startedAt - a.startedAt)
  const finished = sorted.filter((run) => run.status !== 'stopped')
  const succeeded = finished.filter((run) => run.status === 'completed')
  let failingStreak = 0
  for (const run of finished) {
    if (currentVersion !== undefined && run.version !== currentVersion) break
    if (run.status !== 'failed') break
    failingStreak++
  }
  return {
    runs: sorted.length,
    succeeded: succeeded.length,
    failed: finished.length - succeeded.length,
    averageMs: succeeded.length ? Math.round(succeeded.reduce((sum, run) => sum + run.durationMs, 0) / succeeded.length) : undefined,
    lastUsedAt: sorted[0]?.startedAt,
    lastSucceededAt: succeeded[0]?.startedAt,
    failingStreak
  }
}

export const UNSTABLE_AFTER = 3

export function skillHealth(meta: SkillMeta, stats: SkillStats): SkillHealth {
  if (!meta.enabled) return 'disabled'
  if (stats.failingStreak >= UNSTABLE_AFTER) return 'unstable'
  if (meta.trust === 'untrusted' || stats.failingStreak > 0) return 'needs-review'
  return 'verified'
}

/** The newest version that has a completed run — the one to go back to when a newer one keeps failing. */
export function knownGoodVersion(runs: WorkflowRunSummary[]): number | undefined {
  const good = runs.filter((run) => run.status === 'completed').map((run) => run.version)
  return good.length ? Math.max(...good) : undefined
}

// ---------------------------------------------------------------- sharing

export interface SkillExport {
  format: typeof SKILL_FORMAT
  kind: 'orbis-skill'
  exportedAt: number
  meta: Omit<SkillMeta, 'workflowId' | 'knownGoodVersion'>
  /** The procedure, in Orbis's own workflow export format. */
  workflow: unknown
}

/**
 * Reads a shared skill and decides what may be kept of it.
 *
 * An imported skill is somebody else's instructions for driving this browser, so it arrives switched off and
 * untrusted, and it is refused outright if it carries anything secret-shaped or asks for a capability this Orbis does
 * not have. What it says about itself is text, never instructions: a description that tells Orion to do something is
 * just a description.
 */
export function checkSkillImport(raw: unknown, capabilities: CapabilityDescriptor[]): { ok: true; meta: SkillExport['meta']; workflow: unknown; warnings: string[] } | { ok: false; why: string } {
  const data = raw as Partial<SkillExport> | null
  if (!data || typeof data !== 'object' || data.kind !== 'orbis-skill') return { ok: false, why: 'That is not an Orbis skill.' }
  if (data.format !== SKILL_FORMAT) return { ok: false, why: `That skill was made for a different version of Orbis skills (${String(data.format)}).` }
  const meta = data.meta as Partial<SkillMeta> | undefined
  const workflow = data.workflow as { workflow?: Partial<Workflow> } | undefined
  if (!meta || typeof meta.whenToUse !== 'string' || !workflow?.workflow || !Array.isArray(workflow.workflow.steps)) return { ok: false, why: 'The skill is incomplete.' }

  const steps = workflow.workflow.steps as WorkflowStep[]
  const secrets = secretsIn({ steps, inputs: (workflow.workflow.inputs ?? []) as WorkflowInput[], variables: workflow.workflow.variables ?? {} })
  if (secrets.length) return { ok: false, why: 'The skill contains something that looks like a password, key or token, so it was not imported.' }

  const known = new Set(capabilities.map((c) => c.id))
  const used = new Set<string>()
  const walk = (list: WorkflowStep[]): void => {
    for (const step of list) {
      if (step.type === 'action') used.add(step.capability)
      if (step.type === 'if') {
        walk(step.then)
        step.elseIf?.forEach((branch) => walk(branch.steps))
        walk(step.else ?? [])
      }
      if (step.type === 'repeat') walk(step.steps)
    }
  }
  walk(steps)
  const unknown = [...used].filter((id) => !known.has(id))
  if (unknown.length) return { ok: false, why: `The skill needs something this Orbis cannot do: ${unknown.join(', ')}.` }

  const clean = (text: unknown, max: number): string => (typeof text === 'string' ? text.replace(/[ -]/g, ' ').slice(0, max) : '')
  return {
    ok: true,
    meta: {
      format: SKILL_FORMAT,
      whenToUse: clean(meta.whenToUse, 300),
      examples: (Array.isArray(meta.examples) ? meta.examples : []).map((e) => clean(e, 200)).filter(Boolean).slice(0, 10),
      domains: (Array.isArray(meta.domains) ? meta.domains : []).map((d) => clean(d, 100).toLowerCase()).filter((d) => /^(\*\.)?[a-z0-9.-]+$/.test(d)).slice(0, 20),
      category: clean(meta.category, 40) || 'Custom',
      prerequisites: (Array.isArray(meta.prerequisites) ? meta.prerequisites : []).map((p) => ({ description: clean((p as SkillPrerequisite).description, 200) })).filter((p) => p.description).slice(0, 10),
      // Whatever the file says about itself, somebody else's skill starts off switched off and untrusted.
      trust: 'untrusted',
      enabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdFrom: { kind: 'import' }
    },
    workflow: data.workflow,
    warnings: [...used].some((id) => capabilities.find((c) => c.id === id)?.mutates)
      ? ['This skill changes things in the browser. Look through its steps before switching it on.']
      : []
  }
}

export function normalizeSkillSettings(raw: unknown): SkillSettings {
  const r = (raw ?? {}) as Partial<SkillSettings>
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SKILL_SETTINGS.enabled,
    learnFromRuns: typeof r.learnFromRuns === 'boolean' ? r.learnFromRuns : DEFAULT_SKILL_SETTINGS.learnFromRuns,
    reuse: r.reuse === 'never' || r.reuse === 'auto' || r.reuse === 'suggest' ? r.reuse : DEFAULT_SKILL_SETTINGS.reuse
  }
}
