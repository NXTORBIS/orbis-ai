import type { AppDatabase } from '../store/Database';
import { randomUUID } from 'crypto';

export class UniverseStore {
  constructor(private db: AppDatabase) {}

  // Maps
  saveMap(data: { name: string; scanId?: string; root: string; layout: string; lens?: string; viewport?: string }) {
    const id = randomUUID();
    const now = Date.now();
    this.db.run(
      'INSERT INTO universe_maps (id, name, scan_id, root, layout, lens, viewport, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, data.name, data.scanId || null, data.root, data.layout, data.lens || 'structure', data.viewport || '{}', now, now]
    );
    return id;
  }

  updateMap(id: string, data: { name?: string; layout?: string; lens?: string; viewport?: string }) {
    const sets: string[] = ['updated_ms = ?'];
    const params: any[] = [Date.now()];
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.layout !== undefined) { sets.push('layout = ?'); params.push(data.layout); }
    if (data.lens !== undefined) { sets.push('lens = ?'); params.push(data.lens); }
    if (data.viewport !== undefined) { sets.push('viewport = ?'); params.push(data.viewport); }
    params.push(id);
    this.db.run(`UPDATE universe_maps SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  listMaps() {
    return this.db.all<any>('SELECT * FROM universe_maps ORDER BY updated_ms DESC');
  }

  getMap(id: string) {
    return this.db.get<any>('SELECT * FROM universe_maps WHERE id = ?', [id]) ?? null;
  }

  deleteMap(id: string) {
    this.db.run('DELETE FROM universe_maps WHERE id = ?', [id]);
  }

  // Annotations
  annotate(data: { path: string; note: string; color?: string; icon?: string }) {
    const id = randomUUID();
    const now = Date.now();
    this.db.run(
      'INSERT INTO universe_annotations (id, path, note, color, icon, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, data.path, data.note, data.color || null, data.icon || null, now, now]
    );
    return id;
  }

  updateAnnotation(id: string, data: { note?: string; color?: string; icon?: string }) {
    const sets: string[] = ['updated_ms = ?'];
    const params: any[] = [Date.now()];
    if (data.note !== undefined) { sets.push('note = ?'); params.push(data.note); }
    if (data.color !== undefined) { sets.push('color = ?'); params.push(data.color); }
    if (data.icon !== undefined) { sets.push('icon = ?'); params.push(data.icon); }
    params.push(id);
    this.db.run(`UPDATE universe_annotations SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  deleteAnnotation(id: string) {
    this.db.run('DELETE FROM universe_annotations WHERE id = ?', [id]);
  }

  listAnnotations(forPath?: string) {
    let sql = 'SELECT * FROM universe_annotations';
    const params: any[] = [];
    if (forPath) { sql += ' WHERE path = ?'; params.push(forPath); }
    sql += ' ORDER BY updated_ms DESC';
    return this.db.all<any>(sql, params);
  }

  // Portals
  createPortal(data: { name: string; location: string; icon?: string }) {
    const id = randomUUID();
    const row = this.db.get<{ m: number | null }>('SELECT MAX(position) as m FROM universe_portals');
    const pos = row?.m != null ? row.m + 1 : 0;
    this.db.run(
      'INSERT INTO universe_portals (id, name, location, icon, position, created_ms) VALUES (?, ?, ?, ?, ?, ?)',
      [id, data.name, data.location, data.icon || null, pos, Date.now()]
    );
    return id;
  }

  listPortals() {
    return this.db.all<any>('SELECT * FROM universe_portals ORDER BY position');
  }

  deletePortal(id: string) {
    this.db.run('DELETE FROM universe_portals WHERE id = ?', [id]);
  }

  reorderPortals(ids: string[]) {
    ids.forEach((id, i) => this.db.run('UPDATE universe_portals SET position = ? WHERE id = ?', [i, id]));
  }

  // Checkpoints
  createCheckpoint(data: { mapId: string; name: string; state: string }) {
    const id = randomUUID();
    this.db.run(
      'INSERT INTO universe_checkpoints (id, map_id, name, state, created_ms) VALUES (?, ?, ?, ?, ?)',
      [id, data.mapId, data.name, data.state, Date.now()]
    );
    return id;
  }

  listCheckpoints(mapId: string) {
    return this.db.all<any>('SELECT * FROM universe_checkpoints WHERE map_id = ? ORDER BY created_ms DESC', [mapId]);
  }

  getCheckpoint(id: string) {
    return this.db.get<any>('SELECT * FROM universe_checkpoints WHERE id = ?', [id]) ?? null;
  }

  deleteCheckpoint(id: string) {
    this.db.run('DELETE FROM universe_checkpoints WHERE id = ?', [id]);
  }
}
