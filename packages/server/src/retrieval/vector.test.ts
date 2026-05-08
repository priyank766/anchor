import { describe, it, expect } from "vitest";
import { cosine, topK } from "./vector.js";

describe("cosine", () => {
  it("returns 1 for identical unit vectors", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it("is invariant to magnitude", () => {
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1, 6);
    expect(cosine([3, 4], [9, 12])).toBeCloseTo(1, 6);
  });

  it("returns 0 on length mismatch", () => {
    expect(cosine([1, 0, 0], [1, 0])).toBe(0);
  });

  it("returns 0 when either vector is all zeros", () => {
    expect(cosine([0, 0, 0], [1, 1, 1])).toBe(0);
  });
});

describe("topK", () => {
  const items = [
    { id: "a", vector: [1, 0, 0] },
    { id: "b", vector: [0.9, 0.1, 0] },
    { id: "c", vector: [0, 1, 0] },
    { id: "d", vector: [0, 0, 1] },
  ];

  it("orders by similarity to the query", () => {
    const hits = topK([1, 0, 0], items, 4);
    expect(hits.map((h) => h.item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("respects k", () => {
    expect(topK([1, 0, 0], items, 2).length).toBe(2);
  });

  it("filters below threshold", () => {
    const hits = topK([1, 0, 0], items, 10, 0.5);
    expect(hits.map((h) => h.item.id)).toEqual(["a", "b"]);
  });
});
