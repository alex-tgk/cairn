import { randomUUID } from "node:crypto";

import { ensureProjectInitialized } from "../project/project-service.ts";
import { openCairnDatabase } from "../storage/database.ts";
import { CairnQueryDatabase } from "../storage/query-database.ts";
import {
  createMemory,
  setMemoryArchived,
  setMemoryPinned,
  upsertMemory,
  MemoryId,
  type Memory,
  type MemoryScope,
  type MemoryType,
} from "./memory.ts";
import type { MemoryFilter, MemoryRepository } from "./memory-repository.ts";
import { SqliteMemoryRepository } from "./sqlite-memory-repository.ts";

export type MemoryView = Readonly<{
  archived: boolean;
  content: string;
  createdAt: string;
  id: string;
  pinned: boolean;
  projectId: string | null;
  revision: number;
  scope: MemoryScope;
  shortId: string;
  title: string;
  topic: string | null;
  type: MemoryType;
  updatedAt: string;
}>;

type MemoryContextOptions = Readonly<{
  dataDirectory?: string;
  path: string;
}>;

type SaveMemoryOptions = MemoryContextOptions &
  Readonly<{
    content: string;
    idFactory?: (() => string) | undefined;
    now?: (() => string) | undefined;
    scope?: MemoryScope | undefined;
    title: string;
    topic?: string | undefined;
    type: MemoryType;
  }>;

type ShowMemoryOptions = MemoryContextOptions & Readonly<{ id: string }>;

type RelateMemoryOptions = MemoryContextOptions &
  Readonly<{ id: string; now?: (() => string) | undefined; relatedId: string }>;

type TimelineMemoryOptions = MemoryContextOptions &
  Readonly<{ after?: number | undefined; before?: number | undefined; id: string }>;

export type MemoryTimelineView = Readonly<{
  after: readonly MemoryView[];
  before: readonly MemoryView[];
  target: MemoryView;
}>;

type ListMemoryOptions = MemoryContextOptions &
  Readonly<{
    includeArchived?: boolean | undefined;
    limit?: number | undefined;
    scope?: MemoryScope | undefined;
    topic?: string | undefined;
    type?: MemoryType | undefined;
  }>;

type SearchMemoryOptions = ListMemoryOptions & Readonly<{ query: string }>;

type LifecycleMemoryOptions = MemoryContextOptions &
  Readonly<{ id: string; now?: (() => string) | undefined }>;

type SessionSummariesOptions = MemoryContextOptions &
  Readonly<{ limit?: number | undefined; scope?: MemoryScope | undefined }>;

type ContextPrimerOptions = MemoryContextOptions &
  Readonly<{ recentLimit?: number | undefined }>;

export type ContextPrimerView = Readonly<{
  pinnedMemories: readonly MemoryView[];
  recentMemories: readonly MemoryView[];
  recentSessionSummary: MemoryView | null;
}>;

export class MemoryNotFoundError extends Error {
  readonly code = "memory_not_found";
  override readonly name = "MemoryNotFoundError";

  constructor(readonly reference: string) {
    super(`Memory not found: ${reference}`);
  }
}

export class MemoryAmbiguousReferenceError extends Error {
  readonly code = "ambiguous_memory_reference";
  override readonly name = "MemoryAmbiguousReferenceError";

  constructor(
    readonly reference: string,
    readonly candidateIds: readonly string[],
  ) {
    super(`Ambiguous memory reference: ${reference}`);
  }
}

function resolveMemoryProject(options: MemoryContextOptions) {
  if (options.dataDirectory === undefined) {
    return ensureProjectInitialized({ path: options.path });
  }
  return ensureProjectInitialized({
    dataDirectory: options.dataDirectory,
    path: options.path,
  });
}

function toMemoryView(memory: Memory): MemoryView {
  const id = memory.id.toString();
  return {
    archived: memory.archived,
    content: memory.content,
    createdAt: memory.createdAt,
    id,
    pinned: memory.pinned,
    projectId: memory.projectId,
    revision: memory.revision,
    scope: memory.scope,
    shortId: id.replaceAll("-", "").slice(0, 8),
    title: memory.title.toString(),
    topic: memory.topic,
    type: memory.type,
    updatedAt: memory.updatedAt,
  };
}

async function withMemoryRepository<Result>(
  options: MemoryContextOptions,
  action: (
    repository: MemoryRepository,
    projectId: string,
  ) => Promise<Result>,
): Promise<Result> {
  const project = resolveMemoryProject(options);
  const database = new CairnQueryDatabase(
    openCairnDatabase(project.databasePath),
  );
  try {
    return await action(
      new SqliteMemoryRepository(database),
      project.projectId,
    );
  } finally {
    await database.close();
  }
}

function toFilter(options: ListMemoryOptions): MemoryFilter {
  return {
    includeArchived: options.includeArchived,
    limit: options.limit,
    scope: options.scope,
    topic: options.topic,
    type: options.type,
  };
}

export async function saveMemory(
  options: SaveMemoryOptions,
): Promise<MemoryView> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const now = (options.now ?? (() => new Date().toISOString()))();
    const idFactory = options.idFactory ?? randomUUID;
    const scope = options.scope ?? "project";
    const scopedProjectId = scope === "project" ? projectId : null;

    if (options.topic !== undefined) {
      const existing = await repository.findByTopic(
        scope,
        scopedProjectId,
        options.topic.trim(),
      );
      if (existing) {
        const transition = upsertMemory(
          existing,
          { content: options.content, title: options.title, type: options.type },
          now,
        );
        await repository.applyUpsert(transition);
        return toMemoryView(transition.memory);
      }
    }

    const memory = createMemory({
      content: options.content,
      id: MemoryId.from(idFactory()),
      now,
      projectId: scopedProjectId,
      scope,
      title: options.title,
      topic: options.topic,
      type: options.type,
    });
    await repository.create(memory);
    return toMemoryView(memory);
  });
}

