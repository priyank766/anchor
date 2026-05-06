import { describe, it, expect, beforeEach } from "vitest";
import { Store, sanitizeFtsQuery } from "./db.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "openmem-test-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

describe("Store", () => {
  let store: Store;
  beforeEach(() => {
    store = newStore();
  });

  it("inserts and recalls a fact via FTS", () => {
    const scope = store.resolveScope("test-project");
    const sourceId = store.recordSource({ agent: "test", deviceId: "dev1" });
    store.insertFact({
      scopeId: scope.id,
      sourceId,
      content: "user prefers pnpm over npm",
    });
    const hits = store.searchFTS(scope.id, "package manager pnpm");
    expect(hits.length).toBe(1);
    expect(hits[0]!.content).toContain("pnpm");
  });

  it("isolates scopes", () => {
    const a = store.resolveScope("project-a");
    const b = store.resolveScope("project-b");
    const src = store.recordSource({ agent: "test", deviceId: "dev1" });
    store.insertFact({ scopeId: a.id, sourceId: src, content: "alpha unique token" });
    expect(store.searchFTS(b.id, "alpha unique").length).toBe(0);
    expect(store.searchFTS(a.id, "alpha unique").length).toBe(1);
  });

  it("deletes by id across tables", () => {
    const scope = store.resolveScope("x");
    const src = store.recordSource({ agent: "test", deviceId: "dev1" });
    const id = store.insertDecision({
      scopeId: scope.id,
      sourceId: src,
      content: "use Postgres",
      rationale: "ACID + team familiarity",
    });
    expect(store.deleteById(id)).toBe(true);
    expect(store.deleteById(id)).toBe(false);
  });
});

describe("sanitizeFtsQuery", () => {
  it("ORs tokens", () => {
    expect(sanitizeFtsQuery("auth refactor")).toBe('"auth" OR "refactor"');
  });
  it("strips punctuation", () => {
    expect(sanitizeFtsQuery("foo? bar! (baz)")).toBe('"foo" OR "bar" OR "baz"');
  });
  it("returns empty for whitespace", () => {
    expect(sanitizeFtsQuery("   ")).toBe("");
  });
});
