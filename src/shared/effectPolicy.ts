import type { SideEffect } from './browserControl.ts'

/**
 * What Orbis may do on your behalf, by what it does rather than by which part of the browser it touches.
 *
 * The switches used to be per area -- tabs, downloads, markets. That answers "may Orion touch downloads", which is
 * rarely the question somebody actually has. The question people have is "it can read whatever it likes, but ask me
 * before it changes anything, and never let it delete anything", and that cuts across every area at once: there are
 * deletes in history, in downloads, in bookmarks, in extensions and in permissions, and a per-area switch cannot
 * express it without turning off five useful things to stop one.
 *
 * So there is a second axis. Each kind of effect -- read, write, delete, something that leaves this computer,
 * something that runs, something that proves who you are -- is set to allow, ask, or never. Both axes apply: an area
 * that is switched off stays off whatever this says, because two switches that disagree must fail towards doing less.
 *
 * Three rules:
 *
 * **It is about Orbis acting for you, never about you.** A person pressing a button in Orbis is not governed by this,
 * the same way the area switches do not govern them. This decides what Orion, a skill and a workflow may do when
 * nobody is watching.
 *
 * **The strongest effect decides.** An action that writes *and* sends something is judged as sending, because that is
 * the part that cannot be taken back.
 *
 * **The defaults do not surprise anybody.** Reading is allowed, writing is allowed, and everything that is hard to
 * undo asks first. Nothing is set to never by default: a switch nobody chose should not make Orbis look broken.
 */

export type EffectRule = 'allow' | 'ask' | 'never'

export type EffectPolicy = Readonly<Record<SideEffect, EffectRule>>

/** Reading and writing go ahead; anything hard to undo asks. Nothing starts at never. */
export const DEFAULT_EFFECT_POLICY: EffectPolicy = Object.freeze({
  read: 'allow',
  write: 'allow',
  delete: 'ask',
  communicate: 'ask',
  execute: 'ask',
  authenticate: 'ask'
})

export const EFFECTS: readonly SideEffect[] = Object.freeze(['read', 'write', 'delete', 'communicate', 'execute', 'authenticate'])

/** What each one is, in the words somebody would use. Shown beside its switch. */
export const EFFECT_LABELS: Readonly<Record<SideEffect, { label: string; blurb: string }>> = Object.freeze({
  read: { label: 'Look at things', blurb: 'Read a page, list your tabs, check a setting. Changes nothing.' },
  write: { label: 'Change things', blurb: 'Open a tab, fill a form, add a bookmark, change a setting.' },
  delete: { label: 'Remove things', blurb: 'Clear history, delete a download, remove a bookmark or an extension.' },
  communicate: { label: 'Send things', blurb: 'Submit a form, start a download, anything that leaves this computer.' },
  execute: { label: 'Run things', blurb: 'Open something in another program, or run a query on a page.' },
  authenticate: { label: 'Lock and unlock', blurb: 'Lock a tab or a profile, or change what Orbis is allowed to do.' }
})

/** How strong each effect is, so the strongest one in an action decides. */
const STRENGTH: Readonly<Record<SideEffect, number>> = Object.freeze({ read: 0, write: 1, execute: 2, communicate: 3, authenticate: 4, delete: 5 })

const RULE_ORDER: Readonly<Record<EffectRule, number>> = Object.freeze({ allow: 0, ask: 1, never: 2 })

/** One policy read back from settings, with anything missing or damaged taking the default rather than the loosest value. */
export function readEffectPolicy(raw: unknown): EffectPolicy {
  const given = (raw ?? {}) as Partial<Record<SideEffect, unknown>>
  const out = {} as Record<SideEffect, EffectRule>
  for (const effect of EFFECTS) {
    const value = given[effect]
    out[effect] = value === 'allow' || value === 'ask' || value === 'never' ? value : DEFAULT_EFFECT_POLICY[effect]
  }
  return Object.freeze(out)
}

/**
 * What an action's effects add up to.
 *
 * The strictest rule among them wins, which is the only safe way to combine them: an action that writes and deletes
 * has to be judged as a delete. With no effects listed at all it is treated as a write, because something that
 * declares nothing is not thereby harmless -- that is the assumption this whole file exists to stop.
 */
export function ruleFor(effects: readonly SideEffect[], policy: EffectPolicy): EffectRule {
  if (effects.length === 0) return policy.write
  return effects.map((one) => policy[one] ?? 'ask').reduce((worst, one) => (RULE_ORDER[one] > RULE_ORDER[worst] ? one : worst))
}

/** The effect that decided, so a refusal can say which one rather than listing all of them. */
export function decidingEffect(effects: readonly SideEffect[]): SideEffect {
  if (effects.length === 0) return 'write'
  return effects.reduce((worst, one) => (STRENGTH[one] > STRENGTH[worst] ? one : worst))
}

/** Why an action was refused, in the words somebody would use. Names the setting so it can be found and changed. */
export function refusalFor(effects: readonly SideEffect[]): string {
  const which = decidingEffect(effects)
  return `This would ${EFFECT_LABELS[which].label.toLowerCase()}, and that is switched off in Settings → What Orion may do. Orbis will not do it on your behalf.`
}

/** Why an action is being asked about, for the approval prompt. */
export function askFor(effects: readonly SideEffect[]): string {
  const which = decidingEffect(effects)
  return `This would ${EFFECT_LABELS[which].label.toLowerCase()}, and you asked to be told first.`
}
