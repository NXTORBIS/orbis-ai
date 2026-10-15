import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '../store/Database';
import type { CreateFileLinkInput, FileLink, FileLinkResolved } from '../../shared/fileLinks';

/**
 * File links (aliases) service. CRUD for soft references stored in the DB,
 * with resolution that checks whether targets still exist.
 */

interface LinkRow {
  id: string;
  name: string;
  target_path: string;
  parent_path: string;
  created_ms: number;
  updated_ms: number;
}

function rowToLink(row: LinkRow): FileLink {
  return {
    id: String(row.id),
    name: String(row.name),
    targetPath: String(row.target_path),
    parentPath: String(row.parent_path),
    createdMs: Number(row.created_ms),
    updatedMs: Number(row.updated_ms),
  };
}

export function createFileLink(db: AppDatabase, input: CreateFileLinkInput): FileLink {
  const now = Date.now();
  const link: FileLink = {
    id: randomUUID().replace(/-/g, '').slice(0, 16),
    name: input.name,
    targetPath: input.targetPath,
    parentPath: input.parentPath,
    createdMs: now,
    updatedMs: now,
  };
  db.run(
    'INSERT INTO file_links (id, name, target_path, parent_path, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?)',
    [link.id, link.name, link.targetPath, link.parentPath, link.createdMs, link.updatedMs],
  );
  return link;
}

export function deleteFileLink(db: AppDatabase, id: string): boolean {
  db.run('DELETE FROM file_links WHERE id = ?', [id]);
  return true;
}

export function listFileLinks(db: AppDatabase, parentPath: string): FileLink[] {
  return db.all<LinkRow>('SELECT id, name, target_path, parent_path, created_ms, updated_ms FROM file_links WHERE parent_path = ?', [parentPath]).map(rowToLink);
}

export function getFileLink(db: AppDatabase, id: string): FileLink | null {
  const row = db.get<LinkRow>('SELECT id, name, target_path, parent_path, created_ms, updated_ms FROM file_links WHERE id = ?', [id]);
  return row ? rowToLink(row) : null;
}

export async function resolveFileLink(db: AppDatabase, id: string): Promise<FileLinkResolved | null> {
  const link = getFileLink(db, id);
  if (!link) return null;
  try {
    const st = await fsp.stat(link.targetPath);
    return {
      ...link,
      exists: true,
      targetKind: st.isDirectory() ? 'directory' : 'file',
      targetSize: st.size,
      targetMtimeMs: st.mtimeMs,
    };
  } catch {
    return { ...link, exists: false, targetKind: 'unknown' };
  }
}

export async function resolveFileLinks(db: AppDatabase, parentPath: string): Promise<FileLinkResolved[]> {
  const links = listFileLinks(db, parentPath);
  return Promise.all(links.map(async (link) => {
    try {
      const st = await fsp.stat(link.targetPath);
      return {
        ...link,
        exists: true,
        targetKind: st.isDirectory() ? 'directory' as const : 'file' as const,
        targetSize: st.size,
        targetMtimeMs: st.mtimeMs,
      };
    } catch {
      return { ...link, exists: false, targetKind: 'unknown' as const };
    }
  }));
}

export function updateFileLink(db: AppDatabase, id: string, updates: { name?: string; targetPath?: string }): FileLink | null {
  const link = getFileLink(db, id);
  if (!link) return null;
  const now = Date.now();
  if (updates.name) link.name = updates.name;
  if (updates.targetPath) link.targetPath = updates.targetPath;
  link.updatedMs = now;
  db.run(
    'UPDATE file_links SET name = ?, target_path = ?, updated_ms = ? WHERE id = ?',
    [link.name, link.targetPath, link.updatedMs, link.id],
  );
  return link;
}

export function allFileLinks(db: AppDatabase): FileLink[] {
  return db.all<LinkRow>('SELECT id, name, target_path, parent_path, created_ms, updated_ms FROM file_links').map(rowToLink);
}
