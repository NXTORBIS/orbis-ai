import { call } from './helper.js'

/**
 * The browser's first-launch introduction.
 *
 * It runs on the Orbis new tab page and dissolves into that same page, so the last frame is the real browser rather than a
 * picture of one. Nothing here draws a tab strip, an address bar or a page: those are the browser's own, already painted
 * behind this, and the introduction only uncovers them.
 *
 * What it says while it runs is limited to what is actually true from here. By the time this page is running, Chromium and
 * the profile are up — announcing that they are "preparing" would be theatre. The two things genuinely still outstanding
 * are reaching the Orbis app and loading this page's own contents, so those are the two things it reports, and when neither
 * is outstanding it says nothing at all rather than inventing a stage to fill the time.
 */

/** Raise this only to deliberately introduce the browser again after a release that has earned it. */
export const INTRO_VERSION = 1

/** Long enough for the mark to arrive and settle; the browser is not held past this for the sake of the animation. */
const CINEMATIC_MS = 2200
/** If the app never answers, the introduction still ends. A first launch must not be a place to get stuck. */
const PATIENCE_MS = 9000

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * Whether this installation still has the introduction to see. Anything unexpected answers "no": showing it every launch
 * because the app cannot be reached would be far worse than never showing it at all.
 */
export async function introWanted() {
  try {
    const state = await call('intro:get')
    return typeof state?.seen === 'number' && state.seen < INTRO_VERSION
  } catch {
    return false
  }
}

async function markSeen() {
  try {
    await call('intro:seen', [INTRO_VERSION])
  } catch {
    // Not recorded: the introduction runs again next time. That is the safe direction to fail in.
  }
}

function build(doc) {
  const stage = doc.createElement('div')
  stage.className = 'intro-stage'

  const orbit = doc.createElement('div')
  orbit.className = 'intro-orbit'
  const spark = doc.createElement('span')
  spark.className = 'intro-spark'
  const halo = doc.createElement('span')
  halo.className = 'intro-halo'
  orbit.append(spark, halo)

  // The real logo, wordmark and all — not a ring with the name set beside it in a
  // typeface that is not the one the logo is drawn in. The ring is the logo's own O,
  // so the halo that opened a moment ago hands straight over to it.
  const mark = doc.createElement('img')
  mark.className = 'intro-mark'
  mark.src = 'orbis-wordmark.png'
  mark.alt = 'Orbis'

  const status = doc.createElement('p')
  status.className = 'intro-status'
  // Announced politely: a screen reader hears the stages as they change without being interrupted mid-sentence.
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  stage.append(orbit, mark, status)

  const skip = doc.createElement('button')
  skip.type = 'button'
  skip.className = 'intro-skip'
  skip.textContent = 'Skip'

  const root = doc.createElement('div')
  root.id = 'intro'
  // The introduction is an announcement, not a dialog: it takes focus for the skip control and nothing else.
  root.setAttribute('role', 'presentation')
  root.append(stage, skip)
  return { root, status, skip, mark }
}

/**
 * Shows the introduction and resolves when the page is uncovered. `work` is the real loading this page is doing; the
 * introduction waits on it rather than on a timer, and reports it rather than a percentage.
 */
export async function runIntro(doc, work) {
  const { root, status, skip, mark } = build(doc)
  doc.body.append(root)

  let done = false
  let resolveEnd
  const ended = new Promise((r) => (resolveEnd = r))

  const say = (text) => {
    if (!done) status.textContent = text
  }

  const finish = async () => {
    if (done) return
    done = true
    root.classList.add('leaving')
    // Only once it has actually gone: the installation has seen the introduction when the browser is in front of them.
    const gone = () => {
      root.remove()
      resolveEnd()
    }
    root.addEventListener('transitionend', gone, { once: true })
    // A transition that never fires (a hidden tab, a reduced-motion setting) must not strand the page behind a cover.
    setTimeout(gone, 600)
    await markSeen()
  }

  skip.addEventListener('click', () => void finish())
  const onKey = (e) => {
    if (e.key === 'Escape') void finish()
  }
  doc.addEventListener('keydown', onKey)
  void ended.then(() => doc.removeEventListener('keydown', onKey))

  // If the mark cannot be drawn, the introduction is not worth having: fall through to the page immediately.
  mark.addEventListener('error', () => void finish(), { once: true })

  const cinematic = reducedMotion() ? 0 : CINEMATIC_MS
  const patience = new Promise((r) => setTimeout(r, PATIENCE_MS))

  say('Starting Orbis')
  const realWork = (async () => {
    try {
      await work({ say })
    } catch {
      // The page will show what it can. The introduction's job is to get out of the way, not to report this.
    }
  })()

  // The browser is ready when its work is done; the animation is given its time but never extends past it by much.
  await Promise.race([Promise.all([realWork, new Promise((r) => setTimeout(r, cinematic))]), patience])
  await finish()
  return ended
}
