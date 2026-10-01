import type { ParamSpec } from '../../shared/browserControl.ts'
import { fail } from '../browserControl/registry.ts'
import type { BrowserControl } from '../browserControl/registry.ts'
import type { ExtensionBridge } from './extensionBridge.ts'

/**
 * The browser's own pages -- settings, history, downloads, bookmarks, extensions -- as things Orbis can open.
 *
 * Everything else in the control layer acts on a *web page*, and that assumption was load-bearing in a way nobody had
 * noticed: a tab may only be opened at an `http:` or `https:` address, which is correct for anything a page asked for
 * and wrong for the browser's own surfaces. So "open browser settings" had no capability at all. With nothing to
 * ground it against, the only plans that could be made for it were the wrong ones -- searching the web for the words
 * "browser settings", or typing them into the address bar -- and a person watching that happen is watching Orbis fail
 * at the simplest thing they asked it for.
 *
 * It is one capability over a table, not one capability each. "Open settings", "open my privacy settings", "show
 * downloads" and "open the extensions page" are the same act against different destinations, and modelling them as one
 * means a surface added to the table is immediately reachable by every phrasing, in every language the planner
 * understands, without anything else changing.
 *
 * Nothing here is privileged. These are the pages the person can reach from the browser's own menus; opening one puts
 * them in front of it. Changing something *on* one is theirs to do -- a settings page Orbis opened is a settings page,
 * not a settings page Orbis is now entitled to operate.
 */

/** A page the browser itself owns. `words` are what somebody calls it; `url` is where it actually lives. */
export interface Surface {
  id: string
  what: string
  url: string
  words: readonly string[]
}

/*
 * Chromium 154's own addresses. Each was chosen because it is the page the browser's menus go to, so what opens is
 * what the person would have opened themselves.
 */
export const SURFACES: readonly Surface[] = [
  { id: 'settings', what: 'Browser settings', url: 'chrome://settings/', words: ['settings', 'preferences', 'options', 'configuration', 'config', 'browser settings'] },
  { id: 'privacy', what: 'Privacy and security settings', url: 'chrome://settings/privacy', words: ['privacy', 'security', 'privacy and security', 'safety'] },
  { id: 'clear-browsing-data', what: 'Clear browsing data', url: 'chrome://settings/clearBrowserData', words: ['clear browsing data', 'clear data', 'delete browsing data', 'clear history dialog'] },
  { id: 'site-permissions', what: 'Site permissions', url: 'chrome://settings/content', words: ['permissions', 'site permissions', 'site settings', 'content settings', 'notifications', 'camera', 'microphone', 'location'] },
  { id: 'search-engines', what: 'Search engine settings', url: 'chrome://settings/search', words: ['search engine', 'default search', 'search engines', 'search settings'] },
  { id: 'startup', what: 'What opens on startup', url: 'chrome://settings/onStartup', words: ['startup', 'on startup', 'start up', 'opens on launch', 'launch pages'] },
  { id: 'appearance', what: 'Appearance settings', url: 'chrome://settings/appearance', words: ['appearance', 'theme', 'look', 'font size', 'zoom level'] },
  { id: 'autofill', what: 'Autofill and passwords settings', url: 'chrome://settings/autofill', words: ['autofill', 'addresses', 'payment methods', 'auto fill'] },
  { id: 'passwords', what: 'Saved passwords', url: 'chrome://password-manager/passwords', words: ['passwords', 'password manager', 'saved passwords', 'credentials'] },
  { id: 'languages', what: 'Language settings', url: 'chrome://settings/languages', words: ['languages', 'language', 'translate', 'spell check'] },
  { id: 'accessibility', what: 'Accessibility settings', url: 'chrome://settings/accessibility', words: ['accessibility', 'a11y', 'captions'] },
  { id: 'performance', what: 'Performance settings', url: 'chrome://settings/performance', words: ['performance', 'memory saver', 'energy saver'] },
  { id: 'downloads-settings', what: 'Download settings', url: 'chrome://settings/downloads', words: ['download settings', 'download location', 'where downloads go'] },
  { id: 'reset', what: 'Reset settings', url: 'chrome://settings/reset', words: ['reset', 'restore settings', 'reset settings'] },
  { id: 'about', what: 'About this browser', url: 'chrome://settings/help', words: ['about', 'version', 'browser version', 'help', 'updates'] },
  { id: 'profiles', what: 'Browser profile settings', url: 'chrome://settings/manageProfile', words: ['profile', 'profiles', 'manage profile', 'browser profile'] },
  { id: 'history', what: 'Browsing history', url: 'chrome://history/', words: ['history', 'browsing history', 'what i visited', 'recently visited'] },
  { id: 'downloads', what: 'Downloads', url: 'chrome://downloads/', words: ['downloads', 'download list', 'downloaded files', 'what i downloaded'] },
  { id: 'bookmarks', what: 'Bookmark manager', url: 'chrome://bookmarks/', words: ['bookmarks', 'bookmark manager', 'favourites', 'favorites', 'saved pages'] },
  { id: 'reading-list', what: 'Reading list', url: 'chrome://bookmarks/?list', words: ['reading list', 'read later', 'saved for later'] },
  { id: 'extensions', what: 'Extensions', url: 'chrome://extensions/', words: ['extensions', 'add ons', 'addons', 'plugins'] },
  { id: 'extension-shortcuts', what: 'Extension keyboard shortcuts', url: 'chrome://extensions/shortcuts', words: ['extension shortcuts', 'extension keyboard shortcuts'] },
  { id: 'new-tab', what: 'The Orbis new tab page', url: 'chrome://orbis-newtab/', words: ['new tab page', 'home page', 'start page', 'orbis home'] },
  { id: 'orbis-panel', what: 'The Orbis panel', url: 'chrome://orbis/', words: ['orbis panel', 'side panel', 'the panel', 'orbis sidebar'] }
]

