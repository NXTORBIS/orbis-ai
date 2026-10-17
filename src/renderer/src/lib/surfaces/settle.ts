/**
 * Waiting until something is true of a screen, for an action that has to say what really happened.
 *
 * The register already waits like this after a write, because setting a control asks React for a render and the new
 * value does not exist until that render has happened. An action needs the same thing and could not reach it: pressing
 * Run on a laboratory asks for a render too, so `verify` called straight afterwards reads the screen as it was a
 * moment ago and reports a failure for something that worked.
 *
 * So this is that wait, written once. Its whole value is that `verify` ends up resting on a reading taken after the
 * fact rather than on the handler having returned -- which is the difference between "confirmed" and "carried out".
 *
 * Returns at once when it is already true, so nothing is left waiting when a screen's setters are immediate.
 */
export async function settle(check: () => boolean, ms = 1500): Promise<boolean> {
  const end = Date.now() + ms
  for (;;) {
    let now = false
    try {
      now = check()
    } catch {
      // A getter that throws is a screen that cannot answer yet, which is not an answer of "no" -- it is worth
      // asking again until the time runs out.
      now = false
    }
    if (now) return true
    if (Date.now() >= end) return false
    await new Promise((wake) => setTimeout(wake, 25))
  }
}
