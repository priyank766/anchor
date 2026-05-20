import type { Store, MemoryRow } from "../store/db.js";
import { compressToGist } from "../retrieval/compress.js";
import { topK } from "../retrieval/vector.js";
import { RecallInput } from "./schemas.js";
import { loadConfig } from "../config.js";
import { resolveDefaultScope } from "../scope.js";
import { loadEmbedProvider } from "../providers/types.js";

export async function handleRecall(store: Store, raw: unknown) {
  const input = RecallInput.parse(raw);
  const cfg = loadConfig();
  const scope = store.resolveScope(resolveDefaultScope(input.scope));

  // Always do BM25.
  const bm25Rows = store.searchFTS(scope.id, input.query, 50);

  // Optionally do vector search and merge by id.
  let merged: MemoryRow[] = bm25Rows;
  let mode: "bm25" | "hybrid" = "bm25";
  let vectorError: string | undefined;
  const provider = await loadEmbedProvider();
  if (provider) {
    try {
      const queryVec = await provider.embed(input.query);
      const stored = store.listEmbeddings(scope.id, provider.id);
      const hits = topK(queryVec, stored, 30, 0.3);
      // Hydrate the vector hits and merge with BM25 results, dedup by id,
      // preserving BM25 ordering first then appending vector-only hits.
      const seen = new Set(bm25Rows.map((r) => r.id));
      const vectorRows: MemoryRow[] = [];
      for (const h of hits) {
        if (seen.has(h.item.memoryId)) continue;
        const row = store.hydrateMemoryById(h.item.memoryId);
        if (row) {
          vectorRows.push(row);
          seen.add(row.id);
        }
      }
      merged = [...bm25Rows, ...vectorRows];
      mode = "hybrid";
    } catch (e) {
      vectorError = e instanceof Error ? e.message : String(e);
    }
  }

  const gist = compressToGist(merged, {
    budgetTokens: input.budgetTokens ?? cfg.defaultBudgetTokens,
    query: input.query,
  });

  // Side-effect: recall is a signal that these memories are actively useful.
  // Bump episode salience so frequently-recalled episodes resist decay.
  // Touch facts/decisions so the stale-fact warning timer resets.
  if (merged.length > 0) {
    const ids = merged.map((r) => r.id);
    store.bumpSalience(ids);
    store.touchVerified(ids);
  }

  return {
    scope: scope.name,
    query: input.query,
    matched: merged.length,
    mode,
    vectorError,
    gist,
  };
}
