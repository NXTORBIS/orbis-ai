import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError } from '../../shared/errors';
import type { MetadataEntry, MetadataResult } from '../../shared/metadata';
import { readMetadata } from '../media/metadata';

/**
 * EXIF/metadata viewer and editor. Reads metadata using the existing parser and
 * organises it into grouped entries for the UI. Supports stripping all EXIF
 * from JPEG files and updating DateTime.
 */

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'tiff', 'tif', 'webp', 'heic', 'heif', 'avif']);

export async function readFileMetadata(filePath: string): Promise<MetadataResult> {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const m = await readMetadata(filePath, { includeLocation: true });

  const entries: MetadataEntry[] = [];
  const isImage = IMAGE_EXTS.has(ext);
  const isJpeg = ['jpg', 'jpeg', 'jpe', 'jfif'].includes(ext);
  const canWrite = isJpeg && !!m.exif;

  // Camera group
  if (m.exif) {
    const e = m.exif;
    if (e.make) entries.push({ key: 'Make', value: e.make, editable: false, group: 'camera' });
    if (e.model) entries.push({ key: 'Model', value: e.model, editable: false, group: 'camera' });
    if (e.lens) entries.push({ key: 'Lens', value: e.lens, editable: false, group: 'camera' });
    if (e.takenAt) entries.push({ key: 'Date/Time', value: e.takenAt, editable: isJpeg, group: 'camera' });
    if (e.exposureTime) entries.push({ key: 'Shutter Speed', value: e.exposureTime, editable: false, group: 'camera' });
    if (e.fNumber !== undefined) entries.push({ key: 'Aperture', value: `f/${e.fNumber}`, editable: false, group: 'camera' });
    if (e.iso !== undefined) entries.push({ key: 'ISO', value: String(e.iso), editable: false, group: 'camera' });
    if (e.focalLengthMm !== undefined) entries.push({ key: 'Focal Length', value: `${e.focalLengthMm} mm`, editable: false, group: 'camera' });
    if (e.flash !== undefined) entries.push({ key: 'Flash', value: e.flash ? 'Fired' : 'Did not fire', editable: false, group: 'camera' });
    if (e.software) entries.push({ key: 'Software', value: e.software, editable: false, group: 'camera' });
  }

  // Location group
  if (m.gps) {
    entries.push({ key: 'Latitude', value: String(m.gps.latitude), editable: false, group: 'location' });
    entries.push({ key: 'Longitude', value: String(m.gps.longitude), editable: false, group: 'location' });
    if (m.gps.altitudeM !== undefined) entries.push({ key: 'Altitude', value: `${m.gps.altitudeM} m`, editable: false, group: 'location' });
  }

  // Image group
  if (isImage || m.kind === 'image') {
    if (m.width && m.height) {
      entries.push({ key: 'Dimensions', value: `${m.width} × ${m.height}`, editable: false, group: 'image' });
      if (m.width * m.height >= 1e6) entries.push({ key: 'Megapixels', value: `${(m.width * m.height / 1e6).toFixed(1)} MP`, editable: false, group: 'image' });
    }
    if (m.colorType) entries.push({ key: 'Color Type', value: m.colorType, editable: false, group: 'image' });
    if (m.bitDepth) entries.push({ key: 'Bit Depth', value: `${m.bitDepth}-bit`, editable: false, group: 'image' });
    if (m.orientation) entries.push({ key: 'Orientation', value: String(m.orientation), editable: false, group: 'image' });
  }

  // Audio group
  if (m.tags) {
    const t = m.tags;
    const audioFields: Array<[string, string | undefined]> = [
      ['Title', t.title], ['Artist', t.artist], ['Album', t.album],
      ['Album Artist', t.albumArtist], ['Year', t.year], ['Track', t.track],
      ['Genre', t.genre], ['Comment', t.comment],
    ];
    for (const [key, val] of audioFields) {
      if (val) entries.push({ key, value: val, editable: false, group: 'audio' });
    }
  }
  if (m.sampleRateHz) entries.push({ key: 'Sample Rate', value: `${m.sampleRateHz} Hz`, editable: false, group: 'audio' });
  if (m.channels) entries.push({ key: 'Channels', value: m.channels === 1 ? 'Mono' : m.channels === 2 ? 'Stereo' : String(m.channels), editable: false, group: 'audio' });
  if (m.bitrateKbps) entries.push({ key: 'Bit Rate', value: `${m.bitrateKbps} kbps`, editable: false, group: 'audio' });
  if (m.durationSec !== undefined) entries.push({ key: 'Duration', value: formatDuration(m.durationSec), editable: false, group: 'audio' });

  // Document group
  if (m.doc) {
    const d = m.doc;
    const docFields: Array<[string, string | undefined]> = [
      ['Title', d.title], ['Subject', d.subject], ['Author', d.creator],
      ['Keywords', d.keywords], ['Description', d.description],
      ['Last Modified By', d.lastModifiedBy], ['Created', d.created],
      ['Modified', d.modified], ['Application', d.application],
    ];
    for (const [key, val] of docFields) {
      if (val) entries.push({ key, value: val, editable: false, group: 'document' });
    }
    if (d.pages) entries.push({ key: 'Pages', value: String(d.pages), editable: false, group: 'document' });
    if (d.words) entries.push({ key: 'Words', value: String(d.words), editable: false, group: 'document' });
  }

  // File group (always present)
  const stat = await fsp.stat(filePath);
  entries.push({ key: 'File Size', value: formatFileSize(stat.size), editable: false, group: 'file' });
  entries.push({ key: 'Modified', value: stat.mtime.toISOString(), editable: false, group: 'file' });
  entries.push({ key: 'Created', value: stat.birthtime.toISOString(), editable: false, group: 'file' });
  if (m.format) entries.push({ key: 'Format', value: m.format, editable: false, group: 'file' });

  return { entries, format: m.format ?? ext.toUpperCase(), canWrite };
}

