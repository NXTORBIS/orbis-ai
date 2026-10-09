/**
 * The sound their XP system plays, which Orbis does not.
 *
 * NOT the user's file. Theirs is an eighteen-kilobyte Web Audio engine for the whole site -- music, ambience and
 * effects -- and it was left out of this port deliberately: a studio that starts making noise on its own is not
 * what somebody opening a laboratory asked for.
 *
 * Their `XpContext` calls it when XP is earned, so it has to exist. Every method does nothing and says so here
 * rather than being discovered as silence. If sound is ever wanted, this is the one place to put it.
 */
export const audioEngine = {
  /** Called when XP is earned. Deliberately silent -- see the note above. */
  play: () => undefined,
  playEffect: () => undefined,
  stop: () => undefined,
  setVolume: () => undefined,
  /** Honest rather than optimistic: nothing here can make a sound. */
  isAvailable: () => false
}

export default audioEngine
