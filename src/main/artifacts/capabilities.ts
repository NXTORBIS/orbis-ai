import type { ParamSpec } from '../../shared/browserControl.ts'
import type { BrowserControl } from '../browserControl/registry.ts'
import { fail } from '../browserControl/registry.ts'
import type { ArtifactService } from './service.ts'

/**
 * Making things, offered to the Orb.
 *
 * A handful of capabilities on the same registry every other action lives on, so "make me an expense tracker" or
 * "only the HQ rows of my readings, biggest first" said to the Orb goes through the same door, the same checks and
 * the same read-back as the Create screen -- there is no second way to make or change an artifact. Every id is short
 * on purpose: the Orb's planner is shown capabilities ordered by id length
 * and cut at a hundred and forty, and a long id is a capability it never sees.
 *
 * `artifact.make` mutates and says so. A capability that declares `mutates: false` gets no resource lock and no
 * de-duplication, so an Orb retrying would make two of everything. And it verifies by asking the service whether the
 * artifact it just made is there and checked -- the registry would otherwise report "confirmed by the action itself"
 * for a run that threw nothing and wrote nothing.
 */

export interface ArtifactCapabilityDeps {
  service: ArtifactService
  profileId(): Promise<string>
}

const str = (description: string, required = false, extra: Partial<ParamSpec> = {}): ParamSpec => ({ type: 'string', description, required, ...extra })

