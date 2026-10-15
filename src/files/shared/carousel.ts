/**
 * File Preview Carousel: multi-image carousel with arrow navigation,
 * slideshow mode, thumbnail strip, and zoom/fit controls.
 */

export interface CarouselItem {
  path: string;
  name: string;
  width?: number;
  height?: number;
}

export type CarouselFit = 'contain' | 'cover' | 'actual';

export interface CarouselState {
  items: CarouselItem[];
  currentIndex: number;
  fit: CarouselFit;
  zoom: number;
  slideshowActive: boolean;
  slideshowIntervalMs: number;
}

export const DEFAULT_SLIDESHOW_INTERVAL_MS = 3000;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;
export const ZOOM_STEP = 0.25;

export const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico', 'tiff', 'tif',
]);

export function isImageFile(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}
