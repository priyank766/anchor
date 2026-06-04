import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../store/db.js";
import { handleSummary } from "./summary.js";
import { handleRemember } from "./remember.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "anchor-summary-test-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

describe("handleSummary", () => {
  let store: Store;
  beforeEach(() => {
    store = newStore();
  });

  it("handles empty scope gracefully", () => {
    const res = handleSummary(store, { scope: "test-scope" });
    expect(res.scope).toBe("test-scope");
    expect(res.counts.facts).toBe(0);
    expect(res.counts.decisions).toBe(0);
    expect(res.counts.episodes).toBe(0);
    expect(res.counts.artifacts).toBe(0);
    expect(res.summary).toContain("No memories found in this scope yet");
  });

  it("summarizes facts, decisions, episodes and artifacts correctly", async () => {
    // Remember some items
    await handleRemember(store, {
      type: "fact",
      content: "Codebase uses vitest",
      scope: "test-scope",
      agent: "test",
    });

    await handleRemember(store, {
      type: "decision",
      content: "We use SQLite for local-first storage",
      rationale: "Fast and easy to set up",
      scope: "test-scope",
      agent: "test",
    });

    await handleRemember(store, {
      type: "episode",
      content: "Implemented the database schema",
      files: ["schema.sql", "db.ts"],
      scope: "test-scope",
      agent: "test",
    });

    await handleRemember(store, {
      type: "artifact",
      ref: "src/db.ts:42",
      note: "Primary database connection pool setup",
      scope: "test-scope",
      agent: "test",
    });

    const res = handleSummary(store, { scope: "test-scope" });
    expect(res.scope).toBe("test-scope");
    expect(res.counts.facts).toBe(1);
    expect(res.counts.decisions).toBe(1);
    expect(res.counts.episodes).toBe(1);
    expect(res.counts.artifacts).toBe(1);

    expect(res.summary).toContain("Codebase uses vitest");
    expect(res.summary).toContain("We use SQLite for local-first storage");
    expect(res.summary).toContain("Fast and easy to set up");
    expect(res.summary).toContain("Implemented the database schema");
    expect(res.summary).toContain("schema.sql");
    expect(res.summary).toContain("src/db.ts:42");
    expect(res.summary).toContain("Primary database connection pool setup");
  });
});
