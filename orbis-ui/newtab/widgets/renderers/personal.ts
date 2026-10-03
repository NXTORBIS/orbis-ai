import type { RendererTable } from '../api.ts'
import { drawTasks } from './personal/tasks.ts'
import { drawReminders } from './personal/reminders.ts'
import { drawNotes } from './personal/notes.ts'
import { drawBookmarks, drawRecent } from './personal/sites.ts'
import { drawDownloads } from './personal/downloads.ts'
import { drawTabs } from './personal/tabs.ts'
import { drawWorkspaces } from './personal/workspaces.ts'
import { drawClipboard } from './personal/clipboard.ts'
import { drawWhiteboard } from './personal/whiteboard.ts'

/**
 * The widgets that draw what is already yours: your tasks, your notes, the pages you keep and the ones you are on.
 *
 * They have nothing in common but that. Not one of them fetches anything, not one of them decides anything for you,
 * and every one of them shows either something Orbis really holds or the plain sentence that there is nothing there
 * yet. The ids are the catalogue's ids (src/shared/widgets.ts); a widget listed there with nothing here is a widget
 * the gallery never offers.
 */
export const PERSONAL_RENDERERS: RendererTable = Object.freeze({
  tasks: drawTasks,
  reminders: drawReminders,
  notes: drawNotes,
  bookmarks: drawBookmarks,
  downloads: drawDownloads,
  tabs: drawTabs,
  workspaces: drawWorkspaces,
  clipboard: drawClipboard,
  whiteboard: drawWhiteboard,
  recent: drawRecent
})
