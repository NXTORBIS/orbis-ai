/**
 * Orbis Music, as a whole browser tab.
 *
 * This file does two things and nothing else: it brings in the screen files, so that each one registers itself, and
 * it starts the frame they sit in. Everything else -- what is playing, what the address means, how a track row looks,
 * how a cover is asked for -- is in its own file beside this one.
 *
 * **Adding a screen.** Write `extension-src/music/screens/<name>.ts`, have it call `registerScreen` at the top level
 * (the contract is written out in full at the top of `screens.ts`), and add one import line below. That is the whole
 * edit outside the screen's own file. An address naming a screen nobody has written yet shows a sentence saying so,
 * which is why the frame can ship before the screens do.
 */

import { startRouting } from './router.ts'
import { startShell } from './shell.ts'

// ---- screens. One line each, in the order they appear down the left. ----
import './screens/album.ts'
import './screens/artist.ts'
import './screens/bring-in.ts'
import './screens/discover.ts'
import './screens/genre.ts'
import './screens/home.ts'
import './screens/liked.ts'
import './screens/listening.ts'
import './screens/library.ts'
import './screens/playlist.ts'
import './screens/playlists.ts'
import './screens/noticed.ts'
import './screens/nowplaying.ts'
import './screens/queue.ts'
import './screens/search.ts'
import './screens/settings.ts'
import './screens/tidy.ts'

// The right-click menus, the keyboard shortcuts and dragging. Not a screen: they belong to every screen at once.
import './extras.ts'

const into = document.getElementById('om-root')
if (!into) {
  // The page's own HTML is missing its one element, which can only mean music.html and this script have gone out of
  // step. Said in the console rather than silently drawing nothing.
  console.error('Orbis Music: music.html has no #om-root to draw into.')
} else {
  startRouting()
  startShell(into)
}
