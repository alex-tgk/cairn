import type {
  Memory,
  MemoryId,
  MemoryListCursor,
  MemoryScope,
  MemorySearchCursor,
  MemoryTransition,
  MemoryType,
} from "./memory.ts";

export interface MemoryRepository {
  addRelation(
    memoryId: MemoryId,
    relatedMemoryId: MemoryId,
    now: string,
  ): Promise<void>;
  applyUpsert(transition: MemoryTransition): Promise<void>;
  create(memory: Memory): Promise<void>;
  findById(id: MemoryId): Promise<Memory | null>;
  findByReference(
    projectId: string,
    reference: string,
  ): Promise<readonly Memory[]>;
  findByTopic(
    scope: MemoryScope,
    projectId: string | null,
    topic: string,
  ): Promise<Memory | null>;
  listByProject(
    projectId: string,
    filter?: MemoryFilter,
  ): Promise<readonly Memory[]>;
  listRelations(memoryId: MemoryId): Promise<readonly Memory[]>;
  listTimeline(memory: Memory, before: number, after: number): Promise<MemoryTimeline>;
  removeRelation(
    memoryId: MemoryId,
    relatedMemoryId: MemoryId,
  ): Promise<void>;
  applyLifecycleTransition(transition: MemoryTransition): Promise<void>;
  search(
    projectId: string,
    query: string,
    filter?: MemoryFilter,
  ): Promise<readonly MemorySearchResult[]>;
}

export type MemoryFilter = Readonly<{
  cursor?: MemoryListCursor | undefined;
  includeArchived?: boolean | undefined;
  limit?: number | undefined;
  scope?: MemoryScope | undefined;
  searchCursor?: MemorySearchCursor | undefined;
  topic?: string | undefined;
  type?: MemoryType | undefined;
}>;

export type MemorySearchResult = Readonly<{
  memory: Memory;
  rank: number;
}>;

export type MemoryTimeline = Readonly<{
  after: readonly Memory[];
  before: readonly Memory[];
  target: Memory;
}>;
