import type { Store } from "../store/db.js";
import { ForgetInput } from "./schemas.js";

export function handleForget(store: Store, raw: unknown) {
  const input = ForgetInput.parse(raw);
  const ok = store.deleteById(input.id);
  return { id: input.id, deleted: ok };
}
