import { JsonFile, personalFile } from '../storage/jsonFile.ts'
import { DEFAULT_PROFILE_ID } from '../../shared/profiles.ts'
import { readAcademyFile, readOpeningsFile, readProgressFile, readSettingsFile, readStudiesFile, readTrainingFile } from './shapes.ts'
import {
  emptyAcademy, emptyOpenings, emptyProgress, emptyTraining,
  type KeptAnswer, type StoredOpenings, type StoredProgress, type StoredTraining
} from '../../shared/chess/kept.ts'
import { dropStudy, emptyStudies, putStudy, readStudy, type StoredStudies, type StoredStudy } from '../../shared/chess/study.ts'
import { DEFAULT_CHESS_SETTINGS, type ChessSettings } from '../../shared/chess/settings.ts'
import type { AcademyProgress } from '../../shared/chess/academyPath.ts'

/**
 * Everything Chess World remembers about a person apart from their games.
 *
 * `store.ts` beside this holds the games and nothing else, which for a long time was all that was kept anywhere: the
 * preferences, the puzzle collection, the Academy record and the repertoire were all modelled in `shared/chess`, all
 * read back field by field so that one bad value cost one preference rather than a file -- and none of them was
 * written anywhere a profile could see. Three screens kept them in the window's own storage instead, which belongs
 * to the computer rather than to the profile and does not travel when a profile is exported. This is where they go.
 *
 * ## Six files, and why it is six rather than one
 *
 * **Something written on every move must not share a file with something written once a week.** Each save rewrites
 * its whole file, so a puzzle solved at two in the morning would otherwise rewrite the board colours, the study plan
 * and every goal with it -- and, far worse, a file that cannot be read takes everything in it down together. Six
 * files means six separate blast radii.
 *
 *   `chess-settings.json`   the preferences. Written when somebody changes one, which is rarely.
 *   `chess-training.json`   the puzzle collection, its history, the exercises, the review schedule, the attempts and
 *                           the ratings. Written on every attempt at every puzzle. The hottest of the five, and much
 *                           the largest.
 *   `chess-openings.json`   the repertoire and the goes at playing a line back from memory. Written when a line is
 *                           added or a drill ends -- a few times in a sitting, not a few times a minute. They are
 *                           together because a drill record is about a line and the two are always read as one
 *                           answer: how a line is going.
 *   `chess-academy.json`    the Academy record. Written as somebody moves through a lesson, so it is hot too -- and
 *                           it is its own file for a second reason: it is the only one tied to a curriculum, so it
 *                           is the only one whose whole contents can stop meaning anything when content changes.
 *   `chess-progress.json`   the study plan and the goals. Written when somebody reorders their plan or sets a goal.
 *                           The coldest of the six.
 *   `chess-studies.json`    what somebody has worked out about their games: the lines they tried, the notes they
 *                           wrote and what the engine said, kept against the game they are about. Written while
 *                           somebody is analysing, so it is hot -- and it is its own file for the reason that
 *                           matters most here: **an analysis that cannot be read must not cost the game.** The games
 *                           are in `store.ts`; a damaged study is a damaged study and the game still opens.
 *
 * There is no streak file and no file of sittings. Both are worked out -- from the attempts, the drills and the games
 * -- and a stored copy would be a second answer to a question that already has one. `shapes.ts` says more about why.
 * There is no file of analysis reports either, for the same reason: a report is worked out from the evaluations
 * stored with the study, and the one thing it cannot work out for itself -- what each pass of the engine was asked to
 * do and whether it finished -- is kept with the study as a run (Section 158).
 *
 * ## What it refuses, and what it says when it refuses
 *
 * The refusals are the feature. `JsonFile` underneath tells "there is no file" apart from "there is a file and Orbis
 * could not read it", and nothing is written to the second kind at all: on Windows a file is unreadable for a moment
 * often enough to matter, and overwriting is not recoverable where refusing is. A file that is there and makes no
 * sense is moved aside under its own name with the time on it before anything is written, so the words are still on
 * the disk.
 *
 * Every answer from this store carries that honestly. `notes` is everything in the file that could not be read, in
 * sentences somebody can be shown. `refused` is set only when nothing was written -- which means a save whose answer
 * has `refused` set did not happen, and the screen must say so rather than show the new value as kept. A save that
 * reported success and wrote nothing is the one failure worth more than all the others, because nobody goes looking.
 */

