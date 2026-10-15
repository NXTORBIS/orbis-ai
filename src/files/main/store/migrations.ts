import type { Database } from 'sql.js';

/**
 * Ordered, append-only schema migrations. Never edit a released migration;
 * add a new one. Each runs inside a transaction.
 */
export interface Migration {
  version: number;
  description: string;
  up(db: Database): void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Core: settings, pins, recents, catalogue items, tags, collections, sessions, operations',
    up(db) {
      db.exec(`
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE pins (path TEXT PRIMARY KEY, label TEXT, position INTEGER NOT NULL, created_ms INTEGER NOT NULL);
        CREATE TABLE recents (path TEXT PRIMARY KEY, kind TEXT NOT NULL, last_ms INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX recents_last ON recents(last_ms DESC);

        -- Catalogue entries describe files; they are not the files. 'missing' is set
        -- when revalidation can no longer find the target.
        CREATE TABLE items (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL,
          dev REAL, ino REAL, size REAL, mtime_ms REAL,
          description TEXT, rating INTEGER,
          source TEXT NOT NULL DEFAULT 'filesystem',
          missing INTEGER NOT NULL DEFAULT 0,
          created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL
        );
        CREATE INDEX items_devino ON items(dev, ino);

        CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, color TEXT, created_ms INTEGER NOT NULL);
        CREATE TABLE item_tags (
          item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (item_id, tag_id)
        );
        CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_ms INTEGER NOT NULL);
        CREATE TABLE collection_items (
          id TEXT PRIMARY KEY,
          collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          added_ms INTEGER NOT NULL,
          UNIQUE(collection_id, item_id)
        );
        CREATE TABLE saved_searches (id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL, scope TEXT NOT NULL, created_ms INTEGER NOT NULL);
        CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, updated_ms INTEGER NOT NULL);
        CREATE TABLE operations (id TEXT PRIMARY KEY, type TEXT NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL, updated_ms INTEGER NOT NULL);
      `);
    },
  },
  {
    version: 2,
    description: 'Library sources, local search index, rules, snapshots, AI audit',
    up(db) {
      db.exec(`
        CREATE TABLE downloads (
          id TEXT PRIMARY KEY, path TEXT NOT NULL, url TEXT, referrer TEXT, mime TEXT,
          state TEXT NOT NULL, browser TEXT NOT NULL, started_ms INTEGER, finished_ms INTEGER,
          source TEXT NOT NULL, registered_ms INTEGER NOT NULL
        );
        CREATE INDEX downloads_path ON downloads(path);
        CREATE TABLE generated (
          id TEXT PRIMARY KEY, path TEXT NOT NULL, generator TEXT NOT NULL, chat_id TEXT, prompt TEXT,
          created_ms INTEGER NOT NULL, registered_ms INTEGER NOT NULL
        );
        CREATE TABLE index_roots (path TEXT PRIMARY KEY, added_ms INTEGER NOT NULL, last_full_scan_ms INTEGER, last_error TEXT);
        CREATE TABLE index_entries (
          path TEXT PRIMARY KEY, root TEXT NOT NULL, parent TEXT NOT NULL, name TEXT NOT NULL, name_lc TEXT NOT NULL,
          ext TEXT NOT NULL, kind TEXT NOT NULL, size REAL, mtime_ms REAL, ctime_ms REAL, content TEXT
        );
        CREATE INDEX index_entries_root ON index_entries(root);
        CREATE INDEX index_entries_name ON index_entries(name_lc);
        CREATE INDEX index_entries_parent ON index_entries(parent);
        CREATE TABLE rules (id TEXT PRIMARY KEY, definition TEXT NOT NULL, updated_ms INTEGER NOT NULL);
        CREATE TABLE rule_runs (id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, ran_ms INTEGER NOT NULL, result TEXT NOT NULL);
        CREATE TABLE snapshots (id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL, created_ms INTEGER NOT NULL, storage_path TEXT, manifest TEXT NOT NULL, bytes REAL NOT NULL);
        CREATE TABLE ai_audit (
          id TEXT PRIMARY KEY, task_id TEXT NOT NULL, ms INTEGER NOT NULL, event TEXT NOT NULL,
          kind TEXT, refs TEXT, detail TEXT
        );
        CREATE INDEX ai_audit_ms ON ai_audit(ms DESC);
      `);
    },
  },
  {
    version: 3,
    description: 'Stronger item identity: birth time and detached (orphaned) references',
    up(db) {
      db.exec(`
        ALTER TABLE items ADD COLUMN birth_ms REAL;
        ALTER TABLE items ADD COLUMN last_path TEXT;
      `);
    },
  },
  {
    version: 4,
    description: 'Projects (detected or user-defined) with file associations, and storage-scan history',
    up(db) {
      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL, kind TEXT NOT NULL,
          markers TEXT NOT NULL, created_ms INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX projects_root ON projects(root);
        CREATE TABLE project_items (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          added_ms INTEGER NOT NULL,
          PRIMARY KEY (project_id, item_id)
        );
        CREATE TABLE storage_history (
          id TEXT PRIMARY KEY, root TEXT NOT NULL, ms INTEGER NOT NULL, bytes REAL NOT NULL,
          files INTEGER NOT NULL, directories INTEGER NOT NULL, complete INTEGER NOT NULL, by_category TEXT NOT NULL
        );
        CREATE INDEX storage_history_root ON storage_history(root, ms DESC);
      `);
    },
  },
  {
    version: 5,
    description: 'Customization engine: active configuration, last known-good copy and backups',
    up(db) {
      db.exec(`
        CREATE TABLE customization_state (
          slot TEXT PRIMARY KEY, json TEXT NOT NULL, saved_ms INTEGER NOT NULL, label TEXT
        );
      `);
    },
  },
  {
    version: 6,
    description: 'Stored SHA-256 checksums, valid only while the file keeps the same size and modification time',
    up(db) {
      db.exec(`
        CREATE TABLE checksums (
          path TEXT NOT NULL, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL, sha256 TEXT NOT NULL, computed_ms INTEGER NOT NULL,
          PRIMARY KEY (path)
        );
        CREATE INDEX checksums_computed ON checksums(computed_ms);
      `);
    },
  },
  {
    version: 7,
    description: 'Folder synchronization: saved sync pairs and two-way baselines',
    // Self-contained (creates only its own tables, IF NOT EXISTS) so it can be renumbered when branches merge.
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_pairs (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, left_path TEXT NOT NULL, right_path TEXT NOT NULL,
          mode TEXT NOT NULL, options TEXT NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
          last_run_ms INTEGER, last_summary TEXT
        );
        CREATE TABLE IF NOT EXISTS sync_baselines (
          pair_key TEXT NOT NULL, rel TEXT NOT NULL, kind TEXT NOT NULL, size REAL,
          left_mtime_ms REAL NOT NULL, right_mtime_ms REAL NOT NULL, sha256 TEXT, link_target TEXT,
          PRIMARY KEY (pair_key, rel)
        );
        CREATE TABLE IF NOT EXISTS sync_baseline_info (
          pair_key TEXT PRIMARY KEY, left_path TEXT NOT NULL, right_path TEXT NOT NULL,
          entries INTEGER NOT NULL, updated_ms INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 8,
    description: 'Backups with versions and schedules: backup jobs, their activity log, and schedules of saved sync pairs',
    // Self-contained (creates only its own tables, IF NOT EXISTS) so it can be renumbered when branches merge.
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS backup_jobs (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, sources TEXT NOT NULL, destination TEXT NOT NULL, store_path TEXT NOT NULL,
          options TEXT NOT NULL, retention TEXT NOT NULL, schedule TEXT NOT NULL, schedule_since_ms INTEGER NOT NULL,
          created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, last_run_ms INTEGER, last_result TEXT
        );
        CREATE TABLE IF NOT EXISTS backup_activity (
          id TEXT PRIMARY KEY, job_id TEXT NOT NULL, ms INTEGER NOT NULL, kind TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS backup_activity_job ON backup_activity(job_id, ms DESC);
        CREATE TABLE IF NOT EXISTS sync_schedules (
          pair_id TEXT PRIMARY KEY, schedule TEXT NOT NULL, since_ms INTEGER NOT NULL, max_deletes INTEGER NOT NULL,
          approved TEXT, last_run_ms INTEGER, last_result TEXT, updated_ms INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 9,
    description: 'Download manager: queued, active and completed URL downloads with progress, checksums and history',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS download_queue (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          file_path TEXT NOT NULL,
          destination TEXT NOT NULL,
          filename TEXT NOT NULL,
          state TEXT NOT NULL,
          mime_type TEXT,
          total_bytes REAL,
          bytes_downloaded REAL NOT NULL DEFAULT 0,
          resumable INTEGER NOT NULL DEFAULT 0,
          retries INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          priority INTEGER NOT NULL DEFAULT 100,
          checksum_algorithm TEXT,
          checksum_expected TEXT,
          checksum_result TEXT,
          checksum_actual TEXT,
          auto_extract INTEGER NOT NULL DEFAULT 0,
          extracted_to TEXT,
          speed_limit_kbs INTEGER NOT NULL DEFAULT 0,
          created_ms INTEGER NOT NULL,
          started_ms INTEGER,
          finished_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS download_queue_state ON download_queue(state);
        CREATE INDEX IF NOT EXISTS download_queue_created ON download_queue(created_ms DESC);
      `);
    },
  },
  {
    version: 10,
    description: 'Smart folders (virtual folders from tag/extension/size/date queries) and pinned clipboard entries',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS smart_folders (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT,
          color TEXT,
          query TEXT NOT NULL,
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clip_pins (
          id TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          paths TEXT NOT NULL,
          label TEXT,
          pinned_ms INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 11,
    description: 'File annotations: persistent notes attached to files',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_notes (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          note TEXT NOT NULL,
          color TEXT,
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS file_notes_path ON file_notes(path);
      `);
    },
  },
  {
    version: 12,
    description: 'Snippet library: saved text/code snippets with tags',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS snippets (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS snippets_updated ON snippets(updated_ms DESC);
      `);
    },
  },
  {
    version: 13,
    description: 'Color tags: colour labels for files and folders with tag management',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS color_tags (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          hex TEXT NOT NULL,
          created_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS file_color_tags (
          path TEXT NOT NULL,
          tag_id TEXT NOT NULL REFERENCES color_tags(id) ON DELETE CASCADE,
          PRIMARY KEY (path, tag_id)
        );
        CREATE INDEX IF NOT EXISTS file_color_tags_tag ON file_color_tags(tag_id);
      `);
    },
  },
  {
    version: 14,
    description: 'Bookmarks / favorites bar: pinned files and folders with drag-to-reorder',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bookmarks (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          label TEXT NOT NULL,
          kind TEXT NOT NULL,
          position INTEGER NOT NULL,
          created_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bookmarks_position ON bookmarks(position);
      `);
    },
  },
  {
    version: 15,
    description: 'Advanced Recycle Bin: soft-delete with restore, permanent delete and auto-purge',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS recycle_bin (
          id TEXT PRIMARY KEY,
          original_path TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          size REAL NOT NULL DEFAULT 0,
          deleted_ms INTEGER NOT NULL,
          storage_path TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS recycle_bin_deleted ON recycle_bin(deleted_ms DESC);
      `);
    },
  },
  {
    version: 16,
    description: 'Virtual workspaces (spaces) and recent files panel',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS spaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          folders TEXT NOT NULL,
          sort_key TEXT,
          sort_dir TEXT,
          view_mode TEXT,
          tab_state TEXT,
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS recent_files (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          ext TEXT NOT NULL DEFAULT '',
          pinned INTEGER NOT NULL DEFAULT 0,
          last_access_ms INTEGER NOT NULL,
          access_count INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS recent_files_access ON recent_files(last_access_ms DESC);
        CREATE INDEX IF NOT EXISTS recent_files_pinned ON recent_files(pinned DESC, last_access_ms DESC);
      `);
    },
  },
  {
    version: 17,
    description: 'File links (aliases): soft references pointing to files or folders elsewhere',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_links (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          target_path TEXT NOT NULL,
          parent_path TEXT NOT NULL,
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS file_links_parent ON file_links(parent_path);
        CREATE INDEX IF NOT EXISTS file_links_target ON file_links(target_path);
      `);
    },
  },
  {
    version: 18,
    description: 'Cloud storage profiles and clipboard history pinned items',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cloud_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          protocol TEXT NOT NULL,
          host TEXT NOT NULL,
          port INTEGER NOT NULL,
          username TEXT NOT NULL DEFAULT '',
          base_path TEXT NOT NULL DEFAULT '/',
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clip_history_pins (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          preview TEXT NOT NULL DEFAULT '',
          content TEXT,
          paths TEXT,
          thumbnail TEXT,
          copied_ms INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 19,
    description: 'Macro recorder, folder watcher and file version history',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS macros (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          steps TEXT NOT NULL,
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS macros_updated ON macros(updated_ms DESC);

        CREATE TABLE IF NOT EXISTS folder_watches (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          rule TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS folder_watches_path ON folder_watches(path);

        CREATE TABLE IF NOT EXISTS file_versions (
          id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL,
          version_number INTEGER NOT NULL,
          size_bytes REAL NOT NULL,
          hash TEXT NOT NULL,
          created_ms INTEGER NOT NULL,
          label TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS file_versions_path ON file_versions(file_path, version_number DESC);
      `);
    },
  },
  {
    version: 20,
    description: 'Universe Core: scans, entries, relations, maps, annotations, portals, checkpoints',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS universe_scans (
          id TEXT PRIMARY KEY,
          root TEXT NOT NULL,
          started_ms INTEGER NOT NULL,
          finished_ms INTEGER,
          total_entries INTEGER NOT NULL DEFAULT 0,
          total_bytes REAL NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'running',
          options TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS universe_entries (
          path TEXT NOT NULL,
          scan_id TEXT NOT NULL REFERENCES universe_scans(id) ON DELETE CASCADE,
          parent TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          size REAL NOT NULL DEFAULT 0,
          depth INTEGER NOT NULL DEFAULT 0,
          mtime_ms REAL,
          ctime_ms REAL,
          ext TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'other',
          PRIMARY KEY (scan_id, path)
        );
        CREATE INDEX IF NOT EXISTS universe_entries_parent ON universe_entries(scan_id, parent);
        CREATE INDEX IF NOT EXISTS universe_entries_cat ON universe_entries(scan_id, category);
        CREATE INDEX IF NOT EXISTS universe_entries_size ON universe_entries(scan_id, size DESC);

        CREATE TABLE IF NOT EXISTS universe_relations (
          id TEXT PRIMARY KEY,
          scan_id TEXT NOT NULL,
          source_path TEXT NOT NULL,
          target_path TEXT NOT NULL,
          kind TEXT NOT NULL,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS universe_relations_source ON universe_relations(scan_id, source_path);
        CREATE INDEX IF NOT EXISTS universe_relations_target ON universe_relations(scan_id, target_path);

        CREATE TABLE IF NOT EXISTS universe_maps (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          scan_id TEXT,
          root TEXT NOT NULL,
          layout TEXT NOT NULL,
          lens TEXT NOT NULL DEFAULT 'structure',
          viewport TEXT NOT NULL DEFAULT '{}',
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS universe_annotations (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          note TEXT NOT NULL,
          color TEXT,
          icon TEXT,
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS universe_annotations_path ON universe_annotations(path);

        CREATE TABLE IF NOT EXISTS universe_portals (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          location TEXT NOT NULL,
          icon TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          created_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS universe_checkpoints (
          id TEXT PRIMARY KEY,
          map_id TEXT NOT NULL REFERENCES universe_maps(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          state TEXT NOT NULL,
          created_ms INTEGER NOT NULL
        );
      `);
    },
  },
];

/** Prefix for the path of a catalogue item whose file can no longer be identified. Never a real path. */
export const ORPHAN_PREFIX = 'orphan:';
