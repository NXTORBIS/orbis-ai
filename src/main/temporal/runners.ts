import type { TemporalAction, TemporalJob } from '../../shared/temporal/job.ts'
import type { Runner } from './engine.ts'

/**
 * How a scheduled thing actually happens.
 *
 * Every runner here is a few lines that hand the work to whichever engine already does it: the Workflow Engine runs
 * workflows, the Browser Control Layer opens and closes pages, Orion answers questions, the notification system
 * notifies. Nothing in this file drives a browser, keeps state, or decides anything.
 *
 * That is the whole reason it is this short. A scheduler that grows its own way of opening a page ends up with two
 * ways of opening a page, and the one nobody uses is the one that rots.
 *
 * ## What it will not do
 *
 * **It never claims success for something it only sent.** Every result comes from the engine that did the work, and
 * a failure is passed on as a failure with the reason.
 *
 * **It never gains a permission by being on a schedule.** Each call goes through the same capability with the same
 * `source`, so anything switched off in Settings is just as switched off at three in the morning.
 *
 * **It never carries a command.** There is nothing in the action model to put one in, and nothing here that would
 * run it if there were.
 */

/** What the runners need from the rest of the app. Injected, so this file has no Electron in it. */
export interface RunnerDeps {
  /** The Browser Control Layer's own entry point. Same capabilities, same switches, same logging. */
  execute: (capability: string, params: Record<string, unknown>) => Promise<{ ok: boolean; detail: string }>
  /** Runs a saved workflow, by id or by name. Null when Orbis has no workflow engine yet. */
  runWorkflow: ((idOrName: string, job: TemporalJob) => Promise<{ ok: boolean; detail: string }>) | null
  /** Which pages are open, for refreshing or closing one by address rather than by an id that restarts do not keep. */
  openTabs: () => Promise<{ tabId: number; url: string }[]>
  /** Asks Orion, through the existing model routing. */
  ask: ((prompt: string) => Promise<string>) | null
  /** Says something to the person, honouring quiet hours and the per-category switches. */
  notify: (title: string, body: string) => void
  /** A saved workspace's pages, by id or name. */
  workspace: ((idOrName: string) => Promise<{ tabs: Record<string, unknown>[]; groups: Record<string, unknown>[] } | null>) | null
  /** Opens one of Orbis's own Pages. */
  openPage: ((pageId: string) => Promise<{ ok: boolean; detail: string }>) | null
}

export function makeRunners(d: RunnerDeps): Partial<Record<TemporalAction['kind'], Runner>> {
  return {
    openUrl: async (action) => {
      if (action.kind !== 'openUrl') return { ok: false }
      // `browser.open` starts the browser if it is not running; `tabs.create` needs one already there.
      return d.execute(action.newTab ? 'tabs.create' : 'browser.open', action.newTab ? { url: action.url, active: true } : { url: action.url })
    },

    refreshUrl: async (action) => {
      if (action.kind !== 'refreshUrl') return { ok: false }
      const open = await d.openTabs()
      const match = open.find((t) => sameAddress(t.url, action.url))
      /**
       * Not open is not a failure.
       *
       * "Check the status page every hour" means look at it, and opening it is the honest way to do that when it is
       * not already there. Reporting a failure because a tab was closed would leave somebody with an hourly error.
       */
      if (!match) return d.execute('tabs.create', { url: action.url, active: false })
      const activated = await d.execute('tabs.activate', { tabId: match.tabId })
      if (!activated.ok) return activated
      return d.execute('navigation.reload', {})
    },

    closeTabs: async (action) => {
      if (action.kind !== 'closeTabs') return { ok: false }
      const open = await d.openTabs()
      const wanted = open.filter((t) => t.url.toLowerCase().includes(action.urlMatches.toLowerCase()))
      if (wanted.length === 0) return { ok: true, detail: 'Nothing matched, so nothing was closed.' }
      let closed = 0
      for (const tab of wanted) {
        const result = await d.execute('tabs.close', { tabId: tab.tabId })
        if (result.ok) closed++
      }
      // Said plainly, because "closed 3 of 4" is the kind of thing somebody wants to know about a tidy-up.
      return { ok: closed > 0, detail: `Closed ${closed} of ${wanted.length}.` }
    },

    openWorkspace: async (action) => {
      if (action.kind !== 'openWorkspace') return { ok: false }
      if (!d.workspace) return { ok: false, detail: 'Orbis cannot reach saved workspaces at the moment.' }
      const found = await d.workspace(action.workspaceId)
      if (!found) return { ok: false, detail: `There is no workspace called “${action.workspaceId}” any more.` }
      return d.execute('browser.openWorkspace', { tabs: found.tabs, groups: found.groups, replace: false })
    },

    openPage: async (action) => {
      if (action.kind !== 'openPage') return { ok: false }
      if (!d.openPage) return { ok: false, detail: 'Orbis cannot open Pages at the moment.' }
      return d.openPage(action.pageId)
    },

    workflow: async (action, job) => {
      if (action.kind !== 'workflow') return { ok: false }
      if (!d.runWorkflow) return { ok: false, detail: 'Orbis has no workflows at the moment.' }
      return d.runWorkflow(action.workflowId, job)
    },

    orion: async (action, job) => {
      if (action.kind !== 'orion') return { ok: false }
      if (!d.ask) return { ok: false, detail: 'Orion has no model key, so it cannot answer.' }
      const answer = await d.ask(action.prompt)
      const text = answer.trim()
      if (text.length === 0) return { ok: false, detail: 'Orion did not answer.' }
      /**
       * The answer is shown, not filed away.
       *
       * A scheduled question whose answer nobody sees is a scheduled waste of a model call. It is capped because a
       * notification is a line or two, and the whole answer is kept in the job's history.
       */
      d.notify(job.name, text.slice(0, 240))
      return { ok: true, detail: text.slice(0, 200) }
    },

    notify: async (action, job) => {
      if (action.kind !== 'notify') return { ok: false }
      d.notify(job.name, action.message)
      return { ok: true, detail: 'Said.' }
    }
  }
}

/** Whether two addresses are the same page, ignoring the things that do not change which page it is. */
export function sameAddress(a: string, b: string): boolean {
  const clean = (url: string): string =>
    url
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/#.*$/, '')
      .replace(/\/$/, '')
  return clean(a) === clean(b)
}
