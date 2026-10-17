/**
 * The three things that make the page feel like an app rather than a web page, switched on.
 *
 * Right-click menus, keyboard shortcuts and dragging are each one file, each with one listener on the whole page, and
 * this is the one line that starts them. They are deliberately not screens: a menu on a song has to work the same way
 * on every screen there is, and a page where each screen started its own would be a page where Space means something
 * slightly different in six places.
 *
 * What a screen has to do to join in is one call per row, from `marked.ts`:
 *
 * ```ts
 * import { markTrack } from '../marked.ts'
 * markTrack(trackRow(track), track, { playlistId: list.id })
 * ```
 *
 * That gives the row its menu and makes it draggable. A screen that marks nothing still gets the shortcuts, the
 * shortcuts sheet, and dragging onto the playlists down the left from wherever the songs came from.
 *
 * Nothing here waits for the frame to be built. The listeners are on the page itself, so they serve rows built long
 * after this ran, and the one piece that does need the frame -- marking the playlists down the left -- waits for that
 * list to appear by itself.
 */

import { startDragging } from './drag.ts'
import { watchSidebarPlaylists } from './marked.ts'
import { startMenus } from './menu.ts'
import { startShortcuts } from './shortcuts.ts'

startMenus()
startShortcuts()
startDragging()
watchSidebarPlaylists()