/**
 * Every word anybody calls one of these pages, so searching for "passwords" finds the capability that opens them.
 *
 * The ids themselves are deliberately not in here. `new-tab` spelled out is "new tab", which appears in "open a new
 * tab" -- a request about a tab, not about the browser's own pages, and the one it was briefly winning. An id is for
 * naming a destination once it has been chosen; the words below are for finding it.
 */
export const SURFACE_WORDS: readonly string[] = [...new Set(SURFACES.flatMap((s) => s.words))]

const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })
const bool = (description: string, required = false): ParamSpec => ({ type: 'boolean', description, required })

/**
 * Which surface somebody meant, from what they called it.
 *
 * Exact id, then an exact word, then a word contained in what they wrote, then an overlap -- narrowest match first,
 * because "clear browsing data" contains "data" and also contains nothing of "settings", while "privacy settings"
 * contains both "privacy" and "settings" and means the first of them. A tie is not broken: two equally good answers is
 * ambiguity, and §150 of how this is meant to behave says ask rather than pick.
 */
export function resolveSurface(name: unknown): Surface | { ambiguous: Surface[] } | null {
  const said = String(name ?? '')
    .toLowerCase()
    .trim()
  if (!said) return null

  // An address, matched before anything is reworded, because "chrome://settings/privacy" stops being an address the
  // moment its slashes become spaces -- and then it reads as the word "settings" and opens the wrong page.
  const asAddress = said.replace(/\/+$/, '')
  const byAddress = SURFACES.find((s) => s.url.toLowerCase().replace(/\/+$/, '') === asAddress)
  if (byAddress) return byAddress

  const raw = said.replace(/^chrome:\/\//, '').replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim()
  const exact = SURFACES.find((s) => s.id === raw.replace(/\s+/g, '-'))
  if (exact) return exact

  const byWord = SURFACES.filter((s) => s.words.includes(raw))
  if (byWord.length === 1) return byWord[0]

  // Longest phrase first, so "clear browsing data" is not claimed by "data".
  const scored = SURFACES.map((s) => ({
    s,
    score: s.words.reduce((best, w) => (raw.includes(w) ? Math.max(best, w.length) : best), 0)
  })).filter((r) => r.score > 0)

  if (!scored.length) return null

  /*
   * "Settings" is everything's surname, so it never wins against a first name.
   *
   * Almost every page here lives under `chrome://settings/`, and almost every way of asking for one of them says the
   * word: "privacy settings", "appearance settings", "search engine settings". Scoring by phrase length alone sent all
   * of those to the top of settings, because "browser settings" is a longer string than "privacy" -- the person asked
   * for a room and was shown the building. So the root is set aside whenever anything more specific matched, and kept
   * only when nothing did, which is exactly when "open settings" should reach it.
   */
  const specific = scored.filter((r) => r.s.id !== 'settings')
  const pool = specific.length ? specific : scored
  const best = Math.max(...pool.map((r) => r.score))
  const top = pool.filter((r) => r.score === best)
  if (top.length === 1) return top[0].s
  return { ambiguous: top.map((r) => r.s) }
}

export interface SurfaceDeps {
  control: BrowserControl
  bridge: ExtensionBridge
}

/**
 * Registers the browser's own pages as two capabilities: what there is, and opening one.
 *
 * `surface.list` exists so the planner can *discover* these rather than be told about them in a prompt. A capability
 * whose destinations are only in a prompt is a capability that silently stops matching the browser the day one moves.
 */
export function registerSurfaceCapabilities(d: SurfaceDeps): void {
  const { control, bridge } = d
  const call = <T>(expression: string): Promise<T> => bridge.run<T>(expression)
  const json = (value: unknown): string => JSON.stringify(value)

  const names = SURFACES.map((s) => s.id).join(', ')

  control.register({
    id: 'surface.list',
    domain: 'surface',
    name: "The browser's own pages",
    description:
      "Every page the browser itself owns and what each is for: settings, privacy, clearing browsing data, site permissions, history, downloads, bookmarks, the reading list, extensions, passwords, profiles, appearance, startup, the search engine, languages, accessibility, performance, about. Read this to find out which name surface.open takes.",
    params: {},
    /*
     * The words for everything it lists, taken from the table rather than written out again.
     *
     * A capability covering two dozen destinations cannot have their names in its own name, and a planner searching
     * for "passwords" has to be able to find the thing that knows about passwords. Derived, so a surface added to the
     * table is findable the same day.
     */
    keywords: SURFACE_WORDS,
    mutates: false,
    confirmation: 'none',
    run: () => SURFACES.map((s) => ({ name: s.id, what: s.what, address: s.url, alsoCalled: s.words }))
  })

  control.register({
    id: 'surface.open',
    domain: 'surface',
    name: "Open one of the browser's own pages",
    description:
      `Opens a page belonging to the browser itself -- settings, privacy and security, clear browsing data, site permissions, history, downloads, bookmarks, extensions, saved passwords, profiles, appearance, startup, the default search engine, languages, accessibility, performance, about -- and puts the person in front of it. This is the right capability for "open settings", "show my downloads", "open the extensions page", "take me to browser preferences" and anything else naming a part of the browser rather than a website. Do not search the web for these and do not type their names into the address bar. Names: ${names}.`,
    params: {
      name: str(`Which page: ${names}. Common words work too ("preferences", "notifications", "favourites").`, true),
      newTab: bool('Open in a new tab, leaving the current page where it is (default true).')
    },
    keywords: SURFACE_WORDS,
    mutates: true,
    /*
     * Opening a page is not a consequential act.
     *
     * Confirming it would be the particular kind of wrong this is meant to fix: a person who says "open settings" and
     * is asked whether they are sure has been given a worse experience than one who was told how to do it themselves.
     * What happens *on* the page they are now looking at is theirs, and that is where the asking belongs.
     */
    confirmation: 'none',
    describe: (p) => `Open ${resolveSurfaceName(p.name)}`,
    run: async (p) => {
      const found = oneSurface(p.name)

      /*
       * Opened through the browser's own tab model, by address, in the browser.
       *
       * Not by driving the menus. A menu path is a picture of one version of one browser: it breaks when a menu is
       * reordered, it cannot be verified except by looking at pixels, and it is slower than the thing it imitates.
       * The address is what the menu item itself does.
       */
      if (p.newTab === false) {
        const tab = await call<{ id: number }>(`chrome.tabs.update({ url: ${json(found.url)} }).then((t) => ({ id: t.id }))`)
        return { name: found.id, url: found.url, what: found.what, tabId: String(tab.id) }
      }
      const tab = await call<{ id: number }>(`chrome.tabs.create({ url: ${json(found.url)}, active: true }).then((t) => ({ id: t.id }))`)
      return { name: found.id, url: found.url, what: found.what, tabId: String(tab.id) }
    },
    /**
     * Checked by asking the browser what the tab is now showing.
     *
     * Not by whether `chrome.tabs.create` resolved -- it resolves the instant a tab exists, before the page it was
     * pointed at has committed, so a tab that failed to load its destination resolves exactly like one that succeeded.
     * The address is compared by prefix because Chromium normalises these: `chrome://settings/privacy` can come back as
     * `chrome://settings/privacy` or with a trailing slash, and `chrome://history/` as `chrome://history/`.
     */
    verify: async (data) => {
      const { tabId, url, what } = data as { tabId: string; url: string; what: string }
      const base = url.replace(/\/+$/, '')
      const end = Date.now() + 4000
      let seen = ''
      while (Date.now() < end) {
        const tab = await call<{ url: string; status: string } | null>(
          `chrome.tabs.get(${Number(tabId)}).then((t) => ({ url: t.url || t.pendingUrl || '', status: t.status })).catch(() => null)`
        ).catch(() => null)
        if (!tab) return { verified: false, detail: 'That tab is no longer open.' }
        seen = tab.url
        if (seen.replace(/\/+$/, '').startsWith(base)) return { verified: true, detail: `${what} is open.` }
        await new Promise((r) => setTimeout(r, 150))
      }
      return { verified: false, detail: seen ? `That tab is showing ${seen}, not ${url}.` : 'That tab never loaded an address.' }
    }
  })
}

/**
 * The one surface a name means, or a refusal.
 *
 * Two refusals, kept apart on purpose. A name for nothing is `not-found` and says where the names are, so the planner
 * looks them up instead of trying synonyms. A name for two things is `invalid-params`, which the Orb treats as "think
 * again" rather than "try again" -- retrying an ambiguous name produces the same ambiguity three times over.
 */
function oneSurface(name: unknown): Surface {
  const found = resolveSurface(name)
  if (!found) return fail('not-found', `I do not know a browser page called "${String(name ?? '')}". See surface.list for the names.`)
  if ('ambiguous' in found) return fail('invalid-params', `"${String(name)}" could mean ${found.ambiguous.map((s) => s.id).join(' or ')}. Say which.`)
  return found
}

/** The phrase a confirmation uses, which has to work even when the name was not understood. */
function resolveSurfaceName(name: unknown): string {
  const found = resolveSurface(name)
  if (!found) return `a browser page called "${String(name ?? '')}"`
  if ('ambiguous' in found) return found.ambiguous.map((s) => s.what).join(' or ')
  return found.what
}
