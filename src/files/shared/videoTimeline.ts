import { z } from 'zod';

/**
 * Video thumbnail timeline: shared types for the IPC boundary.
 */

export const VideoTimelineRequestSchema = z.object({
  path: z.string().min(1).max(32767),
  /** Number of thumbnails to extract (default 10). */
  count: z.number().int().min(2).max(60).default(10),
  /** Thumbnail height in pixels (width is proportional). */
  thumbHeight: z.number().int().min(40).max(240).default(90),
});
export type VideoTimelineRequest = z.infer<typeof VideoTimelineRequestSchema>;

export interface VideoTimelineThumbnail {
  /** Timestamp in seconds. */
  timeSec: number;
  /** Base64-encoded JPEG data. */
  jpegBase64: string;
  width: number;
  height: number;
}

export interface VideoTimelineResult {
  thumbnails: VideoTimelineThumbnail[];
  durationSec: number;
  codec: string;
  resolution: { width: number; height: number };
  fps: number;
  /** File size in bytes. */
  fileSize: number;
}
