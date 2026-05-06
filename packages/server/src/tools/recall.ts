import type { Store } from "../store/db.js";
import { compressToGist } from "../retrieval/compress.js";
import { RecallInput } from "./schemas.js";
import { loadConfig } from "../config.js";
import { resolveDefaultScope } from "../scope.js";

export function handleRecall(store: Store, raw: unknown) {
  const input = RecallInput.parse(raw);
  const cfg = loadConfig();
  const scope = store.resolveScope(resolveDefaultScope(input.scope));
  const rows = store.searchFTS(scope.id, input.query, 50);
  const gist = compressToGist(rows, {
    budgetTokens: input.budgetTokens ?? cfg.defaultBudgetTokens,
    query: input.query,
  });
  return {
    scope: scope.name,
    query: input.query,
    matched: rows.length,
    gist,
  };
}
