// The composition plan: an ordered list of sections the user can edit, lock and undo.
// A plan is a statement of intent. It never claims the generated audio follows it.

import type { LyricDocument, SectionType } from './lyrics.ts'

export type Energy = 'unspecified' | 'low' | 'medium' | 'high'
export type Vocal = 'unspecified' | 'none' | 'lead'

export interface PlanSection {
  id: string
  type: SectionType
  name: string
  purpose: string
  energy: Energy
  vocal: Vocal
  /** The lyric section this one carries, by LyricSection.id. */
  lyricSectionId: string | null
  /** `user` when the user wrote it (markers, edits); `inferred` when proposed by the planner. */
  origin: 'user' | 'inferred'
  locked: boolean
}

export interface Plan {
  sections: PlanSection[]
  ending: string
  targetSec: number | null
  revision: number
  /** Earlier states, newest last, for undo. */
  past: PlanSection[][]
}

export function proposePlan(doc: LyricDocument | null, instrumental: boolean): Plan {
  const sections: PlanSection[] = []
  if (doc && doc.labelled && !instrumental) {
    for (const s of doc.sections) {
      sections.push({ id: `p-${s.id}`, type: s.type, name: s.label, purpose: '', energy: 'unspecified', vocal: s.lines.length ? 'lead' : 'none', lyricSectionId: s.id, origin: 'user', locked: false })
    }
  } else {
    sections.push({ id: 'p-whole', type: 'free', name: 'Whole song', purpose: '', energy: 'unspecified', vocal: instrumental ? 'none' : 'unspecified', lyricSectionId: null, origin: 'inferred', locked: false })
  }
  return { sections, ending: '', targetSec: null, revision: 0, past: [] }
}

export type Edit =
  | { op: 'set'; id: string; field: 'name' | 'purpose' | 'energy' | 'vocal' | 'type'; value: string }
  | { op: 'move'; id: string; by: -1 | 1 }
  | { op: 'remove'; id: string }
  | { op: 'add'; section: Omit<PlanSection, 'origin' | 'locked'>; after?: string }
  | { op: 'lock'; id: string; locked: boolean }
  | { op: 'ending'; value: string }
  | { op: 'target'; seconds: number | null }

export type EditResult = { ok: true; plan: Plan } | { ok: false; reason: string }

const push = (p: Plan, sections: PlanSection[], extra: Partial<Plan> = {}): Plan => ({ ...p, ...extra, sections, revision: p.revision + 1, past: [...p.past, p.sections].slice(-50) })

export function edit(p: Plan, e: Edit): EditResult {
  const idx = 'id' in e ? p.sections.findIndex((s) => s.id === e.id) : -1
  if ('id' in e && idx < 0) return { ok: false, reason: 'That section no longer exists.' }
  switch (e.op) {
    case 'set': {
      const s = p.sections[idx]
      if (s.locked) return { ok: false, reason: `"${s.name}" is locked.` }
      if (e.field === 'energy' && !['unspecified', 'low', 'medium', 'high'].includes(e.value)) return { ok: false, reason: 'Unknown energy.' }
      if (e.field === 'vocal' && !['unspecified', 'none', 'lead'].includes(e.value)) return { ok: false, reason: 'Unknown vocal setting.' }
      const next = { ...s, [e.field]: e.value, origin: 'user' as const }
      return { ok: true, plan: push(p, p.sections.map((x, i) => (i === idx ? next : x))) }
    }
    case 'move': {
      const to = idx + e.by
      if (to < 0 || to >= p.sections.length) return { ok: false, reason: 'It cannot move further.' }
      if (p.sections[idx].locked || p.sections[to].locked) return { ok: false, reason: 'A locked section cannot be moved or displaced.' }
      const arr = [...p.sections]
      ;[arr[idx], arr[to]] = [arr[to], arr[idx]]
      return { ok: true, plan: push(p, arr) }
    }
    case 'remove':
      if (p.sections[idx].locked) return { ok: false, reason: 'A locked section cannot be removed.' }
      if (p.sections.length === 1) return { ok: false, reason: 'A plan needs at least one section.' }
      return { ok: true, plan: push(p, p.sections.filter((_, i) => i !== idx)) }
    case 'add': {
      if (p.sections.some((s) => s.id === e.section.id)) return { ok: false, reason: 'That section id is already used.' }
      const at = e.after ? p.sections.findIndex((s) => s.id === e.after) + 1 : p.sections.length
      const arr = [...p.sections]
      arr.splice(Math.max(0, at), 0, { ...e.section, origin: 'user', locked: false })
      return { ok: true, plan: push(p, arr) }
    }
    case 'lock':
      return { ok: true, plan: push(p, p.sections.map((s, i) => (i === idx ? { ...s, locked: e.locked } : s))) }
    case 'ending':
      return { ok: true, plan: push(p, p.sections, { ending: e.value.slice(0, 300) }) }
    case 'target':
      if (e.seconds !== null && !(e.seconds > 0 && e.seconds <= 3600)) return { ok: false, reason: 'Target length must be between 1 second and 1 hour.' }
      return { ok: true, plan: push(p, p.sections, { targetSec: e.seconds }) }
  }
}

export function undo(p: Plan): Plan {
  const prev = p.past[p.past.length - 1]
  if (!prev) return p
  return { ...p, sections: prev, past: p.past.slice(0, -1), revision: p.revision + 1 }
}

export interface Finding { level: 'error' | 'advice'; section?: string; message: string }

export function validate(p: Plan, doc: LyricDocument | null, instrumental: boolean): Finding[] {
  const out: Finding[] = []
  const ids = p.sections.map((s) => s.id)
  if (new Set(ids).size !== ids.length) out.push({ level: 'error', message: 'Two sections share an id.' })
  const lyricIds = new Set(doc?.sections.map((s) => s.id) ?? [])
  for (const s of p.sections) {
    if (s.lyricSectionId && !lyricIds.has(s.lyricSectionId)) out.push({ level: 'error', section: s.name, message: 'It points at lyrics that no longer exist.' })
    if (instrumental && s.vocal === 'lead') out.push({ level: 'error', section: s.name, message: 'The song is instrumental but this section asks for a lead vocal.' })
    if (instrumental && s.lyricSectionId) out.push({ level: 'error', section: s.name, message: 'The song is instrumental but this section carries lyrics.' })
  }
  if (doc) {
    const used = new Set(p.sections.map((s) => s.lyricSectionId))
    for (const l of doc.sections) if (l.lines.length && !used.has(l.id) && !instrumental) out.push({ level: 'advice', section: l.label, message: 'These lyrics are not carried by any plan section.' })
  }
  return out
}
