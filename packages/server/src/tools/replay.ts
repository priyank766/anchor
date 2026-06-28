import type { Store } from "../store/db.js";
import { ReplayInput } from "./handoff-schemas.js";
import { resolveDefaultScope } from "../scope.js";

/**
 * Reconstruct a chronological narrative of decisions and episodes.
 * Think of it as the project's memory timeline — what happened, in order.
 */
export function handleReplay(store: Store, raw: unknown) {
  const input = ReplayInput.parse(raw);
  const scope = store.resolveScope(resolveDefaultScope(input.scope));

  const rows = store.replay(scope.id, input.limit);

  if (rows.length === 0) {
    return {
      scope: scope.name,
      count: 0,
      replay: `_No episodes or decisions in scope "${scope.name}"._`,
    };
  }

  const lines: string[] = [
    `## Project Timeline: ${scope.name}`,
    "",
  ];

  let prevDate = "";
  for (const r of rows) {
    const date = new Date(r.createdAt).toISOString().slice(0, 10);
    const time = new Date(r.createdAt).toISOString().slice(11, 16);

    if (date !== prevDate) {
      lines.push(`### ${date}`);
      prevDate = date;
    }

    const icon = r.type === "decision" ? "◆" : "●";
    const tag = r.type === "decision" ? "decided" : "episode";
    const langBadge = r.language ? `[${r.language}] ` : "";
    let line = `- ${icon} \`${time}\` **${tag}**: ${langBadge}${r.content}`;
    if (r.rationale) line += ` — _${r.rationale}_`;
    if (r.files && r.files.length) line += ` [files: ${r.files.slice(0, 5).join(", ")}]`;
    lines.push(line);
  }

  lines.push(
    "",
    `_${rows.length} event${rows.length === 1 ? "" : "s"} in scope "${scope.name}"._`
  );

  return {
    scope: scope.name,
    count: rows.length,
    replay: lines.join("\n"),
  };
}
