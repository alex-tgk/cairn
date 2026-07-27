import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_STALE_AFTER_DAYS } from "../src/memory/memory-staleness.ts";
import {
  getContextPrimer,
  listMemories,
  pinMemory,
  saveMemory,
  searchMemories,
  showMemory,
} from "../src/memory/memory-service.ts";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function createWorkspace(): Readonly<{ dataDirectory: string; path: string }> {
  const dataDirectory = createTemporaryDirectory("cairn-memory-staleness-data-");
  const path = createTemporaryDirectory("cairn-memory-staleness-ws-");
  mkdirSync(join(path, ".git"));
  return { dataDirectory, path };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("memory staleness in the memory service", () => {
  test("a freshly saved memory has zero age and is not stale", async () => {
    const workspace = createWorkspace();
    const created = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const saved = await saveMemory({
      ...workspace,
      content: "The auth model uses refresh tokens.",
      now: () => created,
      title: "Auth model",
      type: "architecture",
    });

    expect(saved.ageDays).toBe(0);
    expect(saved.stale).toBe(false);
  });

  test("defaults staleness to the 90 day threshold on show/list/search", async () => {
    const workspace = createWorkspace();
    const created = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const saved = await saveMemory({
      ...workspace,
      content: "The auth model uses refresh tokens.",
      now: () => created,
      title: "Auth model",
      type: "architecture",
    });

    const exactlyAtThreshold = new Date(
      Date.parse(created) + DEFAULT_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const shownAtThreshold = await showMemory({
      ...workspace,
      id: saved.id,
      now: () => exactlyAtThreshold,
    });
    expect(shownAtThreshold.ageDays).toBe(DEFAULT_STALE_AFTER_DAYS);
    expect(shownAtThreshold.stale).toBe(false);

    const justPastThreshold = new Date(
      Date.parse(created) + (DEFAULT_STALE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000,
    ).toISOString();

    const shownPastThreshold = await showMemory({
      ...workspace,
      id: saved.id,
      now: () => justPastThreshold,
    });
    expect(shownPastThreshold.ageDays).toBe(DEFAULT_STALE_AFTER_DAYS + 1);
    expect(shownPastThreshold.stale).toBe(true);

    const listed = await listMemories({
      ...workspace,
      now: () => justPastThreshold,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.stale).toBe(true);
    expect(listed[0]?.ageDays).toBe(DEFAULT_STALE_AFTER_DAYS + 1);

    const searched = await searchMemories({
      ...workspace,
      now: () => justPastThreshold,
      query: "refresh tokens",
    });
    expect(searched).toHaveLength(1);
    expect(searched[0]?.stale).toBe(true);
  });

  test("a custom --stale-after-days threshold overrides the default", async () => {
    const workspace = createWorkspace();
    const created = new Date("2026-01-01T00:00:00.000Z").toISOString();
    await saveMemory({
      ...workspace,
      content: "The auth model uses refresh tokens.",
      now: () => created,
      title: "Auth model",
      type: "architecture",
    });

    const in10Days = new Date(
      Date.parse(created) + 10 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const listedWithDefault = await listMemories({
      ...workspace,
      now: () => in10Days,
    });
    expect(listedWithDefault[0]?.stale).toBe(false);

    const listedWithCustomThreshold = await listMemories({
      ...workspace,
      now: () => in10Days,
      staleAfterDays: 5,
    });
    expect(listedWithCustomThreshold[0]?.stale).toBe(true);
    expect(listedWithCustomThreshold[0]?.ageDays).toBe(10);
  });

  test("pinned memories are never stale, even far past the threshold", async () => {
    const workspace = createWorkspace();
    const created = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const saved = await saveMemory({
      ...workspace,
      content: "Never rewrite git history in this repository.",
      now: () => created,
      title: "Git history policy",
      type: "decision",
    });

    const farFuture = new Date(
      Date.parse(created) + 400 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Pin shortly after creation (not at farFuture) so the pin mutation
    // itself doesn't reset updatedAt to the moment we check staleness.
    const pinnedAt = new Date(
      Date.parse(created) + 1000,
    ).toISOString();
    await pinMemory({ ...workspace, id: saved.id, now: () => pinnedAt });

    const shown = await showMemory({
      ...workspace,
      id: saved.id,
      now: () => farFuture,
    });
    expect(shown.pinned).toBe(true);
    expect(shown.ageDays).toBeGreaterThan(DEFAULT_STALE_AFTER_DAYS);
    expect(shown.stale).toBe(false);
  });

  test("uses updatedAt, not createdAt, as the staleness reference point", async () => {
    const workspace = createWorkspace();
    const created = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const saved = await saveMemory({
      ...workspace,
      content: "Original content.",
      now: () => created,
      title: "Original title",
      topic: "architecture/example",
      type: "architecture",
    });

    const upsertedAt = new Date(
      Date.parse(created) + 200 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await saveMemory({
      ...workspace,
      content: "Updated content confirming the same decision.",
      now: () => upsertedAt,
      title: "Original title",
      topic: "architecture/example",
      type: "architecture",
    });

    const checkedShortlyAfterUpdate = new Date(
      Date.parse(upsertedAt) + 5 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const shown = await showMemory({
      ...workspace,
      id: saved.id,
      now: () => checkedShortlyAfterUpdate,
    });

    // Age since createdAt would be ~205 days (stale); age since updatedAt
    // (the topic-key upsert) is only 5 days (not stale).
    expect(shown.ageDays).toBe(5);
    expect(shown.stale).toBe(false);
  });

  test("surfaces ageDays and stale on embedded memories in the context primer", async () => {
    const workspace = createWorkspace();
    const created = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const pinned = await saveMemory({
      ...workspace,
      content: "Pinned architecture note.",
      now: () => created,
      title: "Pinned note",
      type: "architecture",
    });
    await pinMemory({ ...workspace, id: pinned.id, now: () => created });

    await saveMemory({
      ...workspace,
      content: "Goal: ship staleness. Accomplished: derived signal.",
      now: () => created,
      title: "Session summary",
      type: "session_summary",
    });
    await saveMemory({
      ...workspace,
      content: "A recent discovery.",
      now: () => created,
      title: "Recent discovery",
      type: "discovery",
    });

    const farFuture = new Date(
      Date.parse(created) + 200 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const primer = await getContextPrimer({ ...workspace, now: () => farFuture });

    const pinnedView = primer.pinnedMemories.find(
      (memory) => memory.title === "Pinned note",
    );
    const recentDiscovery = primer.recentMemories.find(
      (memory) => memory.title === "Recent discovery",
    );

    expect(pinnedView?.ageDays).toBe(200);
    expect(pinnedView?.stale).toBe(false);
    expect(primer.recentSessionSummary?.ageDays).toBe(200);
    expect(primer.recentSessionSummary?.stale).toBe(true);
    expect(recentDiscovery?.ageDays).toBe(200);
    expect(recentDiscovery?.stale).toBe(true);
  });
});
