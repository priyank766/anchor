// End-to-end test of the hybrid retrieval path with a mock embed provider.
// We use vi.mock to swap loadEmbedProvider for the duration of the test file.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../store/db.js";
import { MockEmbedProvider } from "../providers/mock.js";

const mockProvider = new MockEmbedProvider();
let providerOverride: { embed(t: string): Promise<number[]>; id: string; dimensions: number } | null =
  mockProvider;

vi.mock("../providers/types.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../providers/types.js")>();
  return {
    ...real,
    loadEmbedProvider: async () => providerOverride,
  };
});

import { handleRemember } from "./remember.js";
import { handleRecall } from "./recall.js";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "anchor-hybrid-"));
  return new Store({
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  });
}

describe("hybrid retrieval", () => {
  let store: Store;
  beforeEach(() => {
    store = newStore();
    providerOverride = mockProvider;
  });

  it("recall returns hybrid mode when a provider is configured", async () => {
    await handleRemember(store, {
      type: "fact",
      content: "uses Vitest, not Jest",
      scope: "p",
      agent: "test",
    });

    const out = await handleRecall(store, { query: "test framework", scope: "p" });
    expect(out.mode).toBe("hybrid");
  });

  it("vector hits surface memories BM25 would miss", async () => {
    await handleRemember(store, {
      type: "fact",
      content: "alpha bravo charlie",
      scope: "p",
      agent: "test",
    });
    await handleRemember(store, {
      type: "fact",
      content: "alpha bravo charlie delta",
      scope: "p",
      agent: "test",
    });

    const out = await handleRecall(store, {
      query: "alpha bravo charlie",
      scope: "p",
    });
    expect(out.mode).toBe("hybrid");
    expect(out.matched).toBeGreaterThan(0);
  });

  it("falls back cleanly if the provider throws on the recall path", async () => {
    // First write with the mock so a row exists. Then swap to a broken
    // provider for the recall to test the catch path.
    await handleRemember(store, {
      type: "fact",
      content: "uses Vitest",
      scope: "p",
      agent: "test",
    });

    providerOverride = {
      id: "broken:0",
      dimensions: 4,
      embed: async () => {
        throw new Error("network down");
      },
    };
    const out = await handleRecall(store, { query: "Vitest", scope: "p" });
    expect(out.matched).toBeGreaterThan(0);
    expect(out.vectorError).toMatch(/network down/);
  });

  it("recall is bm25-only when no provider configured", async () => {
    providerOverride = null;
    await handleRemember(store, {
      type: "fact",
      content: "deploys to Cloudflare Workers",
      scope: "p",
      agent: "test",
    });
    const out = await handleRecall(store, { query: "Cloudflare", scope: "p" });
    expect(out.mode).toBe("bm25");
  });
});
