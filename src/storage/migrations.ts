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
  {
    name: "add incremental context indexing",
    version: 4,
    sql: `
      CREATE TABLE context_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        kind TEXT NOT NULL,
        root_relative_path TEXT NOT NULL,
        include_json TEXT NOT NULL,
        exclude_json TEXT NOT NULL,
        max_file_bytes INTEGER NOT NULL CHECK(max_file_bytes > 0),
        config_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, name)
      ) STRICT;

      CREATE INDEX context_sources_project_index
        ON context_sources(project_id, name, id);

      CREATE TABLE context_documents (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL
          REFERENCES context_sources(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL
          REFERENCES workspaces(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        content_hash TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        first_indexed_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, workspace_id, relative_path)
      ) STRICT;

      CREATE INDEX context_documents_project_workspace_active_index
        ON context_documents(
          project_id, workspace_id, active, relative_path, id
        );

      CREATE INDEX context_documents_source_workspace_path_index
        ON context_documents(source_id, workspace_id, relative_path);

      CREATE TABLE context_document_versions (
        id INTEGER PRIMARY KEY,
        document_id TEXT NOT NULL
          REFERENCES context_documents(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
        indexed_at TEXT NOT NULL,
        UNIQUE(document_id, content_hash)
      ) STRICT;

      CREATE INDEX context_document_versions_document_time_index
        ON context_document_versions(document_id, indexed_at, id);

      CREATE TABLE context_index_runs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL
          REFERENCES context_sources(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL
          REFERENCES workspaces(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK(mode IN ('refresh', 'rebuild')),
        status TEXT NOT NULL
          CHECK(status IN ('running', 'succeeded', 'failed', 'partial')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        discovered_count INTEGER NOT NULL DEFAULT 0
          CHECK(discovered_count >= 0),
        added_count INTEGER NOT NULL DEFAULT 0 CHECK(added_count >= 0),
        updated_count INTEGER NOT NULL DEFAULT 0 CHECK(updated_count >= 0),
        unchanged_count INTEGER NOT NULL DEFAULT 0
          CHECK(unchanged_count >= 0),
        removed_count INTEGER NOT NULL DEFAULT 0 CHECK(removed_count >= 0),
        skipped_count INTEGER NOT NULL DEFAULT 0 CHECK(skipped_count >= 0),
        error_count INTEGER NOT NULL DEFAULT 0 CHECK(error_count >= 0),
        error_json TEXT NOT NULL DEFAULT '[]'
      ) STRICT;

      CREATE INDEX context_index_runs_source_workspace_time_index
        ON context_index_runs(
          source_id, workspace_id, started_at DESC, id DESC
        );

      DROP TRIGGER search_entries_after_insert;
      DROP TRIGGER search_entries_after_delete;
      DROP TRIGGER search_entries_after_update;
      DROP TABLE search_entries_fts;

      CREATE VIRTUAL TABLE search_entries_fts USING fts5(
        title,
        body,
        tags,
        source_path,
        content = 'search_entries',
        content_rowid = 'id'
      );

      CREATE TRIGGER search_entries_after_insert AFTER INSERT ON search_entries BEGIN
        INSERT INTO search_entries_fts(rowid, title, body, tags, source_path)
        VALUES (new.id, new.title, new.body, new.tags, new.source_path);
      END;

      CREATE TRIGGER search_entries_after_delete AFTER DELETE ON search_entries BEGIN
        INSERT INTO search_entries_fts(
          search_entries_fts, rowid, title, body, tags, source_path
        ) VALUES (
          'delete', old.id, old.title, old.body, old.tags, old.source_path
        );
      END;

      CREATE TRIGGER search_entries_after_update AFTER UPDATE ON search_entries BEGIN
        INSERT INTO search_entries_fts(
          search_entries_fts, rowid, title, body, tags, source_path
        ) VALUES (
          'delete', old.id, old.title, old.body, old.tags, old.source_path
        );
        INSERT INTO search_entries_fts(rowid, title, body, tags, source_path)
        VALUES (new.id, new.title, new.body, new.tags, new.source_path);
      END;

      INSERT INTO search_entries_fts(search_entries_fts) VALUES ('rebuild');
    `,
  },
  {
    name: "add durable memory storage",
    version: 5,
    sql: `
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK(scope IN ('project', 'personal')),
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN (
          'decision', 'architecture', 'discovery', 'pattern',
          'bugfix', 'config', 'preference', 'session_summary'
        )),
        topic TEXT,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        content TEXT NOT NULL CHECK(length(trim(content)) > 0),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(
          (scope = 'project' AND project_id IS NOT NULL)
          OR (scope = 'personal' AND project_id IS NULL)
        )
      ) STRICT;

      CREATE UNIQUE INDEX memories_topic_scope_index
        ON memories(scope, COALESCE(project_id, ''), topic)
        WHERE topic IS NOT NULL;

      CREATE INDEX memories_scope_project_order_index
        ON memories(scope, project_id, type, created_at, id);

      CREATE TABLE memory_events (
        id INTEGER PRIMARY KEY,
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        revision INTEGER NOT NULL CHECK(revision >= 1),
        created_at TEXT NOT NULL,
        UNIQUE(memory_id, revision)
      ) STRICT;

      CREATE INDEX memory_events_memory_order_index
        ON memory_events(memory_id, created_at, id);
    `,
  },
  {
    name: "add memory relations",
    version: 6,
    sql: `
      CREATE TABLE memory_relations (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        related_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(memory_id, related_memory_id),
        CHECK(memory_id < related_memory_id)
      ) STRICT;

      CREATE INDEX memory_relations_related_index
        ON memory_relations(related_memory_id, memory_id);
    `,
  },
  {
    name: "add memory pin and archive state",
    version: 7,
    sql: `
      ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1));
      ALTER TABLE memories ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1));

      CREATE INDEX memories_scope_project_archived_order_index
        ON memories(scope, project_id, archived, created_at, id);
    `,
  },
  {
    name: "reclassify existing preference memories to personal scope",
    version: 8,
    sql: `
      -- Preferences are user-level facts that should follow the user across
      -- every project. Earlier memories defaulted every type to project scope,
      -- so pre-existing preferences are stranded under a single project. This
      -- one-time correction re-scopes them to personal, matching the new
      -- type-based default. It is deliberately a controlled data migration,
      -- not a user-facing scope change: scope remains immutable from the CLI.

      -- Record the correction in the audit trail before mutating, using each
      -- memory's own updated_at so the migration stays deterministic.
      INSERT INTO memory_events (memory_id, event_type, payload_json, revision, created_at)
      SELECT id, 'updated', '{"scope":"personal"}', revision + 1, updated_at
      FROM memories
      WHERE type = 'preference' AND scope = 'project';

      UPDATE memories
      SET scope = 'personal',
          project_id = NULL,
          revision = revision + 1
      WHERE type = 'preference' AND scope = 'project';

      -- Keep the shared search projection consistent: scope is encoded in the
      -- tag string ('<type> <scope> [topic]') and in project_id. Target rows by
      -- their current tag prefix so already-personal preferences are untouched
      -- and the update is order-independent. The FTS mirror updates via trigger.
      UPDATE search_entries
      SET project_id = NULL,
          tags = 'preference personal' || substr(tags, length('preference project') + 1)
      WHERE entity_kind = 'memory' AND tags LIKE 'preference project%';
    `,
  },
];
