/**
 * Metadata read from inside files (not Orbis catalogue data). Every field is
 * optional: a missing field means "not present or not readable", never zero.
 */

export interface ExifSummary {
  make?: string;
  model?: string;
  lens?: string;
  software?: string;
  /** Date the photo was taken, as recorded by the camera (local time, no zone). */
  takenAt?: string;
  exposureTime?: string;
  fNumber?: number;
  iso?: number;
  focalLengthMm?: number;
  flash?: boolean;
}

export interface GpsLocation {
  latitude: number;
  longitude: number;
  altitudeM?: number;
}

export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: string;
  track?: string;
  genre?: string;
  comment?: string;
}

export interface DocumentProps {
  title?: string;
  subject?: string;
  creator?: string;
  keywords?: string;
  description?: string;
  lastModifiedBy?: string;
  created?: string;
  modified?: string;
  application?: string;
  pages?: number;
  words?: number;
  slides?: number;
}

/** Text stored in an image (PNG tEXt / zTXt / iTXt chunks with these standard keywords). */
export interface ImageText {
  title?: string;
  author?: string;
  description?: string;
  copyright?: string;
  comment?: string;
  software?: string;
}

/** Standard PNG keyword for each editable image text field. */
export const PNG_TEXT_KEYWORDS: Record<keyof ImageText, string> = { title: 'Title', author: 'Author', description: 'Description', copyright: 'Copyright', comment: 'Comment', software: 'Software' };

/** Kinds of change Orbis Files can write into a file. */
export type EditableKind = 'audioTags' | 'removeAudioTags' | 'documentProps' | 'imageText' | 'removeImageText' | 'removeLocation' | 'removeExif';

export interface MediaMeta {
  /** What the content was identified as (from bytes, not the extension). */
  kind: 'image' | 'audio' | 'video' | 'document' | 'none';
  format?: string;
  width?: number;
  height?: number;
  /** Seconds. */
  durationSec?: number;
  /** True when the duration was estimated (e.g. constant-bitrate MP3 without a frame count). */
  durationEstimated?: boolean;
  bitrateKbps?: number;
  sampleRateHz?: number;
  channels?: number;
  bitDepth?: number;
  colorType?: string;
  orientation?: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  pages?: number;
  /**
   * When the recording was made, as stored by the container (MP4/QuickTime movie header,
   * Matroska/WebM DateUTC), ISO 8601 in UTC. Absent when the file does not record it (or stores 0).
   */
  createdAt?: string;
  exif?: ExifSummary;
  /** Present only when the caller asked to include location data. */
  gps?: GpsLocation;
  /** Whether the file contains embedded location data (always reported). */
  hasLocation?: boolean;
  tags?: AudioTags;
  doc?: DocumentProps;
  /** Text metadata stored in an image (PNG). */
  imageText?: ImageText;
  /** Which fields are editable through Orbis Files, for this exact format. */
  editable?: EditableKind[];
  warnings: string[];
}

/** Compact metadata used for list columns and sorting. */
export interface MediaSummary {
  width?: number;
  height?: number;
  durationSec?: number;
  pages?: number;
  takenAt?: string;
  camera?: string;
  artist?: string;
  title?: string;
}

export function summarize(m: MediaMeta): MediaSummary {
  return {
    camera: [m.exif?.make, m.exif?.model].filter(Boolean).join(' ') || undefined,
    width: m.width,
    height: m.height,
    durationSec: m.durationSec,
    pages: m.pages ?? m.doc?.pages,
    takenAt: m.exif?.takenAt,
    artist: m.tags?.artist,
    title: m.tags?.title ?? m.doc?.title ?? m.imageText?.title,
  };
}

/** Extensions for which a metadata read is worthwhile. */
export const META_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'jfif', 'jpe', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'heic', 'heif', 'avif', 'ico',
  'mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac',
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv',
  'pdf', 'docx', 'xlsx', 'pptx', 'docm', 'xlsm', 'pptm', 'odt', 'ods', 'odp',
]);
