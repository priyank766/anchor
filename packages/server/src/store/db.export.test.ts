import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "./db.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "anchor-export-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

describe("Store export/import", () => {
  let a: Store;
  let b: Store;
  beforeEach(() => {
    a = newStore();
    b = newStore();
  });

  it("round-trips facts and decisions", () => {
    const scope = a.resolveScope("p");
    const src = a.recordSource({ agent: "x", deviceId: "d" });
    a.insertFact({ scopeId: scope.id, sourceId: src, content: "fact A" });
    a.insertDecision({
      scopeId: scope.id,
      sourceId: src,
      content: "decision B",
      rationale: "why",
    });

    const payload = a.exportAll();
    const result = b.importPayload(payload);
    expect(result.imported).toBeGreaterThan(0);

    const restored = b.searchFTS(b.resolveScope("p").id, "fact decision");
    expect(restored.map((r) => r.content)).toEqual(
      expect.arrayContaining(["fact A", "decision B"])
    );
  });

  it("re-importing the same payload is idempotent", () => {
    const scope = a.resolveScope("p");
    const src = a.recordSource({ agent: "x", deviceId: "d" });
    a.insertFact({ scopeId: scope.id, sourceId: src, content: "only one" });

    const payload = a.exportAll();
    const r1 = b.importPayload(payload);
    const r2 = b.importPayload(payload);
    expect(r1.imported).toBeGreaterThan(0);
    expect(r2.imported).toBe(0);
    expect(r2.skipped).toBeGreaterThan(0);
  });
});

describe("source dedup", () => {
  it("returns the same source id for identical (agent, sessionId, deviceId)", () => {
    const s = newStore();
    const id1 = s.recordSource({ agent: "claude-code", sessionId: "abc", deviceId: "host1" });
    const id2 = s.recordSource({ agent: "claude-code", sessionId: "abc", deviceId: "host1" });
    expect(id1).toBe(id2);
  });

  it("creates distinct sources for different sessions", () => {
    const s = newStore();
    const id1 = s.recordSource({ agent: "claude-code", sessionId: "a", deviceId: "host" });
    const id2 = s.recordSource({ agent: "claude-code", sessionId: "b", deviceId: "host" });
    expect(id1).not.toBe(id2);
  });
});
