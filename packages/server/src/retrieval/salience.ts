// Effective salience for memory rows — combines stored salience with age.
//
// Why hyperbolic decay (1 / (1 + age/halflife)) instead of exponential
// (exp(-age/halflife)):
//   - Pure arithmetic; works in SQL too if we ever push it down.
//   - Forgiving early (a 1-day-old episode is still ~99% as salient).
//   - Long tail (a 6-month-old episode is still ~5% — not zero).
// We never want a hard cliff; we want gentle pressure that lets prune
// decide what's actually gone.
//
// Type-aware halflives:
//   - Facts: never decay. A fact is a permanent truth until superseded.
//   - Decisions: 180 days. They persist long-term but eventually need review.
//   - Episodes: 30 days. Recent work is highly relevant; old episodes fade.
//   - Artifacts: 90 days. File pointers stay relevant but not forever.

import type { MemoryType } from "../store/db.js";

const HALFLIFE_MS: Record<MemoryType, number> = {
  fact: Infinity,                         // facts never decay
  decision: 180 * 24 * 60 * 60 * 1000,   // 180 days
  artifact: 90 * 24 * 60 * 60 * 1000,    // 90 days
  episode: 30 * 24 * 60 * 60 * 1000,     // 30 days (original behavior)
};

export function effectiveSalience(
  storedSalience: number,
  updatedAt: number,
  now: number = Date.now(),
  type: MemoryType = "episode"
): number {
  const halflife = HALFLIFE_MS[type];
  if (!Number.isFinite(halflife)) return storedSalience; // facts: no decay
  const ageMs = Math.max(0, now - updatedAt);
  return storedSalience / (1 + ageMs / halflife);
}
