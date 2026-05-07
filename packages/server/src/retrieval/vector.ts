// Cosine-similarity vector search over an in-memory list of (id, vector).
// No ANN index — full scan. Adequate for the local-first product at the
// scales we expect (hundreds to low thousands of memories per scope).

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface VectorHit<T> {
  item: T;
  score: number;
}

export function topK<T extends { vector: number[] }>(
  query: number[],
  items: T[],
  k: number,
  threshold = 0
): VectorHit<T>[] {
  const out: VectorHit<T>[] = [];
  for (const it of items) {
    const score = cosine(query, it.vector);
    if (score >= threshold) out.push({ item: it, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, k);
}