async function requireMemory(
  repository: MemoryRepository,
  projectId: string,
  reference: string,
): Promise<Memory> {
  const matches = await repository.findByReference(projectId, reference);
  const memory = matches[0];
  if (!memory) {
    throw new MemoryNotFoundError(reference);
  }
  if (matches.length > 1) {
    throw new MemoryAmbiguousReferenceError(
      reference,
      matches.map((match) => match.id.toString()),
    );
  }
  return memory;
}

export async function showMemory(
  options: ShowMemoryOptions,
): Promise<MemoryView> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const memory = await requireMemory(repository, projectId, options.id);
    return toMemoryView(memory);
  });
}

export async function listMemories(
  options: ListMemoryOptions,
): Promise<readonly MemoryView[]> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const memories = await repository.listByProject(
      projectId,
      toFilter(options),
    );
    return memories.map(toMemoryView);
  });
}

export async function searchMemories(
  options: SearchMemoryOptions,
): Promise<readonly MemoryView[]> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const memories = await repository.search(
      projectId,
      options.query,
      toFilter(options),
    );
    return memories.map(toMemoryView);
  });
}

export async function relateMemories(
  options: RelateMemoryOptions,
): Promise<void> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const now = (options.now ?? (() => new Date().toISOString()))();
    const memory = await requireMemory(repository, projectId, options.id);
    const related = await requireMemory(repository, projectId, options.relatedId);
    await repository.addRelation(memory.id, related.id, now);
  });
}

export async function unrelateMemories(
  options: RelateMemoryOptions,
): Promise<void> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const memory = await requireMemory(repository, projectId, options.id);
    const related = await requireMemory(repository, projectId, options.relatedId);
    await repository.removeRelation(memory.id, related.id);
  });
}

export async function listMemoryRelations(
  options: ShowMemoryOptions,
): Promise<readonly MemoryView[]> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const memory = await requireMemory(repository, projectId, options.id);
    const related = await repository.listRelations(memory.id);
    return related.map(toMemoryView);
  });
}

export async function getMemoryTimeline(
  options: TimelineMemoryOptions,
): Promise<MemoryTimelineView> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const memory = await requireMemory(repository, projectId, options.id);
    const timeline = await repository.listTimeline(
      memory,
      options.before ?? 5,
      options.after ?? 5,
    );
    return {
      after: timeline.after.map(toMemoryView),
      before: timeline.before.map(toMemoryView),
      target: toMemoryView(timeline.target),
    };
  });
}

export async function pinMemory(
  options: LifecycleMemoryOptions,
): Promise<MemoryView> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const now = (options.now ?? (() => new Date().toISOString()))();
    const memory = await requireMemory(repository, projectId, options.id);
    const transition = setMemoryPinned(memory, true, now);
    await repository.applyLifecycleTransition(transition);
    return toMemoryView(transition.memory);
  });
}

export async function unpinMemory(
  options: LifecycleMemoryOptions,
): Promise<MemoryView> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const now = (options.now ?? (() => new Date().toISOString()))();
    const memory = await requireMemory(repository, projectId, options.id);
    const transition = setMemoryPinned(memory, false, now);
    await repository.applyLifecycleTransition(transition);
    return toMemoryView(transition.memory);
  });
}

export async function archiveMemory(
  options: LifecycleMemoryOptions,
): Promise<MemoryView> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const now = (options.now ?? (() => new Date().toISOString()))();
    const memory = await requireMemory(repository, projectId, options.id);
    const transition = setMemoryArchived(memory, true, now);
    await repository.applyLifecycleTransition(transition);
    return toMemoryView(transition.memory);
  });
}

export async function unarchiveMemory(
  options: LifecycleMemoryOptions,
): Promise<MemoryView> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const now = (options.now ?? (() => new Date().toISOString()))();
    const memory = await requireMemory(repository, projectId, options.id);
    const transition = setMemoryArchived(memory, false, now);
    await repository.applyLifecycleTransition(transition);
    return toMemoryView(transition.memory);
  });
}

export async function listSessionSummaries(
  options: SessionSummariesOptions,
): Promise<readonly MemoryView[]> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const memories = await repository.listByProject(projectId, {
      limit: options.limit,
      scope: options.scope,
      type: "session_summary",
    });
    return memories.map(toMemoryView);
  });
}

export async function getContextPrimer(
  options: ContextPrimerOptions,
): Promise<ContextPrimerView> {
  return withMemoryRepository(options, async (repository, projectId) => {
    const recentLimit = options.recentLimit ?? 5;
    const pinned = await repository.listByProject(projectId, { limit: 50 });
    const pinnedMemories = pinned.filter((memory) => memory.pinned);

    const sessionSummaries = await repository.listByProject(projectId, {
      limit: 1,
      type: "session_summary",
    });
    const recentSessionSummary = sessionSummaries[0] ?? null;

    const recent = await repository.listByProject(projectId, {
      limit: recentLimit + 1,
    });
    const recentMemories = recent
      .filter((memory) => memory.type !== "session_summary")
      .slice(0, recentLimit);

    return {
      pinnedMemories: pinnedMemories.map(toMemoryView),
      recentMemories: recentMemories.map(toMemoryView),
      recentSessionSummary:
        recentSessionSummary === null ? null : toMemoryView(recentSessionSummary),
    };
  });
}
