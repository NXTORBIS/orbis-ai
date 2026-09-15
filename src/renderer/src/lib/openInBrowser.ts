/** Details of a request to show web pages in the Orbis browser. App listens for it. */
export interface OpenUrlDetail {
  url: string
  /** Open beside the current page instead of replacing it (a tab already showing the page is reused). */
  newTab?: boolean
  /** More pages to open as background tabs. */
  more?: string[]
}

export const OPEN_URL_EVENT = 'orbis:open-url'

/** Opens pages in the Orbis browser (at the preferred size), never an external browser. */
export function openInOrbisBrowser(urls: string | string[], newTab = true): void {
  const [url, ...more] = Array.isArray(urls) ? urls : [urls]
  if (url) window.dispatchEvent(new CustomEvent<OpenUrlDetail>(OPEN_URL_EVENT, { detail: { url, newTab, more } }))
}
