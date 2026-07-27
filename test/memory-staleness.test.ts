import { describe, expect, test } from "bun:test";

import {
  computeMemoryAgeDays,
  DEFAULT_STALE_AFTER_DAYS,
  isMemoryStale,
} from "../src/memory/memory-staleness.ts";

describe("computeMemoryAgeDays", () => {
  test("computes whole UTC days between two ISO timestamps deterministically", () => {
    expect(
      computeMemoryAgeDays("2026-01-01T00:00:00.000Z", "2026-01-31T00:00:00.000Z"),
    ).toBe(30);
  });

  test("rounds down partial days", () => {
    expect(
      computeMemoryAgeDays("2026-01-01T00:00:00.000Z", "2026-01-02T23:59:00.000Z"),
    ).toBe(1);
  });

  test("never returns a negative age", () => {
    expect(
      computeMemoryAgeDays("2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ).toBe(0);
  });

  test("returns zero for the same instant", () => {
    expect(
      computeMemoryAgeDays("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ).toBe(0);
  });
});

describe("isMemoryStale", () => {
  test("defaults to a 90 day threshold", () => {
    expect(DEFAULT_STALE_AFTER_DAYS).toBe(90);
  });

  test("is not stale at or under the threshold", () => {
    expect(
      isMemoryStale({ ageDays: 90, pinned: false, staleAfterDays: 90 }),
    ).toBe(false);
  });

  test("is stale once age exceeds the threshold", () => {
    expect(
      isMemoryStale({ ageDays: 91, pinned: false, staleAfterDays: 90 }),
    ).toBe(true);
  });

  test("pinned memories are never stale regardless of age", () => {
    expect(
      isMemoryStale({ ageDays: 10_000, pinned: true, staleAfterDays: 90 }),
    ).toBe(false);
  });

  test("honors a custom threshold", () => {
    expect(
      isMemoryStale({ ageDays: 31, pinned: false, staleAfterDays: 30 }),
    ).toBe(true);
    expect(
      isMemoryStale({ ageDays: 29, pinned: false, staleAfterDays: 30 }),
    ).toBe(false);
  });
});
