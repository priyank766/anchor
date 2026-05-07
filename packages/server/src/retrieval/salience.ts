// Effective salience for episodes — combines stored salience with age.
//
// Why hyperbolic decay (1 / (1 + age/halflife)) instead of exponential
// (exp(-age/halflife)):
//   - Pure arithmetic; works in SQL too if we ever push it down.
//   - Forgiving early (a 1-day-old episode is still ~99% as salient).
//   - Long tail (a 6-month-old episode is still ~5% — not zero).
// We never want a hard cliff; we want gentle pressure that lets prune
// decide what's actually gone.
//
// Halflife is conservative: 30 days. Tune later if dogfooding shows
// episodes aging out too fast or sticking around too long.

const HALFLIFE_MS = 30 * 24 * 60 * 60 * 1000;

export function effectiveSalience(
  storedSalience: number,
  updatedAt: number,
  now: number = Date.now()
): number {
  const ageMs = Math.max(0, now - updatedAt);
  return storedSalience / (1 + ageMs / HALFLIFE_MS);
}