const REFUSAL = 'Orbis could not read what is already saved here, so nothing has been written over it. Another program may be holding the file; try again in a moment.'

const why = (err: unknown): string => (err instanceof Error ? err.message : 'it could not be read')

/** What the store needs of each of its files, so the five can be switched and flushed as a list. */
interface Switchable {
  useProfile(profileId: string): Promise<void>
  flush(): Promise<void>
  flushSync(): void
}

/** Everything that is the same about all five, so it is written once instead of five times. */
class ChessFile<T> {
  private readonly userData: string
  private readonly name: string
  private readonly what: string
  private readonly empty: () => T
  private readonly decode: (raw: unknown, now: number) => { value: T; notes: string[] }
  private readonly now: () => number
  private readonly file: JsonFile<T>
  /** What could not be read out of whatever is currently held, from the last read or the last save. */
  private notes: readonly string[] = []

  constructor(o: {
    userData: string
    profileId: string
    name: string
    what: string
    empty: () => T
    decode: (raw: unknown, now: number) => { value: T; notes: string[] }
    now: () => number
  }) {
    this.userData = o.userData
    this.name = o.name
    this.what = o.what
    this.empty = o.empty
    this.decode = o.decode
    this.now = o.now
    this.file = this.make(o.profileId)
  }

  /** The file underneath, with this one's reader wired into it. */
  private make(profileId: string): JsonFile<T> {
    return new JsonFile<T>(
      personalFile(this.userData, profileId, this.name),
      this.empty,
      (raw) => {
        // Throwing from here is how `storedFile.ts` is told the file is damaged rather than merely unreadable, so a
        // file this version cannot make sense of is moved aside instead of written over. `shapes.ts` decides which.
        const read = this.decode(raw, this.now())
        this.notes = read.notes
        return read.value
      },
      { what: this.what }
    )
  }

