import { z } from 'zod';
import { orientationSwaps } from './pixels';

/**
 * Batch image tools: the settings (validated at the IPC boundary and again by
 * the operation runner), built-in presets, and the plan for one image (output
 * format, size, crop rectangle, which engine encodes it, and why an image
 * cannot be processed). Shared so the preview the user approves and the
 * operation that runs compute exactly the same thing.
 */

const dim = z.number().int().min(1).max(30000);

export const ResizeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  /** Fit inside width × height, keeping the proportions. */
  z.object({ mode: z.literal('fit'), width: dim, height: dim }),
  /** Exactly width × height (proportions may change). */
  z.object({ mode: z.literal('exact'), width: dim, height: dim }),
  z.object({ mode: z.literal('percent'), percent: z.number().min(1).max(1000) }),
]);

/** Characters allowed in the name suffix (no separators or characters invalid on common file systems). */
export const SUFFIX_RE = /^[^\\/:*?"<>|\u0000-\u001f]*$/;

export const ImageToolSpecSchema = z.object({
  resize: ResizeSchema.default({ mode: 'none' }),
  /** Never make an image larger than it is. */
  noUpscale: z.boolean().default(true),
  /** Crop to this aspect ratio (width:height), centred, before resizing. */
  crop: z.object({ w: z.number().int().min(1).max(100), h: z.number().int().min(1).max(100) }).nullable().default(null),
  /** Clockwise rotation, applied after the camera orientation and before flipping and cropping. */
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  /** Remove EXIF (including GPS), XMP and text metadata. Re-encoded copies never carry metadata. */
  stripMetadata: z.boolean().default(false),
  format: z.enum(['keep', 'jpeg', 'png', 'webp', 'avif', 'bmp']).default('keep'),
  /** JPEG and WebP quality (1–100). */
  quality: z.number().int().min(1).max(100).default(85),
  /** Added to each output name before the extension. */
  suffix: z.string().max(64).regex(SUFFIX_RE, 'The suffix contains a character that cannot be used in file names.').default('-edited'),
  /** Where outputs go; null = next to each original. */
  outputFolder: z.string().min(1).max(32767).nullable().default(null),
});
export type ImageToolSpec = z.infer<typeof ImageToolSpecSchema>;
export type ImageToolSpecInput = z.input<typeof ImageToolSpecSchema>;

export const ImagePresetSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(80),
  spec: ImageToolSpecSchema,
  savedMs: z.number(),
  builtIn: z.boolean().optional(),
});
export type ImagePreset = z.infer<typeof ImagePresetSchema>;

const preset = (id: string, name: string, spec: ImageToolSpecInput): ImagePreset => ({ id: `builtin:${id}`, name, spec: ImageToolSpecSchema.parse(spec), savedMs: 0, builtIn: true });

/** Presets that are always offered (cannot be deleted). */
export const BUILTIN_IMAGE_PRESETS: ImagePreset[] = [
  preset('web-1600', 'Web 1600px JPEG 82', { resize: { mode: 'fit', width: 1600, height: 1600 }, format: 'jpeg', quality: 82, stripMetadata: true, suffix: '-web' }),
  preset('thumb-400', 'Thumbnail 400px', { resize: { mode: 'fit', width: 400, height: 400 }, format: 'jpeg', quality: 80, stripMetadata: true, suffix: '-thumb' }),
  preset('square-1080', 'Square 1080px', { crop: { w: 1, h: 1 }, resize: { mode: 'fit', width: 1080, height: 1080 }, format: 'jpeg', quality: 85, stripMetadata: true, suffix: '-square' }),
  preset('clean', 'Remove EXIF and location', { stripMetadata: true, suffix: '-clean' }),
];

export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'bmp';
export type SourceFormat = OutputFormat | 'gif' | 'ico' | 'heic' | 'tiff' | 'svg' | 'other';

