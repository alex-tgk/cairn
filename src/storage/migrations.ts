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
  {
    name: "complete work tracking storage",
    version: 3,
    sql: `
      ALTER TABLE work_items
        ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1);
      ALTER TABLE work_items
        ADD COLUMN notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE work_item_events
        ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);

      UPDATE work_item_events AS current
      SET revision = (
        SELECT COUNT(*)
        FROM work_item_events AS prior
        WHERE prior.work_item_id = current.work_item_id
          AND (
            prior.created_at < current.created_at
            OR (prior.created_at = current.created_at AND prior.id <= current.id)
          )
      );

      UPDATE work_items
      SET revision = MAX(
        1,
        COALESCE(
          (
            SELECT MAX(event.revision)
            FROM work_item_events AS event
            WHERE event.work_item_id = work_items.id
          ),
          1
        )
      );

      CREATE UNIQUE INDEX work_items_project_identity_index
        ON work_items(project_id, id);
      CREATE UNIQUE INDEX work_item_events_item_revision_index
        ON work_item_events(work_item_id, revision);

      CREATE TABLE work_item_hierarchy (
        project_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(project_id, child_id),
        CHECK(child_id <> parent_id),
        FOREIGN KEY(project_id, child_id)
          REFERENCES work_items(project_id, id) ON DELETE CASCADE,
        FOREIGN KEY(project_id, parent_id)
          REFERENCES work_items(project_id, id) ON DELETE RESTRICT
      ) STRICT;

      CREATE INDEX work_item_hierarchy_parent_index
        ON work_item_hierarchy(project_id, parent_id, child_id);

      CREATE TABLE work_item_dependencies (
        project_id TEXT NOT NULL,
        blocked_id TEXT NOT NULL,
        blocker_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(project_id, blocked_id, blocker_id),
        CHECK(blocked_id <> blocker_id),
        FOREIGN KEY(project_id, blocked_id)
          REFERENCES work_items(project_id, id) ON DELETE CASCADE,
        FOREIGN KEY(project_id, blocker_id)
          REFERENCES work_items(project_id, id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX work_item_dependencies_blocker_index
        ON work_item_dependencies(project_id, blocker_id, blocked_id);

      CREATE TABLE work_item_labels (
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        label TEXT NOT NULL CHECK(length(trim(label)) > 0),
        created_at TEXT NOT NULL,
        PRIMARY KEY(project_id, work_item_id, label),
        FOREIGN KEY(project_id, work_item_id)
          REFERENCES work_items(project_id, id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX work_item_labels_label_index
        ON work_item_labels(project_id, label, work_item_id);

      CREATE TABLE work_item_comments (
        id INTEGER PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        author TEXT NOT NULL CHECK(length(trim(author)) > 0),
        body TEXT NOT NULL CHECK(length(trim(body)) > 0),
        created_at TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision >= 1),
        FOREIGN KEY(project_id, work_item_id)
          REFERENCES work_items(project_id, id) ON DELETE CASCADE,
        UNIQUE(work_item_id, revision)
      ) STRICT;

      CREATE INDEX work_item_comments_item_order_index
        ON work_item_comments(project_id, work_item_id, created_at, id);
    `,
  },
];
