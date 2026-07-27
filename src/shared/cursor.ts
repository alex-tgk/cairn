/**
 * A tiny, domain-agnostic value type for opaque keyset-pagination cursors.
 *
 * This module only knows how to encode/decode an arbitrary JSON-serializable
 * payload as a base64url token and reject malformed tokens. It has no notion
 * of what a cursor's fields mean, what storage engine produced them, or what
 * ordering they seek against — each domain (work, memory, ...) owns its own
 * cursor payload shape, field validation, and SQL seek predicate. This keeps
 * the shared piece a plain value type rather than a cross-domain pagination
 * utility that would leak storage details across domain boundaries.
 */

export class CursorDecodeError extends Error {
  override readonly name = "CursorDecodeError";

  constructor(reason: string) {
    super(`Invalid pagination cursor: ${reason}`);
  }
}

/**
 * Encodes a JSON-serializable cursor payload as an opaque base64url token.
 */
export function encodeCursor(payload: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Decodes an opaque cursor token back into a plain JSON object. Throws
 * {@link CursorDecodeError} for anything that is not valid base64url, valid
 * JSON, or a JSON object (garbage-in-garbage-out is rejected, never crashed
 * on or silently accepted). Callers are responsible for validating the
 * shape and types of the returned fields for their own cursor payload.
 */
export function decodeCursor(token: string): Readonly<Record<string, unknown>> {
  if (token.trim().length === 0) {
    throw new CursorDecodeError("token must not be empty");
  }

  let json: string;
  try {
    json = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    throw new CursorDecodeError("token is not valid base64url");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CursorDecodeError("token does not decode to valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CursorDecodeError("token does not decode to a JSON object");
  }

  return parsed as Readonly<Record<string, unknown>>;
}
