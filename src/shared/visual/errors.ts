/**
 * Every way a Visual Search can fail, and what each one says to the person.
 *
 * Codes internally, sentences on screen. The pair matters: the code is what the pipeline passes around and what a
 * diagnostic line records, and the sentence is written once here so the same failure cannot be phrased three
 * different ways by three different surfaces.
 *
 * Each sentence says what happened and what to do about it. "Analysis failed" tells somebody nothing; "the page will
 * not allow its video to be captured" tells them to try a different part of the screen. And every one of them is a
 * real condition that the code can actually produce -- there is no entry here for a case that cannot happen.
 */

export type VisualErrorCode =
  | 'no-capture'
  | 'capture-busy'
  | 'protected'
  | 'too-small'
  | 'too-large'
  | 'no-eyes'
  | 'no-orbis'
  | 'cancelled'
  | 'timeout'
  | 'offline'
  | 'refused'
  | 'empty'
  | 'lab-failed'
  | 'action-failed'

export interface VisualFault {
  readonly code: VisualErrorCode
  readonly says: string
  /** Which recoveries are worth offering. A failure with none of them just closes. */
  readonly offer: readonly ('retry' | 'reselect')[]
}

const FAULTS: Readonly<Record<VisualErrorCode, VisualFault>> = Object.freeze({
  'no-capture': {
    code: 'no-capture',
    says: 'Orbis could not take a picture of that part of the screen.',
    offer: ['retry', 'reselect']
  },
  'capture-busy': {
    code: 'capture-busy',
    says: 'Orbis can only photograph the page a couple of times a second. Try that again in a moment.',
    offer: ['retry']
  },
  protected: {
    code: 'protected',
    says: 'This page does not allow what you selected to be captured. Protected video is the usual reason.',
    offer: ['reselect']
  },
  'too-small': {
    code: 'too-small',
    says: 'That selection is very small. Try taking in a little more around it.',
    offer: ['reselect']
  },
  'too-large': {
    code: 'too-large',
    says: 'That selection is too large to send. Try a smaller part of it.',
    offer: ['reselect']
  },
  'no-eyes': {
    code: 'no-eyes',
    says: 'Orbis has no key for the service that can look at an image, so there is nothing here that can see. Add one in Settings.',
    offer: []
  },
  'no-orbis': {
    code: 'no-orbis',
    says: 'Orbis is not running, so there is nothing to ask. Open the Orbis window.',
    offer: ['retry']
  },
  cancelled: { code: 'cancelled', says: 'Stopped.', offer: ['reselect'] },
  timeout: { code: 'timeout', says: 'Orion took too long to answer.', offer: ['retry'] },
  offline: { code: 'offline', says: 'Orbis could not reach the service. Check the connection.', offer: ['retry'] },
  refused: {
    code: 'refused',
    says: 'The service would not answer that just now. It may be busy.',
    offer: ['retry']
  },
  empty: {
    code: 'empty',
    says: 'Nothing came back from looking at that. Try asking it differently, or select a little more.',
    offer: ['retry', 'reselect']
  },
  'lab-failed': { code: 'lab-failed', says: 'That laboratory could not be opened.', offer: [] },
  'action-failed': { code: 'action-failed', says: 'Orbis could not do that.', offer: ['retry'] }
})

export function fault(code: VisualErrorCode): VisualFault {
  return FAULTS[code] ?? FAULTS['action-failed']
}

/**
 * A failure from somewhere else, turned into one of ours.
 *
 * The helper, the network and the extension each have their own way of saying no, and every one of them reaches this
 * feature as a message. Matching on the message is unlovely and is the only thing available -- so the match is kept
 * narrow and anything unrecognised becomes `action-failed` with its own words preserved, rather than being flattened
 * into a generic sentence that hides what really happened.
 */
export function faultFrom(message: string): VisualFault {
  const said = String(message ?? '').toLowerCase()
  if (said.includes('abort') || said.includes('cancel')) return fault('cancelled')
  if (said.includes('not running') || said.includes('no such channel')) return fault('no-orbis')
  if (said.includes('no api key') || said.includes('has no key') || said.includes('cannot see') || said.includes('no key for')) return fault('no-eyes')
  if (said.includes('timed out') || said.includes('timeout')) return fault('timeout')
  if (said.includes('failed to fetch') || said.includes('network')) return fault('offline')
  if (said.includes('rate limit') || said.includes('busy') || said.includes('429')) return fault('refused')
  if (said.includes('protected') || said.includes('drm')) return fault('protected')
  // Chromium's own words for the capture rate limit, which is two a second.
  if (said.includes('max_capture_visible_tab_calls_per_second') || said.includes('exceeds the') && said.includes('quota')) return fault('capture-busy')
  const words = String(message ?? '').trim()
  return { code: 'action-failed', says: words === '' ? FAULTS['action-failed'].says : words.slice(0, 200), offer: ['retry'] }
}
