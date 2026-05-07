// tests/eval/run.mjs — offline cold-vs-warm comparison.
// Does not call any LLM API. Measures the context cost delta and retrieval
// quality for the scenarios in fixtures.mjs.
//
// Run after building the server:
//   npm run build --workspaces
//   node tests/eval/run.mjs

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../packages/server/dist/store/db.js";
import { handleRemember } from "../../packages/server/dist/tools/remember.js";
import {
  compressToGist,
  estimateTokens,
} from "../../packages/server/dist/retrieval/compress.js";
import { SCENARIOS } from "./fixtures.mjs";

async function evalScenario(s) {
  const dir = mkdtempSync(join(tmpdir(), "anchor-eval-"));
  const cfg = {
    dataDir: dir,
    dbPath: join(dir, "memory.db"),
    defaultBudgetTokens: 1500,
  };
  const store = new Store(cfg);

  const scopePath = `/eval/${s.id}`;

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

  const ref = store.resolveScope(scopePath);
  const rows = store.listByScope(ref.id, undefined, 50);
  const gist = compressToGist(rows, {
    budgetTokens: 1500,
    query: s.newRequest,
  });
  store.close();

  const warmTokens = estimateTokens(gist);
  const coldTokens = s.approxColdTranscriptTokens;
  const reduction = ((1 - warmTokens / coldTokens) * 100).toFixed(1) + "%";

  const missing = s.expectedHits.filter(
    (needle) => !gist.toLowerCase().includes(needle.toLowerCase())
  );
  const hits = s.expectedHits.length - missing.length;
  const hitRate = `${hits}/${s.expectedHits.length}`;

  return {
    id: s.id,
    title: s.title,
    coldTokens,
    warmTokens,
    reduction,
    hitRate,
    missing,
  };
}

const results = await Promise.all(SCENARIOS.map(evalScenario));

const lines = [];
lines.push("# Anchor — cold-vs-warm evaluation");
lines.push("");
lines.push(
  "Offline measurement. Cold = tokens a user would paste from a prior session transcript. Warm = tokens Anchor injects via the session-start hook for the same scope."
);
lines.push("");
lines.push("| Scenario | Cold tokens | Warm tokens | Reduction | Relevant hits |");
lines.push("|---|---:|---:|---:|---:|");
for (const r of results) {
  lines.push(
    `| ${r.title} | ${r.coldTokens.toLocaleString()} | ${r.warmTokens.toLocaleString()} | ${r.reduction} | ${r.hitRate} |`
  );
}
lines.push("");
for (const r of results) {
  if (r.missing.length > 0) {
    lines.push(
      `> ${r.title}: missing relevant signal — \`${r.missing.join("`, `")}\``
    );
  }
}
process.stdout.write(lines.join("\n") + "\n");

const outDir = join(process.cwd(), "tests", "eval", "results");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${Date.now()}.json`);
writeFileSync(
  outFile,
  JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)
);
process.stderr.write(`\nresults written to ${outFile}\n`);
