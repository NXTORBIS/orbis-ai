/** The result of Orbis checking itself: a list of plain findings, worst first. Pure, so the wording is testable. */

export type CheckState = 'ok' | 'warn' | 'bad'

export interface DoctorCheck {
  id: string
  name: string
  state: CheckState
  /** One sentence for a person: what was found, and what to do if anything. */
  detail: string
}

const ORDER: Record<CheckState, number> = { bad: 0, warn: 1, ok: 2 }

export function sortChecks(checks: DoctorCheck[]): DoctorCheck[] {
  return [...checks].sort((a, b) => ORDER[a.state] - ORDER[b.state])
}

export function headline(checks: DoctorCheck[]): string {
  const bad = checks.filter((c) => c.state === 'bad').length
  const warn = checks.filter((c) => c.state === 'warn').length
  if (bad === 0 && warn === 0) return `All ${checks.length} checks passed.`
  const parts: string[] = []
  if (bad) parts.push(`${bad} problem${bad === 1 ? '' : 's'}`)
  if (warn) parts.push(`${warn} thing${warn === 1 ? '' : 's'} to look at`)
  return `${parts.join(' and ')}, out of ${checks.length} checks.`
}

/** What a data file read said: parsed, empty, or damaged. A damaged file is named; an unreadable one is not "missing". */
export function fileCheck(name: string, results: { file: string; error: string | null }[]): DoctorCheck {
  const bad = results.filter((r) => r.error)
  if (bad.length === 0) return { id: 'data-files', name, state: 'ok', detail: `${results.length} data files read cleanly.` }
  const names = bad.slice(0, 4).map((r) => r.file).join(', ')
  return {
    id: 'data-files',
    name,
    state: 'bad',
    detail: `${bad.length} of ${results.length} data files could not be read (${names}${bad.length > 4 ? ', and more' : ''}). Nothing was changed; Orbis keeps a damaged file aside instead of overwriting it.`
  }
}

export function diskCheck(freeBytes: number | null): DoctorCheck {
  if (freeBytes === null) return { id: 'disk', name: 'Free disk space', state: 'warn', detail: 'Orbis could not read how much space is free.' }
  const gb = freeBytes / 1024 ** 3
  if (gb < 1) return { id: 'disk', name: 'Free disk space', state: 'bad', detail: `Only ${gb.toFixed(1)} GB is free. Saving may fail.` }
  if (gb < 5) return { id: 'disk', name: 'Free disk space', state: 'warn', detail: `${gb.toFixed(1)} GB is free. That is getting low.` }
  return { id: 'disk', name: 'Free disk space', state: 'ok', detail: `${Math.floor(gb)} GB is free.` }
}
