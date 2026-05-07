import { describe, it, expect } from "vitest";
import { Store } from "./db.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "anchor-prune-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

const DAY = 24 * 60 * 60 * 1000;

describe("pruneEpisodes", () => {
  it("removes episodes below salience threshold; keeps recent ones", () => {
    const s = newStore();
    const scope = s.resolveScope("p");
    const src = s.recordSource({ agent: "x", deviceId: "d" });

    // Insert recent episode (high effective salience).
    s.insertEpisode({
      scopeId: scope.id,
      sourceId: src,
      summary: "fresh episode",
    });

    // Insert and then backdate: simulate an old episode by updating the row
    // directly. We use the raw db handle through a re-insert + UPDATE.
    const oldId = s.insertEpisode({
      scopeId: scope.id,
      sourceId: src,
      summary: "stale episode",
    });
    const longAgo = Date.now() - 365 * DAY;
    // @ts-expect-error reaching into private field for test setup
    s.db.prepare("UPDATE episodes SET updated_at = ? WHERE id = ?").run(longAgo, oldId);

    // Effective salience of stale ≈ 1/(1 + 365/30) ≈ 0.076 → below 0.1
    const deleted = s.pruneEpisodes(scope.id, 0.1);
    expect(deleted).toBe(1);

    const remaining = s.listByScope(scope.id, "episode");
    expect(remaining.map((r) => r.content)).toEqual(["fresh episode"]);
  });

  it("does nothing if all episodes are above threshold", () => {
    const s = newStore();
    const scope = s.resolveScope("p");
    const src = s.recordSource({ agent: "x", deviceId: "d" });
    s.insertEpisode({ scopeId: scope.id, sourceId: src, summary: "a" });
    s.insertEpisode({ scopeId: scope.id, sourceId: src, summary: "b" });
    expect(s.pruneEpisodes(scope.id, 0.1)).toBe(0);
  });

  it("never touches facts, decisions, or artifacts", () => {
    const s = newStore();
    const scope = s.resolveScope("p");
    const src = s.recordSource({ agent: "x", deviceId: "d" });
    s.insertFact({ scopeId: scope.id, sourceId: src, content: "fact" });
    s.insertDecision({
      scopeId: scope.id,
      sourceId: src,
      content: "decision",
      rationale: "r",
    });
    s.insertArtifact({ scopeId: scope.id, sourceId: src, ref: "x.ts:1" });

    s.pruneEpisodes(scope.id, 999); // absurdly high threshold
    const all = s.listByScope(scope.id);
    const types = new Set(all.map((r) => r.type));
    expect(types.has("fact")).toBe(true);
    expect(types.has("decision")).toBe(true);
    expect(types.has("artifact")).toBe(true);
  });
});
