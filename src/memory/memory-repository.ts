import type {
  Memory,
  MemoryId,
  MemoryScope,
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
  findContextDocumentReference(
    projectId: string,
    reference: string,
  ): Promise<readonly LinkedContextDocument[]>;
  findWorkItemReference(
    projectId: string,
    reference: string,
  ): Promise<readonly LinkedWorkItem[]>;
  linkContextDocument(
    memoryId: MemoryId,
    contextDocumentId: string,
    now: string,
  ): Promise<void>;
  linkWorkItem(
    memoryId: MemoryId,
    workItemId: string,
    now: string,
  ): Promise<void>;
  listByProject(
    projectId: string,
    filter?: MemoryFilter,
  ): Promise<readonly Memory[]>;
  listLinkedContextDocuments(
    memoryId: MemoryId,
  ): Promise<readonly LinkedContextDocument[]>;
  listLinkedWorkItems(memoryId: MemoryId): Promise<readonly LinkedWorkItem[]>;
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
  ): Promise<readonly Memory[]>;
  unlinkContextDocument(
    memoryId: MemoryId,
    contextDocumentId: string,
  ): Promise<void>;
  unlinkWorkItem(memoryId: MemoryId, workItemId: string): Promise<void>;
}

export type LinkedWorkItem = Readonly<{
  id: string;
  status: string;
  title: string;
  type: string;
}>;

export type LinkedContextDocument = Readonly<{
  id: string;
  relativePath: string;
  title: string;
}>;

export type MemoryFilter = Readonly<{
  includeArchived?: boolean | undefined;
  limit?: number | undefined;
  scope?: MemoryScope | undefined;
  topic?: string | undefined;
  type?: MemoryType | undefined;
}>;

export type MemoryTimeline = Readonly<{
  after: readonly Memory[];
  before: readonly Memory[];
  target: Memory;
}>;
