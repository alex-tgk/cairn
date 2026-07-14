import {
  buildSafeFtsMatchExpression,
  parseSearchQueryTerms,
} from "./search-query.ts";
import type {
  SearchEntityKind,
  SearchScope,
  UnifiedSearchMatch,
  UnifiedSearchRepository,
} from "./search-repository.ts";

const DEFAULT_SEARCH_LIMIT = 20;

export type SearchInput = Readonly<{
  kinds: readonly SearchEntityKind[] | undefined;
  limit?: number | undefined;
  query: string;
  repository: UnifiedSearchRepository;
  scopes: readonly SearchScope[];
}>;

export type SearchResultView = Readonly<{
  matches: readonly UnifiedSearchMatch[];
  query: string;
  termCount: number;
}>;

export async function search(input: SearchInput): Promise<SearchResultView> {
  const terms = parseSearchQueryTerms(input.query);
  const matches = await input.repository.search({
    ftsQuery: buildSafeFtsMatchExpression(terms),
    kinds: input.kinds,
    limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
    scopes: input.scopes,
    terms,
  });

  return { matches, query: input.query, termCount: terms.length };
}
