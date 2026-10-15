import { z } from 'zod';

/**
 * Saved playlists (named, stored in the app database).
 * These are separate from the m3u8 file export: they persist in the DB
 * and can be loaded back into the player queue at any time.
 */

export const PLAYLIST_NAME_MAX = 128;
export const PLAYLIST_ITEMS_MAX = 5000;

const pathStr = z.string().min(1).max(32767);

export const SavedPlaylistSchema = z.object({
  name: z.string().min(1).max(PLAYLIST_NAME_MAX),
  paths: z.array(pathStr).min(1).max(PLAYLIST_ITEMS_MAX),
});

export const PlaylistNameSchema = z.string().min(1).max(PLAYLIST_NAME_MAX);

export interface SavedPlaylist {
  id: string;
  name: string;
  paths: string[];
  createdMs: number;
  updatedMs: number;
}
