import { describe, it, expect } from "vitest";
import { Store } from "./db.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "anchor-reembed-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

describe("rowsMissingEmbedding", () => {
  it("returns rows that have no vector for the given provider", () => {
    const s = newStore();
    const scope = s.resolveScope("p");
    const src = s.recordSource({ agent: "x", deviceId: "d" });

    const a = s.insertFact({ scopeId: scope.id, sourceId: src, content: "fact A" });
    const b = s.insertFact({ scopeId: scope.id, sourceId: src, content: "fact B" });

    s.upsertEmbedding({
      memoryId: a,
      memoryType: "fact",
      scopeId: scope.id,
      providerId: "ollama:nomic:768",
      vector: new Array(8).fill(0.1),
    });

    const missing = s.rowsMissingEmbedding(scope.id, "ollama:nomic:768");
    expect(missing.map((r) => r.id)).toEqual([b]);
  });

  it("treats different providers as independent", () => {
    const s = newStore();
    const scope = s.resolveScope("p");
    const src = s.recordSource({ agent: "x", deviceId: "d" });
    const a = s.insertFact({ scopeId: scope.id, sourceId: src, content: "fact A" });

    s.upsertEmbedding({
      memoryId: a,
      memoryType: "fact",
      scopeId: scope.id,
      providerId: "ollama:nomic:768",
      vector: [0.1, 0.2],
    });

    expect(s.rowsMissingEmbedding(scope.id, "openai:text-embed-3:1536").map((r) => r.id)).toEqual([a]);
    expect(s.rowsMissingEmbedding(scope.id, "ollama:nomic:768").length).toBe(0);
  });
});
