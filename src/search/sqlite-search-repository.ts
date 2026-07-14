import { sql } from "kysely";

import type { CairnQueryDatabase } from "../storage/query-database.ts";
import type {
  SearchEntityKind,
  UnifiedSearchInput,
  UnifiedSearchMatch,
  UnifiedSearchRepository,
} from "./search-repository.ts";

type UnifiedSearchRow = Readonly<{
  body: string;
  entity_id: string;
  entity_kind: SearchEntityKind;
  project_id: string;
  source_path: string | null;
  tags: string;
  title: string;
  workspace_id: string | null;
}>;

const SNIPPET_MARKER_START = "»";
const SNIPPET_MARKER_END = "«";
const SNIPPET_RADIUS = 60;

function buildFixedMarkerSnippet(
  body: string,
  terms: readonly string[],
): string {
  const lowerBody = body.toLowerCase();
  let matchIndex = -1;
  let matchLength = 0;
  for (const term of terms) {
    const index = lowerBody.indexOf(term.toLowerCase());
    if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
      matchLength = term.length;
    }
  }

  if (matchIndex === -1) {
    return body.slice(0, SNIPPET_RADIUS * 2).trim();
  }

  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(
    body.length,
    matchIndex + matchLength + SNIPPET_RADIUS,
  );
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, matchIndex)}${SNIPPET_MARKER_START}${body.slice(
    matchIndex,
    matchIndex + matchLength,
  )}${SNIPPET_MARKER_END}${body.slice(matchIndex + matchLength, end)}${suffix}`;
}

function mapSearchMatch(
  row: UnifiedSearchRow,
  terms: readonly string[],
): UnifiedSearchMatch {
  const tags = row.tags.split(" ").filter((tag) => tag.length > 0);
  const haystack =
    `${row.title} ${row.body} ${row.tags} ${row.source_path ?? ""}`.toLowerCase();
  const matchedTerms = terms.filter((term) =>
    haystack.includes(term.toLowerCase()),
  );

  return {
    entityId: row.entity_id,
    entityKind: row.entity_kind,
    matchedTerms,
    projectId: row.project_id,
    snippet: buildFixedMarkerSnippet(row.body, terms),
    sourcePath: row.source_path,
    tags,
    title: row.title,
    workspaceId: row.workspace_id,
  };
}

export class SqliteSearchRepository implements UnifiedSearchRepository {
  constructor(private readonly database: CairnQueryDatabase) {}

  async search(
    input: UnifiedSearchInput,
  ): Promise<readonly UnifiedSearchMatch[]> {
    if (input.scopes.length === 0) {
      return [];
    }

    // Work items and memories are project-scoped (their search_entries row has
    // a null workspace_id); context documents are workspace-scoped. Matching
    // either the exact workspace or a null workspace_id lets one scope pair
    // cover every entity kind without per-kind scope logic.
    const scopeClauses = input.scopes.map(
      (scope) =>
        sql`(search_entries.project_id = ${scope.projectId} AND (search_entries.workspace_id = ${scope.workspaceId} OR search_entries.workspace_id IS NULL))`,
    );
    const scopeCondition = sql.join(scopeClauses, sql` OR `);

    const kindCondition =
      input.kinds === undefined || input.kinds.length === 0
        ? sql`1 = 1`
        : sql`search_entries.entity_kind IN (${sql.join(
            input.kinds.map((kind) => sql`${kind}`),
          )})`;

    const rows = await sql<UnifiedSearchRow>`
      SELECT
        search_entries.entity_kind AS entity_kind,
        search_entries.entity_id AS entity_id,
        search_entries.project_id AS project_id,
        search_entries.workspace_id AS workspace_id,
        search_entries.title AS title,
        search_entries.tags AS tags,
        search_entries.body AS body,
        search_entries.source_path AS source_path
      FROM search_entries_fts
      JOIN search_entries ON search_entries.id = search_entries_fts.rowid
      WHERE search_entries_fts MATCH ${input.ftsQuery}
        AND (${kindCondition})
        AND (${scopeCondition})
      ORDER BY
        bm25(search_entries_fts, 10.0, 1.0, 5.0, 4.0),
        search_entries.title ASC,
        search_entries.source_path ASC,
        search_entries.entity_id ASC
      LIMIT ${input.limit}
    `.execute(this.database.queries);

    return rows.rows.map((row) => mapSearchMatch(row, input.terms));
  }
}
