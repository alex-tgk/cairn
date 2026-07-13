import type {
  Memory,
  MemoryId,
  MemoryScope,
  MemoryTransition,
  MemoryType,
} from "./memory.ts";

export interface MemoryRepository {
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
  search(
    projectId: string,
    query: string,
    filter?: MemoryFilter,
  ): Promise<readonly Memory[]>;
}

export type MemoryFilter = Readonly<{
  limit?: number | undefined;
  scope?: MemoryScope | undefined;
  topic?: string | undefined;
  type?: MemoryType | undefined;
}>;
