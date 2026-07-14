export type SearchEntityKind = "context_document" | "memory" | "work_item";

export const SEARCH_ENTITY_KINDS: readonly SearchEntityKind[] = [
  "context_document",
  "memory",
  "work_item",
];

export type SearchScope = Readonly<{
  projectId: string;
  workspaceId: string | undefined;
}>;

export type UnifiedSearchInput = Readonly<{
  ftsQuery: string;
  kinds: readonly SearchEntityKind[] | undefined;
  limit: number;
  scopes: readonly SearchScope[];
  terms: readonly string[];
}>;

export type UnifiedSearchMatch = Readonly<{
  entityId: string;
  entityKind: SearchEntityKind;
  matchedTerms: readonly string[];
  projectId: string;
  snippet: string;
  sourcePath: string | null;
  tags: readonly string[];
  title: string;
  workspaceId: string | null;
}>;

export interface UnifiedSearchRepository {
  search(input: UnifiedSearchInput): Promise<readonly UnifiedSearchMatch[]>;
}
