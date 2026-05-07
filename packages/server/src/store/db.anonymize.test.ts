import { describe, it, expect } from "vitest";
import { Store } from "./db.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "anchor-anon-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

describe("Store.exportAll anonymize", () => {
  it("strips identifying fields and keeps content", () => {
    const s = newStore();
    const scope = s.resolveScope("/Users/alice/projects/secret");
    const src = s.recordSource({
      agent: "claude-code",
      sessionId: "session-real-123",
      deviceId: "alice-laptop",
    });
    s.insertFact({
      scopeId: scope.id,
      sourceId: src,
      content: "uses Vitest, not Jest",
    });
    s.insertDecision({
      scopeId: scope.id,
      sourceId: src,
      content: "use Postgres",
      rationale: "ACID",
    });

    const payload = s.exportAll(undefined, { anonymize: true });

    // Identity fields gone
    expect(payload.exportedAt).toBe(0);
    for (const src of payload.sources) {
      expect(src.agent).toBe("anon");
      expect(src.session_id).toBeNull();
      expect(src.device_id).toBe("anon");
      expect(src.created_at).toBe(0);
    }
    for (const sc of payload.scopes) {
      expect(sc.path).toBeNull();
      // Original name was a path; should be replaced
      expect(sc.name).not.toContain("alice");
      expect(sc.name).not.toContain("secret");
    }

    // Content survives
    expect(payload.facts.map((f) => f.content)).toContain("uses Vitest, not Jest");
    expect(payload.decisions.map((d) => d.content)).toContain("use Postgres");

    // Timestamps zeroed
    for (const f of payload.facts) {
      expect(f.created_at).toBe(0);
      expect(f.updated_at).toBe(0);
    }

    // Source references rewritten consistently
    const sourceIds = new Set(payload.sources.map((s) => s.id));
    for (const f of payload.facts) {
      expect(sourceIds.has(f.source_id as string)).toBe(true);
    }
  });

  it("non-anonymized export keeps real fields", () => {
    const s = newStore();
    const scope = s.resolveScope("/some/path");
    const src = s.recordSource({ agent: "x", deviceId: "d" });
    s.insertFact({ scopeId: scope.id, sourceId: src, content: "x" });

    const payload = s.exportAll();
    expect(payload.exportedAt).toBeGreaterThan(0);
    expect(payload.sources[0]!.agent).toBe("x");
  });
});
