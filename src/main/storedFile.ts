import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Telling "there is no file" apart from "the file is there and I could not read it".
 *
 * Every store in Orbis read its file inside `try { ... } catch { return defaults }`. That one line makes an
 * unreadable file indistinguishable from a missing one, and on Windows a file is routinely unreadable for a moment:
 * antivirus has it open, a backup tool is copying it, a previous process still holds a handle. The next write then
 * renames defaults over real data, and it is gone.
 *
 * The worst case was the Secrets Vault. An unreadable `secrets.vault` made `status()` report that no vault existed,
 * which is an invitation to create one -- and creating one checked for an existing vault using the same failed read,
 * so it passed, and renamed a brand-new empty vault over every stored secret.
 *
 * Three rules:
 *
 * **Missing means missing.** Only `ENOENT` is "there is no file". Everything else is a file that exists and could not
 * be read, and is reported as exactly that.
 *
 * **Nothing destructive happens to a file that is merely unreadable.** Something that cannot be read may be perfectly
 * good -- a lock clears, a copy finishes. Refusing is recoverable; overwriting is not.
 *
 * **A file that is really damaged is moved aside, never deleted.** Quarantine renames it next to itself with the time
 * on it, so the words are still on the disk for somebody to recover, and Orbis can carry on with defaults rather than
 * refusing to start.
 */

export type Stored =
  /** There is no file. Starting from defaults is correct. */
  | { kind: 'missing' }
  /** The file was read. */
  | { kind: 'read'; text: string }
  /**
   * The file is there and could not be read. Starting from defaults is NOT correct, because writing them back would
   * replace something that exists.
   */
  | { kind: 'unreadable'; why: string }

/** Reads a stored file, saying which of the three happened. Never throws. */
export async function readStored(path: string): Promise<Stored> {
  try {
    return { kind: 'read', text: await fs.readFile(path, 'utf8') }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'unreadable', why: code ?? (err instanceof Error ? err.message : 'it could not be read') }
  }
}

/**
 * Moves a file out of the way so Orbis can start again without it.
 *
 * Renamed, never deleted: a file Orbis cannot make sense of may still be a file somebody can. The new name carries
 * the time so two bad files never collide, and `.unreadable` rather than `.bak` so nothing mistakes it for a backup
 * Orbis intends to use.
 *
 * Returns where it went, or null when it could not be moved -- in which case the caller must not overwrite it either.
 */
export async function quarantine(path: string, now = Date.now()): Promise<string | null> {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const to = `${path}.unreadable-${stamp}`
  try {
    await fs.rename(path, to)
    return to
  } catch (err) {
    // ENOENT means somebody else already moved it, which is the outcome wanted.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return to
    return null
  }
}

export interface Opened<T> {
  value: T
  /** True when the file was there and could not be read or made sense of. */
  wasDamaged: boolean
  /** Where the damaged file was put, when it was moved. Null when nothing was moved. */
  movedTo: string | null
  /** True when it is safe to write over this path. False means something is there that was not understood. */
  mayWrite: boolean
}

/**
 * The ordinary way to open a store's file.
 *
 * Missing gives the default and may be written. Readable and parsable gives the value. Readable but not parsable is
 * damaged: it is moved aside first -- so nothing is lost -- and only then may be written. Unreadable gives the
 * default and may **not** be written, because something is there and Orbis does not know what.
 */
export async function openStored<T>(path: string, parse: (text: string) => T, fallback: () => T, now = Date.now()): Promise<Opened<T>> {
  const stored = await readStored(path)
  if (stored.kind === 'missing') return { value: fallback(), wasDamaged: false, movedTo: null, mayWrite: true }
  if (stored.kind === 'unreadable') return { value: fallback(), wasDamaged: true, movedTo: null, mayWrite: false }
  try {
    return { value: parse(stored.text), wasDamaged: false, movedTo: null, mayWrite: true }
  } catch {
    const movedTo = await quarantine(path, now)
    // Moving it failed, so it is still there and still not understood: writing would destroy it.
    return { value: fallback(), wasDamaged: true, movedTo, mayWrite: movedTo !== null }
  }
}

/** What to tell somebody, in plain words. Null when nothing went wrong. */
export function damageNote(opened: Opened<unknown>, what: string): string | null {
  if (!opened.wasDamaged) return null
  if (opened.movedTo) return `Orbis could not make sense of your ${what}, so it was moved to ${opened.movedTo} and a fresh one started. Nothing was deleted.`
  return `Orbis could not read your ${what}. It has been left exactly as it is and nothing has been written over it. This is usually another program holding the file; try again in a moment.`
}

/** Writes a file beside itself and renames it over, so it is never half-written. Private by default. */
export async function writeStored(path: string, text: string, mode = 0o600): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, text, { encoding: 'utf8', mode })
  await fs.rename(tmp, path)
}

/** Where a store's file lives for one profile. Here so no caller has to remember the shape. */
export const storedPath = (userData: string, profileDir: string, name: string): string => join(userData, profileDir, name)