export function sourceFormat(name: string): SourceFormat {
  const ext = (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase();
  switch (ext) {
    case 'jpg': case 'jpeg': case 'jpe': case 'jfif': return 'jpeg';
    case 'png': return 'png';
    case 'webp': return 'webp';
    case 'gif': return 'gif';
    case 'bmp': return 'bmp';
    case 'avif': return 'avif';
    case 'ico': return 'ico';
    case 'heic': case 'heif': return 'heic';
    case 'tif': case 'tiff': return 'tiff';
    case 'svg': return 'svg';
    default: return 'other';
  }
}

/** Formats that can be decoded at all: JPEG/PNG by the platform codec, the rest by Chromium in the app window. */
export const DECODABLE: ReadonlySet<SourceFormat> = new Set(['jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'ico']);

const UNSUPPORTED_REASON: Partial<Record<SourceFormat, string>> = {
  heic: 'HEIC/HEIF photos cannot be decoded here (neither the platform codec nor Chromium reads them). Convert them with another app first.',
  tiff: 'TIFF images cannot be decoded here (Chromium does not read TIFF).',
  svg: 'SVG is a vector format; batch image tools work on pixel images only.',
  other: 'This file is not an image format these tools can read.',
};

export interface ImagePlan {
  /** Final size. */
  width: number;
  height: number;
  /** Size after the camera orientation and rotation (before cropping). */
  orientedWidth: number;
  orientedHeight: number;
  format: OutputFormat;
  /** Crop rectangle in the oriented, rotated image. */
  crop?: { x: number; y: number; w: number; h: number };
  /** Resize to width × height after cropping (absent: keep the cropped size). */
  scaleTo?: { w: number; h: number };
  /** Decode, transform and encode; false = copy with metadata removed byte for byte. */
  reencode: boolean;
  /** 'main' = platform codec (PNG/JPEG in and out); 'renderer' = Chromium canvas (WebP output, other inputs). */
  engine: 'main' | 'renderer';
  notes: string[];
  /** Set when this image cannot be processed (shown in the preview; the operation reports it per item). */
  error?: string;
  /** True when nothing would change (the item is skipped). */
  unchanged?: boolean;
}

/**
 * Plan one image. `width`/`height` are the stored pixel size; `orientation`
 * the EXIF orientation (applied so the result is upright).
 */
export function planImage(src: { name: string; width?: number; height?: number; orientation?: number }, specInput: ImageToolSpecInput): ImagePlan {
  const spec = ImageToolSpecSchema.parse(specInput);
  const fmt = sourceFormat(src.name);
  const notes: string[] = [];
  const base = { width: src.width ?? 0, height: src.height ?? 0, orientedWidth: src.width ?? 0, orientedHeight: src.height ?? 0, format: 'png' as OutputFormat, reencode: false, engine: 'main' as const, notes };
  if (!DECODABLE.has(fmt)) return { ...base, error: UNSUPPORTED_REASON[fmt] ?? UNSUPPORTED_REASON.other };
  if (!src.width || !src.height) return { ...base, error: 'The image size could not be read; the file may be damaged.' };
  const orientation = src.orientation && src.orientation >= 1 && src.orientation <= 8 ? src.orientation : 1;
  let W = src.width;
  let H = src.height;
  if (orientationSwaps(orientation)) [W, H] = [H, W];
  if (spec.rotate === 90 || spec.rotate === 270) [W, H] = [H, W];
  const orientedWidth = W;
  const orientedHeight = H;
  let crop: ImagePlan['crop'];
  if (spec.crop) {
    const r = spec.crop.w / spec.crop.h;
    let cw = W;
    let ch = H;
    if (W / H > r) cw = Math.max(1, Math.round(H * r));
    else ch = Math.max(1, Math.round(W / r));
    if (cw !== W || ch !== H) {
      crop = { x: Math.floor((W - cw) / 2), y: Math.floor((H - ch) / 2), w: cw, h: ch };
      W = cw;
      H = ch;
    }
  }
  let scaleTo: ImagePlan['scaleTo'];
  const rz = spec.resize;
  if (rz.mode === 'fit' || rz.mode === 'percent') {
    let s = rz.mode === 'fit' ? Math.min(rz.width / W, rz.height / H) : rz.percent / 100;
    if (s > 1 && spec.noUpscale) {
      notes.push('Not enlarged (it is already smaller than the requested size).');
      s = 1;
    }
    const w = Math.max(1, Math.round(W * s));
    const h = Math.max(1, Math.round(H * s));
    if (w !== W || h !== H) scaleTo = { w, h };
  } else if (rz.mode === 'exact') {
    if (spec.noUpscale && (rz.width > W || rz.height > H)) notes.push(`Not resized: ${rz.width} × ${rz.height} would enlarge it (turn off “Never enlarge” to allow that).`);
    else if (rz.width !== W || rz.height !== H) scaleTo = { w: rz.width, h: rz.height };
  }
  const width = scaleTo?.w ?? W;
  const height = scaleTo?.h ?? H;
  const format: OutputFormat = spec.format === 'keep' ? (fmt === 'jpeg' || fmt === 'png' || fmt === 'webp' || fmt === 'avif' || fmt === 'bmp' ? fmt : 'png') : spec.format;
  if (spec.format === 'keep' && format !== fmt) notes.push(`Saved as PNG (${fmt.toUpperCase()} cannot be written here).`);
  const pixels = orientation !== 1 || spec.rotate !== 0 || spec.flipH || spec.flipV || !!crop || !!scaleTo;
  const reencode = pixels || format !== fmt;
  const plan: ImagePlan = { width, height, orientedWidth, orientedHeight, format, crop, scaleTo, reencode, engine: 'main', notes };
  if (!reencode) {
    if (!spec.stripMetadata) return { ...plan, unchanged: true, notes: [...notes, 'Nothing to change for this image.'] };
    if (fmt !== 'jpeg' && fmt !== 'png') return { ...plan, error: 'Removing metadata without converting works for JPEG and PNG only. Choose an output format to convert this image.' };
    notes.push('Metadata removed; the image data is copied unchanged.');
    return plan;
  }
  plan.engine = (fmt === 'jpeg' || fmt === 'png') && (format === 'jpeg' || format === 'png') ? 'main' : 'renderer';
  if (orientation !== 1) notes.push('Camera orientation applied.');
  if (fmt === 'gif') notes.push('Only the first frame of an animated GIF is kept.');
  notes.push('Re-encoded: EXIF, location, text and colour-profile data are not carried over.');
  return plan;
}

/** File extension written for an output format (keeps “.jpeg” when the original used it). */
export function outputExt(format: OutputFormat, sourceName: string): string {
  if (format === 'jpeg') return /\.jpeg$/i.test(sourceName) ? 'jpeg' : 'jpg';
  return format;
}

/** Output name for a source file name (before any “(2)” added to avoid an existing file). */
export function outputName(sourceName: string, spec: Pick<ImageToolSpec, 'suffix'>, format: OutputFormat): string {
  const stem = sourceName.replace(/\.[^.]+$/, '') || 'image';
  return `${stem}${spec.suffix}.${outputExt(format, sourceName)}`;
}
