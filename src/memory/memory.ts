import { CursorDecodeError, decodeCursor, encodeCursor } from "../shared/cursor.ts";

export const MEMORY_TYPES = [
  "decision",
  "architecture",
  "discovery",
  "pattern",
  "bugfix",
  "config",
  "preference",
  "session_summary",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_SCOPES = ["project", "personal"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

const PERSONAL_DEFAULT_TYPES: ReadonlySet<MemoryType> = new Set(["preference"]);

/**
 * The default scope for a memory when the caller does not specify one.
 *
 * A `preference` is almost always a user-level fact that should follow the
 * user across every project, so it defaults to `personal`. Every other type
 * describes something about a specific codebase and defaults to `project`.
 * Callers can always override this by passing an explicit scope.
 */
export function defaultScopeForType(type: MemoryType): MemoryScope {
  return PERSONAL_DEFAULT_TYPES.has(type) ? "personal" : "project";
}

export type MemoryEventType =
  | "created"
  | "updated"
  | "pinned"
  | "unpinned"
  | "archived"
  | "unarchived";
export type MemoryEventPayload = Readonly<
  Record<string, string | number | null>
>;

export class MemoryValidationError extends Error {
  override readonly name = "MemoryValidationError";
}

export class MemoryConflictError extends Error {
  readonly code = "memory_conflict";
  override readonly name = "MemoryConflictError";

  constructor(
    readonly memoryId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number | null = null,
  ) {
    super(
      actualRevision === null
        ? `Memory changed after revision ${expectedRevision}: ${memoryId}`
        : `Memory revision conflict for ${memoryId}: expected ${expectedRevision}, found ${actualRevision}`,
    );
  }
}

export class MemoryRelationError extends Error {
  readonly code = "self_memory_relation";
  override readonly name = "MemoryRelationError";

  constructor(readonly memoryId: string) {
    super(`A memory cannot relate to itself: ${memoryId}`);
  }
}

export function normalizeMemoryRelation(
  firstId: string,
  secondId: string,
): readonly [string, string] {
  if (firstId === secondId) {
    throw new MemoryRelationError(firstId);
  }
  return firstId < secondId ? [firstId, secondId] : [secondId, firstId];
}

export class MemoryId {
  private constructor(private readonly value: string) {}

  static from(value: string): MemoryId {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new MemoryValidationError("Memory id must not be empty");
    }
    return new MemoryId(normalized);
  }

  toString(): string {
    return this.value;
  }
}

export class MemoryTitle {
  private constructor(private readonly value: string) {}

  static from(value: string): MemoryTitle {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new MemoryValidationError("Memory title must not be empty");
    }
    return new MemoryTitle(normalized);
  }

  toString(): string {
    return this.value;
  }
}

export function normalizeMemoryContent(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new MemoryValidationError("Memory content must not be empty");
  }
  return normalized;
}

export function normalizeMemoryTopic(
  value: string | undefined,
): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new MemoryValidationError("Memory topic must not be empty");
  }
  return normalized;
}

export function parseMemoryType(value: string): MemoryType {
  if ((MEMORY_TYPES as readonly string[]).includes(value)) {
    return value as MemoryType;
  }
  throw new MemoryValidationError(
    `Memory type must be one of: ${MEMORY_TYPES.join(", ")}`,
  );
}

export function parseMemoryScope(value: string): MemoryScope {
  if ((MEMORY_SCOPES as readonly string[]).includes(value)) {
    return value as MemoryScope;
  }
  throw new MemoryValidationError(
    `Memory scope must be one of: ${MEMORY_SCOPES.join(", ")}`,
  );
}

function decodeMemoryCursorPayload(token: string): Readonly<Record<string, unknown>> {
  try {
    return decodeCursor(token);
  } catch (error) {
    throw new MemoryValidationError(
      error instanceof CursorDecodeError ? error.message : "Invalid cursor",
    );
  }
}

