import { createStore } from './store';
import type { Bookmark } from '../../shared/bookmarks';
import { call } from '../api';

export interface BookmarkState {
  bookmarks: Bookmark[];
  loading: boolean;
}

export const bookmarkStore = createStore<BookmarkState>({
  bookmarks: [],
  loading: true,
});

export async function loadBookmarks(): Promise<void> {
  const bookmarks = await call<Bookmark[]>('bookmark:list');
  bookmarkStore.set({ bookmarks, loading: false });
}

export async function addBookmark(path: string, label: string, kind: 'file' | 'directory'): Promise<void> {
  await call('bookmark:add', { path, label, kind });
  await loadBookmarks();
}

export async function removeBookmark(id: string): Promise<void> {
  await call('bookmark:remove', { id });
  await loadBookmarks();
}

export async function reorderBookmarks(ids: string[]): Promise<void> {
  await call('bookmark:reorder', { ids });
  await loadBookmarks();
}

export async function renameBookmark(id: string, label: string): Promise<void> {
  await call('bookmark:rename', { id, label });
  await loadBookmarks();
}
