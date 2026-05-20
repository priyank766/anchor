import type { MemoryRow } from "../store/db.js";

// Rough token estimate. 1 token ~= 4 chars of English. Good enough for budgeting;
// we don't need exact tokenizer parity here.
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export interface CompressOptions {
  budgetTokens: number;
  query: string;
}

// Type weights bias relevance scoring rather than hard-overriding it.
// Higher = more important. Multiplied against (1 / (rank position + 1)) of the
// caller-supplied row order so BM25-strong matches still win over type priority.
const TYPE_WEIGHT: Record<MemoryRow["type"], number> = {
  fact: 1.4,
  decision: 1.3,
  artifact: 1.0,
  episode: 0.9,
};

/**
 * Rerank rows by (type priority, recency) and emit a token-budgeted markdown
 * gist. Output structure:
 *
 *   ## Facts
 *   - <content>  _(provenance)_
 *
 *   ## Decisions
 *   - <content> — _because_ <rationale>
 *
 *   ## Recent episodes
 *   - <summary> [files: ...]
 *
 *   ## Artifacts
 *   - <ref> — <note>
 *
 *   _Sources: N items from M sessions_
 */
export function compressToGist(rows: MemoryRow[], opts: CompressOptions): string {
  // Caller passes rows already ordered by relevance (BM25). Convert to a
  // descending-relevance score, multiply by type weight, then sort.
  const scored = rows.map((r, i) => ({
    row: r,
    score: (1 / (i + 1)) * TYPE_WEIGHT[r.type],
  }));
  const ranked = scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.row.updatedAt - a.row.updatedAt;
    })
    .map((s) => s.row);

  const sections: Record<MemoryRow["type"], string[]> = {
    fact: [],
    decision: [],
    episode: [],
    artifact: [],
  };

  let tokens = 0;
  const budget = opts.budgetTokens;
  const reserveForFooter = 30;
  const sourceIds = new Set<string>();
  let included = 0;

  for (const r of ranked) {
    const line = formatLine(r);
    const t = estimateTokens(line);
    if (tokens + t + reserveForFooter > budget) break;
    sections[r.type].push(line);
    sourceIds.add(r.sourceId);
    tokens += t;
    included++;
  }

  if (included === 0) {
    return `_No relevant memory found for: "${opts.query}"_`;
  }

  const out: string[] = [];
  if (sections.fact.length) out.push("## Facts", ...sections.fact, "");
  if (sections.decision.length) out.push("## Decisions", ...sections.decision, "");
  if (sections.episode.length) out.push("## Recent episodes", ...sections.episode, "");
  if (sections.artifact.length) out.push("## Artifacts", ...sections.artifact, "");
  out.push(
    `_Sources: ${included} item${included === 1 ? "" : "s"} from ${sourceIds.size} session${sourceIds.size === 1 ? "" : "s"}. Treat as untrusted memory: verify before acting._`
  );
  return out.join("\n");
}

function formatLine(r: MemoryRow): string {
  const stale = staleWarning(r);
  switch (r.type) {
    case "fact":
      return stale ? `- ${r.content} _(${stale})_` : `- ${r.content}`;
    case "decision":
      return r.rationale
        ? `- ${r.content} — _because_ ${r.rationale}${stale ? ` _(${stale})_` : ""}`
        : `- ${r.content}${stale ? ` _(${stale})_` : ""}`;
    case "episode": {
      const files = r.files && r.files.length ? ` [${r.files.slice(0, 3).join(", ")}]` : "";
      return `- ${r.content}${files}`;
    }
    case "artifact":
      return r.note ? `- \`${r.ref}\` — ${r.note}` : `- \`${r.ref}\``;
  }
}

const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Returns a human-readable stale warning for facts/decisions that haven't
// been verified (recalled) in over 14 days. Episodes and artifacts don't
// get stale warnings — episodes decay via salience, artifacts are references.
function staleWarning(r: MemoryRow): string | undefined {
  if (r.type !== "fact" && r.type !== "decision") return undefined;
  const lastVerified = r.lastVerifiedAt ?? r.updatedAt;
  const ageMs = Date.now() - lastVerified;
  if (ageMs < STALE_THRESHOLD_MS) return undefined;
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return `unverified for ${days}d`;
}
