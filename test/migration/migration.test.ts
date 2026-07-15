import { describe, expect, test } from "bun:test";

import {
  normalizeContextKind,
  normalizeIssuePriority,
  normalizeIssueStatus,
  normalizeIssueType,
  normalizeMemoryScope,
  normalizeMemoryType,
  parseExternalDependencyEdges,
  parseExternalIssuesJsonl,
  parseExternalMemoryExport,
} from "../../src/migration/migration.ts";

describe("migration parsing", () => {
  test("parses JSONL issues and skips non-issue records", () => {
    const jsonl = [
      JSON.stringify({ _type: "issue", id: "a-1", title: "A" }),
      JSON.stringify({ _type: "comment", id: "c-1" }),
      JSON.stringify({ id: "a-2", title: "B" }),
      "",
    ].join("\n");

    const issues = parseExternalIssuesJsonl(jsonl);

    expect(issues).toEqual([
      { _type: "issue", id: "a-1", title: "A" },
      { id: "a-2", title: "B" },
    ]);
  });

  test("parses dependency edges from a JSON array", () => {
    const edges = parseExternalDependencyEdges(
      JSON.stringify([
        { depends_on_id: "a-1", issue_id: "a-2", type: "parent-child" },
      ]),
    );

    expect(edges).toEqual([
      { depends_on_id: "a-1", issue_id: "a-2", type: "parent-child" },
    ]);
  });

  test("rejects a dependency edges file that is not a JSON array", () => {
    expect(() => parseExternalDependencyEdges(JSON.stringify({}))).toThrow();
  });

  test("parses a memory export object", () => {
    const parsed = parseExternalMemoryExport(
      JSON.stringify({ observations: [{ id: 1, sync_id: "s1" }] }),
    );

    expect(parsed.observations).toHaveLength(1);
  });
});

describe("migration normalization", () => {
  test("normalizes issue status, falling back to open", () => {
    expect(normalizeIssueStatus("closed")).toBe("closed");
    expect(normalizeIssueStatus("bogus")).toBe("open");
    expect(normalizeIssueStatus(undefined)).toBe("open");
  });

  test("normalizes issue type, falling back to task", () => {
    expect(normalizeIssueType("bug")).toBe("bug");
    expect(normalizeIssueType("bogus")).toBe("task");
  });

  test("normalizes issue priority, clamping and defaulting", () => {
    expect(normalizeIssuePriority(4)).toBe(4);
    expect(normalizeIssuePriority(9)).toBe(4);
    expect(normalizeIssuePriority(-1)).toBe(0);
    expect(normalizeIssuePriority(undefined)).toBe(2);
    expect(normalizeIssuePriority(Number.NaN)).toBe(2);
  });

  test("normalizes memory type, mapping known fallbacks and defaulting to discovery", () => {
    expect(normalizeMemoryType("pattern")).toBe("pattern");
    expect(normalizeMemoryType("refactor")).toBe("pattern");
    expect(normalizeMemoryType("bogus")).toBe("discovery");
  });

  test("normalizes memory scope, defaulting to project", () => {
    expect(normalizeMemoryScope("personal")).toBe("personal");
    expect(normalizeMemoryScope("bogus")).toBe("project");
  });

  test("normalizes context kind, defaulting to discovery", () => {
    expect(normalizeContextKind("pattern")).toBe("pattern");
    expect(normalizeContextKind("file")).toBe("discovery");
  });
});
