import type { ParamSpec } from '../../shared/browserControl.ts'
import type { BrowserControl } from '../browserControl/registry.ts'
import { fail } from '../browserControl/registry.ts'
import type { ArtifactService } from './service.ts'

/**
 * Making things, offered to the Orb.
 *
 * Two capabilities on the same registry every other action lives on, so "make me an expense tracker" said to the Orb
 * goes through the same door, the same checks and the same read-back as the Create screen -- there is no second way
 * to make an artifact. Both ids are short on purpose: the Orb's planner is shown capabilities ordered by id length
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
    name: 'Make a document or a table',
    description: 'Makes a table or a document from a description. Orion decides which and writes it; Orbis builds it, keeps it in the library, reads the copy back and checks it. The artifact id comes back, with its title and kind.',
    params: { request: str('What to make, in ordinary words: "a monthly expense tracker", "a two-week study plan for calculus".', true) },
    keywords: ['make', 'create', 'write', 'draft', 'document', 'table', 'spreadsheet', 'report', 'tracker', 'plan', 'notes'],
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
    description: 'The documents and tables in the library, newest first, with their kind, size and whether the kept copy checked.',
    params: {},
    keywords: ['artifacts', 'library', 'documents', 'tables', 'made', 'created'],
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
}
