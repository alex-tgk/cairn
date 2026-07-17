import { describe, expect, test } from "bun:test";

import {
  defaultScopeForType,
  MEMORY_TYPES,
  type MemoryType,
} from "../src/memory/memory.ts";

describe("defaultScopeForType", () => {
  test("defaults a preference to personal scope", () => {
    expect(defaultScopeForType("preference")).toBe("personal");
  });

  test("defaults every non-preference type to project scope", () => {
    const projectTypes: readonly MemoryType[] = MEMORY_TYPES.filter(
      (type) => type !== "preference",
    );
    for (const type of projectTypes) {
      expect(defaultScopeForType(type)).toBe("project");
    }
  });
});
