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

  it("biases toward facts/decisions when relevance is comparable", () => {
    // All rows enter at the same input position 0 (caller passes them ranked).
    // With near-equal relevance, type weights should bring fact/decision up.
    const rows: MemoryRow[] = [
      row({ id: "f", type: "fact", content: "FACT_TEXT" }),
      row({ id: "d", type: "decision", content: "DECISION_TEXT", rationale: "because" }),
      row({ id: "e", type: "episode", content: "EPISODE_TEXT" }),
    ];
    const out = compressToGist(rows, { budgetTokens: 1500, query: "x" });
    expect(out.indexOf("FACT_TEXT")).toBeLessThan(out.indexOf("EPISODE_TEXT"));
  });

  it("orders within a section by relevance (caller's input order * type weight)", () => {
    // Two episodes — episode A passed in first (more relevant per BM25), B second.
    // A should appear before B inside the episode section.
    const rows: MemoryRow[] = [
      row({ id: "a", type: "episode", content: "EPISODE_A_STRONG" }),
      row({ id: "b", type: "episode", content: "EPISODE_B_WEAK" }),
    ];
    const out = compressToGist(rows, { budgetTokens: 1500, query: "x" });
    expect(out.indexOf("EPISODE_A_STRONG")).toBeLessThan(out.indexOf("EPISODE_B_WEAK"));
  });

  it("under budget pressure, drops weak-relevance items first regardless of type", () => {
    // Budget fits only ~2 short lines. The first-passed item (highest score)
    // wins, even if it's an episode (lowest type weight).
    const rows: MemoryRow[] = [
      row({ id: "ep", type: "episode", content: "TOP_EPISODE" }),
      row({ id: "f1", type: "fact", content: "x".repeat(2000) }),
      row({ id: "f2", type: "fact", content: "y".repeat(2000) }),
    ];
    const out = compressToGist(rows, { budgetTokens: 80, query: "x" });
    expect(out).toContain("TOP_EPISODE");
  });

  it("includes provenance footer", () => {
    const rows: MemoryRow[] = [row({ type: "fact", content: "hello" })];
    const out = compressToGist(rows, { budgetTokens: 1500, query: "x" });
    expect(out).toMatch(/Sources:/);
    expect(out).toMatch(/untrusted memory/);
  });
});
