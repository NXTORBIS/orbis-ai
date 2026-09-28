// Driving Chromium's real autocomplete from an Orbis page.
//
// The browser side of this is chrome/browser/ui/webui/orbis/orbis_autocomplete.cc, which owns a genuine
// AutocompleteController with Chromium's own providers. This is the page's end of that: it starts queries, receives
// batches of results as providers answer, and hands them to whatever is drawing the list.
//
// Three things it is careful about, because each is a way for the list to be wrong:
//
//   - **Generations.** Every query gets a number. Batches carry the number of the query that produced them, and
//     anything from a query the person has already typed past is dropped here rather than merged. Chromium's Stop() is
//     what ends the work; this is what makes a notification already in flight harmless.
//   - **It does not rank.** Ordering, deduplication and the merge with Orbis's own results all happen in
//     src/shared/omniboxNative.ts, so there is one place that decides what the list is.
//   - **It is optional.** A page outside the Chromium build has no chrome.send, and `available()` says so. Orbis's
//     existing predictions keep working there; this adds the native pipeline where there is one to add it to.

const NATIVE_EVENT = 'orbis-omnibox-results'

// The WebUI listener bridge. FireWebUIListener on the browser side calls cr.webUIListenerCallback here, so it has to
// exist before the first batch arrives. Defined once and shared, because two definitions would mean one of them
// silently replacing the other's listeners.
const shared = (globalThis.__orbisOmniboxNative ??= { listeners: new Map(), generation: 0, installed: false })

function install() {
  if (shared.installed) return
  shared.installed = true
  const cr = (globalThis.cr ??= {})
  const previous = typeof cr.webUIListenerCallback === 'function' ? cr.webUIListenerCallback : null
  cr.webUIListenerCallback = (event, ...args) => {
    // Anything not ours is passed along, so installing this cannot break another listener on the same page.
    if (event !== NATIVE_EVENT) {
      previous?.(event, ...args)
      return
    }
    const batch = args[0]
    if (!batch || typeof batch !== 'object') return
    for (const listener of shared.listeners.values()) {
      try {
        listener(batch)
      } catch (error) {
        // One broken subscriber must not stop the others, and must not stop the omnibox.
        console.error('[orbis] an omnibox results listener threw', error)
      }
    }
  }
}

/** Whether this page can reach the native pipeline at all. False outside the Chromium build, and that is fine. */
export const available = () => typeof chrome !== 'undefined' && typeof chrome.send === 'function'

/**
 * Starts a native query and returns the generation it was given.
 *
 * `cursor` is where the caret is, so providers know what is being edited rather than only what the text says. It is
 * null when the text did not come from typing, which is a real case: restoring a session, or a query put there by
 * something other than a keystroke.
 *
 * `preventInline` must be true while somebody is deleting. Pushing a completion back into the gap a person just made
 * with backspace is the single most irritating thing an omnibox can do, and Chromium will do it unless told not to.
 */
export function start(text, options = {}) {
  if (!available()) return 0
  install()
  const generation = ++shared.generation
  chrome.send('orbis.omnibox.start', [
    generation,
    String(text ?? ''),
    Number.isInteger(options.cursor) ? options.cursor : -1,
    options.preventInline === true,
    options.keywordMode === true
  ])
  return generation
}

/**
 * Stops the current query.
 *
 * `keep` is for the case where the person is arrowing through what is already shown: the work stops, and the list stays
 * where it is rather than emptying underneath them. Closing the omnibox is the other case, and there the results are
 * genuinely no longer wanted.
 */
export function stop({ keep = false } = {}) {
  if (!available()) return
  chrome.send('orbis.omnibox.stop', [!keep])
}

/** The generation of the query now running, for deciding whether a batch is still wanted. */
export const generation = () => shared.generation

/**
 * Listens for batches of native results. Returns a function that stops listening.
 *
 * Batches arrive several times per query -- once per provider that answers -- so a listener must expect to be called
 * repeatedly with a growing result set, and the last one is not announced except by `done`.
 */
export function onResults(listener) {
  install()
  const id = Symbol('orbis-omnibox-listener')
  shared.listeners.set(id, listener)
  return () => shared.listeners.delete(id)
}

/**
 * Opens the match at `index` of the live native result set.
 *
 * The index, not a URL: the browser side looks the match up and navigates to *its* destination with *its* transition,
 * so a page cannot name its own destination and have it opened as though the person had typed it. An index that has
 * gone stale is refused, which is why this can reject.
 */
export function open(index) {
  if (!available()) return Promise.reject(new Error('The native omnibox is not available on this page.'))
  return new Promise((resolve, reject) => {
    const cr = (globalThis.cr ??= {})
    const store = (globalThis.__orbisWebUi ??= { next: 1, callbacks: new Map() })
    if (typeof cr.webUIResponse !== 'function') {
      cr.webUIResponse = (id, ok, value) => {
        const pending = store.callbacks.get(id)
        if (!pending) return
        store.callbacks.delete(id)
        ok ? pending.resolve(value) : pending.reject(value)
      }
    }
    const id = `orbisOmnibox${store.next++}`
    store.callbacks.set(id, { resolve, reject })
    chrome.send('orbis.omnibox.open', [id, index])
  })
}
