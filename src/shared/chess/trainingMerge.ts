import { addAttempt, type TrainingStore } from './trainingView.ts'

/**
 * A read of the training file that lands after somebody has already changed something.
 *
 * The Calculation Gym and the Blindfold ladder share one record, read out of the profile when the screen opens. The
 * read is not instant, and until it answers the screen works on an empty record so it works at all. That left a hole
 * nobody would ever report as a bug in the right place: press "Less" or "Read the position out" in the first moment
 * after the screen appears, and the read lands a beat later and puts the file's own settings back. The screen snapped
 * to 20 seconds and "No board" again, so the control looked dead when in fact it had worked and been undone.
 *
 * This decides what the record should be in that case, and it is a pure decision so it can be tested without a
 * window or a profile.
 *
 * ## The rules
 *
 *   - **Nothing was changed while the read was in flight.** The file wins outright. This is the ordinary case and
 *     it has to stay exactly as it was, or opening the screen would stop showing what is saved.
 *   - **Something was changed.** The person's settings win, because they set them after the file was written and
 *     theirs is the newer intention. Everything the file holds that they did not touch is kept.
 *   - **A round was finished while the read was in flight.** Its record is added to the file's, through
 *     `addAttempt`, so the same trimming rules apply to it as to any other. It is never dropped: a round somebody
 *     really played is not a thing to lose to a race.
 *
 * ## A different profile is not a race
 *
 * When the record is read again because somebody switched profile, the changes on screen belong to the person who
 * has gone. They are not theirs to keep, so the caller does not ask for them to be kept -- hence `changed` being
 * something the caller says rather than something guessed here.
 */
export function keepLocalChanges(
  loaded: TrainingStore,
  local: TrainingStore,
  changed: boolean
): TrainingStore {
  if (!changed) return loaded
  const known = new Set(loaded.attempts.map((one) => one.id))
  let out: TrainingStore = { ...loaded, settings: { ...local.settings } }
  for (const one of local.attempts) {
    if (known.has(one.id)) continue
    out = addAttempt(out, one)
  }
  return out
}
