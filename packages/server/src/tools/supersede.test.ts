import { describe, it, expect } from "vitest";
import { Store } from "../store/db.js";
import { handleSupersede } from "./supersede.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "anchor-supersede-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

describe("supersede", () => {
  it("replaces a fact and excludes the old row from recall", () => {
    const s = newStore();
    const scope = s.resolveScope("p");
    const src = s.recordSource({ agent: "x", deviceId: "d" });
    const oldId = s.insertFact({
      scopeId: scope.id,
      sourceId: src,
      content: "uses Jest",
    });

    const out = handleSupersede(s, {
      oldId,
      content: "uses Vitest",
      scope: "p",
      agent: "x",
    });
    expect(out.type).toBe("fact");
    expect(out.newId).not.toBe(oldId);

    const hits = s.searchFTS(scope.id, "uses test");
    const contents = hits.map((r) => r.content);
    expect(contents).toContain("uses Vitest");
    expect(contents).not.toContain("uses Jest");
  });

  it("replaces a decision preserving rationale on the new row", () => {
    const s = newStore();
    const scope = s.resolveScope("p");
    const src = s.recordSource({ agent: "x", deviceId: "d" });
    const oldId = s.insertDecision({
      scopeId: scope.id,
      sourceId: src,
      content: "use Mongo",
      rationale: "speed",
    });

    const out = handleSupersede(s, {
      oldId,
      content: "use Postgres",
      rationale: "ACID + team familiarity",
      scope: "p",
      agent: "x",
    });
    expect(out.type).toBe("decision");
    const hits = s.searchFTS(scope.id, "Postgres Mongo");
    expect(hits.find((r) => r.content === "use Postgres")?.rationale).toBe(
      "ACID + team familiarity"
    );
    expect(hits.find((r) => r.content === "use Mongo")).toBeUndefined();
  });

  it("errors on unknown id", () => {
    const s = newStore();
    expect(() =>
      handleSupersede(s, { oldId: "does-not-exist", content: "x", scope: "p" })
    ).toThrow(/no fact or decision/);
  });

  it("resolveSupersedeChain follows multi-step chain", () => {
    const s = newStore();
    const scope = s.resolveScope("p");
    const src = s.recordSource({ agent: "x", deviceId: "d" });
    const v1 = s.insertFact({ scopeId: scope.id, sourceId: src, content: "v1" });
    const out1 = handleSupersede(s, { oldId: v1, content: "v2", scope: "p" });
    const out2 = handleSupersede(s, { oldId: out1.newId, content: "v3", scope: "p" });
    expect(s.resolveSupersedeChain(v1)).toBe(out2.newId);
  });
});
