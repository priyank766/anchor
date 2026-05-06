import type { Store } from "../store/db.js";
import { ListInput } from "./schemas.js";

export function handleList(store: Store, raw: unknown) {
  const input = ListInput.parse(raw);
  const scope = store.resolveScope(input.scope);
  const rows = store.listByScope(scope.id, input.type, input.limit ?? 100);
  return {
    scope: scope.name,
    count: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      content: r.content,
      rationale: r.rationale,
      files: r.files,
      updatedAt: r.updatedAt,
    })),
  };
}
