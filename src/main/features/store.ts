import { JsonFile, personalFile } from '../storage/jsonFile.ts'
import { chooseVisible, newChoice, readVisibility, setVisible, type VisibilityChoice } from '../../shared/featureVisibility.ts'

/**
 * Which features this profile has chosen to see, kept with the profile.
 *
 * ## Why not `settings.json`
 *
 * It was the first thing tried, and it is wrong for one reason that settles it: `settings.json` is **not
 * per-profile**. `src/main/store.ts` builds its path from the user-data directory alone and says so in its own
 * comment -- "Settings stay shared; conversations belong to the profile that had them". A work profile and a
 * personal one have every reason to want different menus, and the requirement is that a profile switch restores the
 * right one, which a shared file cannot do. So this follows the pattern the twelve per-profile stores already use:
 * one small file under the profile's own `personal/` folder, through `JsonFile`.
 *
 * ## One file, and nothing else in it
 *
 * `personal/features.json`. Alone, because it is read on every start before anything is drawn and written only when
 * somebody changes a switch -- the coldest file in Orbis -- and because a file that cannot be read must cost the
 * menu's arrangement and nothing else.
 *
 * ## What it refuses
 *
 * `JsonFile` underneath tells "there is no file" apart from "there is a file and Orbis could not read it", and
 * nothing is written to the second kind at all. That matters more here than almost anywhere: a settings file
 * replaced with defaults would silently reset somebody's choices, and they would find out by opening Orbis to a
 * different app. So a save onto an unreadable file is **refused**, in words, and the screen says so rather than
 * showing the new value as kept.
 *
 * The version lives inside the payload rather than in `JsonFile`'s wrapper, and `featureVisibility.ts` says why at
 * length: `JsonFile` moves a file from a newer Orbis aside, which here would throw away every choice somebody made
 * in the newer version. Read instead, used for everything this version understands, and not written over.
 *
 * ## The existing person
 *
 * There is no file for somebody who has been using Orbis for months, because the choice did not exist when they
 * started -- and the absence of a choice is not a choice. `settled` is handed in (the installation's own
 * `welcomeCompleted` flag) and decides what no file means: everything they had, for somebody already set up, and the
 * short starting menu for a first run. **Nothing is written in either case.** The answer is worked out again on
 * every start, which costs nothing and means a guess is never frozen into a file as though the person had made it.
 */

const REFUSAL =
  'Orbis could not read which features you have showing, so nothing has been written over it. Another program may be holding the file; try again in a moment.'

/** What the window gets back. The same shape whether anything went wrong or not. */
export interface VisibilityAnswer {
  choice: VisibilityChoice
  /** Anything that could not be read, in sentences somebody can be shown. Empty when nothing went wrong. */
  notes: readonly string[]
  /** Set only when nothing was written. A save whose answer has this set did not happen. */
  refused: string | null
}

export interface FeatureVisibilityStoreOptions {
  /** Whether this installation has already finished setting up. The `welcomeCompleted` setting. */
  settled(): Promise<boolean>
  now?: () => number
}

export class FeatureVisibilityStore {
  private readonly userData: string
  private readonly options: FeatureVisibilityStoreOptions
  private readonly now: () => number
  private file: JsonFile<VisibilityChoice>
  /** What could not be read out of whatever is currently held, from the last read or the last save. */
  private notes: readonly string[] = []
  /**
   * What "no file" means for this profile, decided once per profile and remembered.
   *
   * Asked of the settings rather than worked out here, and remembered so a switch mid-session cannot change what an
   * absent file means halfway through.
   */
  private settled: boolean | null = null
  /**
   * True when there was nothing saved for this profile, so the answer is Orbis's own rather than the person's.
   *
   * `JsonFile`'s fallback cannot see `settled` -- it is a plain function handed in at construction, and whether the
   * installation is already set up is asked over a promise. So the fallback flags that it ran, and `read` works out
   * the right blank afterwards. This is the whole of the existing-person rule in one boolean.
   */
  private nothingSaved = false