/** Strip all EXIF from a JPEG by removing APP1 segments. */
export async function stripAllExif(filePath: string): Promise<void> {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!['jpg', 'jpeg', 'jpe', 'jfif'].includes(ext)) {
    throw makeError('unsupported', 'EXIF stripping is only supported for JPEG files');
  }

  const data = await fsp.readFile(filePath);
  if (data[0] !== 0xFF || data[1] !== 0xD8) {
    throw makeError('unsupported', 'Not a valid JPEG file');
  }

  const chunks: Buffer[] = [Buffer.from([0xFF, 0xD8])];
  let offset = 2;

  while (offset < data.length - 1) {
    if (data[offset] !== 0xFF) break;
    const marker = data[offset + 1]!;

    // SOS marker — copy the rest as-is
    if (marker === 0xDA) {
      chunks.push(data.subarray(offset));
      break;
    }

    // Skip APP1 (0xE1) — these contain EXIF and XMP
    if (marker === 0xE1) {
      const segLen = data.readUInt16BE(offset + 2);
      offset += 2 + segLen;
      continue;
    }

    // Keep other markers
    if (marker >= 0xE0 || marker === 0xFE || marker === 0xDB || marker === 0xC0 || marker === 0xC2 || marker === 0xC4) {
      const segLen = data.readUInt16BE(offset + 2);
      chunks.push(data.subarray(offset, offset + 2 + segLen));
      offset += 2 + segLen;
    } else {
      // standalone marker (no length)
      chunks.push(data.subarray(offset, offset + 2));
      offset += 2;
    }
  }

  await fsp.writeFile(filePath, Buffer.concat(chunks));
}

/** Update the DateTime EXIF tag in a JPEG. Rewrites the APP1 segment. */
export async function updateDateTime(filePath: string, newDateTime: string): Promise<void> {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!['jpg', 'jpeg', 'jpe', 'jfif'].includes(ext)) {
    throw makeError('unsupported', 'DateTime editing is only supported for JPEG files');
  }

  const data = await fsp.readFile(filePath);
  if (data[0] !== 0xFF || data[1] !== 0xD8) throw makeError('unsupported', 'Not a valid JPEG file');

  // Find APP1 EXIF segment
  let offset = 2;
  while (offset < data.length - 3) {
    if (data[offset] !== 0xFF) break;
    const marker = data[offset + 1]!;
    if (marker === 0xDA) break;

    const segLen = data.readUInt16BE(offset + 2);
    if (marker === 0xE1) {
      const exifHeader = data.toString('ascii', offset + 4, offset + 10);
      if (exifHeader === 'Exif\0\0') {
        // Found EXIF — search for DateTime tag (0x0132) in the IFD
        const tiffBase = offset + 10;
        const le = data.toString('ascii', tiffBase, tiffBase + 2) === 'II';
        const r16 = le ? (o: number) => data.readUInt16LE(o) : (o: number) => data.readUInt16BE(o);
        const r32 = le ? (o: number) => data.readUInt32LE(o) : (o: number) => data.readUInt32BE(o);

        // Pad to EXIF DateTime format: "YYYY:MM:DD HH:MM:SS"
        const dt = newDateTime.padEnd(19, ' ').slice(0, 19) + '\0';

        // Scan IFD0
        const ifdOffset = r32(tiffBase + 4);
        const entryCount = r16(tiffBase + ifdOffset);
        for (let i = 0; i < entryCount; i++) {
          const entryOff = tiffBase + ifdOffset + 2 + i * 12;
          const tag = r16(entryOff);
          // 0x0132 = DateTime, 0x9003 = DateTimeOriginal, 0x9004 = DateTimeDigitized
          if (tag === 0x0132) {
            const valOffset = r32(entryOff + 8);
            const absOffset = tiffBase + valOffset;
            // Write the new date in place (20 bytes including null)
            data.write(dt, absOffset, 20, 'ascii');
          }
        }

        // Also check SubIFD for DateTimeOriginal
        for (let i = 0; i < entryCount; i++) {
          const entryOff = tiffBase + ifdOffset + 2 + i * 12;
          const tag = r16(entryOff);
          if (tag === 0x8769) {
            // ExifIFD pointer
            const subOffset = r32(entryOff + 8);
            const subCount = r16(tiffBase + subOffset);
            for (let j = 0; j < subCount; j++) {
              const subEntry = tiffBase + subOffset + 2 + j * 12;
              const subTag = r16(subEntry);
              if (subTag === 0x9003 || subTag === 0x9004) {
                const valOff = r32(subEntry + 8);
                data.write(dt, tiffBase + valOff, 20, 'ascii');
              }
            }
          }
        }

        await fsp.writeFile(filePath, data);
        return;
      }
    }
    offset += 2 + segLen;
  }

  throw makeError('unsupported', 'No EXIF data found to update');
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
