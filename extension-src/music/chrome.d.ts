/**
 * The handful of extension APIs this page uses, written down so it can be type-checked.
 *
 * Orbis does not depend on the full published type package for Chromium's extension APIs, and pulling it in for four
 * calls would be a dependency for the sake of one folder. These are only the ones actually used; anything else is a
 * mistake worth a compile error rather than something to be quietly allowed.
 */

declare namespace chrome {
  const runtime: {
    readonly id: string
    getURL(path: string): string
    onMessage: {
      addListener(
        listener: (message: unknown, sender: { id?: string; tab?: { id?: number } }, reply: (answer: unknown) => void) => boolean | undefined
      ): void
    }
  }

  /** In-memory storage, cleared when the browser closes, unreadable by web pages and by other extensions. */
  const storage: {
    readonly session: {
      get(key: string): Promise<Record<string, unknown>>
    }
  }

  const tabs: {
    query(about: { url?: string }): Promise<{ id?: number; windowId?: number }[]>
    create(about: { url: string; active?: boolean }): Promise<{ id?: number }>
    update(id: number, about: { active?: boolean; url?: string }): Promise<unknown>
  }

  const windows: {
    update(id: number, about: { focused?: boolean }): Promise<unknown>
  }
}
