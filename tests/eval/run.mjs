// tests/eval/run.mjs — comprehensive cold-vs-warm benchmark.
// Does not call any LLM API. Measures context cost, retrieval quality,
// precision, and latency for the scenarios in fixtures.mjs.
//
// Run after building the server:
//   npm run build --workspaces
//   node tests/eval/run.mjs

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../packages/server/dist/store/db.js";
import { handleRemember } from "../../packages/server/dist/tools/remember.js";
import { handleRecall } from "../../packages/server/dist/tools/recall.js";
import {
  compressToGist,
  estimateTokens,
} from "../../packages/server/dist/retrieval/compress.js";
import { SCENARIOS } from "./fixtures.mjs";

// ─── Eval a single scenario ──────────────────────────────────────────────

async function evalScenario(s) {
  const dir = mkdtempSync(join(tmpdir(), "anchor-eval-"));
  const cfg = {
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  };

  // Set ANCHOR_HOME so recall's loadConfig() uses the temp dir.
  const prevHome = process.env.ANCHOR_HOME;
  process.env.ANCHOR_HOME = dir;

  const store = new Store(cfg);
  const scopePath = `/eval/${s.id}`;

  // Phase 1: seed all items
  const seedStart = performance.now();
  for (const item of s.seed) {
    await handleRemember(store, {
      type: item.type,
      content: item.content,
      rationale: item.rationale,
      ref: item.ref,
      note: item.note,
      files: item.files,
      scope: scopePath,
      agent: "eval-seed",
    });
  }
  const seedMs = performance.now() - seedStart;

  // Phase 2: recall via the full pipeline (BM25 + gist)
  const recallStart = performance.now();
  const ref = store.resolveScope(scopePath);
  const rows = store.listByScope(ref.id, undefined, 50);
  const gist = compressToGist(rows, {
    budgetTokens: 1500,
    query: s.newRequest,
  });
  const recallMs = performance.now() - recallStart;

  // Phase 3: FTS-specific recall (measures search quality)
  const ftsStart = performance.now();
  const ftsRows = store.searchFTS(ref.id, s.newRequest, 50);
  const ftsGist = compressToGist(ftsRows, {
    budgetTokens: 1500,
    query: s.newRequest,
  });
  const ftsMs = performance.now() - ftsStart;

  store.close();

  // Restore ANCHOR_HOME
  if (prevHome !== undefined) process.env.ANCHOR_HOME = prevHome;
  else delete process.env.ANCHOR_HOME;

  // ── Metrics ──

  const warmTokens = estimateTokens(gist);
  const coldTokens = s.approxColdTranscriptTokens;
  const reduction = ((1 - warmTokens / coldTokens) * 100);

  // Hit rate: expected substrings found in the gist
  const missing = s.expectedHits.filter(
    (needle) => !gist.toLowerCase().includes(needle.toLowerCase())
  );
  const hits = s.expectedHits.length - missing.length;
  const hitRate = hits / s.expectedHits.length;

  // FTS precision: how many expected hits appear in BM25-only gist
  const ftsMissing = s.expectedHits.filter(
    (needle) => !ftsGist.toLowerCase().includes(needle.toLowerCase())
  );
  const ftsHits = s.expectedHits.length - ftsMissing.length;
  const ftsPrecision = ftsHits / s.expectedHits.length;

  // False positive check: expected misses that leaked
  const leaked = (s.expectedMisses ?? []).filter(
    (needle) => gist.toLowerCase().includes(needle.toLowerCase())
  );

  return {
    id: s.id,
    title: s.title,
    category: s.category,
    coldTokens,
    warmTokens,
    reduction: reduction.toFixed(1),
    reductionPct: reduction,
    hitRate: `${hits}/${s.expectedHits.length}`,
    hitRatePct: hitRate * 100,
    ftsPrecision: `${ftsHits}/${s.expectedHits.length}`,
    ftsPrecisionPct: ftsPrecision * 100,
    missing,
    leaked,
    seedItems: s.seed.length,
    seedMs: seedMs.toFixed(1),
    recallMs: recallMs.toFixed(1),
    ftsMs: ftsMs.toFixed(1),
  };
}

// ─── Run all scenarios ───────────────────────────────────────────────────

const results = await Promise.all(SCENARIOS.map(evalScenario));

