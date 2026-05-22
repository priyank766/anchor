import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../store/db.js";
import { handleRemember } from "./remember.js";
import { handleRecall } from "./recall.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "openmem-recall-test-"));
  return {
    dir,
    store: new Store({
      dataDir: dir,
      dbPath: join(dir, "memory.db"),
      defaultBudgetTokens: 1500,
    }),
  };
}

async function seedScope(store: Store, scope: string, items: Array<{ type: string; content?: string; ref?: string; note?: string; rationale?: string; files?: string[] }>) {
  for (const item of items) {
    await handleRemember(store, { ...item, scope, agent: "test" });
  }
}

describe("handleRecall", () => {
  let store: Store;
  let dir: string;

  beforeEach(() => {
    const ctx = newStore();
    store = ctx.store;
    dir = ctx.dir;
    process.env.ANCHOR_HOME = dir;
  });

  it("recalls seeded facts via BM25", async () => {
    await seedScope(store, "recall-test", [
      { type: "fact", content: "Backend uses Fastify on Node 20" },
      { type: "fact", content: "Database is PostgreSQL 15" },
      { type: "decision", content: "Use Drizzle ORM instead of Prisma", rationale: "Better TypeScript inference" },
    ]);

    const result = await handleRecall(store, {
      query: "what framework and database does this project use",
      scope: "recall-test",
    });

    expect(result.matched).toBeGreaterThan(0);
    expect(result.gist).toContain("Fastify");
    expect(result.gist).toContain("PostgreSQL");
    expect(result.mode).toBe("bm25");
  });

  it("returns no-memory message for empty scope", async () => {
    const result = await handleRecall(store, {
      query: "anything",
      scope: "empty-scope",
    });
    expect(result.matched).toBe(0);
    expect(result.gist).toMatch(/No relevant memory/);
  });

  it("respects scope isolation", async () => {
    await seedScope(store, "project-alpha", [
      { type: "fact", content: "Alpha uses React with Next.js 14" },
    ]);
    await seedScope(store, "project-beta", [
      { type: "fact", content: "Beta uses Vue with Nuxt 3" },
    ]);

    const alphaResult = await handleRecall(store, {
      query: "React Next.js",
      scope: "project-alpha",
    });
    expect(alphaResult.gist).toContain("React");
    expect(alphaResult.gist).not.toContain("Vue");

    const betaResult = await handleRecall(store, {
      query: "Vue Nuxt",
      scope: "project-beta",
    });
    expect(betaResult.gist).toContain("Vue");
    expect(betaResult.gist).not.toContain("React");
  });

  it("respects budgetTokens limit", async () => {
    // Seed a lot of content
    for (let i = 0; i < 20; i++) {
      await seedScope(store, "budget-test", [
        { type: "fact", content: `This is fact number ${i} with some padding text to increase token count significantly: ${"word ".repeat(50)}` },
      ]);
    }

    const result = await handleRecall(store, {
      query: "fact",
      scope: "budget-test",
      budgetTokens: 200,
    });

    // Gist should be within budget (rough check — estimateTokens is ~len/4)
    expect(result.gist.length).toBeLessThan(200 * 5); // generous margin
  });

  it("bumps salience on recalled episodes", async () => {
    await seedScope(store, "salience-test", [
      { type: "episode", content: "Deployed v2 of the authentication service to production" },
    ]);

    // Get initial salience
    const scope = store.resolveScope("salience-test");
    const before = store.listByScope(scope.id, "episode", 10);
    const initialSalience = before[0]!.salience!;

    // Recall should bump salience
    await handleRecall(store, {
      query: "authentication deployment",
      scope: "salience-test",
    });

    const after = store.listByScope(scope.id, "episode", 10);
    expect(after[0]!.salience!).toBeGreaterThan(initialSalience);
  });

  it("touches lastVerifiedAt on recalled facts", async () => {
    await seedScope(store, "verified-test", [
      { type: "fact", content: "We use TypeScript strict mode everywhere" },
    ]);

    // Before recall — lastVerifiedAt is undefined
    const scope = store.resolveScope("verified-test");
    const before = store.searchFTS(scope.id, "TypeScript");
    expect(before[0]!.lastVerifiedAt).toBeUndefined();

    // Recall should set lastVerifiedAt
    await handleRecall(store, {
      query: "TypeScript",
      scope: "verified-test",
    });

    const after = store.searchFTS(scope.id, "TypeScript");
    expect(after[0]!.lastVerifiedAt).toBeDefined();
    expect(after[0]!.lastVerifiedAt).toBeGreaterThan(0);
  });

  it("gist includes structured sections", async () => {
    await seedScope(store, "sections-test", [
      { type: "fact", content: "Uses PostgreSQL 15 for primary database" },
      { type: "decision", content: "Chose Drizzle ORM for database access", rationale: "Type safety" },
      { type: "episode", content: "Set up PostgreSQL with Drizzle migration pipeline" },
    ]);

    const result = await handleRecall(store, {
      query: "PostgreSQL Drizzle database",
      scope: "sections-test",
    });

    // Should have structured output
    expect(result.gist).toContain("## Facts");
    expect(result.gist).toContain("Sources:");
  });

  it("boosts matching language memories dynamically during recall", async () => {
    // Seed TypeScript and Go facts
    await seedScope(store, "boost-test", [
      { type: "fact", content: "Typescript server startup entry point config", language: "typescript" },
      { type: "fact", content: "Go server startup entry point config", language: "go" },
    ]);

    // 1. Query with typescript keyword or explicit parameter
    const tsResult = await handleRecall(store, {
      query: "server startup",
      language: "typescript",
      scope: "boost-test",
    });

    // The typescript fact should be first and contain its badge
    expect(tsResult.gist).toContain("[typescript]");
    
    // Let's do another with go
    const goResult = await handleRecall(store, {
      query: "server startup",
      activeFiles: ["src/main.go"],
      scope: "boost-test",
    });

    expect(goResult.gist).toContain("[go]");
  });
});
