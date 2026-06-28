import type { Store } from "../store/db.js";
import { DiffInput } from "./handoff-schemas.js";
import { resolveDefaultScope } from "../scope.js";
import { parseSince } from "./handoff.js";

/**
 * Show what changed in memory since a given time.
 * Useful for agents to understand recent activity without full recall.
 */
export function handleDiff(store: Store, raw: unknown) {
  const input = DiffInput.parse(raw);
  const scope = store.resolveScope(resolveDefaultScope(input.scope));

  const sinceStr = input.since ?? "1d";
  const since = parseSince(sinceStr) ?? Date.now() - 24 * 60 * 60 * 1000;

  const rows = store.diffSince(scope.id, since);

  if (rows.length === 0) {
    return {
      scope: scope.name,
      since: new Date(since).toISOString(),
      count: 0,
      diff: `_No changes in scope "${scope.name}" since ${new Date(since).toISOString().slice(0, 16)}_`,
    };
  }

  const lines: string[] = [
    `## Memory changes since ${new Date(since).toISOString().slice(0, 16)}`,
    "",
  ];

  for (const r of rows) {
    const date = new Date(r.updatedAt)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
    const isNew = r.createdAt >= since;
    const marker = isNew ? "+" : "~";
    const langBadge = r.language ? `[${r.language}] ` : "";
    let line = `${marker} **${r.type}** ${langBadge}${date} — ${r.content}`;
    if (r.rationale) line += ` _(${r.rationale})_`;
    lines.push(line);
  }

  lines.push(
    "",
    `_${rows.length} change${rows.length === 1 ? "" : "s"} in scope "${scope.name}"._`
  );

  return {
    scope: scope.name,
    since: new Date(since).toISOString(),
    count: rows.length,
    diff: lines.join("\n"),
  };
}
