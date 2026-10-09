import type { LibraryQuery, OrbisTrack, Playlist, RepeatMode, TrackNames } from './music.ts'

/**
 * What the browser side may do with Orbis Music.
 *
 * Declared here, where neither half owns it, because two halves each writing down what they think the other offers is
 * how the two drift apart: the app would hand over one shape and the browser's channels would check another, and
 * nothing would notice until something returned the wrong thing at runtime. One interface, imported by both.
 *
 * Deliberately smaller than the whole service. The panel can look through the library, work the player, keep a song it
 * heard and manage playlists. It cannot delete a file, name a path, reach another profile, or import -- importing needs
 * a person at their own file picker, which belongs to the window.
 */
export interface MusicPortShape {
  snapshot(): Promise<unknown>
  /** What Orbis currently thinks is playing in the browser. */
  heard(): unknown
  look(options?: { force?: boolean; tabId?: string }): Promise<unknown>
  search(query: LibraryQuery): Promise<OrbisTrack[]>
  /**
   * Anything else Orbis Music can do, by name.
   *
   * One door rather than forty: the panel needs searching, the intelligence, the DJ, the stations and the reset
   * scopes, and a method each would be forty lines of this file saying nothing a name does not already say.
   */
  ask(op: string, a?: unknown, b?: unknown, c?: unknown): Promise<unknown>
  albums(): Promise<unknown>
  artists(): Promise<unknown>
  genres(): Promise<unknown>
  playlists(): Promise<Playlist[]>
  playlistTracks(id: string): Promise<OrbisTrack[]>
  recentlyPlayed(): Promise<OrbisTrack[]>
  recognised(): Promise<unknown>
  play(trackId: string): Promise<{ ok: boolean; why?: string }>
  playAll(trackIds: string[], startAt?: number): Promise<{ ok: boolean; why?: string }>
  playPlaylist(id: string): Promise<{ ok: boolean; why?: string }>
  pause(): void
  resume(): void
  toggle(): void
  next(): Promise<void>
  previous(): Promise<void>
  seek(seconds: number): void
  volume(value: number): Promise<void>
  mute(on: boolean): void
  shuffle(on: boolean): Promise<void>
  repeat(mode: RepeatMode): Promise<void>
  queueNext(trackIds: string[]): void
  queueEnd(trackIds: string[]): void
  queueRemove(index: number): void
  queueReorder(from: number, to: number): void
  queueClear(): void
  favourite(trackId: string, on: boolean): Promise<OrbisTrack | null>
  createPlaylist(name: string): Promise<Playlist>
  addToPlaylist(id: string, trackIds: string[]): Promise<unknown>
  removeFromPlaylist(id: string, trackId: string): Promise<unknown>
  /** Keeps a song heard while browsing. The most it can do is link to a file the person has, or keep the name. */
  addHeard(names: TrackNames, duration: number, source: { provider: string; url?: string }): Promise<unknown>
  /**
   * Opens the Orbis window’s own file picker and reads whatever was chosen.
   *
   * Here rather than in the browser because a panel naming a path is exactly what must not happen: the dialog is the
   * operating system’s, shown on the Orbis window, and the browser side only ever learns how many files were added.
   */
  importFiles(): Promise<unknown>
  /** Opens the picker for a folder, reads it, and watches it from then on. */
  scanFolder(): Promise<unknown>
  settings(): Promise<unknown>
  saveSettings(patch: Record<string, unknown>): Promise<unknown>
}
