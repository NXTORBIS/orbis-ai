/**
 * Telling the browser that a tab is locked.
 *
 * Orbis decides; the browser is the only side that can stop a tab showing its title, favicon, address and thumbnail. So
 * the decision has to cross over, and this is the crossing.
 *
 * It goes through `chrome://orbis-orb` -- the Orb's page, which the browser already draws in every window and which is
 * already allowed to speak to the browser's own C++ handlers. Nothing new is let onto the network, no new channel is
 * opened, and no page that is not already trusted is involved. The alternative would have been a second connection into
 * the browser purely to carry one boolean.
 *
 * Nothing here holds or checks a password. What crosses is which tab, whether it is locked, what to call it, and which
 * parts to hide.
 */

/** The little of a page this needs. Narrow on purpose, so a test needs no browser. */
export interface OrbisPage {
  getURL(): string
  executeJavaScript(code: string): Promise<unknown>
}

export interface Hiding {
  title: boolean
  favicon: boolean
  url: boolean
  preview: boolean
}

/** The Orb's own page, in any window. */
const ORB = 'chrome://orbis-orb'

export const orbPages = (pages: OrbisPage[]): OrbisPage[] =>
  pages.filter((page) => {
    try {
      return page.getURL().startsWith(ORB)
    } catch {
      // A page that has gone away while we were looking at it is not a page to speak to.
      return false
    }
  })

/**
 * Tells the browser about one tab.
 *
 * Every Orb page is told, not only the first. They are per window, and the tab could be in any of them -- and although
 * the browser searches every window itself, a window whose Orb page has not finished loading would otherwise be a window
 * that never heard. Telling all of them costs one evaluation each and removes the question.
 *
 * Returns whether any of them accepted it, so a caller can tell "the browser now agrees" from "there was nobody to
 * tell". It never throws: a lock that could not be reported must not take down the thing that locked it, and the tab is
 * already locked on the Orbis side -- which is what stops Orion, automation and everything else reaching it.
 */
export async function pushLock(
  pages: OrbisPage[],
  tab: { tabId: number; locked: boolean; label: string; hiding: Hiding }
): Promise<boolean> {
  const targets = orbPages(pages)
  if (targets.length === 0) return false

  // Built with JSON.stringify rather than string concatenation, so a label somebody typed cannot end the string it is in
  // and become code. The label is the only part of this that a person writes.
  const call = [
    'chrome.send("orbis.lock.set", [',
    JSON.stringify('orbis-lock-push'),
    ',',
    JSON.stringify(tab.tabId),
    ',',
    JSON.stringify(tab.locked),
    ',',
    JSON.stringify(tab.label),
    ',',
    JSON.stringify(tab.hiding),
    '])'
  ].join('')

  const results = await Promise.all(
    targets.map(async (page) => {
      try {
        await page.executeJavaScript(call)
        return true
      } catch {
        return false
      }
    })
  )
  return results.some(Boolean)
}

/** Which tabs the browser believes are locked, for checking that the two sides agree. */
export async function lockedInBrowser(pages: OrbisPage[]): Promise<number[] | null> {
  const [page] = orbPages(pages)
  if (!page) return null
  try {
    const answer = await page.executeJavaScript(
      'new Promise((done) => {' +
        'const id = "orbis-lock-list";' +
        'globalThis.cr = globalThis.cr || {};' +
        'const was = globalThis.cr.webUIResponse;' +
        'globalThis.cr.webUIResponse = (i, ok, value) => {' +
        'if (i === id) { globalThis.cr.webUIResponse = was; done(ok ? value : null); }' +
        'else if (was) { was(i, ok, value); }' +
        '};' +
        'chrome.send("orbis.lock.list", [id]);' +
        'setTimeout(() => { globalThis.cr.webUIResponse = was; done(null) }, 2000);' +
        '})'
    )
    return Array.isArray(answer) ? answer.filter((n): n is number => typeof n === 'number') : null
  } catch {
    return null
  }
}
