/**
 * Where the screens plug in.
 *
 * The shell -- the left-hand list, the main area with its own back and forward, the column on the right and the
 * player along the bottom -- knows nothing about any particular screen. It knows this registry. A screen is one file
 * that calls `registerScreen` once, and the shell draws it when the address says so.
 *
 * **The contract, in full.**
 *
 * A screen is given a `ScreenPlace`: an empty element to fill, the address that asked for it, and a small set of
 * things it may do. It returns a `MountedScreen`, or nothing if it has none of those to give. The shell will:
 *
 *   - empty the element and call `mount` again whenever the address changes to a different screen, or to the same
 *     screen about a different thing (a different album, different search words);
 *   - call `onPlayer` on the returned object about once a second, with the live player state, but only when something
 *     a person could see has changed -- not on every answer, because the position changes every single time;
 *   - call `onCovers` when new covers have arrived, so a grid can draw them without being rebuilt;
 *   - call `leave` before emptying the element, so a screen can stop its own timers;
 *   - read `wants` to decide whether to show the column on the right and whether the screen fills the width.
 *
 * **What a screen must not do.** It must not fetch anything itself -- `client.ts` is the only route, and a second one
 * would be a second idea of what is playing. It must not hold its own copy of the player state; read `player.ts`. It
 * must not show an empty list when a call failed: every answer from the client is either a value or a reason, and a
 * reason means keep what is drawn and say what happened. And it must not invent a value -- no placeholder tracks, no
 * sample playlists, no guessed lengths, no filled grid standing in for a thin library. A sentence saying there is
 * nothing there is the right answer and the house style.
 *
 * **Where a screen file goes.** `extension-src/music/screens/<name>.ts`, one file per screen, importing this file and
 * calling `registerScreen` at the top level. Then add it to the import list in `extension-src/music/main.ts` -- that
 * is the only edit a screen needs outside its own folder, and it is one line. Nothing else in the shell changes.
 */

import type { MusicRoute, MusicScreenName } from '../../src/shared/music/fulltab.ts'
import type { PlayerState } from './player.ts'

/** What a screen is handed. */
export interface ScreenPlace {
  /** An empty element to fill. The shell owns it and will empty it again; a screen must not move it or replace it. */
  readonly into: HTMLElement
  /** The address that asked for this screen, including what it is about and any search words. */
  readonly route: MusicRoute
  /** Goes to another screen, leaving an entry in the browser's history. */
  readonly go: (screen: MusicScreenName, of?: string, said?: string) => void
  /** Goes to another screen without a history entry. For a search box, where every letter is a new address. */
  readonly replace: (screen: MusicScreenName, of?: string, said?: string) => void
  /**
   * Says something briefly along the bottom. For the answer to a press: what the music service said, in its words.
   * Never for a progress bar and never for something that has not happened yet.
   */
  readonly note: (words: string) => void
  /** Asks for the covers of these tracks, top of the screen first. Call it again after a scroll. */
  readonly wantCovers: (trackIds: readonly string[]) => void
  /** Asks the player for a fresh answer now, rather than waiting for the clock. Use after a press. */
  readonly refresh: () => void
  /** Opens or closes the column on the right. */
  readonly showNowPlaying: (on: boolean) => void
}

/** What a screen gives back. Every part is optional: a screen that only draws once returns nothing at all. */
export interface MountedScreen {
  /** Something a person could see about the player has changed. Not called for the position moving on. */
  readonly onPlayer?: (state: PlayerState) => void
  /** New covers have arrived. Draw them; do not rebuild. */
  readonly onCovers?: () => void
  /** About to be taken off screen. Stop timers and let go of anything held. */
  readonly leave?: () => void
}

export interface ScreenShape {
  readonly screen: MusicScreenName
  /** What goes in the browser's tab title after "Orbis Music". A screen about one thing can name it. */
  readonly title?: (route: MusicRoute) => string
  /**
   * Whether the column on the right suits this screen. 'hide' for a screen that is itself about what is playing --
   * the queue, for instance -- so the same list is not on screen twice.
   */
  readonly wants?: { readonly nowPlaying?: 'show' | 'hide' | 'as-chosen'; readonly wide?: boolean }
  readonly mount: (place: ScreenPlace) => MountedScreen | void
}

const registry = new Map<MusicScreenName, ScreenShape>()

/**
 * Registers one screen. Called once, at the top level of the screen's own file.
 *
 * Registering the same screen twice is a mistake rather than a replacement: two files drawing one address is exactly
 * the kind of thing that works on one machine and not another, so it says so in the browser's own console instead of
 * quietly letting the last one win.
 */
export function registerScreen(shape: ScreenShape): void {
  if (registry.has(shape.screen)) {
    console.error(`Orbis Music: two screens are registered for "${shape.screen}". Only one file may draw a screen.`)
    return
  }
  registry.set(shape.screen, shape)
}

export const screenFor = (name: MusicScreenName): ScreenShape | undefined => registry.get(name)

/** Which screens have a file. Used by the shell to grey out a left-hand entry nothing has been built for yet. */
export const builtScreens = (): readonly MusicScreenName[] => [...registry.keys()]