// ── Aggregate stats ──
const totalScenarios = results.length;
const avgReduction = results.reduce((s, r) => s + r.reductionPct, 0) / totalScenarios;
const avgHitRate = results.reduce((s, r) => s + r.hitRatePct, 0) / totalScenarios;
const avgFtsPrecision = results.reduce((s, r) => s + r.ftsPrecisionPct, 0) / totalScenarios;
const totalColdTokens = results.reduce((s, r) => s + r.coldTokens, 0);
const totalWarmTokens = results.reduce((s, r) => s + r.warmTokens, 0);
const totalLeaks = results.reduce((s, r) => s + r.leaked.length, 0);
const perfectHitRate = results.filter(r => r.hitRatePct === 100).length;

// ── Markdown output ──

const lines = [];
lines.push("# Anchor Benchmark — Cold vs Warm Retrieval");
lines.push("");
lines.push(`> **${totalScenarios} scenarios** across ${[...new Set(results.map(r => r.category))].length} project categories. All offline — no LLM API calls.`);
lines.push("> ");
lines.push(`> Cold = tokens a user would paste from prior session transcripts.`);
lines.push(`> Warm = tokens Anchor injects via the session-start hook (1,500 token budget).`);
lines.push("");

// Summary box
lines.push("## Summary");
lines.push("");
lines.push("| Metric | Value |");
lines.push("|--------|------:|");
lines.push(`| Scenarios | **${totalScenarios}** |`);
lines.push(`| Avg token reduction | **${avgReduction.toFixed(1)}%** |`);
lines.push(`| Avg retrieval hit rate | **${avgHitRate.toFixed(1)}%** |`);
lines.push(`| Avg BM25 precision | **${avgFtsPrecision.toFixed(1)}%** |`);
lines.push(`| Perfect hit rate (100%) | **${perfectHitRate}/${totalScenarios}** |`);
lines.push(`| Total cold tokens | ${totalColdTokens.toLocaleString()} |`);
lines.push(`| Total warm tokens | ${totalWarmTokens.toLocaleString()} |`);
lines.push(`| Aggregate reduction | **${((1 - totalWarmTokens / totalColdTokens) * 100).toFixed(1)}%** |`);
lines.push(`| Information leaks | ${totalLeaks} |`);
lines.push("");

// Detail table
lines.push("## Per-Scenario Results");
lines.push("");
lines.push("| # | Scenario | Category | Cold | Warm | Reduction | Hit Rate | BM25 Precision | Seed→Recall |");
lines.push("|---|----------|----------|-----:|-----:|----------:|---------:|---------------:|------------:|");
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  lines.push(
    `| ${i + 1} | ${r.title} | ${r.category} | ${r.coldTokens.toLocaleString()} | ${r.warmTokens.toLocaleString()} | ${r.reduction}% | ${r.hitRate} | ${r.ftsPrecision} | ${r.seedMs}ms→${r.recallMs}ms |`
  );
}
lines.push("");

// Missing hits detail
const anyMissing = results.some(r => r.missing.length > 0);
if (anyMissing) {
  lines.push("## Missing Signals");
  lines.push("");
  for (const r of results) {
    if (r.missing.length > 0) {
      lines.push(
        `- **${r.title}**: missing \`${r.missing.join("`, `")}\``
      );
    }
  }
  lines.push("");
}

// Leaks detail
if (totalLeaks > 0) {
  lines.push("## ⚠️ Information Leaks");
  lines.push("");
  for (const r of results) {
    if (r.leaked.length > 0) {
      lines.push(
        `- **${r.title}**: leaked \`${r.leaked.join("`, `")}\``
      );
    }
  }
  lines.push("");
}

lines.push("---");
lines.push(`*Generated ${new Date().toISOString().slice(0, 16)} by \`node tests/eval/run.mjs\`*`);

process.stdout.write(lines.join("\n") + "\n");

// ── Save results ──

const outDir = join(process.cwd(), "tests", "eval", "results");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${Date.now()}.json`);
writeFileSync(
  outFile,
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      summary: {
        scenarios: totalScenarios,
        avgReductionPct: +avgReduction.toFixed(1),
        avgHitRatePct: +avgHitRate.toFixed(1),
        avgFtsPrecisionPct: +avgFtsPrecision.toFixed(1),
        totalColdTokens,
        totalWarmTokens,
        aggregateReductionPct: +((1 - totalWarmTokens / totalColdTokens) * 100).toFixed(1),
        perfectHitRate: `${perfectHitRate}/${totalScenarios}`,
        leaks: totalLeaks,
      },
      results,
    },
    null,
    2
  )
);
process.stderr.write(`\nresults written to ${outFile}\n`);
