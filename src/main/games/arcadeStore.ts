import { JsonFile, personalFile } from '../storage/jsonFile.ts'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { emptyKept, readKept, type ArcadeAnswer, type KeptArcade } from '../../shared/games/kept.ts'

/**
 * Where the arcade's scores live, now that they belong to a person rather than to a window.
 *
 * They were in `localStorage` until this file existed, which has three consequences nobody chose: a second Orbis
 * window keeps its own scores, two people sharing a computer share one high-score table, and a profile taken to
 * another machine arrives with nothing played. One file in the profile fixes all three, and `src/main/chess/data.ts`
 * is the same move made this afternoon for the same reason.
 *
 * ## One file, not six
 *
 * Chess World's record is six files because a puzzle solved at two in the morning must not rewrite the board
 * colours, and because a file that cannot be read takes everything in it down together. The arcade is one file
 * because everything in it is written at the same moment: a run finishes, and the best score, the run list, the
 * recently played row and the saved board all change together. Two files would be two writes that have to agree,
 * and a run counted in one but not the other is worse than a write that did not happen.
 *
 * It stays small on purpose. `src/shared/games/record.ts` keeps four hundred runs one by one and adds the older ones
 * up, so the growing part has a ceiling rather than a year of somebody's playing read into memory on every launch.
 *
 * ## There is no clock in here
 *
 * Deliberately. Every day, streak and challenge in the arcade is worked out in `src/shared/games` from a `now`
 * handed in, so nothing can award anything by reading the clock at a convenient moment -- and this store, which is
 * the only thing between that and the disk, has no clock to read.
 *
 * ## What it refuses, and what it says
 *
 * The refusals are the feature, and they are `JsonFile`'s underneath. A file that is missing is written. A file that
 * is there and makes no sense is moved aside under its own name with the time on it, so the words stay on the disk,
 * and then written. A file that is there and **cannot be read at all** is not written to at all -- on Windows a file
 * is unreadable for a moment often enough to matter, and refusing is recoverable where overwriting is not.
 *
 * Every answer carries that honestly. `notes` is everything in the file that could not be read, in sentences written
 * to be shown. `refused` is set only when nothing was written, so a save whose answer has `refused` set **did not
 * happen** and the screen must say so rather than show the new scores as kept.
 */

const REFUSAL =
  'Orbis could not read the scores already saved here, so nothing has been written over them. Another program may be holding the file; try again in a moment.'

const why = (err: unknown): string => (err instanceof Error ? err.message : 'it could not be read')

/** The one file, relative to a profile's own folder. Here so the profile export can name it. */
export const ARCADE_FILES: readonly string[] = Object.freeze(['personal/arcade.json'])

export class ArcadeStore {
  private readonly userData: string
  private readonly file: JsonFile<KeptArcade>
  /** What could not be read out of whatever is currently held, from the last read or the last save. */
  private notes: readonly string[] = []

  constructor(userData: string, profileId: string = DEFAULT_PROFILE_ID) {
    this.userData = userData
    this.file = new JsonFile<KeptArcade>(
      personalFile(userData, profileId, 'arcade.json'),
      () => emptyKept(),
      (raw) => {
        // Throwing from here is how `storedFile.ts` is told the file is damaged rather than merely unreadable, so a
        // file this version cannot make sense of is moved aside instead of written over. `readKept` decides which.
        const read = readKept(raw)
        this.notes = read.notes
        return read.value
      },
      // No "your" on the front: `damageNote` puts one there, and two of them reads "your your game scores".
      { what: 'game scores' }
    )
  }

  async read(): Promise<ArcadeAnswer<KeptArcade>> {
    const value = await this.file.read()
    const damage = this.file.problem()
    return {
      value,
      notes: damage === null ? this.notes : [damage, ...this.notes],
      // Only when nothing may be written. A file that was damaged and moved aside has a problem and may be written,
      // and reporting that as a refusal would tell somebody their save failed when it is about to succeed.
      refused: this.file.mayWrite() === false ? (damage ?? REFUSAL) : null
    }
  }

  /**
   * Keeps what the window sent.
   *
   * It goes through exactly the same reader the file does, so there is one place that decides what a stored record
   * may be. A renderer is not trusted to send the right shape, and the answer is what was really stored rather than
   * what arrived -- so a screen showing the answer is showing the truth.
   */
  async save(raw: unknown): Promise<ArcadeAnswer<KeptArcade>> {
    // Read first, so whether this file may be written is known before anything is reported as saved.
    const held = await this.file.read()
    const damage = this.file.problem()
    if (this.file.mayWrite() === false) {
      return { value: held, notes: this.notes, refused: damage ?? REFUSAL }
    }
    let read: { value: KeptArcade; notes: string[] }
    try {
      read = readKept(raw)
    } catch (err) {
      return { value: held, notes: this.notes, refused: `Orbis could not make sense of the game scores it was asked to save, so nothing was changed: ${why(err)}.` }
    }
    await this.file.write(read.value)
    this.notes = read.notes
    return { value: read.value, notes: read.notes, refused: null }
  }

  /** Follows the profile, like everything personal in Orbis, so two people on one computer never share a record. */
  async useProfile(profileId: string): Promise<void> {
    await this.file.usePath(personalFile(this.userData, profileId, 'arcade.json'))
    // A different file: what could not be read in the last one says nothing about this one.
    this.notes = []
  }

  /** Writes what is pending and waits for it. What `QuitFlush` is given, so the close waits for the last save. */
  flush(): Promise<void> {
    return this.file.flush()
  }

  /** The same at the very end of the process, where there is nothing left to wait with. */
  flushSync(): void {
    this.file.flushSync()
  }
}
