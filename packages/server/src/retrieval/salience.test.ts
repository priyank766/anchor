import { describe, it, expect } from "vitest";
import { effectiveSalience } from "./salience.js";

const DAY = 24 * 60 * 60 * 1000;

describe("effectiveSalience", () => {
  it("returns stored salience when fresh", () => {
    const now = Date.now();
    expect(effectiveSalience(1.0, now, now)).toBeCloseTo(1.0, 4);
  });

  it("halves at one halflife (~30 days)", () => {
    const now = Date.now();
    const oneHalflifeAgo = now - 30 * DAY;
    expect(effectiveSalience(1.0, oneHalflifeAgo, now)).toBeCloseTo(0.5, 2);
  });

  it("decreases monotonically with age", () => {
    const now = Date.now();
    const a = effectiveSalience(1.0, now - 1 * DAY, now);
    const b = effectiveSalience(1.0, now - 30 * DAY, now);
    const c = effectiveSalience(1.0, now - 365 * DAY, now);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it("scales linearly with stored salience", () => {
    const now = Date.now();
    const ts = now - 30 * DAY;
    expect(effectiveSalience(2.0, ts, now)).toBeCloseTo(
      2 * effectiveSalience(1.0, ts, now),
      4
    );
  });

  it("clamps negative ages to zero", () => {
    const now = Date.now();
    // updatedAt in the future shouldn't blow up
    expect(effectiveSalience(1.0, now + 1000, now)).toBeCloseTo(1.0, 4);
  });
});
