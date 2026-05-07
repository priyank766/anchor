// Anchor benchmark harness.
// Measures: insert latency, recall latency, gist token count, storage cost.
// Run: node packages/server/dist/bench/bench.js

import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Store } from "../store/db.js";
import { handleRecall } from "../tools/recall.js";
import { handleRemember } from "../tools/remember.js";
import { estimateTokens } from "../retrieval/compress.js";

interface Result {
  scale: number;
  insertMsAvg: number;
  recallMsP50: number;
  recallMsP95: number;
  gistTokensAvg: number;
  dbBytes: number;
  bytesPerItem: number;
}

function pct(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx]!;
}

const SAMPLE_FACTS = [
  "uses pnpm not npm",
  "uses Vitest not Jest",
  "TypeScript strict mode required",
  "linter is Biome",
  "deploys to Cloudflare Workers",
  "uses Prisma ORM",
  "monorepo with Turborepo",
  "feature-flag service is GrowthBook",
  "auth via Clerk",
  "billing via Stripe",
];

const SAMPLE_DECISIONS = [
  ["use Postgres for orders", "ACID + team familiarity"],
  ["use Redis token bucket for rate limiting", "low latency, cluster-safe"],
  ["adopt MCP for cross-agent memory", "open standard"],
  ["embed schema as TS string", "single-binary distribution"],
  ["redact secrets at write time", "trust requirement"],
];

const SAMPLE_EPISODES = [
  "Implemented JWT verifier with key rotation. Touched src/auth/middleware.ts and tests.",
  "Added rate limiting to /auth/* endpoints. Token bucket via Redis.",
  "Migrated billing to Stripe Checkout. Removed legacy webhook code.",
  "Refactored database connection pool. Latency p99 from 80ms to 22ms.",
  "Set up GrowthBook flags for the new pricing tier.",
];

async function bench(scale: number): Promise<Result> {
  const dir = mkdtempSync(join(tmpdir(), "anchor-bench-"));
  const cfg = {
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  };
  const store = new Store(cfg);

  const insertTimes: number[] = [];
  for (let i = 0; i < scale; i++) {
    const pick = i % 10;
    const t0 = performance.now();
    if (pick < 5) {
      await handleRemember(store, {
        type: "fact",
        content: `${SAMPLE_FACTS[i % SAMPLE_FACTS.length]} (entry ${i})`,
        scope: "bench",
        agent: "bench",
        sessionId: `s-${Math.floor(i / 50)}`,
      });
    } else if (pick < 7) {
      const [c, r] = SAMPLE_DECISIONS[i % SAMPLE_DECISIONS.length]!;
      await handleRemember(store, {
        type: "decision",
        content: `${c} (entry ${i})`,
        rationale: r,
        scope: "bench",
        agent: "bench",
      });
    } else if (pick < 9) {
      await handleRemember(store, {
        type: "episode",
        content: `${SAMPLE_EPISODES[i % SAMPLE_EPISODES.length]} (entry ${i})`,
        scope: "bench",
        agent: "bench",
      });
    } else {
      await handleRemember(store, {
        type: "artifact",
        content: `src/file${i}.ts`,
        ref: `src/file${i}.ts:${i}`,
        note: `entry ${i}`,
        scope: "bench",
        agent: "bench",
      });
    }
    insertTimes.push(performance.now() - t0);
  }

  const queries = [
    "package manager",
    "auth and rate limiting",
    "database connection",
    "deploy target",
    "Stripe billing",
    "JWT key rotation",
    "MCP cross-agent",
  ];

  const recallTimes: number[] = [];
  let tokenSum = 0;
  for (const q of queries) {
    const t0 = performance.now();
    const out = await handleRecall(store, { query: q, scope: "bench" });
    recallTimes.push(performance.now() - t0);
    tokenSum += estimateTokens(out.gist);
  }

  store.close();

  const dbBytes = statSync(cfg.dbPath).size;
  return {
    scale,
    insertMsAvg: avg(insertTimes),
    recallMsP50: pct(recallTimes, 50),
    recallMsP95: pct(recallTimes, 95),
    gistTokensAvg: Math.round(tokenSum / queries.length),
    dbBytes,
    bytesPerItem: Math.round(dbBytes / scale),
  };
}

function avg(arr: number[]): number {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

const SCALES = [100, 1_000, 10_000];

console.log(
  "scale     insert(ms avg)   recall p50    recall p95    gist tokens   db size      bytes/item"
);
console.log(
  "------   --------------   -----------   -----------   -----------   ----------   ----------"
);
for (const s of SCALES) {
  const r = await bench(s);
  const dbKb = (r.dbBytes / 1024).toFixed(1);
  console.log(
    `${String(r.scale).padStart(6)}   ${r.insertMsAvg.toFixed(2).padStart(14)}   ${r.recallMsP50.toFixed(2).padStart(11)}   ${r.recallMsP95.toFixed(2).padStart(11)}   ${String(r.gistTokensAvg).padStart(11)}   ${(dbKb + " KB").padStart(10)}   ${String(r.bytesPerItem).padStart(10)}`
  );
}