export function registerArtifactCapabilities(control: BrowserControl, d: ArtifactCapabilityDeps): void {
  control.register({
    id: 'artifact.make',
    domain: 'artifacts',
    name: 'Make a document, a table, a flowchart or a code file',
    description: 'Makes a table, a document, a flowchart or one file of code from a description. Orion decides which and writes it; Orbis builds it, keeps it in the library, reads the copy back and checks it. The artifact id comes back, with its title and kind.',
    params: { request: str('What to make, in ordinary words: "a monthly expense tracker", "a two-week study plan for calculus".', true) },
    keywords: ['make', 'create', 'write', 'draft', 'document', 'table', 'spreadsheet', 'report', 'tracker', 'plan', 'notes', 'flowchart', 'diagram', 'script', 'code'],
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Make: ${typeof p.request === 'string' ? p.request.slice(0, 80) : ''}`,
    run: async (p) => {
      const request = typeof p.request === 'string' ? p.request.trim() : ''
      if (request === '') fail('invalid-params', 'Say what to make.')
      const result = await d.service.run(await d.profileId(), { operation: 'artifact.generate', request })
      if (!result.ok) fail('failed', result.message, true)
      const value = (result as { value: { record: { artifactId: string; title: string; kind: string; verified: { ok: boolean }; notes: string[] } } }).value
      return {
        artifactId: value.record.artifactId,
        title: value.record.title,
        kind: value.record.kind,
        verified: value.record.verified.ok,
        notes: value.record.notes,
        detail: `Made "${value.record.title}" (${value.record.kind}) and checked the kept copy.`
      }
    },
    verify: async (data) => {
      const { artifactId } = data as { artifactId: string }
      const result = await d.service.run(await d.profileId(), { operation: 'artifact.read', artifactId })
      if (!result.ok) return { verified: false, detail: `The artifact is not there: ${result.message}` }
      const record = (result as { value: { record: { title: string; verified: { ok: boolean } } } }).value.record
      return { verified: record.verified.ok, detail: record.verified.ok ? `"${record.title}" is in the library and its copy checked.` : `"${record.title}" is there but its copy did not check.` }
    }
  })

  control.register({
    id: 'artifact.list',
    domain: 'artifacts',
    name: 'List what has been made',
    description: 'Everything in the library -- tables, documents, charts, diagrams, code -- newest first, with its kind, size and whether the kept copy checked. This is where an artifact id comes from.',
    params: {},
    keywords: ['artifacts', 'library', 'documents', 'tables', 'charts', 'diagrams', 'code', 'made', 'created'],
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const result = await d.service.run(await d.profileId(), { operation: 'artifact.list' })
      if (!result.ok) fail('failed', result.message, true)
      const items = (result as { value: { record: { artifactId: string; title: string; kind: string; bytes: number; updatedAt: number; verified: { ok: boolean } } }[] }).value
      return {
        count: items.length,
        artifacts: items.map(({ record }) => ({ artifactId: record.artifactId, title: record.title, kind: record.kind, bytes: record.bytes, updatedAt: record.updatedAt, verified: record.verified.ok }))
      }
    }
  })

  /** What a changed artifact reports, and how it is checked: by reading it again from the library. */
  type Changed = { record: { artifactId: string; title: string; kind: string; version: number; verified: { ok: boolean }; notes: string[] } }
  const changed = (value: Changed, detail: string): Record<string, unknown> => ({
    artifactId: value.record.artifactId,
    title: value.record.title,
    kind: value.record.kind,
    version: value.record.version,
    verified: value.record.verified.ok,
    notes: value.record.notes,
    detail
  })
  const reread = async (data: unknown): Promise<{ verified: boolean; detail: string }> => {
    const { artifactId, version } = data as { artifactId: string; version: number }
    const result = await d.service.run(await d.profileId(), { operation: 'artifact.read', artifactId })
    if (!result.ok) return { verified: false, detail: `The artifact is not there: ${result.message}` }
    const record = (result as { value: { record: { title: string; version: number; verified: { ok: boolean } } } }).value.record
    const there = record.verified.ok && record.version === version
    return { verified: there, detail: there ? `"${record.title}" is in the library at version ${record.version} and its copy checked.` : `"${record.title}" is there but is not the version that was just made, or its copy did not check.` }
  }
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

  control.register({
    id: 'artifact.change',
    domain: 'artifacts',
    name: 'Change a table',
    description: 'Changes a table in the library from a description: keep some rows, sort, add a worked-out column, group and total, keep or drop columns. Orion turns the words into steps having seen only the column names; Orbis works out every number and says what each step did. The result is a new version of the same table; the one before is kept.',
    params: {
      artifactId: str('The table to change. Get it from artifact.list.', true),
      request: str('The change, in ordinary words: "only the HQ rows, biggest first", "add profit = revenue - cost", "total sales by region".', true)
    },
    keywords: ['change', 'filter', 'sort', 'total', 'sum', 'group', 'column', 'rows', 'table', 'calculate'],
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Change the table: ${text(p.request).slice(0, 80)}`,
    run: async (p) => {
      if (text(p.artifactId) === '' || text(p.request) === '') fail('invalid-params', 'Say which table and what to change.')
      const result = await d.service.run(await d.profileId(), { operation: 'artifact.transform', artifactId: text(p.artifactId), request: text(p.request) })
      if (!result.ok) fail('failed', result.message, true)
      const value = (result as { value: Changed & { did: string[] } }).value
      return { ...changed(value, `Changed "${value.record.title}": ${value.did.join(' ')}`), did: value.did }
    },
    verify: reread
  })

  control.register({
    id: 'artifact.chart',
    domain: 'artifacts',
    name: 'Draw a chart from a table',
    description: 'Draws a chart from the columns of a table in the library. The numbers are the table\'s own; nothing is invented. The chart is kept as a drawing that remembers the table, and its id comes back.',
    params: {
      artifactId: str('The table to draw from. Get it from artifact.list.', true),
      x: str('The column that runs along the bottom, by name.', true),
      y: str('The column to draw, by name. Several, separated by commas.', true),
      kind: str('How to draw it: line, bar, scatter, area or step. Line when not said.')
    },
    keywords: ['chart', 'graph', 'plot', 'bar', 'line', 'draw', 'visualise', 'visualize'],
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Draw ${text(p.y)} against ${text(p.x)}`,
    run: async (p) => {
      const y = text(p.y)
        .split(',')
        .map((one) => one.trim())
        .filter((one) => one !== '')
      if (text(p.artifactId) === '' || text(p.x) === '' || y.length === 0) fail('invalid-params', 'Say which table, which column runs along the bottom, and which to draw.')
      const result = await d.service.run(await d.profileId(), { operation: 'artifact.chart', artifactId: text(p.artifactId), x: text(p.x), y, kind: text(p.kind) })
      if (!result.ok) fail('failed', result.message, true)
      const value = (result as { value: Changed }).value
      return changed(value, `Drew "${value.record.title}" and checked the kept copy.`)
    },
    verify: reread
  })

  control.register({
    id: 'artifact.revise',
    domain: 'artifacts',
    name: 'Revise a document, a flowchart or a code file',
    description: 'Changes a document, a flowchart or a code file in the library from an instruction. Orion rewrites it whole; Orbis builds it, keeps it as a new version and checks the copy. The version before is kept. Tables are changed with artifact.change instead.',
    params: {
      artifactId: str('What to revise. Get it from artifact.list.', true),
      request: str('The change, in ordinary words: "make it shorter", "add a section on risks", "add a step to check the email first".', true)
    },
    keywords: ['revise', 'rewrite', 'edit', 'shorten', 'expand', 'improve', 'document', 'flowchart', 'code'],
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Revise: ${text(p.request).slice(0, 80)}`,
    run: async (p) => {
      if (text(p.artifactId) === '' || text(p.request) === '') fail('invalid-params', 'Say what to revise and how.')
      const result = await d.service.run(await d.profileId(), { operation: 'artifact.revise', artifactId: text(p.artifactId), request: text(p.request) })
      if (!result.ok) fail('failed', result.message, true)
      const value = (result as { value: Changed }).value
      return changed(value, `Revised "${value.record.title}" as version ${value.record.version}; the one before is kept.`)
    },
    verify: reread
  })
}
