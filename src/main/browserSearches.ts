/**
 * Searches made in the Orbis browser, so the Orbis window's address bar and suggestions know them like the ones typed there.
 *
 * A search in the browser is a tab showing the Orbis Search results page, whose address carries the words (`#q=...`). Watching the tabs the
 * browser already reports is enough to record each search once, with nothing added to the page: a private tab is never recorded, and
 * the caller only records when "personalized suggestions" is on. The same words in the same tab are one search however many times the
 * tab is reported; a new search in the tab, or in another tab, is another.
 */

/** The Orbis extension's id, which its manifest key fixes: the results page lives at chrome-extension://<id>/results.html. */
const RESULTS_HOSTS = new Set(['gcaebckmlhiagfagcplpjmibhkhjljab', 'orbis-search'])

/** The words searched for when `url` is the Orbis Search results page showing a fresh search, else null. */
export function searchQueryOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const onResultsPage = (parsed.protocol === 'chrome-extension:' && RESULTS_HOSTS.has(parsed.hostname) && parsed.pathname === '/results.html') || (parsed.protocol === 'chrome:' && RESULTS_HOSTS.has(parsed.hostname))
  if (!onResultsPage) return null
  const params = new URLSearchParams(parsed.hash ? parsed.hash.slice(1) : parsed.search)
  // `at` reopens a saved research session; that is looking something up again, not searching.
  if (params.get('at') !== null) return null
  const words = (params.get('q') ?? '').replace(/\s+/g, ' ').trim()
  return words && words.length <= 200 ? words : null
}

/** Remembers which search each tab last showed, so each one is reported once. */
export class SearchWatcher {
  private readonly seen = new Map<string, string>()
  private seeded = false

  /**
   * Takes the browser's tabs and returns the searches that are new since the last call. The first call only learns what is already open
   * (a restored session is not a new search).
   */
  next(tabs: { id: string; url: string; private?: boolean }[]): string[] {
    const found: string[] = []
    const open = new Set(tabs.map((t) => t.id))
    for (const id of [...this.seen.keys()]) if (!open.has(id)) this.seen.delete(id)
    for (const tab of tabs) {
      const query = tab.private ? null : searchQueryOf(tab.url)
      if (!query) continue
      if (this.seen.get(tab.id) === query) continue
      this.seen.set(tab.id, query)
      if (this.seeded) found.push(query)
    }
    this.seeded = true
    return found
  }
}