function requireCursorString(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new MemoryValidationError(`Cursor ${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Opaque keyset-pagination cursor for `memory list`, matching
 * `listByProject`'s `ORDER BY created_at DESC, id DESC` and the trailing
 * `(created_at, id)` columns of the `memories_scope_project_archived_order_index`
 * (migration 7). Encoding the last row's sort-key tuple lets the next page
 * seek directly instead of re-scanning already-returned rows.
 */
export type MemoryListCursor = Readonly<{ createdAt: string; id: string }>;

export function encodeMemoryListCursor(cursor: MemoryListCursor): string {
  return encodeCursor(cursor);
}

export function decodeMemoryListCursor(token: string): MemoryListCursor {
  const payload = decodeMemoryCursorPayload(token);
  return {
    createdAt: requireCursorString(payload, "createdAt"),
    id: requireCursorString(payload, "id"),
  };
}

/**
 * Opaque keyset-pagination cursor for `memory search`. `search` orders by
 * FTS5's `bm25`-derived `rank` column first (`ORDER BY
 * search_entries_fts.rank, memories.created_at DESC, memories.id DESC`), so
 * the cursor must also carry the last row's `rank` value alongside the
 * `(created_at, id)` tie-breakers used by `memory list`.
 *
 * Caveat (documented rather than faked away): `rank` is a computed FTS5
 * value, not an indexed column, so seeking on it is deterministic — the
 * same query against the same data always reproduces the same `rank` for
 * the same row — but it is not an indexed keyset seek the way `memory
 * list`'s cursor is. Cairn still has to evaluate `rank` for every matching
 * row on each page rather than jumping straight to an index position. See
 * ADR 0011 for the full tradeoff.
 */
export type MemorySearchCursor = Readonly<{
  createdAt: string;
  id: string;
  rank: number;
}>;

export function encodeMemorySearchCursor(cursor: MemorySearchCursor): string {
  return encodeCursor(cursor);
}

export function decodeMemorySearchCursor(token: string): MemorySearchCursor {
  const payload = decodeMemoryCursorPayload(token);
  const rank = payload.rank;
  if (typeof rank !== "number" || !Number.isFinite(rank)) {
    throw new MemoryValidationError("Cursor rank must be a finite number");
  }
  return {
    createdAt: requireCursorString(payload, "createdAt"),
    id: requireCursorString(payload, "id"),
    rank,
  };
}

export type Memory = Readonly<{
  archived: boolean;
  content: string;
  createdAt: string;
  id: MemoryId;
  pinned: boolean;
  projectId: string | null;
  revision: number;
  scope: MemoryScope;
  title: MemoryTitle;
  topic: string | null;
  type: MemoryType;
  updatedAt: string;
}>;

export type MemoryEventDraft = Readonly<{
  createdAt: string;
  eventType: MemoryEventType;
  payload: MemoryEventPayload;
  revision: number;
}>;

export type MemoryEvent = MemoryEventDraft &
  Readonly<{
    id: number;
    memoryId: string;
  }>;

export type MemoryTransition = Readonly<{
  event: MemoryEventDraft;
  expectedRevision: number;
  memory: Memory;
}>;

type CreateMemoryInput = Readonly<{
  content: string;
  id: MemoryId;
  now: string;
  projectId: string | null;
  scope: MemoryScope;
  title: string;
  topic?: string | undefined;
  type: MemoryType;
}>;

export function createMemory(input: CreateMemoryInput): Memory {
  if (input.scope === "project" && input.projectId === null) {
    throw new MemoryValidationError(
      "Project-scoped memories require a project id",
    );
  }
  if (input.scope === "personal" && input.projectId !== null) {
    throw new MemoryValidationError(
      "Personal-scoped memories must not have a project id",
    );
  }
  return {
    archived: false,
    content: normalizeMemoryContent(input.content),
    createdAt: input.now,
    id: input.id,
    pinned: false,
    projectId: input.projectId,
    revision: 1,
    scope: input.scope,
    title: MemoryTitle.from(input.title),
    topic: normalizeMemoryTopic(input.topic),
    type: input.type,
    updatedAt: input.now,
  };
}

export function restoreMemory(memory: Memory): Memory {
  return memory;
}

export type MemoryUpsertFields = Readonly<{
  content: string;
  title: string;
  type: MemoryType;
}>;

export function upsertMemory(
  memory: Memory,
  fields: MemoryUpsertFields,
  now: string,
): MemoryTransition {
  const title = MemoryTitle.from(fields.title);
  const content = normalizeMemoryContent(fields.content);
  const revision = memory.revision + 1;
  return {
    event: {
      createdAt: now,
      eventType: "updated",
      payload: { content, title: title.toString(), type: fields.type },
      revision,
    },
    expectedRevision: memory.revision,
    memory: {
      ...memory,
      content,
      revision,
      title,
      type: fields.type,
      updatedAt: now,
    },
  };
}

export function setMemoryPinned(
  memory: Memory,
  pinned: boolean,
  now: string,
): MemoryTransition {
  const revision = memory.revision + 1;
  return {
    event: {
      createdAt: now,
      eventType: pinned ? "pinned" : "unpinned",
      payload: { pinned: pinned ? 1 : 0 },
      revision,
    },
    expectedRevision: memory.revision,
    memory: { ...memory, pinned, revision, updatedAt: now },
  };
}

export function setMemoryArchived(
  memory: Memory,
  archived: boolean,
  now: string,
): MemoryTransition {
  const revision = memory.revision + 1;
  return {
    event: {
      createdAt: now,
      eventType: archived ? "archived" : "unarchived",
      payload: { archived: archived ? 1 : 0 },
      revision,
    },
    expectedRevision: memory.revision,
    memory: { ...memory, archived, revision, updatedAt: now },
  };
}
