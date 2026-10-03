import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { dataDirFor } from '../shared/profiles.ts'

/**
 * Files a project keeps, so every conversation in it already has them.
 *
 * A project could refer to a note or a saved page, and it could not hold a file. So the ordinary setup -- "here is
 * the spec, the data and the style guide; now answer questions about this work" -- meant attaching the same three
 * files to every message by hand, and forgetting one meant an answer confidently based on two of them.
 *
 * What is here is deliberately small, because the hard part already exists: the passage search that chooses which
 * parts of several files answer a question (src/shared/attachmentIndex.ts). A project's files go through exactly that,
 * so holding six files does not mean sending six files.
 *
 * Three rules:
 *
 * **A copy, taken once.** The file is copied into the project when it is added, so moving or deleting the original
 * afterwards does not quietly change what the project knows. A project whose answers depend on a path on one machine
 * is a project that breaks the day somebody tidies their desktop.
 *
 * **Text only, and that is said.** What is stored is the words, extracted when the file is added. A picture, a video
 * or an encrypted archive has no words, and is refused at the point of adding rather than accepted and then silently
 * absent from every answer.
 *
 * **It belongs to the profile it was added in.** Project files live beside that profile's other things and are never
 * read from another, exactly like everything else a profile holds.
 */

export interface ProjectFile {
  readonly id: string
  readonly name: string
  /** How many characters of text it holds. What the person sees as its size, since that is what gets searched. */
  readonly characters: number
  readonly addedAt: number
}

/** How much text one project may hold in total. Past it, nothing more is added until something is removed. */
export const PROJECT_FILES_LIMIT = 2_000_000

/** How many files one project may hold. */
export const MAX_PROJECT_FILES = 25

const ID = /^[a-f0-9]{16}$/

interface Saved {
  files: (ProjectFile & { text: string })[]
}

export class ProjectFiles {
  private readonly userData: string
  private readonly profileId: () => string
  private readonly now: () => number

  constructor(o: { userData: string; profileId: () => string; now?: () => number }) {
    this.userData = o.userData
    this.profileId = o.profileId
    this.now = o.now ?? (() => Date.now())
  }

  /** Where one project's files live. The project id is checked, because it reaches a path. */
  private dir(projectId: string): string | null {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) return null
    return join(this.userData, dataDirFor(this.profileId()), 'project-files', projectId)
  }

  private async read(projectId: string): Promise<Saved> {
    const dir = this.dir(projectId)
    if (!dir) return { files: [] }
    try {
      const raw = JSON.parse(await fs.readFile(join(dir, 'files.json'), 'utf8')) as unknown
      const files = Array.isArray((raw as Saved)?.files) ? (raw as Saved).files : []
      return {
        files: files.filter(
          (one) => Boolean(one) && typeof one.id === 'string' && ID.test(one.id) && typeof one.name === 'string' && typeof one.text === 'string'
        )
      }
    } catch {
      // A file list that will not read is a project with no files, never a crash on opening it.
      return { files: [] }
    }
  }

  private async write(projectId: string, saved: Saved): Promise<void> {
    const dir = this.dir(projectId)
    if (!dir) return
    await fs.mkdir(dir, { recursive: true })
    const path = join(dir, 'files.json')
    // Written whole and renamed, so an interrupted write cannot leave a project with half a file list.
    await fs.writeFile(`${path}.tmp`, JSON.stringify(saved), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(`${path}.tmp`, path)
  }

  /** The files a project holds, without their text. */
  async list(projectId: string): Promise<ProjectFile[]> {
    const saved = await this.read(projectId)
    return saved.files.map(({ text: _text, ...rest }) => rest)
  }

  /**
   * Adds a file's words to a project.
   *
   * The text is given rather than read from a path, because extracting it is the artifact layer's job and it already
   * knows how to read a workbook, a document, a PDF and a deck. What arrives here is words.
   */
  async add(projectId: string, name: string, text: string): Promise<{ ok: true; file: ProjectFile } | { ok: false; message: string }> {
    if (!this.dir(projectId)) return { ok: false, message: 'That is not a project.' }
    const words = String(text ?? '').trim()
    if (!words) return { ok: false, message: `${name} has no words in it that Orbis can read, so there would be nothing for it to answer from.` }

    const saved = await this.read(projectId)
    if (saved.files.length >= MAX_PROJECT_FILES) return { ok: false, message: `A project holds ${MAX_PROJECT_FILES} files. Remove one first.` }
    const held = saved.files.reduce((n, one) => n + one.text.length, 0)
    if (held + words.length > PROJECT_FILES_LIMIT) return { ok: false, message: 'That would be more text than one project holds. Remove something first.' }

    // The same file added twice is the same file, not two.
    const id = createHash('sha256').update(`${name}${LF}${words}`).digest('hex').slice(0, 16)
    const already = saved.files.find((one) => one.id === id)
    if (already) return { ok: true, file: { id: already.id, name: already.name, characters: already.characters, addedAt: already.addedAt } }

    const file = { id, name: name.slice(0, 160) || `file${extname(name)}`, characters: words.length, addedAt: this.now() }
    await this.write(projectId, { files: [...saved.files, { ...file, text: words }] })
    return { ok: true, file }
  }

  async remove(projectId: string, fileId: string): Promise<boolean> {
    const saved = await this.read(projectId)
    const left = saved.files.filter((one) => one.id !== fileId)
    if (left.length === saved.files.length) return false
    await this.write(projectId, { files: left })
    return true
  }

  /** A project's files as something the passage search can read: name and words. */
  async forSearch(projectId: string): Promise<{ name: string; text: string }[]> {
    const saved = await this.read(projectId)
    return saved.files.map((one) => ({ name: one.name, text: one.text }))
  }
}

const LF = String.fromCharCode(10)
