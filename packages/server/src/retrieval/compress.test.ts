import { describe, it, expect } from "vitest";
import { compressToGist, estimateTokens } from "./compress.js";
import type { MemoryRow } from "../store/db.js";

function row(partial: Partial<MemoryRow> & Pick<MemoryRow, "type" | "content">): MemoryRow {
  return {
    id: partial.id ?? "id",
    type: partial.type,
    scopeId: "s",
    sourceId: partial.sourceId ?? "src",
    content: partial.content,
    rationale: partial.rationale,
    files: partial.files,
    ref: partial.ref,
    note: partial.note,
    salience: partial.salience,
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: partial.updatedAt ?? Date.now(),
  };
}

describe("compressToGist", () => {
  it("returns a 'no memory' message when empty", () => {
    const out = compressToGist([], { budgetTokens: 1500, query: "auth" });
    expect(out).toMatch(/No relevant memory/);
  });

  it("respects token budget", () => {
    const rows: MemoryRow[] = Array.from({ length: 50 }, (_, i) =>
      row({ id: `f${i}`, type: "fact", content: "x".repeat(200) })
    );
    const out = compressToGist(rows, { budgetTokens: 200, query: "x" });
    expect(estimateTokens(out)).toBeLessThanOrEqual(220);
  });

  it("orders facts before decisions before episodes", () => {
    const rows: MemoryRow[] = [
      row({ id: "e", type: "episode", content: "EPISODE_TEXT" }),
      row({ id: "d", type: "decision", content: "DECISION_TEXT", rationale: "because" }),
      row({ id: "f", type: "fact", content: "FACT_TEXT" }),
    ];
    const out = compressToGist(rows, { budgetTokens: 1500, query: "x" });
    expect(out.indexOf("FACT_TEXT")).toBeLessThan(out.indexOf("DECISION_TEXT"));
    expect(out.indexOf("DECISION_TEXT")).toBeLessThan(out.indexOf("EPISODE_TEXT"));
  });

  it("includes provenance footer", () => {
    const rows: MemoryRow[] = [row({ type: "fact", content: "hello" })];
    const out = compressToGist(rows, { budgetTokens: 1500, query: "x" });
    expect(out).toMatch(/Sources:/);
    expect(out).toMatch(/untrusted memory/);
  });
});
