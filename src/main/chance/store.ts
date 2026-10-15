import { JsonFile, profileFile } from '../storage/jsonFile.ts'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'

/**
 * What Orbis Chance keeps: investigations, templates, preferences and what was opened recently.
 *
 * One file per profile, so one profile never sees another's work. The document is Orbis Chance's own and is validated
 * by Orbis Chance when it reads it back; here only its outline is checked, and a file that is not understood is left
 * untouched (the shared JsonFile refuses to write over it) rather than replaced by an empty one.
 */
export interface ChanceDocument {
  version: 1
  investigations: unknown[]
  templates: unknown[]
  preferences: unknown
  recent: unknown[]
}

const EMPTY = (): ChanceDocument => ({ version: 1, investigations: [], templates: [], preferences: {}, recent: [] })

/** A generous ceiling: datasets live inside investigations. Past this a save is refused, not truncated. */
export const MOST_BYTES = 64 * 1024 * 1024

const list = (value: unknown, limit: number): unknown[] => (Array.isArray(value) ? value.slice(0, limit) : [])

export function cleanDocument(raw: unknown): ChanceDocument {
  const one = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    version: 1,
    investigations: list(one.investigations, 5000),
    templates: list(one.templates, 1000),
    preferences: one.preferences !== null && typeof one.preferences === 'object' ? one.preferences : {},
    recent: list(one.recent, 100)
  }
}

export class ChanceStore {
  private readonly file: JsonFile<ChanceDocument>

  private readonly userData: string

  constructor(userData: string) {
    this.userData = userData
    this.file = new JsonFile<ChanceDocument>(profileFile(userData, DEFAULT_PROFILE_ID, 'chance', 'chance.json'), EMPTY, cleanDocument)
  }

  /** Moves to another profile's work. */
  async useProfile(profileId: string): Promise<void> {
    await this.file.usePath(profileFile(this.userData, profileId, 'chance', 'chance.json'))
  }

  load(): Promise<ChanceDocument> {
    return this.file.read()
  }

  async save(raw: unknown): Promise<void> {
    const document = cleanDocument(raw)
    if (JSON.stringify(document).length > MOST_BYTES) throw new Error('This is larger than Orbis Chance can keep. Export some investigations and delete them.')
    await this.file.write(document)
  }

  flush(): Promise<void> {
    return this.file.flush()
  }
}
