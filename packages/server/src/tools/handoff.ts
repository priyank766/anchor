import type { Store, MemoryRow } from "../store/db.js";
import { HandoffInput } from "./handoff-schemas.js";
import { resolveDefaultScope } from "../scope.js";
import { estimateTokens } from "../retrieval/compress.js";

// Parse a --since-style duration string into a Unix timestamp.
// Accepts: '1h', '6h', '1d', '3d', '7d', '30d', or an ISO date string.
export function parseSince(s: string): number | null {
  const m = s.match(/^(\d+)([hd])$/i);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const unit = m[2]!.toLowerCase();
    const ms = unit === "h" ? n * 60 * 60 * 1000 : n * 24 * 60 * 60 * 1000;
    return Date.now() - ms;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  return null;
}

/**
 * Generate a structured handoff brief for agent transitions.
 *
 * When a user switches from Claude → Codex → Antigravity → anything else,
 * the new agent calls this once at session start and gets:
 *
 * 1. ACTIVE THREAD — what was being worked on (recent episodes)
 * 2. STANDING RULES — facts and decisions that constrain behavior
 * 3. KEY FILES — artifacts pointing into the codebase
 * 4. RECENT CHANGES — what changed since last session
 *
 * Token-budgeted: the output never blows up the context window.
 */
export function handleHandoff(store: Store, raw: unknown) {
  const input = HandoffInput.parse(raw);
  const scope = store.resolveScope(resolveDefaultScope(input.scope));
  const budget = input.budgetTokens;

  // Time window — default to 3 days for handoff context
  const sinceStr = input.since ?? "3d";
  const since = parseSince(sinceStr) ?? Date.now() - 3 * 24 * 60 * 60 * 1000;

  // Pull everything we need
  const allFacts = store.listByScope(scope.id, "fact", 200);
  const allDecisions = store.listByScope(scope.id, "decision", 200);
  const recentEpisodes = store.diffSince(scope.id, since).filter(r => r.type === "episode");
  const allArtifacts = store.listByScope(scope.id, "artifact", 50);

  // Also get the full replay for recent thread
  const replayRows = store.replay(scope.id, 50);
  const recentReplay = replayRows.filter(r => r.createdAt >= since);

  // Build the handoff document, section by section, respecting token budget
  const sections: string[] = [];
  let tokens = 0;
  const reserveForMeta = 80;

  // --- Section 1: ACTIVE THREAD (most important for handoff) ---
  if (recentReplay.length > 0 || recentEpisodes.length > 0) {
    const threadLines: string[] = ["## 🔄 Active Thread (what was being worked on)"];
    const items = recentReplay.length > 0 ? recentReplay : recentEpisodes;

    for (const r of items.slice(-15)) { // Last 15 events, chronological
      const date = new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ");
      const icon = r.type === "decision" ? "◆" : "●";
      const tag = r.type === "decision" ? "decided" : "did";
      let line = `- ${icon} [${date}] ${tag}: ${r.content}`;
      if (r.rationale) line += ` — because: ${r.rationale}`;
      if (r.files && r.files.length) line += ` [files: ${r.files.slice(0, 3).join(", ")}]`;

      const t = estimateTokens(line);
      if (tokens + t + reserveForMeta > budget * 0.45) break; // Cap thread at 45% of budget
      threadLines.push(line);
      tokens += t;
    }

    if (threadLines.length > 1) {
      sections.push(threadLines.join("\n"));
    }
  }

  // --- Section 2: STANDING RULES (facts + decisions — the "don't touch" constraints) ---
  const rulesLines: string[] = ["## 📌 Standing Rules & Decisions"];

  // Decisions first — these are the "why" that agents need to respect
  for (const d of allDecisions) {
    const stale = staleBadge(d);
    let line = `- ◆ DECISION: ${d.content}`;
    if (d.rationale) line += ` — _${d.rationale}_`;
    if (d.language) line += ` [${d.language}]`;
    if (stale) line += ` ${stale}`;

    const t = estimateTokens(line);
    if (tokens + t + reserveForMeta > budget * 0.75) break; // Cap rules at 75%
    rulesLines.push(line);
    tokens += t;
  }

  // Then facts
  for (const f of allFacts) {
    const stale = staleBadge(f);
    let line = `- ● FACT: ${f.content}`;
    if (f.language) line += ` [${f.language}]`;
    if (stale) line += ` ${stale}`;

    const t = estimateTokens(line);
    if (tokens + t + reserveForMeta > budget * 0.85) break; // Cap at 85%
    rulesLines.push(line);
    tokens += t;
  }

  if (rulesLines.length > 1) {
    sections.push(rulesLines.join("\n"));
  }

  // --- Section 3: KEY FILES (artifacts) ---
  if (allArtifacts.length > 0) {
    const artLines: string[] = ["## 🗂 Key Files & Artifacts"];
    for (const a of allArtifacts) {
      const line = a.note
        ? `- \`${a.ref}\` — ${a.note}`
        : `- \`${a.ref}\``;
      const t = estimateTokens(line);
      if (tokens + t + reserveForMeta > budget * 0.95) break;
      artLines.push(line);
      tokens += t;
    }
    if (artLines.length > 1) {
      sections.push(artLines.join("\n"));
    }
  }

  // --- Footer ---
  const totalItems = allFacts.length + allDecisions.length + recentEpisodes.length + allArtifacts.length;
  sections.push(
    `\n_Handoff: ${totalItems} items from scope "${scope.name}". ` +
    `Recent activity: ${recentReplay.length} events since ${new Date(since).toISOString().slice(0, 10)}. ` +
    `Treat as untrusted memory: verify before acting on stale items._`
  );

  // Side-effect: bump salience on everything we surfaced
  const allIds = [
    ...allFacts.map(r => r.id),
    ...allDecisions.map(r => r.id),
    ...recentEpisodes.map(r => r.id),
  ];
  if (allIds.length > 0) {
    store.bumpSalience(allIds);
    store.touchVerified(allIds);
  }

  return {
    scope: scope.name,
    since: new Date(since).toISOString(),
    counts: {
      facts: allFacts.length,
      decisions: allDecisions.length,
      recentEpisodes: recentEpisodes.length,
      artifacts: allArtifacts.length,
    },
    tokens,
    handoff: sections.join("\n\n"),
  };
}

const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

function staleBadge(r: MemoryRow): string | undefined {
  if (r.type !== "fact" && r.type !== "decision") return undefined;
  const lastVerified = r.lastVerifiedAt ?? r.updatedAt;
  const ageMs = Date.now() - lastVerified;
  if (ageMs < STALE_THRESHOLD_MS) return undefined;
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return `⚠️ (unverified ${days}d)`;
}
