export class ContextQueryValidationError extends Error {
  readonly code = "invalid_context_query";
  override readonly name = "ContextQueryValidationError";
}

// Matches runs of Unicode letters/numbers, treating anything else (punctuation,
// symbols, whitespace) as a separator. This keeps user input to safe literal
// terms and rejects raw FTS5 syntax (quotes, NEAR, column filters, etc.).
const TERM_PATTERN = /[\p{L}\p{N}]+/gu;

export function parseContextQueryTerms(query: string): readonly string[] {
  const terms = query.match(TERM_PATTERN) ?? [];
  if (terms.length === 0) {
    throw new ContextQueryValidationError(
      "Query must contain at least one literal search term",
    );
  }
  return terms;
}

export function buildSafeFtsMatchExpression(
  terms: readonly string[],
): string {
  return terms
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
}

export function parseContextSearchLimit(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ContextQueryValidationError(
      "Limit must be a positive integer",
    );
  }
  return limit;
}
