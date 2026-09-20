import { webContents } from 'electron'
import type { WebContents } from 'electron'
import { fail } from './registry.ts'
import type { ControlContext } from './registry.ts'
import type { WindowControl } from './window.ts'

/** The tab (or extension page) a page capability acts on: the command's target, or the active tab. */
export function resolvePage(ctx: Pick<ControlContext, 'target'>, windowControl: WindowControl, getHost: () => WebContents | null): WebContents {
  const state = windowControl.state
  let id = ctx.target?.webContentsId ?? null
  if (id === null && ctx.target?.tabId) {
    const tab = state?.tabs.find((t) => t.id === ctx.target!.tabId) ?? fail('not-found', `No tab with id ${ctx.target.tabId}. Read state.snapshot for the current tabs.`, true)
    id = tab.webContentsId ?? fail('unavailable', 'That tab has no page yet.', true)
  }
  if (id === null) {
    const active = state?.open ? state.tabs.find((t) => t.active) : undefined
    if (!active) fail('unavailable', 'The browser is closed or has no active tab. Open it first (browser.open).', true)
    id = active!.webContentsId ?? fail('unavailable', 'The active tab has no page open yet. Navigate it first (navigation.go).', true)
  }
  const contents = webContents.fromId(id!)
  const host = getHost()
  if (!contents || contents.isDestroyed()) fail('not-found', 'That tab closed.', true)
  // Only Orbis's own browser tabs and extension pages inside the Orbis window: never the Orbis window itself.
  if (contents!.getType() !== 'webview' || !host || contents!.hostWebContents !== host) fail('blocked', 'Orbis only controls pages inside its own browser.')
  return contents!
}
