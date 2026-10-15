import { createStore } from './store';
import type { ColorTag, FileColorTag } from '../../shared/colorTags';
import { call } from '../api';

export interface ColorTagState {
  tags: ColorTag[];
  fileTags: Map<string, string[]>; // path -> tagId[]
  loading: boolean;
  filterTagId: string | null;
}

export const colorTagStore = createStore<ColorTagState>({
  tags: [],
  fileTags: new Map(),
  loading: true,
  filterTagId: null,
});

export async function loadColorTags(): Promise<void> {
  const tags = await call<ColorTag[]>('colorTag:list');
  colorTagStore.set({ tags, loading: false });
}

export async function loadFileColorTags(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const result = await call<FileColorTag[]>('colorTag:forPaths', { paths });
  const map = new Map(colorTagStore.get().fileTags);
  for (const path of paths) map.set(path, []);
  for (const ft of result) {
    const list = map.get(ft.path) ?? [];
    list.push(ft.tagId);
    map.set(ft.path, list);
  }
  colorTagStore.set({ fileTags: map });
}

export async function assignColorTag(paths: string[], tagId: string): Promise<void> {
  await call('colorTag:assign', { paths, tagId });
  await loadFileColorTags(paths);
}

export async function unassignColorTag(paths: string[], tagId: string): Promise<void> {
  await call('colorTag:unassign', { paths, tagId });
  await loadFileColorTags(paths);
}

export async function createColorTag(label: string, hex: string): Promise<ColorTag> {
  const tag = await call<ColorTag>('colorTag:create', { label, hex });
  await loadColorTags();
  return tag;
}

export async function updateColorTag(id: string, label?: string, hex?: string): Promise<void> {
  await call('colorTag:update', { id, label, hex });
  await loadColorTags();
}

export async function deleteColorTag(id: string): Promise<void> {
  await call('colorTag:delete', { id });
  await loadColorTags();
}

export function setColorTagFilter(tagId: string | null): void {
  colorTagStore.set({ filterTagId: tagId });
}

export function getTagsForPath(path: string): string[] {
  return colorTagStore.get().fileTags.get(path) ?? [];
}
