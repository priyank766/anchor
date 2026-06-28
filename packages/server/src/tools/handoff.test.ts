import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../store/db.js";
import { handleHandoff } from "./handoff.js";
import { handleDiff } from "./diff.js";
import { handleReplay } from "./replay.js";
import { handleRemember } from "./remember.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "openmem-handoff-test-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

describe("handleHandoff", () => {
  let store: Store;
  beforeEach(() => { store = newStore(); });

  it("creates a handoff brief including facts and decisions", async () => {
    // Populate some data
    await handleRemember(store, {
      type: "fact",
      content: "Uses Vitest for testing",
      scope: "test-proj",
      agent: "claude",
    });

    await handleRemember(store, {
      type: "decision",
      content: "Use Drizzle ORM",
      rationale: "Better TypeScript support",
      scope: "test-proj",
      agent: "claude",
    });

    await handleRemember(store, {
      type: "episode",
      content: "Initial setup done",
      scope: "test-proj",
      agent: "claude",
    });

    const res = await handleHandoff(store, {
      scope: "test-proj",
      since: "1d",
    });

    expect(res.scope).toBe("test-proj");
    expect(res.counts.facts).toBe(1);
    expect(res.counts.decisions).toBe(1);
    expect(res.handoff).toContain("Vitest");
    expect(res.handoff).toContain("Drizzle ORM");
  });
});

describe("handleDiff", () => {
  let store: Store;
  beforeEach(() => { store = newStore(); });

  it("lists changes in memory since a timestamp", async () => {
    await handleRemember(store, {
      type: "fact",
      content: "Fact inserted now",
      scope: "diff-proj",
      agent: "claude",
    });

    const res = await handleDiff(store, {
      scope: "diff-proj",
      since: "1h",
    });

    expect(res.count).toBe(1);
    expect(res.diff).toContain("Fact inserted now");
  });
});

describe("handleReplay", () => {
  let store: Store;
  beforeEach(() => { store = newStore(); });

  it("replays episodes and decisions chronologically", async () => {
    await handleRemember(store, {
      type: "decision",
      content: "First choice",
      scope: "replay-proj",
      agent: "claude",
    });

    await handleRemember(store, {
      type: "episode",
      content: "Second step",
      scope: "replay-proj",
      agent: "claude",
    });

    const res = await handleReplay(store, {
      scope: "replay-proj",
      limit: 10,
    });

    expect(res.count).toBe(2);
    expect(res.replay).toContain("First choice");
    expect(res.replay).toContain("Second step");
  });
});
