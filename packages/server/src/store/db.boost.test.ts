import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "./db.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "openmem-boost-test-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

describe("bumpSalience", () => {
  let store: Store;
  beforeEach(() => { store = newStore(); });

  it("increases episode salience after bump", () => {
    const scope = store.resolveScope("test");
    const src = store.recordSource({ agent: "t", deviceId: "d" });
    const id = store.insertEpisode({ scopeId: scope.id, sourceId: src, summary: "did a thing" });

    const before = store.listByScope(scope.id, "episode", 10);
    expect(before[0]!.salience).toBe(1.0);

    store.bumpSalience([id], 0.1);
    const after = store.listByScope(scope.id, "episode", 10);
    expect(after[0]!.salience).toBeCloseTo(1.1, 5);
  });

  it("caps salience at 2.0", () => {
    const scope = store.resolveScope("test");
    const src = store.recordSource({ agent: "t", deviceId: "d" });
    const id = store.insertEpisode({ scopeId: scope.id, sourceId: src, summary: "big bump" });

    // Bump by 1.5 twice — should cap at 2.0
    store.bumpSalience([id], 1.5);
    store.bumpSalience([id], 1.5);
    const after = store.listByScope(scope.id, "episode", 10);
    expect(after[0]!.salience).toBe(2.0);
  });

  it("no-ops on empty array", () => {
    store.bumpSalience([]); // should not throw
  });
});

describe("touchVerified", () => {
  let store: Store;
  beforeEach(() => { store = newStore(); });

  it("sets last_verified_at on a fact", () => {
    const scope = store.resolveScope("test");
    const src = store.recordSource({ agent: "t", deviceId: "d" });
    const id = store.insertFact({ scopeId: scope.id, sourceId: src, content: "something" });

    // Before touch — lastVerifiedAt should be undefined
    const before = store.searchFTS(scope.id, "something");
    expect(before[0]!.lastVerifiedAt).toBeUndefined();

    store.touchVerified([id]);
    const after = store.searchFTS(scope.id, "something");
    expect(after[0]!.lastVerifiedAt).toBeDefined();
    expect(after[0]!.lastVerifiedAt).toBeGreaterThan(0);
  });

  it("no-ops on empty array", () => {
    store.touchVerified([]); // should not throw
  });
});

describe("diffSince", () => {
  let store: Store;
  beforeEach(() => { store = newStore(); });

  it("returns rows created after the given timestamp", () => {
    const scope = store.resolveScope("test");
    const src = store.recordSource({ agent: "t", deviceId: "d" });
    const past = Date.now() - 10_000; // 10 seconds ago

    store.insertFact({ scopeId: scope.id, sourceId: src, content: "new fact" });
    store.insertDecision({ scopeId: scope.id, sourceId: src, content: "new decision" });
    store.insertEpisode({ scopeId: scope.id, sourceId: src, summary: "new episode" });

    const rows = store.diffSince(scope.id, past);
    expect(rows.length).toBe(3);
  });

  it("returns empty for future timestamp", () => {
    const scope = store.resolveScope("test");
    const src = store.recordSource({ agent: "t", deviceId: "d" });
    store.insertFact({ scopeId: scope.id, sourceId: src, content: "old stuff" });

    const future = Date.now() + 100_000;
    const rows = store.diffSince(scope.id, future);
    expect(rows.length).toBe(0);
  });

  it("sorts chronologically (oldest first)", () => {
    const scope = store.resolveScope("test");
    const src = store.recordSource({ agent: "t", deviceId: "d" });

    store.insertFact({ scopeId: scope.id, sourceId: src, content: "first" });
    store.insertFact({ scopeId: scope.id, sourceId: src, content: "second" });

    const rows = store.diffSince(scope.id, Date.now() - 10_000);
    expect(rows.length).toBe(2);
    expect(rows[0]!.updatedAt).toBeLessThanOrEqual(rows[1]!.updatedAt);
  });
});
