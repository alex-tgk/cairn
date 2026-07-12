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
];
