export type Migration = Readonly<{
  name: string;
  sql: string;
  version: number;
}>;

export const MIGRATIONS: readonly Migration[] = [
  {
    name: "initialize Cairn storage",
    version: 1,
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX workspaces_project_id_index ON workspaces(project_id);

      CREATE TABLE search_entries (
        id INTEGER PRIMARY KEY,
        entity_kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        source_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(entity_kind, entity_id)
      ) STRICT;

      CREATE VIRTUAL TABLE search_entries_fts USING fts5(
        title,
        body,
        tags,
        content = 'search_entries',
        content_rowid = 'id'
      );

      CREATE TRIGGER search_entries_after_insert AFTER INSERT ON search_entries BEGIN
        INSERT INTO search_entries_fts(rowid, title, body, tags)
        VALUES (new.id, new.title, new.body, new.tags);
      END;

      CREATE TRIGGER search_entries_after_delete AFTER DELETE ON search_entries BEGIN
        INSERT INTO search_entries_fts(search_entries_fts, rowid, title, body, tags)
        VALUES ('delete', old.id, old.title, old.body, old.tags);
      END;

      CREATE TRIGGER search_entries_after_update AFTER UPDATE ON search_entries BEGIN
        INSERT INTO search_entries_fts(search_entries_fts, rowid, title, body, tags)
        VALUES ('delete', old.id, old.title, old.body, old.tags);
        INSERT INTO search_entries_fts(rowid, title, body, tags)
        VALUES (new.id, new.title, new.body, new.tags);
      END;
    `,
  },
  {
    name: "add work items and audit events",
    version: 2,
    sql: `
      CREATE TABLE work_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open'
          CHECK(status IN ('open', 'in_progress', 'closed')),
        priority INTEGER NOT NULL DEFAULT 2 CHECK(priority BETWEEN 0 AND 4),
        type TEXT NOT NULL DEFAULT 'task'
          CHECK(type IN ('task', 'bug', 'feature', 'epic', 'chore')),
        assignee TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        claimed_at TEXT,
        closed_at TEXT
      ) STRICT;

      CREATE INDEX work_items_project_order_index
        ON work_items(project_id, status, priority, created_at, id);

      CREATE TABLE work_item_events (
        id INTEGER PRIMARY KEY,
        work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX work_item_events_item_order_index
        ON work_item_events(work_item_id, created_at, id);
    `,
  },
];
