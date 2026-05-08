// `anchor reembed` — backfill vectors for memories missing them under the
// currently configured embedding provider. Useful when:
//   - user opts into embeddings on a store that predates the provider
//   - user switches provider (provider id changes; old vectors stay inert)
//   - hooks ran before provider was configured

import { loadConfig } from "@anchormem/server/config";
import { Store } from "@anchormem/server/store/db";
import { loadEmbedProvider } from "@anchormem/server/providers/types";

export async function runReembed(opts: {
  scope?: string;
  limit?: number;
  onProgress?: (done: number, total: number, lastError?: string) => void;
}): Promise<{ provider: string; embedded: number; failed: number }> {
  const provider = await loadEmbedProvider();
  if (!provider) {
    throw new Error(
      "no embedding provider configured. Set ANCHOR_EMBED_PROVIDER (e.g. ollama) and try again."
    );
  }

  const cfg = loadConfig();
  const store = new Store(cfg);
  try {
    const scopeId = opts.scope ? store.resolveScope(opts.scope).id : undefined;
    const limit = opts.limit ?? Number.POSITIVE_INFINITY;

    // If no scope, walk all scopes. Cheap; we list per scope to keep memory
    // bounded.
    const scopes: { id: string; name: string }[] = scopeId
      ? [{ id: scopeId, name: opts.scope! }]
      : (
          (
            store as unknown as {
              db: { prepare: (sql: string) => { all: () => unknown[] } };
            }
          ).db
            .prepare("SELECT id, name FROM scopes")
            .all() as { id: string; name: string }[]
        );

    let embedded = 0;
    let failed = 0;
    let lastError: string | undefined;

    for (const sc of scopes) {
      const missing = store.rowsMissingEmbedding(sc.id, provider.id);
      for (const row of missing) {
        if (embedded + failed >= limit) break;
        try {
          const text = textForRow(row);
          const vector = await provider.embed(text);
          store.upsertEmbedding({
            memoryId: row.id,
            memoryType: row.type,
            scopeId: sc.id,
            providerId: provider.id,
            vector,
          });
          embedded++;
        } catch (e) {
          failed++;
          lastError = e instanceof Error ? e.message : String(e);
        }
        opts.onProgress?.(embedded + failed, missing.length, lastError);
      }
    }

    return { provider: provider.id, embedded, failed };
  } finally {
    store.close();
  }
}

function textForRow(r: { type: string; content: string; rationale?: string; ref?: string; note?: string }): string {
  if (r.type === "decision" && r.rationale) {
    return `${r.content}\n\nRationale: ${r.rationale}`;
  }
  if (r.type === "artifact") {
    return r.note ? `${r.ref ?? r.content}: ${r.note}` : (r.ref ?? r.content);
  }
  return r.content;
}