  constructor(userData: string, profileId: string, options: FeatureVisibilityStoreOptions) {
    this.userData = userData
    this.options = options
    this.now = options.now ?? Date.now
    this.file = this.make(profileId)
  }

  private make(profileId: string): JsonFile<VisibilityChoice> {
    return new JsonFile<VisibilityChoice>(
      personalFile(this.userData, profileId, 'features.json'),
      // Only reached when there is genuinely no file, or when one could not be read. Either way the real answer
      // depends on `settled`, which cannot be asked for from here, so `read` below fixes it up.
      () => {
        this.nothingSaved = true
        return newChoice(this.now())
      },
      (raw) => {
        this.nothingSaved = false
        const read = readVisibility(raw, { settled: this.settled ?? false, now: this.now() })
        this.notes = read.notes
        return read.value
      },
      { what: 'which features you have showing' }
    )
  }

  /** Decided once per profile: an absent file means "everything" for somebody already set up. */
  private async decideSettled(): Promise<boolean> {
    if (this.settled === null) {
      this.settled = await this.options.settled().catch(() => false)
    }
    return this.settled
  }

  async read(): Promise<VisibilityAnswer> {
    const settled = await this.decideSettled()
    // The reader above runs inside `JsonFile`, so `settled` has to be known before the first read of the file.
    const held = await this.file.read()
    const damage = this.file.problem()
    // Nothing saved: the fallback cannot see `settled`, so the right blank is worked out here instead.
    // `readVisibility(null, ...)` is the one place that decides what no file means, for everybody.
    const value = this.nothingSaved ? readVisibility(null, { settled, now: this.now() }).value : held
    return {
      choice: value,
      notes: damage === null ? this.notes : [damage, ...this.notes],
      // Only when nothing may be written. A file that was damaged and moved aside has a problem and may be written,
      // and reporting that as a refusal would tell somebody their save failed when it is about to succeed.
      refused: this.file.mayWrite() === false ? (damage ?? REFUSAL) : null
    }
  }

  /** Turns one feature on or off. The answer is what was really stored, not what arrived. */
  async set(id: unknown, on: unknown): Promise<VisibilityAnswer> {
    return this.change((held) => setVisible(held, String(id ?? '').slice(0, 64), on === true, this.now()))
  }

  /** Replaces the whole set: what the picker and the first-run step send. */
  async choose(ids: unknown): Promise<VisibilityAnswer> {
    const list = Array.isArray(ids) ? ids.slice(0, 200) : []
    return this.change((held) => {
      const result = chooseVisible(held, list, this.now())
      return { value: result.value, refused: result.refused, extra: result.notes }
    })
  }

  /** The one write path, so every refusal is decided in one place. */
  private async change(apply: (held: VisibilityChoice) => { value: VisibilityChoice; refused: string | null; extra?: readonly string[] }): Promise<VisibilityAnswer> {
    // Read first, so whether this file may be written is known before anything is reported as saved.
    const current = await this.read()
    if (current.refused !== null) return current

    const result = apply(current.choice)
    if (result.refused !== null) return { choice: current.choice, notes: current.notes, refused: result.refused }

    await this.file.write(result.value)
    const notes = [...current.notes, ...(result.extra ?? [])]
    this.notes = notes
    return { choice: result.value, notes, refused: null }
  }

  /** Moves to another profile's file. What is pending is written where it came from first. */
  async useProfile(profileId: string): Promise<void> {
    this.notes = []
    // A different profile is a different file, so whether it can be read is a different question -- and whether
    // anything is saved in it is a different question too. `usePath` writes what is pending to the old file first.
    this.nothingSaved = false
    await this.file.usePath(personalFile(this.userData, profileId, 'features.json'))
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  flushSync(): void {
    this.file.flushSync()
  }
}