  async read(): Promise<KeptAnswer<T>> {
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
   * Keeps a value the window sent.
   *
   * It goes through exactly the same reader the file does, so there is one place that decides what a stored record
   * may be. A renderer is not trusted to send the right shape, and the answer is what was really stored rather than
   * what arrived -- so a screen showing the answer is showing the truth.
   */
  async save(raw: unknown): Promise<KeptAnswer<T>> {
    // Read first, so whether this file may be written is known before anything is reported as saved.
    const held = await this.file.read()
    const damage = this.file.problem()
    if (this.file.mayWrite() === false) {
      return { value: held, notes: this.notes, refused: damage ?? REFUSAL }
    }
    let read: { value: T; notes: string[] }
    try {
      read = this.decode(raw, this.now())
    } catch (err) {
      return { value: held, notes: this.notes, refused: `Orbis could not make sense of the ${this.what} it was asked to save, so nothing was changed: ${why(err)}.` }
    }
    await this.file.write(read.value)
    this.notes = read.notes
    return { value: read.value, notes: read.notes, refused: null }
  }

  /**
   * Changes part of what is held, rather than replacing all of it.
   *
   * For the file that holds one record per game: the window sends one game's analysis and the other four hundred
   * must come back unchanged. The merge happens here, on what was really read, and then goes through exactly the
   * same reader a whole-file save does -- so there is still one place that decides what a stored record may be, and
   * a merge onto a file that may not be written is still refused rather than reported as saved.
   */
  async change(change: (held: T) => unknown, extra: readonly string[] = []): Promise<KeptAnswer<T>> {
    const held = await this.file.read()
    const damage = this.file.problem()
    if (this.file.mayWrite() === false) {
      return { value: held, notes: this.notes, refused: damage ?? REFUSAL }
    }
    let read: { value: T; notes: string[] }
    try {
      read = this.decode(change(held), this.now())
    } catch (err) {
      return { value: held, notes: this.notes, refused: `Orbis could not make sense of the ${this.what} it was asked to save, so nothing was changed: ${why(err)}.` }
    }
    await this.file.write(read.value)
    this.notes = read.notes
    return { value: read.value, notes: [...extra, ...read.notes], refused: null }
  }

  /** Moves to another profile's file. What is pending is written to the file it came from first. */
  async useProfile(profileId: string): Promise<void> {
    await this.file.usePath(personalFile(this.userData, profileId, this.name))
    // A different file: what could not be read in the last one says nothing about this one.
    this.notes = []
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  flushSync(): void {
    this.file.flushSync()
  }
}

export class ChessDataStore {
  private readonly settingsFile: ChessFile<ChessSettings>
  private readonly trainingFile: ChessFile<StoredTraining>
  private readonly openingsFile: ChessFile<StoredOpenings>
  private readonly academyFile: ChessFile<AcademyProgress>
  private readonly progressFile: ChessFile<StoredProgress>
  private readonly studiesFile: ChessFile<StoredStudies>
  private readonly files: Switchable[]

  /** `now` is an argument so the whole store can be tested against a fixed clock. */
  constructor(userData: string, profileId: string = DEFAULT_PROFILE_ID, now: () => number = Date.now) {
    const common = { userData, profileId, now }
    this.settingsFile = new ChessFile<ChessSettings>({
      ...common,
      name: 'chess-settings.json',
      what: 'chess settings',
      empty: () => ({
        board: { ...DEFAULT_CHESS_SETTINGS.board },
        moves: { ...DEFAULT_CHESS_SETTINGS.moves },
        sound: { ...DEFAULT_CHESS_SETTINGS.sound },
        engine: { ...DEFAULT_CHESS_SETTINGS.engine },
        analysis: { ...DEFAULT_CHESS_SETTINGS.analysis }
      }),
      decode: (raw) => readSettingsFile(raw)
    })
    this.trainingFile = new ChessFile<StoredTraining>({
      ...common,
      name: 'chess-training.json',
      what: 'puzzles and training records',
      empty: emptyTraining,
      decode: readTrainingFile
    })
    this.openingsFile = new ChessFile<StoredOpenings>({
      ...common,
      name: 'chess-openings.json',
      what: 'opening repertoire',
      empty: emptyOpenings,
      decode: readOpeningsFile
    })
    this.academyFile = new ChessFile<AcademyProgress>({
      ...common,
      name: 'chess-academy.json',
      what: 'Academy progress',
      empty: emptyAcademy,
      decode: readAcademyFile
    })
    this.progressFile = new ChessFile<StoredProgress>({
      ...common,
      name: 'chess-progress.json',
      what: 'study plan and goals',
      empty: emptyProgress,
      decode: readProgressFile
    })
    this.studiesFile = new ChessFile<StoredStudies>({
      ...common,
      name: 'chess-studies.json',
      what: 'saved analyses',
      empty: emptyStudies,
      decode: readStudiesFile
    })
    this.files = [this.settingsFile, this.trainingFile, this.openingsFile, this.academyFile, this.progressFile, this.studiesFile]
  }

  /** Follows the profile, like everything personal in Orbis, so two people on one computer never share a record. */
  async useProfile(profileId: string): Promise<void> {
    await Promise.all(this.files.map((file) => file.useProfile(profileId)))
  }

  /** Writes everything pending and waits for it. What `QuitFlush` is given, so the close waits for the last save. */
  async flush(): Promise<void> {
    await Promise.all(this.files.map((file) => file.flush()))
  }

  /** The same at the very end of the process, where there is nothing left to wait with. */
  flushSync(): void {
    for (const file of this.files) file.flushSync()
  }

  settings(): Promise<KeptAnswer<ChessSettings>> {
    return this.settingsFile.read()
  }

  saveSettings(raw: unknown): Promise<KeptAnswer<ChessSettings>> {
    return this.settingsFile.save(raw)
  }

  training(): Promise<KeptAnswer<StoredTraining>> {
    return this.trainingFile.read()
  }

  saveTraining(raw: unknown): Promise<KeptAnswer<StoredTraining>> {
    return this.trainingFile.save(raw)
  }

  openings(): Promise<KeptAnswer<StoredOpenings>> {
    return this.openingsFile.read()
  }

  saveOpenings(raw: unknown): Promise<KeptAnswer<StoredOpenings>> {
    return this.openingsFile.save(raw)
  }

  academy(): Promise<KeptAnswer<AcademyProgress>> {
    return this.academyFile.read()
  }

  saveAcademy(raw: unknown): Promise<KeptAnswer<AcademyProgress>> {
    return this.academyFile.save(raw)
  }

  progress(): Promise<KeptAnswer<StoredProgress>> {
    return this.progressFile.read()
  }

  saveProgress(raw: unknown): Promise<KeptAnswer<StoredProgress>> {
    return this.progressFile.save(raw)
  }

  /**
   * What somebody has worked out about one game, or null when they have not worked out anything about it yet.
   *
   * Null and "the file could not be read" are not the same answer and are not reported as one: the first comes back
   * with `refused` empty, the second with `refused` set, and the screen is meant to say which. A person whose
   * analysis is temporarily unreadable must not be shown an empty board as though they had never looked at the game.
   */
  async study(gameId: string): Promise<KeptAnswer<StoredStudy | null>> {
    const read = await this.studiesFile.read()
    return { value: read.value.studies[gameId] ?? null, notes: read.notes, refused: read.refused }
  }

  /** Every game an analysis has been saved for, so a list of games can say which of them you have worked on. */
  async studyIds(): Promise<KeptAnswer<string[]>> {
    const read = await this.studiesFile.read()
    return { value: Object.keys(read.value.studies), notes: read.notes, refused: read.refused }
  }

  /**
   * Keeping one game's analysis.
   *
   * Only that game's record is touched. The answer is the record as it was really stored, so the screen shows what
   * landed rather than what it sent -- and `refused` set means nothing was written at all.
   */
  async saveStudy(raw: unknown): Promise<KeptAnswer<StoredStudy | null>> {
    const read = readStudy(raw)
    if (!read.study) {
      const held = await this.studiesFile.read()
      return {
        value: null,
        notes: [...held.notes, ...read.notes],
        refused: 'Orbis could not make sense of the analysis it was asked to save, so nothing was changed.'
      }
    }
    const study = read.study
    let dropped: string[] = []
    const answer = await this.studiesFile.change((held) => {
      const put = putStudy(held, study)
      dropped = put.notes
      return put.value
    })
    return {
      value: answer.refused === null ? (answer.value.studies[study.gameId] ?? null) : null,
      notes: [...read.notes, ...dropped, ...answer.notes],
      refused: answer.refused
    }
  }

  /** Taking one game's analysis away, when somebody asks for it. The game is a different file and is not touched. */
  async removeStudy(gameId: string): Promise<KeptAnswer<boolean>> {
    let removed = false
    const answer = await this.studiesFile.change((held) => {
      const drop = dropStudy(held, gameId)
      removed = drop.removed
      return drop.value
    })
    return { value: answer.refused === null && removed, notes: answer.notes, refused: answer.refused }
  }
}

/** The six files, relative to a profile's own folder. Here so the profile export can name them. */
export const CHESS_DATA_FILES: readonly string[] = Object.freeze([
  'personal/chess-settings.json',
  'personal/chess-training.json',
  'personal/chess-openings.json',
  'personal/chess-academy.json',
  'personal/chess-progress.json',
  'personal/chess-studies.json'
])
